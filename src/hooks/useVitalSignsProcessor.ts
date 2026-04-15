import { useCallback, useRef, useState, useEffect } from 'react';
import { VitalSignsProcessor, VitalSignsResult, RGBData } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * HOOK DE SIGNOS VITALES V2
 * Accepts RGB data + upstream context for gating
 */
export const useVitalSignsProcessor = () => {
  const processorRef = useRef<VitalSignsProcessor | null>(null);
  const [lastValidResults, setLastValidResults] = useState<VitalSignsResult | null>(null);
  const sessionId = useRef<string>(`${Date.now().toString(36)}${(performance.now() | 0).toString(36)}`);
  const processedSignals = useRef<number>(0);
  
  if (!processorRef.current) {
    processorRef.current = new VitalSignsProcessor();
  }
  
  useEffect(() => {
    return () => {
      if (processorRef.current) {
        processorRef.current.fullReset();
        processorRef.current = null;
      }
    };
  }, []);
  
  const startCalibration = useCallback(() => {
    processorRef.current?.startCalibration();
  }, []);
  
  const forceCalibrationCompletion = useCallback(() => {
    processorRef.current?.forceCalibrationCompletion();
  }, []);
  
  const setRGBData = useCallback((data: RGBData) => {
    processorRef.current?.setRGBData(data);
  }, []);

  const setUpstreamContext = useCallback((ctx: {
    contactStable?: boolean;
    pressureOptimal?: boolean;
    clipHighRatio?: number;
    sourceStability?: number;
    avgBeatSQI?: number;
    beatCount?: number;
  }) => {
    processorRef.current?.setUpstreamContext(ctx);
  }, []);
  
  const processSignal = useCallback((
    value: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null },
    beatInputs?: Array<{
      ibiMs: number; beatSQI: number; morphologyScore: number;
      detectorAgreement: number; amplitude?: number;
      flags: { isWeak: boolean; isPremature: boolean; isSuspicious: boolean; isDoublePeak: boolean };
    }>
  ): VitalSignsResult => {
    const defaultResult: VitalSignsResult = {
      spo2: 0, glucose: 0,
      pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
      arrhythmiaCount: 0, arrhythmiaStatus: "SIN ARRITMIAS|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false, calibrationProgress: 0, lastArrhythmiaData: undefined,
      signalQuality: 0, measurementConfidence: 'INVALID' as const,
    };
    
    if (!processorRef.current) return defaultResult;
    
    processedSignals.current++;
    const result = processorRef.current.processSignal(value, rrData, beatInputs);
    
    if (
      result.measurementConfidence !== 'INVALID' ||
      result.pressure.confidence !== 'INSUFFICIENT' ||
      result.spo2 > 0 || result.glucose > 0 ||
      result.lipids.totalCholesterol > 0 || result.arrhythmiaCount > 0
    ) {
      setLastValidResults(result);
    }
    
    return result;
  }, []);

  const reset = useCallback(() => {
    if (!processorRef.current) return lastValidResults;
    const savedResults = processorRef.current.reset();
    const resultToReturn = savedResults ?? lastValidResults;
    if (resultToReturn) setLastValidResults(resultToReturn);
    return resultToReturn;
  }, [lastValidResults]);

  const fullReset = useCallback(() => {
    processorRef.current?.fullReset();
    setLastValidResults(null);
    processedSignals.current = 0;
  }, []);

  const hasValidPressureEstimate = useCallback(() => {
    return processorRef.current?.hasValidPressureEstimate() ?? false;
  }, []);

  return {
    processSignal,
    setRGBData,
    setUpstreamContext,
    reset,
    fullReset,
    startCalibration,
    forceCalibrationCompletion,
    hasValidPressureEstimate,
    lastValidResults,
    getCalibrationProgress: useCallback(() => processorRef.current?.getCalibrationProgress() ?? 0, []),
    debugInfo: {
      processedSignals: processedSignals.current,
      sessionId: sessionId.current
    },
  };
};
