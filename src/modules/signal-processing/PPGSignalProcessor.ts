import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer, TrendResult } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';
import { SignalProcessorConfig } from './types';

/**
 * Procesador de señal PPG con detección de dedo mejorada
 * e indicador de calidad con validaciones biofísicas humanas
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
  
  // Configuration with enhanced human finger detection
  public readonly CONFIG: SignalProcessorConfig = {
    BUFFER_SIZE: 25,              // Aumentado para mayor estabilidad
    MIN_RED_THRESHOLD: 0,
    MAX_RED_THRESHOLD: 240,
    STABILITY_WINDOW: 25,         // Aumentado para mayor estabilidad
    MIN_STABILITY_COUNT: 10,      // Aumentado para mayor estabilidad
    HYSTERESIS: 2.8,              // Aumentado para mayor estabilidad
    MIN_CONSECUTIVE_DETECTIONS: 12, // Aumentado para mayor estabilidad
    MAX_CONSECUTIVE_NO_DETECTIONS: 8, // Aumentado para mayor estabilidad
    QUALITY_LEVELS: 30,           // Aumentado para mayor estabilidad
    QUALITY_HISTORY_SIZE: 20,     // Aumentado para mayor estabilidad
    CALIBRATION_SAMPLES: 15,      // Aumentado para mayor estabilidad
    TEXTURE_GRID_SIZE: 8,
    ROI_SIZE_FACTOR: 0.70         // Aumentado para mayor cobertura
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
    
    console.log("PPGSignalProcessor: Instance created with enhanced human detection:", this.CONFIG);
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
      timestamp: new Date().toISOString(),
      config: this.CONFIG // Log de configuración para verificar mejoras
    });
    if (!this.isProcessing) {
      console.log("PPGSignalProcessor: Not processing, ignoring frame");
      return;
    }

    try {
      // Count processed frames
      this.frameProcessedCount++;
      const shouldLog = this.frameProcessedCount % 30 === 0;

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

      // ENHANCED HUMAN MORPHOLOGY VALIDATION (subtle but effective)
      const humanMorphologyValid = this.validateHumanFingerMorphology(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio
      );

      if (shouldLog) {
        console.log("PPGSignalProcessor DEBUG - MEJORAS APLICADAS:", {
          step: "FrameExtraction",
          redValue: redValue,
          humanMorphologyValid,
          roiX: roi.x,
          roiY: roi.y,
          roiWidth: roi.width,
          roiHeight: roi.height,
          textureScore,
          rToGRatio,
          rToBRatio,
          config: {
            BUFFER_SIZE: this.CONFIG.BUFFER_SIZE,
            MIN_CONSECUTIVE_DETECTIONS: this.CONFIG.MIN_CONSECUTIVE_DETECTIONS,
            MAX_CONSECUTIVE_NO_DETECTIONS: this.CONFIG.MAX_CONSECUTIVE_NO_DETECTIONS
          }
        });
      }

      // Early rejection if non-human morphology detected
      if (!humanMorphologyValid && !this.isCalibrating) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Non-human morphology detected, rejecting signal");
        }

        const rejectSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: redValue,
          filteredValue: redValue,
          quality: 0,
          fingerDetected: false,
          roi: roi,
          perfusionIndex: 0
        };

        this.onSignalReady(rejectSignal);
        return;
      }

      // Early rejection of invalid frames - stricter thresholds
      if (redValue < this.CONFIG.MIN_RED_THRESHOLD * 0.9) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Signal too weak, skipping processing:", redValue);
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
          console.log("PPGSignalProcessor DEBUG: Sent onSignalReady (Early Reject - Weak Signal):", minimalSignal);
        }
        return;
      }

      // 2. Apply multi-stage filtering to the signal with human-optimized parameters
      let filteredValue = this.kalmanFilter.filter(redValue);
      filteredValue = this.sgFilter.filter(filteredValue);
      
      // Enhanced adaptive gain based on human finger characteristics
      const humanOptimizedGain = this.calculateHumanOptimizedGain(
        extractionResult.textureScore, rToGRatio, humanMorphologyValid
      );
      filteredValue = filteredValue * humanOptimizedGain;

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

      // Enhanced color ratio validation for human fingers (STRICT validation)
      if ((rToGRatio < 0.8 || rToGRatio > 4.5) && !this.isCalibrating) {
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

      // 4. Calculate comprehensive detector scores with enhanced human validation
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
        }) * (humanMorphologyValid ? 1.1 : 0.7), // Boost for human morphology
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
        fingerDetected: isFingerDetected && humanMorphologyValid,
        roi: roi,
        perfusionIndex: Math.max(0, perfusionIndex)
      };

      if (shouldLog) {
        console.log("PPGSignalProcessor: Sending validated signal:", {
          fingerDetected: isFingerDetected && humanMorphologyValid,
          quality,
          redValue,
          filteredValue,
          humanMorphologyValid,
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

  /**
   * Enhanced validation of human finger morphology to prevent false positives
   * Uses physiological characteristics typical of human fingers with improved stability
   * STRICT validation to only detect human fingers
   */
  private validateHumanFingerMorphology(
    red: number, 
    green: number, 
    blue: number, 
    textureScore: number, 
    rToGRatio: number, 
    rToBRatio: number
  ): boolean {
    // Human finger characteristics (STRICT validation for human-only detection)
    
    // 1. Color temperature consistency (human skin has specific warmth)
    const colorTemperature = (red + green) / (blue + 1);
    const humanColorTempRange = colorTemperature >= 1.4 && colorTemperature <= 6.0; // Rango más estricto
    
    // 2. Texture complexity (human skin has moderate texture)
    const humanTextureRange = textureScore >= 0.25 && textureScore <= 0.85; // Rango más estricto
    
    // 3. Vascular undertone (subtle red dominance in human fingers)
    const vascularUndertone = red > green * 0.9 && red > blue * 1.15; // Umbrales más estrictos
    
    // 4. Physiological color ratios for human tissue (strict validation)
    const physiologicalRatios = rToGRatio >= 0.9 && rToGRatio <= 4.0 && 
                               rToBRatio >= 1.0 && rToBRatio <= 3.8; // Rangos más estrictos
    
    // 5. Minimum signal strength for human capillary perfusion (strict)
    const minCapillaryPerfusion = red >= 25 && green >= 20 && blue >= 15; // Umbrales más estrictos
    
    // 6. Signal stability check (strict)
    const signalStability = red > 0 && green > 0 && blue > 0; // Señal válida
    
    // 7. Human-specific color balance (new strict criterion)
    const humanColorBalance = (red > green * 1.1) && (red > blue * 1.2) && 
                             (green > blue * 0.8) && (green < red * 0.9);
    
    // 8. Texture consistency for human skin (new strict criterion)
    const humanTextureConsistency = textureScore > 0.3 && textureScore < 0.8;
    
    // Combine all indicators (at least 6 out of 8 must be true for strict validation)
    const validationCount = [
      humanColorTempRange,
      humanTextureRange, 
      vascularUndertone,
      physiologicalRatios,
      minCapillaryPerfusion,
      signalStability,
      humanColorBalance,
      humanTextureConsistency
    ].filter(Boolean).length;
    
    return validationCount >= 6; // Umbral más estricto para solo dedos humanos
  }

  /**
   * Calculate human-optimized gain for signal enhancement
   */
  private calculateHumanOptimizedGain(
    textureScore: number, 
    rToGRatio: number, 
    isHumanMorphology: boolean
  ): number {
    let baseGain = 1.0;
    
    // Boost gain for confirmed human morphology
    if (isHumanMorphology) {
      baseGain *= 1.05;
    }
    
    // Adjust based on texture (human skin optimal range)
    if (textureScore >= 0.3 && textureScore <= 0.7) {
      baseGain *= 1.03;
    }
    
    // Adjust based on color ratio (human skin optimal range)
    if (rToGRatio >= 1.2 && rToGRatio <= 2.5) {
      baseGain *= 1.02;
    }
    
    return Math.min(2.2, Math.max(0.8, baseGain));
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
}
