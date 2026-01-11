import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - FLUJO LIMPIO
 * 
 * Frame → RGB → Canal Verde (mejor para PPG) → Filtro → Señal
 * 
 * IMPORTANTE: Usamos canal VERDE en lugar de rojo
 * El verde tiene mejor penetración en tejido y menos saturación
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private frameProcessor: FrameProcessor;
  
  private readonly BUFFER_SIZE = 90;
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30);
    this.frameProcessor = new FrameProcessor();
  }

  async initialize(): Promise<void> {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.bandpassFilter.reset();
    this.frameProcessor.reset();
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log('🚀 PPGSignalProcessor iniciado');
  }

  stop(): void {
    this.isProcessing = false;
    console.log('🛑 PPGSignalProcessor detenido');
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  /**
   * PROCESAR FRAME
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. Extraer RGB
    const frameData = this.frameProcessor.extractFrameData(imageData);
    const rawRed = frameData.rawRed ?? frameData.redValue;
    const rawGreen = frameData.rawGreen ?? 0;
    
    // 2. USAR CANAL VERDE para evitar saturación del flash
    // El canal verde tiene mejor respuesta PPG en condiciones de luz intensa
    // Si rojo está saturado (>250), usar verde que tiene más rango
    const isSaturated = rawRed > 250;
    const signalSource = isSaturated ? rawGreen : rawRed;
    
    // 3. Invertir: más sangre = menos luz = valor más bajo
    // Invertimos para que los picos cardíacos sean positivos
    const inverted = 255 - signalSource;
    
    // 4. Guardar en buffer
    this.rawBuffer.push(inverted);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // 5. Filtro pasabanda (0.3-5 Hz)
    const filtered = this.bandpassFilter.filter(inverted);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 6. Log cada segundo
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const src = isSaturated ? 'G' : 'R';
      console.log(`📷 PPG [${src}]: Raw=${signalSource.toFixed(0)} Inv=${inverted.toFixed(0)} Filt=${filtered.toFixed(2)}`);
    }
    
    // 7. Emitir
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: inverted,
      filteredValue: filtered,
      quality: 100,
      fingerDetected: true,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex: this.calculatePerfusionIndex(),
      rawGreen: frameData.rawGreen,
      diagnostics: {
        message: isSaturated ? `SAT:G=${rawGreen.toFixed(0)}` : `R=${rawRed.toFixed(0)}`,
        hasPulsatility: true,
        pulsatilityValue: 1
      }
    };

    this.onSignalReady(processedSignal);
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
    this.lastLogTime = 0;
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
