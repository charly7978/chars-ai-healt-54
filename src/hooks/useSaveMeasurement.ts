import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VitalSignsResult } from '@/modules/vital-signs/VitalSignsProcessor';
import { toast } from '@/hooks/use-toast';

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
      
      // Validar que hay datos significativos para guardar
      const hasValidData = 
        data.heartRate > 30 || 
        data.vitalSigns.spo2 > 70 ||
        data.vitalSigns.pressure.systolic > 60;
      
      if (!hasValidData) {
        console.log('⚠️ Datos insuficientes para guardar');
        return false;
      }
      
      // Preparar datos para inserción
      const measurementRecord = {
        user_id: user.id,
        heart_rate: Math.round(data.heartRate) || 0,
        spo2: Math.round(data.vitalSigns.spo2) || 0,
        systolic: Math.round(data.vitalSigns.pressure.systolic) || 0,
        diastolic: Math.round(data.vitalSigns.pressure.diastolic) || 0,
        arrhythmia_count: data.vitalSigns.arrhythmiaCount || 0,
        quality: Math.round(data.signalQuality) || 0,
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
