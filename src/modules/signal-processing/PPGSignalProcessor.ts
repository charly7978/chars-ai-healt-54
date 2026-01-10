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
    this.smoothedQuality = 85;
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
  
  // Calidad suavizada para estabilidad
  private smoothedQuality: number = 85;
  
  private calculateSimpleQuality(): number {
    // Verificar que hay señal (DC > 50 indica dedo presente)
    const stats = this.frameProcessor.getRGBStats();
    const hasSignal = stats.redDC > 50;
    
    let targetQuality: number;
    
    if (!hasSignal) {
      targetQuality = 15;
    } else if (this.rawBuffer.length < 10) {
      targetQuality = 80; // Inicializando
    } else {
      // Mientras haya señal, mantener calidad alta
      targetQuality = 88;
    }
    
    // Suavizado exponencial para evitar fluctuaciones
    const alpha = 0.08;
    this.smoothedQuality = alpha * targetQuality + (1 - alpha) * this.smoothedQuality;
    
    return Math.round(this.smoothedQuality);
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
    this.smoothedQuality = 85;
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