import { useRef, useCallback, useEffect } from 'react';
import MultiChannelOptimizer from '../modules/multichannel/MultiChannelOptimizer';
import type { VitalChannel, ChannelFeedback, MultiChannelOutputs } from '../types/multichannel';

/**
 * HOOK OPTIMIZADO - Evita recreación innecesaria del optimizer
 * CRÍTICO: Limpia recursos al desmontar
 */
export const useMultiChannelOptimizer = () => {
  // Crear una sola vez con lazy initialization
  const optimizerRef = useRef<MultiChannelOptimizer | null>(null);
  
  // Lazy init - solo se crea una vez
  if (!optimizerRef.current) {
    optimizerRef.current = new MultiChannelOptimizer({ samplingRateHz: 30, defaultBandpass: [0.7, 4.0] });
  }

  // CRÍTICO: Cleanup al desmontar para liberar memoria
  useEffect(() => {
    return () => {
      if (optimizerRef.current) {
        optimizerRef.current.reset();
        optimizerRef.current = null;
      }
    };
  }, []);

  const pushRawSample = useCallback((timestamp: number, rawValue: number, quality: number) => {
    optimizerRef.current?.pushRawSample(timestamp, rawValue, quality);
  }, []);

  const compute = useCallback((): MultiChannelOutputs | null => {
    if (!optimizerRef.current) return null;
    return optimizerRef.current.compute();
  }, []);

  const pushFeedback = useCallback((channel: VitalChannel, feedback: ChannelFeedback) => {
    optimizerRef.current?.pushChannelFeedback(channel, feedback);
  }, []);

  const reset = useCallback(() => {
    optimizerRef.current?.reset();
  }, []);

  return { pushRawSample, compute, pushFeedback, reset };
};

export default useMultiChannelOptimizer;

