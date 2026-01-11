import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - FLUJO ÚNICO Y LIMPIO
 * 
 * CADENA DE PROCESAMIENTO:
 * Frame → Extracción Rojo → Inversión → Filtro Pasabanda → Señal
 * 
 * NO hay filtros duplicados
 * NO hay detección de calidad (entrada directa)
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
    this.bandpassFilter = new BandpassFilter(30); // 30 FPS
    this.frameProcessor = new FrameProcessor();
  }

  async initialize(): Promise<void> {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.frameCount = 0;
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
   * PROCESAR UN FRAME DE IMAGEN
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. Extraer valores RGB crudos
    const frameData = this.frameProcessor.extractFrameData(imageData);
    const rawRed = frameData.rawRed ?? frameData.redValue;
    
    // 2. INVERTIR señal: más sangre = menos luz reflejada = valor más bajo
    // Al invertir, los latidos serán picos positivos
    const invertedRed = 255 - rawRed;
    
    // 3. Guardar valor crudo (invertido)
    this.rawBuffer.push(invertedRed);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // 4. Aplicar filtro pasabanda (0.3-5 Hz)
    // Elimina DC (iluminación base) y ruido de alta frecuencia
    const filtered = this.bandpassFilter.filter(invertedRed);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 5. Log cada segundo
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      console.log(`📷 PPG: Raw=${rawRed.toFixed(0)} Inv=${invertedRed.toFixed(0)} Filt=${filtered.toFixed(3)} Frames=${this.frameCount}`);
    }
    
    // 6. Emitir señal procesada
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: invertedRed,
      filteredValue: filtered, // Este valor va al HeartBeatProcessor
      quality: 100,
      fingerDetected: true,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex: this.calculatePerfusionIndex(),
      rawGreen: frameData.rawGreen,
      diagnostics: {
        message: `R=${rawRed.toFixed(0)} F=${filtered.toFixed(3)}`,
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
