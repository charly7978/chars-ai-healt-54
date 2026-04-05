
import { useState, useEffect, useCallback, useRef } from 'react';
import { ProcessedSignal, ProcessingError } from '../types/signal';

/**
 * HOOK DE PROCESAMIENTO PPG — WEB WORKER
 *
 * Pipeline: cada frame → worker → un mensaje `signal` con ProcessedSignal + rgbStats
 * + detectionMetrics (sin polling paralelo).
 * `startProcessing` reintenta hasta que el worker emita `ready` (evita carrera al iniciar).
 */
export const useSignalProcessor = () => {
  const workerRef = useRef<Worker | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  
  // Cached metrics (updated on demand)
  const rgbStatsRef = useRef<any>({ redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0, ratioOfRatios: 0 });
  const detectionMetricsRef = useRef<any>({
    detectionConfidence: 0, fingerDetected: false,
    signalQuality: 0, perfusionIndex: 0,
    smoothedRed: 0, smoothedGreen: 0, smoothedBlue: 0,
    fingerConfidenceCount: 0, fingerLostCount: 0, bufferFill: 0,
    coverageScore: 0, spatialStability: 0, tilePulseScore: 0, motionLevel: 0,
  });
  
  // Polling refs for sync-like access from main thread
  const rgbStatsCallbackRef = useRef<((stats: any) => void) | null>(null);
  const detectionMetricsCallbackRef = useRef<((metrics: any) => void) | null>(null);
  
  const isReadyRef = useRef(false);
  const isProcessingRef = useRef(false);
  /** Invalida reintentos de startProcessing si se llama a stopProcessing entre medias */
  const processingSessionRef = useRef(0);
  const sessionIdRef = useRef(`sig_${Date.now().toString(36)}_${(performance.now() | 0).toString(36)}`);

  // Initialize worker
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/ppg.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      
      switch (msg.type) {
        case 'ready':
          isReadyRef.current = true;
          break;
          
        case 'signal':
          setLastSignal(msg.signal);
          setError(null);
          setFramesProcessed(prev => (prev + 1) % 10000);
          if (msg.rgbStats) {
            rgbStatsRef.current = msg.rgbStats;
          }
          if (msg.detectionMetrics) {
            detectionMetricsRef.current = msg.detectionMetrics;
          }
          break;
          
        case 'error':
          console.error(`Worker error: ${msg.error.code}`);
          setError(msg.error);
          break;
          
        case 'rgbStats':
          rgbStatsRef.current = msg.stats;
          rgbStatsCallbackRef.current?.(msg.stats);
          rgbStatsCallbackRef.current = null;
          break;
          
        case 'detectionMetrics':
          detectionMetricsRef.current = msg.metrics;
          detectionMetricsCallbackRef.current?.(msg.metrics);
          detectionMetricsCallbackRef.current = null;
          break;
      }
    };

    worker.onerror = (err) => {
      console.error('PPG Worker error:', err);
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
      isReadyRef.current = false;
    };
  }, []);

  const startProcessing = useCallback(() => {
    if (!workerRef.current || isProcessingRef.current) return;

    processingSessionRef.current += 1;
    const session = processingSessionRef.current;

    const maxAttempts = 80;
    let attempts = 0;

    const tryStart = () => {
      if (!workerRef.current || session !== processingSessionRef.current) return;
      if (!isReadyRef.current) {
        attempts += 1;
        if (attempts >= maxAttempts) {
          if (session === processingSessionRef.current) {
            console.error('[PPG] Worker no emitió ready a tiempo; revisar carga del worker.');
            setError({
              code: 'WORKER_NOT_READY',
              message: 'El procesador PPG no está listo. Recarga la página.',
              timestamp: Date.now(),
            });
          }
          return;
        }
        window.setTimeout(tryStart, 40);
        return;
      }

      if (session !== processingSessionRef.current) return;

      isProcessingRef.current = true;
      setIsProcessing(true);
      setFramesProcessed(0);
      setError(null);
      workerRef.current.postMessage({ type: 'start' });
    };

    tryStart();
  }, []);

  const stopProcessing = useCallback(() => {
    processingSessionRef.current += 1;
    if (!workerRef.current) return;

    workerRef.current.postMessage({ type: 'stop' });
    isProcessingRef.current = false;
    setIsProcessing(false);
    setLastSignal(null);
    setFramesProcessed(0);
  }, []);

  /**
   * Send frame to worker for processing.
   * Transfers the pixel buffer to avoid copying (~300KB per frame).
   */
  const processFrame = useCallback((imageData: ImageData) => {
    if (!workerRef.current || !isProcessingRef.current) return;
    
    // Copy the buffer since we need to transfer it
    const buffer = imageData.data.buffer.slice(0);
    
    workerRef.current.postMessage(
      {
        type: 'processFrame',
        data: buffer,
        width: imageData.width,
        height: imageData.height,
      },
      [buffer] // Transfer ownership — zero-copy
    );
  }, []);

  // Synchronous-like access to cached RGB stats
  const getRGBStats = useCallback(() => {
    return rgbStatsRef.current;
  }, []);

  // Synchronous-like access to cached detection metrics
  const getDetectionMetrics = useCallback(() => {
    return detectionMetricsRef.current;
  }, []);

  return {
    isProcessing,
    lastSignal,
    error,
    framesProcessed,
    startProcessing,
    stopProcessing,
    processFrame,
    getRGBStats,
    getDetectionMetrics,
    debugInfo: {
      sessionId: sessionIdRef.current,
      workerActive: isReadyRef.current,
      offloaded: true,
    }
  };
};
