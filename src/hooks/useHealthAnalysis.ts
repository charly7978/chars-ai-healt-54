import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VitalSignsResult } from '@/modules/vital-signs/VitalSignsProcessor';
import { toast } from '@/hooks/use-toast';

interface AnalysisInput {
  heartRate: number;
  vitalSigns: VitalSignsResult;
  quality: number;
}

export const useHealthAnalysis = () => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyzeVitals = useCallback(async (data: AnalysisInput) => {
    if (isAnalyzing) return;

    const { heartRate, vitalSigns, quality } = data;

    const hasHeartRate = Number.isFinite(heartRate) && heartRate > 0;
    const hasSpo2 = Number.isFinite(vitalSigns.spo2) && vitalSigns.spo2 > 0;
    const hasPressure = Number.isFinite(vitalSigns.pressure?.systolic) &&
      Number.isFinite(vitalSigns.pressure?.diastolic) &&
      (vitalSigns.pressure?.systolic ?? 0) > 0 &&
      (vitalSigns.pressure?.diastolic ?? 0) > 0;

    // Regla anti-simulación: no enviar valores por defecto inventados al backend.
    // Si falta alguna señal núcleo (HR/SpO2/BP) se bloquea el análisis AI.
    if (!hasHeartRate || !hasSpo2 || !hasPressure) {
      toast({
        title: "Datos insuficientes",
        description: "Se requieren HR, SpO2 y presión arterial reales para analizar.",
        variant: "destructive",
        duration: 3000
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const { data: result, error } = await supabase.functions.invoke('analyze-vitals', {
        body: {
          heartRate,
          spo2: vitalSigns.spo2,
          systolic: vitalSigns.pressure.systolic,
          diastolic: vitalSigns.pressure.diastolic,
          arrhythmiaCount: vitalSigns.arrhythmiaCount || 0,
          glucose: vitalSigns.glucose || undefined,
          
          totalCholesterol: vitalSigns.lipids?.totalCholesterol || undefined,
          triglycerides: vitalSigns.lipids?.triglycerides || undefined,
          quality,
          confidence: vitalSigns.measurementConfidence,
        }
      });

      if (error) {
        throw new Error(error.message || 'Error al analizar');
      }

      setAnalysis(result.analysis);
    } catch (err: any) {
      console.error('Error análisis AI:', err);
      const msg = err?.message || 'Error desconocido';
      if (msg.includes('429') || msg.includes('rate')) {
        toast({ title: "Demasiadas solicitudes", description: "Intenta de nuevo en unos segundos.", variant: "destructive", duration: 4000 });
      } else if (msg.includes('402') || msg.includes('payment') || msg.includes('créditos')) {
        toast({ title: "Créditos agotados", description: "Añade créditos para usar el análisis AI.", variant: "destructive", duration: 4000 });
      } else {
        toast({ title: "Error de análisis", description: msg, variant: "destructive", duration: 4000 });
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing]);

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
  }, []);

  return { analysis, isAnalyzing, analyzeVitals, clearAnalysis };
};
