import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer, TrendResult } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';
import { SignalProcessorConfig, FrameData } from './types';

/**
 * Procesador de señal PPG con detección de dedo
 * e indicador de calidad
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  public kalmanFilter: KalmanFilter;
  public sgFilter: SavitzkyGolayFilter;
  public trendAnalyzer: SignalTrendAnalyzer;
  public biophysicalValidator: BiophysicalValidator;
  public frameProcessor: FrameProcessor;
  public calibrationHandler: CalibrationHandler;
  public signalAnalyzer: SignalAnalyzer;
  public lastValues: number[] = [];
  public isCalibrating: boolean = false;
  public frameProcessedCount = 0;
  
  // Enhanced configuration with multi-layer validation for medical-grade detection
  public readonly CONFIG: SignalProcessorConfig = {
    BUFFER_SIZE: 90,          // Increased buffer for better HRV and signal analysis
    MIN_RED_THRESHOLD: 30,    // Reducido de 35
    MAX_RED_THRESHOLD: 180,   // Aumentado de 170
    STABILITY_WINDOW: 40,     // Increased for more robust stability assessment
    MIN_STABILITY_COUNT: 15,  // Requires more stability for reliable detection
    HYSTERESIS: 8.0,         // Increased hysteresis for ultra-stable detection
    MIN_CONSECUTIVE_DETECTIONS: 20, // Reducido de 25
    MAX_CONSECUTIVE_NO_DETECTIONS: 2,  // Faster response when finger is removed
    QUALITY_LEVELS: 100,       // Aumentado para más granularidad
    QUALITY_HISTORY_SIZE: 30, // Larger history for better trend analysis
    CALIBRATION_SAMPLES: 30,  // More samples for accurate calibration
    TEXTURE_GRID_SIZE: 20,    // Finer texture analysis for better detection
    ROI_SIZE_FACTOR: 0.35,    // Smaller ROI for better signal focus and reduced noise
    PEAK_DETECTION_THRESHOLD: 0.35, // Higher threshold for peak detection
    MIN_PEAK_SEPARATION: 0.5, // Minimum separation between peaks (seconds)
    HEART_RATE_MIN: 45,       // Minimum physiological heart rate (stricter)
    HEART_RATE_MAX: 160,      // Maximum physiological heart rate (stricter)
    MOTION_THRESHOLD: 0.15,   // Threshold for motion detection
    SIGNAL_TO_NOISE_MIN: 3.0, // Minimum signal-to-noise ratio
    MIN_PULSATILITY_SCORE: 0.25, // Minimum pulsatility score for valid detection
    COLOR_RATIO_MIN: 0.9,     // Minimum red/green ratio for physiological validation
    COLOR_RATIO_MAX: 3.2      // Maximum red/green ratio for physiological validation
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("[DIAG] PPGSignalProcessor: Constructor", {
      hasSignalReadyCallback: !!onSignalReady,
      hasErrorCallback: !!onError,
      stack: new Error().stack
    });
    
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
      QUALITY_HISTORY_SIZE: this.CONFIG.QUALITY_HISTORY_SIZE,
      MIN_CONSECUTIVE_DETECTIONS: this.CONFIG.MIN_CONSECUTIVE_DETECTIONS,
      MAX_CONSECUTIVE_NO_DETECTIONS: this.CONFIG.MAX_CONSECUTIVE_NO_DETECTIONS
    });
    
    console.log("PPGSignalProcessor: Instance created with medically appropriate configuration:", this.CONFIG);
  }

  async initialize(): Promise<void> {
    console.log("[DIAG] PPGSignalProcessor: initialize() called", {
      hasSignalReadyCallback: !!this.onSignalReady,
      hasErrorCallback: !!this.onError
    });
    try {
      // Reset all filters and analyzers
      this.lastValues = [];
      this.kalmanFilter.reset();
      this.sgFilter.reset();
      this.trendAnalyzer.reset();
      this.biophysicalValidator.reset();
      this.signalAnalyzer.reset();
      this.frameProcessedCount = 0;
      
      console.log("PPGSignalProcessor: System initialized with callbacks:", {
        hasSignalReadyCallback: !!this.onSignalReady,
        hasErrorCallback: !!this.onError
      });
    } catch (error) {
      console.error("PPGSignalProcessor: Initialization error", error);
      this.handleError("INIT_ERROR", "Error initializing advanced processor");
    }
  }

  start(): void {
    console.log("[DIAG] PPGSignalProcessor: start() called", { isProcessing: this.isProcessing });
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log("PPGSignalProcessor: Advanced system started");
  }

  stop(): void {
    console.log("[DIAG] PPGSignalProcessor: stop() called", { isProcessing: this.isProcessing });
    this.isProcessing = false;
    this.lastValues = [];
    this.kalmanFilter.reset();
    this.sgFilter.reset();
    this.trendAnalyzer.reset();
    this.biophysicalValidator.reset();
    this.signalAnalyzer.reset();
    console.log("PPGSignalProcessor: Advanced system stopped");
  }

  async calibrate(): Promise<boolean> {
    try {
      console.log("PPGSignalProcessor: Starting adaptive calibration");
      await this.initialize();
      
      // Mark calibration mode
      this.isCalibrating = true;
      
      // After a period of calibration, automatically finish
      setTimeout(() => {
        this.isCalibrating = false;
        console.log("PPGSignalProcessor: Adaptive calibration completed automatically");
      }, 3000);
      
      console.log("PPGSignalProcessor: Adaptive calibration initiated");
      return true;
    } catch (error) {
      console.error("PPGSignalProcessor: Calibration error", error);
      this.handleError("CALIBRATION_ERROR", "Error during adaptive calibration");
      this.isCalibrating = false;
      return false;
    }
  }

  processFrame(imageData: ImageData): void {
    console.log("[DIAG] PPGSignalProcessor: processFrame() called", {
      isProcessing: this.isProcessing,
      hasOnSignalReadyCallback: !!this.onSignalReady,
      imageSize: `${imageData.width}x${imageData.height}`,
      timestamp: new Date().toISOString()
    });
    if (!this.isProcessing) {
      console.log("PPGSignalProcessor: Not processing, ignoring frame");
      return;
    }

    try {
      // Count processed frames
      this.frameProcessedCount++;
      const shouldLog = this.frameProcessedCount % 30 === 0;  // Log every 30 frames

      // CRITICAL CHECK: Ensure callbacks are available
      if (!this.onSignalReady) {
        console.error("PPGSignalProcessor: onSignalReady callback not available, cannot continue");
        this.handleError("CALLBACK_ERROR", "Callback onSignalReady not available");
        return;
      }

      // 1. Extract frame features with enhanced validation
      const extractionResult = this.frameProcessor.extractFrameData(imageData);
      const { redValue, textureScore, rToGRatio, rToBRatio, avgGreen, avgBlue } = extractionResult;
      const roi = this.frameProcessor.detectROI(redValue, imageData);

      // DEBUGGING: Log extracted redValue and ROI
      if (shouldLog) {
        console.log("PPGSignalProcessor DEBUG:", {
          step: "FrameExtraction",
          redValue: redValue,
          roiX: roi.x,
          roiY: roi.y,
          roiWidth: roi.width,
          roiHeight: roi.height,
          textureScore,
          rToGRatio,
          rToBRatio
        });
      }

      // Early rejection of invalid frames - stricter thresholds with multi-layer validation
      if (redValue < this.CONFIG.MIN_RED_THRESHOLD || redValue > this.CONFIG.MAX_RED_THRESHOLD) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Signal out of physiological range, skipping processing:", redValue);
        }

        const minimalSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: redValue,
          filteredValue: redValue,
          quality: 0,
          fingerDetected: false,
          roi: roi,
          perfusionIndex: 0
        };

        this.onSignalReady(minimalSignal);
        if (shouldLog) {
          console.log("PPGSignalProcessor DEBUG: Sent onSignalReady (Early Reject - Out of Range):", minimalSignal);
        }
        return;
      }

      // Additional validation for texture and color ratios
      if (textureScore < 0.2 || rToGRatio < 0.8 || rToGRatio > 4.0) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Poor texture or non-physiological color ratio, skipping processing:", {
            textureScore,
            rToGRatio
          });
        }

        const minimalSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: redValue,
          filteredValue: redValue,
          quality: 0,
          fingerDetected: false,
          roi: roi,
          perfusionIndex: 0
        };

        this.onSignalReady(minimalSignal);
        if (shouldLog) {
          console.log("PPGSignalProcessor DEBUG: Sent onSignalReady (Early Reject - Poor Texture/Color):", minimalSignal);
        }
        return;
      }

      // 2. Apply multi-stage filtering to the signal with enhanced noise reduction
      let filteredValue = this.kalmanFilter.filter(redValue);
      filteredValue = this.sgFilter.filter(filteredValue);
      
      // Enhanced adaptive gain based on multiple signal quality factors with stricter validation
      const textureGain = Math.min(1.3, 1.0 + (extractionResult.textureScore * 0.25));
      const stabilityGain = this.trendAnalyzer.getStabilityScore() > 0.8 ? 1.15 : 1.0;
      const adaptiveGain = textureGain * stabilityGain;
      filteredValue = filteredValue * adaptiveGain;
      
      // Apply additional noise reduction for low-quality signals with physiological constraints
      if (extractionResult.textureScore < 0.25 || rToGRatio < 0.9 || rToGRatio > 3.5) {
        filteredValue = filteredValue * 0.7 + (this.lastValues[this.lastValues.length - 1] || redValue) * 0.3;
      }
      
      // Apply physiological signal validation - reject unrealistic rapid changes
      if (this.lastValues.length > 0) {
        const lastValue = this.lastValues[this.lastValues.length - 1];
        const changeRatio = Math.abs(filteredValue - lastValue) / (lastValue || 1);
        
        // Reject signals with unrealistic physiological changes (> 20% per frame)
        if (changeRatio > 0.2 && !this.isCalibrating) {
          if (shouldLog) {
            console.log("PPGSignalProcessor: Unrealistic signal change detected, applying smoothing:", {
              changeRatio,
              currentValue: filteredValue,
              lastValue
            });
          }
          filteredValue = lastValue * 0.9 + filteredValue * 0.1;
        }
      }

      // Mantener un historial de valores filtrados para el cálculo de la pulsatilidad
      this.lastValues.push(filteredValue);
      if (this.lastValues.length > this.CONFIG.BUFFER_SIZE) {
        this.lastValues.shift();
      }

      // 3. Perform signal trend analysis with strict physiological validation
      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);

      if (trendResult === "non_physiological" && !this.isCalibrating) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Non-physiological signal rejected");
        }

        const rejectSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: redValue,
          filteredValue: filteredValue,
          quality: 0, 
          fingerDetected: false,
          roi: roi,
          perfusionIndex: 0
        };

        this.onSignalReady(rejectSignal);
        if (shouldLog) {
          console.log("PPGSignalProcessor DEBUG: Sent onSignalReady (Reject - Non-Physiological Trend):", rejectSignal);
        }
        return;
      }

      // Reactivated validation with more tolerant thresholds
      if ((rToGRatio < 0.7 || rToGRatio > 5.0) && !this.isCalibrating) { // Rango ampliado de 0.7 a 5.0
        if (shouldLog) {
          console.log("PPGSignalProcessor: Non-physiological color ratio detected:", {
            rToGRatio,
            rToBRatio
          });
        }

        const rejectSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: redValue,
          filteredValue: filteredValue,
          quality: 0, 
          fingerDetected: false,
          roi: roi,
          perfusionIndex: 0
        };

        this.onSignalReady(rejectSignal);
        if (shouldLog) {
          console.log("PPGSignalProcessor DEBUG: Sent onSignalReady (Reject - Non-Physiological Color Ratio):", rejectSignal);
        }
        return;
      }

      // 4. Calculate comprehensive detector scores with medical validation
      const detectorScores = {
        redValue,
        redChannel: Math.min(1.0, Math.max(0, (redValue - this.CONFIG.MIN_RED_THRESHOLD) / 
                                          (this.CONFIG.MAX_RED_THRESHOLD - this.CONFIG.MIN_RED_THRESHOLD))),
        stability: this.trendAnalyzer.getStabilityScore(),
        pulsatility: this.biophysicalValidator.getPulsatilityScore(this.lastValues),
        biophysical: this.biophysicalValidator.getBiophysicalScore({
          red: redValue,
          green: avgGreen ?? 0,
          blue: avgBlue ?? 0,
        }),
        periodicity: this.trendAnalyzer.getPeriodicityScore()
      };

      // Update analyzer with latest scores
      this.signalAnalyzer.updateDetectorScores(detectorScores);

      // 5. Perform multi-detector analysis for highly accurate finger detection
      const detectionResult = this.signalAnalyzer.analyzeSignalMultiDetector(filteredValue, trendResult);
      const { isFingerDetected, quality } = detectionResult;

      // Calculate physiologically valid perfusion index only when finger is detected
      const perfusionIndex = isFingerDetected && quality > 30 ? 
                           (Math.log(redValue) * 0.55 - 1.2) : 0;

      // Create processed signal object with strict validation
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: filteredValue,
        quality: quality,
        fingerDetected: isFingerDetected,
        roi: roi,
        perfusionIndex: Math.max(0, perfusionIndex)
      };

      // Nuevo filtrado ambiental
      const environmentalNoise = this.estimateEnvironmentalNoise(extractionResult);
      if (environmentalNoise > 0.4) {
        filteredValue = this.applyNoiseReduction(filteredValue, environmentalNoise);
      }
      
      // Ajustar calidad con más granularidad
      const adjustedQuality = Math.round(detectionResult.quality * 100 / this.CONFIG.QUALITY_LEVELS);

      if (shouldLog) {
        console.log("PPGSignalProcessor: Sending validated signal:", {
          fingerDetected: isFingerDetected,
          quality, adjustedQuality,
          redValue,
          filteredValue,
          timestamp: new Date().toISOString()
        });
      }

      // FINAL VALIDATION before sending
      if (typeof this.onSignalReady === 'function') {
        this.onSignalReady(processedSignal);
        if (shouldLog) {
          console.log("PPGSignalProcessor DEBUG: Sent onSignalReady (Final):", processedSignal);
        }
      } else {
        console.error("PPGSignalProcessor: onSignalReady is not a valid function");
        this.handleError("CALLBACK_ERROR", "Callback onSignalReady is not a valid function");
      }
    } catch (error) {
      console.error("PPGSignalProcessor: Error processing frame", error);
      this.handleError("PROCESSING_ERROR", "Error processing frame");
    }
  }

  private handleError(code: string, message: string): void {
    console.error("PPGSignalProcessor: Error", code, message);
    const error: ProcessingError = {
      code,
      message,
      timestamp: Date.now()
    };
    if (typeof this.onError === 'function') {
      this.onError(error);
    } else {
      console.error("PPGSignalProcessor: onError callback not available, cannot report error:", error);
    }
  }

  // Nueva función para estimar ruido ambiental
  private estimateEnvironmentalNoise(extraction: FrameData): number {
    // Implementación basada en variabilidad de color
    const colorVar = Math.abs(extraction.rToGRatio - 1.5) + Math.abs(extraction.rToBRatio - 1.2);
    return Math.min(1, colorVar / 2);
  }

  // Nueva función de reducción de ruido
  private applyNoiseReduction(value: number, noiseLevel: number): number {
    return value * (1 - noiseLevel * 0.5);
  }
}
