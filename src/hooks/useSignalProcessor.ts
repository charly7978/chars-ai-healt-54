import { useState, useEffect, useCallback, useRef } from 'react';
import { PPGSignalProcessor } from '../modules/SignalProcessor';
import { ProcessedSignal, ProcessingError } from '../types/signal';

/**
 * Custom hook for managing PPG signal processing
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */
export const useSignalProcessor = () => {
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [signalStats, setSignalStats] = useState({
    minValue: Infinity,
    maxValue: -Infinity,
    avgValue: 0,
    totalValues: 0,
    lastQualityUpdateTime: 0
  });
  const signalHistoryRef = useRef<ProcessedSignal[]>([]);
  const qualityTransitionsRef = useRef<{time: number, from: number, to: number}[]>([]);
  const calibrationInProgressRef = useRef(false);
  const errorCountRef = useRef(0);
  const lastErrorTimeRef = useRef(0);

  // Create processor with well-defined callbacks
  useEffect(() => {
    console.log("useSignalProcessor: Creating new processor instance", {
      timestamp: new Date().toISOString(),
      sessionId: crypto.getRandomValues(new Uint32Array(1))[0].toString(36).substring(2, 9)
    });

    // Define signal ready callback with proper physiological validation
    const onSignalReady = (signal: ProcessedSignal) => {
      console.log("[DIAG] useSignalProcessor/onSignalReady: Frame recibido", {
        timestamp: new Date(signal.timestamp).toISOString(),
        fingerDetected: signal.fingerDetected,
        quality: signal.quality,
        rawValue: signal.rawValue,
        filteredValue: signal.filteredValue,
        stack: new Error().stack
      });
      
      // Use signal with medical validation - no forcing detection
      setLastSignal(signal);
      setError(null);
      setFramesProcessed(prev => prev + 1);
      
      // Store for history tracking
      signalHistoryRef.current.push(signal);
      if (signalHistoryRef.current.length > 100) { // Keep last 100 signals
        signalHistoryRef.current.shift();
      }
      
      // Track quality transitions for analysis
      const prevSignal = signalHistoryRef.current[signalHistoryRef.current.length - 2];
      if (prevSignal && Math.abs(prevSignal.quality - signal.quality) > 15) {
        qualityTransitionsRef.current.push({
          time: signal.timestamp,
          from: prevSignal.quality,
          to: signal.quality
        });
        
        // Keep limited history
        if (qualityTransitionsRef.current.length > 20) {
          qualityTransitionsRef.current.shift();
        }
      }
      
      // Update statistics with valid signals only
      if (signal.fingerDetected && signal.quality > 30) {
        setSignalStats(prev => {
          const newStats = {
            minValue: Math.min(prev.minValue, signal.filteredValue),
            maxValue: Math.max(prev.maxValue, signal.filteredValue),
            avgValue: (prev.avgValue * prev.totalValues + signal.filteredValue) / (prev.totalValues + 1),
            totalValues: prev.totalValues + 1,
            lastQualityUpdateTime: signal.timestamp
          };
          
          return newStats;
        });
      }
    };

    // Enhanced error handling with rate limiting
    const onError = (error: ProcessingError) => {
      const currentTime = Date.now();
      
      // Avoid error flooding - limit to one error every 2 seconds
      if (currentTime - lastErrorTimeRef.current < 2000) {
        errorCountRef.current++;
        
        // Only log without toast if errors are coming too quickly
        console.error("useSignalProcessor: Error suppressed to avoid flooding:", {
          ...error,
          formattedTime: new Date(error.timestamp).toISOString(),
          errorCount: errorCountRef.current
        });
        
        return;
      }
      
      // Reset error count and update last error time
      errorCountRef.current = 1;
      lastErrorTimeRef.current = currentTime;
      
      console.error("useSignalProcessor: Detailed error:", {
        ...error,
        formattedTime: new Date(error.timestamp).toISOString(),
        stack: new Error().stack
      });
      
      setError(error);
    };

    // Create processor with proper callbacks
    processorRef.current = new PPGSignalProcessor(onSignalReady, onError);
    
    console.log("useSignalProcessor: Processor created with callbacks established:", {
      hasOnSignalReadyCallback: !!processorRef.current.onSignalReady,
      hasOnErrorCallback: !!processorRef.current.onError
    });
    
    return () => {
      if (processorRef.current) {
        console.log("useSignalProcessor: Cleaning up processor");
        processorRef.current.stop();
      }
      signalHistoryRef.current = [];
      qualityTransitionsRef.current = [];
    };
  }, []);

  const startProcessing = useCallback(() => {
    if (!processorRef.current) {
      console.error("useSignalProcessor: No processor available");
      return;
    }

    console.log("useSignalProcessor: Starting processing", {
      previousState: isProcessing,
      timestamp: new Date().toISOString(),
      processorExists: !!processorRef.current,
      hasSignalReadyCallback: !!processorRef.current.onSignalReady
    });
    
    // Reset all stats and history
    setIsProcessing(true);
    setFramesProcessed(0);
    setSignalStats({
      minValue: Infinity,
      maxValue: -Infinity,
      avgValue: 0,
      totalValues: 0,
      lastQualityUpdateTime: 0
    });
    
    signalHistoryRef.current = [];
    qualityTransitionsRef.current = [];
    errorCountRef.current = 0;
    lastErrorTimeRef.current = 0;
    
    // Start the processor
    processorRef.current.start();
  }, [isProcessing]);

  const stopProcessing = useCallback(() => {
    if (!processorRef.current) {
      console.error("useSignalProcessor: No processor available to stop");
      return;
    }

    console.log("useSignalProcessor: Stopping processing", {
      previousState: isProcessing,
      framesProcessed: framesProcessed,
      finalStats: signalStats,
      timestamp: new Date().toISOString()
    });
    
    setIsProcessing(false);
    processorRef.current.stop();
    calibrationInProgressRef.current = false;
  }, [isProcessing, framesProcessed, signalStats]);

  const calibrate = useCallback(async () => {
    if (!processorRef.current) {
      console.error("useSignalProcessor: No processor available to calibrate");
      return false;
    }

    try {
      console.log("useSignalProcessor: Starting advanced calibration", {
        timestamp: new Date().toISOString()
      });
      
      calibrationInProgressRef.current = true;
      
      await processorRef.current.calibrate();
      
      // Wait a bit for the automatic calibration to complete
      setTimeout(() => {
        calibrationInProgressRef.current = false;
        
        console.log("useSignalProcessor: Advanced calibration completed", {
          timestamp: new Date().toISOString()
        });
      }, 3000);
      
      return true;
    } catch (error) {
      console.error("useSignalProcessor: Detailed calibration error:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      
      calibrationInProgressRef.current = false;
      
      return false;
    }
  }, []);

  const processFrame = useCallback((imageData: ImageData) => {
    if (!processorRef.current) {
      console.error("useSignalProcessor: No processor available to process frames");
      return;
    }
    if (isProcessing) {
      if (framesProcessed % 10 === 0) {
        console.log(`[DIAG] useSignalProcessor/processFrame: Procesando frame #${framesProcessed}`, {
          width: imageData.width,
          height: imageData.height,
          timestamp: Date.now(),
          processorIsProcessing: processorRef.current.isProcessing
        });
      }
      // Verify callbacks are properly assigned
      if (!processorRef.current.onSignalReady) {
        console.error("processFrame: onSignalReady is not defined in the processor");
        return;
      }
      
      try {
        processorRef.current.processFrame(imageData);
      } catch (error) {
        console.error("processFrame: Error processing frame", error);
      }
    }
  }, [isProcessing, framesProcessed]);

  return {
    isProcessing,
    lastSignal,
    error,
    framesProcessed,
    signalStats,
    isCalibrating: calibrationInProgressRef.current,
    startProcessing,
    stopProcessing,
    calibrate,
    processFrame,
    signalHistory: signalHistoryRef.current,
    qualityTransitions: qualityTransitionsRef.current
  };
};
