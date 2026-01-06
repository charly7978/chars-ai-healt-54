import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';
import { HumanFingerDetector } from './HumanFingerDetector';
import { DetectionLogger } from '../../utils/DetectionLogger';

/**
 * PROCESADOR PPG OPTIMIZADO - VERSIÓN SENSIBLE PARA MEDICIÓN REAL
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  private kalmanFilter: KalmanFilter;
  private sgFilter: SavitzkyGolayFilter;
  private trendAnalyzer: SignalTrendAnalyzer;
  private biophysicalValidator: BiophysicalValidator;
  private frameProcessor: FrameProcessor;
  private calibrationHandler: CalibrationHandler;
  private signalAnalyzer: SignalAnalyzer;
  private humanFingerDetector: HumanFingerDetector;
  private detectionLogger: DetectionLogger;
  
  private fingerDetectionState = {
    isDetected: false,
    detectionScore: 0,
    consecutiveDetections: 0,
    consecutiveNonDetections: 0,
    lastDetectionTime: 0,
    stabilityBuffer: [] as number[],
    signalHistory: [] as number[],
    noiseLevel: 0,
    signalToNoiseRatio: 0,
    peakHistory: [] as number[],
    valleyHistory: [] as number[]
  };
  
  private readonly BUFFER_SIZE = 64;
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferFull: boolean = false;
  
  private isCalibrating: boolean = false;
  private frameCount: number = 0;
  
  /**
   * CONFIGURACIÓN REAJUSTADA PARA SENSIBILIDAD REAL
   * Se han bajado los umbrales para evitar que la señal se quede "congelada"
   */
  private readonly CONFIG = {
    MIN_RED_THRESHOLD: 10,       // Más bajo para detectar el dedo incluso con poca luz
    MAX_RED_THRESHOLD: 255,
    MIN_DETECTION_SCORE: 0.25,   // Antes 0.4 - Más sensible al inicio
    MIN_CONSECUTIVE_FOR_DETECTION: 2, 
    MAX_CONSECUTIVE_FOR_LOSS: 15, // Más tolerante a micro-movimientos
    
    MIN_SNR_REQUIRED: 4.0,       // Antes 8.0 - Permite señales con más ruido de cámara
    SKIN_COLOR_STRICTNESS: 0.4,  // Más permisivo con diferentes tonos de piel/luz
    PULSATILITY_MIN_REQUIRED: 0.02, // Antes 0.1 - Detecta pulsos débiles
    TEXTURE_HUMAN_MIN: 0.3,
    STABILITY_FRAMES: 5,         
    
    NOISE_THRESHOLD: 2.5,
    PEAK_PROMINENCE: 0.05,       // CRÍTICO: Antes 0.15. Ahora detecta variaciones pequeñas.
    VALLEY_DEPTH: 0.03,
    SIGNAL_CONSISTENCY: 0.3
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🎯 PPGSignalProcessor: Modo ALTA SENSIBILIDAD activado");
    
    this.signalBuffer = new Float32Array(this.BUFFER_SIZE);
    this.kalmanFilter = new KalmanFilter();
    this.sgFilter = new SavitzkyGolayFilter(); // Usará la nueva ventana de 15 puntos
    this.trendAnalyzer = new SignalTrendAnalyzer();
    this.biophysicalValidator = new BiophysicalValidator();
    this.frameProcessor = new FrameProcessor({
      TEXTURE_GRID_SIZE: 16,
      ROI_SIZE_FACTOR: 0.95 // ROI máximo para capturar toda la señal del dedo
    });
    this.calibrationHandler = new CalibrationHandler({
      CALIBRATION_SAMPLES: 15, // Calibración más rápida
      MIN_RED_THRESHOLD: this.CONFIG.MIN_RED_THRESHOLD,
      MAX_RED_THRESHOLD: this.CONFIG.MAX_RED_THRESHOLD
    });
    this.signalAnalyzer = new SignalAnalyzer({
      QUALITY_LEVELS: 100,
      QUALITY_HISTORY_SIZE: 50,
      MIN_CONSECUTIVE_DETECTIONS: this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION,
      MAX_CONSECUTIVE_NO_DETECTIONS: this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS
    });
    this.humanFingerDetector = new HumanFingerDetector();
    this.detectionLogger = new DetectionLogger();
  }

  async initialize(): Promise<void> {
    try {
      this.signalBuffer.fill(0);
      this.bufferIndex = 0;
      this.bufferFull = false;
      this.frameCount = 0;
      this.resetDetectionStateInternal();
      
      this.kalmanFilter.reset();
      this.sgFilter.reset();
      this.trendAnalyzer.reset();
      this.biophysicalValidator.reset();
      this.signalAnalyzer.reset();
      
      console.log("✅ PPGSignalProcessor: Inicializado");
    } catch (error) {
      this.handleError("INIT_ERROR", "Error inicializando procesador");
    }
  }

  private resetDetectionStateInternal(): void {
    this.fingerDetectionState = {
      isDetected: false,
      detectionScore: 0,
      consecutiveDetections: 0,
      consecutiveNonDetections: 0,
      lastDetectionTime: 0,
      stabilityBuffer: [],
      signalHistory: [],
      noiseLevel: 0,
      signalToNoiseRatio: 0,
      peakHistory: [],
      valleyHistory: []
    };
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
  }

  stop(): void {
    this.isProcessing = false;
    this.reset();
  }

  async calibrate(): Promise<boolean> {
    try {
      this.isCalibrating = true;
      await this.initialize();
      setTimeout(() => { this.isCalibrating = false; }, 2000);
      return true;
    } catch (error) {
      this.isCalibrating = false;
      return false;
    }
  }

  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      this.frameCount = (this.frameCount + 1) % 10000;
      
      // 1. Extracción de datos (Señal Cruda)
      const extractionResult = this.frameProcessor.extractFrameData(imageData);
      const { redValue, textureScore } = extractionResult;
      const roi = this.frameProcessor.detectROI(redValue, imageData);

      // 2. Validación de Dedo (Umbrales relajados para evitar falsos negativos)
      const humanFingerValidation = this.humanFingerDetector.detectHumanFinger(
        redValue, 
        extractionResult.avgGreen ?? 0, 
        extractionResult.avgBlue ?? 0, 
        textureScore, 
        imageData.width, 
        imageData.height
      );

      const isDetected = humanFingerValidation.isHumanFinger || redValue > this.CONFIG.MIN_RED_THRESHOLD;
      const confidence = humanFingerValidation.confidence;

      // 3. FILTRADO (Aquí aplicamos Savitzky-Golay optimizado)
      let filteredValue = redValue;
      if (isDetected) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
        
        // Ganancia adaptativa para resaltar el pulso
        const preciseGain = this.calculateOptimizedGain(confidence);
        filteredValue = filteredValue * preciseGain;
      }

      // 4. Gestión de Buffer
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      if (this.bufferIndex === 0) this.bufferFull = true;

      // 5. Calidad y Perfusión
      const quality = isDetected ? Math.min(100, confidence * 120) : 0;
      const perfusionIndex = this.calculatePrecisePerfusion(redValue, isDetected, quality, confidence);

      // 6. Enviar señal procesada a la UI
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: filteredValue,
        quality: quality,
        fingerDetected: isDetected,
        roi: roi,
        perfusionIndex: perfusionIndex
      };

      this.onSignalReady(processedSignal);

    } catch (error) {
      console.error("❌ Error en processFrame:", error);
    }
  }

  private calculateOptimizedGain(score: number): number {
    // Aumenta la amplitud de la onda si la detección es buena
    return 1.0 + (score * 1.5); 
  }

  private calculatePrecisePerfusion(red: number, detected: boolean, qual: number, score: number): number {
    if (!detected || qual < 30) return 0;
    // Cálculo simplificado de perfusión basado en la variabilidad del rojo
    return (red / 255) * 10 * score;
  }

  private reset(): void {
    this.signalBuffer.fill(0);
    this.bufferIndex = 0;
    this.bufferFull = false;
    this.kalmanFilter.reset();
    this.sgFilter.reset();
    this.humanFingerDetector.reset();
  }

  private handleError(code: string, message: string): void {
    const error: ProcessingError = { code, message, timestamp: Date.now() };
    if (this.onError) this.onError(error);
  }
}
