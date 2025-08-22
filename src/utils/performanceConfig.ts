/**
 * Configuración centralizada de rendimiento
 */
export const performanceConfig = {
  // Configuración de cámara optimizada
  camera: {
    targetFps: 30,
    maxFps: 60,
    resolution: {
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 }
    },
    // Usar requestAnimationFrame en lugar de setTimeout
    useRAF: true,
    // Buffer de frames para suavizar la captura
    frameBuffer: 5
  },
  
  // Configuración de procesamiento
  processing: {
    // Usar Web Workers cuando sea posible
    useWebWorkers: typeof Worker !== 'undefined',
    // Batch size para procesamiento
    batchSize: 10,
    // Debounce para evitar procesamiento excesivo
    debounceMs: 50,
    // Límite de procesamiento por segundo
    maxProcessingPerSecond: 30
  },
  
  // Configuración de UI
  ui: {
    // Usar CSS transforms para animaciones
    useGPUAcceleration: true,
    // Reducir re-renders
    memoizeComponents: true,
    // Lazy loading de componentes pesados
    lazyLoadThreshold: 1000,
    // Throttle de actualizaciones de UI
    uiUpdateThrottleMs: 16 // ~60fps
  },
  
  // Configuración de memoria
  memory: {
    // Límite de buffer de datos
    maxBufferSize: 1000,
    // Limpiar datos antiguos cada X ms
    cleanupIntervalMs: 30000,
    // Límite de histórico de mediciones
    maxMeasurementHistory: 100
  },
  
  // Detección de dispositivo
  device: {
    isLowEnd: /Android.*Mobile|iPhone\s[4-7]/i.test(navigator.userAgent),
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    hasGoodGPU: (window as any).GPU !== undefined,
    maxConcurrentOperations: navigator.hardwareConcurrency || 4
  },
  
  // Optimizaciones específicas por modo de energía
  powerModes: {
    performance: {
      fps: 60,
      processing: 'realtime',
      uiUpdates: 'immediate',
      accuracy: 'maximum'
    },
    balanced: {
      fps: 30,
      processing: 'batched',
      uiUpdates: 'throttled',
      accuracy: 'high'
    },
    powerSaver: {
      fps: 15,
      processing: 'deferred',
      uiUpdates: 'minimal',
      accuracy: 'standard'
    }
  }
};

/**
 * Hook para obtener configuración de rendimiento según el contexto
 */
export const getPerformanceSettings = (powerMode: 'performance' | 'balanced' | 'power-saver' = 'balanced') => {
  const baseConfig = performanceConfig;
  const modeConfig = performanceConfig.powerModes[powerMode];
  
  // Ajustar según el dispositivo
  if (performanceConfig.device.isLowEnd) {
    return {
      ...baseConfig,
      camera: {
        ...baseConfig.camera,
        targetFps: Math.min(modeConfig.fps, 30),
        resolution: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 }
        }
      },
      processing: {
        ...baseConfig.processing,
        batchSize: 5,
        maxProcessingPerSecond: 15
      }
    };
  }
  
  return {
    ...baseConfig,
    camera: {
      ...baseConfig.camera,
      targetFps: modeConfig.fps
    }
  };
};

/**
 * Utilidad para aplicar throttling a funciones
 */
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number
): T => {
  let inThrottle: boolean;
  let lastResult: any;
  
  return ((...args) => {
    if (!inThrottle) {
      inThrottle = true;
      lastResult = func.apply(null, args);
      setTimeout(() => inThrottle = false, limit);
    }
    return lastResult;
  }) as T;
};

/**
 * Utilidad para aplicar debounce a funciones
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): T => {
  let timeout: NodeJS.Timeout;
  
  return ((...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(null, args), wait);
  }) as T;
};
