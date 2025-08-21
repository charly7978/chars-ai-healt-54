import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';

/**
 * PROCESADOR PPG ULTRA-ROBUSTO - SOLO DETECCIÓN HUMANA REAL
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
  
  private readonly BUFFER_SIZE = 128; // buffer más largo para estabilidad
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferFull: boolean = false;
  
  private isCalibrating: boolean = false;
  private frameCount: number = 0;
  
  private readonly CONFIG = {
    MIN_RED_THRESHOLD: 15,
    MAX_RED_THRESHOLD: 170,
    MIN_DETECTION_SCORE: 0.92,
    MIN_CONSECUTIVE_FOR_DETECTION: 5,
    MAX_CONSECUTIVE_FOR_LOSS: 2,

    MIN_SNR_REQUIRED: 15.0,
    SKIN_COLOR_STRICTNESS: 2.2,
    PULSATILITY_MIN_REQUIRED: 2.0,
    TEXTURE_HUMAN_MIN: 1.0,
    STABILITY_FRAMES: 5,

    NOISE_THRESHOLD: 1.2,
    PEAK_PROMINENCE: 0.08,
    VALLEY_DEPTH: 0.12,
    SIGNAL_CONSISTENCY: 0.7
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🎯 PPGSignalProcessor: Sistema ULTRA-ROBUSTO activado");
    
    this.signalBuffer = new Float32Array(this.BUFFER_SIZE);
    this.kalmanFilter = new KalmanFilter();
    this.sgFilter = new SavitzkyGolayFilter();
    this.trendAnalyzer = new SignalTrendAnalyzer();
    this.biophysicalValidator = new BiophysicalValidator();
    this.frameProcessor = new FrameProcessor({
      TEXTURE_GRID_SIZE: 16,
      ROI_SIZE_FACTOR: 1.10
    });
    this.calibrationHandler = new CalibrationHandler({
      CALIBRATION_SAMPLES: 40,
      MIN_RED_THRESHOLD: this.CONFIG.MIN_RED_THRESHOLD,
      MAX_RED_THRESHOLD: this.CONFIG.MAX_RED_THRESHOLD
    });
    this.signalAnalyzer = new SignalAnalyzer({
      QUALITY_LEVELS: 100,
      QUALITY_HISTORY_SIZE: 60,
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
      
      console.log("✅ PPGSignalProcessor: Inicialización completada");
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error inicialización", error);
      this.handleError("INIT_ERROR", "Error inicializando procesador");
    }
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log("🚀 PPGSignalProcessor: Sistema iniciado");
  }

  stop(): void {
    this.isProcessing = false;
    this.reset();
    console.log("⏹️ PPGSignalProcessor: Sistema detenido");
  }

  async calibrate(): Promise<boolean> {
    try {
      console.log("🔧 PPGSignalProcessor: Calibración iniciada");
      await this.initialize();
      
      this.isCalibrating = true;
      
      setTimeout(() => {
        this.isCalibrating = false;
        console.log("✅ PPGSignalProcessor: Calibración completada");
      }, 4000);
      
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
      
      const extractionResult = this.frameProcessor.extractFrameData(imageData);
      const { redValue, textureScore, rToGRatio, rToBRatio, avgGreen, avgBlue } = extractionResult;
      const roi = this.frameProcessor.detectROI(redValue, imageData);

      const fingerDetectionResult = this.detectFingerOptimized(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio, imageData
      );

      let filteredValue = redValue;
      if (fingerDetectionResult.isDetected) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
        const preciseGain = this.calculateOptimizedGain(fingerDetectionResult);
        filteredValue = filteredValue * preciseGain;
      }

      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      if (this.bufferIndex === 0) this.bufferFull = true;

      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);
      
      const quality = this.calculateUltraPreciseQuality(
        fingerDetectionResult, textureScore, redValue, this.fingerDetectionState.signalToNoiseRatio
      );

      const perfusionIndex = this.calculatePrecisePerfusion(
        redValue, fingerDetectionResult.isDetected, quality, fingerDetectionResult.detectionScore
      );

      if (this.frameCount % 30 === 0) {
        console.log("🎯 Estado:", {
          red: redValue.toFixed(2),
          detected: fingerDetectionResult.isDetected,
          score: fingerDetectionResult.detectionScore.toFixed(3),
          consecutivas: this.fingerDetectionState.consecutiveDetections,
          snr: this.fingerDetectionState.signalToNoiseRatio.toFixed(1)
        });
      }

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

  private detectFingerOptimized(
    red: number, green: number, blue: number, 
    textureScore: number, rToGRatio: number, rToBRatio: number,
    imageData: ImageData
  ): { isDetected: boolean; detectionScore: number; opticalCoherence: number } {
    
    if (red < this.CONFIG.MIN_RED_THRESHOLD || red > this.CONFIG.MAX_RED_THRESHOLD) {
      this.resetDetectionState();
      return { isDetected: false, detectionScore: 0, opticalCoherence: 0 };
    }

    this.fingerDetectionState.signalHistory.push(red);
    if (this.fingerDetectionState.signalHistory.length > 50) {
      this.fingerDetectionState.signalHistory.shift();
    }

    const skinColorScore = this.validateOptimizedSkinColor(red, green, blue);
    const textureHumanScore = Math.min(1.0, textureScore * 2.0);
    const pulsatilityScore = this.validateOptimizedPulsatility(red);
    const stabilityScore = this.validateOptimizedStability();
    const snrScore = this.calculateOptimizedSNR();
    
    const weights = [0.3, 0.2, 0.25, 0.15, 0.1];
    const scores = [skinColorScore, textureHumanScore, pulsatilityScore, stabilityScore, snrScore];
    const rawDetectionScore = scores.reduce((sum, score, i) => sum + score * weights[i], 0);

    const shouldDetect = rawDetectionScore >= this.CONFIG.MIN_DETECTION_SCORE;

    if (shouldDetect) {
      this.fingerDetectionState.consecutiveDetections++;
      this.fingerDetectionState.consecutiveNonDetections = 0;
      
      if (this.fingerDetectionState.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
        if (!this.fingerDetectionState.isDetected) {
          console.log("✅ DEDO DETECTADO", {
            score: rawDetectionScore.toFixed(3),
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

  private validateOptimizedSkinColor(r: number, g: number, b: number): number {
    const total = r + g + b + 1e-10;
    const redRatio = r / total;
    const greenRatio = g / total;
    const blueRatio = b / total;

    if (redRatio >= 0.35 && redRatio <= 0.65 &&
        greenRatio >= 0.2 && greenRatio <= 0.45 &&
        blueRatio <= 0.25) {
      return 1.0;
    }
    return 0;
  }

  private validateOptimizedPulsatility(currentValue: number): number {
    if (this.fingerDetectionState.signalHistory.length < 20) return 0;

    const recent = this.fingerDetectionState.signalHistory.slice(-40);
    const peaks = this.detectRealPeaks(recent);

    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i - 1]);
    }
    if (intervals.length < 2) return 0;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = 60000 / avgInterval;

    if (bpm >= 48 && bpm <= 180) return 1.0;
    return 0;
  }

  private validateOptimizedStability(): number {
    if (this.fingerDetectionState.signalHistory.length < this.CONFIG.STABILITY_FRAMES) return 0.5;
    
    const recent = this.fingerDetectionState.signalHistory.slice(-this.CONFIG.STABILITY_FRAMES);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / mean;
    
    return Math.max(0.2, 1 - cv);
  }

  private calculateOptimizedSNR(): number {
    if (this.fingerDetectionState.signalHistory.length < 30) return 0.5;
    
    const signal = this.fingerDetectionState.signalHistory.slice(-30);
    const signalPower = this.calculateSignalPower(signal);
    const noisePower = this.calculateNoisePower(signal);
    
    if (noisePower === 0) return 1.0;
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    this.fingerDetectionState.signalToNoiseRatio = snr;
    
    return snr >= this.CONFIG.MIN_SNR_REQUIRED ? 
           Math.min(1.0, snr / 20) : Math.max(0.1, snr / 20);
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
    let power = 0;
    for (let i = 1; i < signal.length; i++) {
      const diff = signal[i] - signal[i-1];
      power += diff * diff;
    }
    return power / (signal.length - 1);
  }

  private calculateNoisePower(signal: number[]): number {
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

  private calculateOptimizedGain(detectionResult: { detectionScore: number; opticalCoherence: number }): number {
    const baseGain = 2.0;
    const detectionBoost = detectionResult.detectionScore * 0.3;
    return Math.min(3.0, Math.max(1.2, baseGain + detectionBoost));
  }

  private calculateUltraPreciseQuality(
    detectionResult: { detectionScore: number }, 
    textureScore: number, 
    redValue: number,
    snr: number
  ): number {
    if (detectionResult.detectionScore < 0.6) return 0;

    const detectionQuality = detectionResult.detectionScore * 40;
    const snrQuality = Math.min(40, snr * 2);
    const pulsatilityQuality = this.validateOptimizedPulsatility(redValue) * 20;
    const textureQuality = Math.min(20, textureScore * 20);

    return Math.min(100, detectionQuality + snrQuality + pulsatilityQuality + textureQuality);
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
     
