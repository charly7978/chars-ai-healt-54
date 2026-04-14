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

    if (heartRate <= 0 && vitalSigns.spo2 <= 0) {
      toast({
        title: "Datos insuficientes",
        description: "Se necesitan datos de medición válidos para el análisis.",
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
          heartRate: heartRate || 70,
          spo2: vitalSigns.spo2 || 97,
          systolic: vitalSigns.pressure?.systolic || 120,
          diastolic: vitalSigns.pressure?.diastolic || 80,
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
