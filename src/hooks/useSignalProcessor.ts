
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

  if (!mgrRef.current) {
    mgrRef.current = new MultiChannelManager(channels, windowSec);
    console.log('🏭 MultiChannelManager CREADO:', { channels, windowSec });
  }

  const handleSample = (s: CameraSample) => {
    sampleCountRef.current++;
    
    // CRÍTICO: Usar canal ROJO directamente - es el mejor para PPG
    // Valores ya están en rango 0-255 desde CameraView
    const inputSignal = s.rMean;
    
    // Log detallado cada 30 muestras para debug
    if (sampleCountRef.current % 30 === 0) {
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
    const result = mgrRef.current!.analyzeAll(s.coverageRatio, s.frameDiff);
    
    // Log resultado cada 50 muestras o cuando hay detección
    if (result.fingerDetected || sampleCountRef.current % 50 === 0) {
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
      aggregatedBPM: lastResult.aggregatedBPM
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
