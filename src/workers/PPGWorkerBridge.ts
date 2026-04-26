/**
 * PPG WORKER BRIDGE
 * 
 * Interfaz para comunicarse con el WebWorker de procesamiento PPG
 * desde el hilo principal de la aplicación.
 */

import type { WorkerMessage, WorkerResponse } from './PPGProcessingWorker';

export interface PPGWorkerBridgeConfig {
  maxRetries: number;
  timeout: number;
  enableDebug: boolean;
}

const DEFAULT_CONFIG: PPGWorkerBridgeConfig = {
  maxRetries: 3,
  timeout: 5000,
  enableDebug: false,
};

export class PPGWorkerBridge {
  private worker: Worker | null = null;
  private config: PPGWorkerBridgeConfig;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private requestId: number = 0;

  constructor(config: Partial<PPGWorkerBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Inicializar el worker
   */
  async initialize(): Promise<void> {
    try {
      // Crear worker desde el archivo TypeScript
      const workerUrl = new URL('./PPGProcessingWorker.ts', import.meta.url);
      this.worker = new Worker(workerUrl, { type: 'module' });

      // Configurar manejador de mensajes
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      console.log('PPGWorkerBridge initialized successfully');
    } catch (error) {
      console.error('Failed to initialize PPGWorkerBridge:', error);
      throw error;
    }
  }

  /**
   * Procesar un frame a través del worker
   */
  async processFrame(
    imageData: ImageData,
    roi: { x: number; y: number; width: number; height: number }
  ): Promise<any> {
    return this.sendMessage({
      type: 'PROCESS_FRAME',
      data: { imageData, roi },
    });
  }

  /**
   * Analizar señal completa
   */
  async analyzeSignal(): Promise<any> {
    return this.sendMessage({
      type: 'ANALYZE_SIGNAL',
      data: {},
    });
  }

  /**
   * Calcular FFT de una señal
   */
  async calculateFFT(signal: number[]): Promise<{ frequencies: number[]; magnitudes: number[] }> {
    return this.sendMessage({
      type: 'CALCULATE_FFT',
      data: { signal },
    });
  }

  /**
   * Aplicar filtro a una señal
   */
  async filterSignal(signal: number[]): Promise<number[]> {
    return this.sendMessage({
      type: 'FILTER_SIGNAL',
      data: { signal },
    });
  }

  /**
   * Detectar picos y valles
   */
  async detectPeaks(signal: number[]): Promise<{ peaks: number[]; valleys: number[] }> {
    return this.sendMessage({
      type: 'DETECT_PEAKS',
      data: { signal },
    });
  }

  /**
   * Limpiar buffers del worker
   */
  async clearBuffers(): Promise<void> {
    // Enviar mensaje especial para limpiar (no implementado en el worker aún)
    console.log('Clearing worker buffers...');
  }

  /**
   * Verificar si el worker está listo
   */
  isReady(): boolean {
    return this.worker !== null;
  }

  /**
   * Obtener estadísticas del worker
   */
  getStats(): {
    isReady: boolean;
    pendingRequests: number;
  } {
    return {
      isReady: this.isReady(),
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Cerrar el worker
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      // Cancelar todas las peticiones pendientes
      for (const [id, request] of this.pendingRequests) {
        clearTimeout(request.timeout);
        request.reject(new Error('Worker terminated'));
      }
      this.pendingRequests.clear();

      // Terminar el worker
      this.worker.terminate();
      this.worker = null;

      console.log('PPGWorkerBridge terminated');
    }
  }

  /**
   * Métodos privados
   */

  private async sendMessage(message: Omit<WorkerMessage, 'id'>): Promise<any> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const id = this.generateRequestId();
    const fullMessage: WorkerMessage = { id, ...message };

    return new Promise((resolve, reject) => {
      // Configurar timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Worker request timeout: ${message.type}`));
      }, this.config.timeout);

      // Guardar petición pendiente
      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
      });

      // Enviar mensaje al worker
      this.worker!.postMessage(fullMessage);

      if (this.config.enableDebug) {
        console.log(`Sent message to worker: ${message.type} (id: ${id})`);
      }
    });
  }

  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const { id, type, data, error } = event.data;

    const request = this.pendingRequests.get(id);
    if (!request) {
      console.warn(`Received response for unknown request: ${id}`);
      return;
    }

    // Limpiar timeout
    clearTimeout(request.timeout);
    this.pendingRequests.delete(id);

    if (this.config.enableDebug) {
      console.log(`Received response from worker: ${type} (id: ${id})`);
    }

    // Resolver o rechazar la promesa
    if (type === 'SUCCESS') {
      request.resolve(data);
    } else {
      request.reject(new Error(error || 'Unknown worker error'));
    }
  }

  private handleWorkerError(event: ErrorEvent): void {
    console.error('Worker error:', event.error);

    // Rechazar todas las peticiones pendientes
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Worker error'));
    }
    this.pendingRequests.clear();
  }

  private generateRequestId(): string {
    return `req_${++this.requestId}_${Date.now()}`;
  }
}

// Singleton para uso global
let workerBridgeInstance: PPGWorkerBridge | null = null;

export function getWorkerBridge(): PPGWorkerBridge {
  if (!workerBridgeInstance) {
    workerBridgeInstance = new PPGWorkerBridge();
  }
  return workerBridgeInstance;
}

export default PPGWorkerBridge;
