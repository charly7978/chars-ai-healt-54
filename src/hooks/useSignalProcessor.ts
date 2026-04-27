import { useState, useEffect, useCallback, useRef } from 'react';
import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';
import { MotionTracker } from '../modules/signal-processing/MotionTracker';
import { PPGProcessingWorkerBridge } from '../modules/signal-processing/PPGProcessingWorkerBridge';
import type { ProcessedSignal, ProcessingError } from '../types/signal';

type CaptureCtx = Parameters<PPGSignalProcessor['applyCaptureContext']>[0];

/**
 * Hook único de procesamiento PPG.
 *  - PPGSignalProcessor (main thread fallback)
 *  - PPGProcessingWorkerBridge (worker DSP cuando está disponible)
 *  - MotionTracker compartido
 *
 * Solo expone lo que la UI consume: lastSignal, processFrameDual,
 * applyCaptureContext, getRGBStats, getPositionQuality, getPPGDebugInfo,
 * startProcessing y stopProcessing.
 *
 * Eliminado de versiones anteriores: calibrate(), processFrame() (sin
 * consumidores en runtime). Eliminados también setStates de framesProcessed
 * y error que ningún componente lee.
 */
export const useSignalProcessor = () => {
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const motionRef = useRef<MotionTracker | null>(null);
  const bridgeRef = useRef<PPGProcessingWorkerBridge | null>(null);
  const workerActiveRef = useRef(false);
  const lastAcStatsRef = useRef({
    redAC: 0,
    redDC: 0,
    greenAC: 0,
    greenDC: 0,
    rgRatio: 0,
    ratioOfRatios: 0,
  });
  const lastPositionRef = useRef({
    locked: false,
    drifting: false,
    spatialUniformity: 0,
    centerCoverage: 0,
    positionDrift: 0,
    guidance: 'COLOQUE SU DEDO',
    qualityScore: 0,
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);

  const instanceLock = useRef<boolean>(false);
  const initializationState = useRef<'IDLE' | 'INITIALIZING' | 'READY' | 'ERROR'>('IDLE');
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (instanceLock.current || initializationState.current !== 'IDLE') return;
    instanceLock.current = true;
    initializationState.current = 'INITIALIZING';

    const motion = new MotionTracker();
    motionRef.current = motion;

    const onSignalReady = (signal: ProcessedSignal) => {
      if (initializationState.current !== 'READY') return;
      if (signal.acStats) lastAcStatsRef.current = signal.acStats;
      if (signal.positionQuality) lastPositionRef.current = signal.positionQuality;
      setLastSignal(signal);
    };

    const onError = (err: ProcessingError) => {
      console.error(`Error procesador: ${err.code}`);
    };

    try {
      processorRef.current = new PPGSignalProcessor(onSignalReady, onError);
      const bridge = new PPGProcessingWorkerBridge(motion, onSignalReady, onError);
      bridgeRef.current = bridge;
      void bridge.init().then((ok) => {
        workerActiveRef.current = Boolean(ok);
        if (!ok) bridgeRef.current = null;
      });
      initializationState.current = 'READY';
    } catch {
      initializationState.current = 'ERROR';
      instanceLock.current = false;
    }

    return () => {
      workerActiveRef.current = false;
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
      if (processorRef.current) {
        processorRef.current.stop();
        processorRef.current = null;
      }
      motion.stop();
      motionRef.current = null;
      initializationState.current = 'IDLE';
      instanceLock.current = false;
    };
  }, []);

  const startProcessing = useCallback(() => {
    if (!processorRef.current || initializationState.current !== 'READY') return;
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    motionRef.current?.start();
    processorRef.current.start();
  }, []);

  const stopProcessing = useCallback(() => {
    if (!processorRef.current) return;
    processorRef.current.stop();
    motionRef.current?.stop();
    isProcessingRef.current = false;
    setIsProcessing(false);
    setLastSignal(null);
  }, []);

  const processFrameDual = useCallback(
    (detectionImageData: ImageData, extractionImageData: ImageData, frameTimestamp?: number) => {
      if (initializationState.current !== 'READY' || !isProcessingRef.current) return;
      const m = motionRef.current?.getScore() ?? 0;
      try {
        if (workerActiveRef.current && bridgeRef.current) {
          bridgeRef.current.enqueueFrame(detectionImageData, extractionImageData, frameTimestamp ?? performance.now());
          return;
        }
        processorRef.current?.processFrameDual(detectionImageData, extractionImageData, frameTimestamp, m);
      } catch {
        /* hot path */
      }
    },
    []
  );

  const applyCaptureContext = useCallback((ctx: CaptureCtx) => {
    // Aplicar tanto al procesador main thread como al worker (si activo).
    // El worker procesa frames con su propia instancia, así que necesita
    // los mismos parámetros de captura.
    processorRef.current?.applyCaptureContext(ctx);
    if (workerActiveRef.current && bridgeRef.current) {
      bridgeRef.current.applyCaptureContext(ctx);
    }
  }, []);

  const getRGBStats = useCallback(() => {
    if (workerActiveRef.current) return lastAcStatsRef.current;
    return processorRef.current?.getRGBStats() ?? lastAcStatsRef.current;
  }, []);

  const getPositionQuality = useCallback(() => {
    if (workerActiveRef.current) return lastPositionRef.current;
    return processorRef.current?.getPositionQuality() ?? lastPositionRef.current;
  }, []);

  const getPPGDebugInfo = useCallback(() => {
    const base = processorRef.current?.getDebugInfo() ?? null;
    if (!base) return null;
    const st = bridgeRef.current?.getStatus();
    return {
      ...base,
      workerMode: st?.mode,
      workerFallbackReason: st?.fallbackReason,
      workerQueue: bridgeRef.current?.getQueueDepth(),
      workerLatencyMs: bridgeRef.current?.getLatencyEwmaMs(),
    };
  }, []);

  return {
    isProcessing,
    lastSignal,
    startProcessing,
    stopProcessing,
    processFrameDual,
    applyCaptureContext,
    getRGBStats,
    getPositionQuality,
    getPPGDebugInfo,
  };
};
