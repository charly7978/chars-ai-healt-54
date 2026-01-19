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
  const lastProcessTimeRef = useRef<number>(0);
  const processedSignalsRef = useRef<number>(0);

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

  const processSignal = useCallback((value: number, _fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      return {
        bpm: currentBPM,
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    const currentTime = Date.now();
    
    // Control de tasa (~60 FPS)
    if (currentTime - lastProcessTimeRef.current < 16) {
      return {
        bpm: currentBPM,
        confidence,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0,
        signalQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }
    
    lastProcessTimeRef.current = currentTime;
    processedSignalsRef.current++;

    // Procesar señal directamente - la validación de dedo está en HeartBeatProcessor
    const result = processorRef.current.processSignal(value, timestamp);
    const rrIntervals = processorRef.current.getRRIntervals();
    const lastPeakTime = processorRef.current.getLastPeakTime();
    const rrData = { intervals: rrIntervals, lastPeakTime };
    
    // Actualizar BPM si hay confianza suficiente
    if (result.confidence >= 0.3 && result.bpm > 0) {
      const smoothingFactor = Math.min(0.5, result.confidence * 0.7);
      const newBPM = currentBPM > 0 ? 
        currentBPM * (1 - smoothingFactor) + result.bpm * smoothingFactor : 
        result.bpm;
      
      // Guardar como entero
      setCurrentBPM(Math.round(newBPM));
      setConfidence(result.confidence);
    }

    // Retornar BPM redondeado a entero
    return {
      bpm: Math.round(result.bpm),
      confidence: result.confidence,
      isPeak: result.isPeak,
      filteredValue: result.filteredValue,
      arrhythmiaCount: result.arrhythmiaCount,
      signalQuality: signalQuality,
      rrData
    };
  }, [currentBPM, confidence, signalQuality]);

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
