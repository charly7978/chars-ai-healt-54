
import { useState, useEffect, useCallback, useRef } from 'react';
import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';
import { MotionTracker } from '../modules/signal-processing/MotionTracker';
import { PPGProcessingWorkerBridge } from '../modules/signal-processing/PPGProcessingWorkerBridge';
import type { ProcessedSignal, ProcessingError } from '../types/signal';

type CaptureCtx = Parameters<PPGSignalProcessor['applyCaptureContext']>[0];

/**
 * Procesador PPG único + motion compartido + worker DSP opcional con fallback al main thread.
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
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);

  const instanceLock = useRef<boolean>(false);
  const sessionIdRef = useRef<string>('');
  const initializationState = useRef<'IDLE' | 'INITIALIZING' | 'READY' | 'ERROR'>('IDLE');

  useEffect(() => {
    if (instanceLock.current || initializationState.current !== 'IDLE') {
      return;
    }

    instanceLock.current = true;
    initializationState.current = 'INITIALIZING';

    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `sig_${t}_${p}`;

    const motion = new MotionTracker();
    motionRef.current = motion;

    const onSignalReady = (signal: ProcessedSignal) => {
      if (initializationState.current !== 'READY') return;
      if (signal.acStats) {
        lastAcStatsRef.current = signal.acStats;
      }
      if (signal.positionQuality) {
        lastPositionRef.current = signal.positionQuality;
      }
      setLastSignal(signal);
      setError(null);
      setFramesProcessed((prev) => (prev + 1) % 10000);
    };

    const onError = (err: ProcessingError) => {
      console.error(`Error procesador: ${err.code}`);
      setError(err);
    };

    try {
      processorRef.current = new PPGSignalProcessor(onSignalReady, onError);
      const bridge = new PPGProcessingWorkerBridge(motion, onSignalReady, onError);
      bridgeRef.current = bridge;
      void bridge.init().then((ok) => {
        workerActiveRef.current = Boolean(ok);
        if (!ok) {
          bridgeRef.current = null;
        }
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
    if (!processorRef.current || initializationState.current !== 'READY') {
      return;
    }
    if (isProcessing) {
      return;
    }
    setIsProcessing(true);
    setFramesProcessed(0);
    setError(null);
    motionRef.current?.start();
    processorRef.current.start();
  }, [isProcessing]);

  const stopProcessing = useCallback(() => {
    if (!processorRef.current) {
      return;
    }
    processorRef.current.stop();
    motionRef.current?.stop();
    setIsProcessing(false);
    setLastSignal(null);
    setFramesProcessed(0);
  }, []);

  const calibrate = useCallback(async () => {
    if (!processorRef.current || initializationState.current !== 'READY') {
      return false;
    }
    try {
      return await processorRef.current.calibrate();
    } catch {
      return false;
    }
  }, []);

  const processFrame = useCallback((imageData: ImageData, frameTimestamp?: number) => {
    if (!processorRef.current || initializationState.current !== 'READY' || !isProcessing) {
      return;
    }
    try {
      const m = motionRef.current?.getScore() ?? 0;
      processorRef.current.processFrame(imageData, frameTimestamp, m);
    } catch {
      /* hot path */
    }
  }, [isProcessing]);

  const processFrameDual = useCallback(
    (detectionImageData: ImageData, extractionImageData: ImageData, frameTimestamp?: number) => {
      if (initializationState.current !== 'READY' || !isProcessing) {
        return;
      }
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
    [isProcessing]
  );

  const applyCaptureContext = useCallback((ctx: CaptureCtx) => {
    processorRef.current?.applyCaptureContext(ctx);
  }, []);

  const getRGBStats = useCallback(() => {
    if (workerActiveRef.current) {
      return lastAcStatsRef.current;
    }
    if (!processorRef.current) {
      return {
        redAC: 0,
        redDC: 0,
        greenAC: 0,
        greenDC: 0,
        rgRatio: 0,
        ratioOfRatios: 0,
      };
    }
    return processorRef.current.getRGBStats();
  }, []);

  const getPositionQuality = useCallback(() => {
    if (workerActiveRef.current) {
      return lastPositionRef.current;
    }
    if (!processorRef.current) {
      return {
        locked: false,
        drifting: false,
        spatialUniformity: 0,
        centerCoverage: 0,
        positionDrift: 0,
        guidance: 'COLOQUE SU DEDO',
        qualityScore: 0,
      };
    }
    return processorRef.current.getPositionQuality();
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
    error,
    framesProcessed,
    startProcessing,
    stopProcessing,
    calibrate,
    processFrame,
    processFrameDual,
    applyCaptureContext,
    getRGBStats,
    getPositionQuality,
    getPPGDebugInfo,
    debugInfo: {
      sessionId: sessionIdRef.current,
      initializationState: initializationState.current,
      instanceLocked: instanceLock.current,
      workerActive: workerActiveRef.current,
    },
  };
};
