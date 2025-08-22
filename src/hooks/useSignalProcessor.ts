
import { useMemo, useRef, useState, useCallback } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { CameraSample, MultiChannelResult } from '@/types';

export function useSignalProcessor(windowSec = 8, channels = 6) {
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);
  const sampleCountRef = useRef(0);

  // INICIALIZACIÓN ÚNICA - Sin re-creaciones
  if (!mgrRef.current) {
    mgrRef.current = new MultiChannelManager(channels, windowSec);
    console.log('🏭 MultiChannelManager OPTIMIZADO creado:', { channels, windowSec });
  }

  // CALLBACK OPTIMIZADO - Sin dependencias innecesarias
  const handleSample = useCallback((s: CameraSample) => {
    if (!mgrRef.current) return;
    
    sampleCountRef.current++;
    
    // USAR CANAL ROJO DIRECTO - Mejor para PPG
    const inputSignal = s.rMean;
    
    // LOGGING OPTIMIZADO - Menos frecuente
    if (sampleCountRef.current % 50 === 0) {
      console.log('📊 Procesando muestra #' + sampleCountRef.current + ':', {
        rMean: inputSignal.toFixed(1),
        coverageRatio: (s.coverageRatio * 100).toFixed(1) + '%',
        frameDiff: s.frameDiff.toFixed(1)
      });
    }

    // PROCESAMIENTO DIRECTO
    mgrRef.current.pushSample(inputSignal, s.timestamp);
    const result = mgrRef.current.analyzeAll(s.coverageRatio, s.frameDiff);
    
    // LOGGING CONDICIONAL - Solo cuando hay detección o cada 100 muestras
    if (result.fingerDetected || sampleCountRef.current % 100 === 0) {
      const activeChannels = result.channels.filter(c => c.isFingerDetected).length;
      console.log('🔍 Resultado optimizado:', {
        fingerDetected: result.fingerDetected,
        bpm: result.aggregatedBPM,
        quality: result.aggregatedQuality,
        activeChannels: `${activeChannels}/${result.channels.length}`
      });
    }
    
    setLastResult(result);
  }, []);

  const adjustChannelGain = useCallback((channelId: number, deltaRel: number) => {
    if (!mgrRef.current) return;
    mgrRef.current.adjustChannelGain(channelId, deltaRel);
    const result = mgrRef.current.analyzeAll(0, 0);
    setLastResult(result);
  }, []);

  const reset = useCallback(() => {
    if (!mgrRef.current) return;
    console.log('🔄 Reset optimizado');
    mgrRef.current.reset();
    setLastResult(null);
    sampleCountRef.current = 0;
  }, []);

  const getStats = useCallback(() => {
    if (!lastResult) return null;
    
    const activeChannels = lastResult.channels.filter(c => c.isFingerDetected).length;
    return {
      totalSamples: sampleCountRef.current,
      activeChannels,
      totalChannels: lastResult.channels.length,
      fingerDetected: lastResult.fingerDetected,
      aggregatedBPM: lastResult.aggregatedBPM
    };
  }, [lastResult]);

  return useMemo(() => ({ 
    handleSample, 
    lastResult, 
    adjustChannelGain,
    reset,
    getStats
  }), [handleSample, lastResult, adjustChannelGain, reset, getStats]);
}
