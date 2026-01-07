import { useState, useCallback, useRef } from 'react';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';
import type { MultiChannelOutputs } from '../types/multichannel';

/**
 * HOOK ÚNICO DE SIGNOS VITALES - OPTIMIZADO
 */
export const useVitalSignsProcessor = () => {
  const [processor] = useState(() => new VitalSignsProcessor());
  const [lastValidResults, setLastValidResults] = useState<VitalSignsResult | null>(null);
  const sessionId = useRef<string>(`${Date.now().toString(36)}${(performance.now() | 0).toString(36)}`);
  const processedSignals = useRef<number>(0);
  
  const startCalibration = useCallback(() => {
    processor.startCalibration();
  }, [processor]);
  
  const forceCalibrationCompletion = useCallback(() => {
    processor.forceCalibrationCompletion();
  }, [processor]);
  
  const processSignal = useCallback((value: number, rrData?: { intervals: number[], lastPeakTime: number | null }) => {
    processedSignals.current++;
    
    const result = processor.processSignal(value, rrData);
    
    // Guardar resultados válidos
    if (result.spo2 > 0 && result.glucose > 0) {
      setLastValidResults(result);
    }
    
    return result;
  }, [processor]);

  const processChannels = useCallback((channels: MultiChannelOutputs, rrData?: { intervals: number[], lastPeakTime: number | null }) => {
    processedSignals.current++;
    const result = processor.processChannels(channels, rrData);
    if (result.spo2 > 0 && result.glucose > 0) {
      setLastValidResults(result);
    }
    return result;
  }, [processor]);

  const reset = useCallback(() => {
    const savedResults = processor.reset();
    if (savedResults) {
      setLastValidResults(savedResults);
    }
    return savedResults;
  }, [processor]);
  
  const fullReset = useCallback(() => {
    processor.fullReset();
    setLastValidResults(null);
    processedSignals.current = 0;
  }, [processor]);

  return {
    processSignal,
    processChannels,
    reset,
    fullReset,
    startCalibration,
    forceCalibrationCompletion,
    lastValidResults,
    getCalibrationProgress: useCallback(() => processor.getCalibrationProgress(), [processor]),
    debugInfo: {
      processedSignals: processedSignals.current,
      sessionId: sessionId.current
    },
  };
};
