import { BehaviorSubject, Subject, Observable, from, of } from 'rxjs';
import { filter, map, catchError } from 'rxjs/operators';

export interface ProcessingResult {
  timestamp: number;
  spo2: number;
  spo2Confidence: number;
  systolic: number;
  diastolic: number;
  map: number;
  bpConfidence: number;
  features: {
    pulseWaveVelocity?: number;
    augmentationIndex?: number;
    reflectionIndex?: number;
  };
}

export interface SignalBatch {
  red: Float32Array;
  ir: Float32Array;
  green: Float32Array;
  timestamp: number;
}

export class SignalProcessingService {
  private worker: Worker | null = null;
  private messageId = 0;
  private pendingRequests: Map<
    number,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  > = new Map();

  private resultsSubject = new Subject<ProcessingResult[]>();
  public results$ = this.resultsSubject.asObservable();

  private statusSubject = new BehaviorSubject<'idle' | 'processing' | 'error'>('idle');
  public status$ = this.statusSubject.asObservable();

  private errorSubject = new Subject<Error>();
  public error$ = this.errorSubject.asObservable();

  constructor() {
    this.initializeWorker();
  }

  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not supported in this environment');
    }

    // Create a new worker
    this.worker = new Worker(
      new URL('../workers/SignalProcessor.worker.ts', import.meta.url),
      { type: 'module' }
    );

    // Handle messages from the worker
    this.worker.onmessage = (event: MessageEvent) => {
      const { id, type, payload, error } = event.data;

      if (error) {
        const pendingRequest = this.pendingRequests.get(id);
        if (pendingRequest) {
          pendingRequest.reject(new Error(error));
          this.pendingRequests.delete(id);
        }
        this.statusSubject.next('error');
        this.errorSubject.next(new Error(error));
        return;
      }

      switch (type) {
        case 'PROCESSING_COMPLETE':
          this.resultsSubject.next(payload.results);
          this.statusSubject.next('idle');
          break;

        case 'TRAINING_COMPLETE':
          console.log('Model training completed:', payload);
          break;

        case 'MODELS_SAVED':
          console.log('Models saved successfully');
          break;

        case 'ERROR':
          this.statusSubject.next('error');
          this.errorSubject.next(new Error(payload.message));
          break;

        default:
          // Handle response to a specific request
          const pendingRequest = this.pendingRequests.get(id);
          if (pendingRequest) {
            pendingRequest.resolve(payload);
            this.pendingRequests.delete(id);
          }
      }
    };

    // Handle errors from the worker
    this.worker.onerror = (error) => {
      console.error('Worker error:', error);
      this.statusSubject.next('error');
      this.errorSubject.next(
        new Error(`Worker error: ${error.message || 'Unknown error'}`)
      );
    };

    // Initialize the worker
    this.sendMessage('INIT', {}).catch(console.error);
  }

  private sendMessage<T = any>(
    type: string,
    payload: any = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = this.messageId++;
      this.pendingRequests.set(id, { resolve, reject });

      // Set a timeout to avoid hanging if the worker doesn't respond
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Worker request timed out'));
      }, 30000); // 30 second timeout

      // Clean up the timeout when the request completes
      const originalResolve = resolve;
      resolve = ((value) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      }) as typeof resolve;

      this.worker.postMessage({ id, type, payload });
    });
  }

  public async processSignals(signals: SignalBatch[]): Promise<void> {
    if (this.statusSubject.value === 'processing') {
      console.warn('Already processing signals');
      return;
    }

    this.statusSubject.next('processing');

    try {
      await this.sendMessage('PROCESS_SIGNALS', { signals });
    } catch (error) {
      this.statusSubject.next('error');
      this.errorSubject.next(
        error instanceof Error ? error : new Error('Failed to process signals')
      );
      throw error;
    }
  }

  public async trainModel(trainingData: {
    inputs: any[];
    outputs: any[];
    modelType: 'bp' | 'spo2';
  }): Promise<void> {
    try {
      await this.sendMessage('TRAIN_MODEL', trainingData);
    } catch (error) {
      this.errorSubject.next(
        error instanceof Error ? error : new Error('Failed to train model')
      );
      throw error;
    }
  }

  public async saveModels(): Promise<void> {
    try {
      await this.sendMessage('SAVE_MODELS', {});
    } catch (error) {
      this.errorSubject.next(
        error instanceof Error ? error : new Error('Failed to save models')
      );
      throw error;
    }
  }

  public cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.statusSubject.complete();
    this.resultsSubject.complete();
    this.errorSubject.complete();
  }

  // Helper method to get the latest result
  public getLatestResult(): Observable<ProcessingResult | null> {
    return this.results$.pipe(
      filter(results => results.length > 0),
      map(results => results[results.length - 1])
    );
  }

  // Helper method to get all results
  public getAllResults(): Observable<ProcessingResult[]> {
    return this.results$;
  }

  // Helper method to get the current status
  public getStatus(): 'idle' | 'processing' | 'error' {
    return this.statusSubject.value;
  }
}

// Export a singleton instance
export const signalProcessingService = new SignalProcessingService();

// Clean up on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    signalProcessingService.cleanup();
  });
}
