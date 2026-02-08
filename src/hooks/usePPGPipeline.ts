import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  PPGPipeline, 
  ProcessedPPGFrame, 
  PipelineState,
  ConfidenceLevel 
} from '../modules/ppg-core';

/**
 * HOOK UNIFICADO DE PPG
 * 
 * Reemplaza:
 * - useSignalProcessor
 * - useHeartBeatProcessor
 * - useVitalSignsProcessor (parcialmente)
 * 
 * Características:
 * - Pipeline único optimizado
 * - 100% datos reales de cámara
 * - Zero simulación
 * - Estado centralizado
 */

export interface PPGPipelineState {
  // Estado del pipeline
  isCalibrating: boolean;
  calibrationProgress: number;
  isProcessing: boolean;
  
  // Datos vitales
  heartRate: number;
  spo2: number;
  perfusionIndex: number;
  
  // Calidad
  signalQuality: number;
  confidence: ConfidenceLevel;
  fingerDetected: boolean;
  
  // Señal para visualización
  filteredValue: number;
  isPeak: boolean;
  
  // HRV
  rrIntervals: number[];
  hrv: {
    sdnn: number;
    rmssd: number;
    pnn50: number;
  };
  
  // RGB Debug
  rgbStats: {
    redAC: number;
    redDC: number;
    greenAC: number;
    greenDC: number;
    ratioR: number;
  };
  
  // Frames procesados
  framesProcessed: number;
}

export const usePPGPipeline = () => {
  // Referencia al pipeline
  const pipelineRef = useRef<PPGPipeline | null>(null);
  
  // Estado
  const [state, setState] = useState<PPGPipelineState>({
    isCalibrating: false,
    calibrationProgress: 0,
    isProcessing: false,
    heartRate: 0,
    spo2: 0,
    perfusionIndex: 0,
    signalQuality: 0,
    confidence: 'INVALID',
    fingerDetected: false,
    filteredValue: 0,
    isPeak: false,
    rrIntervals: [],
    hrv: { sdnn: 0, rmssd: 0, pnn50: 0 },
    rgbStats: { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, ratioR: 0 },
    framesProcessed: 0
  });
  
  // Último frame para callbacks
  const lastFrameRef = useRef<ProcessedPPGFrame | null>(null);
  
  // Callbacks de eventos
  const onPeakRef = useRef<((timestamp: number, bpm: number) => void) | null>(null);
  
  // Inicializar pipeline
  useEffect(() => {
    // Crear pipeline con callback de frame
    const handleFrame = (frame: ProcessedPPGFrame) => {
      lastFrameRef.current = frame;
      
      // Actualizar estado (throttled)
      setState(prev => ({
        ...prev,
        isCalibrating: false, // Se actualiza por startCalibration
        heartRate: frame.smoothedBPM,
        spo2: frame.spo2,
        perfusionIndex: frame.perfusionIndex,
        signalQuality: frame.signalQuality.globalSQI,
        confidence: frame.confidence,
        fingerDetected: frame.fingerDetected,
        filteredValue: frame.filteredValue,
        isPeak: frame.isPeak,
        rrIntervals: frame.rrIntervals.slice(-10),
        hrv: frame.hrv,
        rgbStats: {
          redAC: frame.redAC,
          redDC: frame.redDC,
          greenAC: frame.greenAC,
          greenDC: frame.greenDC,
          ratioR: frame.ratioR
        },
        framesProcessed: prev.framesProcessed + 1
      }));
      
      // Callback de pico
      if (frame.isPeak && onPeakRef.current) {
        onPeakRef.current(frame.timestamp, frame.smoothedBPM);
      }
    };
    
    pipelineRef.current = new PPGPipeline({
      sampleRate: 30,
      onFrameProcessed: handleFrame
    });
    
    // Suscribirse a eventos
    pipelineRef.current.on('calibration_complete', () => {
      setState(prev => ({
        ...prev,
        isCalibrating: false,
        calibrationProgress: 100
      }));
    });
    
    console.log('✅ usePPGPipeline: Inicializado');
    
    return () => {
      if (pipelineRef.current) {
        pipelineRef.current.dispose();
        pipelineRef.current = null;
      }
    };
  }, []);
  
  /**
   * INICIAR PROCESAMIENTO
   */
  const start = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.start();
      setState(prev => ({ ...prev, isProcessing: true }));
    }
  }, []);
  
  /**
   * DETENER PROCESAMIENTO
   */
  const stop = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.stop();
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, []);
  
  /**
   * INICIAR CALIBRACIÓN ZLO
   */
  const startCalibration = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.startCalibration();
      setState(prev => ({
        ...prev,
        isCalibrating: true,
        calibrationProgress: 0
      }));
    }
  }, []);
  
  /**
   * FORZAR CALIBRACIÓN
   */
  const forceCalibration = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.forceCalibration();
      setState(prev => ({
        ...prev,
        isCalibrating: false,
        calibrationProgress: 100
      }));
    }
  }, []);
  
  /**
   * PROCESAR FRAME
   */
  const processFrame = useCallback((imageData: ImageData) => {
    if (pipelineRef.current) {
      return pipelineRef.current.processFrame(imageData);
    }
    return null;
  }, []);
  
  /**
   * OBTENER ESTADÍSTICAS RGB
   */
  const getRGBStats = useCallback(() => {
    if (pipelineRef.current) {
      return pipelineRef.current.getRGBStats();
    }
    return { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, ratioR: 0, perfusionIndex: 0 };
  }, []);
  
  /**
   * OBTENER RR INTERVALS
   */
  const getRRIntervals = useCallback(() => {
    if (pipelineRef.current) {
      return pipelineRef.current.getRRIntervals();
    }
    return [];
  }, []);
  
  /**
   * OBTENER ÚLTIMO FRAME
   */
  const getLastFrame = useCallback(() => {
    return lastFrameRef.current;
  }, []);
  
  /**
   * SET CALLBACK DE PICO
   */
  const setOnPeak = useCallback((callback: (timestamp: number, bpm: number) => void) => {
    onPeakRef.current = callback;
  }, []);
  
  /**
   * RESET COMPLETO
   */
  const reset = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.reset();
    }
    
    setState({
      isCalibrating: false,
      calibrationProgress: 0,
      isProcessing: false,
      heartRate: 0,
      spo2: 0,
      perfusionIndex: 0,
      signalQuality: 0,
      confidence: 'INVALID',
      fingerDetected: false,
      filteredValue: 0,
      isPeak: false,
      rrIntervals: [],
      hrv: { sdnn: 0, rmssd: 0, pnn50: 0 },
      rgbStats: { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, ratioR: 0 },
      framesProcessed: 0
    });
    
    lastFrameRef.current = null;
  }, []);
  
  /**
   * OBTENER ESTADO DEL PIPELINE
   */
  const getPipelineState = useCallback((): PipelineState | null => {
    if (pipelineRef.current) {
      return pipelineRef.current.getState();
    }
    return null;
  }, []);
  
  return {
    // Estado
    ...state,
    
    // Métodos de control
    start,
    stop,
    startCalibration,
    forceCalibration,
    reset,
    
    // Procesamiento
    processFrame,
    
    // Getters
    getRGBStats,
    getRRIntervals,
    getLastFrame,
    getPipelineState,
    
    // Callbacks
    setOnPeak
  };
};
