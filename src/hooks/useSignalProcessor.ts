import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { PPGSignalProcessor } from '../modules/SignalProcessor';
import { 
  ProcessedSignal, 
  ProcessingError, 
  SignalStats, 
  PPGProcessorCallbacks,
  PPGProcessorOptions,
  ErrorType
} from '../types/signal';
import { validatePPGSignal, analyzeSpectralFeatures } from '@/utils/signalValidation';

// Constantes de configuración
const SIGNAL_HISTORY_LIMIT = 100;
const MAX_SUSPICIOUS_SIGNALS = 10;
const ERROR_RATE_THRESHOLD = 5;
const ERROR_RATE_WINDOW_MS = 10000;

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
  processor: PPGSignalProcessor | null;
}

/**
 * Custom hook for managing PPG signal processing
 */
export const useSignalProcessor = (): UseSignalProcessorReturn => {
  // Referencias
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const signalHistoryRef = useRef<ProcessedSignal[]>([]);
  const errorCountRef = useRef(0);
  const lastErrorTimeRef = useRef(0);
  const lastLogTimeRef = useRef(0);
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

  const resetProcessorState = useCallback(() => {
    setIsProcessing(false);
    setLastSignal(null);
    setLastError(null);
    setFramesProcessed(0);
    setSignalStats({
      minValue: Infinity,
      maxValue: -Infinity,
      avgValue: 0,
      totalValues: 0,
      lastQualityUpdateTime: 0
    });
    signalHistoryRef.current = [];
    errorCountRef.current = 0;
    suspiciousSignalCount.current = 0;
    lastSignalTimestamp.current = 0;
    processorRef.current?.stop();
  }, []);

  // Validar señal con todas las comprobaciones
  const validateSignal = useCallback((signal: ProcessedSignal): { isValid: boolean; reason?: string } => {
    const now = Date.now();
    
    const validation = validatePPGSignal(signal, lastSignalTimestamp.current);
    if (!validation.isValid) {
      const errorMsg = `Señal inválida: ${validation.reason}`;
      console.warn(errorMsg, signal);
      setLastError({
          message: validation.reason || 'Error de validación de señal',
          timestamp: now,
          type: 'VALIDATION_ERROR' as ErrorType,
          details: signal
      });
      return { isValid: false, reason: validation.reason };
    }
    
    const spectralAnalysis = analyzeSpectralFeatures([...signalHistoryRef.current, signal]);
    if (spectralAnalysis.isSuspicious) {
      suspiciousSignalCount.current++;
      const warningMsg = `Señal sospechosa (${suspiciousSignalCount.current}): ${spectralAnalysis.reason}`;
      console.warn(warningMsg);
      
      if (suspiciousSignalCount.current > MAX_SUSPICIOUS_SIGNALS) {
        const errorMsg = "Demasiadas señales sospechosas. Se requiere recalibración.";
        console.error(errorMsg);
        setLastError({
            message: "Calidad de señal insuficiente. Por favor, recoloca tu dedo.",
            timestamp: now,
            type: "VALIDATION_ERROR",
            details: {
              reason: spectralAnalysis.reason,
              signalHistory: signalHistoryRef.current.length,
              suspiciousCount: suspiciousSignalCount.current
            }
        });
        return { isValid: false, reason: errorMsg };
      }
      return { isValid: false, reason: `Señal sospechosa: ${spectralAnalysis.reason}` };
    }
    
    if (suspiciousSignalCount.current > 0) {
      console.log(`Señal validada correctamente. Restableciendo contador de señales sospechosas.`);
      suspiciousSignalCount.current = 0;
    }
    
    lastSignalTimestamp.current = now;
    return { isValid: true };
  }, []);

  // Procesamiento de señal mejorado
  const processSignal = useCallback((signal: ProcessedSignal): void => {
    const now = Date.now();
    
    if (!validateSignal(signal).isValid) {
      return;
    }
    
    try {
      const newSignalHistory = [...signalHistoryRef.current, signal].slice(-SIGNAL_HISTORY_LIMIT);
      signalHistoryRef.current = newSignalHistory;
      
      setLastSignal(signal);
      setSignalStats(prevStats => {
        const newTotal = prevStats.totalValues + 1;
        const newAvg = (prevStats.avgValue * prevStats.totalValues + signal.filteredValue) / newTotal;
        return {
          minValue: Math.min(prevStats.minValue, signal.filteredValue),
          maxValue: Math.max(prevStats.maxValue, signal.filteredValue),
          avgValue: newAvg,
          totalValues: newTotal,
          lastQualityUpdateTime: now
        };
      });
      
      setFramesProcessed(prev => prev + 1);
      
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
      setLastError({
          message: "Error al procesar la señal",
          timestamp: now,
          type: "PROCESSOR_ERROR",
          details: error instanceof Error ? error.message : String(error)
      });
    }
  }, [validateSignal, signalStats]);

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
    
    const handleProcessorError = (error: ProcessingError) => {
      console.error("Error en el procesador de señal:", error);
      setLastError(error);
      
      errorCountRef.current++;
      const now = Date.now();
      const timeSinceLastError = now - lastErrorTimeRef.current;
      lastErrorTimeRef.current = now;
      
      if (errorCountRef.current > ERROR_RATE_THRESHOLD && timeSinceLastError < ERROR_RATE_WINDOW_MS) {
        console.error("Demasiados errores en poco tiempo. Deteniendo procesamiento.");
        setIsProcessing(false);
        setLastError({
            message: "Error crítico. Reiniciando procesador...",
            timestamp: now,
            type: "PROCESSOR_ERROR",
            details: {
              errorCount: errorCountRef.current,
              timeSinceLastError,
              errorMessage: error.message
            }
        });
        setTimeout(() => { errorCountRef.current = 0; }, 60000);
      }
    };
    
    const handleProcessingStateChange = (isRunning: boolean) => {
      console.log(`Estado del procesamiento: ${isRunning ? 'Iniciado' : 'Detenido'}`);
      setIsProcessing(isRunning);
      if (isRunning) {
        resetProcessorState();
      }
    };
    
    try {
      const options: PPGProcessorOptions = {
        sampleRate: 30,
        minQualityThreshold: 30,
        maxQualityThreshold: 95
      };
      
      const callbacks: PPGProcessorCallbacks = {
        onSignalReady,
        onError: handleProcessorError,
        onProcessingStateChange: handleProcessingStateChange
      };
      
      processorRef.current = new PPGSignalProcessor(onSignalReady, handleProcessorError);
      
      console.log("Procesador de señales inicializado correctamente", {
        timestamp: initTimestamp,
        sessionId,
        options
      });
      
    } catch (initError) {
      console.error("Error al inicializar el procesador de señales:", initError);
      setLastError({
        message: "Error al inicializar el procesador",
        timestamp: Date.now(),
        type: "PROCESSOR_ERROR",
        details: initError instanceof Error ? initError.message : String(initError)
      });
    }
    
    return () => {
      console.log("Limpiando procesador de señales");
      processorRef.current?.stop();
      processorRef.current = null;
    };
  }, [onSignalReady, resetProcessorState]);

  const startProcessing = useCallback(() => {
    if (processorRef.current && !isProcessing) {
      processorRef.current.start();
      setIsProcessing(true);
    }
  }, [isProcessing]);
  
  const stopProcessing = useCallback(() => {
    if (processorRef.current && isProcessing) {
      processorRef.current.stop();
      setIsProcessing(false);
    }
  }, [isProcessing]);
  
  return useMemo(() => ({
    lastSignal,
    signalStats,
    error: lastError,
    isProcessing,
    framesProcessed,
    startProcessing,
    stopProcessing,
    resetProcessor: resetProcessorState,
    processor: processorRef.current,
  }), [
    lastSignal,
    signalStats,
    lastError,
    isProcessing,
    framesProcessed,
    startProcessing,
    stopProcessing,
    resetProcessorState,
  ]);
};
