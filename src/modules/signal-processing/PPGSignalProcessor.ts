import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { FrameProcessor } from './FrameProcessor';
import { HumanFingerDetector } from './HumanFingerDetector';

/**
 * PROCESADOR PPG - VERSIÓN ANTI-FALSOS POSITIVOS
 * 
 * CRÍTICO: Usa HumanFingerDetector para validar que la señal es de SANGRE HUMANA REAL
 * No procesa señales de ambiente, paredes, objetos, etc.
 * 
 * PRINCIPIOS:
 * 1. Detección estricta de dedo con color + pulsatilidad + periodicidad
 * 2. Sin dedo confirmado = SIN señal procesada
 * 3. Los signos vitales SOLO se calculan con señal humana real
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private frameProcessor: FrameProcessor;
  private fingerDetector: HumanFingerDetector;
  
  // Buffers
  private readonly BUFFER_SIZE = 120;
  private rawRedBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  
  // Diagnóstico
  private lastRGB = { r: 0, g: 0, b: 0, rgRatio: 0, redPercent: 0, pulsatility: 0 };
  private frameCount: number = 0;
  
  // Estadísticas RGB para SpO2
  private rgbStats = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30);
    this.frameProcessor = new FrameProcessor({ ROI_SIZE_FACTOR: 0.80 });
    this.fingerDetector = new HumanFingerDetector();
  }

  async initialize(): Promise<void> {
    this.rawRedBuffer = [];
    this.filteredBuffer = [];
    this.bandpassFilter.reset();
    this.fingerDetector.reset();
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
   * PROCESAMIENTO DE FRAME - ANTI-FALSOS POSITIVOS
   * Usa HumanFingerDetector para validar señal humana real
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      this.frameCount++;
      
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
      
      // ════════════════════════════════════════════════════════════════════
      // 4. VALIDACIÓN ESTRICTA CON HumanFingerDetector
      // ════════════════════════════════════════════════════════════════════
      const fingerResult = this.fingerDetector.detectFinger(redValue, avgGreen, avgBlue);
      
      const hasConfirmedBlood = fingerResult.isFingerDetected;
      const pulsatility = fingerResult.diagnostics.pulsatilityValue;
      this.lastRGB.pulsatility = pulsatility;
      
      // 5. Actualizar estadísticas RGB para SpO2 (solo si hay dedo)
      if (hasConfirmedBlood) {
        this.updateRGBStats();
      }
      
      // 6. Calcular calidad de señal
      const quality = hasConfirmedBlood ? fingerResult.quality : 0;
      
      // 7. Log de diagnóstico cada 3 segundos
      if (this.frameCount % 90 === 0) {
        console.log(`🩸 ${fingerResult.diagnostics.message}`);
      }
      
      // 8. Emitir señal procesada
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        // CRÍTICO: Solo emitir señal filtrada si hay dedo CONFIRMADO
        filteredValue: hasConfirmedBlood ? filtered : 0,
        quality: quality,
        fingerDetected: hasConfirmedBlood,
        roi: roi,
        perfusionIndex: pulsatility * 100,
        diagnostics: {
          message: fingerResult.diagnostics.message,
          hasPulsatility: fingerResult.diagnostics.hasPulsatility,
          pulsatilityValue: pulsatility
        }
      };

      this.onSignalReady(processedSignal);
    } catch (error) {
      // Error silenciado para rendimiento
    }
  }

  /**
   * Actualiza estadísticas RGB para cálculo de SpO2
   */
  private updateRGBStats(): void {
    this.rgbStats = this.frameProcessor.getRGBStats();
  }

  /**
   * Obtiene estadísticas RGB para SpO2
   */
  getRGBStats(): typeof this.rgbStats {
    return { ...this.rgbStats };
  }

  reset(): void {
    this.rawRedBuffer = [];
    this.filteredBuffer = [];
    this.frameCount = 0;
    this.bandpassFilter.reset();
    this.frameProcessor.reset();
    this.fingerDetector.reset();
    this.rgbStats = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
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
