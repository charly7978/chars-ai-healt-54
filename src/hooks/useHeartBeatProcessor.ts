
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
 * HOOK COMPLETAMENTE UNIFICADO DE PROCESAMIENTO CARDÍACO - ELIMINADAS TODAS LAS DUPLICIDADES
 * Sistema matemático avanzado con algoritmos de detección de latidos de vanguardia
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);
  
  // CONTROL UNIFICADO DE ESTADO
  const sessionIdRef = useRef<string>("");
  const processingStateRef = useRef<'IDLE' | 'ACTIVE' | 'RESETTING'>('IDLE');
  const lastProcessTimeRef = useRef<number>(0);
  const processedSignalsRef = useRef<number>(0);

  // INICIALIZACIÓN UNIFICADA - UNA SOLA VEZ
  useEffect(() => {
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `hb_${t}_${p}`;
    
    processorRef.current = new HeartBeatProcessor();
    processingStateRef.current = 'ACTIVE';
    
    return () => {
      // CRÍTICO: Hacer reset antes de destruir para liberar memoria
      if (processorRef.current) {
        processorRef.current.reset();
        processorRef.current = null;
      }
      processingStateRef.current = 'IDLE';
    };
  }, []);

  // REFERENCIA PARA TRACKING DE ESTADO DEL DEDO
  const lastFingerStateRef = useRef<boolean>(false);

  // PROCESAMIENTO UNIFICADO DE SEÑAL
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
    
    // CONTROL DE TASA DE PROCESAMIENTO (~60 FPS)
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

    // SIMPLIFICADO: Ya no hacer debounce complejo
    // Simplemente pasar el estado del dedo al procesador
    // El procesador tiene su propia lógica de manejo
    
    // Solo notificar cambios reales de estado
    if (fingerDetected !== lastFingerStateRef.current) {
      processorRef.current.setFingerDetected(fingerDetected);
      lastFingerStateRef.current = fingerDetected;
    }

    // PROCESAR SEÑAL SIEMPRE - CRÍTICO para mantener continuidad
    const result = processorRef.current.processSignal(value, timestamp);
    const rrData = processorRef.current.getRRIntervals();
    const currentQuality = result.signalQuality || 0;
    
    setSignalQuality(currentQuality);

    // Si no hay dedo, degradar suavemente pero SEGUIR procesando
    if (!fingerDetected) {
      if (currentBPM > 0) {
        setCurrentBPM(prev => Math.max(0, prev * 0.98));
        setConfidence(prev => Math.max(0, prev * 0.95));
      }
      
      return {
        bpm: currentBPM,
        confidence: Math.max(0, confidence * 0.95),
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: currentQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    // ACTUALIZACIÓN DE BPM - MÁS PERMISIVA
    // Aceptar si: confianza >= 0.3 (antes 0.4) Y bpm en rango válido
    if (result.confidence >= 0.3 && result.bpm >= 40 && result.bpm <= 200) {
      const smoothingFactor = Math.min(0.5, result.confidence * 0.7);
      const newBPM = currentBPM > 0 ? 
        currentBPM * (1 - smoothingFactor) + result.bpm * smoothingFactor : 
        result.bpm;
      
      setCurrentBPM(Math.round(newBPM * 10) / 10);
      setConfidence(result.confidence);
    }

    return {
      ...result,
      bpm: currentBPM,
      confidence,
      signalQuality: currentQuality,
      rrData
    };
  }, [currentBPM, confidence, signalQuality]);

  // RESET UNIFICADO COMPLETAMENTE LIMPIO
  const reset = useCallback(() => {
    if (processingStateRef.current === 'RESETTING') return;
    
    processingStateRef.current = 'RESETTING';
    
    if (processorRef.current) {
      processorRef.current.reset();
    }
    
    // RESET COMPLETO DE TODOS LOS ESTADOS
    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
    
    // RESET DE CONTADORES INTERNOS
    lastProcessTimeRef.current = 0;
    processedSignalsRef.current = 0;
    
    processingStateRef.current = 'ACTIVE';
  }, []);

  // CONFIGURACIÓN UNIFICADA DE ESTADO DE ARRITMIA
  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    if (processorRef.current && processingStateRef.current === 'ACTIVE') {
      processorRef.current.setArrhythmiaDetected(isArrhythmiaDetected);
    }
  }, []);

  // RETORNO UNIFICADO DEL HOOK
  return {
    currentBPM,
    confidence,
    signalQuality,
    processSignal,
    reset,
    setArrhythmiaState,
    // DEBUG INFO
    debugInfo: {
      sessionId: sessionIdRef.current,
      processingState: processingStateRef.current,
      processedSignals: processedSignalsRef.current
    }
  };
};
