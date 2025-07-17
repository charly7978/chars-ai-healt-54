import { useState, useEffect, useCallback, useRef } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

interface HeartBeatResult {
  bpm: number;
  confidence: number;
  isPeak: boolean;
  filteredValue?: number;
  arrhythmiaCount: number;
  signalQuality?: number; // Nuevo campo para calidad de señal
  rrData?: {
    intervals: number[];
    lastPeakTime: number | null;
  };
}

export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0); // Estado para calidad de señal
  const sessionId = useRef<string>(Math.random().toString(36).substring(2, 9));
  // Variables para seguimiento de detección
  const detectionAttempts = useRef<number>(0);
  const lastDetectionTime = useRef<number>(Date.now());
  
  // Umbral de calidad mínima para procesar - muy reducido para mejorar detección inicial
  const MIN_QUALITY_THRESHOLD = 10; // Valor muy bajo para permitir detección inicial

  useEffect(() => {
    console.log('useHeartBeatProcessor: Creando nueva instancia de HeartBeatProcessor', {
      sessionId: sessionId.current,
      timestamp: new Date().toISOString()
    });
    
    processorRef.current = new HeartBeatProcessor();
    
    if (processorRef.current) {
      // El contexto de audio se inicializa automáticamente al procesar señales
      console.log('Audio listo para procesamiento');
    }

    return () => {
      console.log('useHeartBeatProcessor: Limpiando processor', {
        sessionId: sessionId.current,
        timestamp: new Date().toISOString()
      });
      
      if (processorRef.current) {
        processorRef.current = null;
      }
    };
  }, []);

  const processSignal = useCallback((value: number, fingerDetected: boolean = true): HeartBeatResult => {
    const now = Date.now();
    detectionAttempts.current++;
    
    // Inicialización de processor si no existe
    if (!processorRef.current) {
      console.warn('useHeartBeatProcessor: Processor no inicializado', {
        sessionId: sessionId.current,
        timestamp: new Date().toISOString()
      });
      
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: {
          intervals: [],
          lastPeakTime: null
        }
      };
    }

    // Procesar señal independientemente de estado de detección para entrenar algoritmos
    // Esto ayuda a los algoritmos adaptativos a ajustarse más rápido
    console.log('useHeartBeatProcessor - processSignal:', {
      inputValue: value,
      normalizadoValue: value.toFixed(2),
      fingerDetected,
      detectionAttempts: detectionAttempts.current,
      timeSinceLastDetection: now - lastDetectionTime.current,
      sessionId: sessionId.current,
      timestamp: new Date().toISOString()
    });

    const result = processorRef.current.processSignal(value);
    const rrData = processorRef.current.getRRIntervals();
    const currentQuality = result.signalQuality || 0;
    
    // Actualizar el estado de calidad de señal
    setSignalQuality(currentQuality);

    console.log('useHeartBeatProcessor - resultado:', {
      bpm: result.bpm,
      confidence: result.confidence,
      isPeak: result.isPeak,
      arrhythmiaCount: result.arrhythmiaCount,
      signalQuality: currentQuality,
      rrIntervals: JSON.stringify(rrData.intervals.slice(-5)),
      ultimoPico: rrData.lastPeakTime,
      tiempoDesdeUltimoPico: rrData.lastPeakTime ? Date.now() - rrData.lastPeakTime : null,
      sessionId: sessionId.current,
      timestamp: new Date().toISOString()
    });
    
    // Si no hay dedo detectado pero tenemos una señal de calidad razonable
    // consideramos que el dedo está presente (corrige falsos negativos)
    const effectiveFingerDetected = fingerDetected || (currentQuality > MIN_QUALITY_THRESHOLD && result.confidence > 0.3);
    
    // Si no hay dedo detectado efectivamente, reducir los valores
    if (!effectiveFingerDetected) {
      console.log('useHeartBeatProcessor: Dedo no detectado efectivamente', {
        fingerDetected,
        currentQuality,
        confidence: result.confidence,
        timestamp: new Date().toISOString()
      });
      
      // Reducir gradualmente los valores actuales en vez de resetearlos inmediatamente
      // Esto evita cambios bruscos en la UI
      if (currentBPM > 0) {
        const reducedBPM = Math.max(0, currentBPM - 5);
        const reducedConfidence = Math.max(0, confidence - 0.1);
        setCurrentBPM(reducedBPM);
        setConfidence(reducedConfidence);
      }
      
      return {
        bpm: currentBPM, // Mantener último valor conocido brevemente
        confidence: Math.max(0, confidence - 0.1), // Reducir gradualmente
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: currentQuality,
        rrData: {
          intervals: [],
          lastPeakTime: null
        }
      };
    }

    // Actualizar tiempo de última detección
    lastDetectionTime.current = now;
    
    // Si la confianza es suficiente, actualizar valores
    if (result.confidence >= 0.5 && result.bpm > 0) {
      console.log('useHeartBeatProcessor - Actualizando BPM y confianza', {
        prevBPM: currentBPM,
        newBPM: result.bpm,
        prevConfidence: confidence,
        newConfidence: result.confidence,
        sessionId: sessionId.current,
        timestamp: new Date().toISOString()
      });
      
      setCurrentBPM(result.bpm);
      setConfidence(result.confidence);
    }

    return {
      ...result,
      signalQuality: currentQuality,
      rrData
    };
  }, [currentBPM, confidence, signalQuality]);

  const reset = useCallback(() => {
    console.log('useHeartBeatProcessor: Reseteando processor', {
      sessionId: sessionId.current,
      prevBPM: currentBPM,
      prevConfidence: confidence,
      timestamp: new Date().toISOString()
    });
    
    if (processorRef.current) {
      processorRef.current.reset();
      console.log('useHeartBeatProcessor: Processor reseteado correctamente', {
        timestamp: new Date().toISOString()
      });
    } else {
      console.warn('useHeartBeatProcessor: No se pudo resetear - processor no existe', {
        timestamp: new Date().toISOString()
      });
    }
    
    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
    detectionAttempts.current = 0;
    lastDetectionTime.current = Date.now();
  }, [currentBPM, confidence]);

  // Aseguramos que setArrhythmiaState funcione correctamente
  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    console.log('useHeartBeatProcessor: Estableciendo estado de arritmia', {
      isArrhythmiaDetected,
      timestamp: new Date().toISOString()
    });
    
    if (processorRef.current) {
      processorRef.current.setArrhythmiaDetected(isArrhythmiaDetected);
    } else {
      console.warn('useHeartBeatProcessor: No se pudo establecer estado de arritmia - processor no existe');
    }
  }, []);

  return {
    currentBPM,
    confidence,
    signalQuality, // Exponiendo la calidad de señal
    processSignal,
    reset,
    setArrhythmiaState
  };
};
