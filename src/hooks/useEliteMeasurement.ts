/**
 * HOOK ÉLITE UNIFICADO - Sistema completo de medición
 * 
 * Reemplaza: useSignalProcessor + useHeartBeatProcessor + useVitalSignsProcessor
 * Integración: ElitePPGProcessor con todos los módulos élite
 * 
 * Flujo:
 * 1. Cámara → processFrame()
 * 2. ElitePPGProcessor procesa todo el pipeline
 * 3. Resultado unificado con todos los signos vitales
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ElitePPGProcessor, type ElitePPGResult } from '../modules/integration/ElitePPGProcessor';
import type { ArrhythmiaResult } from '../modules/vital-signs/AdvancedArrhythmiaDetector';

export interface EliteMeasurementState {
  // Estado de procesamiento
  isProcessing: boolean;
  isPaused: boolean;
  elapsedTime: number;
  progress: number;
  
  // Señal
  signalQuality: number;
  fingerDetected: boolean;
  stability: number;
  
  // Vitales instantáneos
  heartRate: number;
  spo2: number;
  systolicBP: number;
  diastolicBP: number;
  
  // HRV
  rmssd: number;
  sdnn: number;
  pnn50: number;
  lfHfRatio: number;
  sd1: number;
  sd2: number;
  
  // Arritmias
  arrhythmiaDetected: boolean;
  arrhythmiaType: string | null;
  arrhythmiaSeverity: 'info' | 'warning' | 'alert' | 'critical' | null;
  arrhythmiaCount: number;
  
  // Datos completos
  lastResult: ElitePPGResult | null;
  measurementHistory: ElitePPGResult[];
  arrhythmiaEvents: ArrhythmiaResult[];
}

export interface EliteMeasurementActions {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
  processFrame: (imageData: ImageData, timestamp: number) => void;
  exportData: () => string;
}

export const useEliteMeasurement = (
  sessionDuration: number = 60,
  onArrhythmiaDetected?: (arrhythmia: ArrhythmiaResult) => void
): [EliteMeasurementState, EliteMeasurementActions] => {
  // Procesador único
  const processorRef = useRef<ElitePPGProcessor | null>(null);
  const timerRef = useRef<number | null>(null);
  
  // Estado
  const [state, setState] = useState<EliteMeasurementState>({
    isProcessing: false,
    isPaused: false,
    elapsedTime: 0,
    progress: 0,
    signalQuality: 0,
    fingerDetected: false,
    stability: 0,
    heartRate: 0,
    spo2: 0,
    systolicBP: 0,
    diastolicBP: 0,
    rmssd: 0,
    sdnn: 0,
    pnn50: 0,
    lfHfRatio: 0,
    sd1: 0,
    sd2: 0,
    arrhythmiaDetected: false,
    arrhythmiaType: null,
    arrhythmiaSeverity: null,
    arrhythmiaCount: 0,
    lastResult: null,
    measurementHistory: [],
    arrhythmiaEvents: []
  });
  
  // Inicializar procesador
  useEffect(() => {
    processorRef.current = new ElitePPGProcessor({
      minContactQuality: 60,
      minBeatSQI: 60,
      enableNonlinearHRV: true,
      enableFrequencyHRV: true,
      enableArrhythmiaDetection: true
    });
    
    // Callback de resultado
    processorRef.current.setResultCallback((result) => {
      setState(prev => {
        // Solo guardar en historial si calidad es buena
        const newHistory = result.finger.contactQuality > 50
          ? [...prev.measurementHistory.slice(-300), result]
          : prev.measurementHistory;
        
        return {
          ...prev,
          lastResult: result,
          signalQuality: result.finger.contactQuality,
          fingerDetected: result.finger.detected,
          stability: result.finger.stabilityScore,
          heartRate: result.beat.bpm,
          spo2: result.spo2,
          systolicBP: result.systolicBP,
          diastolicBP: result.diastolicBP,
          rmssd: result.hrvTime.rmssd,
          sdnn: result.hrvTime.sdnn,
          pnn50: result.hrvTime.pnn50,
          lfHfRatio: result.hrvFrequency?.lfHfRatio || 0,
          sd1: result.hrvNonlinear?.poincare.sd1 || 0,
          sd2: result.hrvNonlinear?.poincare.sd2 || 0,
          arrhythmiaDetected: result.arrhythmia.detected,
          arrhythmiaType: result.arrhythmia.type,
          arrhythmiaSeverity: result.arrhythmia.severity,
          measurementHistory: newHistory
        };
      });
    });
    
    // Callback de arritmias
    processorRef.current.setArrhythmiaCallback((arrhythmia) => {
      setState(prev => ({
        ...prev,
        arrhythmiaEvents: [...prev.arrhythmiaEvents, arrhythmia],
        arrhythmiaCount: prev.arrhythmiaCount + 1
      }));
      
      onArrhythmiaDetected?.(arrhythmia);
    });
    
    return () => {
      processorRef.current?.stop();
    };
  }, [onArrhythmiaDetected]);
  
  // Timer de sesión
  useEffect(() => {
    if (state.isProcessing && !state.isPaused) {
      timerRef.current = window.setInterval(() => {
        setState(prev => {
          const newTime = prev.elapsedTime + 1;
          const newProgress = (newTime / sessionDuration) * 100;
          
          // Auto-stop al completar
          if (newTime >= sessionDuration) {
            return {
              ...prev,
              isProcessing: false,
              elapsedTime: newTime,
              progress: 100
            };
          }
          
          return {
            ...prev,
            elapsedTime: newTime,
            progress: newProgress
          };
        });
      }, 1000) as unknown as number;
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [state.isProcessing, state.isPaused, sessionDuration]);
  
  // Acciones
  const start = useCallback(() => {
    processorRef.current?.start();
    setState(prev => ({
      ...prev,
      isProcessing: true,
      isPaused: false,
      elapsedTime: 0,
      progress: 0
    }));
  }, []);
  
  const pause = useCallback(() => {
    processorRef.current?.stop();
    setState(prev => ({ ...prev, isPaused: true }));
  }, []);
  
  const resume = useCallback(() => {
    processorRef.current?.start();
    setState(prev => ({ ...prev, isPaused: false }));
  }, []);
  
  const stop = useCallback(() => {
    processorRef.current?.stop();
    setState(prev => ({ ...prev, isProcessing: false, isPaused: false }));
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  }, []);
  
  const reset = useCallback(() => {
    processorRef.current?.reset();
    setState({
      isProcessing: false,
      isPaused: false,
      elapsedTime: 0,
      progress: 0,
      signalQuality: 0,
      fingerDetected: false,
      stability: 0,
      heartRate: 0,
      spo2: 0,
      systolicBP: 0,
      diastolicBP: 0,
      rmssd: 0,
      sdnn: 0,
      pnn50: 0,
      lfHfRatio: 0,
      sd1: 0,
      sd2: 0,
      arrhythmiaDetected: false,
      arrhythmiaType: null,
      arrhythmiaSeverity: null,
      arrhythmiaCount: 0,
      lastResult: null,
      measurementHistory: [],
      arrhythmiaEvents: []
    });
  }, []);
  
  const processFrame = useCallback((imageData: ImageData, timestamp: number) => {
    if (!state.isProcessing || state.isPaused) return;
    
    processorRef.current?.processFrame(imageData, timestamp);
  }, [state.isProcessing, state.isPaused]);
  
  const exportData = useCallback(() => {
    const data = {
      timestamp: new Date().toISOString(),
      sessionDuration: state.elapsedTime,
      vitals: {
        averageHR: state.heartRate,
        averageSpO2: state.spo2,
        averageSBP: state.systolicBP,
        averageDBP: state.diastolicBP
      },
      hrv: {
        rmssd: state.rmssd,
        sdnn: state.sdnn,
        pnn50: state.pnn50,
        lfHfRatio: state.lfHfRatio,
        sd1: state.sd1,
        sd2: state.sd2
      },
      arrhythmias: state.arrhythmiaEvents,
      history: state.measurementHistory.slice(-100)
    };
    
    return JSON.stringify(data, null, 2);
  }, [state]);
  
  const actions: EliteMeasurementActions = {
    start,
    pause,
    resume,
    stop,
    reset,
    processFrame,
    exportData
  };
  
  return [state, actions];
};

export default useEliteMeasurement;
