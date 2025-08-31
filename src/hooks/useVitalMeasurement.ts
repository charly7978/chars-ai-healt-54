
import { useState, useEffect } from 'react';

interface VitalMeasurements {
  heartRate: number;
  spo2: number | null;
  pressure: string;
  arrhythmiaCount: string | number;
}

export const useVitalMeasurement = (isMeasuring: boolean) => {
  const [measurements, setMeasurements] = useState<VitalMeasurements>({
    heartRate: 0,
    spo2: null,
    pressure: "--/--",
    arrhythmiaCount: 0
  });
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    console.log('🔍 useVitalMeasurement - Estado ÚNICO:', {
      isMeasuring,
      currentMeasurements: measurements,
      elapsedTime,
      timestamp: new Date().toISOString()
    });

    if (!isMeasuring) {
      console.log('🔄 useVitalMeasurement - RESET completo por detención');
      
      setMeasurements({
        heartRate: 0,
        spo2: null,
        pressure: "--/--",
        arrhythmiaCount: 0
      });
      
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    console.log('🚀 useVitalMeasurement - Iniciando medición ÚNICA', {
      startTime: new Date(startTime).toISOString()
    });
    
    const MEASUREMENT_DURATION = 30000;

    const updateMeasurements = () => {
      // FUENTE ÚNICA DE DATOS - HeartBeatProcessor
      const heartProcessor = (window as any).heartBeatProcessor;
      
      if (!heartProcessor) {
        console.warn('⚠️ VitalMeasurement: HeartBeatProcessor no disponible');
        return;
      }

      // OBTENER DATOS DIRECTAMENTE DEL PROCESADOR PRINCIPAL
      const bpm = Math.round(heartProcessor.getFinalBPM() || 0);
      const spo2Value = heartProcessor.getSpo2?.();
      const spo2 = typeof spo2Value === 'number' ? Math.round(spo2Value) : null;
      const systolic = Math.round(heartProcessor.getSystolicPressure?.() || 0);
      const diastolic = Math.round(heartProcessor.getDiastolicPressure?.() || 0);
      const arrhythmias = heartProcessor.getArrhythmiaCount?.() || 0;

      console.log('📊 useVitalMeasurement - Datos del procesador ÚNICO:', {
        bpm,
        spo2,
        systolic,
        diastolic,
        arrhythmias,
        timestamp: new Date().toISOString()
      });

      setMeasurements(prev => {
        const newMeasurements = {
          heartRate: bpm,
          spo2: spo2,
          pressure: (systolic > 0 && diastolic > 0) ? `${systolic}/${diastolic}` : "--/--",
          arrhythmiaCount: arrhythmias
        };

        // Solo actualizar si hay cambios significativos
        const hasChanges = 
          prev.heartRate !== newMeasurements.heartRate ||
          prev.spo2 !== newMeasurements.spo2 ||
          prev.pressure !== newMeasurements.pressure ||
          prev.arrhythmiaCount !== newMeasurements.arrhythmiaCount;

        if (hasChanges) {
          console.log('✅ useVitalMeasurement - Actualizando mediciones:', {
            cambios: {
              bpm: `${prev.heartRate} → ${newMeasurements.heartRate}`,
              spo2: `${prev.spo2} → ${newMeasurements.spo2}`,
              presión: `${prev.pressure} → ${newMeasurements.pressure}`,
              arritmias: `${prev.arrhythmiaCount} → ${newMeasurements.arrhythmiaCount}`
            }
          });
          return newMeasurements;
        }

        return prev;
      });
    };

    // Actualización inicial
    updateMeasurements();

    const interval = setInterval(() => {
      const currentTime = Date.now();
      const elapsed = currentTime - startTime;
      
      console.log('⏱️ useVitalMeasurement - Progreso:', {
        elapsed: (elapsed / 1000).toFixed(1),
        porcentaje: ((elapsed / MEASUREMENT_DURATION) * 100).toFixed(1)
      });
      
      setElapsedTime(elapsed / 1000);
      updateMeasurements();

      if (elapsed >= MEASUREMENT_DURATION) {
        console.log('🏁 useVitalMeasurement - Medición COMPLETADA');
        clearInterval(interval);
        const event = new CustomEvent('measurementComplete');
        window.dispatchEvent(event);
      }
    }, 100); // Actualización más frecuente para mejor responsividad

    return () => {
      console.log('🧹 useVitalMeasurement - Limpiando intervalo');
      clearInterval(interval);
    };
  }, [isMeasuring]);

  return {
    ...measurements,
    elapsedTime: Math.min(elapsedTime, 30),
    isComplete: elapsedTime >= 30
  };
};
