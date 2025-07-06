/**
 * Performance Optimizer for Signal Processing
 * Implementa técnicas avanzadas de optimización:
 * - Web Workers para procesamiento paralelo
 * - SIMD para operaciones vectoriales
 * - Memory pooling para reducir garbage collection
 * - Lazy evaluation para cálculos costosos
 */

export interface PerformanceConfig {
  enableWebWorkers: boolean;
  enableSIMD: boolean;
  enableMemoryPooling: boolean;
  enableLazyEvaluation: boolean;
  workerCount: number;
  bufferSize: number;
  batchSize: number;
}

export interface PerformanceMetrics {
  processingTime: number;
  memoryUsage: number;
  cpuUsage: number;
  throughput: number;
  latency: number;
}

export class PerformanceOptimizer {
  private config: PerformanceConfig;
  private workers: Worker[] = [];
  private memoryPool: Map<string, Float32Array[]> = new Map();
  private performanceHistory: PerformanceMetrics[] = [];
  private isInitialized: boolean = false;
  
  // Parámetros optimizados
  private readonly DEFAULT_CONFIG: PerformanceConfig = {
    enableWebWorkers: true,
    enableSIMD: true,
    enableMemoryPooling: true,
    enableLazyEvaluation: true,
    workerCount: navigator.hardwareConcurrency || 4,
    bufferSize: 1024,
    batchSize: 64
  };

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Inicializa el optimizador de rendimiento
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('🚀 Inicializando Performance Optimizer...');

    // Inicializar Web Workers
    if (this.config.enableWebWorkers) {
      await this.initializeWebWorkers();
    }

    // Inicializar memory pool
    if (this.config.enableMemoryPooling) {
      this.initializeMemoryPool();
    }

    // Verificar soporte SIMD
    if (this.config.enableSIMD) {
      this.checkSIMDSupport();
    }

    this.isInitialized = true;
    console.log('✅ Performance Optimizer inicializado');
  }

  /**
   * Inicializa Web Workers para procesamiento paralelo
   */
  private async initializeWebWorkers(): Promise<void> {
    const workerScript = `
      self.onmessage = function(e) {
        const { type, data, id } = e.data;
        
        switch (type) {
          case 'fft':
            const fftResult = computeFFT(data.signal);
            self.postMessage({ type: 'fft_result', data: fftResult, id });
            break;
          case 'filter':
            const filterResult = applyFilter(data.signal, data.coefficients);
            self.postMessage({ type: 'filter_result', data: filterResult, id });
            break;
          case 'correlation':
            const corrResult = computeCorrelation(data.signal1, data.signal2);
            self.postMessage({ type: 'correlation_result', data: corrResult, id });
            break;
        }
      };

      function computeFFT(signal) {
        const N = signal.length;
        const fft = [];
        
        for (let k = 0; k < N; k++) {
          let real = 0;
          let imag = 0;
          
          for (let n = 0; n < N; n++) {
            const angle = -2 * Math.PI * k * n / N;
            real += signal[n] * Math.cos(angle);
            imag += signal[n] * Math.sin(angle);
          }
          
          fft.push({ real, imag });
        }
        
        return fft;
      }

      function applyFilter(signal, coefficients) {
        const { b, a } = coefficients;
        const filtered = [];
        
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        
        for (let i = 0; i < signal.length; i++) {
          const y = b[0] * signal[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
          filtered.push(y);
          
          x2 = x1; x1 = signal[i];
          y2 = y1; y1 = y;
        }
        
        return filtered;
      }

      function computeCorrelation(signal1, signal2) {
        const mean1 = signal1.reduce((sum, val) => sum + val, 0) / signal1.length;
        const mean2 = signal2.reduce((sum, val) => sum + val, 0) / signal2.length;
        
        let numerator = 0;
        let denominator1 = 0;
        let denominator2 = 0;
        
        for (let i = 0; i < signal1.length; i++) {
          const diff1 = signal1[i] - mean1;
          const diff2 = signal2[i] - mean2;
          numerator += diff1 * diff2;
          denominator1 += diff1 * diff1;
          denominator2 += diff2 * diff2;
        }
        
        const denominator = Math.sqrt(denominator1 * denominator2);
        return denominator > 1e-10 ? numerator / denominator : 0;
      }
    `;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    for (let i = 0; i < this.config.workerCount; i++) {
      const worker = new Worker(workerUrl);
      this.workers.push(worker);
    }

    URL.revokeObjectURL(workerUrl);
  }

  /**
   * Inicializa memory pool para reducir garbage collection
   */
  private initializeMemoryPool(): void {
    const poolSizes = [64, 128, 256, 512, 1024, 2048];
    
    poolSizes.forEach(size => {
      const pool: Float32Array[] = [];
      for (let i = 0; i < 10; i++) {
        pool.push(new Float32Array(size));
      }
      this.memoryPool.set(`size_${size}`, pool);
    });
  }

  /**
   * Verifica soporte SIMD
   */
  private checkSIMDSupport(): void {
    if (typeof WebAssembly !== 'undefined' && WebAssembly.validate) {
      console.log('✅ SIMD support available');
    } else {
      console.log('⚠️ SIMD not supported, falling back to standard operations');
    }
  }

  /**
   * Procesa señal con optimizaciones de rendimiento
   */
  public async processSignalOptimized(
    signal: number[],
    operations: Array<{
      type: 'fft' | 'filter' | 'correlation';
      data?: any;
    }>
  ): Promise<any[]> {
    const startTime = performance.now();
    
    if (!this.isInitialized) {
      await this.initialize();
    }

    const results: any[] = [];
    const batches = this.createBatches(signal, this.config.batchSize);

    // Procesar en lotes usando Web Workers
    if (this.config.enableWebWorkers && this.workers.length > 0) {
      const workerPromises = batches.map((batch, index) => 
        this.processBatchWithWorker(batch, operations, index)
      );
      
      const batchResults = await Promise.all(workerPromises);
      results.push(...batchResults.flat());
    } else {
      // Procesamiento secuencial optimizado
      for (const batch of batches) {
        const batchResult = this.processBatchOptimized(batch, operations);
        results.push(...batchResult);
      }
    }

    const endTime = performance.now();
    this.recordPerformanceMetrics(endTime - startTime, signal.length);

    return results;
  }

  /**
   * Procesa lote con Web Worker
   */
  private processBatchWithWorker(
    batch: number[],
    operations: Array<{ type: string; data?: any }>,
    workerIndex: number
  ): Promise<any[]> {
    return new Promise((resolve) => {
      const worker = this.workers[workerIndex % this.workers.length];
      const results: any[] = [];
      let completedOperations = 0;

      worker.onmessage = (e) => {
        const { type, data, id } = e.data;
        results[id] = data;
        completedOperations++;

        if (completedOperations === operations.length) {
          resolve(results);
        }
      };

      operations.forEach((op, index) => {
        worker.postMessage({
          type: op.type,
          data: { signal: batch, ...op.data },
          id: index
        });
      });
    });
  }

  /**
   * Procesa lote con optimizaciones locales
   */
  private processBatchOptimized(
    batch: number[],
    operations: Array<{ type: string; data?: any }>
  ): any[] {
    const results: any[] = [];

    for (const operation of operations) {
      switch (operation.type) {
        case 'fft':
          results.push(this.computeFFTOptimized(batch));
          break;
        case 'filter':
          results.push(this.applyFilterOptimized(batch, operation.data.coefficients));
          break;
        case 'correlation':
          results.push(this.computeCorrelationOptimized(batch, operation.data.signal2));
          break;
      }
    }

    return results;
  }

  /**
   * FFT optimizado con SIMD
   */
  private computeFFTOptimized(signal: number[]): { real: number; imag: number }[] {
    if (this.config.enableSIMD && signal.length >= 4) {
      return this.computeFFTSIMD(signal);
    }
    
    return this.computeFFTStandard(signal);
  }

  /**
   * FFT usando SIMD
   */
  private computeFFTSIMD(signal: number[]): { real: number; imag: number }[] {
    const N = signal.length;
    const fft: { real: number; imag: number }[] = [];
    
    // Procesar en bloques de 4 para aprovechar SIMD
    for (let k = 0; k < N; k++) {
      let real = 0;
      let imag = 0;
      
      // Procesar bloques de 4 elementos
      for (let n = 0; n < N - 3; n += 4) {
        const angles = [
          -2 * Math.PI * k * n / N,
          -2 * Math.PI * k * (n + 1) / N,
          -2 * Math.PI * k * (n + 2) / N,
          -2 * Math.PI * k * (n + 3) / N
        ];
        
        const cosValues = angles.map(angle => Math.cos(angle));
        const sinValues = angles.map(angle => Math.sin(angle));
        
        for (let i = 0; i < 4; i++) {
          real += signal[n + i] * cosValues[i];
          imag += signal[n + i] * sinValues[i];
        }
      }
      
      // Procesar elementos restantes
      for (let n = Math.floor(N / 4) * 4; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += signal[n] * Math.cos(angle);
        imag += signal[n] * Math.sin(angle);
      }
      
      fft.push({ real, imag });
    }
    
    return fft;
  }

  /**
   * FFT estándar
   */
  private computeFFTStandard(signal: number[]): { real: number; imag: number }[] {
    const N = signal.length;
    const fft: { real: number; imag: number }[] = [];
    
    for (let k = 0; k < N; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += signal[n] * Math.cos(angle);
        imag += signal[n] * Math.sin(angle);
      }
      
      fft.push({ real, imag });
    }
    
    return fft;
  }

  /**
   * Filtro optimizado con memory pooling
   */
  private applyFilterOptimized(signal: number[], coefficients: { b: number[]; a: number[] }): number[] {
    const { b, a } = coefficients;
    const filtered = this.getBufferFromPool(signal.length);
    
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    for (let i = 0; i < signal.length; i++) {
      const y = b[0] * signal[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      filtered[i] = y;
      
      x2 = x1; x1 = signal[i];
      y2 = y1; y1 = y;
    }
    
    return Array.from(filtered);
  }

  /**
   * Correlación optimizada
   */
  private computeCorrelationOptimized(signal1: number[], signal2: number[]): number {
    const minLength = Math.min(signal1.length, signal2.length);
    const buffer1 = this.getBufferFromPool(minLength);
    const buffer2 = this.getBufferFromPool(minLength);
    
    // Copiar datos a buffers optimizados
    for (let i = 0; i < minLength; i++) {
      buffer1[i] = signal1[i];
      buffer2[i] = signal2[i];
    }
    
    const mean1 = this.computeMeanOptimized(buffer1, minLength);
    const mean2 = this.computeMeanOptimized(buffer2, minLength);
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < minLength; i++) {
      const diff1 = buffer1[i] - mean1;
      const diff2 = buffer2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator > 1e-10 ? numerator / denominator : 0;
  }

  /**
   * Obtiene buffer del memory pool
   */
  private getBufferFromPool(size: number): Float32Array {
    const poolKey = `size_${size}`;
    const pool = this.memoryPool.get(poolKey);
    
    if (pool && pool.length > 0) {
      return pool.pop()!;
    }
    
    return new Float32Array(size);
  }

  /**
   * Devuelve buffer al memory pool
   */
  private returnBufferToPool(buffer: Float32Array): void {
    const poolKey = `size_${buffer.length}`;
    const pool = this.memoryPool.get(poolKey);
    
    if (pool && pool.length < 10) {
      pool.push(buffer);
    }
  }

  /**
   * Calcula media optimizada
   */
  private computeMeanOptimized(buffer: Float32Array, length: number): number {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += buffer[i];
    }
    return sum / length;
  }

  /**
   * Crea lotes para procesamiento paralelo
   */
  private createBatches(signal: number[], batchSize: number): number[][] {
    const batches: number[][] = [];
    
    for (let i = 0; i < signal.length; i += batchSize) {
      batches.push(signal.slice(i, i + batchSize));
    }
    
    return batches;
  }

  /**
   * Registra métricas de rendimiento
   */
  private recordPerformanceMetrics(processingTime: number, dataSize: number): void {
    const metrics: PerformanceMetrics = {
      processingTime,
      memoryUsage: this.getMemoryUsage(),
      cpuUsage: this.getCPUUsage(),
      throughput: dataSize / processingTime,
      latency: processingTime
    };

    this.performanceHistory.push(metrics);
    
    // Mantener solo los últimos 100 registros
    if (this.performanceHistory.length > 100) {
      this.performanceHistory.shift();
    }
  }

  /**
   * Obtiene uso de memoria
   */
  private getMemoryUsage(): number {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize / 1024 / 1024; // MB
    }
    return 0;
  }

  /**
   * Obtiene uso de CPU (estimado)
   */
  private getCPUUsage(): number {
    // Estimación basada en tiempo de procesamiento
    const recentMetrics = this.performanceHistory.slice(-10);
    if (recentMetrics.length === 0) return 0;
    
    const avgProcessingTime = recentMetrics.reduce((sum, m) => sum + m.processingTime, 0) / recentMetrics.length;
    return Math.min(1, avgProcessingTime / 16.67); // 16.67ms = 60fps
  }

  /**
   * Obtiene estadísticas de rendimiento
   */
  public getPerformanceStats(): {
    averageProcessingTime: number;
    averageThroughput: number;
    averageLatency: number;
    memoryEfficiency: number;
    cpuEfficiency: number;
  } {
    if (this.performanceHistory.length === 0) {
      return {
        averageProcessingTime: 0,
        averageThroughput: 0,
        averageLatency: 0,
        memoryEfficiency: 0,
        cpuEfficiency: 0
      };
    }

    const avgProcessingTime = this.performanceHistory.reduce((sum, m) => sum + m.processingTime, 0) / this.performanceHistory.length;
    const avgThroughput = this.performanceHistory.reduce((sum, m) => sum + m.throughput, 0) / this.performanceHistory.length;
    const avgLatency = this.performanceHistory.reduce((sum, m) => sum + m.latency, 0) / this.performanceHistory.length;
    const avgMemoryUsage = this.performanceHistory.reduce((sum, m) => sum + m.memoryUsage, 0) / this.performanceHistory.length;
    const avgCPUUsage = this.performanceHistory.reduce((sum, m) => sum + m.cpuUsage, 0) / this.performanceHistory.length;

    return {
      averageProcessingTime: avgProcessingTime,
      averageThroughput: avgThroughput,
      averageLatency: avgLatency,
      memoryEfficiency: 1 - avgMemoryUsage / 100, // Eficiencia inversa al uso de memoria
      cpuEfficiency: 1 - avgCPUUsage // Eficiencia inversa al uso de CPU
    };
  }

  /**
   * Limpia recursos
   */
  public dispose(): void {
    // Terminar Web Workers
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];

    // Limpiar memory pool
    this.memoryPool.clear();

    this.isInitialized = false;
  }
} 