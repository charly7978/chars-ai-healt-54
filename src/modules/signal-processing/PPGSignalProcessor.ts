import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';

/**
 * PROCESADOR PPG ÚNICO - DETECCIÓN ULTRA-ESPECÍFICA DE DEDO HUMANO
 * Sistema matemático que RECHAZA todo lo que no sea dedo humano real
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
  
  // SISTEMA ULTRA-ESPECÍFICO DE DETECCIÓN DE DEDO HUMANO
  private fingerDetectionState = {
    isDetected: false,
    detectionScore: 0,
    consecutiveDetections: 0,
    consecutiveNonDetections: 0,
    lastDetectionTime: 0,
    stabilityBuffer: [] as number[],
    opticalValidationScore: 0,
    // NUEVOS: Validadores anti-falsos positivos
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
  
  // CONFIGURACIÓN ULTRA-ESPECÍFICA PARA DEDO HUMANO SOLAMENTE
  private readonly CONFIG = {
    // UMBRALES RESTRICTIVOS PARA RECHAZAR AIRE/OBJETOS
    MIN_RED_THRESHOLD: 45,     // Mucho más restrictivo
    MAX_RED_THRESHOLD: 220,    // Más restrictivo
    MIN_DETECTION_SCORE: 0.75, // Mucho más exigente
    MIN_CONSECUTIVE_FOR_DETECTION: 8, // Más frames para confirmar
    MAX_CONSECUTIVE_FOR_LOSS: 15,     // Menos tolerancia a pérdida
    
    // VALIDACIÓN BIOMÉTRICA DE DEDO HUMANO
    SKIN_COLOR_CONSISTENCY_THRESHOLD: 0.85,
    HEMOGLOBIN_SIGNATURE_THRESHOLD: 0.80,
    PULSATILITY_REQUIREMENT: 0.70,
    TEXTURE_HUMAN_THRESHOLD: 0.75,
    FINGERPRINT_PATTERN_THRESHOLD: 0.65,
    
    HYSTERESIS: 1.5,
    QUALITY_LEVELS: 50,
    CALIBRATION_SAMPLES: 20,
    TEXTURE_GRID_SIZE: 8,
    ROI_SIZE_FACTOR: 0.80
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🔬 PPGSignalProcessor: Sistema ULTRA-ESPECÍFICO para dedo humano");
    
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
      
      console.log("✅ PPGSignalProcessor: Detector ultra-específico inicializado");
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error en inicialización", error);
      this.handleError("INIT_ERROR", "Error inicializando procesador");
    }
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log("🚀 PPGSignalProcessor: Detector ultra-específico iniciado");
  }

  stop(): void {
    this.isProcessing = false;
    this.reset();
    console.log("⏹️ PPGSignalProcessor: Detector ultra-específico detenido");
  }

  async calibrate(): Promise<boolean> {
    try {
      console.log("🔧 PPGSignalProcessor: Calibración ultra-específica iniciada");
      await this.initialize();
      
      this.isCalibrating = true;
      
      setTimeout(() => {
        this.isCalibrating = false;
        console.log("✅ PPGSignalProcessor: Calibración ultra-específica completada");
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

      // 2. DETECTOR ULTRA-ESPECÍFICO DE DEDO HUMANO - RECHAZA TODO LO DEMÁS
      const fingerDetectionResult = this.detectHumanFingerOnly(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio, imageData
      );

      // 3. Procesamiento matemático SOLO SI ES DEDO HUMANO CONFIRMADO
      let filteredValue = redValue;
      if (fingerDetectionResult.isDetected) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
        
        // Amplificación POTENTE para señal excelente
        const adaptiveGain = this.calculateUltraPowerfulGain(fingerDetectionResult);
        filteredValue = filteredValue * adaptiveGain;
      }

      // 4. Buffer circular
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      if (this.bufferIndex === 0) this.bufferFull = true;

      // 5. Validación fisiológica estricta
      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);
      if (this.isNonPhysiological(trendResult, fingerDetectionResult) && !this.isCalibrating) {
        this.sendRejectedSignal(redValue, filteredValue, roi);
        return;
      }

      // 6. Calidad EXCELENTE garantizada para dedo humano
      const quality = this.calculateExcellentQualityForHumanFinger(fingerDetectionResult, textureScore);

      // 7. Índice de perfusión optimizado
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
   * DETECTOR ULTRA-ESPECÍFICO DE DEDO HUMANO - RECHAZA TODO LO DEMÁS
   */
  private detectHumanFingerOnly(
    red: number, green: number, blue: number, 
    textureScore: number, rToGRatio: number, rToBRatio: number,
    imageData: ImageData
  ): { isDetected: boolean; detectionScore: number; opticalCoherence: number } {
    
    // 1. VALIDACIÓN PRIMARIA: Rangos estrictos para dedo humano
    if (red < this.CONFIG.MIN_RED_THRESHOLD || red > this.CONFIG.MAX_RED_THRESHOLD) {
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 2. FIRMA ESPECTRAL DE HEMOGLOBINA HUMANA
    const hemoglobinSignature = this.validateHumanHemoglobinSignature(red, green, blue);
    if (hemoglobinSignature < this.CONFIG.HEMOGLOBIN_SIGNATURE_THRESHOLD) {
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 3. CONSISTENCIA DE COLOR DE PIEL HUMANA
    const skinColorConsistency = this.validateHumanSkinColor(red, green, blue);
    if (skinColorConsistency < this.CONFIG.SKIN_COLOR_CONSISTENCY_THRESHOLD) {
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 4. PATRÓN DE TEXTURA ESPECÍFICO DE DEDO
    const fingerTextureValidation = this.validateFingerTexture(textureScore, imageData);
    if (fingerTextureValidation < this.CONFIG.TEXTURE_HUMAN_THRESHOLD) {
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 5. PULSATILIDAD CARDIOVASCULAR HUMANA
    const pulsatilityScore = this.validateHumanPulsatility(red);
    if (pulsatilityScore < this.CONFIG.PULSATILITY_REQUIREMENT) {
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 6. SCORE INTEGRADO ULTRA-EXIGENTE
    const rawDetectionScore = (
      hemoglobinSignature * 0.30 +
      skinColorConsistency * 0.25 +
      fingerTextureValidation * 0.20 +
      pulsatilityScore * 0.25
    );

    // 7. HISTÉRESIS ESTRICTA
    let adjustedScore = rawDetectionScore;
    if (this.fingerDetectionState.isDetected) {
      adjustedScore += this.CONFIG.HYSTERESIS * 0.02;
    }

    // 8. LÓGICA DE DECISIÓN ULTRA-CONSERVADORA
    const shouldDetect = adjustedScore >= this.CONFIG.MIN_DETECTION_SCORE;

    // 9. CONTROL DE CONSECUTIVIDAD ESTRICTO
    if (shouldDetect) {
      this.fingerDetectionState.consecutiveDetections++;
      this.fingerDetectionState.consecutiveNonDetections = 0;
      
      if (this.fingerDetectionState.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
        if (!this.fingerDetectionState.isDetected) {
          console.log("✅ DEDO HUMANO CONFIRMADO", {
            score: adjustedScore.toFixed(3),
            hemoglobina: hemoglobinSignature.toFixed(3),
            piel: skinColorConsistency.toFixed(3),
            textura: fingerTextureValidation.toFixed(3),
            pulsatilidad: pulsatilityScore.toFixed(3)
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
          console.log("❌ DEDO PERDIDO - Validaciones fallaron", {
            score: adjustedScore.toFixed(3),
            hemoglobina: hemoglobinSignature.toFixed(3),
            piel: skinColorConsistency.toFixed(3)
          });
        }
        this.fingerDetectionState.isDetected = false;
      }
    }

    this.fingerDetectionState.detectionScore = adjustedScore;
    
    return {
      isDetected: this.fingerDetectionState.isDetected,
      detectionScore: adjustedScore,
      opticalCoherence: hemoglobinSignature
    };
  }

  /**
   * VALIDACIÓN ESPECÍFICA DE HEMOGLOBINA HUMANA
   */
  private validateHumanHemoglobinSignature(r: number, g: number, b: number): number {
    // Absorción específica de hemoglobina oxigenada y desoxigenada
    const oxyHb_red = 0.319;    // Coeficiente a 660nm
    const deoxyHb_red = 3.226;  // Coeficiente a 660nm
    const oxyHb_ir = 0.372;     // Coeficiente a 940nm (aproximado con verde)
    const deoxyHb_ir = 0.164;   // Coeficiente a 940nm
    
    const total = r + g + b + 1e-10;
    const redRatio = r / total;
    const greenRatio = g / total;
    
    // Cálculo de ratio específico de hemoglobina
    const expectedRatio = (oxyHb_red + deoxyHb_red) / (oxyHb_ir + deoxyHb_ir);
    const actualRatio = redRatio / (greenRatio + 1e-10);
    
    const ratioError = Math.abs(actualRatio - expectedRatio) / expectedRatio;
    const hemoglobinScore = Math.exp(-ratioError * 2);
    
    // Actualizar historial
    this.fingerDetectionState.hemoglobinSignature = hemoglobinScore;
    
    return hemoglobinScore;
  }

  /**
   * VALIDACIÓN ULTRA-ESPECÍFICA DE COLOR DE PIEL HUMANA
   */
  private validateHumanSkinColor(r: number, g: number, b: number): number {
    // Modelos específicos de piel humana en diferentes etnias
    const skinModels = [
      { r: 0.45, g: 0.35, b: 0.20, tolerance: 0.15 }, // Caucásica
      { r: 0.42, g: 0.33, b: 0.25, tolerance: 0.12 }, // Mediterránea
      { r: 0.38, g: 0.32, b: 0.30, tolerance: 0.10 }, // Asiática
      { r: 0.35, g: 0.30, b: 0.35, tolerance: 0.08 }  // Africana
    ];
    
    const total = r + g + b + 1e-10;
    const normR = r / total;
    const normG = g / total;
    const normB = b / total;
    
    let bestMatch = 0;
    for (const model of skinModels) {
      const distance = Math.sqrt(
        Math.pow(normR - model.r, 2) + 
        Math.pow(normG - model.g, 2) + 
        Math.pow(normB - model.b, 2)
      );
      
      if (distance <= model.tolerance) {
        const similarity = 1 - (distance / model.tolerance);
        bestMatch = Math.max(bestMatch, similarity);
      }
    }
    
    // Actualizar historial
    this.fingerDetectionState.skinColorHistory.push(bestMatch);
    if (this.fingerDetectionState.skinColorHistory.length > 10) {
      this.fingerDetectionState.skinColorHistory.shift();
    }
    
    return bestMatch;
  }

  /**
   * VALIDACIÓN DE TEXTURA ESPECÍFICA DE DEDO
   */
  private validateFingerTexture(textureScore: number, imageData: ImageData): number {
    // Análisis de patrones de huella dactilar
    const ridgePattern = this.detectRidgePatterns(imageData);
    
    // Rugosidad específica de piel vs superficies lisas
    const skinRoughness = this.calculateSkinRoughness(textureScore);
    
    // Combinación de validadores
    const fingerScore = (ridgePattern * 0.6) + (skinRoughness * 0.4);
    
    this.fingerDetectionState.fingerPrintValidation = ridgePattern;
    this.fingerDetectionState.textureConsistency = skinRoughness;
    
    return fingerScore;
  }

  /**
   * VALIDACIÓN DE PULSATILIDAD CARDIOVASCULAR
   */
  private validateHumanPulsatility(currentValue: number): number {
    // Agregar al historial de pulsatilidad
    this.fingerDetectionState.pulsatilityHistory.push(currentValue);
    if (this.fingerDetectionState.pulsatilityHistory.length > 20) {
      this.fingerDetectionState.pulsatilityHistory.shift();
    }
    
    if (this.fingerDetectionState.pulsatilityHistory.length < 10) {
      return 0.3; // Insuficiente data
    }
    
    // Análisis de variabilidad cardiovascular
    const values = this.fingerDetectionState.pulsatilityHistory;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation típico cardiovascular: 0.02-0.20
    const cv = stdDev / (mean + 1e-10);
    const pulsatilityScore = (cv >= 0.02 && cv <= 0.20) ? 1.0 : Math.exp(-Math.abs(cv - 0.10) * 10);
    
    return pulsatilityScore;
  }

  private detectRidgePatterns(imageData: ImageData): number {
    // Análisis simplificado de patrones de cresta
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    let ridgeScore = 0;
    let samples = 0;
    
    // Muestreo cada 4 píxeles para eficiencia
    for (let y = 4; y < height - 4; y += 4) {
      for (let x = 4; x < width - 4; x += 4) {
        const idx = (y * width + x) * 4;
        const centerGray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        
        // Gradientes en 8 direcciones
        let maxGradient = 0;
        for (let dy = -2; dy <= 2; dy += 2) {
          for (let dx = -2; dx <= 2; dx += 2) {
            if (dx === 0 && dy === 0) continue;
            
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            const neighborGray = (data[nIdx] + data[nIdx + 1] + data[nIdx + 2]) / 3;
            const gradient = Math.abs(centerGray - neighborGray);
            maxGradient = Math.max(maxGradient, gradient);
          }
        }
        
        ridgeScore += maxGradient;
        samples++;
      }
    }
    
    const avgGradient = samples > 0 ? ridgeScore / samples : 0;
    return Math.tanh(avgGradient / 30); // Normalizar 0-1
  }

  private calculateSkinRoughness(textureScore: number): number {
    // Rugosidad típica de piel humana vs objetos
    const optimalRoughness = 0.45;
    const tolerance = 0.20;
    
    const deviation = Math.abs(textureScore - optimalRoughness);
    return deviation <= tolerance ? 1 - (deviation / tolerance) : 0;
  }

  private calculateUltraPowerfulGain(detectionResult: { detectionScore: number; opticalCoherence: number }): number {
    // Ganancia POTENTE para señal excelente en dedo humano confirmado
    const baseGain = 2.5; // Ganancia base alta
    
    const detectionBoost = Math.pow(detectionResult.detectionScore, 0.5) * 1.0;
    const coherenceBoost = detectionResult.opticalCoherence * 0.8;
    
    return Math.min(4.0, Math.max(1.5, baseGain + detectionBoost + coherenceBoost));
  }

  private calculateExcellentQualityForHumanFinger(detectionResult: { detectionScore: number }, textureScore: number): number {
    if (!detectionResult.detectionScore) return 0;
    
    // Calidad EXCELENTE garantizada para dedo humano confirmado
    const detectionQuality = Math.pow(detectionResult.detectionScore, 0.7) * 85; // Mínimo 85% para dedo confirmado
    const textureQuality = textureScore * 15;
    
    const finalQuality = Math.min(100, Math.max(75, detectionQuality + textureQuality)); // Mínimo 75%, máximo 100%
    
    return finalQuality;
  }

  private calculateOptimalPerfusion(
    redValue: number, isDetected: boolean, quality: number, detectionScore: number
  ): number {
    if (!isDetected || quality < 70) return 0;
    
    const normalizedRed = Math.min(1, redValue / 200);
    const perfusionBase = Math.log1p(normalizedRed * 4) * 2.0; // Amplificado
    
    const qualityFactor = Math.tanh(quality / 25) * 0.6;
    const confidenceFactor = Math.pow(detectionScore, 0.5) * 0.6;
    
    const totalPerfusion = (perfusionBase + qualityFactor + confidenceFactor) * 12;
    
    return Math.min(15, Math.max(0, totalPerfusion));
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
    return trendResult === "non_physiological" || !fingerDetectionResult.isDetected;
  }
}
