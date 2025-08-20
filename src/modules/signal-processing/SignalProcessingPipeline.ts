
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
  // Componentes de procesamiento real
  private ppgExtractor: AdvancedPPGExtractor;
  private signalAnalyzer: SignalAnalyzer;
  private biophysicalValidator: BiophysicalValidator;
  
  // Estado del procesamiento
  private isProcessing = false;
  private frameCount = 0;
  
  constructor() {
    console.log('🔬 SignalProcessingPipeline: Inicializando pipeline PPG avanzado');
    
    // Inicializar componentes reales
    this.ppgExtractor = new AdvancedPPGExtractor();
    this.signalAnalyzer = new SignalAnalyzer({
      QUALITY_LEVELS: 5,
      QUALITY_HISTORY_SIZE: 20,
      MIN_CONSECUTIVE_DETECTIONS: 4,
      MAX_CONSECUTIVE_NO_DETECTIONS: 8
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
    
    console.log('🚀 SignalProcessingPipeline: Iniciando procesamiento PPG REAL avanzado');
    this.isProcessing = true;
    this.frameCount = 0;
    
    // Reset de todos los componentes
    this.ppgExtractor.reset();
    this.signalAnalyzer.reset();
    this.biophysicalValidator.reset();
  }
  
  public stop(): void {
    console.log('⏹️ SignalProcessingPipeline: Deteniendo procesamiento');
    this.isProcessing = false;
  }
  
  public async processFrame(imageData: ImageData): Promise<void> {
    if (!this.isProcessing) return;
    
    try {
      this.frameCount++;
      
      // 1. Extraer señal PPG avanzada
      const ppgResult = this.ppgExtractor.extractPPGSignal(imageData);
      
      // 2. Análisis adicional de la señal
      const analysisResult = this.signalAnalyzer.analyzeSignalMultiDetector(
        ppgResult.filteredSignal,
        { trend: 'STABLE' }
      );
      
      // 3. Validación biofísica
      const biophysicalResult = this.biophysicalValidator.validateSignal({
        value: ppgResult.filteredSignal,
        timestamp: Date.now(),
        quality: ppgResult.quality
      });
      
      // 4. Combinar resultados
      const finalQuality = Math.min(ppgResult.quality, analysisResult.quality * 100);
      const finalDetection = ppgResult.fingerDetected && analysisResult.isFingerDetected && biophysicalResult.isValid;
      
      // 5. Crear señal procesada
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: Math.round(ppgResult.rawSignal * 100) / 100,
        filteredValue: Math.round(ppgResult.filteredSignal * 100) / 100,
        quality: Math.round(finalQuality),
        fingerDetected: finalDetection,
        roi: { x: 0, y: 0, width: 100, height: 100 },
        perfusionIndex: this.calculatePerfusionIndex(ppgResult)
      };
      
      // 6. Métricas de calidad
      const qualityMetrics: SignalQualityMetrics = {
        signalStrength: ppgResult.snr / 20, // Normalizar SNR
        noiseLevel: Math.max(0, 1 - ppgResult.snr / 15),
        perfusionIndex: processedSignal.perfusionIndex || 0,
        overallQuality: finalQuality,
        timestamp: Date.now()
      };
      
      // 7. Log periódico para monitoreo
      if (this.frameCount % 60 === 0) {
        console.log("SignalProcessingPipeline: Estado procesamiento", {
          frame: this.frameCount,
          quality: finalQuality,
          snr: ppgResult.snr,
          fingerDetected: finalDetection,
          rawSignal: ppgResult.rawSignal,
          filteredSignal: ppgResult.filteredSignal
        });
      }
      
      // 8. Enviar resultados
      if (this.signalCallback) {
        this.signalCallback(processedSignal);
      }
      
      if (this.qualityCallback) {
        this.qualityCallback(qualityMetrics);
      }
      
    } catch (error) {
      const errorData: ProcessingError = {
        message: `Error en pipeline PPG: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
        code: 'PPG_PIPELINE_ERROR'
      };
      
      console.error("SignalProcessingPipeline: Error crítico", errorData);
      
      if (this.errorCallback) {
        this.errorCallback(errorData);
      }
    }
  }
  
  private calculatePerfusionIndex(ppgResult: any): number {
    // Índice de perfusión basado en amplitud de señal PPG
    const amplitude = Math.abs(ppgResult.filteredSignal);
    const dcComponent = Math.abs(ppgResult.rawSignal) || 1;
    
    return Math.min(10, (amplitude / dcComponent) * 100);
  }
}
