import { useState, useEffect, useCallback, useRef } from 'react';
import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';
import { ProcessedSignal, ProcessingError } from '../types/signal';
import { SignalQualityResult } from '../modules/signal-processing/SignalQualityAnalyzer';

/**
 * HOOK ÚNICO Y DEFINITIVO - PROCESAMIENTO PPG PROFESIONAL
 * 
 * Integra:
 * - PPGSignalProcessor con pipeline completo
 * - SignalQualityAnalyzer para SQI robusto
 * - Prevención de múltiples instancias
 */
export const useSignalProcessor = () => {
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [qualityResult, setQualityResult] = useState<SignalQualityResult | null>(null);
  
  // Control de instancia única
  const instanceLock = useRef<boolean>(false);
  const sessionIdRef = useRef<string>("");
  const initializationState = useRef<'IDLE' | 'INITIALIZING' | 'READY' | 'ERROR'>('IDLE');
  
  // Inicialización única
  useEffect(() => {
    if (instanceLock.current || initializationState.current !== 'IDLE') {
      return;
    }
    
    instanceLock.current = true;
    initializationState.current = 'INITIALIZING';
    
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `sig_${t}_${p}`;

    const onSignalReady = (signal: ProcessedSignal) => {
      if (initializationState.current !== 'READY') return;
      
      setLastSignal(signal);
      setError(null);
      setFramesProcessed(prev => (prev + 1) % 10000);
      
      // Obtener resultado de calidad del procesador
      const qr = processorRef.current?.getQualityResult();
      if (qr) {
        setQualityResult(qr);
      }
    };

    const onError = (error: ProcessingError) => {
      console.error(`Error procesador: ${error.code}`);
      setError(error);
    };

    try {
      processorRef.current = new PPGSignalProcessor(onSignalReady, onError);
      initializationState.current = 'READY';
    } catch (err) {
      initializationState.current = 'ERROR';
      instanceLock.current = false;
    }
    
    return () => {
      if (processorRef.current) {
        processorRef.current.stop();
        processorRef.current = null;
      }
      initializationState.current = 'IDLE';
      instanceLock.current = false;
    };
  }, []);

  const startProcessing = useCallback(() => {
    if (!processorRef.current || initializationState.current !== 'READY') {
      return;
    }

    if (isProcessing) {
      return;
    }
    
    setIsProcessing(true);
    setFramesProcessed(0);
    setError(null);
    setQualityResult(null);
    
    processorRef.current.start();
  }, [isProcessing]);

  const stopProcessing = useCallback(() => {
    if (!processorRef.current) {
      return;
    }
    
    processorRef.current.stop();
    setIsProcessing(false);
    setLastSignal(null);
    setFramesProcessed(0);
    setQualityResult(null);
  }, []);

  const calibrate = useCallback(async () => {
    if (!processorRef.current || initializationState.current !== 'READY') {
      return false;
    }

    try {
      const success = await processorRef.current.calibrate();
      return success;
    } catch (error) {
      return false;
    }
  }, []);

  const processFrame = useCallback((imageData: ImageData) => {
    if (!processorRef.current || initializationState.current !== 'READY' || !isProcessing) {
      return;
    }
    
    try {
      processorRef.current.processFrame(imageData);
    } catch (error) {
      // Error silenciado para rendimiento
    }
  }, [isProcessing]);

  const getRGBStats = useCallback(() => {
    if (!processorRef.current) {
      return {
        redAC: 0,
        redDC: 0,
        greenAC: 0,
        greenDC: 0,
        rgRatio: 0,
        ratioOfRatios: 0,
        perfusionIndex: 0
      };
    }
    return processorRef.current.getRGBStats();
  }, []);

  const getVPGBuffer = useCallback(() => {
    return processorRef.current?.getVPGBuffer() ?? [];
  }, []);

  const getAPGBuffer = useCallback(() => {
    return processorRef.current?.getAPGBuffer() ?? [];
  }, []);

  const getFilteredBuffer = useCallback(() => {
    return processorRef.current?.getFilteredBuffer() ?? [];
  }, []);

  const getDetrendedBuffer = useCallback(() => {
    return processorRef.current?.getDetrendedBuffer() ?? [];
  }, []);

  const getQualityResult = useCallback(() => {
    return processorRef.current?.getQualityResult() ?? null;
  }, []);

  return {
    isProcessing,
    lastSignal,
    error,
    framesProcessed,
    qualityResult,
    startProcessing,
    stopProcessing,
    calibrate,
    processFrame,
    getRGBStats,
    getVPGBuffer,
    getAPGBuffer,
    getFilteredBuffer,
    getDetrendedBuffer,
    getQualityResult,
    debugInfo: {
      sessionId: sessionIdRef.current,
      initializationState: initializationState.current,
      instanceLocked: instanceLock.current
    }
  };
};
