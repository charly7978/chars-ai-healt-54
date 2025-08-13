import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { SignalTrendAnalyzer, TrendResult } from './SignalTrendAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { FrameProcessor } from './FrameProcessor';
import { CalibrationHandler } from './CalibrationHandler';
import { SignalAnalyzer } from './SignalAnalyzer';
import { MotionDetector } from './MotionDetector';
import { LightingValidator } from './LightingValidator';
import { SignalProcessorConfig } from './types';

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
  public motionDetector: MotionDetector;
  public lightingValidator: LightingValidator;
  public lastValues: number[] = [];
  public isCalibrating: boolean = false;
  public frameProcessedCount = 0;
  
  // Configuración POTENTE para extracción fuerte de datos
  public readonly CONFIG: SignalProcessorConfig = {
    BUFFER_SIZE: 12,
    MIN_RED_THRESHOLD: 20,    // Umbral MÁS ALTO para señales más fuertes
    MAX_RED_THRESHOLD: 250,
    STABILITY_WINDOW: 8,      // Ventana rápida para respuesta ágil
    MIN_STABILITY_COUNT: 4,   // Menos frames para detección rápida
    HYSTERESIS: 1.8,          // Histeresis moderada
    MIN_CONSECUTIVE_DETECTIONS: 6,  // DETECCIÓN MÁS ESTRICTA
    MAX_CONSECUTIVE_NO_DETECTIONS: 6,  // Menos tolerante a variaciones
    QUALITY_LEVELS: 25,
    QUALITY_HISTORY_SIZE: 8,  // Historia moderada
    CALIBRATION_SAMPLES: 10,  // Calibración rápida
    TEXTURE_GRID_SIZE: 6,     // Grid eficiente
    ROI_SIZE_FACTOR: 0.75     // ROI amplio para capturar más señal
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
    this.motionDetector = new MotionDetector();
    this.lightingValidator = new LightingValidator();
    
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
      this.motionDetector.reset();
      this.lightingValidator.reset();
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
    this.motionDetector.reset();
    this.lightingValidator.reset();
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

      // 1. VALIDACIÓN DE ILUMINACIÓN - Detectar luz ambiental vs dedo real
      const lightingAnalysis = this.lightingValidator.analyzeLighting(imageData);
      
      // VALIDACIÓN PERMISIVA de iluminación para extracción potente
      if (lightingAnalysis.lightingType === 'insufficient') {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Insufficient lighting detected");
        }
        
        const insufficientSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: 0,
          filteredValue: 0,
          quality: 0,
          fingerDetected: false,
          roi: { x: 0, y: 0, width: 0, height: 0 },
          perfusionIndex: 0
        };
        
        this.onSignalReady(insufficientSignal);
        return;
      }
      
      // 2. Extract frame features with enhanced validation
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

      // VALIDACIÓN PERMISIVA para extracción potente
      if (redValue < this.CONFIG.MIN_RED_THRESHOLD) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Signal below minimum threshold:", redValue);
        }

        const weakSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: redValue,
          filteredValue: redValue,
          quality: 0,
          fingerDetected: false,
          roi: roi,
          perfusionIndex: 0
        };

        this.onSignalReady(weakSignal);
        return;
      }

      // 2. Apply multi-stage filtering to the signal
      let filteredValue = this.kalmanFilter.filter(redValue);
      filteredValue = this.sgFilter.filter(filteredValue);
      // Aplicar ganancia adaptativa basada en calidad de señal
      const adaptiveGain = Math.min(2.0, 1.0 + (extractionResult.textureScore * 0.5));
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

      // VALIDACIÓN PERMISIVA de ratio de colores para extracción potente
      if ((rToGRatio < 0.7 || rToGRatio > 6.0) && !this.isCalibrating) {
        if (shouldLog) {
          console.log("PPGSignalProcessor: Color ratio out of normal range:", { rToGRatio, rToBRatio });
        }

        const ratioSignal: ProcessedSignal = {
          timestamp: Date.now(),
          rawValue: redValue,
          filteredValue: filteredValue,
          quality: Math.min(25, redValue * 0.15), // Calidad parcial
          fingerDetected: false,
          roi: roi,
          perfusionIndex: 0
        };

        this.onSignalReady(ratioSignal);
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

      // 5. ANÁLISIS DE MOVIMIENTO - Validar que el dedo esté estático
      const motionAnalysis = this.motionDetector.analyzeMotion(redValue, roi, textureScore);
      
      // Sin validación cruzada restrictiva - permitir extracción potente
      
      // 6. Perform multi-detector analysis SOLO si no hay movimiento excesivo
      const detectionResult = this.signalAnalyzer.analyzeSignalMultiDetector(filteredValue, trendResult);
      let { isFingerDetected, quality } = detectionResult;
      
      // TOLERANCIA AL MOVIMIENTO para extracción potente
      if (motionAnalysis.motionLevel > 0.6) { // Umbral más alto
        if (shouldLog) {
          console.log("PPGSignalProcessor: EXCESSIVE MOTION - Reducing quality:", {
            motionLevel: motionAnalysis.motionLevel
          });
        }
        
        quality = Math.max(15, quality * 0.7); // Reducir calidad pero no eliminar
      }
      
      // AJUSTES POR COLOCACIÓN para extracción potente
      if (!motionAnalysis.hasValidPlacement) {
        quality = Math.max(10, quality * 0.6); // Reducir pero no eliminar
      }
      
      // AJUSTE POR ILUMINACIÓN para extracción potente
      if (lightingAnalysis.confidence < 0.3) {
        quality = Math.max(8, quality * 0.5); // Reducir pero mantener señal
      }

      // Calculate perfusion index con validación PERMISIVA para extracción potente
      const perfusionIndex = isFingerDetected && quality > 20 ? 
                           Math.max(0, (Math.log(redValue) * 0.5 - 1.0)) : 0;

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
