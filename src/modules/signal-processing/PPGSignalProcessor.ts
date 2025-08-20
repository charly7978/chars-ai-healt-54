
import { ImageData } from '../../types/image';
import { AdvancedPPGExtractor } from './AdvancedPPGExtractor';
import { SignalQualityAnalyzer } from './SignalQualityAnalyzer';

export interface SignalQualityMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  overallQuality: number;
  timestamp: number;
}

export class PPGSignalProcessor {
  private readonly MAX_CONSECUTIVE_DETECTIONS = 6;
  private readonly MAX_CONSECUTIVE_NO_DETECTIONS = 4;
  
  private consecutiveDetections: number = 0;
  private consecutiveNoDetections: number = 0;
  private lastFingerDetected: boolean = false;
  
  // USAR EXCLUSIVAMENTE EL EXTRACTOR AVANZADO
  private ppgExtractor: AdvancedPPGExtractor;
  private qualityAnalyzer: SignalQualityAnalyzer;
  
  public onSignalReady: ((signal: any) => void) | null = null;
  public onError: ((error: any) => void) | null = null;
  public isProcessing: boolean = false;

  constructor(
    onSignalReady?: (signal: any) => void,
    onError?: (error: any) => void
  ) {
    console.log("🔬 PPGSignalProcessor: Inicializando con extractor PPG REAL avanzado");
    this.onSignalReady = onSignalReady || null;
    this.onError = onError || null;
    
    // COMPONENTES REALES ÚNICAMENTE
    this.ppgExtractor = new AdvancedPPGExtractor();
    this.qualityAnalyzer = new SignalQualityAnalyzer();
  }

  public start(): void {
    console.log("🚀 PPGSignalProcessor: Iniciando procesamiento PPG REAL mejorado");
    this.isProcessing = true;
    this.ppgExtractor.reset();
    this.qualityAnalyzer.reset();
  }

  public stop(): void {
    console.log("⏹️ PPGSignalProcessor: Deteniendo procesamiento PPG");
    this.isProcessing = false;
  }

  public reset(): void {
    console.log("🔄 PPGSignalProcessor: Reset completo del sistema PPG");
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    this.lastFingerDetected = false;
    this.ppgExtractor.reset();
    this.qualityAnalyzer.reset();
  }

  public async calibrate(): Promise<void> {
    return new Promise((resolve) => {
      console.log("🎯 PPGSignalProcessor: Calibrando extractor PPG avanzado");
      
      // Reset completo del sistema
      this.reset();
      
      // Tiempo de calibración para estabilizar algoritmos
      setTimeout(() => {
        console.log("✅ PPGSignalProcessor: Calibración PPG completada");
        resolve();
      }, 2000);
    });
  }

  public processFrame(imageData: ImageData): void {
    if (!this.isProcessing) return;
    
    try {
      const now = Date.now();
      
      // USAR ÚNICAMENTE EL EXTRACTOR AVANZADO - NO MÁS SEÑALES DÉBILES
      const ppgResult = this.ppgExtractor.extractPPGSignal(imageData);
      
      // Log cada 60 frames para monitoreo de señal real
      if (Math.floor(now / 100) % 60 === 0) {
        console.log("🔍 PPGSignalProcessor: Análisis señal PPG REAL", {
          rawSignal: ppgResult.rawSignal.toFixed(3),
          filteredSignal: ppgResult.filteredSignal.toFixed(3),
          quality: ppgResult.quality,
          snr: ppgResult.snr.toFixed(1),
          fingerDetected: ppgResult.fingerDetected,
          timestamp: now
        });
      }
      
      // Métricas de calidad usando el analizador
      const qualityMetrics = this.qualityAnalyzer.calculateMetrics(ppgResult.filteredSignal);
      
      // Histéresis mejorada para detección estable
      const fingerDetected = this.applyImprovedHysteresis(ppgResult.fingerDetected, ppgResult.quality);
      
      // Señal procesada final con datos REALES
      const signal = {
        timestamp: now,
        fingerDetected,
        quality: Math.round(ppgResult.quality),
        rawValue: Math.round(ppgResult.rawSignal * 1000) / 1000,
        filteredValue: Math.round(ppgResult.filteredSignal * 1000) / 1000,
        snr: Math.round(ppgResult.snr * 10) / 10,
        perfusionIndex: qualityMetrics.perfusionIndex,
        signalStrength: qualityMetrics.signalStrength
      };
      
      // Validar que la señal es suficientemente fuerte
      if (fingerDetected && ppgResult.quality < 20) {
        console.warn("⚠️ PPGSignalProcessor: Señal detectada pero calidad muy baja", {
          quality: ppgResult.quality,
          snr: ppgResult.snr
        });
      }
      
      // Enviar señal mejorada
      if (this.onSignalReady) {
        this.onSignalReady(signal);
      }
      
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error crítico en procesamiento:", error);
      if (this.onError) {
        this.onError({
          code: 'PPG_PROCESSING_ERROR',
          message: `Error PPG: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Histéresis mejorada con validación de calidad
   */
  private applyImprovedHysteresis(currentDetection: boolean, quality: number): boolean {
    if (currentDetection && quality > 25) {
      this.consecutiveDetections = Math.min(this.consecutiveDetections + 1, this.MAX_CONSECUTIVE_DETECTIONS);
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections = Math.min(this.consecutiveNoDetections + 1, this.MAX_CONSECUTIVE_NO_DETECTIONS);
      if (this.consecutiveNoDetections >= 2) {
        this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
      }
    }
    
    // Requerir menos detecciones consecutivas pero con mejor calidad
    const isDetected = this.consecutiveDetections >= 3 && quality > 20;
    this.lastFingerDetected = isDetected;
    
    return isDetected;
  }
}
