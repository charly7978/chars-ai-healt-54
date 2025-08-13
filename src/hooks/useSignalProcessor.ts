import { useState, useCallback, useRef } from 'react';
import { PPGSignalProcessor } from '../modules/SignalProcessor';
import { ProcessedSignal, ProcessingError } from '../types/signal';

export const useSignalProcessor = () => {
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);

  const initProcessor = useCallback(() => {
    if (!processorRef.current) {
      const onSignalReady = (signal: ProcessedSignal) => {
        setLastSignal(signal);
        setError(null);
        setFramesProcessed(prev => prev + 1);
      };

      const onError = (error: ProcessingError) => {
        setError(error);
      };

      processorRef.current = new PPGSignalProcessor(onSignalReady, onError);
    }
  }, []);

  const startProcessing = useCallback(() => {
    initProcessor();
    if (processorRef.current) {
      setIsProcessing(true);
      setFramesProcessed(0);
      processorRef.current.start();
    }
  }, [initProcessor]);

  const stopProcessing = useCallback(() => {
    if (processorRef.current) {
      setIsProcessing(false);
      processorRef.current.stop();
    }
  }, []);

  const calibrate = useCallback(async () => {
    if (processorRef.current) {
      try {
        await processorRef.current.calibrate();
        return true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }, []);

  const processFrame = useCallback((imageData: ImageData) => {
    if (processorRef.current && isProcessing) {
      processorRef.current.processFrame(imageData);
    }
  }, [isProcessing]);

  return {
    isProcessing,
    lastSignal,
    error,
    framesProcessed,
    startProcessing,
    stopProcessing,
    calibrate,
    processFrame
  };
};
