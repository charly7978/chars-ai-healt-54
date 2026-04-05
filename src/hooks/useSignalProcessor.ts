
import { useState, useEffect, useCallback, useRef } from 'react';
import { ProcessedSignal, ProcessingError } from '../types/signal';
import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';

/**
 * Procesamiento PPG en el hilo principal (sin Web Worker).
 *
 * Motivo: el worker + transferencia de buffers fallaba de forma silenciosa en varios
 * entornos (build, iOS/WebView, carreras start/ready) y el usuario recibía 0 señal.
 * El coste CPU de ~30 fps con ROI es asumible frente a “no funciona nada”.
 */
export const useSignalProcessor = () => {
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);

  const rgbStatsRef = useRef({
    redAC: 0,
    redDC: 0,
    greenAC: 0,
    greenDC: 0,
    rgRatio: 0,
    ratioOfRatios: 0,
  });
  const detectionMetricsRef = useRef({
    detectionConfidence: 0,
    fingerDetected: false,
    signalQuality: 0,
    perfusionIndex: 0,
    smoothedRed: 0,
    smoothedGreen: 0,
    smoothedBlue: 0,
    fingerConfidenceCount: 0,
    fingerLostCount: 0,
    bufferFill: 0,
    coverageScore: 0,
    spatialStability: 0,
    tilePulseScore: 0,
    motionLevel: 0,
  });

  const rgbStatsCallbackRef = useRef<((stats: typeof rgbStatsRef.current) => void) | null>(null);
  const detectionMetricsCallbackRef = useRef<((metrics: typeof detectionMetricsRef.current) => void) | null>(
    null
  );

  const isProcessingRef = useRef(false);
  const processingSessionRef = useRef(0);
  const sessionIdRef = useRef(`sig_${Date.now().toString(36)}_${(performance.now() | 0).toString(36)}`);

  useEffect(() => {
    const processor = new PPGSignalProcessor(
      (signal: ProcessedSignal) => {
        const p = processorRef.current;
        if (!p) return;
        setLastSignal(signal);
        setError(null);
        setFramesProcessed((prev) => (prev + 1) % 10000);
        rgbStatsRef.current = p.getRGBStats();
        detectionMetricsRef.current = p.getDetectionMetrics();
      },
      (err: ProcessingError) => {
        console.error('PPG error:', err);
        setError(err);
      }
    );
    processorRef.current = processor;

    return () => {
      processor.stop();
      processorRef.current = null;
      isProcessingRef.current = false;
    };
  }, []);

  const startProcessing = useCallback(() => {
    const p = processorRef.current;
    if (!p) {
      console.error('[PPG] Procesador no inicializado');
      return;
    }

    processingSessionRef.current += 1;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setFramesProcessed(0);
    setError(null);
    p.start();
  }, []);

  const stopProcessing = useCallback(() => {
    processingSessionRef.current += 1;
    const p = processorRef.current;
    if (p) {
      p.stop();
    }
    isProcessingRef.current = false;
    setIsProcessing(false);
    setLastSignal(null);
    setFramesProcessed(0);
  }, []);

  const processFrame = useCallback((imageData: ImageData) => {
    const p = processorRef.current;
    if (!p || !p.isProcessing) return;
    try {
      p.processFrame(imageData);
    } catch (e) {
      console.error('[PPG] processFrame:', e);
    }
  }, []);

  const getRGBStats = useCallback(() => rgbStatsRef.current, []);

  const getDetectionMetrics = useCallback(() => detectionMetricsRef.current, []);

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
      workerActive: true,
      offloaded: false,
    },
  };
};
