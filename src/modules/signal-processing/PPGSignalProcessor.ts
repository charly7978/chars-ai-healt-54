import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

/**
 * PROCESADOR PPG OPTIMIZADO - CON DERIVADAS VPG/APG
 * 
 * MEJORAS:
 * 1. Cálculo de AC/DC con ventana de 3-4 segundos
 * 2. Primera derivada (VPG) para detección de picos
 * 3. Segunda derivada (APG) para análisis morfológico
 * 4. Exportación de estadísticas RGB precisas
 * 
 * Referencia: De Haan & Jeanne 2013, Elgendi 2012
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  
  // Buffers ampliados
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  private readonly ACDC_WINDOW = 120; // 4 segundos para AC/DC
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private vpgBuffer: number[] = []; // Primera derivada
  private apgBuffer: number[] = []; // Segunda derivada
  
  // Estadísticas para SpO2 - calculadas con ventana más larga
  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;
  
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
    console.log('✅ PPGSignalProcessor inicializado - Con VPG/APG');
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
   * PROCESAR FRAME - CON CÁLCULO DE DERIVADAS
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. EXTRAER RGB DE ROI CENTRAL (85% del área)
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // 2. GUARDAR EN BUFFERS
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
    
    // 3. DETECCIÓN DE DEDO
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue);
    
    // 4. CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS
    if (this.redBuffer.length >= 60) {
      this.calculateACDCPrecise();
    }
    
    // 5. SELECCIONAR CANAL VERDE
    const greenSaturated = rawGreen > 250;
    const signalSource = greenSaturated ? rawRed : rawGreen;
    
    // 6. INVERTIR SEÑAL
    const inverted = 255 - signalSource;
    
    // 7. GUARDAR EN BUFFER RAW
    this.rawBuffer.push(inverted);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // 8. FILTRO PASABANDA
    const filtered = this.bandpassFilter.filter(inverted);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 9. CALCULAR DERIVADAS
    this.calculateDerivatives();
    
    // 10. CALCULAR CALIDAD DE SEÑAL
    this.signalQuality = this.calculateSignalQuality();
    
    // 11. LOG CADA SEGUNDO
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const src = greenSaturated ? 'R' : 'G';
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      console.log(`📷 PPG [${src}]: Raw=${signalSource.toFixed(0)} Filt=${filtered.toFixed(2)} Q=${this.signalQuality.toFixed(0)}% AC_R=${this.redAC.toFixed(1)} AC_G=${this.greenAC.toFixed(1)} ${fingerStatus}`);
    }
    
    // 12. CALCULAR ÍNDICE DE PERFUSIÓN
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // 13. EMITIR SEÑAL PROCESADA
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
      diagnostics: {
        message: `${greenSaturated ? 'R' : 'G'}:${signalSource.toFixed(0)} PI:${perfusionIndex.toFixed(2)}`,
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
    
    // ROI amplia - 85% del área
    const roiSize = Math.min(width, height) * 0.85;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let count = 0;
    
    // Muestrear cada 4 píxeles
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
    
    const validRatio = rgRatio > 0.9 && rgRatio < 3.0;
    const validRed = rawRed > redMinThreshold && rawRed < redMaxThreshold;
    const notFullySaturated = rawRed < 254 || rawGreen < 254;
    const hasEnoughLight = rawRed > 30 && rawGreen > 20;
    
    return (validRatio && validRed && notFullySaturated) || (hasEnoughLight && validRed);
  }
  
  /**
   * CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS
   * Más preciso para SpO2
   */
  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 60) return;
    
    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);
    
    // DC = promedio (componente continua)
    this.redDC = redWindow.reduce((a, b) => a + b, 0) / redWindow.length;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / greenWindow.length;
    
    // Para AC, usar RMS de la señal filtrada en lugar de pico a pico
    // Esto es más robusto al ruido
    const redMean = this.redDC;
    const greenMean = this.greenDC;
    
    // Calcular variación RMS
    let redRMS = 0;
    let greenRMS = 0;
    
    for (let i = 0; i < windowSize; i++) {
      redRMS += Math.pow(redWindow[i] - redMean, 2);
      greenRMS += Math.pow(greenWindow[i] - greenMean, 2);
    }
    
    redRMS = Math.sqrt(redRMS / windowSize);
    greenRMS = Math.sqrt(greenRMS / windowSize);
    
    // AC como 2 * RMS (aproximación de amplitud pico a pico)
    this.redAC = redRMS * 2;
    this.greenAC = greenRMS * 2;
    
    // También calcular pico a pico para comparación
    const redPeakToPeak = Math.max(...redWindow) - Math.min(...redWindow);
    const greenPeakToPeak = Math.max(...greenWindow) - Math.min(...greenWindow);
    
    // Usar el mayor de los dos métodos
    this.redAC = Math.max(this.redAC, redPeakToPeak * 0.5);
    this.greenAC = Math.max(this.greenAC, greenPeakToPeak * 0.5);
  }
  
  /**
   * CALCULAR DERIVADAS VPG y APG
   */
  private calculateDerivatives(): void {
    const n = this.filteredBuffer.length;
    
    if (n >= 3) {
      // VPG: Primera derivada (velocidad)
      // f'(x) = (f(x+1) - f(x-1)) / 2
      const vpg = (this.filteredBuffer[n-1] - this.filteredBuffer[n-3]) / 2;
      this.vpgBuffer.push(vpg);
      if (this.vpgBuffer.length > this.BUFFER_SIZE) {
        this.vpgBuffer.shift();
      }
    }
    
    if (this.vpgBuffer.length >= 3) {
      // APG: Segunda derivada (aceleración)
      const vn = this.vpgBuffer.length;
      const apg = (this.vpgBuffer[vn-1] - this.vpgBuffer[vn-3]) / 2;
      this.apgBuffer.push(apg);
      if (this.apgBuffer.length > this.BUFFER_SIZE) {
        this.apgBuffer.shift();
      }
    }
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

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
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

  /**
   * OBTENER ESTADÍSTICAS RGB PRECISAS
   * Para uso en cálculo de SpO2
   */
  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      // Ratio R para SpO2: (AC_red/DC_red) / (AC_green/DC_green)
      ratioOfRatios: this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0 
        ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC) 
        : 0
    };
  }
  
  /**
   * Obtener buffers de derivadas
   */
  getVPGBuffer(): number[] {
    return [...this.vpgBuffer];
  }
  
  getAPGBuffer(): number[] {
    return [...this.apgBuffer];
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
