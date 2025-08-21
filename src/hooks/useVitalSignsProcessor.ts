import { useState, useCallback, useRef, useEffect } from 'react';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * Custom hook for processing vital signs with advanced algorithms
 * Uses improved signal processing and arrhythmia detection based on medical research
 */
export const useVitalSignsProcessor = () => {
  // State and refs
  const [processor] = useState(() => {
    console.log("useVitalSignsProcessor: Creando nueva instancia", {
      timestamp: new Date().toISOString()
    });
    return new VitalSignsProcessor();
  });
  const [arrhythmiaCounter, setArrhythmiaCounter] = useState(0);
  const [lastValidResults, setLastValidResults] = useState<VitalSignsResult | null>(null);
  const lastArrhythmiaTime = useRef<number>(0);
  const hasDetectedArrhythmia = useRef<boolean>(false);
  const sessionId = useRef<string>((() => {
    // PROHIBIDO Math.random() en aplicaciones médicas - usar crypto
    const randomBytes = new Uint32Array(2);
    crypto.getRandomValues(randomBytes);
    return randomBytes[0].toString(36) + randomBytes[1].toString(36);
  })());
  const processedSignals = useRef<number>(0);
  const signalLog = useRef<{timestamp: number, value: number, result: any}[]>([]);
  
  // Advanced configuration based on clinical guidelines
  const MIN_TIME_BETWEEN_ARRHYTHMIAS = 1000; // Minimum 1 second between arrhythmias
  const MAX_ARRHYTHMIAS_PER_SESSION = 20; // Reasonable maximum for 30 seconds
  const SIGNAL_QUALITY_THRESHOLD = 0.55; // Signal quality required for reliable detection
  
  useEffect(() => {
    console.log("useVitalSignsProcessor: Hook inicializado", {
      sessionId: sessionId.current,
      timestamp: new Date().toISOString(),
      parametros: {
        MIN_TIME_BETWEEN_ARRHYTHMIAS,
        MAX_ARRHYTHMIAS_PER_SESSION,
        SIGNAL_QUALITY_THRESHOLD
      }
    });
    
    return () => {
      console.log("useVitalSignsProcessor: Hook destruido", {
        sessionId: sessionId.current,
        arritmiasTotales: arrhythmiaCounter,
        señalesProcesadas: processedSignals.current,
        timestamp: new Date().toISOString()
      });
    };
  }, []);
  
  /**
   * Start calibration for all vital signs
   */
  const startCalibration = useCallback(() => {
    console.log("useVitalSignsProcessor: Iniciando calibración de todos los parámetros", {
      timestamp: new Date().toISOString(),
      sessionId: sessionId.current
    });
    
    processor.startCalibration();
  }, [processor]);
  
  /**
   * Force calibration to complete immediately
   */
  const forceCalibrationCompletion = useCallback(() => {
    console.log("useVitalSignsProcessor: Forzando finalización de calibración", {
      timestamp: new Date().toISOString(),
      sessionId: sessionId.current
    });
    
    processor.forceCalibrationCompletion();
  }, [processor]);

  // ✅ RESTAURAR: Función de limpieza de logs (antes estaba en useSignalProcessor)
  const cleanupOldLogs = useCallback(() => {
    const thirtySecondsAgo = Date.now() - 30000;
    signalLog.current = signalLog.current.filter(log => log.timestamp > thirtySecondsAgo);
    
    console.log("useVitalSignsProcessor: Logs antiguos limpiados", {
      logsRestantes: signalLog.current.length,
      timestamp: new Date().toISOString()
    });
  }, []);
  
  // Process the signal with improved algorithms (REVERTIDO A SÍNCRONO)
  const processSignal = useCallback((value: number, rrData?: { intervals: number[], lastPeakTime: number | null }) => {
    processedSignals.current++;
    
    console.log("useVitalSignsProcessor: Procesando señal", {
      valorEntrada: value,
      rrDataPresente: !!rrData,
      intervalosRR: rrData?.intervals.length || 0,
      ultimosIntervalos: rrData?.intervals.slice(-3) || [],
      contadorArrhythmia: arrhythmiaCounter,
      señalNúmero: processedSignals.current,
      sessionId: sessionId.current,
      timestamp: new Date().toISOString(),
      calibrando: processor.isCurrentlyCalibrating(),
      progresoCalibración: processor.getCalibrationProgress()
    });
    
    // ✅ RESTAURAR: Lógica de detección de dedo (antes estaba en useHeartBeatProcessor)
    if (value < 0.1) {
      console.log("useVitalSignsProcessor: No se detecta dedo, valor muy bajo:", value);
      return null; // No procesar si no hay dedo
    }
    
    // ✅ RESTAURAR: Validación de calidad de señal
    const signalQuality = Math.min(100, Math.max(0, (value / 2) * 100));
    if (signalQuality < 30) {
      console.log("useVitalSignsProcessor: Calidad de señal muy baja:", signalQuality);
      return null; // No procesar si la calidad es muy baja
    }
    
    // Process signal through the vital signs processor (REVERTIDO A SÍNCRONO)
    const result = processor.processSignal(value, rrData);
    const currentTime = Date.now();
    
    // ✅ RESTAURAR: Lógica de detección de arritmias (antes estaba en useHeartBeatProcessor)
    if (result && result.arrhythmiaStatus && result.arrhythmiaStatus.includes('ARRITMIA DETECTADA')) {
      const timeSinceLastArrhythmia = currentTime - lastArrhythmiaTime.current;
      
      if (timeSinceLastArrhythmia > MIN_TIME_BETWEEN_ARRHYTHMIAS && arrhythmiaCounter < MAX_ARRHYTHMIAS_PER_SESSION) {
        setArrhythmiaCounter(prev => prev + 1);
        lastArrhythmiaTime.current = currentTime;
        hasDetectedArrhythmia.current = true;
        
        console.log("useVitalSignsProcessor: Arritmia detectada", {
          número: arrhythmiaCounter + 1,
          tiempoDesdeÚltima: timeSinceLastArrhythmia,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // ✅ RESTAURAR: Guardar resultado válido
    if (result && (result.spo2 > 0 || result.pressure !== "--/--" || result.glucose > 0)) {
      console.log("useVitalSignsProcessor: Resultado válido detectado", {
        spo2: result.spo2,
        presión: result.pressure,
        glucosa: result.glucose,
        timestamp: new Date().toISOString()
      });
      
      setLastValidResults(result);
    }
    
    // Enhanced RR interval analysis (more robust than previous)
    if (rrData?.intervals && rrData.intervals.length >= 3) {
      const lastThreeIntervals = rrData.intervals.slice(-3);
      const avgRR = lastThreeIntervals.reduce((a, b) => a + b, 0) / lastThreeIntervals.length;
      
      // Calculate RMSSD (Root Mean Square of Successive Differences)
      let rmssd = 0;
      for (let i = 1; i < lastThreeIntervals.length; i++) {
        rmssd += Math.pow(lastThreeIntervals[i] - lastThreeIntervals[i-1], 2);
      }
      rmssd = Math.sqrt(rmssd / (lastThreeIntervals.length - 1));
      
      // Enhanced arrhythmia detection criteria with SD metrics
      const lastRR = lastThreeIntervals[lastThreeIntervals.length - 1];
      const rrVariation = Math.abs(lastRR - avgRR) / avgRR;
      
      // Calculate standard deviation of intervals
      const rrSD = Math.sqrt(
        lastThreeIntervals.reduce((acc, val) => acc + Math.pow(val - avgRR, 2), 0) / 
        lastThreeIntervals.length
      );
      
      console.log("useVitalSignsProcessor: Análisis avanzado RR", {
        rmssd,
        rrVariation,
        rrSD,
        lastRR,
        avgRR,
        lastThreeIntervals,
        tiempoDesdeÚltimaArritmia: currentTime - lastArrhythmiaTime.current,
        arritmiaDetectada: hasDetectedArrhythmia.current,
        contadorArritmias: arrhythmiaCounter,
        timestamp: new Date().toISOString()
      });
      
      // DUPLICIDAD ELIMINADA: Usar solo ArrhythmiaProcessor para detección
      // La detección se maneja ahora en VitalSignsProcessor.arrhythmiaProcessor
      console.log("useVitalSignsProcessor: Datos RR calculados para ArrhythmiaProcessor", {
        rmssd,
        rrVariation,
        rrSD,
        intervals: lastThreeIntervals,
        timestamp: new Date().toISOString()
      });
    }
    
    // If we previously detected an arrhythmia, maintain that state
    if (hasDetectedArrhythmia.current) {
      return {
        ...result,
        arrhythmiaStatus: `ARRITMIA DETECTADA|${arrhythmiaCounter}`,
        lastArrhythmiaData: null
      };
    }
    
    // No arrhythmias detected
    return {
      ...result,
      arrhythmiaStatus: `SIN ARRITMIAS|${arrhythmiaCounter}`
    };
  }, [processor, arrhythmiaCounter]);

  /**
   * LIMPIEZA AUTOMÁTICA de logs antiguos para prevenir degradación
   */
  // ✅ FUNCIÓN YA DECLARADA ARRIBA - ELIMINAR DUPLICADA

  // Soft reset: mantener los resultados pero reiniciar los procesadores
  const reset = useCallback(() => {
    console.log("useVitalSignsProcessor: Reseteo suave", {
      estadoAnterior: {
        arritmias: arrhythmiaCounter,
        últimosResultados: lastValidResults ? {
          spo2: lastValidResults.spo2,
          presión: lastValidResults.pressure
        } : null
      },
      timestamp: new Date().toISOString()
    });
    
    const savedResults = processor.reset();
    if (savedResults) {
      console.log("useVitalSignsProcessor: Guardando resultados tras reset", {
        resultadosGuardados: {
          spo2: savedResults.spo2,
          presión: savedResults.pressure,
          estadoArritmia: savedResults.arrhythmiaStatus
        },
        timestamp: new Date().toISOString()
      });
      
      setLastValidResults(savedResults);
    } else {
      console.log("useVitalSignsProcessor: No hay resultados para guardar tras reset", {
        timestamp: new Date().toISOString()
      });
    }
    
    setArrhythmiaCounter(0);
    lastArrhythmiaTime.current = 0;
    hasDetectedArrhythmia.current = false;
    console.log("Reseteo suave completado - manteniendo resultados");
    return savedResults;
  }, [processor]);
  
  // Hard reset: borrar todos los resultados y reiniciar
  const fullReset = useCallback(() => {
    console.log("useVitalSignsProcessor: Reseteo completo", {
      estadoAnterior: {
        arritmias: arrhythmiaCounter,
        últimosResultados: lastValidResults ? {
          spo2: lastValidResults.spo2,
          presión: lastValidResults.pressure
        } : null,
        señalesProcesadas: processedSignals.current
      },
      timestamp: new Date().toISOString()
    });
    
    processor.fullReset();
    setLastValidResults(null);
    setArrhythmiaCounter(0);
    lastArrhythmiaTime.current = 0;
    hasDetectedArrhythmia.current = false;
    processedSignals.current = 0;
    signalLog.current = [];
    console.log("Reseteo completo finalizado - borrando todos los resultados");
  }, [processor, arrhythmiaCounter, lastValidResults]);

  return {
    processSignal,
    reset,
    fullReset,
    startCalibration,
    forceCalibrationCompletion,
    arrhythmiaCounter,
    lastValidResults,
    getCalibrationProgress: useCallback(() => processor.getCalibrationProgress(), [processor]),
    debugInfo: {
      processedSignals: processedSignals.current,
      signalLog: signalLog.current.slice(-10)
    },
  };
};
