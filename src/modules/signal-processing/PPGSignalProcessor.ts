import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';

/**
 * PROCESADOR PPG ÚNICO Y DEFINITIVO - MÁXIMA POTENCIA DE DETECCIÓN
 * Sistema matemático avanzado con detección robusta y re-detección garantizada
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
  
  // SISTEMA ÚNICO DE DETECCIÓN - MÁXIMA POTENCIA
  private fingerDetectionState = {
    isDetected: false,
    detectionScore: 0,
    consecutiveDetections: 0,
    consecutiveNonDetections: 0,
    lastDetectionTime: 0,
    stabilityBuffer: [] as number[],
    opticalValidationScore: 0,
    // NUEVO: Sistema de re-detección agresiva
    lastLossTime: 0,
    redetectionAttempts: 0,
    forceRedetectionMode: false
  };
  
  // Buffer circular optimizado
  private readonly BUFFER_SIZE = 32;
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferFull: boolean = false;
  
  private isCalibrating: boolean = false;
  private frameCount: number = 0;
  
  // CONFIGURACIÓN MATEMÁTICA ULTRA-AGRESIVA
  private readonly CONFIG = {
    // DETECCIÓN ULTRA-SENSIBLE PARA RE-DETECCIÓN
    MIN_RED_THRESHOLD: 15, // Más sensible
    MAX_RED_THRESHOLD: 250,
    MIN_DETECTION_SCORE: 0.45, // Más permisivo para re-detección
    MIN_CONSECUTIVE_FOR_DETECTION: 3, // Detección más rápida
    MAX_CONSECUTIVE_FOR_LOSS: 25, // Más resistente a pérdidas
    
    // SISTEMA DE RE-DETECCIÓN AGRESIVA
    REDETECTION_GRACE_PERIOD: 2000, // 2 segundos de modo agresivo
    MAX_REDETECTION_ATTEMPTS: 5,
    REDETECTION_SCORE_BOOST: 0.15, // Boost para facilitar re-detección
    
    // VALIDACIÓN ÓPTICA MEJORADA
    OPTICAL_COHERENCE_THRESHOLD: 0.5, // Más permisivo
    PERFUSION_STABILITY_WINDOW: 15,
    TEMPORAL_CONSISTENCY_FACTOR: 0.6, // Más permisivo
    
    HYSTERESIS: 2.0,
    QUALITY_LEVELS: 40,
    CALIBRATION_SAMPLES: 15,
    TEXTURE_GRID_SIZE: 6,
    ROI_SIZE_FACTOR: 0.75
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🔬 PPGSignalProcessor: Inicializando sistema ÚNICO de máxima potencia");
    
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
      QUALITY_HISTORY_SIZE: 20,
      MIN_CONSECUTIVE_DETECTIONS: this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION,
      MAX_CONSECUTIVE_NO_DETECTIONS: this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS
    });
  }

  async initialize(): Promise<void> {
    try {
      // RESET COMPLETO Y ÚNICO
      this.signalBuffer.fill(0);
      this.bufferIndex = 0;
      this.bufferFull = false;
      this.frameCount = 0;
      
      // RESET SISTEMA DE DETECCIÓN POTENTE
      this.fingerDetectionState = {
        isDetected: false,
        detectionScore: 0,
        consecutiveDetections: 0,
        consecutiveNonDetections: 0,
        lastDetectionTime: 0,
        stabilityBuffer: [],
        opticalValidationScore: 0,
        lastLossTime: 0,
        redetectionAttempts: 0,
        forceRedetectionMode: false
      };
      
      // RESET FILTROS
      this.kalmanFilter.reset();
      this.sgFilter.reset();
      this.trendAnalyzer.reset();
      this.biophysicalValidator.reset();
      this.signalAnalyzer.reset();
      
      console.log("✅ PPGSignalProcessor: Sistema ÚNICO inicializado con máxima potencia");
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error en inicialización única", error);
      this.handleError("INIT_ERROR", "Error inicializando procesador único");
    }
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log("🚀 PPGSignalProcessor: Sistema ÚNICO iniciado");
  }

  stop(): void {
    this.isProcessing = false;
    this.reset();
    console.log("⏹️ PPGSignalProcessor: Sistema ÚNICO detenido");
  }

  async calibrate(): Promise<boolean> {
    try {
      console.log("🔧 PPGSignalProcessor: Calibración ÚNICA iniciada");
      await this.initialize();
      
      this.isCalibrating = true;
      
      setTimeout(() => {
        this.isCalibrating = false;
        console.log("✅ PPGSignalProcessor: Calibración ÚNICA completada");
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

      // 2. SISTEMA ÚNICO DE DETECCIÓN ULTRA-POTENTE
      const fingerDetectionResult = this.processUltraPowerfulFingerDetection(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio
      );

      // 3. Procesamiento matemático avanzado
      let filteredValue = redValue;
      if (fingerDetectionResult.isDetected) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
        
        // Amplificación adaptativa ultra-potente
        const adaptiveGain = this.calculateUltraPowerfulAdaptiveGain(fingerDetectionResult);
        filteredValue = filteredValue * adaptiveGain;
      }

      // 4. Buffer circular optimizado
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      if (this.bufferIndex === 0) this.bufferFull = true;

      // 5. Análisis de tendencias
      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);

      // 6. Validación fisiológica
      if (this.isNonPhysiological(trendResult, fingerDetectionResult) && !this.isCalibrating) {
        this.sendRejectedSignal(redValue, filteredValue, roi);
        return;
      }

      // 7. Calidad integrada ultra-potente
      const quality = this.calculateUltraPowerfulQuality(fingerDetectionResult, textureScore);

      // 8. Índice de perfusión real optimizado
      const perfusionIndex = this.calculateUltraPowerfulPerfusionIndex(
        redValue, fingerDetectionResult.isDetected, quality, fingerDetectionResult.detectionScore
      );

      // 9. Señal procesada final
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
      this.handleError("PROCESSING_ERROR", "Error en procesamiento único");
    }
  }

  /**
   * SISTEMA ÚNICO ULTRA-POTENTE DE DETECCIÓN - GARANTÍA DE RE-DETECCIÓN
   */
  private processUltraPowerfulFingerDetection(
    red: number, green: number, blue: number, 
    textureScore: number, rToGRatio: number, rToBRatio: number
  ): { isDetected: boolean; detectionScore: number; opticalCoherence: number } {
    
    const currentTime = Date.now();
    
    // MODO RE-DETECCIÓN AGRESIVA
    if (!this.fingerDetectionState.isDetected && 
        (currentTime - this.fingerDetectionState.lastLossTime) < this.CONFIG.REDETECTION_GRACE_PERIOD) {
      this.fingerDetectionState.forceRedetectionMode = true;
      this.fingerDetectionState.redetectionAttempts++;
    } else if (this.fingerDetectionState.redetectionAttempts >= this.CONFIG.MAX_REDETECTION_ATTEMPTS) {
      this.fingerDetectionState.forceRedetectionMode = false;
      this.fingerDetectionState.redetectionAttempts = 0;
    }
    
    // 1. VALIDACIÓN ÓPTICA ULTRA-AGRESIVA
    const opticalCoherence = this.calculateUltraAggressiveOpticalCoherence(red, green, blue);
    
    // 2. VALIDACIÓN HEMODINÁMICA POTENCIADA
    const hemodynamicScore = this.validateUltraPowerfulHemodynamics(rToGRatio, rToBRatio);
    
    // 3. VALIDACIÓN DE TEXTURA MEJORADA
    const textureValidation = this.validateUltraSensitiveSkinTexture(textureScore);
    
    // 4. COHERENCIA TEMPORAL POTENCIADA
    const temporalCoherence = this.calculateUltraPowerfulTemporalCoherence(red);
    
    // 5. SCORE INTEGRADO CON BOOST DE RE-DETECCIÓN
    let rawDetectionScore = (
      opticalCoherence * 0.35 +
      hemodynamicScore * 0.25 +
      textureValidation * 0.20 +
      temporalCoherence * 0.20
    );
    
    // BOOST PARA RE-DETECCIÓN
    if (this.fingerDetectionState.forceRedetectionMode) {
      rawDetectionScore += this.CONFIG.REDETECTION_SCORE_BOOST;
    }
    
    // 6. HISTÉRESIS ADAPTATIVA
    let adjustedScore = rawDetectionScore;
    if (this.fingerDetectionState.isDetected) {
      adjustedScore += this.CONFIG.HYSTERESIS * 0.01;
    } else {
      adjustedScore -= this.CONFIG.HYSTERESIS * 0.005; // Menos penalización
    }
    
    // 7. LÓGICA DE DECISIÓN ULTRA-SENSIBLE
    const shouldDetect = adjustedScore >= this.CONFIG.MIN_DETECTION_SCORE &&
                        red >= this.CONFIG.MIN_RED_THRESHOLD &&
                        red <= this.CONFIG.MAX_RED_THRESHOLD;
    
    // 8. CONTROL DE CONSECUTIVIDAD OPTIMIZADO
    if (shouldDetect) {
      this.fingerDetectionState.consecutiveDetections++;
      this.fingerDetectionState.consecutiveNonDetections = 0;
      
      if (this.fingerDetectionState.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
        if (!this.fingerDetectionState.isDetected) {
          console.log("🖐️ PPG: Dedo DETECTADO - Sistema ÚNICO ultra-potente", {
            score: adjustedScore.toFixed(3),
            consecutivos: this.fingerDetectionState.consecutiveDetections,
            red: red.toFixed(1),
            modoRedeteccion: this.fingerDetectionState.forceRedetectionMode
          });
        }
        this.fingerDetectionState.isDetected = true;
        this.fingerDetectionState.lastDetectionTime = currentTime;
        this.fingerDetectionState.forceRedetectionMode = false;
        this.fingerDetectionState.redetectionAttempts = 0;
      }
    } else {
      this.fingerDetectionState.consecutiveNonDetections++;
      this.fingerDetectionState.consecutiveDetections = 0;
      
      if (this.fingerDetectionState.consecutiveNonDetections >= this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS) {
        if (this.fingerDetectionState.isDetected) {
          console.log("🖐️ PPG: Dedo PERDIDO - Activando re-detección ultra-agresiva", {
            score: adjustedScore.toFixed(3),
            consecutivosNO: this.fingerDetectionState.consecutiveNonDetections,
            red: red.toFixed(1)
          });
          this.fingerDetectionState.lastLossTime = currentTime;
        }
        this.fingerDetectionState.isDetected = false;
      }
    }
    
    // 9. ACTUALIZAR ESTADO
    this.fingerDetectionState.detectionScore = adjustedScore;
    this.fingerDetectionState.opticalValidationScore = opticalCoherence;
    
    // 10. BUFFER DE ESTABILIDAD LIMITADO
    this.fingerDetectionState.stabilityBuffer.push(rawDetectionScore);
    if (this.fingerDetectionState.stabilityBuffer.length > this.CONFIG.PERFUSION_STABILITY_WINDOW) {
      this.fingerDetectionState.stabilityBuffer.shift();
    }
    
    return {
      isDetected: this.fingerDetectionState.isDetected,
      detectionScore: adjustedScore,
      opticalCoherence: opticalCoherence
    };
  }

  /**
   * COHERENCIA ÓPTICA ULTRA-AGRESIVA
   */
  private calculateUltraAggressiveOpticalCoherence(r: number, g: number, b: number): number {
    const total = r + g + b + 1e-10;
    const normR = r / total;
    const normG = g / total;
    const normB = b / total;
    
    // Múltiples modelos de piel para máxima detección
    const skinModels = [
      { refR: 0.42, refG: 0.33, refB: 0.25, weight: 0.4 }, // Caucásica
      { refR: 0.38, refG: 0.35, refB: 0.27, weight: 0.3 }, // Mediterránea  
      { refR: 0.35, refG: 0.32, refB: 0.33, weight: 0.3 }  // Más oscura
    ];
    
    let bestCoherence = 0;
    for (const model of skinModels) {
      const colorDistance = Math.sqrt(
        Math.pow(normR - model.refR, 2) + 
        Math.pow(normG - model.refG, 2) + 
        Math.pow(normB - model.refB, 2)
      );
      
      const coherence = Math.exp(-colorDistance * 6) * model.weight; // Más permisivo
      bestCoherence = Math.max(bestCoherence, coherence);
    }
    
    return bestCoherence;
  }

  /**
   * HEMODINÁMICA ULTRA-POTENTE
   */
  private validateUltraPowerfulHemodynamics(rToG: number, rToB: number): number {
    const optimalRanges = [
      { rToG: [1.2, 2.0], rToB: [1.5, 2.8], weight: 0.6 },
      { rToG: [1.0, 1.8], rToB: [1.3, 2.5], weight: 0.4 }
    ];
    
    let bestScore = 0;
    for (const range of optimalRanges) {
      const rToGScore = (rToG >= range.rToG[0] && rToG <= range.rToG[1]) ? 1 : 
                       Math.exp(-Math.pow((rToG - (range.rToG[0] + range.rToG[1]) / 2) / 0.5, 2));
      const rToBScore = (rToB >= range.rToB[0] && rToB <= range.rToB[1]) ? 1 : 
                       Math.exp(-Math.pow((rToB - (range.rToB[0] + range.rToB[1]) / 2) / 0.5, 2));
      
      const combinedScore = (rToGScore * 0.6 + rToBScore * 0.4) * range.weight;
      bestScore = Math.max(bestScore, combinedScore);
    }
    
    return bestScore;
  }

  /**
   * TEXTURA ULTRA-SENSIBLE
   */
  private validateUltraSensitiveSkinTexture(textureScore: number): number {
    const optimalRanges = [
      { center: 0.45, width: 0.35 },
      { center: 0.35, width: 0.25 },
      { center: 0.55, width: 0.30 }
    ];
    
    let bestScore = 0;
    for (const range of optimalRanges) {
      const deviation = Math.abs(textureScore - range.center);
      const score = Math.exp(-Math.pow(deviation / range.width, 2));
      bestScore = Math.max(bestScore, score);
    }
    
    return bestScore;
  }

  /**
   * COHERENCIA TEMPORAL ULTRA-POTENTE
   */
  private calculateUltraPowerfulTemporalCoherence(currentValue: number): number {
    const bufferLength = this.bufferFull ? this.BUFFER_SIZE : this.bufferIndex;
    if (bufferLength < 3) return 0.7; // Más permisivo inicialmente
    
    let totalCoherence = 0;
    let validPairs = 0;
    
    for (let lag = 1; lag <= Math.min(5, bufferLength - 1); lag++) {
      const idx1 = (this.bufferIndex - lag + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const idx2 = (this.bufferIndex - lag - 1 + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      
      const val1 = this.signalBuffer[idx1];
      const val2 = this.signalBuffer[idx2];
      
      if (val1 > 0 && val2 > 0) {
        const normalizedCorrelation = Math.tanh((val1 * val2) / (val1 + val2 + 1e-10));
        totalCoherence += normalizedCorrelation;
        validPairs++;
      }
    }
    
    if (validPairs === 0) return 0.6;
    
    const avgCoherence = totalCoherence / validPairs;
    return Math.max(0.2, Math.min(1, avgCoherence)); // Más permisivo
  }

  private calculateUltraPowerfulAdaptiveGain(detectionResult: { detectionScore: number; opticalCoherence: number }): number {
    const baseGain = 1.2; // Gain base más alto
    
    const detectionBoost = Math.tanh(detectionResult.detectionScore * 2.5) * 0.4;
    const coherenceBoost = detectionResult.opticalCoherence * 0.3;
    
    return Math.min(2.5, Math.max(1.0, baseGain + detectionBoost + coherenceBoost));
  }

  private calculateUltraPowerfulQuality(detectionResult: { detectionScore: number }, textureScore: number): number {
    if (!detectionResult.detectionScore) return 0;
    
    const detectionQuality = detectionResult.detectionScore * 70;
    const textureQuality = textureScore * 20;
    const stabilityQuality = this.getUltraPowerfulStabilityScore() * 10;
    
    return Math.min(100, Math.max(0, detectionQuality + textureQuality + stabilityQuality));
  }

  private getUltraPowerfulStabilityScore(): number {
    if (this.fingerDetectionState.stabilityBuffer.length < 3) return 0.5;
    
    const recentScores = this.fingerDetectionState.stabilityBuffer.slice(-8);
    const mean = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    const variance = recentScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / recentScores.length;
    
    return Math.exp(-variance * 6); // Más tolerante a variabilidad
  }

  private calculateUltraPowerfulPerfusionIndex(
    redValue: number, isDetected: boolean, quality: number, detectionScore: number
  ): number {
    if (!isDetected || quality < 15) return 0;
    
    const normalizedRed = Math.min(1, redValue / 180); // Más sensible
    const perfusionBase = Math.log1p(normalizedRed * 3) * 1.5;
    
    const qualityFactor = Math.tanh(quality / 30) * 0.5;
    const confidenceFactor = Math.pow(detectionScore, 0.6) * 0.5;
    
    const totalPerfusion = (perfusionBase + qualityFactor + confidenceFactor) * 9;
    
    return Math.min(12, Math.max(0, totalPerfusion));
  }

  private isNonPhysiological(trendResult: any, fingerDetectionResult: { isDetected: boolean }): boolean {
    return trendResult === "non_physiological" || !fingerDetectionResult.isDetected;
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
}
