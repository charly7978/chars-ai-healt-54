import { useCallback, useRef } from 'react';

interface HeartBeatResult {
  bpm: number;
  confidence: number;
  isPeak: boolean;
  arrhythmiaCount: number;
  signalQuality: number;
  rrData?: {
    intervals: number[];
    lastPeakTime: number | null;
  };
}

/**
 * HOOK SIMPLIFICADO - El procesamiento ahora está en PPGMonitor
 * Este hook solo mantiene la interfaz para compatibilidad
 */
export const useHeartBeatProcessor = () => {
  const bpmRef = useRef(0);
  const arrhythmiaDetectedRef = useRef(false);
  
  const processSignal = useCallback((_value: number, _fingerDetected: boolean = true, _timestamp?: number): HeartBeatResult => {
    return {
      bpm: bpmRef.current,
      confidence: 0,
      isPeak: false,
      arrhythmiaCount: 0,
      signalQuality: 0,
      rrData: { intervals: [], lastPeakTime: null }
    };
  }, []);

  const reset = useCallback(() => {
    bpmRef.current = 0;
    arrhythmiaDetectedRef.current = false;
  }, []);

  const recalibrate = useCallback(() => {}, []);

  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    arrhythmiaDetectedRef.current = isArrhythmiaDetected;
  }, []);

  return {
    currentBPM: 0,
    confidence: 0,
    signalQuality: 0,
    isCalibrating: false,
    calibrationProgress: 100,
    processSignal,
    reset,
    recalibrate,
    setArrhythmiaState,
    debugInfo: {
      sessionId: 'deprecated',
      processingState: 'ACTIVE',
      processedSignals: 0
    }
  };
};
