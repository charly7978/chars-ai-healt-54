import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { WinnerTakesAllSelector, WTAResult } from './WinnerTakesAll';

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
  private wtaSelector: WinnerTakesAllSelector;
  
  // Buffers ampliados
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  private readonly ACDC_WINDOW = 120; // 4 segundos para AC/DC
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private vpgBuffer: number[] = []; // Primera derivada
  private apgBuffer: number[] = []; // Segunda derivada
  
  // WTA state
  private lastWTAResult: WTAResult | null = null;
  
  // Estadísticas para SpO2 - calculadas con ventana más larga
  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;
  
  // Control de logging
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  
  // Detección de dedo con histéresis ultra-tolerante
  private fingerDetected: boolean = false;
  private signalQuality: number = 0;
  private fingerConfidenceCount: number = 0;
  private fingerLostCount: number = 0;
  private readonly FINGER_CONFIRM_FRAMES = 3;   // Confirmación rápida
  private readonly FINGER_LOST_FRAMES = 50;     // Ultra tolerante a temblores/reposiciones
  private smoothedRed: number = 0;
  private smoothedGreen: number = 0;
  private smoothedBlue: number = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.12;     // Mucho más suavizado = ignora micro-movimientos
  private detectionConfidence: number = 0;
  
  // Métricas de estabilidad expuestas
  private lastCoverageScore: number = 0;
  private lastSpatialStability: number = 0;
  private lastTilePulseScore: number = 0;
  private motionLevel: number = 0; // 0-1, basado en variación de señal reciente
  
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
    const { rawRed, rawGreen, rawBlue, coverageScore, spatialStability, tilePulseScore } = this.extractROI(imageData);
    
    // 2. GUARDAR EN BUFFERS
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
    
    // 3. GUARDAR MÉTRICAS DE ESTABILIDAD
    this.lastCoverageScore = coverageScore;
    this.lastSpatialStability = spatialStability;
    this.lastTilePulseScore = tilePulseScore;
    
    // 4. DETECCIÓN DE DEDO
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue, coverageScore, spatialStability, tilePulseScore);
    
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
    
    // 10. CALCULAR CALIDAD DE SEÑAL + NIVEL DE MOVIMIENTO
    this.signalQuality = this.calculateSignalQuality();
    this.updateMotionLevel();
    
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
         message: `${greenSaturated ? 'R' : 'G'}:${signalSource.toFixed(0)} PI:${perfusionIndex.toFixed(2)} FD:${this.fingerDetected ? '1' : '0'}`,
        hasPulsatility: perfusionIndex > 0.1,
        pulsatilityValue: perfusionIndex
      }
    };

    this.onSignalReady(processedSignal);
  }
  
  /**
   * EXTRAER RGB DE REGIÓN AMPLIA (85%)
   */
  private extractROI(imageData: ImageData): {
    rawRed: number;
    rawGreen: number;
    rawBlue: number;
    coverageScore: number;
    spatialStability: number;
    tilePulseScore: number;
  } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // ROI amplia - 85% del área
    const roiSize = Math.min(width, height) * 0.85;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    const tileColumns = 3;
    const tileRows = 3;
    const tiles = Array.from({ length: tileColumns * tileRows }, () => ({
      red: 0,
      green: 0,
      blue: 0,
      count: 0,
    }));
    const roiWidth = Math.max(1, endX - startX);
    const roiHeight = Math.max(1, endY - startY);
    
    // Muestrear cada 4 píxeles y usar medias robustas por subregión
    for (let y = startY; y < endY; y += 4) {
      for (let x = startX; x < endX; x += 4) {
        const i = (y * width + x) * 4;
        const tileX = Math.min(tileColumns - 1, Math.floor(((x - startX) / roiWidth) * tileColumns));
        const tileY = Math.min(tileRows - 1, Math.floor(((y - startY) / roiHeight) * tileRows));
        const tile = tiles[tileY * tileColumns + tileX];

        tile.red += data[i];
        tile.green += data[i + 1];
        tile.blue += data[i + 2];
        tile.count++;
      }
    }

    const validTiles = tiles
      .filter(tile => tile.count > 0)
      .map(tile => ({
        red: tile.red / tile.count,
        green: tile.green / tile.count,
        blue: tile.blue / tile.count,
      }));

    const robustAverage = (channel: 'red' | 'green' | 'blue') => {
      const values = validTiles
        .map(tile => tile[channel])
        .sort((a, b) => a - b);

      if (values.length === 0) return 0;
      if (values.length <= 3) {
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      }

      const trimmed = values.slice(1, -1);
      return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
    };

    const normalizedSpread = (channel: 'red' | 'green' | 'blue') => {
      const values = validTiles
        .map(tile => tile[channel])
        .sort((a, b) => a - b);

      if (values.length < 2) return 0;

      const q1 = values[Math.floor((values.length - 1) * 0.25)];
      const q3 = values[Math.floor((values.length - 1) * 0.75)];
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

      return (q3 - q1) / (mean + 1);
    };

    const candidateTiles = validTiles.filter(tile => {
      const total = tile.red + tile.green + tile.blue;
      return total > 75 && tile.red > 28 && tile.red > tile.blue * 1.02;
    });

    const coverageScore = validTiles.length > 0 ? candidateTiles.length / validTiles.length : 0;
    const redSpread = normalizedSpread('red');
    const greenSpread = normalizedSpread('green');
    const blueSpread = normalizedSpread('blue');
    const spatialNoise = redSpread * 1.25 + greenSpread + blueSpread * 0.75;
    const spatialStability = Math.max(0, Math.min(1, 1 - spatialNoise / 1.6));
    const tilePulseScore = candidateTiles.length > 0
      ? candidateTiles.reduce((sum, tile) => {
          const total = tile.red + tile.green + tile.blue;
          return sum + (total > 0 ? (tile.red - ((tile.green + tile.blue) / 2)) / total : 0);
        }, 0) / candidateTiles.length
      : 0;
    
    return {
      rawRed: robustAverage('red'),
      rawGreen: robustAverage('green'),
      rawBlue: robustAverage('blue'),
      coverageScore,
      spatialStability,
      tilePulseScore,
    };
  }
  
  /**
   * DETECCIÓN DE DEDO CON HISTÉRESIS Y SUAVIZADO
   * 
   * - Suaviza valores RGB para tolerar temblores/micromovimientos
   * - Usa histéresis: requiere varios frames consecutivos para cambiar estado
   * - Umbrales más permisivos para comodidad del usuario
   */
  private detectFinger(
    rawRed: number,
    rawGreen: number,
    rawBlue: number,
    coverageScore: number,
    spatialStability: number,
    tilePulseScore: number,
  ): boolean {
    // Suavizar RGB para absorber temblores y micromovimientos
    if (this.smoothedRed === 0) {
      this.smoothedRed = rawRed;
      this.smoothedGreen = rawGreen;
      this.smoothedBlue = rawBlue;
    } else {
      this.smoothedRed = this.smoothedRed * (1 - this.RGB_SMOOTH_ALPHA) + rawRed * this.RGB_SMOOTH_ALPHA;
      this.smoothedGreen = this.smoothedGreen * (1 - this.RGB_SMOOTH_ALPHA) + rawGreen * this.RGB_SMOOTH_ALPHA;
      this.smoothedBlue = this.smoothedBlue * (1 - this.RGB_SMOOTH_ALPHA) + rawBlue * this.RGB_SMOOTH_ALPHA;
    }
    
    const r = this.smoothedRed;
    const g = this.smoothedGreen;
    const b = this.smoothedBlue;

    const rgRatio = g > 0 ? r / g : 0;
    const rbRatio = b > 0 ? r / b : 0;
    const totalIntensity = r + g + b;
    const colorDominance = totalIntensity > 0 ? (r - ((g + b) / 2)) / totalIntensity : 0;
    const notBlownOut = !(r > 254.8 && g > 254.8 && b > 254.8);
    const ratioScore = rgRatio > 0 ? Math.max(0, 1 - Math.abs(rgRatio - 1.45) / 2.9) : 0;
    const intensityScore = Math.max(0, Math.min(1, (totalIntensity - 70) / 220));
    const dominanceScore = Math.max(0, Math.min(1, (colorDominance - 0.05) / 0.22));

    let detectionScore = 0;
    if (r > 30) detectionScore += 1;
    if (rgRatio > 0.66 && rgRatio < 4.6) detectionScore += 1;
    if (rbRatio > 1.04) detectionScore += 1;
    if (totalIntensity > 75 && totalIntensity < 720) detectionScore += 1;
    if (colorDominance > 0.07) detectionScore += 1;
    if (coverageScore > (this.fingerDetected ? 0.28 : 0.42)) detectionScore += 1;
    if (spatialStability > 0.32) detectionScore += 1;
    if (tilePulseScore > 0.04) detectionScore += 1;

    const targetConfidence = notBlownOut
      ? Math.max(0, Math.min(1,
          detectionScore / 8 * 0.42 +
          coverageScore * 0.18 +
          spatialStability * 0.16 +
          ratioScore * 0.12 +
          intensityScore * 0.06 +
          dominanceScore * 0.06
        ))
      : 0;

    const confidenceAlpha = targetConfidence >= this.detectionConfidence ? 0.24 : 0.1;
    this.detectionConfidence = this.detectionConfidence * (1 - confidenceAlpha) + targetConfidence * confidenceAlpha;

    const instantDetected = this.fingerDetected
      ? this.detectionConfidence >= 0.34
      : this.detectionConfidence >= 0.56;
    
    // HISTÉRESIS: evitar parpadeo del estado
    if (instantDetected) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, this.FINGER_CONFIRM_FRAMES + 5);
      
      // Si ya estaba detectado, mantener. Si no, esperar confirmación
      if (this.fingerDetected) {
        return true;
      } else {
        return this.fingerConfidenceCount >= this.FINGER_CONFIRM_FRAMES;
      }
    } else {
      this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 1);
      this.fingerLostCount++;
      
      // Si estaba detectado, tolerar pérdidas breves (temblor/reposición)
      if (this.fingerDetected) {
        return this.fingerLostCount < this.FINGER_LOST_FRAMES;
      }
      return false;
    }
  }
  
  /**
   * CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS - MÉTODO PROFESIONAL
   * 
   * Basado en Texas Instruments SLAA655:
   * - DC = promedio (componente no pulsátil)
   * - AC = RMS de la componente pulsátil (más preciso que pico-a-pico)
   * 
   * Para SpO2: R = (AC_red/DC_red) / (AC_green/DC_green)
   */
  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 60) return;
    
    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);
    
    // DC = promedio (componente continua / no pulsátil)
    this.redDC = redWindow.reduce((a, b) => a + b, 0) / redWindow.length;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / greenWindow.length;
    
    // Protección contra DC muy bajo
    if (this.redDC < 5 || this.greenDC < 5) return;
    
    // === MÉTODO 1: RMS de la señal centrada ===
    // RMS = sqrt(sum((x - mean)^2) / n)
    let redSumSq = 0;
    let greenSumSq = 0;
    
    for (let i = 0; i < windowSize; i++) {
      redSumSq += Math.pow(redWindow[i] - this.redDC, 2);
      greenSumSq += Math.pow(greenWindow[i] - this.greenDC, 2);
    }
    
    const redRMS = Math.sqrt(redSumSq / windowSize);
    const greenRMS = Math.sqrt(greenSumSq / windowSize);
    
    // === MÉTODO 2: Pico a pico con filtrado de outliers ===
    // Ordenar y usar percentiles para evitar ruido extremo
    const sortedRed = [...redWindow].sort((a, b) => a - b);
    const sortedGreen = [...greenWindow].sort((a, b) => a - b);
    
    const p5 = Math.floor(windowSize * 0.05);
    const p95 = Math.floor(windowSize * 0.95);
    
    const redP2P = sortedRed[p95] - sortedRed[p5];
    const greenP2P = sortedGreen[p95] - sortedGreen[p5];
    
    // === FUSIÓN: Usar RMS como base, pico-a-pico como validación ===
    // AC_rms * sqrt(2) ≈ amplitud pico para señal sinusoidal
    const redACFromRMS = redRMS * Math.sqrt(2);
    const greenACFromRMS = greenRMS * Math.sqrt(2);
    
    // Promediar ambos métodos para robustez
    this.redAC = (redACFromRMS + redP2P * 0.5) / 2;
    this.greenAC = (greenACFromRMS + greenP2P * 0.5) / 2;
    
    // Validación: Si AC es muy pequeño relativo a DC, señal débil
    const redPI = this.redAC / this.redDC;
    const greenPI = this.greenAC / this.greenDC;
    
    // Perfusion Index típico: 0.1% - 20%
    if (redPI < 0.001 || greenPI < 0.001) {
      // Señal muy débil, puede ser ruido
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
   * CALCULAR CALIDAD DE SEÑAL
   */
  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 30) return 0;
    if (!this.fingerDetected) return 0;
    
    const recent = this.filteredBuffer.slice(-90); // Ventana más amplia para mejor estimación
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    if (range < 0.25) return 5;
    
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);

    // Ruido por movimiento: diferencias consecutivas grandes
    let motionNoise = 0;
    let maxJump = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = Math.abs(recent[i] - recent[i - 1]);
      motionNoise += diff;
      if (diff > maxJump) maxJump = diff;
    }
    motionNoise /= Math.max(1, recent.length - 1);

    // SNR robusto
    const snr = range / (stdDev + 0.01);
    const perfusionScore = Math.max(0, Math.min(1, this.calculatePerfusionIndex() / 2.0));
    const stabilityScore = Math.max(0, Math.min(1, 1 - motionNoise / (range * 0.5 + 0.01)));
    const snrScore = Math.max(0, Math.min(1, snr / 4.0));
    const continuityScore = Math.max(0, Math.min(1, this.detectionConfidence));
    // Penalizar saltos grandes (micro-movimientos bruscos)
    const jumpPenalty = Math.max(0, 1 - maxJump / (range * 0.6 + 0.01));

    return Math.round(
      snrScore * 38 +
      perfusionScore * 22 +
      stabilityScore * 18 +
      continuityScore * 12 +
      jumpPenalty * 10
    );
  }
  
  /**
   * NIVEL DE MOVIMIENTO basado en variación de señal filtrada
   */
  private updateMotionLevel(): void {
    if (this.filteredBuffer.length < 10) { this.motionLevel = 0; return; }
    const recent = this.filteredBuffer.slice(-30);
    let totalDiff = 0;
    for (let i = 1; i < recent.length; i++) totalDiff += Math.abs(recent[i] - recent[i - 1]);
    this.motionLevel = Math.min(1, (totalDiff / (recent.length - 1)) / 5);
  }

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
    this.fingerConfidenceCount = 0;
    this.fingerLostCount = 0;
    this.smoothedRed = 0;
    this.smoothedGreen = 0;
    this.smoothedBlue = 0;
    this.detectionConfidence = 0;
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.lastCoverageScore = 0;
    this.lastSpatialStability = 0;
    this.lastTilePulseScore = 0;
    this.motionLevel = 0;
    this.bandpassFilter.reset();
  }

  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios: this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0 
        ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC) 
        : 0
    };
  }

  getDetectionMetrics() {
    return {
      detectionConfidence: this.detectionConfidence,
      fingerDetected: this.fingerDetected,
      signalQuality: this.signalQuality,
      perfusionIndex: this.calculatePerfusionIndex(),
      smoothedRed: this.smoothedRed,
      smoothedGreen: this.smoothedGreen,
      smoothedBlue: this.smoothedBlue,
      fingerConfidenceCount: this.fingerConfidenceCount,
      fingerLostCount: this.fingerLostCount,
      bufferFill: this.filteredBuffer.length / this.BUFFER_SIZE,
      coverageScore: this.lastCoverageScore,
      spatialStability: this.lastSpatialStability,
      tilePulseScore: this.lastTilePulseScore,
      motionLevel: this.motionLevel,
    };
  }
  
}
