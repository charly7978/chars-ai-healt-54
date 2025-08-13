import { useState, useCallback, useRef, useEffect } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

interface IntegratedVitalData {
  // Datos básicos
  heartRate: number;
  signalQuality: number;
  confidence: number;
  
  // Signos vitales
  spo2: number;
  pressure: string;
  glucose: number;
  hemoglobin: number;
  lipids: {
    totalCholesterol: number;
    triglycerides: number;
  };
  
  // Estado
  isProcessing: boolean;
  arrhythmiaCount: number;
  arrhythmiaStatus: string;
}

export const useIntegratedVitalProcessor = () => {
  // Procesadores
  const heartProcessor = useRef(new HeartBeatProcessor());
  const vitalProcessor = useRef(new VitalSignsProcessor());
  
  // Estado
  const [vitalData, setVitalData] = useState<IntegratedVitalData>({
    heartRate: 0,
    signalQuality: 0,
    confidence: 0,
    spo2: 0,
    pressure: "--/--",
    glucose: 0,
    hemoglobin: 0,
    lipids: { totalCholesterol: 0, triglycerides: 0 },
    isProcessing: false,
    arrhythmiaCount: 0,
    arrhythmiaStatus: "NORMAL"
  });
  
  const [isCalibrating, setIsCalibrating] = useState(false);
  const frameCount = useRef(0);
  const lastUpdate = useRef(0);
  
  // Procesar señal PPG integrada
  const processSignal = useCallback((ppgValue: number) => {
    frameCount.current++;
    const now = Date.now();
    
    // Procesar con HeartBeatProcessor
    const heartResult = heartProcessor.current.processSignal(ppgValue);
    
    // Obtener datos RR para arritmias
    const rrData = heartProcessor.current.getRRIntervals();
    
    // Procesar con VitalSignsProcessor cada 5 frames para eficiencia
    let vitalResult: VitalSignsResult | null = null;
    if (frameCount.current % 5 === 0) {
      vitalResult = vitalProcessor.current.processSignal(ppgValue, rrData);
    }
    
    // Actualizar estado cada 200ms para suavidad
    if (now - lastUpdate.current > 200) {
      setVitalData(prev => {
        const newData: IntegratedVitalData = {
          // Datos del corazón (siempre actualizados)
          heartRate: heartResult.bpm,
          signalQuality: heartResult.signalQuality || prev.signalQuality,
          confidence: heartResult.confidence,
          
          // Signos vitales (actualizados si hay resultado nuevo)
          spo2: vitalResult?.spo2 || prev.spo2,
          pressure: vitalResult?.pressure || prev.pressure,
          glucose: vitalResult?.glucose || prev.glucose,
          hemoglobin: vitalResult?.hemoglobin || prev.hemoglobin,
          lipids: vitalResult?.lipids || prev.lipids,
          
          // Estado
          isProcessing: true,
          arrhythmiaCount: prev.arrhythmiaCount,
          arrhythmiaStatus: vitalResult?.arrhythmiaStatus || prev.arrhythmiaStatus
        };
        
        // Log cada 30 frames para debug
        if (frameCount.current % 30 === 0) {
          console.log("IntegratedVitalProcessor: Estado actualizado", {
            frame: frameCount.current,
            heartRate: newData.heartRate,
            signalQuality: newData.signalQuality,
            spo2: newData.spo2,
            pressure: newData.pressure,
            glucose: newData.glucose,
            ppgValue: ppgValue.toFixed(2)
          });
        }
        
        return newData;
      });
      
      lastUpdate.current = now;
    }
    
    // Detectar arritmias
    if (heartResult.isPeak && rrData.intervals.length >= 3) {
      const intervals = rrData.intervals.slice(-3);
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const lastInterval = intervals[intervals.length - 1];
      const variation = Math.abs(lastInterval - avgInterval) / avgInterval;
      
      if (variation > 0.25) { // 25% de variación indica posible arritmia
        setVitalData(prev => ({
          ...prev,
          arrhythmiaCount: prev.arrhythmiaCount + 1,
          arrhythmiaStatus: `ARRITMIA DETECTADA (${prev.arrhythmiaCount + 1})`
        }));
        
        console.log("IntegratedVitalProcessor: Arritmia detectada", {
          variation: (variation * 100).toFixed(1) + "%",
          intervals,
          avgInterval: avgInterval.toFixed(0) + "ms"
        });
      }
    }
    
  }, []);
  
  // Iniciar calibración
  const startCalibration = useCallback(() => {
    console.log("IntegratedVitalProcessor: Iniciando calibración completa");
    setIsCalibrating(true);
    vitalProcessor.current.startCalibration();
    
    // Auto-completar calibración después de 5 segundos
    setTimeout(() => {
      setIsCalibrating(false);
      console.log("IntegratedVitalProcessor: Calibración completada");
    }, 5000);
  }, []);
  
  // Resetear todo
  const reset = useCallback(() => {
    console.log("IntegratedVitalProcessor: Reset completo");
    
    heartProcessor.current.reset();
    vitalProcessor.current.fullReset();
    frameCount.current = 0;
    lastUpdate.current = 0;
    
    setVitalData({
      heartRate: 0,
      signalQuality: 0,
      confidence: 0,
      spo2: 0,
      pressure: "--/--",
      glucose: 0,
      hemoglobin: 0,
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isProcessing: false,
      arrhythmiaCount: 0,
      arrhythmiaStatus: "NORMAL"
    });
    
    setIsCalibrating(false);
  }, []);
  
  // Parar procesamiento
  const stop = useCallback(() => {
    console.log("IntegratedVitalProcessor: Deteniendo procesamiento");
    setVitalData(prev => ({ ...prev, isProcessing: false }));
  }, []);
  
  return {
    vitalData,
    isCalibrating,
    processSignal,
    startCalibration,
    reset,
    stop,
    
    // Métodos adicionales para compatibilidad
    getFinalBPM: useCallback(() => heartProcessor.current.getFinalBPM(), []),
    getSignalQuality: useCallback(() => heartProcessor.current.getSignalQuality(), [])
  };
};