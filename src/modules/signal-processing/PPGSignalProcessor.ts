import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { FrameProcessor } from './FrameProcessor';
import { SignalQualityAnalyzer, SignalQualityResult } from './SignalQualityAnalyzer';
import { globalCameraController, CameraController } from '../camera/CameraController';

/**
 * PROCESADOR PPG - CON CALIBRACIÓN INTEGRADA
 * 
 * Conecta SignalQualityAnalyzer → CameraController para calibración guiada
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private frameProcessor: FrameProcessor;
  private qualityAnalyzer: SignalQualityAnalyzer;
  
  // Buffers
  private readonly BUFFER_SIZE = 60;
  private rawRedBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  
  // Diagnóstico
  private lastRGB = { r: 0, g: 0, b: 0, rgRatio: 0, redPercent: 0, pulsatility: 0 };
  private frameCount: number = 0;
  private lastQualityResult: SignalQualityResult | null = null;
  
  // RGB para SpO2
  private rgbStats = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
  
  // Calibración cada N frames (no cada frame)
  private calibrationFrameCounter = 0;
  private readonly CALIBRATION_INTERVAL = 5; // Cada 5 frames = ~6 veces/seg
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30);
    this.frameProcessor = new FrameProcessor();
    this.qualityAnalyzer = new SignalQualityAnalyzer();
  }

  async initialize(): Promise<void> {
    this.rawRedBuffer = [];
    this.filteredBuffer = [];
    this.bandpassFilter.reset();
    this.qualityAnalyzer.reset();
    this.calibrationFrameCounter = 0;
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
  }

  stop(): void {
    this.isProcessing = false;
    this.initialize();
  }

  async calibrate(): Promise<boolean> {
    await this.initialize();
    return true;
  }

  /**
   * PROCESAMIENTO DE FRAME - CON CALIBRACIÓN GUIADA
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      this.frameCount++;
      const timestamp = Date.now();
      
      // 1. Extraer valores RGB del ROI
      const frameData = this.frameProcessor.extractFrameData(imageData);
      const { redValue, avgGreen = 0, avgBlue = 0 } = frameData;
      
      // Guardar para diagnóstico
      this.lastRGB.r = redValue;
      this.lastRGB.g = avgGreen;
      this.lastRGB.b = avgBlue;
      this.lastRGB.rgRatio = avgGreen > 0 ? redValue / avgGreen : 0;
      this.lastRGB.redPercent = (redValue + avgGreen + avgBlue) > 0 
        ? redValue / (redValue + avgGreen + avgBlue) 
        : 0;
      
      // 2. Guardar en buffer crudo
      this.rawRedBuffer.push(redValue);
      if (this.rawRedBuffer.length > this.BUFFER_SIZE) {
        this.rawRedBuffer.shift();
      }
      
      // 3. Aplicar filtro pasabanda 0.5-4Hz
      const filtered = this.bandpassFilter.filter(redValue);
      this.filteredBuffer.push(filtered);
      if (this.filteredBuffer.length > this.BUFFER_SIZE) {
        this.filteredBuffer.shift();
      }
      
      // 4. ANÁLISIS DE CALIDAD
      const rawR = frameData.rawRed ?? redValue;
      const rawG = frameData.rawGreen ?? avgGreen;
      const rawB = frameData.rawBlue ?? avgBlue;
      
      const qualityResult = this.qualityAnalyzer.analyze(
        redValue, 
        filtered, 
        timestamp,
        { red: rawR, green: rawG, blue: rawB }
      );
      this.lastQualityResult = qualityResult;
      this.lastRGB.pulsatility = qualityResult.perfusionIndex / 100;
      
      // 5. *** CALIBRACIÓN GUIADA POR SEÑAL ***
      this.calibrationFrameCounter++;
      if (this.calibrationFrameCounter >= this.CALIBRATION_INTERVAL) {
        this.calibrationFrameCounter = 0;
        this.executeSignalGuidedCalibration(qualityResult, frameData);
      }
      
      // 6. Actualizar estadísticas RGB
      this.updateRGBStats();
      
      // 7. Emitir señal
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      
      const processedSignal: ProcessedSignal = {
        timestamp,
        rawValue: redValue,
        filteredValue: filtered,
        quality: qualityResult.quality,
        fingerDetected: qualityResult.isSignalValid,
        roi: roi,
        perfusionIndex: qualityResult.perfusionIndex,
        rawGreen: rawG,
        diagnostics: {
          message: qualityResult.invalidReason || `PI: ${qualityResult.perfusionIndex.toFixed(2)}%`,
          hasPulsatility: qualityResult.isSignalValid,
          pulsatilityValue: qualityResult.perfusionIndex / 100
        }
      };

      this.onSignalReady(processedSignal);
    } catch (error) {
      // Error silenciado
    }
  }

  /**
   * CALIBRACIÓN GUIADA POR LA SEÑAL
   * El algoritmo le dice a la cámara qué ajustar
   */
  private executeSignalGuidedCalibration(
    quality: SignalQualityResult,
    frameData: { rawRed?: number; rawGreen?: number; rawBlue?: number }
  ): void {
    // Generar comando basado en métricas
    const command = this.qualityAnalyzer.getCalibrationCommand();
    
    // Construir métricas para el controlador
    const metrics = {
      snr: quality.metrics.snr,
      dcLevel: quality.metrics.dcLevel,
      acAmplitude: quality.metrics.acAmplitude,
      isSaturated: this.frameProcessor.getIsSaturated(),
      perfusionIndex: quality.perfusionIndex,
      periodicity: quality.metrics.periodicity,
      fingerConfidence: quality.metrics.fingerConfidence
    };
    
    // Ejecutar comando en CameraController
    globalCameraController.executeCommand(command, metrics);
  }

  private updateRGBStats(): void {
    this.rgbStats = this.frameProcessor.getRGBStats();
  }

  getRGBStats(): typeof this.rgbStats {
    return { ...this.rgbStats };
  }
  
  getQualityResult(): SignalQualityResult | null {
    return this.lastQualityResult;
  }

  reset(): void {
    this.rawRedBuffer = [];
    this.filteredBuffer = [];
    this.frameCount = 0;
    this.bandpassFilter.reset();
    this.frameProcessor.reset();
    this.qualityAnalyzer.reset();
    this.lastQualityResult = null;
    this.rgbStats = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
    this.calibrationFrameCounter = 0;
  }

  getLastNSamples(n: number): number[] {
    return this.filteredBuffer.slice(-n);
  }
  
  getRawBuffer(): number[] {
    return [...this.rawRedBuffer];
  }
  
  getFilteredBuffer(): number[] {
    return [...this.filteredBuffer];
  }
  
  getDiagnostics(): typeof this.lastRGB {
    return { ...this.lastRGB };
  }
}
