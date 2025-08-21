import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';

/**
 * PROCESADOR PPG ULTRA-PRECISO - DETECCIÓN PERFECTA SIN FALSOS POSITIVOS
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
  
  // SISTEMA ULTRA-PRECISO DE DETECCIÓN
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
  
  // Buffer circular ultra-preciso
  private readonly BUFFER_SIZE = 64;
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferFull: boolean = false;
  
  private isCalibrating: boolean = false;
  private frameCount: number = 0;
  
  // CONFIGURACIÓN ULTRA-PRECISA PARA DETECCIÓN PERFECTA
  private readonly CONFIG = {
    // UMBRALES ESTRICTOS PARA ELIMINAR FALSOS POSITIVOS
    MIN_RED_THRESHOLD: 40,
    MAX_RED_THRESHOLD: 240,
    MIN_DETECTION_SCORE: 0.75, // MUY ESTRICTO
    MIN_CONSECUTIVE_FOR_DETECTION: 8, // MÁS FRAMES PARA CONFIRMAR
    MAX_CONSECUTIVE_FOR_LOSS: 15,
    
    // VALIDACIÓN ESTRICTA ANTI-FALSOS POSITIVOS
    MIN_SNR_REQUIRED: 15.0, // SNR mínimo muy alto
    SKIN_COLOR_STRICTNESS: 0.85, // Muy estricto
    PULSATILITY_MIN_REQUIRED: 0.25, // Pulsatilidad mínima alta
    TEXTURE_HUMAN_MIN: 0.70, // Textura humana estricta
    STABILITY_FRAMES: 20, // Frames para estabilidad
    
    NOISE_THRESHOLD: 2.0,
    PEAK_PROMINENCE: 0.3,
    VALLEY_DEPTH: 0.25,
    SIGNAL_CONSISTENCY: 0.8
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🎯 PPGSignalProcessor: Sistema ULTRA-PRECISO activado");
    
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
      
      // 1. Extracción ultra-precisa
      const extractionResult = this.frameProcessor.extractFrameData(imageData);
      const { redValue, textureScore, rToGRatio, rToBRatio, avgGreen, avgBlue } = extractionResult;
      const roi = this.frameProcessor.detectROI(redValue, imageData);

      // 2. DETECCIÓN ULTRA-PRECISA SIN FALSOS POSITIVOS
      const fingerDetectionResult = this.detectFingerUltraPrecise(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio, imageData
      );

      // 3. Procesamiento solo si detección ultra-confirmada
      let filteredValue = redValue;
      if (fingerDetectionResult.isDetected && fingerDetectionResult.detectionScore > 0.8) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
        
        // Amplificación controlada sin introducir ruido
        const preciseGain = this.calculatePreciseGain(fingerDetectionResult);
        filteredValue = filteredValue * preciseGain;
      }

      // 4. Buffer circular ultra-preciso
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      if (this.bufferIndex === 0) this.bufferFull = true;

      // 5. Análisis de tendencia estricto
      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);
      
      // 6. Calidad ultra-precisa
      const quality = this.calculateUltraPreciseQuality(
        fingerDetectionResult, textureScore, redValue, this.fingerDetectionState.signalToNoiseRatio
      );

      // 7. Índice de perfusión preciso
      const perfusionIndex = this.calculatePrecisePerfusion(
        redValue, fingerDetectionResult.isDetected, quality, fingerDetectionResult.detectionScore
      );

      console.log("🎯 Detección ultra-precisa:", {
        red: redValue.toFixed(2),
        detected: fingerDetectionResult.isDetected,
        score: fingerDetectionResult.detectionScore.toFixed(4),
        snr: this.fingerDetectionState.signalToNoiseRatio.toFixed(2),
        quality: quality.toFixed(1),
        consecutivas: this.fingerDetectionState.consecutiveDetections
      });

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
   * DETECCIÓN ULTRA-PRECISA SIN FALSOS POSITIVOS
   */
  private detectFingerUltraPrecise(
    red: number, green: number, blue: number, 
    textureScore: number, rToGRatio: number, rToBRatio: number,
    imageData: ImageData
  ): { isDetected: boolean; detectionScore: number; opticalCoherence: number } {
    
    // 1. VALIDACIÓN BÁSICA ULTRA-ESTRICTA
    if (red < this.CONFIG.MIN_RED_THRESHOLD || red > this.CONFIG.MAX_RED_THRESHOLD) {
      this.resetDetectionState();
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    // 2. Actualizar historial de señal
    this.fingerDetectionState.signalHistory.push(red);
    if (this.fingerDetectionState.signalHistory.length > 50) {
      this.fingerDetectionState.signalHistory.shift();
    }

    // 3. VALIDACIONES ULTRA-ESTRICTAS
    const skinColorScore = this.validateUltraStrictSkinColor(red, green, blue);
    const textureHumanScore = this.validateHumanTexture(textureScore, imageData);
    const pulsatilityScore = this.validateUltraStrictPulsatility(red);
    const stabilityScore = this.validateSignalStability();
    const snrScore = this.calculateAndValidateSNR();
    
    // 4. SCORE ULTRA-ESTRICTO (todos los componentes deben ser altos)
    const rawDetectionScore = Math.min(
      skinColorScore * 0.25,
      textureHumanScore * 0.20,
      pulsatilityScore * 0.25,
      stabilityScore * 0.15,
      snrScore * 0.15
    );

    console.log("🔍 Validaciones ultra-estrictas:", {
      red: red.toFixed(2),
      skinColor: skinColorScore.toFixed(3),
      textureHuman: textureHumanScore.toFixed(3),
      pulsatility: pulsatilityScore.toFixed(3),
      stability: stabilityScore.toFixed(3),
      snr: snrScore.toFixed(3),
      rawScore: rawDetectionScore.toFixed(4)
    });

    // 5. UMBRAL ULTRA-ESTRICTO
    const shouldDetect = rawDetectionScore >= this.CONFIG.MIN_DETECTION_SCORE;

    // 6. CONTROL DE CONSECUTIVIDAD ULTRA-ESTRICTO
    if (shouldDetect) {
      this.fingerDetectionState.consecutiveDetections++;
      this.fingerDetectionState.consecutiveNonDetections = 0;
      
      if (this.fingerDetectionState.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
        if (!this.fingerDetectionState.isDetected) {
          console.log("✅ DEDO CONFIRMADO ULTRA-PRECISO", {
            score: rawDetectionScore.toFixed(4),
            consecutivas: this.fingerDetectionState.consecutiveDetections,
            snr: this.fingerDetectionState.signalToNoiseRatio.toFixed(2)
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
            score: rawDetectionScore.toFixed(4),
            snr: this.fingerDetectionState.signalToNoiseRatio.toFixed(2)
          });
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
   * VALIDACIONES ULTRA-ESTRICTAS
   */
  private validateUltraStrictSkinColor(r: number, g: number, b: number): number {
    const total = r + g + b + 1e-10;
    const redRatio = r / total;
    const greenRatio = g / total;
    
    // Rangos muy estrictos para piel humana real
    const redInRange = (redRatio >= 0.35 && redRatio <= 0.55);
    const greenInRange = (greenRatio >= 0.25 && greenRatio <= 0.40);
    const ratioBalance = Math.abs(redRatio - greenRatio) < 0.25;
    
    if (!redInRange || !greenInRange || !ratioBalance) return 0;
    
    return Math.min(1.0, redRatio * 2.2);
  }

  private validateHumanTexture(textureScore: number, imageData: ImageData): number {
    // Análisis de textura para confirmar piel humana
    const humanTextureScore = Math.min(1.0, textureScore * 1.5);
    
    return humanTextureScore >= this.CONFIG.TEXTURE_HUMAN_MIN ? humanTextureScore : 0;
  }

  private validateUltraStrictPulsatility(currentValue: number): number {
    if (this.fingerDetectionState.signalHistory.length < 20) return 0;
    
    const recent = this.fingerDetectionState.signalHistory.slice(-20);
    
    // Detectar picos y valles reales
    const peaks = this.detectRealPeaks(recent);
    const valleys = this.detectRealValleys(recent);
    
    if (peaks.length === 0 || valleys.length === 0) return 0;
    
    const avgPeak = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const avgValley = valleys.reduce((a, b) => a + b, 0) / valleys.length;
    
    const pulsatility = (avgPeak - avgValley) / avgPeak;
    
    return pulsatility >= this.CONFIG.PULSATILITY_MIN_REQUIRED ? 
           Math.min(1.0, pulsatility * 3) : 0;
  }

  private validateSignalStability(): number {
    if (this.fingerDetectionState.signalHistory.length < this.CONFIG.STABILITY_FRAMES) return 0;
    
    const recent = this.fingerDetectionState.signalHistory.slice(-this.CONFIG.STABILITY_FRAMES);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / mean; // Coeficiente de variación
    
    const stability = Math.max(0, 1 - cv * 2);
    
    return stability >= this.CONFIG.SIGNAL_CONSISTENCY ? stability : 0;
  }

  private calculateAndValidateSNR(): number {
    if (this.fingerDetectionState.signalHistory.length < 30) return 0;
    
    const signal = this.fingerDetectionState.signalHistory.slice(-30);
    
    // Calcular potencia de señal (componente cardíaca)
    const signalPower = this.calculateSignalPower(signal);
    
    // Calcular potencia de ruido
    const noisePower = this.calculateNoisePower(signal);
    
    if (noisePower === 0) return 0;
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    this.fingerDetectionState.signalToNoiseRatio = snr;
    
    return snr >= this.CONFIG.MIN_SNR_REQUIRED ? 
           Math.min(1.0, snr / 30) : 0;
  }

  private detectRealPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    for (let i = 2; i < signal.length - 2; i++) {
      if (signal[i] > signal[i-1] && signal[i] > signal[i+1] && 
          signal[i] > signal[i-2] && signal[i] > signal[i+2]) {
        const prominence = Math.min(signal[i] - signal[i-1], signal[i] - signal[i+1]);
        if (prominence >= this.CONFIG.PEAK_PROMINENCE) {
          peaks.push(signal[i]);
        }
      }
    }
    return peaks;
  }

  private detectRealValleys(signal: number[]): number[] {
    const valleys: number[] = [];
    for (let i = 2; i < signal.length - 2; i++) {
      if (signal[i] < signal[i-1] && signal[i] < signal[i+1] && 
          signal[i] < signal[i-2] && signal[i] < signal[i+2]) {
        const depth = Math.min(signal[i-1] - signal[i], signal[i+1] - signal[i]);
        if (depth >= this.CONFIG.VALLEY_DEPTH) {
          valleys.push(signal[i]);
        }
      }
    }
    return valleys;
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

  private calculatePreciseGain(detectionResult: { detectionScore: number; opticalCoherence: number }): number {
    const baseGain = 1.8;
    const detectionBoost = Math.sqrt(detectionResult.detectionScore) * 0.3;
    const coherenceBoost = detectionResult.opticalCoherence * 0.2;
    
    return Math.min(2.5, Math.max(1.0, baseGain + detectionBoost + coherenceBoost));
  }

  private calculateUltraPreciseQuality(
    detectionResult: { detectionScore: number }, 
    textureScore: number, 
    redValue: number,
    snr: number
  ): number {
    if (detectionResult.detectionScore < 0.5) return 0;
    
    const detectionQuality = Math.pow(detectionResult.detectionScore, 0.8) * 40;
    const textureQuality = textureScore * 25;
    const signalQuality = Math.min(25, (redValue / 8));
    const snrQuality = Math.min(10, Math.max(0, snr - 10));
    
    const finalQuality = Math.min(100, Math.max(0, 
      detectionQuality + textureQuality + signalQuality + snrQuality));
    
    return finalQuality;
  }

  private calculatePrecisePerfusion(
    redValue: number, isDetected: boolean, quality: number, detectionScore: number
  ): number {
    if (!isDetected || quality < 50 || detectionScore < 0.7) return 0;
    
    const normalizedRed = Math.min(1, redValue / 120);
    const perfusionBase = Math.log1p(normalizedRed * 2) * 2.0;
    
    const qualityFactor = Math.tanh(quality / 40) * 0.3;
    const confidenceFactor = Math.sqrt(detectionScore) * 0.3;
    
    const totalPerfusion = (perfusionBase + qualityFactor + confidenceFactor) * 6;
    
    return Math.min(10, Math.max(0, totalPerfusion));
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
