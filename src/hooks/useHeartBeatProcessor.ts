import { useState, useEffect, useCallback, useRef } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';
import type { ContactState } from '../types/signal';

interface HeartBeatResult {
  bpm: number;
  confidence: number;
  isPeak: boolean;
  filteredValue: number;
  arrhythmiaCount: number;
  signalQuality: number;
  rrData?: {
    intervals: number[];
    lastPeakTime: number | null;
  };
}

/**
 * HOOK DE PROCESAMIENTO CARDÍACO - ALINEADO CON CONTACTSTATE
 * 
 * - Usa ContactState del PPGSignalProcessor en vez de su propia lógica de reset
 * - Solo resetea cuando NO_CONTACT sostenido
 * - En UNSTABLE_CONTACT sigue procesando sin resetear historial
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);

  const sessionIdRef = useRef<string>('');
  const processingStateRef = useRef<'IDLE' | 'ACTIVE' | 'RESETTING'>('IDLE');
  const lastProcessTimeRef = useRef<number>(0);
  const processedSignalsRef = useRef<number>(0);
  // Track sustained NO_CONTACT to align with PPGSignalProcessor
  const noContactFramesRef = useRef<number>(0);
  const NO_CONTACT_RESET_THRESHOLD = 90; // ~3s @ 30fps

  // Refs for stable callback
  const currentBPMRef = useRef(0);
  const confidenceRef = useRef(0);
  const signalQualityRef = useRef(0);

  useEffect(() => {
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `hb_${t}_${p}`;
    processorRef.current = new HeartBeatProcessor();
    processingStateRef.current = 'ACTIVE';

    return () => {
      if (processorRef.current) {
        processorRef.current.dispose();
        processorRef.current = null;
      }
      processingStateRef.current = 'IDLE';
    };
  }, []);

  // Keep refs in sync
  currentBPMRef.current = currentBPM;
  confidenceRef.current = confidence;
  signalQualityRef.current = signalQuality;

  const processSignal = useCallback((
    value: number,
    contactState: ContactState = 'STABLE_CONTACT',
    timestamp?: number
  ): HeartBeatResult => {
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      return {
        bpm: currentBPMRef.current, confidence: 0, isPeak: false,
        filteredValue: 0, arrhythmiaCount: 0, signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null },
      };
    }

    const currentTime = timestamp ?? Date.now();

    // === CONTACT STATE HANDLING ===
    // NO_CONTACT must bypass throttle so stale BPM cannot leak into the UI
    if (contactState === 'NO_CONTACT') {
      noContactFramesRef.current += 1;

      if (noContactFramesRef.current >= NO_CONTACT_RESET_THRESHOLD) {
        processorRef.current.reset();
      }

      if (currentBPMRef.current !== 0) setCurrentBPM(0);
      if (confidenceRef.current !== 0) setConfidence(0);
      if (signalQualityRef.current !== 0) setSignalQuality(0);

      return {
        bpm: 0, confidence: 0, isPeak: false,
        filteredValue: 0, arrhythmiaCount: 0, signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null },
      };
    }

    // Throttle to ~80fps max
    if (currentTime - lastProcessTimeRef.current < 12) {
      return {
        bpm: currentBPMRef.current, confidence: confidenceRef.current,
        isPeak: false, filteredValue: 0, arrhythmiaCount: 0,
        signalQuality: signalQualityRef.current,
        rrData: { intervals: [], lastPeakTime: null },
      };
    }
    lastProcessTimeRef.current = currentTime;

    // UNSTABLE_CONTACT or STABLE_CONTACT — process normally
    noContactFramesRef.current = 0;
    processedSignalsRef.current++;

    const result = processorRef.current.processSignal(value, timestamp);
    const rrIntervals = processorRef.current.getRRIntervals();
    const lastPeakTime = processorRef.current.getLastPeakTime();
    const rrData = { intervals: rrIntervals, lastPeakTime: lastPeakTime || null };
    const roundedSQI = Math.round(result.sqi);

    setSignalQuality(roundedSQI);

    if (result.bpm > 0 && result.confidence >= 0.15) {
      setCurrentBPM(Math.round(result.bpm));
      setConfidence(result.confidence);
    } else if (result.confidence > 0) {
      setConfidence(result.confidence);
    }

    return {
      bpm: Math.round(result.bpm),
      confidence: result.confidence,
      isPeak: result.isPeak,
      filteredValue: result.filteredValue,
      arrhythmiaCount: result.arrhythmiaCount,
      signalQuality: roundedSQI,
      rrData,
    };
  }, []);

  const reset = useCallback(() => {
    if (processingStateRef.current === 'RESETTING') return;
    processingStateRef.current = 'RESETTING';

    if (processorRef.current) processorRef.current.reset();

    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
    lastProcessTimeRef.current = 0;
    processedSignalsRef.current = 0;
    noContactFramesRef.current = 0;

    processingStateRef.current = 'ACTIVE';
  }, []);

  const setArrhythmiaState = useCallback((_isArrhythmiaDetected: boolean) => {
    // No-op: arrhythmia state is managed by ArrhythmiaProcessor directly
  }, []);

  return {
    currentBPM,
    confidence,
    signalQuality,
    processSignal,
    reset,
    setArrhythmiaState,
    debugInfo: {
      sessionId: sessionIdRef.current,
      processingState: processingStateRef.current,
      processedSignals: processedSignalsRef.current,
    },
  };
};
