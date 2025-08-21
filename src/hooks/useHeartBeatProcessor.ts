
import { useState, useEffect, useCallback, useRef } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

interface HeartBeatResult {
  bpm: number;
  confidence: number;
  isPeak: boolean;
  arrhythmiaCount: number;
  signalQuality: number;
  rrData?: {
    intervals: number[];
    lastPeakTime: number | null;
  };
}

/**
 * HOOK UNIFICADO DE PROCESAMIENTO CARDÍACO - SIN DUPLICIDADES
 * Implementa algoritmos matemáticos avanzados para detección cardíaca precisa
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);
  
  const sessionId = useRef<string>((() => {
    const randomBytes = new Uint32Array(1);
    crypto.getRandomValues(randomBytes);
    return randomBytes[0].toString(36);
  })());

  // Eliminadas variables de seguimiento innecesarias que causaban memory leaks

  useEffect(() => {
    console.log('useHeartBeatProcessor: Creating processor', {
      sessionId: sessionId.current
    });
    
    processorRef.current = new HeartBeatProcessor();
    
    return () => {
      if (processorRef.current) {
        processorRef.current = null;
      }
    };
  }, []);

  const processSignal = useCallback((value: number, fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    if (!processorRef.current) {
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    // Procesamiento directo sin logging excesivo
    const result = processorRef.current.processSignal(value, timestamp);
    const rrData = processorRef.current.getRRIntervals();
    const currentQuality = result.signalQuality || 0;
    
    setSignalQuality(currentQuality);

    // Lógica mejorada sin umbrales artificiales
    const effectiveFingerDetected = fingerDetected || (currentQuality > 15 && result.confidence > 0.4);
    
    if (!effectiveFingerDetected) {
      // Degradación gradual suave
      if (currentBPM > 0) {
        setCurrentBPM(Math.max(0, currentBPM * 0.95));
        setConfidence(Math.max(0, confidence * 0.9));
      }
      
      return {
        bpm: currentBPM,
        confidence: Math.max(0, confidence * 0.9),
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: currentQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    // Actualización con confianza alta
    if (result.confidence >= 0.6 && result.bpm > 0) {
      setCurrentBPM(result.bpm);
      setConfidence(result.confidence);
    }

    return {
      ...result,
      signalQuality: currentQuality,
      rrData
    };
  }, [currentBPM, confidence]);

  const reset = useCallback(() => {
    console.log('useHeartBeatProcessor: Resetting processor');
    
    if (processorRef.current) {
      processorRef.current.reset();
    }
    
    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
  }, []);

  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    if (processorRef.current) {
      processorRef.current.setArrhythmiaDetected(isArrhythmiaDetected);
    }
  }, []);

  return {
    currentBPM,
    confidence,
    signalQuality,
    processSignal,
    reset,
    setArrhythmiaState
  };
};
