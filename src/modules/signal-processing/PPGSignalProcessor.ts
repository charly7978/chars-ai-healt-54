import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { WinnerTakesAllSelector, WTAResult } from './WinnerTakesAll';
import { AutoRescueEngine, type RescueState } from './AutoRescueEngine';
import { computeTemporalNormalizedPulse } from './PulseSignalExtractor';

/**
 * PROCESADOR PPG — PIPELINE CORREGIDO
 *
 * Problemas corregidos respecto a la versión anterior:
 * 1. Se eliminó el suavizado EMA de salida que destruía la componente pulsátil
 * 2. POS/CHROM ahora produce valores escalados (~1-50) compatibles con el pipeline
 * 3. La calidad de señal ya no se fuerza a 0 sin dedo — se deja baja (pero permite procesamiento)
 * 4. El filtro pasabanda se aplica una sola vez (no doble con WTA)
 *
 * Pipeline: ROI → RGB → POS/CHROM (o WTA fallback) → Bandpass → señal filtrada → métricas
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;

  private wtaSelector: WinnerTakesAllSelector;
  private rescueEngine: AutoRescueEngine;
  private lastRescueState: RescueState | null = null;
  private pulseBandpass: BandpassFilter;
  private lastPulseSource: 'POS' | 'WTA' = 'WTA';

  private readonly BUFFER_SIZE = 180;
  private readonly ACDC_WINDOW = 120;
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private vpgBuffer: number[] = [];
  private apgBuffer: number[] = [];

  private lastWTAResult: WTAResult | null = null;

  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;

  private frameCount: number = 0;
  private lastLogTime: number = 0;

  private fingerDetected: boolean = false;
  private contactLikely: boolean = false;
  private signalQuality: number = 0;
  private fingerConfidenceCount: number = 0;
  private fingerLostCount: number = 0;
  private smoothedRed: number = 0;
  private smoothedGreen: number = 0;
  private smoothedBlue: number = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.12;
  private detectionConfidence: number = 0;

  private lastCoverageScore: number = 0;
  private lastSpatialStability: number = 0;
  private lastTilePulseScore: number = 0;
  private motionLevel: number = 0;

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
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log('🚀 PPGSignalProcessor iniciado');
  }

  stop(): void {
    this.isProcessing = false;
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  /**
   * PROCESAR FRAME — PIPELINE SIMPLIFICADO Y CORRECTO
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();

    const rescueState = this.lastRescueState;
    const roiFraction = rescueState?.roiFraction ?? 0.72;
    const agcGain = rescueState?.agcGain ?? 1.0;

    // 1. Extraer RGB del ROI central
    const { rawRed, rawGreen, rawBlue, coverageScore, spatialStability, tilePulseScore } =
      this.extractROI(imageData, roiFraction);

    // 2. Buffers RGB
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    this.blueBuffer.push(rawBlue);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }

    this.lastCoverageScore = coverageScore;
    this.lastSpatialStability = spatialStability;
    this.lastTilePulseScore = tilePulseScore;

    // 3. AC/DC previo a compuertas para usar la ventana RGB más reciente
    if (this.redBuffer.length >= 60) {
      this.calculateACDCPrecise();
    }

    // 4. Detección de contacto / dedo
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue, coverageScore, spatialStability, tilePulseScore);

    // 5. Extracción de señal: POS/CHROM (primario) o WTA (fallback)
    const wtaResult = this.wtaSelector.process(rawRed, rawGreen, rawBlue);
    this.lastWTAResult = wtaResult;

    let rawSignal: number;
    let filtered: number;

    const pulseBlend = computeTemporalNormalizedPulse(
      rawRed, rawGreen, rawBlue,
      this.redBuffer, this.greenBuffer, this.blueBuffer,
      90
    );

    if (pulseBlend && this.redBuffer.length >= 30) {
      // POS/CHROM produce valores ya escalados (~1-50 rango)
      rawSignal = pulseBlend.rawPulse;
      // Un solo pasabanda — NO hay EMA adicional
      filtered = this.pulseBandpass.filter(rawSignal);
      this.lastPulseSource = 'POS';
    } else {
      // Fallback a WTA (ya tiene su propio bandpass)
      rawSignal = wtaResult.rawValue;
      filtered = wtaResult.filteredValue;
      this.lastPulseSource = 'WTA';
    }

    // 6. Aplicar AGC de rescue (solo si está activo)
    const finalFiltered = filtered * agcGain;

    // 7. Buffers de señal procesada
    this.rawBuffer.push(rawSignal);
    if (this.rawBuffer.length > this.BUFFER_SIZE) this.rawBuffer.shift();

    this.filteredBuffer.push(finalFiltered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) this.filteredBuffer.shift();

    // 8. Derivadas
    this.calculateDerivatives();

    // 9. Calidad de señal (ya no se fuerza a 0 sin dedo)
    this.signalQuality = this.calculateSignalQuality();
    this.updateMotionLevel();

    // 10. Rescue engine
    this.lastRescueState = this.rescueEngine.evaluate(this.signalQuality, this.fingerDetected);

    // 11. Log periódico
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      const rescueLabel = this.rescueEngine.getLevelLabel();
      console.log(
        `📷 PPG [${this.lastPulseSource}/${wtaResult.winnerId}]: Filt=${finalFiltered.toFixed(2)} Q=${this.signalQuality.toFixed(0)}% AC_R=${this.redAC.toFixed(1)} AC_G=${this.greenAC.toFixed(1)} ${fingerStatus} R:${rescueLabel}`
      );
    }

    // 12. Perfusion index
    const perfusionIndex = this.calculatePerfusionIndex();
    const pulsatilityFromAC = this.greenDC > 0 ? (this.greenAC / this.greenDC) * 100 : 0;

    // 13. Emitir señal
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: rawSignal,
      filteredValue: finalFiltered,
      quality: this.signalQuality,
      fingerDetected: this.fingerDetected,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message: `${this.lastPulseSource}:WTA:${wtaResult.winnerId}(${wtaResult.winnerScore.toFixed(0)}) PI:${perfusionIndex.toFixed(2)} FD:${this.fingerDetected ? '1' : '0'}`,
        hasPulsatility: perfusionIndex > 0.015 || pulsatilityFromAC > 0.08,
        pulsatilityValue: Math.max(perfusionIndex, pulsatilityFromAC)
      }
    };

    this.onSignalReady(processedSignal);
  }

  // ═══════════════════════════════════════════════════════════
  // ROI EXTRACTION
  // ═══════════════════════════════════════════════════════════

  private extractCenterMeanRGB(imageData: ImageData, frac: number): { rawRed: number; rawGreen: number; rawBlue: number } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const roiSize = Math.min(width, height) * frac;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    let r = 0, g = 0, b = 0, count = 0;

    // Muestreo cada 2 pixels para velocidad (suficiente precisión para PPG)
    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
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
    rawRed: number; rawGreen: number; rawBlue: number;
    coverageScore: number; spatialStability: number; tilePulseScore: number;
  } {
    const centerRgb = this.extractCenterMeanRGB(imageData, 0.42);

    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    const wideFrac = Math.min(0.92, Math.max(0.32, roiFraction));
    const roiSize = Math.min(width, height) * wideFrac;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);

    const tileColumns = 3;
    const tileRows = 3;
    const tiles = Array.from({ length: tileColumns * tileRows }, () => ({
      red: 0, green: 0, blue: 0, count: 0,
    }));
    const roiWidth = Math.max(1, endX - startX);
    const roiHeight = Math.max(1, endY - startY);

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
      const values = validTiles.map(t => t[channel]).sort((a, b) => a - b);
      if (values.length < 2) return 0;
      const q1 = values[Math.floor((values.length - 1) * 0.25)];
      const q3 = values[Math.floor((values.length - 1) * 0.75)];
      const m = values.reduce((s, v) => s + v, 0) / values.length;
      return (q3 - q1) / (m + 1);
    };

    const candidateTiles = validTiles.filter(tile => {
      const total = tile.red + tile.green + tile.blue;
      if (total < 45) return false;
      const redRatio = total > 0 ? tile.red / total : 0;
      const redDominance = tile.red - (tile.green + tile.blue) / 2;
      const likelyFingerColor = redRatio > 0.31 && redDominance > 2;
      const saturatedButPlausible = tile.red > 120 && tile.red >= tile.green * 0.88 && tile.green > tile.blue * 0.85;
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

  // ═══════════════════════════════════════════════════════════
  // FINGER DETECTION — STRICT PHYSIOLOGICAL THRESHOLDS
  // ═══════════════════════════════════════════════════════════

  private readonly FINGER_CONFIRM_STRICT = 4;
  private readonly FINGER_LOST_STRICT = 10;

  private detectFinger(
    rawRed: number, rawGreen: number, rawBlue: number,
    coverageScore: number, spatialStability: number, tilePulseScore: number,
  ): boolean {
    const adaptiveAlpha = this.lastRescueState?.smoothingAlpha ?? this.RGB_SMOOTH_ALPHA;

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
    const totalIntensity = r + g + b;
    const rgRatio = g > 0 ? r / g : 0;
    const rbRatio = b > 0 ? r / b : 0;
    const redDominance = r - g;
    const blueAbsorption = g - b;
    const perfusionHint = Math.max(
      this.greenDC > 0 ? (this.greenAC / this.greenDC) * 100 : 0,
      this.redDC > 0 ? (this.redAC / this.redDC) * 100 : 0
    );

    const passBrightness = r > 85 && totalIntensity > 150;
    const passColor = (rgRatio > 0.98 || redDominance > 10) && (rbRatio > 1.05 || blueAbsorption > 6);
    const passCoverage = coverageScore > 0.34;
    const passSpatial = spatialStability > 0.10;
    const passTile = tilePulseScore > 0.01 || coverageScore > 0.55;
    const notSaturated = !(r > 254.5 && g > 254.5 && b > 254.5);

    const softContact = passBrightness && passColor && passCoverage && passSpatial && notSaturated;
    const strongContact = softContact && r > 110 && totalIntensity > 185 && rgRatio > 1.04;
    const pulsatileContact = softContact && perfusionHint > 0.05;

    this.contactLikely = softContact || pulsatileContact;

    const redScore = Math.max(0, Math.min(1, (r - 85) / 85));
    const ratioScore = Math.max(0, Math.min(1, (rgRatio - 0.98) / 0.35));
    const perfScore = Math.max(0, Math.min(1, perfusionHint / 0.35));
    const contactScore =
      redScore * 0.28 +
      ratioScore * 0.18 +
      Math.max(0, Math.min(1, coverageScore)) * 0.16 +
      Math.max(0, Math.min(1, spatialStability)) * 0.12 +
      Math.max(0, Math.min(1, tilePulseScore * 12)) * 0.10 +
      perfScore * 0.16;
    this.detectionConfidence = this.contactLikely ? Math.max(0.12, contactScore) : Math.max(0, this.detectionConfidence - 0.08);

    const confirmGate = strongContact || pulsatileContact || (softContact && passTile && this.redBuffer.length >= 45);

    if (confirmGate) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, this.FINGER_CONFIRM_STRICT + 6);
      if (this.fingerDetected) return true;
      return this.fingerConfidenceCount >= this.FINGER_CONFIRM_STRICT;
    }

    if (this.contactLikely) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.max(1, this.fingerConfidenceCount);
      return false;
    }

    this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 1);
    this.fingerLostCount++;
    if (this.fingerDetected) {
      return this.fingerLostCount < this.FINGER_LOST_STRICT;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // AC/DC CALCULATION
  // ═══════════════════════════════════════════════════════════

  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 60) return;

    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);

    this.redDC = redWindow.reduce((a, b) => a + b, 0) / redWindow.length;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / greenWindow.length;

    if (this.redDC < 5 || this.greenDC < 5) return;

    let redSumSq = 0, greenSumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      redSumSq += Math.pow(redWindow[i] - this.redDC, 2);
      greenSumSq += Math.pow(greenWindow[i] - this.greenDC, 2);
    }
    const redRMS = Math.sqrt(redSumSq / windowSize);
    const greenRMS = Math.sqrt(greenSumSq / windowSize);

    const sortedRed = [...redWindow].sort((a, b) => a - b);
    const sortedGreen = [...greenWindow].sort((a, b) => a - b);
    const p5 = Math.floor(windowSize * 0.05);
    const p95 = Math.floor(windowSize * 0.95);
    const redP2P = sortedRed[p95] - sortedRed[p5];
    const greenP2P = sortedGreen[p95] - sortedGreen[p5];

    const redACFromRMS = redRMS * Math.sqrt(2);
    const greenACFromRMS = greenRMS * Math.sqrt(2);

    this.redAC = (redACFromRMS + redP2P * 0.5) / 2;
    this.greenAC = (greenACFromRMS + greenP2P * 0.5) / 2;

    // No zeroing — keep small values for perfusion calculation
  }

  // ═══════════════════════════════════════════════════════════
  // DERIVATIVES
  // ═══════════════════════════════════════════════════════════

  private calculateDerivatives(): void {
    const n = this.filteredBuffer.length;
    if (n >= 3) {
      const vpg = (this.filteredBuffer[n - 1] - this.filteredBuffer[n - 3]) / 2;
      this.vpgBuffer.push(vpg);
      if (this.vpgBuffer.length > this.BUFFER_SIZE) this.vpgBuffer.shift();
    }
    if (this.vpgBuffer.length >= 3) {
      const vn = this.vpgBuffer.length;
      const apg = (this.vpgBuffer[vn - 1] - this.vpgBuffer[vn - 3]) / 2;
      this.apgBuffer.push(apg);
      if (this.apgBuffer.length > this.BUFFER_SIZE) this.apgBuffer.shift();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SIGNAL QUALITY — GATED BY FINGER DETECTION
  // ═══════════════════════════════════════════════════════════

  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 30) return 0;
    if (!this.fingerDetected && !this.contactLikely) return 0;

    const recent = this.filteredBuffer.slice(-90);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;

    if (range < 0.05) {
      return this.contactLikely ? 6 : 0;
    }

    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);

    let motionNoise = 0;
    let maxJump = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = Math.abs(recent[i] - recent[i - 1]);
      motionNoise += diff;
      if (diff > maxJump) maxJump = diff;
    }
    motionNoise /= Math.max(1, recent.length - 1);

    const snr = range / (stdDev + 0.01);
    const perfIdx = this.calculatePerfusionIndex();
    const perfusionScore = Math.max(0, Math.min(1, perfIdx / 2.0));
    const stabilityScore = Math.max(0, Math.min(1, 1 - motionNoise / (range * 0.5 + 0.01)));
    const snrScore = Math.max(0, Math.min(1, snr / 4.0));
    const jumpPenalty = Math.max(0, 1 - maxJump / (range * 0.6 + 0.01));
    const perfGate = perfIdx > 0.1 ? 1.0 : perfIdx / 0.1;

    const baseQuality = (snrScore * 35 +
      perfusionScore * 25 +
      stabilityScore * 20 +
      jumpPenalty * 20) * perfGate;

    const shapedQuality = this.fingerDetected
      ? baseQuality
      : Math.min(25, Math.max(6, baseQuality * (0.35 + this.detectionConfidence * 0.45)));

    return Math.round(Math.min(100, shapedQuality));
  }

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

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

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
    this.contactLikely = false;
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
      contactLikely: this.contactLikely,
      signalQuality: this.signalQuality,
      perfusionIndex: this.calculatePerfusionIndex(),
      smoothedRed: this.smoothedRed,
      smoothedBlue: this.smoothedBlue,
      fingerConfidenceCount: this.fingerConfidenceCount,
      fingerLostCount: this.fingerLostCount,
      bufferFill: this.filteredBuffer.length / this.BUFFER_SIZE,
      coverageScore: this.lastCoverageScore,
      spatialStability: this.lastSpatialStability,
      tilePulseScore: this.lastTilePulseScore,
      motionLevel: this.motionLevel,
      wtaWinnerId: wtaInfo.winnerId,
      wtaWinnerLabel: wtaInfo.winnerLabel,
      wtaWinnerScore: wtaInfo.winnerScore,
      wtaAllScores: wtaInfo.allScores,
      rescueLevel: rescue?.level ?? 0,
      rescueLevelLabel: this.rescueEngine.getLevelLabel(),
      rescueActive: rescue?.isRescueActive ?? false,
      pulseSource: this.lastPulseSource,
      rescueRoiFraction: rescue?.roiFraction ?? 0.72,
      rescueAgcGain: rescue?.agcGain ?? 1.0,
    };
  }
}
