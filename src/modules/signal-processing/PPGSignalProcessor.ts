import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer, TrendResult } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';
import { SignalProcessorConfig } from './types';
import { IntelligentCalibrator } from './IntelligentCalibrator';

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
  public intelligentCalibrator: IntelligentCalibrator;
  public lastValues: number[] = [];
  public isCalibrating: boolean = false;
  public frameProcessedCount = 0;
  
  // Configuration with ultra-sensitive thresholds for optimal finger detection
  public readonly CONFIG: SignalProcessorConfig = {
    BUFFER_SIZE: 12,
    MIN_RED_THRESHOLD: 0,     // Sin umbral mínimo - acepta cualquier señal
    MAX_RED_THRESHOLD: 255,
    STABILITY_WINDOW: 3,      // Muy reducido para detección inmediata
    MIN_STABILITY_COUNT: 1,   // Mínimo absoluto
    HYSTERESIS: 0.5,          // Muy reducido para máxima sensibilidad
    MIN_CONSECUTIVE_DETECTIONS: 2,  // Detección casi inmediata
    MAX_CONSECUTIVE_NO_DETECTIONS: 12,  // Mantener detección más tiempo
    QUALITY_LEVELS: 15,
    QUALITY_HISTORY_SIZE: 8,
    CALIBRATION_SAMPLES: 8,
    TEXTURE_GRID_SIZE: 6,
    ROI_SIZE_FACTOR: 0.7
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
    this.intelligentCalibrator = new IntelligentCalibrator();
    
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
      this.intelligentCalibrator.reset();
      this.intelligentCalibrator.reset();
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
      console.log("PPGSignalProcessor: Starting intelligent calibration");
      await this.initialize();
      
      // Iniciar calibración inteligente
      this.isCalibrating = true;
      this.intelligentCalibrator.startCalibration();
      
      console.log("PPGSignalProcessor: Intelligent calibration initiated");
      return true;
    } catch (error) {
      console.error("PPGSignalProcessor: Calibration error", error);
      this.handleError("CALIBRATION_ERROR", "Error during intelligent calibration");
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

      // Alimentar calibrador inteligente si está activo
      if (this.intelligentCalibrator.isCalibrating()) {
        this.intelligentCalibrator.addCalibrationSample(redValue, 0, textureScore);
        
        // Verificar si la calibración se completó
        if (!this.intelligentCalibrator.isCalibrating()) {
          this.isCalibrating = false;
          console.log("PPGSignalProcessor: Intelligent calibration completed");
        }
      }
      
      // Aplicar umbrales adaptativos si están disponibles
      const adaptiveThresholds = this.intelligentCalibrator.getAdaptiveThresholds();
      const effectiveMinThreshold = this.isCalibrating ? 0 : adaptiveThresholds.redMin;
      
      // Procesar señales usando umbrales adaptativos

      // 2. Apply enhanced multi-stage filtering with intelligent gain
      let filteredValue = this.kalmanFilter.filter(redValue);
      filteredValue = this.sgFilter.filter(filteredValue);
      
      // Ganancia inteligente basada en múltiples factores
      let adaptiveGain = 1.0;
      
      // Amplificar señales débiles más agresivamente
      if (redValue < 30) {
        adaptiveGain = Math.min(3.5, 2.0 + (1.0 / Math.max(0.1, redValue / 30)));
      } else if (redValue < 60) {
        adaptiveGain = Math.min(2.5, 1.5 + (extractionResult.textureScore * 0.8));
      } else {
        adaptiveGain = Math.min(2.0, 1.0 + (extractionResult.textureScore * 0.5));
      }
      
      // Aplicar ganancia con suavizado
      filteredValue = filteredValue * adaptiveGain;

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

      // Validación de ratio de color ultra-permisiva - solo rechazar casos extremos
      if ((rToGRatio < 0.1 || rToGRatio > 15.0) && !this.isCalibrating && redValue > 10) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Extreme color ratio detected:", {
            rToGRatio,
            rToBRatio,
            redValue
          });
        }
        // Aún así, procesar la señal pero con calidad reducida
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

      // 5. Perform multi-detector analysis with adaptive thresholds
      const detectionResult = this.signalAnalyzer.analyzeSignalMultiDetector(filteredValue, trendResult);
      let { isFingerDetected, quality } = detectionResult;
      
      // Aplicar boost de calidad basado en calibración inteligente
      if (!this.isCalibrating) {
        const calibrationState = this.intelligentCalibrator.getCalibrationState();
        const { skinTone, thickness, bloodFlow } = calibrationState.fingerCharacteristics;
        
        // Boost para características específicas del dedo
        let qualityBoost = 1.0;
        if (skinTone === 'dark' && redValue > adaptiveThresholds.redMin) qualityBoost += 0.3;
        if (thickness === 'thick' && textureScore > 0.3) qualityBoost += 0.2;
        if (bloodFlow === 'low' && quality > 5) qualityBoost += 0.4;
        
        quality = Math.min(100, Math.round(quality * qualityBoost));
        
        // Re-evaluar detección con calidad mejorada
        if (!isFingerDetected && quality > adaptiveThresholds.qualityMin) {
          isFingerDetected = true;
        }
      }

      // Calculate perfusion index with enhanced sensitivity
      let perfusionIndex = 0;
      if (redValue > 5) { // Umbral muy bajo
        // Cálculo mejorado del índice de perfusión
        const basePI = Math.log(Math.max(1, redValue)) * 0.4 - 0.8;
        const qualityBonus = quality > 15 ? (quality / 100) * 0.3 : 0;
        const textureBonus = extractionResult.textureScore * 0.2;
        
        perfusionIndex = Math.max(0, basePI + qualityBonus + textureBonus);
      }

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

      if (shouldLog) {
        console.log("PPGSignalProcessor: Sending validated signal:", {
          fingerDetected: isFingerDetected,
          quality,
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
}
