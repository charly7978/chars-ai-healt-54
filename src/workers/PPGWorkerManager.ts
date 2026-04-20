/**
 * PPG WORKER MANAGER
 * Manages Web Worker pool for parallel signal processing
 * Provides: FFT analysis, wavelet denoising, peak detection, quality metrics
 */

import PPGWorker from './ppgProcessor.worker?worker';

export interface WorkerTask {
  id: string;
  type: 'PROCESS_FRAME' | 'PROCESS_BATCH' | 'FFT_ANALYSIS' | 'WAVELET_DENOISE' | 'PEAK_DETECT' | 'QUALITY_METRICS';
  data: any;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

export interface WorkerPoolConfig {
  poolSize: number;
  taskTimeout: number;
  sampleRate: number;
  bufferSize: number;
}

export class PPGWorkerManager {
  private workers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private activeTasks = new Map<string, WorkerTask>();
  private workerIdle = new Map<number, boolean>();
  private config: WorkerPoolConfig;
  private initialized = false;
  private taskIdCounter = 0;

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = {
      poolSize: Math.min(4, navigator.hardwareConcurrency || 2),
      taskTimeout: 5000,
      sampleRate: 60,
      bufferSize: 1024,
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create worker pool
    for (let i = 0; i < this.config.poolSize; i++) {
      const worker = new PPGWorker();
      worker.onmessage = (e) => this.handleMessage(e, i);
      worker.onerror = (err) => this.handleError(err, i);
      
      this.workers.push(worker);
      this.workerIdle.set(i, true);

      // Initialize each worker
      await new Promise<void>((resolve, reject) => {
        const initTimeout = setTimeout(() => reject(new Error('Worker init timeout')), 3000);
        
        const checkInit = (e: MessageEvent) => {
          if (e.data.type === 'INIT_COMPLETE') {
            clearTimeout(initTimeout);
            worker.removeEventListener('message', checkInit);
            resolve();
          }
        };
        
        worker.addEventListener('message', checkInit);
        worker.postMessage({
          type: 'INIT',
          data: {
            sampleRate: this.config.sampleRate,
            bufferSize: this.config.bufferSize
          }
        });
      });
    }

    this.initialized = true;
    console.log(`✅ PPG Worker Pool initialized with ${this.config.poolSize} workers`);
  }

  private handleWorkerMessage = (event: MessageEvent, workerIndex: number) => {
    const message = event.data as WorkerResponse;
    
    const task = this.activeTasks.get(message.id);
    if (!task) {
      // Task already completed or timed out
      return;
    }

    // Clear timeout to prevent race condition
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }

    // Remove from active tasks before resolving/rejecting
    this.activeTasks.delete(message.id);
    this.workerIdle.set(workerIndex, true);

    if (message.type === 'ERROR') {
      task.reject(new Error(message.error));
    } else {
      task.resolve(message.data);
    }

    this.processQueue();
  };

  private handleError(error: ErrorEvent, workerIndex: number) {
    console.error(`Worker ${workerIndex} error:`, error);
    // Mark all tasks for this worker as failed
    for (const [id, task] of this.activeTasks.entries()) {
      if (this.getWorkerForTask(id) === workerIndex) {
        this.activeTasks.delete(id);
        task.reject(error);
      }
    }
    this.workerIdle.set(workerIndex, true);
    this.processQueue();
  }

  private getWorkerForTask(taskId: string): number {
    // Simple hash-based assignment
    let hash = 0;
    for (let i = 0; i < taskId.length; i++) {
      hash = ((hash << 5) - hash) + taskId.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % this.workers.length;
  }

  private findIdleWorker(): number {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workerIdle.get(i)) return i;
    }
    return -1;
  }

  private processQueue() {
    while (this.taskQueue.length > 0) {
      const workerIndex = this.findIdleWorker();
      if (workerIndex === -1) break;

      const task = this.taskQueue.shift()!;
      this.activeTasks.set(task.id, { resolve: task.resolve, reject: task.reject, timeoutId: null, workerIndex });

      // Send task to worker
      this.workers[workerIndex].postMessage({ type: task.type, data: task.data, id: task.id });
      
      // Set up timeout with proper race condition handling
      const timeoutId = setTimeout(() => {
        const activeTask = this.activeTasks.get(task.id);
        if (activeTask) {
          // Only proceed if task is still active
          this.activeTasks.delete(task.id);
          this.workerIdle.set(workerIndex, true);
          
          // Clear the timeout reference to prevent double cleanup
          if (activeTask.timeoutId) {
            clearTimeout(activeTask.timeoutId);
          }
          
          task.reject(new Error('Task timeout'));
          this.processQueue();
        }
      }, this.config.taskTimeout);
      
      this.activeTasks.set(task.id, { resolve: task.resolve, reject: task.reject, timeoutId, workerIndex });
    }
  }

  private createTaskId(): string {
    return `task_${++this.taskIdCounter}_${Date.now()}`;
  }

  private enqueueTask<T>(type: WorkerTask['type'], data: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        id: this.createTaskId(),
        type,
        data,
        resolve,
        reject,
        timestamp: performance.now()
      };

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  // Public API methods
  async processFrame(timestamp: number, red: number, green: number, blue: number, quality: number) {
    return this.enqueueTask('PROCESS_FRAME', { timestamp, red, green, blue, quality });
  }

  async processBatch(samples: Float64Array, timestamps: Float64Array) {
    return this.enqueueTask('PROCESS_BATCH', { samples, timestamps });
  }

  async performFFT(samples: Float64Array) {
    return this.enqueueTask('FFT_ANALYSIS', { samples });
  }

  async waveletDenoise(samples: Float64Array, levels?: number) {
    return this.enqueueTask('WAVELET_DENOISE', { samples, levels });
  }

  async detectPeaks(samples: Float64Array, minDistanceMs: number, threshold: number) {
    return this.enqueueTask('PEAK_DETECT', { samples, minDistance: minDistanceMs, threshold });
  }

  async computeQualityMetrics(samples: Float64Array) {
    return this.enqueueTask('QUALITY_METRICS', { samples });
  }

  // Batch processing for efficiency
  async processSignalWindow(samples: Float64Array): Promise<{
    fft: any;
    peaks: any;
    quality: any;
    denoised: Float64Array;
  }> {
    // Run independent tasks in parallel
    const [fft, peaks, quality, denoiseResult] = await Promise.all([
      this.performFFT(samples),
      this.detectPeaks(samples, 300, 0),
      this.computeQualityMetrics(samples),
      this.waveletDenoise(samples)
    ]);

    return {
      fft,
      peaks,
      quality,
      denoised: (denoiseResult as { denoised: Float64Array }).denoised
    };
  }

  terminate() {
    // Clear all pending tasks with timeout cleanup
    for (const [id, task] of this.activeTasks.entries()) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.reject(new Error('Worker pool terminated'));
    }
    this.activeTasks.clear();
    
    // Reject all queued tasks
    this.taskQueue.forEach(task => {
      task.reject(new Error('Worker pool terminated'));
    });
    this.taskQueue = [];
    
    // Terminate all workers
    this.workers.forEach(worker => {
      try {
        worker.terminate();
      } catch (error) {
        console.warn('Error terminating worker:', error);
      }
    });
    this.workers = [];
    this.workerIdle = [];
    this.initialized = false;
  }

}

// Singleton instance
let workerManager: PPGWorkerManager | null = null;

export function getWorkerManager(): PPGWorkerManager {
  if (!workerManager) {
    workerManager = new PPGWorkerManager();
  }
  return workerManager;
}

export function resetWorkerManager() {
  if (workerManager) {
    workerManager.terminate();
    workerManager = null;
  }
}
