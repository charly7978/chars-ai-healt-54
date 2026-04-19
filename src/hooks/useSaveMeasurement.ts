import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VitalSignsResult } from '@/modules/vital-signs/VitalSignsProcessor';
import { toast } from '@/hooks/use-toast';
import { OutputStatus } from '@/types/measurement';

interface MeasurementData {
  heartRate: number;
  vitalSigns: VitalSignsResult;
  signalQuality: number;
}

/**
 * Hook para guardar mediciones en la base de datos
 * Solo guarda si el usuario está autenticado y hay datos válidos
 */
export const useSaveMeasurement = () => {
  
  const saveMeasurement = useCallback(async (data: MeasurementData): Promise<boolean> => {
    try {
      // Verificar autenticación
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        console.log('⚠️ Usuario no autenticado, medición no guardada');
        return false;
      }
      
      const spo2Operational =
        data.vitalSigns.spo2Detail?.status === OutputStatus.OK ||
        data.vitalSigns.spo2Detail?.status === OutputStatus.LOW_QUALITY;
      const bpOperational =
        data.vitalSigns.pressure.status === 'ok' ||
        data.vitalSigns.pressure.status === 'low_quality';
      const hasValidData =
        data.heartRate > 30 ||
        (spo2Operational && data.vitalSigns.spo2 > 70) ||
        (bpOperational && data.vitalSigns.pressure.systolic > 60);
      
      if (!hasValidData) {
        console.log('⚠️ Datos insuficientes para guardar');
        return false;
      }
      
      // Preparar datos para inserción
      const measurementRecord = {
        user_id: user.id,
        heart_rate: Math.round(data.heartRate) || 0,
        spo2: spo2Operational ? Math.round(data.vitalSigns.spo2) || 0 : 0,
        systolic: bpOperational ? Math.round(data.vitalSigns.pressure.systolic) || 0 : 0,
        diastolic: bpOperational ? Math.round(data.vitalSigns.pressure.diastolic) || 0 : 0,
        arrhythmia_count: data.vitalSigns.arrhythmiaCount || 0,
        quality: Math.round(data.signalQuality) || 0,
        measurement_confidence: data.vitalSigns.measurementConfidence,
        signal_quality_index: Math.round(data.vitalSigns.signalQuality) || 0,
        sdnn: data.vitalSigns.hrv ? Math.round(data.vitalSigns.hrv.time.sdnn) : null,
        rmssd: data.vitalSigns.hrv ? Math.round(data.vitalSigns.hrv.time.rmssd) : null,
        pnn50: data.vitalSigns.hrv ? data.vitalSigns.hrv.time.pnn50 : null,
        lf_power: data.vitalSigns.hrv ? data.vitalSigns.hrv.freq.lfPower : null,
        hf_power: data.vitalSigns.hrv ? data.vitalSigns.hrv.freq.hfPower : null,
        lf_hf_ratio: data.vitalSigns.hrv ? data.vitalSigns.hrv.freq.lfHfRatio : null,
        glucose:
          data.vitalSigns.glucoseDetail?.status === OutputStatus.RESEARCH_ONLY && data.vitalSigns.glucose > 0
            ? Math.round(data.vitalSigns.glucose)
            : null,
        total_cholesterol:
          data.vitalSigns.lipidsDetail?.status === OutputStatus.RESEARCH_ONLY &&
          (data.vitalSigns.lipids.totalCholesterol ?? 0) > 0
            ? Math.round(data.vitalSigns.lipids.totalCholesterol)
            : null,
        triglycerides:
          data.vitalSigns.lipidsDetail?.status === OutputStatus.RESEARCH_ONLY &&
          (data.vitalSigns.lipids.triglycerides ?? 0) > 0
            ? Math.round(data.vitalSigns.lipids.triglycerides)
            : null,
        hemoglobin:
          data.vitalSigns.hemoglobin && typeof data.vitalSigns.hemoglobin.value === 'number'
            ? data.vitalSigns.hemoglobin.value
            : null,
        measured_at: new Date().toISOString()
      };
      
      console.log('💾 Guardando medición:', measurementRecord);
      
      const { error: insertError } = await supabase
        .from('measurements')
        .insert(measurementRecord);
      
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
      
      console.log('✅ Medición guardada exitosamente');
      toast({
        title: "✅ Medición guardada",
        description: "Los resultados se guardaron en tu historial",
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
