/**
 * HOOK SIMPLIFICADO - Sin dependencias externas
 * El nuevo PPGMonitor maneja todo internamente
 */
export const useSignalProcessor = () => {
  // Este hook ahora es solo un stub - toda la lógica está en PPGMonitor
  return {
    isProcessing: false,
    lastSignal: null,
    error: null,
    framesProcessed: 0,
    startProcessing: () => {},
    stopProcessing: () => {},
    calibrate: async () => true,
    processFrame: (_imageData: ImageData) => {},
    debugInfo: {
      sessionId: 'deprecated',
      initializationState: 'deprecated',
      instanceLocked: false
    }
  };
};
