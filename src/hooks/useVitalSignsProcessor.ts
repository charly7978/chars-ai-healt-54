import { useCallback, useRef, useState, useEffect } from 'react';
import { VitalSignsProcessor, VitalSignsResult, RGBData } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * HOOK DE SIGNOS VITALES - OPTIMIZADO
 * Ahora acepta datos RGB para cálculo correcto de SpO2
 */
export const useVitalSignsProcessor = () => {
  const processorRef = useRef<VitalSignsProcessor | null>(null);
  const [lastValidResults, setLastValidResults] = useState<VitalSignsResult | null>(null);
  const sessionId = useRef<string>(`${Date.now().toString(36)}${(performance.now() | 0).toString(36)}`);
  const processedSignals = useRef<number>(0);
  
  // Lazy initialization
  if (!processorRef.current) {
    processorRef.current = new VitalSignsProcessor();
  }
  
  // Cleanup
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
  
  /**
   * Actualizar datos RGB para SpO2
   */
  const setRGBData = useCallback((data: RGBData) => {
    processorRef.current?.setRGBData(data);
  }, []);
  
  const processSignal = useCallback((
    value: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ) => {
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
    if (result.spo2 > 0 || result.arrhythmiaCount > 0) {
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
    setRGBData,
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
