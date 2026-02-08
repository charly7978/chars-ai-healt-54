import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { SignalQualityAnalyzer, SignalQualityResult } from './SignalQualityAnalyzer';

/**
 * =========================================================================
 * PROCESADOR PPG PROFESIONAL - ARQUITECTURA COMPLETA
 * =========================================================================
 * 
 * PIPELINE:
 * 1. Extracción ROI 85%
 * 2. Detección de dedo robusta
 * 3. Selección de canal inteligente (Verde/Rojo)
 * 4. Detrending (remover deriva lenta)
 * 5. Filtro pasabanda Butterworth 0.5-4Hz
 * 6. Cálculo AC/DC profesional (TI SLAA655)
 * 7. Derivadas VPG/APG
 * 8. Análisis de calidad (SQI)
 * 
 * Referencia: De Haan & Jeanne 2013, Elgendi 2012, TI SLAA655
 * =========================================================================
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private qualityAnalyzer: SignalQualityAnalyzer;
  
  // Buffers
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  private readonly ACDC_WINDOW = 120; // 4 segundos para AC/DC
  private readonly DETREND_WINDOW = 150; // 5 segundos para detrending
  
  private rawBuffer: number[] = [];
  private detrendedBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private vpgBuffer: number[] = []; // Primera derivada
  private apgBuffer: number[] = []; // Segunda derivada
  
  // Estadísticas para SpO2 - calculadas con ventana larga
  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;
  
  // Detección de dedo
  private fingerDetected: boolean = false;
  private fingerStableFrames: number = 0;
  private readonly FINGER_STABLE_REQUIRED = 5; // 5 frames consecutivos
  
  // Calidad de señal
  private signalQuality: number = 0;
  private lastQualityResult: SignalQualityResult | null = null;
  
  // Control de logging
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30);
    this.qualityAnalyzer = new SignalQualityAnalyzer();
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor inicializado - Pipeline Profesional');
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
   * PROCESAR FRAME - PIPELINE PROFESIONAL COMPLETO
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // ===== 1. EXTRAER RGB DE ROI CENTRAL (85%) =====
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // ===== 2. GUARDAR EN BUFFERS RGB =====
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
    
    // ===== 3. DETECCIÓN DE DEDO ROBUSTA =====
    const fingerNow = this.detectFingerRobust(rawRed, rawGreen, rawBlue);
    
    // Validación temporal (5 frames consecutivos)
    if (fingerNow) {
      this.fingerStableFrames++;
    } else {
      this.fingerStableFrames = 0;
    }
    
    this.fingerDetected = this.fingerStableFrames >= this.FINGER_STABLE_REQUIRED;
    
    // ===== 4. CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS =====
    if (this.redBuffer.length >= 60) {
      this.calculateACDCProfessional();
    }
    
    // ===== 5. SELECCIÓN DE CANAL INTELIGENTE =====
    // Verde tiene mejor SNR para PPG contacto
    // Solo usar Rojo si verde está saturado (>250)
    const greenSaturated = rawGreen > 250;
    const signalSource = greenSaturated ? rawRed : rawGreen;
    
    // ===== 6. GUARDAR EN BUFFER RAW =====
    this.rawBuffer.push(signalSource);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // ===== 7. DETRENDING (remover deriva lenta) =====
    const detrended = this.applyDetrending(signalSource);
    
    this.detrendedBuffer.push(detrended);
    if (this.detrendedBuffer.length > this.BUFFER_SIZE) {
      this.detrendedBuffer.shift();
    }
    
    // ===== 8. FILTRO PASABANDA 0.5-4Hz =====
    const filtered = this.bandpassFilter.filter(detrended);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // ===== 9. CALCULAR DERIVADAS VPG y APG =====
    this.calculateDerivatives();
    
    // ===== 10. ANÁLISIS DE CALIDAD DE SEÑAL (SQI) =====
    const qualityResult = this.qualityAnalyzer.analyze(
      signalSource,
      filtered,
      timestamp,
      { red: rawRed, green: rawGreen, blue: rawBlue }
    );
    
    this.signalQuality = qualityResult.quality;
    this.lastQualityResult = qualityResult;
    
    // ===== 11. LOG CADA SEGUNDO =====
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const src = greenSaturated ? 'R' : 'G';
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      const confidence = qualityResult.confidenceLevel;
      console.log(`📷 PPG [${src}]: Raw=${signalSource.toFixed(0)} Filt=${filtered.toFixed(2)} Q=${this.signalQuality}% [${confidence}] PI=${(this.greenAC/this.greenDC*100).toFixed(2)}% ${fingerStatus}`);
    }
    
    // ===== 12. CALCULAR ÍNDICE DE PERFUSIÓN =====
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // ===== 13. EMITIR SEÑAL PROCESADA =====
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
   * DETECCIÓN DE DEDO ROBUSTA
   * Criterios profesionales basados en literatura 2024-2025
   */
  private detectFingerRobust(rawRed: number, rawGreen: number, rawBlue: number): boolean {
    // Criterio 1: Nivel de rojo mínimo (flash encendido = dedo debe reflejar mucho rojo)
    const redMinThreshold = 80; // Más estricto que antes
    const validRed = rawRed >= redMinThreshold;
    
    // Criterio 2: Ratio R/G típico para piel con flash
    const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
    const validRatio = rgRatio >= 1.0 && rgRatio <= 4.0;
    
    // Criterio 3: No saturación (debe poder capturar variaciones)
    const notSaturated = rawRed < 253 && rawGreen < 253;
    
    // Criterio 4: Luminosidad mínima (evitar lecturas en oscuridad)
    const hasLight = rawRed > 30 && rawGreen > 20;
    
    // Criterio 5: Diferencia R-G característica
    const rgDiff = rawRed - rawGreen;
    const validDiff = rgDiff > 10 && rgDiff < 180;
    
    // Todos los criterios principales deben cumplirse
    return validRed && validRatio && notSaturated && hasLight && validDiff;
  }
  
  /**
   * DETRENDING - Remover deriva lenta
   * Resta la media móvil de 5 segundos
   */
  private applyDetrending(value: number): number {
    if (this.rawBuffer.length < 30) {
      return value;
    }
    
    // Media móvil larga para estimar tendencia
    const windowSize = Math.min(this.DETREND_WINDOW, this.rawBuffer.length);
    const window = this.rawBuffer.slice(-windowSize);
    const movingAvg = window.reduce((a, b) => a + b, 0) / window.length;
    
    // Restar tendencia pero mantener media en rango razonable
    return value - movingAvg + 128; // Centrar en 128
  }
  
  /**
   * CALCULAR AC/DC CON MÉTODO PROFESIONAL
   * Basado en Texas Instruments SLAA655
   */
  private calculateACDCProfessional(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 60) return;
    
    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);
    
    // === DC = Promedio (componente no pulsátil) ===
    this.redDC = redWindow.reduce((a, b) => a + b, 0) / redWindow.length;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / greenWindow.length;
    
    // Protección contra DC muy bajo
    if (this.redDC < 5 || this.greenDC < 5) return;
    
    // === AC = RMS de señal centrada * sqrt(2) ===
    // Esto es más preciso que pico-a-pico según TI
    let redSumSq = 0;
    let greenSumSq = 0;
    
    for (let i = 0; i < windowSize; i++) {
      redSumSq += Math.pow(redWindow[i] - this.redDC, 2);
      greenSumSq += Math.pow(greenWindow[i] - this.greenDC, 2);
    }
    
    const redRMS = Math.sqrt(redSumSq / windowSize);
    const greenRMS = Math.sqrt(greenSumSq / windowSize);
    
    // AC = RMS * sqrt(2) para señal sinusoidal equivalente
    this.redAC = redRMS * Math.sqrt(2);
    this.greenAC = greenRMS * Math.sqrt(2);
    
    // === VALIDACIÓN: Usar también percentiles como check ===
    const sortedRed = [...redWindow].sort((a, b) => a - b);
    const sortedGreen = [...greenWindow].sort((a, b) => a - b);
    
    const p5 = Math.floor(windowSize * 0.05);
    const p95 = Math.floor(windowSize * 0.95);
    
    const redP2P = sortedRed[p95] - sortedRed[p5];
    const greenP2P = sortedGreen[p95] - sortedGreen[p5];
    
    // Promediar RMS y P2P para robustez
    this.redAC = (this.redAC + redP2P * 0.5) / 2;
    this.greenAC = (this.greenAC + greenP2P * 0.5) / 2;
    
    // Validación: PI muy bajo indica señal débil
    const redPI = this.redAC / this.redDC;
    const greenPI = this.greenAC / this.greenDC;
    
    if (redPI < 0.0005 || greenPI < 0.0005) {
      // Señal muy débil
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
   * Para uso en cálculo de SpO2
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
  
  /**
   * OBTENER RESULTADO DE CALIDAD
   */
  getQualityResult(): SignalQualityResult | null {
    return this.lastQualityResult;
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
  
  getDetrendedBuffer(): number[] {
    return [...this.detrendedBuffer];
  }
}
