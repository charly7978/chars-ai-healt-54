import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

/**
 * PROCESADOR PPG OPTIMIZADO - BAJO CONSUMO DE MEMORIA
 * 
 * Optimizaciones:
 * - Buffers reducidos a lo mínimo necesario
 * - Evita spread operators en arrays grandes
 * - Cálculos AC/DC incrementales
 * - Log throttling
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  
  // Buffers REDUCIDOS - solo lo necesario
  private readonly BUFFER_SIZE = 90; // 3 segundos @ 30fps (antes 150)
  private rawBuffer: Float32Array;
  private filteredBuffer: Float32Array;
  private redBuffer: Float32Array;
  private greenBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferCount: number = 0;
  
  // Estadísticas para SpO2 (calculadas incrementalmente)
  private redSum: number = 0;
  private greenSum: number = 0;
  private redMin: number = 255;
  private redMax: number = 0;
  private greenMin: number = 255;
  private greenMax: number = 0;
  
  // Control de logging - muy reducido
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  private readonly LOG_INTERVAL = 2000; // Log cada 2s (antes 1s)
  
  // Detección de dedo
  private fingerDetected: boolean = false;
  private signalQuality: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    // Usar TypedArrays para mejor rendimiento
    this.rawBuffer = new Float32Array(this.BUFFER_SIZE);
    this.filteredBuffer = new Float32Array(this.BUFFER_SIZE);
    this.redBuffer = new Float32Array(this.BUFFER_SIZE);
    this.greenBuffer = new Float32Array(this.BUFFER_SIZE);
    
    this.bandpassFilter = new BandpassFilter(30);
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor inicializado (optimizado)');
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
    return true;
  }

  /**
   * PROCESAR FRAME - OPTIMIZADO
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. EXTRAER RGB
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // 2. ACTUALIZAR BUFFERS (sin shift, O(1))
    const idx = this.bufferIndex;
    
    // Actualizar estadísticas incrementales
    if (this.bufferCount === this.BUFFER_SIZE) {
      // Remover valor antiguo de estadísticas
      const oldRed = this.redBuffer[idx];
      const oldGreen = this.greenBuffer[idx];
      this.redSum -= oldRed;
      this.greenSum -= oldGreen;
    }
    
    this.redBuffer[idx] = rawRed;
    this.greenBuffer[idx] = rawGreen;
    this.redSum += rawRed;
    this.greenSum += rawGreen;
    
    // 3. DETECCIÓN DE DEDO
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue);
    
    // 4. CALCULAR AC/DC (cada 10 frames para optimizar)
    if (this.frameCount % 10 === 0 && this.bufferCount >= 30) {
      this.calculateACDC();
    }
    
    // 5. PROCESAR SEÑAL
    const greenSaturated = rawGreen > 250;
    const signalSource = greenSaturated ? rawRed : rawGreen;
    const inverted = 255 - signalSource;
    
    this.rawBuffer[idx] = inverted;
    
    // 6. FILTRO PASABANDA
    const filtered = this.bandpassFilter.filter(inverted);
    this.filteredBuffer[idx] = filtered;
    
    // 7. AVANZAR ÍNDICE
    this.bufferIndex = (idx + 1) % this.BUFFER_SIZE;
    if (this.bufferCount < this.BUFFER_SIZE) {
      this.bufferCount++;
    }
    
    // 8. CALCULAR CALIDAD (throttled)
    if (this.frameCount % 5 === 0) {
      this.signalQuality = this.calculateSignalQuality();
    }
    
    // 9. LOG REDUCIDO
    const now = Date.now();
    if (now - this.lastLogTime >= this.LOG_INTERVAL) {
      this.lastLogTime = now;
      const src = greenSaturated ? 'R' : 'G';
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      console.log(`📷 PPG [${src}] Q=${this.signalQuality.toFixed(0)}% ${fingerStatus}`);
    }
    
    // 10. ÍNDICE DE PERFUSIÓN
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // 11. EMITIR SEÑAL
    this.onSignalReady({
      timestamp,
      rawValue: inverted,
      filteredValue: filtered,
      quality: this.signalQuality,
      fingerDetected: this.fingerDetected,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message: `${greenSaturated ? 'R' : 'G'}:${signalSource.toFixed(0)}`,
        hasPulsatility: perfusionIndex > 0.1,
        pulsatilityValue: perfusionIndex
      }
    });
  }
  
  /**
   * EXTRAER RGB - OPTIMIZADO
   * Muestreo más espaciado para velocidad
   */
  private extractROI(imageData: ImageData): { rawRed: number; rawGreen: number; rawBlue: number } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // ROI 75% del área
    const roiSize = Math.min(width, height) * 0.75;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let count = 0;
    
    // Muestrear cada 6 píxeles (antes 4)
    const step = 6;
    for (let y = startY; y < endY; y += step) {
      const rowOffset = y * width;
      for (let x = startX; x < endX; x += step) {
        const i = (rowOffset + x) << 2; // Bit shift más rápido que * 4
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        count++;
      }
    }
    
    const invCount = 1 / count;
    return {
      rawRed: redSum * invCount,
      rawGreen: greenSum * invCount,
      rawBlue: blueSum * invCount
    };
  }
  
  private detectFinger(rawRed: number, rawGreen: number, rawBlue: number): boolean {
    const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
    const validRatio = rgRatio > 0.9 && rgRatio < 3.0;
    const validRed = rawRed > 40 && rawRed < 255;
    const notFullySaturated = rawRed < 254 || rawGreen < 254;
    const hasEnoughLight = rawRed > 30 && rawGreen > 20;
    
    return (validRatio && validRed && notFullySaturated) || (hasEnoughLight && validRed);
  }
  
  /**
   * CALCULAR AC/DC - OPTIMIZADO
   * Usa buffers circulares sin crear nuevos arrays
   */
  private calculateACDC(): void {
    this.redMin = 255;
    this.redMax = 0;
    this.greenMin = 255;
    this.greenMax = 0;
    
    // Solo analizar últimos 60 valores (2s)
    const samplesToCheck = Math.min(60, this.bufferCount);
    
    for (let i = 0; i < samplesToCheck; i++) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const r = this.redBuffer[idx];
      const g = this.greenBuffer[idx];
      
      if (r < this.redMin) this.redMin = r;
      if (r > this.redMax) this.redMax = r;
      if (g < this.greenMin) this.greenMin = g;
      if (g > this.greenMax) this.greenMax = g;
    }
  }
  
  private calculateSignalQuality(): number {
    if (this.bufferCount < 30 || !this.fingerDetected) return 0;
    
    // Calcular rango de señal filtrada
    let min = Infinity, max = -Infinity;
    let sum = 0;
    const samplesToCheck = Math.min(60, this.bufferCount);
    
    for (let i = 0; i < samplesToCheck; i++) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const v = this.filteredBuffer[idx];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    
    const range = max - min;
    if (range < 0.5) return 10;
    
    const mean = sum / samplesToCheck;
    let variance = 0;
    
    for (let i = 0; i < samplesToCheck; i++) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const diff = this.filteredBuffer[idx] - mean;
      variance += diff * diff;
    }
    variance /= samplesToCheck;
    
    const stdDev = Math.sqrt(variance);
    const snr = range / (stdDev + 0.01);
    
    return Math.min(100, Math.max(0, snr * 15));
  }
  
  private calculatePerfusionIndex(): number {
    if (this.bufferCount < 30) return 0;
    const greenDC = this.greenSum / this.bufferCount;
    if (greenDC === 0) return 0;
    const greenAC = this.greenMax - this.greenMin;
    return (greenAC / greenDC) * 100;
  }

  reset(): void {
    this.bufferIndex = 0;
    this.bufferCount = 0;
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.fingerDetected = false;
    this.signalQuality = 0;
    this.redSum = 0;
    this.greenSum = 0;
    this.redMin = 255;
    this.redMax = 0;
    this.greenMin = 255;
    this.greenMax = 0;
    this.bandpassFilter.reset();
  }

  getRGBStats() {
    const count = Math.max(1, this.bufferCount);
    return {
      redAC: this.redMax - this.redMin,
      redDC: this.redSum / count,
      greenAC: this.greenMax - this.greenMin,
      greenDC: this.greenSum / count,
      rgRatio: this.greenSum > 0 ? this.redSum / this.greenSum : 0
    };
  }

  getLastNSamples(n: number): number[] {
    const result: number[] = [];
    const count = Math.min(n, this.bufferCount);
    for (let i = 0; i < count; i++) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      result.unshift(this.filteredBuffer[idx]);
    }
    return result;
  }
  
  getRawBuffer(): number[] {
    return Array.from(this.rawBuffer.slice(0, this.bufferCount));
  }
  
  getFilteredBuffer(): number[] {
    return Array.from(this.filteredBuffer.slice(0, this.bufferCount));
  }
}
