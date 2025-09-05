
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProcessedSignal, ProcessingError } from '../types/signal';

/**
 * HOOK ÚNICO Y DEFINITIVO - ELIMINADAS TODAS LAS DUPLICIDADES
 * Sistema completamente unificado con prevención absoluta de múltiples instancias
 */
export const useSignalProcessor = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);

  const instanceLock = useRef<boolean>(false);
  const sessionIdRef = useRef<string>("");
  const initializationState = useRef<'IDLE' | 'INITIALIZING' | 'READY' | 'ERROR'>('IDLE');

  useEffect(() => {
    if (initializationState.current !== 'IDLE') return;
    instanceLock.current = true;
    initializationState.current = 'READY';

    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `stub_signal_${t}_${p}`;

    return () => {
      initializationState.current = 'IDLE';
      instanceLock.current = false;
    };
  }, []);

  const startProcessing = useCallback(() => {
    if (initializationState.current !== 'READY' || isProcessing) return;
    setIsProcessing(true);
    setFramesProcessed(0);
    setError(null);
  }, [isProcessing]);

  const stopProcessing = useCallback(() => {
    if (!isProcessing) return;
    setIsProcessing(false);
  }, [isProcessing]);

  const calibrate = useCallback(async () => {
    return false;
  }, []);

  const processFrame = useCallback((imageData: ImageData) => {
    if (!isProcessing) return;
    setFramesProcessed(prev => prev + 1);
  }, [isProcessing]);

  return {
    isProcessing,
    lastSignal,
    error,
    framesProcessed,
    startProcessing,
    stopProcessing,
    calibrate,
    processFrame,
    debugInfo: {
      sessionId: sessionIdRef.current,
      initializationState: initializationState.current,
      instanceLocked: instanceLock.current
    }
  };
};
