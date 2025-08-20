
import { ImageData } from '../../types/image';
import { AdvancedPPGExtractor } from './AdvancedPPGExtractor';

export interface SignalQualityMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  overallQuality: number;
  timestamp: number;
}

export class PPGSignalProcessor {
  private readonly MAX_CONSECUTIVE_DETECTIONS = 8;
  private readonly MAX_CONSECUTIVE_NO_DETECTIONS = 5;
  
  private consecutiveDetections: number = 0;
  private consecutiveNoDetections: number = 0;
  private lastFingerDetected: boolean = false;
  private ppgExtractor: AdvancedPPGExtractor;
  
  public onSignalReady: ((signal: any) => void) | null = null;
  public onError: ((error: any) => void) | null = null;
  public isProcessing: boolean = false;

  constructor(
    onSignalReady?: (signal: any) => void,
    onError?: (error: any) => void
  ) {
    this.onSignalReady = onSignalReady || null;
    this.onError = onError || null;
    this.ppgExtractor = new AdvancedPPGExtractor();
  }

  public start(): void {
    console.log("PPGSignalProcessor: Iniciando procesamiento PPG avanzado");
    this.isProcessing = true;
    this.ppgExtractor.reset();
  }

  public stop(): void {
    console.log("PPGSignalProcessor: Deteniendo procesamiento PPG");
    this.isProcessing = false;
  }

  public reset(): void {
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    this.lastFingerDetected = false;
    this.ppgExtractor.reset();
  }

  public async calibrate(): Promise<void> {
    return new Promise((resolve) => {
      console.log("PPGSignalProcessor: Iniciando calibración avanzada");
      
      // Reset completo del sistema
      this.reset();
      
      // Calibración real - resetear extractores
      setTimeout(() => {
        console.log("PPGSignalProcessor: Calibración completada");
        resolve();
      }, 1500);
    });
  }

  public processFrame(imageData: ImageData): void {
    if (!this.isProcessing) return;
    
    try {
      const now = Date.now();
      
      // Extraer señal PPG mejorada
      const ppgResult = this.ppgExtractor.extractPPGSignal(imageData);
      
      // Aplicar histéresis para detección estable
      const fingerDetected = this.applyDetectionHysteresis(ppgResult.fingerDetected);
      
      // Preparar señal procesada
      const signal = {
        timestamp: now,
        fingerDetected,
        quality: Math.round(ppgResult.quality),
        rawValue: Math.round(ppgResult.rawSignal * 100) / 100,
        filteredValue: Math.round(ppgResult.filteredSignal * 100) / 100,
        snr: Math.round(ppgResult.snr * 10) / 10
      };
      
      // Log detallado cada 30 frames para monitoreo
      if (Math.floor(now / 100) % 30 === 0) {
        console.log("PPGSignalProcessor: Estado actual", {
          fingerDetected,
          quality: signal.quality,
          snr: signal.snr,
          rawValue: signal.rawValue,
          filteredValue: signal.filteredValue
        });
      }
      
      // Enviar señal procesada
      if (this.onSignalReady) {
        this.onSignalReady(signal);
      }
      
    } catch (error) {
      console.error("PPGSignalProcessor: Error procesando frame:", error);
      if (this.onError) {
        this.onError({
          code: 'FRAME_PROCESSING_ERROR',
          message: `Error en procesamiento: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Aplica histéresis para evitar fluctuaciones en detección
   */
  private applyDetectionHysteresis(currentDetection: boolean): boolean {
    if (currentDetection) {
      this.consecutiveDetections = Math.min(this.consecutiveDetections + 1, this.MAX_CONSECUTIVE_DETECTIONS);
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections = Math.min(this.consecutiveNoDetections + 1, this.MAX_CONSECUTIVE_NO_DETECTIONS);
      if (this.consecutiveNoDetections >= 3) {
        this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
      }
    }
    
    // Requerir al menos 4 detecciones consecutivas para confirmar
    const isDetected = this.consecutiveDetections >= 4;
    this.lastFingerDetected = isDetected;
    
    return isDetected;
  }
}
