import { useCallback, useRef, useState, useEffect } from 'react';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * HOOK ÚNICO DE SIGNOS VITALES - OPTIMIZADO
 * Sin dependencia de MultiChannel (eliminado por rendimiento)
 */
export const useVitalSignsProcessor = () => {
  const processorRef = useRef<VitalSignsProcessor | null>(null);
  const [lastValidResults, setLastValidResults] = useState<VitalSignsResult | null>(null);
  const sessionId = useRef<string>(`${Date.now().toString(36)}${(performance.now() | 0).toString(36)}`);
  const processedSignals = useRef<number>(0);
  
  // Lazy initialization - solo crear una vez
  if (!processorRef.current) {
    processorRef.current = new VitalSignsProcessor();
  }
  
  // Cleanup al desmontar
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
  
  const processSignal = useCallback((value: number, rrData?: { intervals: number[], lastPeakTime: number | null }) => {
    if (!processorRef.current) return {
      spo2: 0, glucose: 0, hemoglobin: 0,
      pressure: { systolic: 0, diastolic: 0 },
      arrhythmiaCount: 0, arrhythmiaStatus: "SIN ARRITMIAS|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false, calibrationProgress: 0, lastArrhythmiaData: undefined
    };
    
    processedSignals.current++;
    
    const result = processorRef.current.processSignal(value, rrData);
    
    // Guardar resultados válidos
    if (result.spo2 > 0 && result.glucose > 0) {
      setLastValidResults(result);
    }
    
    return result;
  }, []);

  const reset = useCallback(() => {
    if (!processorRef.current) return null;
    const savedResults = processorRef.current.reset();
    if (savedResults) {
      setLastValidResults(savedResults);
    }
    return savedResults;
  }, []);
  
  const fullReset = useCallback(() => {
    processorRef.current?.fullReset();
    setLastValidResults(null);
    processedSignals.current = 0;
  }, []);

  return {
    processSignal,
    reset,
    fullReset,
    startCalibration,
    forceCalibrationCompletion,
    lastValidResults,
    getCalibrationProgress: useCallback(() => processorRef.current?.getCalibrationProgress() ?? 0, []),
    debugInfo: {
      processedSignals: processedSignals.current,
      sessionId: sessionId.current
    },
  };
};
