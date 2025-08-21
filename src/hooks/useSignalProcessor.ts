
import { useState, useEffect, useCallback, useRef } from 'react';
import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';
import { ProcessedSignal, ProcessingError } from '../types/signal';

/**
 * HOOK UNIFICADO DE PROCESAMIENTO PPG - ELIMINADAS TODAS LAS DUPLICIDADES
 * Implementa procesamiento matemático avanzado sin acumulaciones de memoria
 */
export const useSignalProcessor = () => {
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  
  // Eliminado signalStats y todos los historiales que causan memory leaks
  const errorCountRef = useRef(0);
  const lastErrorTimeRef = useRef(0);

  // Callback optimizado sin acumulaciones de memoria
  useEffect(() => {
    const sessionId = (() => {
      const randomBytes = new Uint32Array(1);
      crypto.getRandomValues(randomBytes);
      return randomBytes[0].toString(36);
    })();

    console.log("useSignalProcessor: Creating processor", { sessionId });

    const onSignalReady = (signal: ProcessedSignal) => {
      setLastSignal(signal);
      setError(null);
      setFramesProcessed(prev => {
        // Resetear contador cada 1000 frames para evitar overflow
        return prev >= 1000 ? 1 : prev + 1;
      });
    };

    const onError = (error: ProcessingError) => {
      const currentTime = Date.now();
      
      // Rate limiting mejorado
      if (currentTime - lastErrorTimeRef.current < 2000) {
        errorCountRef.current++;
        return;
      }
      
      errorCountRef.current = 1;
      lastErrorTimeRef.current = currentTime;
      setError(error);
    };

    processorRef.current = new PPGSignalProcessor(onSignalReady, onError);
    
    return () => {
      if (processorRef.current) {
        processorRef.current.stop();
        processorRef.current = null;
      }
    };
  }, []);

  const startProcessing = useCallback(() => {
    if (!processorRef.current || isProcessing) return;

    console.log("useSignalProcessor: Starting processing");
    setIsProcessing(true);
    setFramesProcessed(0);
    errorCountRef.current = 0;
    lastErrorTimeRef.current = 0;
    
    processorRef.current.start();
  }, [isProcessing]);

  const stopProcessing = useCallback(() => {
    if (!processorRef.current) return;

    console.log("useSignalProcessor: Stopping processing");
    setIsProcessing(false);
    processorRef.current.stop();
  }, []);

  const calibrate = useCallback(async () => {
    if (!processorRef.current) return false;

    try {
      console.log("useSignalProcessor: Starting calibration");
      await processorRef.current.calibrate();
      return true;
    } catch (error) {
      console.error("useSignalProcessor: Calibration error:", error);
      return false;
    }
  }, []);

  const processFrame = useCallback((imageData: ImageData) => {
    if (!processorRef.current || !isProcessing) return;
    
    try {
      processorRef.current.processFrame(imageData);
    } catch (error) {
      console.error("processFrame: Error", error);
    }
  }, [isProcessing]);

  return {
    isProcessing,
    lastSignal,
    error,
    framesProcessed,
    startProcessing,
    stopProcessing,
    calibrate,
    processFrame
  };
};
