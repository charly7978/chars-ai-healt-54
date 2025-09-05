
import { useState, useCallback, useRef, useEffect } from 'react';
import type { VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * HOOK ÚNICO DE SIGNOS VITALES - ELIMINADAS TODAS LAS DUPLICIDADES
 */
export const useVitalSignsProcessor = () => {
  const [lastValidResults, setLastValidResults] = useState<VitalSignsResult | null>(null);
  const sessionId = useRef<string>((() => {
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    return `${t}${p}`;
  })());
  const processedSignals = useRef<number>(0);

  useEffect(() => {
    return () => {
      // noop
    };
  }, []);

  const startCalibration = useCallback(() => {
    // noop
  }, []);

  const forceCalibrationCompletion = useCallback(() => {
    // noop
  }, []);

  const emptyResult: VitalSignsResult = {
    spo2: Number.NaN as unknown as number,
    glucose: 0,
    hemoglobin: 0,
    pressure: { systolic: 0, diastolic: 0 },
    arrhythmiaCount: 0,
    arrhythmiaStatus: 'SIN ARRITMIAS|0',
    lipids: { totalCholesterol: 0, triglycerides: 0 },
    isCalibrating: false,
    calibrationProgress: 0,
    lastArrhythmiaData: undefined
  };

  const processSignal = useCallback((value: number, rrData?: { intervals: number[], lastPeakTime: number | null }) => {
    processedSignals.current++;
    return emptyResult;
  }, []);

  const processChannels = useCallback((channels: any, rrData?: { intervals: number[], lastPeakTime: number | null }) => {
    processedSignals.current++;
    return emptyResult;
  }, []);

  const reset = useCallback(() => {
    setLastValidResults(emptyResult);
    return emptyResult;
  }, []);

  const fullReset = useCallback(() => {
    setLastValidResults(null);
    processedSignals.current = 0;
  }, []);

  return {
    processSignal,
    processChannels,
    reset,
    fullReset,
    startCalibration,
    forceCalibrationCompletion,
    lastValidResults,
    getCalibrationProgress: useCallback(() => 0, []),
    debugInfo: {
      processedSignals: processedSignals.current,
      sessionId: sessionId.current
    },
  };
};
