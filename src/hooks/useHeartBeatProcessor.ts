import { useState, useEffect, useCallback, useRef } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

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
 * HOOK DE PROCESAMIENTO CARDÍACO
 * - Ignora ruido cuando no hay dedo confirmado
 * - Evita contaminar el detector con frames sin contacto
 * - Usa el BPM ya estabilizado por HeartBeatProcessor
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
  const lostContactFramesRef = useRef<number>(0);

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

  // Use refs to avoid stale closures and prevent callback identity churn
  const currentBPMRef = useRef(0);
  const confidenceRef = useRef(0);
  const signalQualityRef = useRef(0);

  // Keep refs in sync
  currentBPMRef.current = currentBPM;
  confidenceRef.current = confidence;
  signalQualityRef.current = signalQuality;

  const processSignal = useCallback((value: number, fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      return {
        bpm: currentBPMRef.current, confidence: 0, isPeak: false,
        filteredValue: 0, arrhythmiaCount: 0, signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null },
      };
    }

    const currentTime = timestamp ?? Date.now();

    if (currentTime - lastProcessTimeRef.current < 12) {
      return {
        bpm: currentBPMRef.current, confidence: confidenceRef.current,
        isPeak: false, filteredValue: 0, arrhythmiaCount: 0,
        signalQuality: signalQualityRef.current,
        rrData: { intervals: [], lastPeakTime: null },
      };
    }

    lastProcessTimeRef.current = currentTime;

    if (!fingerDetected) {
      lostContactFramesRef.current += 1;

      if (lostContactFramesRef.current >= 8) {
        processorRef.current.reset();
        setConfidence(0);
        setSignalQuality(0);
      }

      return {
        bpm: currentBPMRef.current, confidence: 0, isPeak: false,
        filteredValue: 0, arrhythmiaCount: 0, signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null },
      };
    }

    lostContactFramesRef.current = 0;
    processedSignalsRef.current++;

    const result = processorRef.current.processSignal(value, timestamp);
    const rrIntervals = processorRef.current.getRRIntervals();
    const lastPeakTime = processorRef.current.getLastPeakTime();
    const rrData = { intervals: rrIntervals, lastPeakTime: lastPeakTime || null };
    const roundedSQI = Math.round(result.sqi);

    setSignalQuality(roundedSQI);

    if (result.bpm > 0 && (result.confidence >= 0.18 || result.sqi >= 45)) {
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
  }, [confidence, currentBPM, emptyResult, signalQuality]);

  const reset = useCallback(() => {
    if (processingStateRef.current === 'RESETTING') return;

    processingStateRef.current = 'RESETTING';

    if (processorRef.current) {
      processorRef.current.reset();
    }

    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);

    lastProcessTimeRef.current = 0;
    processedSignalsRef.current = 0;
    lostContactFramesRef.current = 0;

    processingStateRef.current = 'ACTIVE';
  }, []);

  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    if (processorRef.current && processingStateRef.current === 'ACTIVE') {
      processorRef.current.setArrhythmiaDetected(isArrhythmiaDetected);
    }
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