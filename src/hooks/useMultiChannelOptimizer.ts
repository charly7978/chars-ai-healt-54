import { useMemo, useRef, useCallback } from 'react';
import MultiChannelOptimizer from '../modules/multichannel/MultiChannelOptimizer';
import type { VitalChannel, ChannelFeedback, MultiChannelOutputs } from '../types/multichannel';

export const useMultiChannelOptimizer = () => {
  const optimizerRef = useRef<MultiChannelOptimizer | null>(null);

  optimizerRef.current = useMemo(() => {
    return new MultiChannelOptimizer({ samplingRateHz: 30, defaultBandpass: [0.7, 4.0] });
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

  return {
    pushRawSample,
    compute,
    pushFeedback,
    reset,
  };
};

export default useMultiChannelOptimizer;

