
import { useState, useEffect, useCallback, useRef } from 'react';
import { ElitePPGProcessor } from '../modules/integration/ElitePPGProcessor';
import type { HeartBeatResult } from '../types/beat';
import { ProcessedSignal, ProcessingError } from '../types/signal';

/** ~25 Hz UI: la ref lleva cada frame; React se actualiza a ritmo moderado. */
const UI_SIGNAL_INTERVAL_MS = 40;

export const useSignalProcessor = () => {
  const processorRef = useRef<ElitePPGProcessor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const lastSignalRef = useRef<ProcessedSignal | null>(null);
  const lastBeatRef = useRef<HeartBeatResult | null>(null);
  const lastUiEmitAtRef = useRef(0);

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

    try {
      processorRef.current = new ElitePPGProcessor({
        enableNonlinearHRV: true,
        enableFrequencyHRV: true,
        enableArrhythmiaDetection: true,
      });
      initializationState.current = 'READY';
    } catch {
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

  const emitSignalUi = useCallback((signal: ProcessedSignal) => {
    lastSignalRef.current = signal;
    setError(null);
    setFramesProcessed((prev) => (prev + 1) % 10000);
    const now = performance.now();
    if (now - lastUiEmitAtRef.current >= UI_SIGNAL_INTERVAL_MS) {
      lastUiEmitAtRef.current = now;
      setLastSignal(signal);
    }
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

    processorRef.current.start();
  }, [isProcessing]);

  const stopProcessing = useCallback(() => {
    if (!processorRef.current) {
      return;
    }

    processorRef.current.stop();
    setIsProcessing(false);
    lastSignalRef.current = null;
    lastBeatRef.current = null;
    lastUiEmitAtRef.current = 0;
    setLastSignal(null);
    setFramesProcessed(0);
  }, []);

  /** Reset completo del motor (PPG + latidos + dedo + HRV internos). */
  const resetProcessingEngine = useCallback(() => {
    processorRef.current?.reset();
    lastSignalRef.current = null;
    lastBeatRef.current = null;
    lastUiEmitAtRef.current = 0;
    setLastSignal(null);
    setFramesProcessed(0);
  }, []);

  const setCameraControl = useCallback(
    (engine: import('@/modules/signal-processing/CameraControlEngine').CameraControlEngine | null) => {
      processorRef.current?.setCameraControl?.(engine);
    },
    []
  );

  const setPPGDebugMode = useCallback((enabled: boolean) => {
    processorRef.current?.setPPGDebugMode?.(enabled);
  }, []);

  const getLastSignal = useCallback((): ProcessedSignal | null => lastSignalRef.current, []);

  const getLastBeatResult = useCallback((): HeartBeatResult | null => lastBeatRef.current, []);

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
      const ts = frameTimestamp ?? performance.now();
      processorRef.current.processFrame(imageData, ts);
      const signal = processorRef.current.getLastProcessedSignal();
      lastBeatRef.current = processorRef.current.getLastBeatResult();
      if (signal) {
        emitSignalUi(signal);
      }
    } catch {
      // hot path: silenciar
    }
  }, [isProcessing, emitSignalUi]);

  const getRGBStats = useCallback(() => {
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
    if (!processorRef.current) return null;
    return processorRef.current.getPPGDebugInfo();
  }, []);

  return {
    isProcessing,
    lastSignal,
    getLastSignal,
    getLastBeatResult,
    error,
    framesProcessed,
    startProcessing,
    stopProcessing,
    resetProcessingEngine,
    calibrate,
    processFrame,
    getRGBStats,
    getPositionQuality,
    getPPGDebugInfo,
    setCameraControl,
    setPPGDebugMode,
    debugInfo: {
      sessionId: sessionIdRef.current,
      initializationState: initializationState.current,
      instanceLocked: instanceLock.current,
    },
  };
};
