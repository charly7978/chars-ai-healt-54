import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - MODO SIMPLE
 * 
 * Flujo directo:
 * Frame → Extracción RGB → Filtro Pasabanda → Señal
 * 
 * SIN calibración, SIN detección de dedo
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private frameProcessor: FrameProcessor;
  
  private readonly BUFFER_SIZE = 90;
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  
  private frameCount: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30); // 30 fps
    this.frameProcessor = new FrameProcessor();
  }

  async initialize(): Promise<void> {
    this.rawBuffer = [];
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
  }

  async calibrate(): Promise<boolean> {
    return true; // Sin calibración
  }

  /**
   * PROCESAMIENTO DIRECTO - Sin validaciones
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. Extraer RGB crudo
    const frameData = this.frameProcessor.extractFrameData(imageData);
    const rawRed = frameData.rawRed ?? frameData.redValue;
    
    // 2. Guardar valor crudo
    this.rawBuffer.push(rawRed);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // 3. Aplicar filtro pasabanda (0.5-4 Hz = 30-240 BPM)
    const filtered = this.bandpassFilter.filter(rawRed);
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 4. Calcular calidad simple basada en variación
    const quality = this.calculateSimpleQuality();
    
    // 5. Emitir señal
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: rawRed,
      filteredValue: filtered,
      quality,
      fingerDetected: true,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex: this.calculatePerfusionIndex(),
      rawGreen: frameData.rawGreen,
      diagnostics: {
        message: `R=${rawRed.toFixed(0)} F=${filtered.toFixed(1)}`,
        hasPulsatility: quality > 20,
        pulsatilityValue: quality / 100
      }
    };

    this.onSignalReady(processedSignal);
  }
  
  private calculateSimpleQuality(): number {
    if (this.filteredBuffer.length < 30) return 10;
    
    const recent = this.filteredBuffer.slice(-30);
    const range = Math.max(...recent) - Math.min(...recent);
    
    // Calidad basada en el rango de la señal filtrada
    // Rango típico PPG: 0.5-20
    if (range < 0.5) return 5;
    if (range > 50) return 30; // Mucho ruido
    
    return Math.min(100, Math.round(range * 5));
  }
  
  private calculatePerfusionIndex(): number {
    const stats = this.frameProcessor.getRGBStats();
    if (stats.redDC === 0) return 0;
    return (stats.redAC / stats.redDC) * 100;
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.frameCount = 0;
    this.bandpassFilter.reset();
    this.frameProcessor.reset();
  }

  getRGBStats() {
    return this.frameProcessor.getRGBStats();
  }

  getLastNSamples(n: number): number[] {
    return this.filteredBuffer.slice(-n);
  }
  
  getRawBuffer(): number[] {
    return [...this.rawBuffer];
  }
  
  getFilteredBuffer(): number[] {
    return [...this.filteredBuffer];
  }
}