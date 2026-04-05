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
 * HOOK DE PROCESAMIENTO CARDÍACO - SIN FINGER DETECTION
 * 
 * Procesa la señal directamente:
 * - Si hay sangre real → BPM coherente
 * - Si hay ambiente → valores erráticos o 0
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);
  
  const sessionIdRef = useRef<string>("");
  const processingStateRef = useRef<'IDLE' | 'ACTIVE' | 'RESETTING'>('IDLE');
  const processedSignalsRef = useRef<number>(0);
  const lastOutputRef = useRef({ bpm: 0, confidence: 0, signalQuality: 0 });

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

  // ELIMINADO: setGreenValue - la calidad de señal determina validez

  const processSignal = useCallback((
    value: number,
    timestamp?: number,
    opts?: { ppgQuality?: number }
  ): HeartBeatResult => {
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      const o = lastOutputRef.current;
      return {
        bpm: o.bpm,
        confidence: o.confidence,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0,
        signalQuality: o.signalQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    processedSignalsRef.current++;

    const result = processorRef.current.processSignal(value, timestamp);
    const rrIntervals = processorRef.current.getRRIntervals();
    const lastPeakTime = processorRef.current.getLastPeakTime();
    const rrData = { intervals: rrIntervals, lastPeakTime };

    const ppgOk = opts?.ppgQuality === undefined || opts.ppgQuality >= 32;
    if (result.confidence >= 0.42 && result.bpm > 0 && ppgOk) {
      const smoothingFactor = Math.min(0.38, result.confidence * 0.55);
      setCurrentBPM((prev) => {
        const next =
          prev > 0 ? prev * (1 - smoothingFactor) + result.bpm * smoothingFactor : result.bpm;
        return Math.round(next);
      });
      setConfidence(result.confidence);
    } else if (opts?.ppgQuality !== undefined && opts.ppgQuality < 18 && result.confidence < 0.2) {
      setCurrentBPM(0);
      setConfidence(0);
    }
    setSignalQuality(result.sqi);

    const bpmOut = Math.round(result.bpm);
    lastOutputRef.current = {
      bpm: bpmOut,
      confidence: result.confidence,
      signalQuality: result.sqi,
    };

    return {
      bpm: bpmOut,
      confidence: result.confidence,
      isPeak: result.isPeak,
      filteredValue: result.filteredValue,
      arrhythmiaCount: result.arrhythmiaCount,
      signalQuality: result.sqi,
      rrData,
    };
  }, []);

  const reset = useCallback(() => {
    if (processingStateRef.current === 'RESETTING') return;
    
    processingStateRef.current = 'RESETTING';
    
    if (processorRef.current) {
      processorRef.current.reset();
    }
    
    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
    lastOutputRef.current = { bpm: 0, confidence: 0, signalQuality: 0 };

    processedSignalsRef.current = 0;
    
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
      processedSignals: processedSignalsRef.current
    }
  };
};
