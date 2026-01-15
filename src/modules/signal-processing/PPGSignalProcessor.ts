import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

/**
 * PROCESADOR PPG - ALGORITMOS CIENTÍFICOS VALIDADOS
 * 
 * BASADO EN:
 * - Nature 2022: Señal ponderada 0.67*R + 0.33*G
 * - Biomedical Optics 2023: Filtro Savitzky-Golay para preservar forma de onda
 * - MDPI Sensors 2024: Cálculo AC/DC separado por canal para SpO2
 * 
 * FLUJO:
 * Frame → RGB → Señal Ponderada → Savitzky-Golay → Bandpass → Señal PPG
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  
  // Buffers
  private readonly BUFFER_SIZE = 150; // 5 segundos @ 30fps
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  
  // Estadísticas AC/DC para SpO2 - SEPARADAS POR CANAL
  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;
  
  // Filtro Savitzky-Golay (coeficientes para window=7, order=2)
  private readonly SG_COEFFS = [-2, 3, 6, 7, 6, 3, -2];
  private readonly SG_NORM = 21;
  
  // Control de logging
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  
  // Detección de dedo
  private fingerDetected: boolean = false;
  private signalQuality: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    // Filtro pasabanda: 0.5-4Hz (30-240 BPM)
    this.bandpassFilter = new BandpassFilter(30);
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor - Algoritmo ponderado 0.67R+0.33G + Savitzky-Golay');
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
   * FILTRO SAVITZKY-GOLAY
   * Mejor preservación de forma de onda que moving average
   */
  private applySavitzkyGolay(values: number[]): number {
    if (values.length < 7) return values[values.length - 1] || 0;
    
    const recent = values.slice(-7);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      sum += this.SG_COEFFS[i] * recent[i];
    }
    return sum / this.SG_NORM;
  }

  /**
   * PROCESAR FRAME - SEÑAL PONDERADA 0.67R + 0.33G
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. EXTRAER RGB DE ROI CENTRAL (85% del área para comodidad)
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // 2. GUARDAR EN BUFFERS SEPARADOS
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
    
    // 3. DETECCIÓN DE DEDO
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue);
    
    // 4. CALCULAR AC/DC POR CANAL SEPARADO (para SpO2)
    if (this.redBuffer.length >= 30) {
      this.calculateSeparateACDC();
    }
    
    // 5. SEÑAL PONDERADA: 0.67*R + 0.33*G (Nature 2022)
    const weightedSignal = 0.67 * rawRed + 0.33 * rawGreen;
    
    // 6. INVERTIR: más sangre = menos luz reflejada
    const inverted = 255 - weightedSignal;
    
    // 7. APLICAR SAVITZKY-GOLAY ANTES DEL BANDPASS
    this.rawBuffer.push(inverted);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    const smoothed = this.applySavitzkyGolay(this.rawBuffer);
    
    // 8. FILTRO PASABANDA (0.5-4 Hz)
    const filtered = this.bandpassFilter.filter(smoothed);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 9. CALCULAR CALIDAD DE SEÑAL
    this.signalQuality = this.calculateSignalQuality();
    
    // 10. LOG CADA SEGUNDO
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const R = this.getSpO2Ratio();
      console.log(`📷 PPG: R=${rawRed.toFixed(0)} G=${rawGreen.toFixed(0)} W=${weightedSignal.toFixed(0)} Q=${this.signalQuality.toFixed(0)}% SpO2_R=${R.toFixed(3)}`);
    }
    
    // 11. CALCULAR ÍNDICE DE PERFUSIÓN
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // 12. EMITIR SEÑAL PROCESADA
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: inverted,
      filteredValue: filtered,
      quality: this.signalQuality,
      fingerDetected: this.fingerDetected,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      // Agregar datos de amplitud de señal para cálculos externos
      signalAmplitude: this.redAC + this.greenAC,
      diagnostics: {
        message: `R:${rawRed.toFixed(0)} G:${rawGreen.toFixed(0)} PI:${perfusionIndex.toFixed(2)} SpO2_R:${this.getSpO2Ratio().toFixed(2)}`,
        hasPulsatility: perfusionIndex > 0.1,
        pulsatilityValue: perfusionIndex
      }
    };

    this.onSignalReady(processedSignal);
  }
  
  /**
   * EXTRAER RGB DE REGIÓN AMPLIA (85%)
   */
  private extractROI(imageData: ImageData): { rawRed: number; rawGreen: number; rawBlue: number } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // ROI amplia - 85% del área para mayor comodidad
    const roiSize = Math.min(width, height) * 0.85;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let count = 0;
    
    // Muestrear cada 4 píxeles para velocidad
    for (let y = startY; y < endY; y += 4) {
      for (let x = startX; x < endX; x += 4) {
        const i = (y * width + x) * 4;
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        count++;
      }
    }
    
    return {
      rawRed: count > 0 ? redSum / count : 0,
      rawGreen: count > 0 ? greenSum / count : 0,
      rawBlue: count > 0 ? blueSum / count : 0
    };
  }
  
  /**
   * DETECCIÓN DE DEDO PERMISIVA
   */
  private detectFinger(rawRed: number, rawGreen: number, rawBlue: number): boolean {
    const redMinThreshold = 40;
    const redMaxThreshold = 255;
    const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
    
    // Rango amplio: 0.9-3.0
    const validRatio = rgRatio > 0.9 && rgRatio < 3.0;
    const validRed = rawRed > redMinThreshold && rawRed < redMaxThreshold;
    const notFullySaturated = rawRed < 254 || rawGreen < 254;
    const hasEnoughLight = rawRed > 30 && rawGreen > 20;
    
    return (validRatio && validRed && notFullySaturated) || (hasEnoughLight && validRed);
  }
  
  /**
   * CALCULAR AC/DC SEPARADO POR CANAL - CRÍTICO PARA SpO2
   */
  private calculateSeparateACDC(): void {
    if (this.redBuffer.length < 60 || this.greenBuffer.length < 60) return;
    
    const recent = 60; // 2 segundos
    const redRecent = this.redBuffer.slice(-recent);
    const greenRecent = this.greenBuffer.slice(-recent);
    
    // DC = promedio (baseline)
    this.redDC = redRecent.reduce((a, b) => a + b, 0) / redRecent.length;
    this.greenDC = greenRecent.reduce((a, b) => a + b, 0) / greenRecent.length;
    
    // AC = amplitud pico a pico (componente pulsátil)
    this.redAC = Math.max(...redRecent) - Math.min(...redRecent);
    this.greenAC = Math.max(...greenRecent) - Math.min(...greenRecent);
  }
  
  /**
   * CALCULAR CALIDAD DE SEÑAL
   */
  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 30) return 0;
    if (!this.fingerDetected) return 0;
    
    const recent = this.filteredBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    if (range < 0.5) return 10;
    
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    const snr = range / (stdDev + 0.01);
    const quality = Math.min(100, Math.max(0, snr * 15));
    
    return quality;
  }
  
  /**
   * ÍNDICE DE PERFUSIÓN: AC/DC * 100
   */
  private calculatePerfusionIndex(): number {
    if (this.greenDC === 0) return 0;
    return (this.greenAC / this.greenDC) * 100;
  }
  
  /**
   * RATIO SpO2 CRUDO: R = (AC_red/DC_red) / (AC_green/DC_green)
   * Fórmula científica directa
   */
  getSpO2Ratio(): number {
    if (this.redDC < 5 || this.greenDC < 5) return 0;
    if (this.redAC < 0.1 || this.greenAC < 0.1) return 0;
    
    const ratioRed = this.redAC / this.redDC;
    const ratioGreen = this.greenAC / this.greenDC;
    
    if (ratioGreen < 0.0001) return 0;
    
    return ratioRed / ratioGreen;
  }
  
  /**
   * OBTENER DATOS PARA CÁLCULO EXTERNO DE SpO2
   */
  getSpO2RatioData(): { R: number; redAC: number; redDC: number; greenAC: number; greenDC: number } {
    return {
      R: this.getSpO2Ratio(),
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC
    };
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.fingerDetected = false;
    this.signalQuality = 0;
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.bandpassFilter.reset();
  }

  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0
    };
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
