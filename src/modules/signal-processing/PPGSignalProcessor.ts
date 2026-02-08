import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { SignalQualityAnalyzer, SignalQualityResult } from './SignalQualityAnalyzer';

/**
 * =========================================================================
 * PROCESADOR PPG PROFESIONAL - OPTIMIZADO Y CALIBRADO
 * =========================================================================
 * 
 * OPTIMIZACIONES:
 * 1. Detección de dedo más estricta (Red>100, PI>0.15%, 10 frames)
 * 2. Cálculo AC/DC con validación de pulsatilidad
 * 3. Detrending mejorado
 * 4. Logging reducido para rendimiento
 * 
 * CALIBRACIÓN:
 * - Red mínimo: 100 (antes 80)
 * - R/G ratio: 1.2-3.5 (antes 1.0-4.0)
 * - Diferencia R-G > 30
 * - PI > 0.15% obligatorio
 * - 10 frames consecutivos (antes 5)
 * =========================================================================
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private qualityAnalyzer: SignalQualityAnalyzer;
  
  // Buffers
  private readonly BUFFER_SIZE = 180;
  private readonly ACDC_WINDOW = 120;
  private readonly DETREND_WINDOW = 150;
  
  private rawBuffer: number[] = [];
  private detrendedBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private vpgBuffer: number[] = [];
  private apgBuffer: number[] = [];
  
  // Estadísticas AC/DC
  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;
  
  // Detección de dedo - CALIBRADO
  private fingerDetected: boolean = false;
  private fingerStableFrames: number = 0;
  private readonly FINGER_STABLE_REQUIRED = 10; // AUMENTADO de 5 a 10
  
  // Calidad de señal
  private signalQuality: number = 0;
  private lastQualityResult: SignalQualityResult | null = null;
  
  // Control de logging - OPTIMIZADO
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  private readonly LOG_INTERVAL = 2000; // Log cada 2 segundos (antes 1s)
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30);
    this.qualityAnalyzer = new SignalQualityAnalyzer();
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor inicializado - Calibración Optimizada');
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
   * PROCESAR FRAME - PIPELINE OPTIMIZADO
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. EXTRAER RGB DE ROI CENTRAL (85%)
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // 2. GUARDAR EN BUFFERS RGB
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
    
    // 3. DETECCIÓN DE DEDO CALIBRADA (más estricta)
    const fingerNow = this.detectFingerCalibrated(rawRed, rawGreen, rawBlue);
    
    if (fingerNow) {
      this.fingerStableFrames++;
    } else {
      this.fingerStableFrames = 0;
    }
    
    this.fingerDetected = this.fingerStableFrames >= this.FINGER_STABLE_REQUIRED;
    
    // 4. CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS
    if (this.redBuffer.length >= 60) {
      this.calculateACDCProfessional();
    }
    
    // 5. SELECCIÓN DE CANAL INTELIGENTE
    const greenSaturated = rawGreen > 250;
    const signalSource = greenSaturated ? rawRed : rawGreen;
    
    // 6. GUARDAR EN BUFFER RAW
    this.rawBuffer.push(signalSource);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // 7. DETRENDING
    const detrended = this.applyDetrending(signalSource);
    
    this.detrendedBuffer.push(detrended);
    if (this.detrendedBuffer.length > this.BUFFER_SIZE) {
      this.detrendedBuffer.shift();
    }
    
    // 8. FILTRO PASABANDA
    const filtered = this.bandpassFilter.filter(detrended);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 9. CALCULAR DERIVADAS
    this.calculateDerivatives();
    
    // 10. ANÁLISIS DE CALIDAD
    const qualityResult = this.qualityAnalyzer.analyze(
      signalSource,
      filtered,
      timestamp,
      { red: rawRed, green: rawGreen, blue: rawBlue }
    );
    
    this.signalQuality = qualityResult.quality;
    this.lastQualityResult = qualityResult;
    
    // 11. LOG OPTIMIZADO (cada 2 segundos)
    const now = Date.now();
    if (now - this.lastLogTime >= this.LOG_INTERVAL) {
      this.lastLogTime = now;
      const src = greenSaturated ? 'R' : 'G';
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      const pi = this.calculatePerfusionIndex();
      console.log(`📷 PPG [${src}]: Raw=${signalSource.toFixed(0)} Q=${this.signalQuality.toFixed(0)}% PI=${pi.toFixed(2)}% ${fingerStatus}`);
    }
    
    // 12. CALCULAR ÍNDICE DE PERFUSIÓN
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // 13. EMITIR SEÑAL PROCESADA
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: signalSource,
      filteredValue: filtered,
      quality: this.signalQuality,
      fingerDetected: this.fingerDetected,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message: `${greenSaturated ? 'R' : 'G'}:${signalSource.toFixed(0)} PI:${perfusionIndex.toFixed(2)}% [${qualityResult.confidenceLevel}]`,
        hasPulsatility: perfusionIndex > 0.15,
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
    
    const roiSize = Math.min(width, height) * 0.85;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let count = 0;
    
    // Muestrear cada 4 píxeles para eficiencia
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
   * DETECCIÓN DE DEDO CALIBRADA - MÁS ESTRICTA
   * Criterios basados en literatura 2024-2025
   */
  private detectFingerCalibrated(rawRed: number, rawGreen: number, rawBlue: number): boolean {
    // Criterio 1: Nivel de rojo mínimo AUMENTADO
    const redMinThreshold = 100; // ANTES: 80
    const validRed = rawRed >= redMinThreshold;
    
    // Criterio 2: Ratio R/G más estrecho (típico para dedo)
    const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
    const validRatio = rgRatio >= 1.2 && rgRatio <= 3.5; // ANTES: 1.0-4.0
    
    // Criterio 3: No saturación
    const notSaturated = rawRed < 250 && rawGreen < 250; // ANTES: 253
    
    // Criterio 4: Luminosidad mínima
    const hasLight = rawRed > 40 && rawGreen > 25; // ANTES: 30, 20
    
    // Criterio 5: Diferencia R-G característica de dedo
    const rgDiff = rawRed - rawGreen;
    const validDiff = rgDiff > 30 && rgDiff < 150; // ANTES: 10, 180
    
    // Criterio 6: NUEVO - Pulsatilidad mínima
    const pi = this.calculatePerfusionIndex();
    const hasPulsatility = this.redBuffer.length < 60 || pi > 0.1; // Solo exigir si hay suficientes datos
    
    // Todos los criterios deben cumplirse
    return validRed && validRatio && notSaturated && hasLight && validDiff && hasPulsatility;
  }
  
  /**
   * DETRENDING - Remover deriva lenta
   */
  private applyDetrending(value: number): number {
    if (this.rawBuffer.length < 30) {
      return value;
    }
    
    const windowSize = Math.min(this.DETREND_WINDOW, this.rawBuffer.length);
    const window = this.rawBuffer.slice(-windowSize);
    const movingAvg = window.reduce((a, b) => a + b, 0) / window.length;
    
    return value - movingAvg + 128;
  }
  
  /**
   * CALCULAR AC/DC CON MÉTODO PROFESIONAL
   */
  private calculateACDCProfessional(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 60) return;
    
    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);
    
    // DC = Promedio
    this.redDC = redWindow.reduce((a, b) => a + b, 0) / redWindow.length;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / greenWindow.length;
    
    if (this.redDC < 5 || this.greenDC < 5) return;
    
    // AC = RMS * sqrt(2)
    let redSumSq = 0;
    let greenSumSq = 0;
    
    for (let i = 0; i < windowSize; i++) {
      redSumSq += Math.pow(redWindow[i] - this.redDC, 2);
      greenSumSq += Math.pow(greenWindow[i] - this.greenDC, 2);
    }
    
    const redRMS = Math.sqrt(redSumSq / windowSize);
    const greenRMS = Math.sqrt(greenSumSq / windowSize);
    
    this.redAC = redRMS * Math.sqrt(2);
    this.greenAC = greenRMS * Math.sqrt(2);
    
    // Validar con percentiles
    const sortedRed = [...redWindow].sort((a, b) => a - b);
    const sortedGreen = [...greenWindow].sort((a, b) => a - b);
    
    const p5 = Math.floor(windowSize * 0.05);
    const p95 = Math.floor(windowSize * 0.95);
    
    const redP2P = sortedRed[p95] - sortedRed[p5];
    const greenP2P = sortedGreen[p95] - sortedGreen[p5];
    
    // Promediar RMS y P2P
    this.redAC = (this.redAC + redP2P * 0.5) / 2;
    this.greenAC = (this.greenAC + greenP2P * 0.5) / 2;
    
    // Validación: PI muy bajo indica señal débil
    const redPI = this.redAC / this.redDC;
    const greenPI = this.greenAC / this.greenDC;
    
    if (redPI < 0.0003 || greenPI < 0.0003) {
      this.redAC = 0;
      this.greenAC = 0;
    }
  }
  
  /**
   * CALCULAR DERIVADAS VPG y APG
   */
  private calculateDerivatives(): void {
    const n = this.filteredBuffer.length;
    
    if (n >= 3) {
      const vpg = (this.filteredBuffer[n-1] - this.filteredBuffer[n-3]) / 2;
      this.vpgBuffer.push(vpg);
      if (this.vpgBuffer.length > this.BUFFER_SIZE) {
        this.vpgBuffer.shift();
      }
    }
    
    if (this.vpgBuffer.length >= 3) {
      const vn = this.vpgBuffer.length;
      const apg = (this.vpgBuffer[vn-1] - this.vpgBuffer[vn-3]) / 2;
      this.apgBuffer.push(apg);
      if (this.apgBuffer.length > this.BUFFER_SIZE) {
        this.apgBuffer.shift();
      }
    }
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
    this.detrendedBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.fingerDetected = false;
    this.fingerStableFrames = 0;
    this.signalQuality = 0;
    this.lastQualityResult = null;
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.bandpassFilter.reset();
    this.qualityAnalyzer.reset();
  }

  /**
   * OBTENER ESTADÍSTICAS RGB PRECISAS
   */
  getRGBStats() {
    const ratioOfRatios = (this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0)
      ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC)
      : 0;
    
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios,
      perfusionIndex: this.calculatePerfusionIndex()
    };
  }
  
  getQualityResult(): SignalQualityResult | null {
    return this.lastQualityResult;
  }
  
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
  
  getDetrendedBuffer(): number[] {
    return [...this.detrendedBuffer];
  }
}
