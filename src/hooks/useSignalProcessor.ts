
import { useMemo, useRef, useState } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { CameraSample, MultiChannelResult } from '@/types';

/**
 * Hook CORREGIDO que maneja el flujo completo CameraView -> MultiChannelManager
 * ARREGLADO: Transporte correcto de valores, escalado adecuado, logging detallado
 */

export function useSignalProcessor(windowSec = 8, channels = 6) {
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);
  const sampleCountRef = useRef(0);
  const lastEnvRef = useRef<{ fingerConfidence: number; exposureState: CameraSample['exposureState'] } | null>(null);
  const lastAnalyzeTimeRef = useRef<number>(0);
  const analyzeIntervalMsRef = useRef<number>(33); // ~30 Hz para mejor sincronización con la cámara

  if (!mgrRef.current) {
    mgrRef.current = new MultiChannelManager(channels, windowSec);
    console.log('🏭 MultiChannelManager CREADO:', { channels, windowSec });
  }

  const handleSample = (s: CameraSample) => {
    sampleCountRef.current++;
    // Protección contra muestras inválidas o NaN
    if (!isFinite(s.rMean) || !isFinite(s.gMean) || !isFinite(s.bMean)) {
      return;
    }
    
    // Guardar estado de captura para UI/ajustes globales
    lastEnvRef.current = {
      fingerConfidence: typeof s.fingerConfidence === 'number' ? s.fingerConfidence : 0,
      exposureState: s.exposureState
    };
    
    // Extracción PROFESIONAL de señal PPG
    // Método basado en literatura: maximizar componente pulsátil
    const rNorm = s.rMean / Math.max(s.rMean + s.gMean + s.bMean, 1);
    const gNorm = s.gMean / Math.max(s.rMean + s.gMean + s.bMean, 1);
    
    // Señal PPG óptima: enfatizar cambios en absorción de hemoglobina
    const ppgSignal = s.rMean - 0.7 * s.gMean; // Verde ayuda a eliminar artefactos
    
    // Normalizar manteniendo rango dinámico
    const inputSignal = Math.max(0, Math.min(255, 128 + (ppgSignal - 128) * 1.2));
    
    // Log detallado MUY ocasional para debug
    if (sampleCountRef.current % 600 === 0) {
      console.log('📊 useSignalProcessor - Muestra #' + sampleCountRef.current + ':', {
        timestamp: new Date(s.timestamp).toLocaleTimeString(),
        inputSignal: inputSignal.toFixed(1),
        rMean: s.rMean.toFixed(1),
        gMean: s.gMean.toFixed(1),
        bMean: s.bMean.toFixed(1),
        rStd: s.rStd.toFixed(1),
        coverageRatio: (s.coverageRatio * 100).toFixed(1) + '%',
        frameDiff: s.frameDiff.toFixed(1),
        brightnessMean: s.brightnessMean.toFixed(1)
      });
    }

    // CRÍTICO: Enviar muestra al MultiChannelManager
    mgrRef.current!.pushSample(inputSignal, s.timestamp);
    
    // CRÍTICO: Analizar con métricas globales correctas
    // Ajuste de cobertura y movimiento usando métricas adicionales y confianza
    const confidence = lastEnvRef.current?.fingerConfidence ?? 0;
    const exposure = lastEnvRef.current?.exposureState;
    
    let coverageBoost = (s.redFraction > 0.42 && s.rgRatio > 1.1 && s.rgRatio < 4.0) ? 1.2 : 0.85;
    coverageBoost *= (s.saturationRatio < 0.15) ? 1.0 : 0.75;
    coverageBoost *= 0.8 + 0.4 * confidence; // 0.8..1.2
    
    if (exposure === 'dark') coverageBoost *= 0.75;
    if (exposure === 'saturated') coverageBoost *= 0.7;
    if (exposure === 'low_coverage') coverageBoost *= 0.6;
    
    const adjustedCoverage = Math.max(0, Math.min(1, s.coverageRatio * coverageBoost));
    
    // Suavizar el movimiento derivado del brillo
    let motion = s.frameDiff + (s.brightnessStd > 8 ? 6 : 0);
    if (exposure === 'moving') motion += 8;
    const adjustedMotion = motion;
    
    // Guardar métricas globales para uso continuo
    lastEnvRef.current = {
      ...lastEnvRef.current,
      fingerConfidence: typeof s.fingerConfidence === 'number' ? s.fingerConfidence : 0,
      exposureState: s.exposureState,
      lastCoverage: adjustedCoverage,
      lastMotion: adjustedMotion
    } as any;
    // CRÍTICO: Siempre ejecutar el análisis para mantener sincronización
    // El problema era que si no se ejecutaba el análisis, los buffers internos
    // seguían actualizándose pero el resultado mostrado quedaba desactualizado
    const coverageForAnalysis = (lastEnvRef.current as any)?.lastCoverage ?? adjustedCoverage;
    const motionForAnalysis = (lastEnvRef.current as any)?.lastMotion ?? adjustedMotion;
    const result = mgrRef.current!.analyzeAll(coverageForAnalysis, motionForAnalysis);
    
    // Solo actualizar el estado de React con throttling para evitar re-renders excesivos
    const now = performance.now();
    if (now - lastAnalyzeTimeRef.current >= analyzeIntervalMsRef.current || !lastResult) {
      lastAnalyzeTimeRef.current = now;
      
      // Log resultado muy ocasional o cuando hay detección
      if (result.fingerDetected || sampleCountRef.current % 600 === 0) {
        const activeChannels = result.channels.filter(c => c.isFingerDetected).length;
        const bestChannel = result.channels.reduce((best, current) => 
          current.quality > best.quality ? current : best, result.channels[0]);
        
        console.log('🔍 useSignalProcessor - Resultado:', {
          fingerDetected: result.fingerDetected,
          aggregatedBPM: result.aggregatedBPM,
          aggregatedQuality: result.aggregatedQuality,
          activeChannels: `${activeChannels}/${result.channels.length}`,
          bestChannelId: bestChannel.channelId,
          bestChannelQuality: bestChannel.quality.toFixed(1),
          bestChannelSNR: bestChannel.snr.toFixed(2),
          bestChannelBPM: bestChannel.bpm || 'null'
        });
      }
      setLastResult(result);
    }
  };

  const adjustChannelGain = (channelId: number, deltaRel: number) => {
    if (!mgrRef.current) return;
    
    console.log(`🔧 Ajustando ganancia canal ${channelId}: ${deltaRel > 0 ? '+' : ''}${(deltaRel * 100).toFixed(1)}%`);
    
    mgrRef.current.adjustChannelGain(channelId, deltaRel);
    
    // Re-analizar después del ajuste
    const result = mgrRef.current.analyzeAll(0, 0);
    setLastResult(result);
  };

  const reset = () => {
    if (!mgrRef.current) return;
    
    console.log('🔄 useSignalProcessor - RESET completo');
    mgrRef.current.reset();
    setLastResult(null);
    sampleCountRef.current = 0;
  };

  const getStats = () => {
    if (!lastResult) return null;
    
    const activeChannels = lastResult.channels.filter(c => c.isFingerDetected).length;
    const avgSNR = lastResult.channels.reduce((sum, c) => sum + c.snr, 0) / lastResult.channels.length;
    const avgQuality = lastResult.channels.reduce((sum, c) => sum + c.quality, 0) / lastResult.channels.length;
    
    return {
      totalSamples: sampleCountRef.current,
      activeChannels,
      totalChannels: lastResult.channels.length,
      avgSNR: avgSNR.toFixed(2),
      avgQuality: avgQuality.toFixed(1),
      fingerDetected: lastResult.fingerDetected,
      aggregatedBPM: lastResult.aggregatedBPM,
      fingerConfidence: lastEnvRef.current?.fingerConfidence ?? 0,
      exposureState: lastEnvRef.current?.exposureState ?? 'ok'
    };
  };

  return useMemo(() => ({ 
    handleSample, 
    lastResult, 
    adjustChannelGain,
    reset,
    getStats
  }), [lastResult]);
}
