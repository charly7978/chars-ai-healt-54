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
 * Procesador de señal PPG con detección de dedo mejorada y más permisiva
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
  
  // Configuration with more permissive human finger detection
  public readonly CONFIG: SignalProcessorConfig = {
    BUFFER_SIZE: 15,
    MIN_RED_THRESHOLD: 0,
    MAX_RED_THRESHOLD: 240,
    STABILITY_WINDOW: 12,          // Reduced for faster detection
    MIN_STABILITY_COUNT: 5,        // Reduced from 7 to 5 for easier detection
    HYSTERESIS: 1.8,               // Reduced from 2.2 for more sensitivity
    MIN_CONSECUTIVE_DETECTIONS: 6, // Reduced from 8 for faster response
    MAX_CONSECUTIVE_NO_DETECTIONS: 5, // Increased from 4 for better stability
    QUALITY_LEVELS: 20,
    QUALITY_HISTORY_SIZE: 8,       // Reduced for more responsive quality
    CALIBRATION_SAMPLES: 8,        // Reduced for faster calibration
    TEXTURE_GRID_SIZE: 8,
    ROI_SIZE_FACTOR: 0.65          // Slightly increased ROI for better coverage
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
      timestamp: new Date().toISOString()
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

      // MORE PERMISSIVE human morphology validation
      const humanMorphologyValid = this.validateHumanFingerMorphology(
        redValue, avgGreen ?? 0, avgBlue ?? 0, textureScore, rToGRatio, rToBRatio
      );

      if (shouldLog) {
        console.log("PPGSignalProcessor DEBUG:", {
          step: "FrameExtraction",
          redValue: redValue,
          humanMorphologyValid,
          roiX: roi.x,
          roiY: roi.y,
          roiWidth: roi.width,
          roiHeight: roi.height,
          textureScore,
          rToGRatio,
          rToBRatio
        });
      }

      // More lenient rejection - only reject obvious non-human patterns
      if (!humanMorphologyValid && !this.isCalibrating && redValue > 40) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Obvious non-human morphology detected, rejecting signal");
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

      // More permissive threshold for weak signals
      if (redValue < this.CONFIG.MIN_RED_THRESHOLD * 0.7) { // Reduced from 0.9
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

      // 3. Perform signal trend analysis with more permissive physiological validation
      const trendResult = this.trendAnalyzer.analyzeTrend(filteredValue);

      if (trendResult === "non_physiological" && !this.isCalibrating && redValue > 60) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Strong non-physiological signal rejected");
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
        return;
      }

      // More permissive color ratio validation for human fingers
      if ((rToGRatio < 0.6 || rToGRatio > 5.0) && !this.isCalibrating && redValue > 50) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Extreme color ratio detected:", {
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
        return;
      }

      // 4. Calculate comprehensive detector scores with REAL quality metrics
      const detectorScores = {
        redValue,
        redChannel: Math.min(1.0, Math.max(0, (redValue - this.CONFIG.MIN_RED_THRESHOLD) / 
                                          (this.CONFIG.MAX_RED_THRESHOLD - this.CONFIG.MIN_RED_THRESHOLD))),
        stability: this.trendAnalyzer.getStabilityScore(),
        pulsatility: this.calculateRealPulsatilityScore(this.lastValues), // Real pulsatility
        biophysical: this.biophysicalValidator.getBiophysicalScore({
          red: redValue,
          green: avgGreen ?? 0,
          blue: avgBlue ?? 0,
        }) * (humanMorphologyValid ? 1.15 : 0.8), // Boost for confirmed human morphology
        periodicity: this.trendAnalyzer.getPeriodicityScore()
      };

      // Update analyzer with latest scores
      this.signalAnalyzer.updateDetectorScores(detectorScores);

      // 5. Perform multi-detector analysis for highly accurate finger detection
      const detectionResult = this.signalAnalyzer.analyzeSignalMultiDetector(filteredValue, trendResult);
      const { isFingerDetected, quality } = detectionResult;

      // Calculate physiologically valid perfusion index only when finger is detected
      const perfusionIndex = isFingerDetected && quality > 25 ? 
                           this.calculateRealPerfusionIndex(this.lastValues) : 0;

      // Create processed signal object with REAL quality metrics
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
          realPulsatility: detectorScores.pulsatility,
          realPerfusion: perfusionIndex,
          timestamp: new Date().toISOString()
        });
      }

      // FINAL VALIDATION before sending
      if (typeof this.onSignalReady === 'function') {
        this.onSignalReady(processedSignal);
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
   * MORE PERMISSIVE validation of human finger morphology
   */
  private validateHumanFingerMorphology(
    red: number, 
    green: number, 
    blue: number, 
    textureScore: number, 
    rToGRatio: number, 
    rToBRatio: number
  ): boolean {
    // Human finger characteristics (more permissive validation)
    
    // 1. Color temperature consistency (more lenient range)
    const colorTemperature = (red + green) / (blue + 1);
    const humanColorTempRange = colorTemperature >= 1.2 && colorTemperature <= 7.0; // Expanded range
    
    // 2. Texture complexity (more lenient range)
    const humanTextureRange = textureScore >= 0.1 && textureScore <= 0.9; // Expanded range
    
    // 3. Vascular undertone (more permissive)
    const vascularUndertone = red > green * 0.8 && red > blue * 0.9; // More lenient
    
    // 4. Physiological color ratios for human tissue (more permissive)
    const physiologicalRatios = rToGRatio >= 0.7 && rToGRatio <= 4.5 && 
                               rToBRatio >= 0.8 && rToBRatio <= 4.0; // Expanded ranges
    
    // 5. Minimum signal strength for human capillary perfusion (more lenient)
    const minCapillaryPerfusion = red >= 20 && green >= 15 && blue >= 10; // Reduced thresholds
    
    // Combine all indicators (now only need 3 out of 5 to be true)
    const validationCount = [
      humanColorTempRange,
      humanTextureRange, 
      vascularUndertone,
      physiologicalRatios,
      minCapillaryPerfusion
    ].filter(Boolean).length;
    
    return validationCount >= 3; // Reduced from 4 to 3
  }

  /**
   * Calculate REAL pulsatility score based on actual PPG signal variations
   */
  private calculateRealPulsatilityScore(values: number[]): number {
    if (values.length < 5) return 0;
    
    // Calculate AC component (pulsatile variations)
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variations = values.map(val => Math.abs(val - mean));
    const acComponent = variations.reduce((sum, val) => sum + val, 0) / variations.length;
    
    // Calculate DC component (baseline)
    const dcComponent = mean;
    
    // Real pulsatility index (AC/DC ratio)
    const pulsatilityRatio = dcComponent > 0 ? acComponent / dcComponent : 0;
    
    // Normalize to 0-1 range based on typical human PPG values
    return Math.min(1.0, Math.max(0, pulsatilityRatio * 5.0));
  }

  /**
   * Calculate REAL perfusion index from PPG signal
   */
  private calculateRealPerfusionIndex(values: number[]): number {
    if (values.length < 10) return 0;
    
    // Get recent values for real-time calculation
    const recentValues = values.slice(-10);
    const mean = recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
    
    // Calculate standard deviation (AC component approximation)
    const variance = recentValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Real perfusion index: (AC/DC) * 100
    const perfusionIndex = mean > 0 ? (stdDev / mean) * 100 : 0;
    
    // Clamp to physiologically reasonable range (0-20%)
    return Math.min(20, Math.max(0, perfusionIndex));
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
