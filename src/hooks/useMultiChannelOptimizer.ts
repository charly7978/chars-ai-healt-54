import { useRef, useCallback } from 'react';

export const useMultiChannelOptimizer = () => {
  const pushRawSample = useCallback((timestamp: number, rawValue: number, quality: number) => {
    // noop
  }, []);

  const compute = useCallback((): any | null => {
    return null;
  }, []);

  const pushFeedback = useCallback((channel: any, feedback: any) => {
    // noop
  }, []);

  const reset = useCallback(() => {
    // noop
  }, []);

  return {
    pushRawSample,
    compute,
    pushFeedback,
    reset,
  };
};

export default useMultiChannelOptimizer;

