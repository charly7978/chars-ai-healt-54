
import { useState, useCallback, useRef, useEffect } from 'react';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * HOOK UNIFICADO PARA PROCESAMIENTO DE SIGNOS VITALES
 * Elimina redundancias y centraliza todo el procesamiento
 */
export const useVitalSignsProcessor = () => {
  const [processor] = useState(() => new VitalSignsProcessor());
  const [lastValidResults, setLastValidResults] = useState<VitalSignsResult | null>(null);
  const sessionId = useRef<string>((() => {
    const randomBytes = new Uint32Array(2);
    crypto.getRandomValues(randomBytes);
    return randomBytes[0].toString(36) + randomBytes[1].toString(36);
  })());
  const processedSignals = useRef<number>(0);
  
  useEffect(() => {
    console.log("🏥 useVitalSignsProcessor: Sistema unificado inicializado", {
      sessionId: sessionId.current,
      timestamp: new Date().toISOString()
    });
    
    return () => {
      console.log("🏥 useVitalSignsProcessor: Sistema unificado destruido", {
        sessionId: sessionId.current,
        señalesProcesadas: processedSignals.current,
        timestamp: new Date().toISOString()
      });
    };
  }, []);
  
  const startCalibration = useCallback(() => {
    console.log("🔧 useVitalSignsProcessor: Iniciando calibración unificada", {
      timestamp: new Date().toISOString(),
      sessionId: sessionId.current
    });
    
    processor.startCalibration();
  }, [processor]);
  
  const forceCalibrationCompletion = useCallback(() => {
    console.log("⚡ useVitalSignsProcessor: Forzando finalización de calibración", {
      timestamp: new Date().toISOString(),
      sessionId: sessionId.current
    });
    
    processor.forceCalibrationCompletion();
  }, [processor]);
  
  const processSignal = useCallback((value: number, rrData?: { intervals: number[], lastPeakTime: number | null }) => {
    processedSignals.current++;
    
    console.log("🔬 useVitalSignsProcessor: Procesando señal unificada", {
      valorEntrada: value,
      rrDataPresente: !!rrData,
      intervalosRR: rrData?.intervals.length || 0,
      señalNúmero: processedSignals.current,
      sessionId: sessionId.current,
      timestamp: new Date().toISOString()
    });
    
    // Procesamiento unificado y directo
    const result = processor.processSignal(value, rrData);
    
    // Guardar resultados válidos
    if (result.spo2 > 0 && result.glucose > 0) {
      console.log("✅ useVitalSignsProcessor: Resultado válido unificado", {
        spo2: result.spo2,
        presión: result.pressure,
        glucosa: result.glucose,
        timestamp: new Date().toISOString()
      });
      
      setLastValidResults(result);
    }
    
    return result;
  }, [processor]);

  const reset = useCallback(() => {
    console.log("🔄 useVitalSignsProcessor: Reseteo unificado", {
      timestamp: new Date().toISOString()
    });
    
    const savedResults = processor.reset();
    if (savedResults) {
      setLastValidResults(savedResults);
    }
    
    return savedResults;
  }, [processor]);
  
  const fullReset = useCallback(() => {
    console.log("🗑️ useVitalSignsProcessor: Reseteo completo unificado", {
      timestamp: new Date().toISOString()
    });
    
    processor.fullReset();
    setLastValidResults(null);
    processedSignals.current = 0;
  }, [processor]);

  return {
    processSignal,
    reset,
    fullReset,
    startCalibration,
    forceCalibrationCompletion,
    lastValidResults,
    getCalibrationProgress: useCallback(() => processor.getCalibrationProgress(), [processor]),
    debugInfo: {
      processedSignals: processedSignals.current
    },
  };
};
