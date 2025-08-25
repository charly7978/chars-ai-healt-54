/**
 * @file performance-optimization.ts
 * @description Utilidades para optimización de rendimiento
 * Elimina cuellos de botella y mejora el rendimiento de la aplicación
 */

// Throttle para limitar la frecuencia de llamadas a funciones
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastCallTime = 0;
  
  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = wait - (now - lastCallTime);
    
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      lastCallTime = now;
      return func(...args);
    }
    
    if (!timeout) {
      timeout = setTimeout(() => {
        lastCallTime = Date.now();
        timeout = null;
        func(...args);
      }, remaining);
    }
  }) as T;
}

// Debounce para evitar llamadas excesivas
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return ((...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

// RequestAnimationFrame throttle para operaciones de UI
export function rafThrottle<T extends (...args: any[]) => any>(func: T): T {
  let rafId: number | null = null;
  let latestArgs: Parameters<T> | null = null;
  
  return ((...args: Parameters<T>) => {
    latestArgs = args;
    
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        if (latestArgs) {
          func(...latestArgs);
          latestArgs = null;
        }
        rafId = null;
      });
    }
  }) as T;
}

// Optimización de console.log para producción
export const optimizedLog = (() => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  let logCounter = 0;
  const LOG_INTERVAL = 100; // Solo loguear cada 100 llamadas en producción
  
  return {
    log: (...args: any[]) => {
      if (isDevelopment) {
        console.log(...args);
      } else {
        logCounter++;
        if (logCounter % LOG_INTERVAL === 0) {
          console.log(`[${logCounter}]`, ...args);
        }
      }
    },
    warn: (...args: any[]) => {
      if (isDevelopment) {
        console.warn(...args);
      }
    },
    error: (...args: any[]) => {
      console.error(...args); // Siempre mostrar errores
    },
    debug: (...args: any[]) => {
      if (isDevelopment) {
        console.debug(...args);
      }
    }
  };
})();

// Memoización simple para cálculos costosos
export function memoize<T extends (...args: any[]) => any>(
  func: T,
  maxCacheSize = 100
): T {
  const cache = new Map<string, ReturnType<T>>();
  
  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    
    const result = func(...args);
    cache.set(key, result);
    
    // Limitar el tamaño del cache
    if (cache.size > maxCacheSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    
    return result;
  }) as T;
}

// Web Worker pool para procesamiento intensivo
export class WorkerPool {
  private workers: Worker[] = [];
  private queue: Array<{ data: any; resolve: (value: any) => void; reject: (error: any) => void }> = [];
  private busyWorkers = new Set<Worker>();
  
  constructor(workerScript: string, poolSize = navigator.hardwareConcurrency || 4) {
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerScript);
      this.workers.push(worker);
    }
  }
  
  async process(data: any): Promise<any> {
    const availableWorker = this.workers.find(w => !this.busyWorkers.has(w));
    
    if (!availableWorker) {
      return new Promise((resolve, reject) => {
        this.queue.push({ data, resolve, reject });
      });
    }
    
    return this.executeOnWorker(availableWorker, data);
  }
  
  private async executeOnWorker(worker: Worker, data: any): Promise<any> {
    this.busyWorkers.add(worker);
    
    return new Promise((resolve, reject) => {
      const handleMessage = (e: MessageEvent) => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        this.busyWorkers.delete(worker);
        
        // Procesar siguiente en cola si hay
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          this.executeOnWorker(worker, next.data)
            .then(next.resolve)
            .catch(next.reject);
        }
        
        resolve(e.data);
      };
      
      const handleError = (error: ErrorEvent) => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        this.busyWorkers.delete(worker);
        reject(error);
      };
      
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.postMessage(data);
    });
  }
  
  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.queue = [];
    this.busyWorkers.clear();
  }
}

// Detector de performance issues
export class PerformanceMonitor {
  private frameTimeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 60;
  private lastFrameTime = performance.now();
  
  recordFrame() {
    const now = performance.now();
    const frameTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    this.frameTimeBuffer.push(frameTime);
    if (this.frameTimeBuffer.length > this.BUFFER_SIZE) {
      this.frameTimeBuffer.shift();
    }
  }
  
  getFPS(): number {
    if (this.frameTimeBuffer.length === 0) return 0;
    const avgFrameTime = this.frameTimeBuffer.reduce((a, b) => a + b, 0) / this.frameTimeBuffer.length;
    return 1000 / avgFrameTime;
  }
  
  isPerformanceDegraded(): boolean {
    return this.getFPS() < 30;
  }
  
  getMetrics() {
    const fps = this.getFPS();
    const avgFrameTime = this.frameTimeBuffer.length > 0 
      ? this.frameTimeBuffer.reduce((a, b) => a + b, 0) / this.frameTimeBuffer.length 
      : 0;
    const maxFrameTime = Math.max(...this.frameTimeBuffer, 0);
    
    return {
      fps,
      avgFrameTime,
      maxFrameTime,
      isLagging: fps < 30,
      severity: fps < 15 ? 'critical' : fps < 30 ? 'warning' : 'good'
    };
  }
}

// Optimización de actualizaciones del DOM
export const batchDOMUpdates = (() => {
  let pendingUpdates: Array<() => void> = [];
  let rafId: number | null = null;
  
  const flush = () => {
    const updates = pendingUpdates;
    pendingUpdates = [];
    rafId = null;
    
    updates.forEach(update => update());
  };
  
  return (update: () => void) => {
    pendingUpdates.push(update);
    
    if (rafId === null) {
      rafId = requestAnimationFrame(flush);
    }
  };
})();
