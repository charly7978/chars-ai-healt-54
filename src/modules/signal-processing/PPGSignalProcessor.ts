
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
  private readonly MAX_CONSECUTIVE_DETECTIONS = 4; // Reducido
  private readonly MAX_CONSECUTIVE_NO_DETECTIONS = 6; // Aumentado
  
  private consecutiveDetections: number = 0;
  private consecutiveNoDetections: number = 0;
  private lastFingerDetected: boolean = false;
  
  // EXTRACTOR OPTIMIZADO PARA MÁXIMA SENSIBILIDAD
  private ppgExtractor: AdvancedPPGExtractor;
  private qualityAnalyzer: SignalQualityAnalyzer;
  
  public onSignalReady: ((signal: any) => void) | null = null;
  public onError: ((error: any) => void) | null = null;
  public isProcessing: boolean = false;

  constructor(
    onSignalReady?: (signal: any) => void,
    onError?: (error: any) => void
  ) {
    console.log("🔬 PPGSignalProcessor: Inicializando con MÁXIMA SENSIBILIDAD");
    this.onSignalReady = onSignalReady || null;
    this.onError = onError || null;
    
    // COMPONENTES OPTIMIZADOS
    this.ppgExtractor = new AdvancedPPGExtractor();
    this.qualityAnalyzer = new SignalQualityAnalyzer();
  }

  public start(): void {
    console.log("🚀 PPGSignalProcessor: INICIANDO con sensibilidad MÁXIMA");
    this.isProcessing = true;
    this.ppgExtractor.reset();
    this.qualityAnalyzer.reset();
  }

  public stop(): void {
    console.log("⏹️ PPGSignalProcessor: Deteniendo procesamiento");
    this.isProcessing = false;
  }

  public reset(): void {
    console.log("🔄 PPGSignalProcessor: Reset con configuración OPTIMIZADA");
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    this.lastFingerDetected = false;
    this.ppgExtractor.reset();
    this.qualityAnalyzer.reset();
  }

  public async calibrate(): Promise<void> {
    return new Promise((resolve) => {
      console.log("🎯 PPGSignalProcessor: Calibración OPTIMIZADA iniciada");
      
      this.reset();
      
      // Tiempo de calibración reducido
      setTimeout(() => {
        console.log("✅ PPGSignalProcessor: Calibración OPTIMIZADA completada");
        resolve();
      }, 1500); // Más rápido
    });
  }

  public processFrame(imageData: ImageData): void {
    if (!this.isProcessing) return;
    
    try {
      const now = Date.now();
      
      // EXTRACCIÓN OPTIMIZADA
      const ppgResult = this.ppgExtractor.extractPPGSignal(imageData);
      
      // Log cada 45 frames para monitoreo
      if (Math.floor(now / 100) % 45 === 0) {
        console.log("🔍 PPGSignalProcessor: SEÑAL OPTIMIZADA", {
          rawSignal: ppgResult.rawSignal.toFixed(3),
          filteredSignal: ppgResult.filteredSignal.toFixed(3),
          quality: ppgResult.quality,
          snr: ppgResult.snr.toFixed(1),
          fingerDetected: ppgResult.fingerDetected,
          timestamp: now
        });
      }
      
      // Métricas de calidad
      const qualityMetrics = this.qualityAnalyzer.calculateMetrics(ppgResult.filteredSignal);
      
      // Histéresis OPTIMIZADA para estabilidad
      const fingerDetected = this.applyOptimizedHysteresis(ppgResult.fingerDetected, ppgResult.quality);
      
      // Señal final OPTIMIZADA
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
      
      // Validación más permisiva
      if (fingerDetected && ppgResult.quality < 15) {
        console.warn("⚠️ PPGSignalProcessor: Señal detectada con calidad muy baja", {
          quality: ppgResult.quality,
          snr: ppgResult.snr
        });
      }
      
      // Enviar señal
      if (this.onSignalReady) {
        this.onSignalReady(signal);
      }
      
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error en procesamiento:", error);
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
   * Histéresis OPTIMIZADA para mejor detección
   */
  private applyOptimizedHysteresis(currentDetection: boolean, quality: number): boolean {
    if (currentDetection && quality > 15) { // Umbral más bajo
      this.consecutiveDetections = Math.min(this.consecutiveDetections + 1, this.MAX_CONSECUTIVE_DETECTIONS);
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections = Math.min(this.consecutiveNoDetections + 1, this.MAX_CONSECUTIVE_NO_DETECTIONS);
      if (this.consecutiveNoDetections >= 3) { // Más tolerante
        this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
      }
    }
    
    // Requiere menos detecciones consecutivas
    const isDetected = this.consecutiveDetections >= 2 && quality > 12; // Más permisivo
    this.lastFingerDetected = isDetected;
    
    return isDetected;
  }
}
