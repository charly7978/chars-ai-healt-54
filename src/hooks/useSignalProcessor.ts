
import { useMemo, useRef, useState } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { CameraSample, MultiChannelResult } from '@/types';

/**
 * Hook que integra CameraView -> MultiChannelManager
 * CORREGIDO: Manejo correcto de valores y escalado adecuado
 */

export function useSignalProcessor(windowSec = 8, channels = 6) {
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);

  if (!mgrRef.current) {
    mgrRef.current = new MultiChannelManager(channels, windowSec);
  }

  const handleSample = (s: CameraSample) => {
    // CORREGIDO: Usar directamente el canal rojo como entrada principal
    // El canal rojo tiene mayor señal PPG que el verde en muchos casos
    const inputSignal = s.rMean; // Valor directo 0-255
    
    // CRÍTICO: Log para debug del flujo
    if (Math.random() < 0.1) { // Log 10% de muestras para no saturar
      console.log('📊 SignalProcessor Input:', {
        rMean: s.rMean.toFixed(1),
        gMean: s.gMean.toFixed(1),
        bMean: s.bMean.toFixed(1),
        inputSignal: inputSignal.toFixed(1),
        coverageRatio: (s.coverageRatio * 100).toFixed(1) + '%',
        frameDiff: s.frameDiff.toFixed(1),
        timestamp: new Date(s.timestamp).toLocaleTimeString()
      });
    }

    mgrRef.current!.pushSample(inputSignal, s.timestamp);
    const result = mgrRef.current!.analyzeAll(s.coverageRatio, s.frameDiff);
    
    // CRÍTICO: Log resultado para debug
    if (result.fingerDetected || Math.random() < 0.05) {
      console.log('🔍 SignalProcessor Output:', {
        fingerDetected: result.fingerDetected,
        aggregatedBPM: result.aggregatedBPM,
        aggregatedQuality: result.aggregatedQuality,
        activeChannels: result.channels.filter(c => c.isFingerDetected).length,
        bestChannelQuality: Math.max(...result.channels.map(c => c.quality))
      });
    }
    
    setLastResult(result);
  };

  const adjustChannelGain = (channelId: number, deltaRel: number) => {
    mgrRef.current?.adjustChannelGain(channelId, deltaRel);
    // Re-analizar después del ajuste
    const result = mgrRef.current!.analyzeAll(0, 0);
    setLastResult(result);
  };

  return useMemo(() => ({ 
    handleSample, 
    lastResult, 
    adjustChannelGain 
  }), [lastResult]);
}
