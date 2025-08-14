import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { PPGSignalProcessor } from '../modules/SignalProcessor';
import { 
  ProcessedSignal, 
  ProcessingError, 
  SignalStats, 
  QualityTransition, 
  PPGProcessorCallbacks,
  PPGProcessorOptions,
  SignalProcessorState,
  ErrorType
} from '../types/signal';
import { validatePPGSignal, analyzeSpectralFeatures } from '@/utils/signalValidation';

// Constantes de configuración
const SIGNAL_HISTORY_LIMIT = 100;
const MAX_SUSPICIOUS_SIGNALS = 10;
const ERROR_RATE_THRESHOLD = 5;
const ERROR_RATE_WINDOW_MS = 10000;

// Los tipos se han movido a src/types/signal.ts

// Interfaz para el retorno del hook
export interface UseSignalProcessorReturn {
  lastSignal: ProcessedSignal | null;
  signalStats: SignalStats;
  error: ProcessingError | null;
  isProcessing: boolean;
  framesProcessed: number;
  startProcessing: () => void;
  stopProcessing: () => void;
  resetProcessor: () => void;
  processSignal: (signal: ProcessedSignal) => void;
}

/**
 * Custom hook for managing PPG signal processing
 */
export const useSignalProcessor = (): UseSignalProcessorReturn => {
  // Referencias
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const signalHistoryRef = useRef<ProcessedSignal[]>([]);
  const qualityTransitionsRef = useRef<QualityTransition[]>([]);
  const calibrationInProgressRef = useRef(false);
  const errorCountRef = useRef(0);
  const lastErrorTimeRef = useRef(0);
  const lastLogTimeRef = useRef(0);
  const lastValidSignalRef = useRef<ProcessedSignal | null>(null);
  const suspiciousSignalCount = useRef(0);
  const lastSignalTimestamp = useRef(0);
  
  // Estados
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [lastError, setLastError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [signalStats, setSignalStats] = useState<SignalStats>({
    minValue: Infinity,
    maxValue: -Infinity,
    avgValue: 0,
    totalValues: 0,
    lastQualityUpdateTime: 0
  });

  // Validar señal con todas las comprobaciones
  const validateSignal = useCallback((signal: ProcessedSignal): { isValid: boolean; reason?: string } => {
    const now = Date.now();
    
    // 1. Validación básica de señal
    const validation = validatePPGSignal(signal, lastSignalTimestamp.current);
    if (!validation.isValid) {
      const errorMsg = `Señal inválida: ${validation.reason}`;
      console.warn(errorMsg, signal);
      
      // Registrar el error
      updateState({
        lastError: {
          message: validation.reason || 'Error de validación de señal',
          timestamp: now,
          type: 'VALIDATION_ERROR' as ErrorType,
          details: signal
        }
      });
      
      return { isValid: false, reason: validation.reason };
    }
    
    // 2. Análisis espectral para detectar patrones sospechosos
    const spectralAnalysis = analyzeSpectralFeatures([...signalHistory, signal]);
    if (spectralAnalysis.isSuspicious) {
      suspiciousSignalCount.current++;
      const warningMsg = `Señal sospechosa (${suspiciousSignalCount.current}): ${spectralAnalysis.reason}`;
      console.warn(warningMsg);
      
      // Si detectamos muchas señales sospechosas, forzar recalibración
      if (suspiciousSignalCount.current > MAX_SUSPICIOUS_SIGNALS) {
        const errorMsg = "Demasiadas señales sospechosas. Se requiere recalibración.";
        console.error(errorMsg);
        
        updateState({
          lastError: {
            message: "Calidad de señal insuficiente. Por favor, recoloca tu dedo.",
            timestamp: now,
            type: "VALIDATION_ERROR",
            details: {
              reason: spectralAnalysis.reason,
              signalHistory: signalHistory.length,
              suspiciousCount: suspiciousSignalCount.current
            }
          }
        });
        
        return { isValid: false, reason: errorMsg };
      }
      
      return { 
        isValid: false, 
        reason: `Señal sospechosa: ${spectralAnalysis.reason}` 
      };
    }
    
    // Restablecer contador de señales sospechosas si la señal es válida
    if (suspiciousSignalCount.current > 0) {
      console.log(`Señal validada correctamente. Restableciendo contador de señales sospechosas.`);
      suspiciousSignalCount.current = 0;
    }
    
    // Actualizar timestamp de la última señal válida
    lastSignalTimestamp.current = now;
    
    return { isValid: true };
  }, [signalHistory, updateState]);

  // Procesamiento de señal mejorado
  const processSignal = useCallback((signal: ProcessedSignal): void => {
    const now = Date.now();
    
    // Validar señal
    const validation = validateSignal(signal);
    if (!validation.isValid) {
      return;
    }
    
    try {
      // Actualizar historial de señales
      const newSignalHistory = [...signalHistory, signal].slice(-SIGNAL_HISTORY_LIMIT);
      
      // Calcular nuevas estadísticas
      const newTotal = signalStats.totalValues + 1;
      const newAvg = (signalStats.avgValue * signalStats.totalValues + signal.filteredValue) / newTotal;
      
      // Detectar transiciones de calidad
      let newQualityTransitions = [...qualityTransitions];
      if (signalHistory.length > 1) {
        const prevSignal = signalHistory[signalHistory.length - 1];
        if (Math.abs(prevSignal.quality - signal.quality) > 15) {
          const transition: QualityTransition = {
            time: now,
            from: prevSignal.quality,
            to: signal.quality
          };
          newQualityTransitions = [...qualityTransitions, transition].slice(-20);
        }
      }
      
      // Actualizar estado de manera atómica
      updateState({
        stats: {
          minValue: Math.min(signalStats.minValue, signal.filteredValue),
          maxValue: Math.max(signalStats.maxValue, signal.filteredValue),
          avgValue: newAvg,
          totalValues: newTotal,
          lastQualityUpdateTime: now
        },
        signalHistory: newSignalHistory,
        qualityTransitions: newQualityTransitions
      });
      
      // Actualizar contador de frames procesados
      setFramesProcessed(prev => prev + 1);
      
      // Log detallado para diagnóstico (cada 5 segundos)
      if (now - lastLogTimeRef.current > 5000) {
        console.debug("Procesamiento de señal:", {
          timestamp: new Date(signal.timestamp).toISOString(),
          quality: signal.quality,
          value: signal.filteredValue,
          stats: signalStats,
          historyLength: newSignalHistory.length
        });
        
        lastLogTimeRef.current = now;
      }
      
    } catch (error) {
      console.error("Error en el procesamiento de señal:", error);
      
      updateState({
        lastError: {
          message: "Error al procesar la señal",
          timestamp: now,
          type: "PROCESSOR_ERROR",
          details: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }, [signalHistory, signalStats, qualityTransitions, updateState, validateSignal]);

  // Callback para señales listas
  const onSignalReady = useCallback((signal: ProcessedSignal) => {
    processSignal(signal);
  }, [processSignal]);

  // Inicialización del procesador
  useEffect(() => {
    const sessionId = Math.random().toString(36).substring(2, 9);
    const initTimestamp = new Date().toISOString();
    
    console.log("useSignalProcessor: Inicializando procesador de señales", {
      timestamp: initTimestamp,
      sessionId
    });
    
    // Función para manejar errores del procesador
    const handleProcessorError = (error: Error) => {
      console.error("Error en el procesador de señal:", error);
      
      // Incrementar contador de errores y manejar según la frecuencia
      errorCountRef.current++;
      const now = Date.now();
      const timeSinceLastError = now - lastErrorTimeRef.current;
      lastErrorTimeRef.current = now;
      
      // Si hay demasiados errores en poco tiempo, detener el procesamiento
      if (errorCountRef.current > ERROR_RATE_THRESHOLD && timeSinceLastError < ERROR_RATE_WINDOW_MS) {
        console.error("Demasiados errores en poco tiempo. Deteniendo procesamiento.");
        
        updateState({
          isProcessing: false,
          lastError: {
            message: "Error crítico. Reiniciando procesador...",
            timestamp: now,
            type: "PROCESSOR_ERROR",
            details: {
              errorCount: errorCountRef.current,
              timeSinceLastError,
              errorMessage: error.message
            }
          }
        });
        
        // Resetear contador después de un tiempo
        setTimeout(() => {
          errorCountRef.current = 0;
        }, 60000);
      }
    };
    
    // Función para manejar cambios en el estado de procesamiento
    const handleProcessingStateChange = (isRunning: boolean) => {
      console.log(`Estado del procesamiento: ${isRunning ? 'Iniciado' : 'Detenido'}`);
      
      updateState({
        isProcessing: isRunning,
        ...(isRunning ? {
          // Resetear solo cuando se inicia el procesamiento
          stats: {
            minValue: Infinity,
            maxValue: -Infinity,
            avgValue: 0,
            totalValues: 0,
            lastQualityUpdateTime: Date.now()
          },
          signalHistory: [],
          qualityTransitions: []
        } : {})
      });
      
      if (isRunning) {
        setFramesProcessed(0);
        suspiciousSignalCount.current = 0;
      }
    };
    
    try {
      // Configuración del procesador
      const options: PPGProcessorOptions = {
        sampleRate: 30, // 30 FPS por defecto
        minQualityThreshold: 30, // Calidad mínima aceptable
        maxQualityThreshold: 95  // Calidad máxima esperada (para detectar ruido)
      };
      
      // Inicializar el procesador con los callbacks necesarios
      const callbacks: PPGProcessorCallbacks = {
        onSignalReady,
        onError: handleProcessorError,
        onProcessingStateChange: handleProcessingStateChange
      };
      
      // Crear instancia del procesador
      processorRef.current = new PPGSignalProcessor(callbacks, options);
      
      console.log("Procesador de señales inicializado correctamente", {
        timestamp: initTimestamp,
        sessionId,
        options
      });
      
    } catch (initError) {
      console.error("Error al inicializar el procesador de señales:", initError);
      
      updateState({
        isProcessing: false,
        lastError: {
          message: "Error al inicializar el procesador",
          timestamp: Date.now(),
          type: "PROCESSOR_ERROR",
          details: initError instanceof Error ? initError.message : String(initError)
        }
      });
    }
    
    // Función de limpieza
    return () => {
      console.log("Limpiando procesador de señales");
      
      if (processorRef.current) {
        try {
          // @ts-ignore - Verificar si existe el método de limpieza
          const cleanupFn = processorRef.current.cleanup || processorRef.current.stop || processorRef.current.dispose;
          if (typeof cleanupFn === 'function') {
            cleanupFn.call(processorRef.current);
          }
        } catch (cleanupError) {
          console.error("Error al limpiar el procesador:", cleanupError);
        }
        
        processorRef.current = null;
      }
    };
  }, [onSignalReady, updateState]);

  // Métodos para controlar el procesamiento
  const startProcessing = useCallback(() => {
    if (processorRef.current && !isProcessing) {
      try {
        // @ts-ignore - Verificar si existe el método start
        if (typeof processorRef.current.start === 'function') {
          processorRef.current.start();
        }
        updateState({ isProcessing: true });
      } catch (error) {
        console.error("Error al iniciar el procesamiento:", error);
        updateState({
          isProcessing: false,
          lastError: {
            message: "Error al iniciar el procesamiento",
            timestamp: Date.now(),
            type: "PROCESSOR_ERROR",
            details: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  }, [isProcessing, updateState]);
  
  const stopProcessing = useCallback(() => {
    if (processorRef.current && isProcessing) {
      try {
        // @ts-ignore - Verificar si existe el método stop
        if (typeof processorRef.current.stop === 'function') {
          processorRef.current.stop();
        }
        updateState({ isProcessing: false });
      } catch (error) {
        console.error("Error al detener el procesamiento:", error);
        updateState({
          lastError: {
            message: "Error al detener el procesamiento",
            timestamp: Date.now(),
            type: "PROCESSOR_ERROR",
            details: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  }, [isProcessing, updateState]);
  
  // Valor de retorno del hook
  return useMemo(() => ({
    lastSignal,
    signalStats,
    error: lastError,
    isProcessing,
    framesProcessed,
    startProcessing,
    stopProcessing,
    resetProcessor: resetProcessorState,
    processSignal
  }), [
    lastSignal,
    signalStats,
    lastError,
    isProcessing,
    framesProcessed,
    startProcessing,
    stopProcessing,
    resetProcessorState,
    processSignal
  ]);
  };
};
