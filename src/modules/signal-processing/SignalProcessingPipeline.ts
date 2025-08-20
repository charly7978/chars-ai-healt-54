
import { ProcessedSignal, ProcessingError } from '../../types/signal';
import { AdvancedPPGExtractor } from './AdvancedPPGExtractor';
import { SignalAnalyzer } from './SignalAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';

export interface SignalQualityMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  overallQuality: number;
  timestamp: number;
}

export class SignalProcessingPipeline {
  // COMPONENTES REALES ÚNICAMENTE - NO MÁS SEÑALES DÉBILES
  private ppgExtractor: AdvancedPPGExtractor;
  private signalAnalyzer: SignalAnalyzer;
  private biophysicalValidator: BiophysicalValidator;
  
  // Estado del procesamiento
  private isProcessing = false;
  private frameCount = 0;
  
  constructor() {
    console.log('🔬 SignalProcessingPipeline: Pipeline PPG REAL inicializado - SIN SIMULACIONES');
    
    // Inicializar ÚNICAMENTE componentes reales
    this.ppgExtractor = new AdvancedPPGExtractor();
    this.signalAnalyzer = new SignalAnalyzer({
      QUALITY_LEVELS: 5,
      QUALITY_HISTORY_SIZE: 15,
      MIN_CONSECUTIVE_DETECTIONS: 3,
      MAX_CONSECUTIVE_NO_DETECTIONS: 6
    });
    this.biophysicalValidator = new BiophysicalValidator();
  }
  
  // Callbacks para comunicación
  private signalCallback?: (signal: ProcessedSignal) => void;
  private errorCallback?: (error: ProcessingError) => void;
  private qualityCallback?: (quality: SignalQualityMetrics) => void;
  
  public onSignal(callback: (signal: ProcessedSignal) => void): void {
    this.signalCallback = callback;
  }
  
  public onError(callback: (error: ProcessingError) => void): void {
    this.errorCallback = callback;
  }
  
  public onQuality(callback: (quality: SignalQualityMetrics) => void): void {
    this.qualityCallback = callback;
  }
  
  public start(): void {
    if (this.isProcessing) return;
    
    console.log('🚀 SignalProcessingPipeline: INICIANDO procesamiento PPG REAL - Solo señales auténticas');
    this.isProcessing = true;
    this.frameCount = 0;
    
    // Reset de TODOS los componentes reales
    this.ppgExtractor.reset();
    this.signalAnalyzer.reset();
    this.biophysicalValidator.reset();
  }
  
  public stop(): void {
    console.log('⏹️ SignalProcessingPipeline: Deteniendo procesamiento REAL');
    this.isProcessing = false;
  }
  
  public async processFrame(imageData: ImageData): Promise<void> {
    if (!this.isProcessing) return;
    
    try {
      this.frameCount++;
      
      // 1. EXTRACCIÓN PPG AVANZADA REAL - método CHROM + filtros
      const ppgResult = this.ppgExtractor.extractPPGSignal(imageData);
      
      // 2. VALIDACIÓN BIOFÍSICA ESTRICTA
      const biophysicalResult = this.biophysicalValidator.validateSignal({
        value: ppgResult.filteredSignal,
        timestamp: Date.now(),
        quality: ppgResult.quality
      });
      
      // 3. ANÁLISIS DE SEÑAL ADICIONAL
      this.signalAnalyzer.updateDetectorScores({
        redChannel: ppgResult.fingerDetected ? 0.8 : 0.2,
        stability: Math.min(1, ppgResult.snr / 15),
        pulsatility: Math.min(1, Math.abs(ppgResult.filteredSignal) / 5),
        biophysical: biophysicalResult.score,
        periodicity: ppgResult.quality / 100
      });
      
      const analysisResult = this.signalAnalyzer.analyzeSignalMultiDetector(
        ppgResult.filteredSignal,
        { trend: 'STABLE' }
      );
      
      // 4. COMBINACIÓN DE RESULTADOS - SOLO SEÑALES VÁLIDAS
      const finalQuality = Math.min(
        ppgResult.quality, 
        analysisResult.quality,
        biophysicalResult.score * 100
      );
      
      const finalDetection = ppgResult.fingerDetected && 
                           analysisResult.isFingerDetected && 
                           biophysicalResult.isValid &&
                           finalQuality > 25; // Umbral mínimo más estricto
      
      // 5. SEÑAL PROCESADA FINAL - 100% REAL
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: Math.round(ppgResult.rawSignal * 1000) / 1000,
        filteredValue: Math.round(ppgResult.filteredSignal * 1000) / 1000,
        quality: Math.round(finalQuality),
        fingerDetected: finalDetection,
        roi: { x: 0, y: 0, width: 100, height: 100 },
        perfusionIndex: this.calculateRealPerfusionIndex(ppgResult)
      };
      
      // 6. MÉTRICAS DE CALIDAD REALES
      const qualityMetrics: SignalQualityMetrics = {
        signalStrength: Math.min(1, Math.abs(ppgResult.filteredSignal) / 10),
        noiseLevel: Math.max(0, 1 - ppgResult.snr / 20),
        perfusionIndex: processedSignal.perfusionIndex || 0,
        overallQuality: finalQuality,
        timestamp: Date.now()
      };
      
      // 7. LOG DETALLADO CADA 90 FRAMES
      if (this.frameCount % 90 === 0) {
        console.log("🔍 SignalProcessingPipeline: Estado REAL detallado", {
          frame: this.frameCount,
          ppgQuality: ppgResult.quality,
          finalQuality: finalQuality,
          snr: ppgResult.snr.toFixed(1),
          fingerDetected: finalDetection,
          rawSignal: ppgResult.rawSignal.toFixed(3),
          filteredSignal: ppgResult.filteredSignal.toFixed(3),
          biophysicalValid: biophysicalResult.isValid,
          biophysicalScore: biophysicalResult.score.toFixed(2)
        });
      }
      
      // 8. ENVÍO DE RESULTADOS REALES
      if (this.signalCallback) {
        this.signalCallback(processedSignal);
      }
      
      if (this.qualityCallback) {
        this.qualityCallback(qualityMetrics);
      }
      
    } catch (error) {
      const errorData: ProcessingError = {
        message: `Error en pipeline PPG REAL: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
        code: 'REAL_PPG_PIPELINE_ERROR'
      };
      
      console.error("❌ SignalProcessingPipeline: Error crítico REAL", errorData);
      
      if (this.errorCallback) {
        this.errorCallback(errorData);
      }
    }
  }
  
  private calculateRealPerfusionIndex(ppgResult: any): number {
    // Índice de perfusión REAL basado en amplitud AC/DC
    const acComponent = Math.abs(ppgResult.filteredSignal);
    const dcComponent = Math.abs(ppgResult.rawSignal) || 0.1;
    
    const perfusionIndex = (acComponent / dcComponent) * 100;
    
    // Limitar a rango fisiológico real (0.1% - 20%)
    return Math.max(0.1, Math.min(20, perfusionIndex));
  }
}
