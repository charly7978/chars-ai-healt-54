import { useState, useCallback, useRef, useEffect } from 'react';
import { PPGSignalProcessor } from '../modules/SignalProcessor';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';
import { ProcessedSignal, ProcessingError } from '../types/signal';

interface UnifiedResult {
  // Señal base
  signal: ProcessedSignal | null;
  
  // Corazón
  heartRate: number;
  confidence: number;
  isPeak: boolean;
  
  // Signos vitales
  vitalSigns: VitalSignsResult;
  
  // Estado
  isProcessing: boolean;
  signalQuality: number;
  arrhythmiaCount: number;
}

export const useUnifiedProcessor = () => {
  // SINGLE INSTANCES - No duplicación
  const ppgProcessor = useRef<PPGSignalProcessor | null>(null);
  const heartProcessor = useRef<HeartBeatProcessor | null>(null);
  const vitalProcessor = useRef<VitalSignsProcessor | null>(null);
  
  // SINGLE STATE - No duplicación
  const [result, setResult] = useState<UnifiedResult>({
    signal: null,
    heartRate: 0,
    confidence: 0,
    isPeak: false,
    vitalSigns: {
      spo2: 0,
      pressure: "--/--",
      arrhythmiaStatus: "--",
      glucose: 0,
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      hemoglobin: 0
    },
    isProcessing: false,
    signalQuality: 0,
    arrhythmiaCount: 0
  });
  
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [error, setError] = useState<ProcessingError | null>(null);
  
  // Initialize processors ONCE - FIXED: No recrear en cada render
  useEffect(() => {
    // EVITAR RECREACIÓN si ya existen
    if (ppgProcessor.current && heartProcessor.current && vitalProcessor.current) {
      console.log("useUnifiedProcessor: Processors already exist, skipping creation");
      return;
    }
    
    const onSignalReady = (signal: ProcessedSignal) => {
      // SINGLE PROCESSING CHAIN - No duplicación
      if (!heartProcessor.current || !vitalProcessor.current) return;
      
      // Process heart rate ONCE
      const heartResult = heartProcessor.current.processSignal(signal.filteredValue);
      const rrData = heartProcessor.current.getRRIntervals();
      
      // Process vital signs ONCE
      const vitalResult = vitalProcessor.current.processSignal(signal.filteredValue, rrData);
      
      // UPDATE STATE ONCE
      setResult(prev => ({
        ...prev,
        signal,
        heartRate: heartResult.bpm,
        confidence: heartResult.confidence,
        isPeak: heartResult.isPeak,
        vitalSigns: vitalResult,
        signalQuality: heartResult.signalQuality || signal.quality,
        arrhythmiaCount: prev.arrhythmiaCount
      }));
      
      setFramesProcessed(prev => prev + 1);
    };
    
    const onError = (error: ProcessingError) => {
      setError(error);
    };
    
    // Create processors ONLY ONCE
    console.log("useUnifiedProcessor: Creating new processor instances");
    ppgProcessor.current = new PPGSignalProcessor(onSignalReady, onError);
    heartProcessor.current = new HeartBeatProcessor();
    vitalProcessor.current = new VitalSignsProcessor();
    
    return () => {
      console.log("useUnifiedProcessor: Cleanup - stopping processors");
      ppgProcessor.current?.stop();
      heartProcessor.current?.reset();
      vitalProcessor.current?.fullReset();
    };
  }, []); // DEPENDENCIAS VACÍAS para ejecutar solo UNA VEZ
  
  const startProcessing = useCallback(() => {
    if (!ppgProcessor.current) {
      console.error("useUnifiedProcessor: No PPG processor available");
      return;
    }
    
    console.log("useUnifiedProcessor: Starting processing - NO RESET");
    ppgProcessor.current.start();
    setResult(prev => ({ ...prev, isProcessing: true }));
    // NO resetear frameCount para mantener continuidad
    setError(null);
  }, []);
  
  const stopProcessing = useCallback(() => {
    if (!ppgProcessor.current) return;
    
    ppgProcessor.current.stop();
    setResult(prev => ({ ...prev, isProcessing: false }));
  }, []);
  
  const processFrame = useCallback((imageData: ImageData) => {
    if (!ppgProcessor.current || !result.isProcessing) return;
    ppgProcessor.current.processFrame(imageData);
  }, [result.isProcessing]);
  
  const reset = useCallback(() => {
    console.log("useUnifiedProcessor: SOFT RESET - preserving processor instances");
    // NO destruir procesadores, solo resetear estado
    ppgProcessor.current?.stop();
    
    // SOFT reset - mantener contexto de procesadores
    setResult(prev => ({
      ...prev,
      signal: null,
      heartRate: 0,
      confidence: 0,
      isPeak: false,
      isProcessing: false,
      signalQuality: 0
    }));
    
    setError(null);
    // NO resetear frameCount para mantener continuidad
  }, []);
  
  return {
    // Unified result
    ...result,
    
    // Stats
    framesProcessed,
    error,
    
    // Controls
    startProcessing,
    stopProcessing,
    processFrame,
    reset
  };
};