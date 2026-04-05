import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { WinnerTakesAllSelector, WTAResult } from './WinnerTakesAll';
import { AutoRescueEngine, RescueLevel, type RescueState } from './AutoRescueEngine';
import { computeTemporalNormalizedPulse } from './PulseSignalExtractor';

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
  
  private wtaSelector: WinnerTakesAllSelector;
  private rescueEngine: AutoRescueEngine;
  private lastRescueState: RescueState | null = null;
  /** Un solo pasabanda sobre la señal POS/CHROM (evita doble filtrado con WTA) */
  private pulseBandpass: BandpassFilter;
  private lastPulseSource: 'POS' | 'WTA' = 'WTA';
  
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
  private readonly FINGER_CONFIRM_FRAMES = 4;   // Un frame más contra falsos positivos (escena / luz)
  private readonly FINGER_LOST_FRAMES = 50;     // Ultra tolerante a temblores/reposiciones
  private smoothedRed: number = 0;
  private smoothedGreen: number = 0;
  private smoothedBlue: number = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.12;     // Base de suavizado; se adapta con rescue engine
  private detectionConfidence: number = 0;
  
  // Métricas de estabilidad expuestas
  private lastCoverageScore: number = 0;
  private lastSpatialStability: number = 0;
  private lastTilePulseScore: number = 0;
  private motionLevel: number = 0; // 0-1, basado en variación de señal reciente

  private outputEma: number = 0;
  private outputEmaReady = false;
  private readonly OUTPUT_EMA_ALPHA = 0.26;
  /** Mezcla con salida directa del pasabanda para no aplastar amplitud (SQI / latidos) */
  private readonly OUTPUT_DIRECT_BLEND = 0.42;
  /** Calidad del frame anterior (EMA adaptativo antes de recalcular SQI) */
  private lastQualityForEma = 45;

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.wtaSelector = new WinnerTakesAllSelector();
    this.rescueEngine = new AutoRescueEngine();
    this.pulseBandpass = new BandpassFilter(30);
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
    
    // 1. GET RESCUE STATE for adaptive parameters
    const rescueState = this.lastRescueState;
    const roiFraction = rescueState?.roiFraction ?? 0.72;
    const agcGain = rescueState?.agcGain ?? 1.0;

    // 2. RGB del parche central (contacto dedo-lente) + métricas espaciales en ROI amplia
    const { rawRed, rawGreen, rawBlue, coverageScore, spatialStability, tilePulseScore } =
      this.extractROI(imageData, roiFraction);
    
    // 2. GUARDAR EN BUFFERS
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    this.blueBuffer.push(rawBlue);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }
    
    // 3. GUARDAR MÉTRICAS DE ESTABILIDAD
    this.lastCoverageScore = coverageScore;
    this.lastSpatialStability = spatialStability;
    this.lastTilePulseScore = tilePulseScore;
    
    // 4. DETECCIÓN DE DEDO
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue, coverageScore, spatialStability, tilePulseScore);
    
    // 4b. CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS
    if (this.redBuffer.length >= 60) {
      this.calculateACDCPrecise();
    }
    
    // 5. WTA (referencia / fallback) + POS/CHROM temporal (señal principal)
    const wtaResult = this.wtaSelector.process(rawRed, rawGreen, rawBlue);
    this.lastWTAResult = wtaResult;

    const pulseBlend = computeTemporalNormalizedPulse(
      rawRed,
      rawGreen,
      rawBlue,
      this.redBuffer,
      this.greenBuffer,
      this.blueBuffer,
      90
    );

    let inverted: number;
    let filtered: number;
    let mainFiltered: number;

    if (pulseBlend && this.redBuffer.length >= 30) {
      inverted = pulseBlend.rawPulse;
      mainFiltered = this.pulseBandpass.filter(pulseBlend.rawPulse);
      filtered = mainFiltered;
      this.lastPulseSource = 'POS';
    } else {
      inverted = wtaResult.rawValue;
      filtered = wtaResult.filteredValue;
      mainFiltered = filtered;
      this.lastPulseSource = 'WTA';
    }

    const q01 = Math.min(1, this.lastQualityForEma / 100);
    const weakBoost =
      this.fingerDetected && q01 < 0.55 ? (0.55 - q01) * 0.1 : 0;
    const boosted = mainFiltered * (1 + weakBoost);
    const emaAlpha =
      this.fingerDetected && q01 < 0.45
        ? Math.min(0.44, this.OUTPUT_EMA_ALPHA + 0.12)
        : this.OUTPUT_EMA_ALPHA;

    if (!this.outputEmaReady) {
      this.outputEma = boosted;
      this.outputEmaReady = true;
    } else {
      this.outputEma = emaAlpha * boosted + (1 - emaAlpha) * this.outputEma;
    }
    const smoothedFiltered =
      this.outputEma * (1 - this.OUTPUT_DIRECT_BLEND) +
      mainFiltered * this.OUTPUT_DIRECT_BLEND;
    
    // 6. GUARDAR EN BUFFER RAW (del canal ganador)
    this.rawBuffer.push(inverted);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    this.filteredBuffer.push(smoothedFiltered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 9. CALCULAR DERIVADAS
    this.calculateDerivatives();
    
    // 10. CALCULAR CALIDAD DE SEÑAL + NIVEL DE MOVIMIENTO
    this.signalQuality = this.calculateSignalQuality();
    this.lastQualityForEma = this.signalQuality;
    this.updateMotionLevel();
    
    // 10b. RESCUE ENGINE: evaluar y adaptar
    this.lastRescueState = this.rescueEngine.evaluate(this.signalQuality, this.fingerDetected);
    
    // 11. LOG CADA SEGUNDO
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const wta = wtaResult;
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      const rescueLabel = this.rescueEngine.getLevelLabel();
      console.log(
        `📷 PPG [${this.lastPulseSource}/${wta.winnerId}]: Score=${wta.winnerScore.toFixed(0)} Filt=${smoothedFiltered.toFixed(2)} Q=${this.signalQuality.toFixed(0)}% AC_R=${this.redAC.toFixed(1)} AC_G=${this.greenAC.toFixed(1)} ${fingerStatus} R:${rescueLabel}`
      );
    }
    
    // 12. CALCULAR ÍNDICE DE PERFUSIÓN
    const perfusionIndex = this.calculatePerfusionIndex();
    const pulsatilityFromAC =
      this.greenDC > 0 ? (this.greenAC / this.greenDC) * 100 : 0;

    // 13. EMITIR SEÑAL PROCESADA con AGC de rescate (sobre muestra ya suavizada)
    const rescuedFilteredValue = smoothedFiltered * agcGain;
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: inverted,
      filteredValue: rescuedFilteredValue,
      quality: this.signalQuality,
      fingerDetected: this.fingerDetected,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message: `${this.lastPulseSource}:WTA:${wtaResult.winnerId}(${wtaResult.winnerScore.toFixed(0)}) PI:${perfusionIndex.toFixed(2)} FD:${this.fingerDetected ? '1' : '0'}`,
        hasPulsatility:
          this.fingerDetected &&
          (perfusionIndex > 0.012 || pulsatilityFromAC > 0.055),
        pulsatilityValue: Math.max(perfusionIndex, pulsatilityFromAC)
      }
    };

    this.onSignalReady(processedSignal);
  }
  
  /**
   * Parche central (~42%): yema sobre el lente — máxima pulsación.
   * ROI amplia (rescue): mosaico 3×3 con muestreo denso.
   */
  private extractCenterMeanRGB(imageData: ImageData, frac: number): { rawRed: number; rawGreen: number; rawBlue: number } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const roiSize = Math.min(width, height) * frac;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const i = (y * width + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
    }
    if (count === 0) return { rawRed: 0, rawGreen: 0, rawBlue: 0 };
    return { rawRed: r / count, rawGreen: g / count, rawBlue: b / count };
  }

  private extractROI(imageData: ImageData, roiFraction: number = 0.72): {
    rawRed: number;
    rawGreen: number;
    rawBlue: number;
    coverageScore: number;
    spatialStability: number;
    tilePulseScore: number;
  } {
    const centerRgb = this.extractCenterMeanRGB(imageData, 0.42);

    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Respetar rescue (p. ej. AGGRESSIVE 0.40); solo acotar a un rango seguro
    const wideFrac = Math.min(0.92, Math.max(0.32, roiFraction));
    const roiSize = Math.min(width, height) * wideFrac;
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
    
    // Muestreo denso (3 px) por subregión para mejor lectura con dedo débil / borroso
    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
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
      if (total < 45) return false;

      const redRatio = total > 0 ? tile.red / total : 0;
      const redDominance = tile.red - (tile.green + tile.blue) / 2;
      const likelyFingerColor = redRatio > 0.31 && redDominance > 2;
      const saturatedButPlausible =
        tile.red > 120 && tile.red >= tile.green * 0.88 && tile.green > tile.blue * 0.85;
      const torchSkin = tile.red > 95 && tile.green > 35 && total > 160;

      return likelyFingerColor || saturatedButPlausible || torchSkin;
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
      rawRed: centerRgb.rawRed,
      rawGreen: centerRgb.rawGreen,
      rawBlue: centerRgb.rawBlue,
      coverageScore,
      spatialStability,
      tilePulseScore,
    };
  }
  
  /**
   * DETECCIÓN DE DEDO (contacto óptico) — histéresis + suavizado RGB
   *
   * Alineado con prácticas rPPG móvil: ROI central, linterna, SQI/estabilidad
   * (p. ej. “Optimal signal quality index for remote PPG”, npj Biosensing 2024).
   * - Rechaza escenas sin perfil hemoglobina/transiluminación ni coherencia espacial.
   * - Exige geometría de contacto para pasar de “no dedo” → “dedo” (menos falsos positivos).
   */
  private detectFinger(
    rawRed: number,
    rawGreen: number,
    rawBlue: number,
    coverageScore: number,
    spatialStability: number,
    tilePulseScore: number,
  ): boolean {
    const rescueState = this.lastRescueState;
    const relax = rescueState?.fingerThresholdRelax ?? 1.0;
    const adaptiveAlpha = rescueState?.smoothingAlpha ?? this.RGB_SMOOTH_ALPHA;

    // Suavizar RGB para absorber temblores y micromovimientos
    if (this.smoothedRed === 0) {
      this.smoothedRed = rawRed;
      this.smoothedGreen = rawGreen;
      this.smoothedBlue = rawBlue;
    } else {
      this.smoothedRed = this.smoothedRed * (1 - adaptiveAlpha) + rawRed * adaptiveAlpha;
      this.smoothedGreen = this.smoothedGreen * (1 - adaptiveAlpha) + rawGreen * adaptiveAlpha;
      this.smoothedBlue = this.smoothedBlue * (1 - adaptiveAlpha) + rawBlue * adaptiveAlpha;
    }
    
    const r = this.smoothedRed;
    const g = this.smoothedGreen;
    const b = this.smoothedBlue;

    const rgRatio = g > 0 ? r / g : 0;
    const rbRatio = b > 0 ? r / b : 0;
    const totalIntensity = r + g + b;
    const redShare = totalIntensity > 0 ? r / totalIntensity : 0;
    const colorDominance = totalIntensity > 0 ? (r - ((g + b) / 2)) / totalIntensity : 0;
    const brightnessNormalized = totalIntensity / 765;
    const plausibleSaturation = !(r > 254.8 && g > 254.8 && b > 254.8) && totalIntensity > 40;
    const ratioScore = rgRatio > 0 ? Math.max(0, 1 - Math.abs(rgRatio - 1.35) / 2.8) : 0;
    const intensityScore = Math.max(0, Math.min(1, (totalIntensity - 55) / 260));
    const dominanceScore = Math.max(0, Math.min(1, (colorDominance - 0.035) / 0.24));
    const redShareScore = Math.max(0, Math.min(1, (redShare - 0.30) / 0.22));
    const perfusionHint = Math.max(0, Math.min(1, this.calculatePerfusionIndex() / 1.2));

    const coverageThreshold = Math.max(this.fingerDetected ? 0.08 : 0.11, (this.fingerDetected ? 0.22 : 0.32) / relax);
    const spatialThreshold = Math.max(0.12, 0.26 / relax);
    const pulseThreshold = Math.max(0.008, 0.028 / relax);

    /** Linterna atravesando tejido: patrón muy claro en rPPG móvil */
    const torchThroughFinger =
      totalIntensity > 200 && r > 85 && r > g * 0.82 && g > 30;

    /**
     * Contacto dedo–lente sin saturar: R dominante vs G/B (absorción hemoglobina), intensidad suficiente.
     * Umbrales algo amplios para tonos de piel distintos; se combina con cobertura ROI.
     */
    const contactTransillumination =
      totalIntensity >= 72 &&
      r >= 36 &&
      redShare >= 0.262 &&
      r >= g * 0.5 &&
      r >= b * 0.76;

    let detectionScore = 0;
    if (r > 20) detectionScore += 1;
    if (rgRatio > 0.52 && rgRatio < 5.2) detectionScore += 1;
    if (rbRatio > 0.92) detectionScore += 1;
    if (totalIntensity > 55 && totalIntensity < 765) detectionScore += 1;
    if (colorDominance > 0.032 || redShare > 0.32) detectionScore += 1;
    if (coverageScore > coverageThreshold) detectionScore += 1;
    if (spatialStability > spatialThreshold) detectionScore += 1;
    if (tilePulseScore > pulseThreshold) detectionScore += 1;
    if (perfusionHint > 0.08) detectionScore += 1;
    if (torchThroughFinger) detectionScore += 2;
    if (contactTransillumination) detectionScore += 1;

    /** Escena / mesa / fondo: variación de color sin perfil de contacto ni ROI coherente */
    const likelyAmbientNoise =
      !torchThroughFinger &&
      !contactTransillumination &&
      totalIntensity > 52 &&
      redShare < 0.27 &&
      coverageScore < 0.125 &&
      spatialStability < 0.155 &&
      detectionScore < 6;

    const motionPenalty = Math.max(0.72, 1 - this.motionLevel * 0.28);

    let targetConfidence = plausibleSaturation
      ? Math.max(0, Math.min(1,
          (detectionScore / 12) * 0.38 +
          coverageScore * 0.15 +
          spatialStability * 0.13 +
          ratioScore * 0.09 +
          intensityScore * 0.08 +
          dominanceScore * 0.06 +
          redShareScore * 0.05 +
          perfusionHint * 0.06
        )) * motionPenalty
      : 0;

    if (likelyAmbientNoise) {
      targetConfidence *= 0.12;
    }

    const confidenceAlpha = targetConfidence >= this.detectionConfidence ? 0.32 : 0.14;
    this.detectionConfidence = this.detectionConfidence * (1 - confidenceAlpha) + targetConfidence * confidenceAlpha;

    const enterThreshold = Math.max(0.2, 0.38 / Math.sqrt(relax));
    const holdThreshold = Math.max(0.15, 0.26 / Math.sqrt(relax));

    /** Geometría de contacto: evita “FC” con solo ruido o vídeo ambiente */
    const geometryOk =
      torchThroughFinger ||
      contactTransillumination ||
      (detectionScore >= 7 && coverageScore >= 0.17 && spatialStability >= 0.13);

    const instantDetected = this.fingerDetected
      ? this.detectionConfidence >= holdThreshold
      : this.detectionConfidence >= enterThreshold && geometryOk;

    // Histéresis: evitar parpadeo del estado
    if (instantDetected) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, this.FINGER_CONFIRM_FRAMES + 6);

      if (this.fingerDetected) {
        return true;
      }

      return this.fingerConfidenceCount >= Math.max(2, this.FINGER_CONFIRM_FRAMES - 1);
    }

    this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 1);
    this.fingerLostCount++;

    if (this.fingerDetected) {
      return this.fingerLostCount < this.FINGER_LOST_FRAMES;
    }

    return false;
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
    // Invariante: sin contacto dedo → calidad 0 (no medir FC por amplitud sola)
    if (!this.fingerDetected) return 0;

    const recent = this.filteredBuffer.slice(-90);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;

    if (range < 0.05) {
      return 6;
    }
    if (range < 0.12) {
      return Math.max(14, Math.min(38, Math.round(14 + (range - 0.05) / 0.07 * 24)));
    }
    
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
    const snrScore = Math.max(0, Math.min(1, snr / 3.2));
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
    this.blueBuffer = [];
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
    this.lastWTAResult = null;
    this.lastRescueState = null;
    this.lastPulseSource = 'WTA';
    this.outputEma = 0;
    this.outputEmaReady = false;
    this.lastQualityForEma = 45;
    this.pulseBandpass.reset();
    this.wtaSelector.reset();
    this.rescueEngine.reset();
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
    const wtaInfo = this.wtaSelector.getWinnerInfo();
    const rescue = this.lastRescueState;
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
      // WTA metrics
      wtaWinnerId: wtaInfo.winnerId,
      wtaWinnerLabel: wtaInfo.winnerLabel,
      wtaWinnerScore: wtaInfo.winnerScore,
      wtaAllScores: wtaInfo.allScores,
      // Rescue metrics
      rescueLevel: rescue?.level ?? 0,
      rescueLevelLabel: this.rescueEngine.getLevelLabel(),
      rescueActive: rescue?.isRescueActive ?? false,
      pulseSource: this.lastPulseSource,
      rescueRoiFraction: rescue?.roiFraction ?? 0.72,
      rescueAgcGain: rescue?.agcGain ?? 1.0,
    };
  }
  
}
