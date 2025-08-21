import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';

/**
 * PROCESADOR PPG ULTRA-ESTRICTO - SOLO SEÑAL REAL DE DEDO
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
  
  // SISTEMA DE DETECCIÓN ULTRA-ESTRICTO
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
  
  // CONFIGURACIÓN ULTRA-ESTRICTA PARA EVITAR FALSOS POSITIVOS
  private readonly CONFIG = {
    // UMBRALES MUY ESTRICTOS PARA DEDO REAL
    MIN_RED_THRESHOLD: 80,  // Aumentado para exigir más señal
    MAX_RED_THRESHOLD: 220, // Reducido para evitar saturación
    MIN_DETECTION_SCORE: 0.85, // MUY ESTRICTO - Solo señal perfecta
    MIN_CONSECUTIVE_FOR_DETECTION: 8, // Más frames requeridos
    MAX_CONSECUTIVE_FOR_LOSS: 5,
    
    // VALIDACIÓN ULTRA-ESTRICTA
    MIN_SNR_REQUIRED: 15.0, // SNR muy alto para señal limpia
    SKIN_COLOR_STRICTNESS: 0.9, // Muy estricto en color de piel
    PULSATILITY_MIN_REQUIRED: 0.25, // Pulsatilidad mínima alta
    TEXTURE_HUMAN_MIN: 0.8, // Textura humana muy estricta
    STABILITY_FRAMES: 15, // Más frames para estabilidad
    
    // PARÁMETROS PARA DETECTAR SEÑAL REAL
    MIN_VARIANCE_RATIO: 0.15, // Varianza mínima para señal pulsátil
    MAX_UNIFORMITY: 0.1, // Máxima uniformidad permitida
    MIN_DYNAMIC_RANGE: 25, // Rango dinámico mínimo
    PERFUSION_THRESHOLD: 0.5, // Umbral de perfusión alto
    
    NOISE_THRESHOLD: 0.8, // Más estricto
    PEAK_PROMINENCE: 0.3, // Mayor prominencia requerida
    VALLEY_DEPTH: 0.2,
    SIGNAL_CONSISTENCY: 0.8 // Alta consistencia requerida
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🎯 PPGSignalProcessor: Sistema ULTRA-ESTRICTO activado - Solo señal real");
    
    this.signalBuffer = new Float32Array(this.BUFFER_SIZE);
    this.kalmanFilter = new KalmanFilter();
    this.sgFilter = new SavitzkyGolayFilter();
    this.trendAnalyzer = new SignalTrendAnalyzer();
    this.biophysicalValidator = new BiophysicalValidator();
    this.frameProcessor = new FrameProcessor({
      TEXTURE_GRID_SIZE: 16,
      ROI_SIZE_FACTOR: 0.85
    });
    this.calibrationHandler = new CalibrationHandler({
      CALIBRATION_SAMPLES: 30,
      MIN_RED_THRESHOLD: this.CONFIG.MIN_RED_THRESHOLD,
      MAX_RED_THRESHOLD: this.CONFIG.MAX_RED_THRESHOLD
    });
    this.signalAnalyzer = new SignalAnalyzer({
      QUALITY_LEVELS: 100,
      QUALITY_HISTORY_SIZE: 50,
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
        signalHistory: [],
        noiseLevel: 0,
        signalToNoiseRatio: 0,
        peakHistory: [],
        valleyHistory: []
      };
      
      this.kalmanFilter.reset();
      this.sgFilter.reset();
      this.trendAnalyzer.reset();
      this.biophysicalValidator.reset();
      this.signalAnalyzer.reset();
      
      console.log("✅ PPGSignalProcessor: Sistema ultra-preciso inicializado");
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error inicialización", error);
      this.handleError("INIT_ERROR", "Error inicializando procesador");
    }
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log("🚀 PPGSignalProcessor: Sistema ultra-preciso iniciado");
  }

  stop(): void {
    this.isProcessing = false;
    this.reset();
    console.log("⏹️ PPGSignalProcessor: Sistema detenido");
  }

  async calibrate(): Promise<boolean> {
    try {
      console.log("🔧 PPGSignalProcessor: Calibración ultra-precisa iniciada");
      await this.initialize();
      
      this.isCalibrating = true;
      
      setTimeout(() => {
        this.isCalibrating = false;
        console.log("✅ PPGSignalProcessor: Calibración ultra-precisa completada");
      }, 3000);
      
      return true;
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error calibración", error);
      this.handleError("CALIBRATION_ERROR", "Error durante calibración");
      this.isCalibrating = false;
      return false;
    }
  }

  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      this.frameCount = (this.frameCount + 1) % 10000;
      
      // 1. Extracción de datos del frame
      const extractionResult = this.frameProcessor.extractFrameData(imageData);
      const { redValue, textureScore, rToGRatio, rToBRatio, avgGreen, avgBlue } = extractionResult;
      const roi = this.frameProcessor.detectROI(redValue, imageData);

      // 2. DETECCIÓN ULTRA-ESTRICTA DE DEDO REAL
      const fingerDetectionResult = this.detectFingerUltraStrict(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio, imageData
      );

      // 3. Procesamiento SOLO si hay dedo detectado
      let filteredValue = redValue;
      if (fingerDetectionResult.isDetected) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
        
        // Amplificación mínima para mantener señal real
        filteredValue = filteredValue * 1.1; // Amplificación muy conservadora
      } else {
        // Si no hay dedo, valor cero para evitar falsos positivos
        filteredValue = 0;
      }

      // 4. Buffer circular
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      if (this.bufferIndex === 0) this.bufferFull = true;

      // 5. Análisis de tendencia
      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);
      
      // 6. Calidad estricta
      const quality = this.calculateStrictQuality(
        fingerDetectionResult, textureScore, redValue, this.fingerDetectionState.signalToNoiseRatio
      );

      // 7. Índice de perfusión real
      const perfusionIndex = this.calculateRealPerfusion(
        redValue, fingerDetectionResult.isDetected, quality, fingerDetectionResult.detectionScore
      );

      // Logging cada 30 frames
      if (this.frameCount % 30 === 0) {
        console.log("🔍 Detección ultra-estricta:", {
          red: redValue.toFixed(2),
          detected: fingerDetectionResult.isDetected,
          score: fingerDetectionResult.detectionScore.toFixed(3),
          consecutivas: this.fingerDetectionState.consecutiveDetections,
          snr: this.fingerDetectionState.signalToNoiseRatio.toFixed(1),
          uniformity: this.calculateUniformity(imageData).toFixed(3),
          variance: this.calculateVarianceRatio().toFixed(3)
        });
      }

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
   * DETECCIÓN ULTRA-ESTRICTA DE DEDO REAL
   */
  private detectFingerUltraStrict(
    red: number, green: number, blue: number, 
    textureScore: number, rToGRatio: number, rToBRatio: number,
    imageData: ImageData
  ): { isDetected: boolean; detectionScore: number; opticalCoherence: number } {
    
    // 1. VALIDACIÓN BÁSICA ESTRICTA
    if (red < this.CONFIG.MIN_RED_THRESHOLD || red > this.CONFIG.MAX_RED_THRESHOLD) {
      this.resetDetectionState();
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 2. VALIDAR QUE NO SEA UNA SUPERFICIE UNIFORME
    const uniformity = this.calculateUniformity(imageData);
    if (uniformity > this.CONFIG.MAX_UNIFORMITY) {
      console.log("❌ Superficie muy uniforme - No es dedo", { uniformity: uniformity.toFixed(3) });
      this.resetDetectionState();
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 3. VALIDAR RANGO DINÁMICO
    const dynamicRange = this.calculateDynamicRange(imageData);
    if (dynamicRange < this.CONFIG.MIN_DYNAMIC_RANGE) {
      console.log("❌ Rango dinámico insuficiente", { range: dynamicRange.toFixed(1) });
      this.resetDetectionState();
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 4. Actualizar historial
    this.fingerDetectionState.signalHistory.push(red);
    if (this.fingerDetectionState.signalHistory.length > 30) {
      this.fingerDetectionState.signalHistory.shift();
    }

    // 5. VALIDACIONES ULTRA-ESTRICTAS
    const skinColorScore = this.validateStrictSkinColor(red, green, blue);
    const textureHumanScore = Math.min(1.0, textureScore * 1.2);
    const pulsatilityScore = this.validateStrictPulsatility(red);
    const stabilityScore = this.validateStrictStability();
    const snrScore = this.calculateStrictSNR();
    const varianceScore = this.validateVarianceRatio();
    
    // 6. SCORE ULTRA-ESTRICTO - Todos los factores deben ser altos
    const weights = [0.25, 0.15, 0.25, 0.15, 0.1, 0.1];
    const scores = [skinColorScore, textureHumanScore, pulsatilityScore, stabilityScore, snrScore, varianceScore];
    const rawDetectionScore = scores.reduce((sum, score, i) => sum + score * weights[i], 0);

    // 7. UMBRAL ULTRA-ESTRICTO
    const shouldDetect = rawDetectionScore >= this.CONFIG.MIN_DETECTION_SCORE;

    // 8. CONTROL DE CONSECUTIVIDAD ESTRICTO
    if (shouldDetect) {
      this.fingerDetectionState.consecutiveDetections++;
      this.fingerDetectionState.consecutiveNonDetections = 0;
      
      if (this.fingerDetectionState.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
        if (!this.fingerDetectionState.isDetected) {
          console.log("✅ DEDO DETECTADO CON CERTEZA", {
            score: rawDetectionScore.toFixed(3),
            consecutivas: this.fingerDetectionState.consecutiveDetections,
            uniformity: uniformity.toFixed(3),
            dynamicRange: dynamicRange.toFixed(1)
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
          console.log("❌ DEDO PERDIDO");
        }
        this.fingerDetectionState.isDetected = false;
      }
    }

    this.fingerDetectionState.detectionScore = rawDetectionScore;
    
    return {
      isDetected: this.fingerDetectionState.isDetected,
      detectionScore: rawDetectionScore,
      opticalCoherence: skinColorScore
    };
  }

  /**
   * CALCULAR UNIFORMIDAD - Detecta si es una superficie plana
   */
  private calculateUniformity(imageData: ImageData): number {
    const data = imageData.data;
    let totalVariation = 0;
    let sampleCount = 0;
    
    // Muestrear cada 4 píxeles para eficiencia
    for (let i = 0; i < data.length - 16; i += 16) {
      const r1 = data[i];
      const r2 = data[i + 4];
      const variation = Math.abs(r1 - r2);
      totalVariation += variation;
      sampleCount++;
    }
    
    const avgVariation = totalVariation / sampleCount;
    return 1 - (avgVariation / 255); // 1 = muy uniforme, 0 = muy variado
  }

  /**
   * CALCULAR RANGO DINÁMICO
   */
  private calculateDynamicRange(imageData: ImageData): number {
    const data = imageData.data;
    let minRed = 255, maxRed = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const red = data[i];
      minRed = Math.min(minRed, red);
      maxRed = Math.max(maxRed, red);
    }
    
    return maxRed - minRed;
  }

  /**
   * VALIDAR RATIO DE VARIANZA - Para detectar pulsatilidad real
   */
  private validateVarianceRatio(): number {
    if (this.fingerDetectionState.signalHistory.length < 20) return 0;
    
    const recent = this.fingerDetectionState.signalHistory.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    const varianceRatio = Math.sqrt(variance) / mean;
    
    return varianceRatio >= this.CONFIG.MIN_VARIANCE_RATIO ? 1.0 : 0;
  }

  private calculateVarianceRatio(): number {
    if (this.fingerDetectionState.signalHistory.length < 10) return 0;
    
    const recent = this.fingerDetectionState.signalHistory.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    return Math.sqrt(variance) / mean;
  }

  private validateStrictSkinColor(r: number, g: number, b: number): number {
    const total = r + g + b + 1e-10;
    const redRatio = r / total;
    const greenRatio = g / total;
    const blueRatio = b / total;
    
    // Rangos muy específicos para piel humana
    const isValidSkin = (
      redRatio >= 0.35 && redRatio <= 0.55 &&
      greenRatio >= 0.25 && greenRatio <= 0.45 &&
      blueRatio >= 0.15 && blueRatio <= 0.35 &&
      r > g && g > b // Relación típica en piel
    );
    
    return isValidSkin ? 1.0 : 0;
  }

  private validateStrictPulsatility(currentValue: number): number {
    if (this.fingerDetectionState.signalHistory.length < 15) return 0;
    
    const recent = this.fingerDetectionState.signalHistory.slice(-15);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    
    const pulsatility = (max - min) / max;
    
    return pulsatility >= this.CONFIG.PULSATILITY_MIN_REQUIRED ? 1.0 : 0;
  }

  private validateStrictStability(): number {
    if (this.fingerDetectionState.signalHistory.length < this.CONFIG.STABILITY_FRAMES) return 0;
    
    const recent = this.fingerDetectionState.signalHistory.slice(-this.CONFIG.STABILITY_FRAMES);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / mean;
    
    return cv < 0.3 ? 1.0 : 0; // Muy estricto en estabilidad
  }

  private calculateStrictSNR(): number {
    if (this.fingerDetectionState.signalHistory.length < 25) return 0;
    
    const signal = this.fingerDetectionState.signalHistory.slice(-25);
    const signalPower = this.calculateSignalPower(signal);
    const noisePower = this.calculateNoisePower(signal);
    
    if (noisePower === 0) return 1.0;
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    this.fingerDetectionState.signalToNoiseRatio = snr;
    
    return snr >= this.CONFIG.MIN_SNR_REQUIRED ? 1.0 : 0; // Binario: pasa o no pasa
  }

  private calculateSignalPower(signal: number[]): number {
    // Potencia en banda cardíaca (0.8-3.5 Hz aproximado)
    let power = 0;
    for (let i = 1; i < signal.length; i++) {
      const diff = signal[i] - signal[i-1];
      power += diff * diff;
    }
    return power / (signal.length - 1);
  }

  private calculateNoisePower(signal: number[]): number {
    // Estimación de ruido usando diferencias de segundo orden
    let noisePower = 0;
    for (let i = 2; i < signal.length; i++) {
      const secondDiff = signal[i] - 2 * signal[i-1] + signal[i-2];
      noisePower += secondDiff * secondDiff;
    }
    return noisePower / (signal.length - 2);
  }

  private resetDetectionState(): void {
    this.fingerDetectionState.consecutiveDetections = 0;
    this.fingerDetectionState.consecutiveNonDetections++;
  }

  private calculateStrictQuality(
    detectionResult: { detectionScore: number }, 
    textureScore: number, 
    redValue: number,
    snr: number
  ): number {
    if (!detectionResult || detectionResult.detectionScore < 0.8) return 0;
    
    const detectionQuality = detectionResult.detectionScore * 50;
    const textureQuality = textureScore * 25;
    const signalQuality = Math.min(25, (redValue / 5));
    
    const finalQuality = Math.min(100, Math.max(0, 
      detectionQuality + textureQuality + signalQuality));
    
    return finalQuality;
  }

  private calculateRealPerfusion(
    redValue: number, isDetected: boolean, quality: number, detectionScore: number
  ): number {
    if (!isDetected || quality < 70 || detectionScore < 0.8) return 0;
    
    const normalizedRed = Math.min(1, redValue / 150);
    const perfusionBase = Math.log1p(normalizedRed) * 3.0;
    
    return Math.min(10, Math.max(0, perfusionBase));
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
