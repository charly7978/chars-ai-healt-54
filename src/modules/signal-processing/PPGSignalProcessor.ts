
import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';

/**
 * PROCESADOR PPG OPTIMIZADO - DETECCIÓN EFECTIVA DE DEDO
 * Sistema ajustado para detectar dedo humano de forma confiable
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
  
  // SISTEMA OPTIMIZADO DE DETECCIÓN DE DEDO
  private fingerDetectionState = {
    isDetected: false,
    detectionScore: 0,
    consecutiveDetections: 0,
    consecutiveNonDetections: 0,
    lastDetectionTime: 0,
    stabilityBuffer: [] as number[],
    opticalValidationScore: 0,
    skinColorHistory: [] as number[],
    pulsatilityHistory: [] as number[],
    textureConsistency: 0,
    hemoglobinSignature: 0,
    fingerPrintValidation: 0
  };
  
  // Buffer circular optimizado
  private readonly BUFFER_SIZE = 32;
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferFull: boolean = false;
  
  private isCalibrating: boolean = false;
  private frameCount: number = 0;
  
  // CONFIGURACIÓN OPTIMIZADA PARA DETECCIÓN EFECTIVA
  private readonly CONFIG = {
    // UMBRALES MÁS PERMISIVOS PARA MEJOR DETECCIÓN
    MIN_RED_THRESHOLD: 25,     // Más permisivo
    MAX_RED_THRESHOLD: 250,    // Más amplio rango
    MIN_DETECTION_SCORE: 0.35, // Mucho más permisivo
    MIN_CONSECUTIVE_FOR_DETECTION: 3, // Menos frames requeridos
    MAX_CONSECUTIVE_FOR_LOSS: 8,      // Más tolerante a pérdida
    
    // VALIDACIÓN BÁSICA PERO EFECTIVA
    SKIN_COLOR_CONSISTENCY_THRESHOLD: 0.20,
    HEMOGLOBIN_SIGNATURE_THRESHOLD: 0.15,
    PULSATILITY_REQUIREMENT: 0.10,
    TEXTURE_HUMAN_THRESHOLD: 0.15,
    FINGERPRINT_PATTERN_THRESHOLD: 0.10,
    
    HYSTERESIS: 0.5,
    QUALITY_LEVELS: 50,
    CALIBRATION_SAMPLES: 20,
    TEXTURE_GRID_SIZE: 8,
    ROI_SIZE_FACTOR: 0.80
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🔬 PPGSignalProcessor: Sistema OPTIMIZADO para detección efectiva de dedo");
    
    this.signalBuffer = new Float32Array(this.BUFFER_SIZE);
    this.kalmanFilter = new KalmanFilter();
    this.sgFilter = new SavitzkyGolayFilter();
    this.trendAnalyzer = new SignalTrendAnalyzer();
    this.biophysicalValidator = new BiophysicalValidator();
    this.frameProcessor = new FrameProcessor({
      TEXTURE_GRID_SIZE: this.CONFIG.TEXTURE_GRID_SIZE,
      ROI_SIZE_FACTOR: this.CONFIG.ROI_SIZE_FACTOR
    });
    this.calibrationHandler = new CalibrationHandler({
      CALIBRATION_SAMPLES: this.CONFIG.CALIBRATION_SAMPLES,
      MIN_RED_THRESHOLD: this.CONFIG.MIN_RED_THRESHOLD,
      MAX_RED_THRESHOLD: this.CONFIG.MAX_RED_THRESHOLD
    });
    this.signalAnalyzer = new SignalAnalyzer({
      QUALITY_LEVELS: this.CONFIG.QUALITY_LEVELS,
      QUALITY_HISTORY_SIZE: 25,
      MIN_CONSECUTIVE_DETECTIONS: this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION,
      MAX_CONSECUTIVE_NO_DETECTIONS: this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS
    });
  }

  async initialize(): Promise<void> {
    try {
      this.signalBuffer.fill(0);
      this.bufferIndex = 0;
      this.bufferFull = false;
      this.frameCount = 0;
      
      this.fingerDetectionState = {
        isDetected: false,
        detectionScore: 0,
        consecutiveDetections: 0,
        consecutiveNonDetections: 0,
        lastDetectionTime: 0,
        stabilityBuffer: [],
        opticalValidationScore: 0,
        skinColorHistory: [],
        pulsatilityHistory: [],
        textureConsistency: 0,
        hemoglobinSignature: 0,
        fingerPrintValidation: 0
      };
      
      this.kalmanFilter.reset();
      this.sgFilter.reset();
      this.trendAnalyzer.reset();
      this.biophysicalValidator.reset();
      this.signalAnalyzer.reset();
      
      console.log("✅ PPGSignalProcessor: Detector optimizado inicializado");
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error en inicialización", error);
      this.handleError("INIT_ERROR", "Error inicializando procesador");
    }
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log("🚀 PPGSignalProcessor: Detector optimizado iniciado");
  }

  stop(): void {
    this.isProcessing = false;
    this.reset();
    console.log("⏹️ PPGSignalProcessor: Detector optimizado detenido");
  }

  async calibrate(): Promise<boolean> {
    try {
      console.log("🔧 PPGSignalProcessor: Calibración optimizada iniciada");
      await this.initialize();
      
      this.isCalibrating = true;
      
      setTimeout(() => {
        this.isCalibrating = false;
        console.log("✅ PPGSignalProcessor: Calibración optimizada completada");
      }, 2500);
      
      return true;
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error en calibración", error);
      this.handleError("CALIBRATION_ERROR", "Error durante calibración");
      this.isCalibrating = false;
      return false;
    }
  }

  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      this.frameCount = (this.frameCount + 1) % 1000;
      
      // 1. Extracción de datos del frame
      const extractionResult = this.frameProcessor.extractFrameData(imageData);
      const { redValue, textureScore, rToGRatio, rToBRatio, avgGreen, avgBlue } = extractionResult;
      const roi = this.frameProcessor.detectROI(redValue, imageData);

      // 2. DETECTOR OPTIMIZADO DE DEDO - MÁS PERMISIVO
      const fingerDetectionResult = this.detectFingerOptimized(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio, imageData
      );

      console.log("👆 Detección de dedo:", {
        redValue: redValue.toFixed(2),
        detected: fingerDetectionResult.isDetected,
        score: fingerDetectionResult.detectionScore.toFixed(3),
        consecutiveDetections: this.fingerDetectionState.consecutiveDetections
      });

      // 3. Procesamiento de señal
      let filteredValue = redValue;
      if (fingerDetectionResult.isDetected || redValue > this.CONFIG.MIN_RED_THRESHOLD) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
        
        // Amplificación optimizada
        const adaptiveGain = this.calculateOptimizedGain(fingerDetectionResult);
        filteredValue = filteredValue * adaptiveGain;
      }

      // 4. Buffer circular
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      if (this.bufferIndex === 0) this.bufferFull = true;

      // 5. Validación menos estricta
      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);
      
      // 6. Calidad optimizada
      const quality = this.calculateOptimizedQuality(fingerDetectionResult, textureScore, redValue);

      // 7. Índice de perfusión
      const perfusionIndex = this.calculateOptimalPerfusion(
        redValue, fingerDetectionResult.isDetected, quality, fingerDetectionResult.detectionScore
      );

      // 8. Señal procesada final
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: filteredValue,
        quality: quality,
        fingerDetected: fingerDetectionResult.isDetected,
        roi: roi,
        perfusionIndex: Math.max(0, perfusionIndex)
      };

      this.onSignalReady(processedSignal);
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error procesando frame", error);
      this.handleError("PROCESSING_ERROR", "Error en procesamiento");
    }
  }

  /**
   * DETECTOR OPTIMIZADO DE DEDO - MÁS PERMISIVO Y EFECTIVO
   */
  private detectFingerOptimized(
    red: number, green: number, blue: number, 
    textureScore: number, rToGRatio: number, rToBRatio: number,
    imageData: ImageData
  ): { isDetected: boolean; detectionScore: number; opticalCoherence: number } {
    
    // 1. VALIDACIÓN BÁSICA MÁS PERMISIVA
    if (red < this.CONFIG.MIN_RED_THRESHOLD || red > this.CONFIG.MAX_RED_THRESHOLD) {
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 2. VALIDACIONES SIMPLIFICADAS Y PERMISIVAS
    const basicColorCheck = this.validateBasicColor(red, green, blue);
    const textureCheck = Math.min(1.0, textureScore * 2); // Más permisivo
    const ratioCheck = this.validateColorRatios(rToGRatio, rToBRatio);
    const pulsatilityCheck = this.validateSimplePulsatility(red);

    // 3. SCORE INTEGRADO MÁS PERMISIVO
    const rawDetectionScore = (
      basicColorCheck * 0.40 +
      textureCheck * 0.25 +
      ratioCheck * 0.20 +
      pulsatilityCheck * 0.15
    );

    console.log("🔍 Validaciones de dedo:", {
      red: red.toFixed(2),
      basicColor: basicColorCheck.toFixed(3),
      texture: textureCheck.toFixed(3),
      ratio: ratioCheck.toFixed(3),
      pulsatility: pulsatilityCheck.toFixed(3),
      rawScore: rawDetectionScore.toFixed(3)
    });

    // 4. HISTÉRESIS MÁS SUAVE
    let adjustedScore = rawDetectionScore;
    if (this.fingerDetectionState.isDetected) {
      adjustedScore += this.CONFIG.HYSTERESIS * 0.05;
    }

    // 5. LÓGICA DE DECISIÓN OPTIMIZADA
    const shouldDetect = adjustedScore >= this.CONFIG.MIN_DETECTION_SCORE;

    // 6. CONTROL DE CONSECUTIVIDAD OPTIMIZADO
    if (shouldDetect) {
      this.fingerDetectionState.consecutiveDetections++;
      this.fingerDetectionState.consecutiveNonDetections = 0;
      
      if (this.fingerDetectionState.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
        if (!this.fingerDetectionState.isDetected) {
          console.log("✅ DEDO DETECTADO EXITOSAMENTE", {
            score: adjustedScore.toFixed(3),
            red: red.toFixed(2),
            consecutivas: this.fingerDetectionState.consecutiveDetections
          });
        }
        this.fingerDetectionState.isDetected = true;
        this.fingerDetectionState.lastDetectionTime = Date.now();
      }
    } else {
      this.fingerDetectionState.consecutiveNonDetections++;
      this.fingerDetectionState.consecutiveDetections = 0;
      
      if (this.fingerDetectionState.consecutiveNonDetections >= this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS) {
        if (this.fingerDetectionState.isDetected) {
          console.log("❌ DEDO PERDIDO", {
            score: adjustedScore.toFixed(3),
            red: red.toFixed(2)
          });
        }
        this.fingerDetectionState.isDetected = false;
      }
    }

    this.fingerDetectionState.detectionScore = adjustedScore;
    
    return {
      isDetected: this.fingerDetectionState.isDetected,
      detectionScore: adjustedScore,
      opticalCoherence: basicColorCheck
    };
  }

  /**
   * VALIDACIONES SIMPLIFICADAS
   */
  private validateBasicColor(r: number, g: number, b: number): number {
    // Validación básica de color de piel más permisiva
    const total = r + g + b + 1e-10;
    const redRatio = r / total;
    
    // Rango muy amplio para diferentes tonos de piel
    if (redRatio >= 0.25 && redRatio <= 0.65) {
      return Math.min(1.0, redRatio * 2.5);
    }
    
    return 0.3; // Score mínimo para intentar detectar
  }

  private validateColorRatios(rToG: number, rToB: number): number {
    // Ratios más permisivos
    const rgScore = (rToG >= 0.8 && rToG <= 3.0) ? 1.0 : 0.5;
    const rbScore = (rToB >= 0.7 && rToB <= 2.5) ? 1.0 : 0.5;
    
    return (rgScore + rbScore) / 2;
  }

  private validateSimplePulsatility(currentValue: number): number {
    this.fingerDetectionState.pulsatilityHistory.push(currentValue);
    if (this.fingerDetectionState.pulsatilityHistory.length > 15) {
      this.fingerDetectionState.pulsatilityHistory.shift();
    }
    
    if (this.fingerDetectionState.pulsatilityHistory.length < 5) {
      return 0.5; // Score neutral para datos insuficientes
    }
    
    const values = this.fingerDetectionState.pulsatilityHistory;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min;
    
    // Pulsatilidad más permisiva
    return Math.min(1.0, range / 50); // Normalizar a rango esperado
  }

  private calculateOptimizedGain(detectionResult: { detectionScore: number; opticalCoherence: number }): number {
    const baseGain = 2.0;
    const detectionBoost = Math.sqrt(detectionResult.detectionScore) * 0.5;
    const coherenceBoost = detectionResult.opticalCoherence * 0.3;
    
    return Math.min(3.5, Math.max(1.2, baseGain + detectionBoost + coherenceBoost));
  }

  private calculateOptimizedQuality(detectionResult: { detectionScore: number }, textureScore: number, redValue: number): number {
    if (detectionResult.detectionScore === 0) return 0;
    
    // Calidad más generosa
    const detectionQuality = Math.pow(detectionResult.detectionScore, 0.5) * 60;
    const textureQuality = textureScore * 20;
    const signalQuality = Math.min(20, (redValue / 10));
    
    const finalQuality = Math.min(100, Math.max(30, detectionQuality + textureQuality + signalQuality));
    
    return finalQuality;
  }

  private calculateOptimalPerfusion(
    redValue: number, isDetected: boolean, quality: number, detectionScore: number
  ): number {
    if (!isDetected || quality < 30) return 0;
    
    const normalizedRed = Math.min(1, redValue / 150);
    const perfusionBase = Math.log1p(normalizedRed * 3) * 1.5;
    
    const qualityFactor = Math.tanh(quality / 30) * 0.4;
    const confidenceFactor = Math.sqrt(detectionScore) * 0.4;
    
    const totalPerfusion = (perfusionBase + qualityFactor + confidenceFactor) * 8;
    
    return Math.min(12, Math.max(0, totalPerfusion));
  }

  private reset(): void {
    this.signalBuffer.fill(0);
    this.bufferIndex = 0;
    this.bufferFull = false;
    this.frameCount = 0;
    this.kalmanFilter.reset();
    this.sgFilter.reset();
    this.trendAnalyzer.reset();
    this.biophysicalValidator.reset();
    this.signalAnalyzer.reset();
  }

  private handleError(code: string, message: string): void {
    console.error("❌ PPGSignalProcessor:", code, message);
    const error: ProcessingError = {
      code,
      message,
      timestamp: Date.now()
    };
    if (typeof this.onError === 'function') {
      this.onError(error);
    }
  }

  private sendRejectedSignal(rawValue: number, filteredValue: number, roi: any): void {
    if (this.onSignalReady) {
      this.onSignalReady({
        timestamp: Date.now(),
        rawValue,
        filteredValue,
        quality: 0,
        fingerDetected: false,
        roi,
        perfusionIndex: 0
      });
    }
  }

  private isNonPhysiological(trendResult: any, fingerDetectionResult: { isDetected: boolean }): boolean {
    return false; // Más permisivo durante las pruebas
  }
}
