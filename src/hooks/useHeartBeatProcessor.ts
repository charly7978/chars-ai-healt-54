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
 * HOOK DE PROCESAMIENTO CARDÍACO - MEDICIÓN REAL
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);
  
  // Control de estado
  const sessionIdRef = useRef<string>("");
  const processingStateRef = useRef<'IDLE' | 'ACTIVE' | 'RESETTING'>('IDLE');
  const lastProcessTimeRef = useRef<number>(0);
  const processedSignalsRef = useRef<number>(0);
  
  // Buffer para cálculo de calidad
  const signalBufferRef = useRef<number[]>([]);

  // Inicialización única
  useEffect(() => {
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `heartbeat_${t}_${p}`;

    console.log(`💓 CREANDO PROCESADOR CARDÍACO - ${sessionIdRef.current}`);
    
    processorRef.current = new HeartBeatProcessor();
    processingStateRef.current = 'ACTIVE';
    
    return () => {
      console.log(`💓 DESTRUYENDO PROCESADOR CARDÍACO - ${sessionIdRef.current}`);
      processorRef.current = null;
      processingStateRef.current = 'IDLE';
    };
  }, []);

  // Calcular calidad de señal
  const calculateQuality = useCallback((value: number): number => {
    signalBufferRef.current.push(value);
    if (signalBufferRef.current.length > 30) {
      signalBufferRef.current.shift();
    }
    
    if (signalBufferRef.current.length < 10) return 0;
    
    const buffer = signalBufferRef.current;
    const mean = buffer.reduce((a, b) => a + b, 0) / buffer.length;
    const variance = buffer.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / buffer.length;
    const amplitude = Math.max(...buffer) - Math.min(...buffer);
    
    // SNR aproximado
    const snr = amplitude > 0 ? 10 * Math.log10(amplitude / Math.sqrt(variance + 0.001)) : 0;
    return Math.max(0, Math.min(100, snr * 8));
  }, []);

  // Procesamiento de señal
  const processSignal = useCallback((value: number, fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      return {
        bpm: currentBPM,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    const currentTime = Date.now();
    
    // Control de tasa de procesamiento (60 FPS máx)
    if (currentTime - lastProcessTimeRef.current < 16) {
      return {
        bpm: currentBPM,
        confidence,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }
    
    lastProcessTimeRef.current = currentTime;
    processedSignalsRef.current++;

    // Calcular calidad de la señal
    const quality = calculateQuality(value);
    setSignalQuality(quality);
    
    // Procesar señal para obtener BPM
    const bpm = processorRef.current.processSignal(value, timestamp || currentTime);
    const rrIntervals = processorRef.current.getRRIntervals();
    
    // Detectar si hubo un pico (latido)
    const isPeak = bpm > 0 && bpm !== currentBPM;
    
    // Calcular confianza basada en calidad y estabilidad
    const newConfidence = quality > 50 ? Math.min(1, quality / 100 + 0.2) : quality / 100;
    
    if (!fingerDetected) {
      // Degradación suave cuando no hay dedo
      if (currentBPM > 0) {
        setCurrentBPM(prev => Math.max(0, prev * 0.96));
        setConfidence(prev => Math.max(0, prev * 0.92));
      }
      
      return {
        bpm: currentBPM,
        confidence: Math.max(0, confidence * 0.92),
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: quality,
        rrData: { intervals: rrIntervals, lastPeakTime: null }
      };
    }

    // Actualizar BPM con filtro de estabilidad
    if (bpm > 0 && bpm >= 40 && bpm <= 200) {
      const smoothingFactor = Math.min(0.3, newConfidence * 0.5);
      const smoothedBPM = currentBPM > 0 
        ? currentBPM * (1 - smoothingFactor) + bpm * smoothingFactor 
        : bpm;
      
      setCurrentBPM(Math.round(smoothedBPM));
      setConfidence(newConfidence);
    }

    return {
      bpm: currentBPM,
      confidence: newConfidence,
      isPeak,
      arrhythmiaCount: 0,
      signalQuality: quality,
      rrData: { 
        intervals: rrIntervals, 
        lastPeakTime: rrIntervals.length > 0 ? currentTime : null 
      }
    };
  }, [currentBPM, confidence, signalQuality, calculateQuality]);

  // Reset
  const reset = useCallback(() => {
    if (processingStateRef.current === 'RESETTING') return;
    
    processingStateRef.current = 'RESETTING';
    
    if (processorRef.current) {
      processorRef.current.reset();
    }
    
    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
    signalBufferRef.current = [];
    lastProcessTimeRef.current = 0;
    processedSignalsRef.current = 0;
    
    processingStateRef.current = 'ACTIVE';
  }, []);

  // Estado de arritmia (para compatibilidad)
  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    // Método de compatibilidad - la arritmia se detecta en VitalSignsProcessor
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
