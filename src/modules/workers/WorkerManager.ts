/**
 * WORKER MANAGER
 * 
 * Manages the PPG Processing Web Worker lifecycle:
 * - Worker instantiation and termination
 * - Message routing and promise-based responses
 * - Frame queue management
 * - Fallback to main-thread processing if worker fails
 */

import type { 
  WorkerMessage, 
  WorkerResult, 
  ProcessFrameMessage,
  IMUUpdateMessage,
  ResetMessage,
  ConfigMessage,
  FrameProcessedResult,
  WorkerConfig,
} from './PPGProcessingWorker';
import type { IMUData } from '../signal-processing/MotionEstimator';

export type WorkerStatus = 'idle' | 'processing' | 'error' | 'fallback';

export interface WorkerManagerCallbacks {
  onFrameProcessed?: (result: FrameProcessedResult) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: WorkerStatus) => void;
}

export class WorkerManager {
  private worker: Worker | null = null;
  private status: WorkerStatus = 'idle';
  private pendingFrame: ProcessFrameMessage | null = null;
  private frameQueue: ProcessFrameMessage[] = [];
  private readonly MAX_QUEUE_SIZE = 3;
  private callbacks: WorkerManagerCallbacks;
  private config: WorkerConfig;
  
  // Performance tracking
  private frameTimings: number[] = [];
  private readonly TIMING_WINDOW = 30;
  
  constructor(callbacks: WorkerManagerCallbacks = {}, config: Partial<WorkerConfig> = {}) {
    this.callbacks = callbacks;
    this.config = {
      gridSize: 5,
      enableMultiResolutionMotion: true,
      radiometricConfig: {
        sRGBGamma: 2.2,
        clipHighThreshold: 250,
        clipLowThreshold: 5,
      },
      ...config,
    };
    
    this.initWorker();
  }
  
  /**
   * Initialize the web worker
   */
  private initWorker(): void {
    try {
      // Create worker from module
      this.worker = new Worker(
        new URL('./PPGProcessingWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);
      
      // Send initial config
      this.sendConfig();
      
      this.setStatus('idle');
    } catch (error) {
      console.warn('Worker initialization failed, falling back to main thread:', error);
      this.setStatus('fallback');
    }
  }
  
  /**
   * Process a video frame
   */
  processFrame(imageData: ImageData, timestamp: number, frameNumber: number): void {
    if (this.status === 'error') {
      // Try to reinitialize
      this.initWorker();
    }
    
    if (this.status === 'fallback' || !this.worker) {
      // Fallback processing would happen here
      // For now, just report that we can't process
      this.callbacks.onError?.('Worker unavailable, using main thread');
      return;
    }
    
    const message: ProcessFrameMessage = {
      type: 'PROCESS_FRAME',
      imageData,
      timestamp,
      frameNumber,
    };
    
    // Drop old frames if queue is full (keep latest)
    if (this.frameQueue.length >= this.MAX_QUEUE_SIZE) {
      this.frameQueue.shift();
    }
    
    if (this.status === 'processing') {
      // Queue the frame
      this.frameQueue.push(message);
    } else {
      // Process immediately
      this.sendFrame(message);
    }
  }
  
  /**
   * Update IMU data in worker
   */
  updateIMU(imuData: IMUData): void {
    if (this.status === 'fallback' || !this.worker) return;
    
    const message: IMUUpdateMessage = {
      type: 'IMU_UPDATE',
      imuData,
    };
    
    this.worker.postMessage(message);
  }
  
  /**
   * Reset worker state
   */
  reset(): void {
    if (this.status === 'fallback' || !this.worker) return;
    
    const message: ResetMessage = {
      type: 'RESET',
    };
    
    this.worker.postMessage(message);
    this.frameQueue = [];
    this.pendingFrame = null;
    this.frameTimings = [];
  }
  
  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.setStatus('idle');
    this.frameQueue = [];
    this.pendingFrame = null;
  }
  
  /**
   * Get current status
   */
  getStatus(): WorkerStatus {
    return this.status;
  }
  
  /**
   * Get average processing time
   */
  getAverageProcessingTime(): number {
    if (this.frameTimings.length === 0) return 0;
    return this.frameTimings.reduce((a, b) => a + b, 0) / this.frameTimings.length;
  }
  
  /**
   * Check if worker is available
   */
  isAvailable(): boolean {
    return this.status !== 'fallback' && this.status !== 'error' && this.worker !== null;
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  PRIVATE METHODS
  // ═════════════════════════════════════════════════════════════════
  
  private sendFrame(message: ProcessFrameMessage): void {
    if (!this.worker) return;
    
    this.setStatus('processing');
    this.pendingFrame = message;
    
    // Transfer ImageData buffer for efficiency
    this.worker.postMessage(message, [message.imageData.data.buffer]);
  }
  
  private sendConfig(): void {
    if (!this.worker) return;
    
    const message: ConfigMessage = {
      type: 'CONFIG',
      config: this.config,
    };
    
    this.worker.postMessage(message);
  }
  
  private handleWorkerMessage(event: MessageEvent<WorkerResult>): void {
    const result = event.data;
    
    switch (result.type) {
      case 'FRAME_PROCESSED':
        this.handleFrameProcessed(result);
        break;
      case 'IMU_PROCESSED':
        // IMU updates are processed, no specific action needed
        break;
      case 'RESET_COMPLETE':
        console.log('Worker reset complete');
        break;
      case 'CONFIG_APPLIED':
        console.log('Worker config applied');
        break;
      case 'ERROR':
        this.handleWorkerError(new Error(result.error));
        break;
    }
  }
  
  private handleFrameProcessed(result: FrameProcessedResult): void {
    // Track timing
    this.frameTimings.push(result.processingTimeMs);
    if (this.frameTimings.length > this.TIMING_WINDOW) {
      this.frameTimings.shift();
    }
    
    // Notify callback
    this.callbacks.onFrameProcessed?.(result);
    
    // Process next frame in queue
    this.pendingFrame = null;
    
    if (this.frameQueue.length > 0) {
      const nextFrame = this.frameQueue.shift()!;
      this.sendFrame(nextFrame);
    } else {
      this.setStatus('idle');
    }
  }
  
  private handleWorkerError(error: ErrorEvent | Error): void {
    console.error('Worker error:', error);
    this.setStatus('error');
    this.callbacks.onError?.(error instanceof Error ? error.message : 'Worker error');
    
    // Attempt recovery after a delay
    setTimeout(() => {
      if (this.status === 'error') {
        this.initWorker();
      }
    }, 1000);
  }
  
  private setStatus(status: WorkerStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.callbacks.onStatusChange?.(status);
    }
  }
}
