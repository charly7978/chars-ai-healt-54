import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VitalSignsResult } from '@/modules/vital-signs/VitalSignsProcessor';
import { toast } from '@/hooks/use-toast';
import { ALGORITHM_VERSION, MeasurementRecord } from '@/types/measurement';
import { HRVAnalyzer } from '@/modules/vital-signs/HRVAnalyzer';

interface MeasurementData {
  heartRate: number;
  vitalSigns: VitalSignsResult;
  signalQuality: number;
  rrIntervals?: number[];
  calibrationId?: string | null;
  windowSeconds?: number;
}

/**
 * Hook para guardar mediciones con trazabilidad completa
 * Persiste todas las métricas: vitales, HRV, lípidos, metadata de calidad y versión de algoritmo
 */
export const useSaveMeasurement = () => {
  const lastSaveTime = useRef<number>(0);

  const saveMeasurement = useCallback(async (data: MeasurementData): Promise<boolean> => {
    try {
      // Debounce: no guardar más de una vez por 5 segundos
      const now = Date.now();
      if (now - lastSaveTime.current < 5000) return false;

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.log('⚠️ Usuario no autenticado, medición no guardada');
        return false;
      }

      // Validar datos mínimos
      const hasValidData =
        data.heartRate > 30 ||
        data.vitalSigns.spo2 > 70 ||
        data.vitalSigns.pressure.systolic > 60;

      if (!hasValidData) {
        console.log('⚠️ Datos insuficientes para guardar');
        return false;
      }

      // Calcular HRV si hay intervalos RR
      let hrv: { sdnn: number; rmssd: number; pnn50: number; lfPower: number; hfPower: number; lfHfRatio: number } | null = null;
      if (data.rrIntervals && data.rrIntervals.length >= 6) {
        const hrvMetrics = HRVAnalyzer.compute(data.rrIntervals);
        if (hrvMetrics.isValid) {
          hrv = {
            sdnn: Math.round(hrvMetrics.sdnn * 10) / 10,
            rmssd: Math.round(hrvMetrics.rmssd * 10) / 10,
            pnn50: Math.round(hrvMetrics.pnn50 * 10) / 10,
            lfPower: Math.round(hrvMetrics.frequency.lfPower * 100) / 100,
            hfPower: Math.round(hrvMetrics.frequency.hfPower * 100) / 100,
            lfHfRatio: Math.round(hrvMetrics.frequency.lfHfRatio * 100) / 100,
          };
        }
      }

      const record: Partial<MeasurementRecord> = {
        user_id: user.id,
        heart_rate: Math.round(data.heartRate) || 0,
        spo2: Math.round(data.vitalSigns.spo2) || 0,
        systolic: Math.round(data.vitalSigns.pressure.systolic) || 0,
        diastolic: Math.round(data.vitalSigns.pressure.diastolic) || 0,
        arrhythmia_count: data.vitalSigns.arrhythmiaCount || 0,
        quality: Math.round(data.signalQuality) || 0,
        measured_at: new Date().toISOString(),
        algorithm_version: ALGORITHM_VERSION,
        measurement_window_seconds: data.windowSeconds ?? 60,
        signal_quality_index: Math.round(data.vitalSigns.signalQuality) || 0,
        measurement_confidence: data.vitalSigns.measurementConfidence || 'UNKNOWN',
        // Extended vitals
        glucose: data.vitalSigns.glucose > 0 ? Math.round(data.vitalSigns.glucose) : null,
        hemoglobin: data.vitalSigns.hemoglobin > 0 ? Math.round(data.vitalSigns.hemoglobin * 10) / 10 : null,
        total_cholesterol: data.vitalSigns.lipids.totalCholesterol > 0 ? Math.round(data.vitalSigns.lipids.totalCholesterol) : null,
        triglycerides: data.vitalSigns.lipids.triglycerides > 0 ? Math.round(data.vitalSigns.lipids.triglycerides) : null,
        // HRV
        sdnn: hrv?.sdnn ?? null,
        rmssd: hrv?.rmssd ?? null,
        pnn50: hrv?.pnn50 ?? null,
        lf_power: hrv?.lfPower ?? null,
        hf_power: hrv?.hfPower ?? null,
        lf_hf_ratio: hrv?.lfHfRatio ?? null,
        // Calibration reference
        calibration_id: data.calibrationId ?? null,
      };

      console.log('💾 Guardando medición completa:', record);

      const { error: insertError } = await supabase
        .from('measurements')
        .insert(record as any);

      if (insertError) {
        console.error('❌ Error guardando medición:', insertError);
        toast({
          title: "Error al guardar",
          description: "No se pudo guardar la medición",
          variant: "destructive",
          duration: 3000
        });
        return false;
      }

      lastSaveTime.current = now;
      console.log('✅ Medición guardada exitosamente');
      toast({
        title: "✅ Medición guardada",
        description: "Resultados guardados con trazabilidad completa",
        duration: 3000
      });
      return true;

    } catch (error) {
      console.error('❌ Error inesperado:', error);
      return false;
    }
  }, []);

  return { saveMeasurement };
};
