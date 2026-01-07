import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - VERSIÓN DIRECTA SIN DETECCIÓN DE DEDO
 * 
 * PRINCIPIO: La señal entra → se procesa → sale
 * Si la señal es de sangre real: valores coherentes
 * Si la señal es de ambiente: valores erráticos/inválidos
 * 
 * NO hay "finger detection" - la calidad de la señal habla por sí misma
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private frameProcessor: FrameProcessor;
  
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
  }

  async initialize(): Promise<void> {
    this.rawRedBuffer = [];
    this.filteredBuffer = [];
    this.bandpassFilter.reset();
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
   * PROCESAMIENTO DE FRAME - DIRECTO SIN VALIDACIÓN DE DEDO
   * Procesa todo, la señal real producirá patrones coherentes
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
      
      // 4. Calcular pulsatilidad desde la señal filtrada
      const pulsatility = this.calculatePulsatility();
      this.lastRGB.pulsatility = pulsatility;
      
      // 5. Actualizar estadísticas RGB para SpO2
      this.updateRGBStats();
      
      // 6. Calcular calidad basada solo en características de señal
      const quality = this.calculateSignalQuality(pulsatility);
      
      // 7. Log de diagnóstico cada 3 segundos
      if (this.frameCount % 90 === 0) {
        console.log(`📊 PPG: R=${redValue.toFixed(1)}, pulsatility=${(pulsatility * 100).toFixed(2)}%, quality=${quality}%`);
      }
      
      // 8. Emitir señal procesada - SIEMPRE
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: filtered,
        quality: quality,
        fingerDetected: true, // Siempre true, no hay validación
        roi: roi,
        perfusionIndex: pulsatility * 100,
        diagnostics: {
          message: `Pulsatility: ${(pulsatility * 100).toFixed(2)}%`,
          hasPulsatility: pulsatility > 0.002,
          pulsatilityValue: pulsatility
        }
      };

      this.onSignalReady(processedSignal);
    } catch (error) {
      // Error silenciado para rendimiento
    }
  }

  /**
   * Calcula pulsatilidad de la señal (AC/DC ratio)
   */
  private calculatePulsatility(): number {
    if (this.filteredBuffer.length < 30) return 0;
    
    const recent = this.filteredBuffer.slice(-30);
    const rawRecent = this.rawRedBuffer.slice(-30);
    
    // AC = desviación estándar de señal filtrada
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const ac = Math.sqrt(variance);
    
    // DC = media del canal rojo crudo
    const dc = rawRecent.reduce((a, b) => a + b, 0) / rawRecent.length;
    
    if (dc === 0) return 0;
    
    return ac / dc;
  }

  /**
   * Calcula calidad basada en características de señal
   */
  private calculateSignalQuality(pulsatility: number): number {
    // Señal sin pulsatilidad = baja calidad
    if (pulsatility < 0.001) return 5;
    
    // Rango típico de pulsatilidad PPG: 0.5% - 10%
    let quality = 0;
    
    if (pulsatility >= 0.002 && pulsatility <= 0.15) {
      // Buena pulsatilidad
      quality = 50 + Math.min(50, pulsatility * 500);
    } else if (pulsatility > 0.15) {
      // Demasiada variación = ruido o movimiento
      quality = Math.max(10, 80 - (pulsatility - 0.15) * 300);
    } else {
      // Muy baja pulsatilidad
      quality = Math.min(30, pulsatility * 5000);
    }
    
    return Math.round(Math.min(100, Math.max(0, quality)));
  }

  /**
   * Actualiza estadísticas RGB para SpO2
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
