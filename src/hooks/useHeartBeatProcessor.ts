import { useState, useEffect, useCallback, useRef } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

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
 * HOOK DE PROCESAMIENTO CARDÍACO - CON CALIBRACIÓN AUTOMÁTICA
 * 
 * Durante los primeros 5 segundos, el procesador calibra los umbrales
 * basándose en las características de la señal del usuario.
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(true);
  const [calibrationProgress, setCalibrationProgress] = useState<number>(0);
  
  const sessionIdRef = useRef<string>("");
  const processingStateRef = useRef<'IDLE' | 'ACTIVE' | 'RESETTING'>('IDLE');
  const lastProcessTimeRef = useRef<number>(0);
  const processedSignalsRef = useRef<number>(0);
  const calibrationIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `hb_${t}_${p}`;
    
    processorRef.current = new HeartBeatProcessor();
    processingStateRef.current = 'ACTIVE';
    
    // Monitorear progreso de calibración
    calibrationIntervalRef.current = window.setInterval(() => {
      if (processorRef.current) {
        const progress = processorRef.current.getCalibrationProgress();
        setCalibrationProgress(progress);
        setIsCalibrating(!processorRef.current.isCalibrationComplete());
        
        if (processorRef.current.isCalibrationComplete() && calibrationIntervalRef.current) {
          clearInterval(calibrationIntervalRef.current);
          calibrationIntervalRef.current = null;
        }
      }
    }, 200);
    
    return () => {
      if (calibrationIntervalRef.current) {
        clearInterval(calibrationIntervalRef.current);
      }
      if (processorRef.current) {
        processorRef.current.dispose();
        processorRef.current = null;
      }
      processingStateRef.current = 'IDLE';
    };
  }, []);

  const processSignal = useCallback((value: number, _fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      return {
        bpm: currentBPM,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    const currentTime = Date.now();
    
    // Control de tasa (~60 FPS)
    if (currentTime - lastProcessTimeRef.current < 16) {
      return {
        bpm: currentBPM,
        confidence,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }
    
    lastProcessTimeRef.current = currentTime;
    processedSignalsRef.current++;

    // Procesar señal
    const result = processorRef.current.processSignal(value, timestamp);
    const rrIntervals = processorRef.current.getRRIntervals();
    const lastPeakTime = processorRef.current.getLastPeakTime();
    const rrData = { intervals: rrIntervals, lastPeakTime };

    // Actualizar BPM solo después de calibración
    if (processorRef.current.isCalibrationComplete()) {
      if (result.confidence >= 0.3 && result.bpm >= 40 && result.bpm <= 180) {
        const smoothingFactor = Math.min(0.5, result.confidence * 0.7);
        const newBPM = currentBPM > 0 ? 
          currentBPM * (1 - smoothingFactor) + result.bpm * smoothingFactor : 
          result.bpm;
        
        setCurrentBPM(Math.round(newBPM * 10) / 10);
        setConfidence(result.confidence);
      }
    }

    return {
      bpm: result.bpm,
      confidence: result.confidence,
      isPeak: result.isPeak,
      arrhythmiaCount: result.arrhythmiaCount,
      signalQuality: signalQuality,
      rrData
    };
  }, [currentBPM, confidence, signalQuality]);

  const reset = useCallback(() => {
    if (processingStateRef.current === 'RESETTING') return;
    
    processingStateRef.current = 'RESETTING';
    
    if (processorRef.current) {
      processorRef.current.reset();
    }
    
    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
    setIsCalibrating(true);
    setCalibrationProgress(0);
    
    lastProcessTimeRef.current = 0;
    processedSignalsRef.current = 0;
    
    // Reiniciar monitoreo de calibración
    if (calibrationIntervalRef.current) {
      clearInterval(calibrationIntervalRef.current);
    }
    calibrationIntervalRef.current = window.setInterval(() => {
      if (processorRef.current) {
        const progress = processorRef.current.getCalibrationProgress();
        setCalibrationProgress(progress);
        setIsCalibrating(!processorRef.current.isCalibrationComplete());
        
        if (processorRef.current.isCalibrationComplete() && calibrationIntervalRef.current) {
          clearInterval(calibrationIntervalRef.current);
          calibrationIntervalRef.current = null;
        }
      }
    }, 200);
    
    processingStateRef.current = 'ACTIVE';
  }, []);

  const recalibrate = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.recalibrate();
      setIsCalibrating(true);
      setCalibrationProgress(0);
      
      // Reiniciar monitoreo
      if (calibrationIntervalRef.current) {
        clearInterval(calibrationIntervalRef.current);
      }
      calibrationIntervalRef.current = window.setInterval(() => {
        if (processorRef.current) {
          const progress = processorRef.current.getCalibrationProgress();
          setCalibrationProgress(progress);
          setIsCalibrating(!processorRef.current.isCalibrationComplete());
          
          if (processorRef.current.isCalibrationComplete() && calibrationIntervalRef.current) {
            clearInterval(calibrationIntervalRef.current);
            calibrationIntervalRef.current = null;
          }
        }
      }, 200);
    }
  }, []);

  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    if (processorRef.current && processingStateRef.current === 'ACTIVE') {
      processorRef.current.setArrhythmiaDetected(isArrhythmiaDetected);
    }
  }, []);

  return {
    currentBPM,
    confidence,
    signalQuality,
    isCalibrating,
    calibrationProgress,
    processSignal,
    reset,
    recalibrate,
    setArrhythmiaState,
    debugInfo: {
      sessionId: sessionIdRef.current,
      processingState: processingStateRef.current,
      processedSignals: processedSignalsRef.current
    }
  };
};
