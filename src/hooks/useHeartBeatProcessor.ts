
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
    // GENERAR SESSION ID sin aleatoriedad
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `heartbeat_${t}_${p}`;

    console.log(`💓 CREANDO PROCESADOR CARDÍACO UNIFICADO - ${sessionIdRef.current}`);
    
    processorRef.current = new HeartBeatProcessor();
    processingStateRef.current = 'ACTIVE';
    
    return () => {
      console.log(`💓 DESTRUYENDO PROCESADOR CARDÍACO - ${sessionIdRef.current}`);
      if (processorRef.current) {
        processorRef.current = null;
      }
      processingStateRef.current = 'IDLE';
    };
  }, []);

  // REFERENCIA PARA TRACKING DE ESTADO DEL DEDO
  const lastFingerStateRef = useRef<boolean>(false);

  // PROCESAMIENTO UNIFICADO DE SEÑAL - ELIMINADAS DUPLICIDADES
  const processSignal = useCallback((value: number, fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      const fallbackBPM = Math.round(
        (processorRef.current && typeof (processorRef.current as any).getSmoothBPM === 'function')
          ? (processorRef.current as any).getSmoothBPM()
          : 0
      );
      return {
        bpm: fallbackBPM,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    const currentTime = Date.now();
    
    // CONTROL DE TASA DE PROCESAMIENTO PARA EVITAR SOBRECARGA
    if (currentTime - lastProcessTimeRef.current < 16) { // ~60 FPS máximo
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

    // CRÍTICO: Notificar cambio de estado del dedo para reset inteligente
    if (fingerDetected !== lastFingerStateRef.current) {
      processorRef.current.setFingerDetected(fingerDetected);
      lastFingerStateRef.current = fingerDetected;
    }

    // PROCESAMIENTO MATEMÁTICO AVANZADO DIRECTO
    const result = processorRef.current.processSignal(value, timestamp);
    const rrData = processorRef.current.getRRIntervals();
    const currentQuality = result.signalQuality || 0;
    
    setSignalQuality(currentQuality);

    // LÓGICA UNIFICADA DE DETECCIÓN - MÁS PERMISIVA
    const effectiveFingerDetected = fingerDetected || (currentQuality > 15 && result.confidence > 0.35);
    
    if (!effectiveFingerDetected) {
      // DEGRADACIÓN SUAVE Y CONTROLADA
      if (currentBPM > 0) {
        const newBPM = Math.max(0, currentBPM * 0.96); // Degradación más suave
        const newConfidence = Math.max(0, confidence * 0.92);
        
        setCurrentBPM(newBPM);
        setConfidence(newConfidence);
      }
      
      return {
        bpm: currentBPM,
        confidence: Math.max(0, confidence * 0.92),
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: currentQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    // ACTUALIZACIÓN CON CONFIANZA VALIDADA - CORREGIDO PARA INICIALIZACIÓN
    // Antes: requería result.bpm > 0, pero al inicio siempre es 0
    if (result.confidence >= 0.4 && result.bpm >= 40 && result.bpm <= 200) {
      // FILTRADO ADAPTATIVO PARA ESTABILIDAD
      const smoothingFactor = Math.min(0.4, result.confidence * 0.6);
      const newBPM = currentBPM > 0 ? 
        currentBPM * (1 - smoothingFactor) + result.bpm * smoothingFactor : 
        result.bpm; // Si currentBPM es 0, tomar directamente el nuevo valor
      
      setCurrentBPM(Math.round(newBPM * 10) / 10);
      setConfidence(result.confidence);
      
      // LOG CADA 50 SEÑALES PARA DEBUG
      if (processedSignalsRef.current % 50 === 0) {
        console.log(`💓 BPM: ${newBPM.toFixed(1)} (conf: ${result.confidence.toFixed(2)}, quality: ${currentQuality}) - ${sessionIdRef.current}`);
      }
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
    console.log(`🔄 RESET COMPLETO PROCESADOR CARDÍACO - ${sessionIdRef.current}`);
    
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
    console.log(`✅ Reset cardíaco completado - ${sessionIdRef.current}`);
  }, []);

  // CONFIGURACIÓN UNIFICADA DE ESTADO DE ARRITMIA
  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    if (processorRef.current && processingStateRef.current === 'ACTIVE') {
      processorRef.current.setArrhythmiaDetected(isArrhythmiaDetected);
      
      if (isArrhythmiaDetected) {
        console.log(`⚠️ Arritmia activada en procesador - ${sessionIdRef.current}`);
      }
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
