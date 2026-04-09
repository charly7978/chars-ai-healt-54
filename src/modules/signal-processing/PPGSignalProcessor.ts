import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface, ContactState } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

interface ROIMetrics {
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  coverageRatio: number;
  fingerScore: number;
}

/**
 * MULTI-SOURCE PPG SIGNAL PROCESSOR
 * 
 * Mejoras clave:
 * 1. Estado de contacto 3-niveles (NO_CONTACT / UNSTABLE / STABLE)
 * 2. Selección competitiva de canal (R, G, R-G, CHROM 3R-2G)
 * 3. SQI unificado — única fuente de verdad
 * 4. Histéresis fuerte para tolerancia a temblores
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing = false;

  private bandpassFilter: BandpassFilter;

  private readonly BUFFER_SIZE = 300;
  private readonly ACDC_WINDOW = 180;
  private readonly TILE_COLUMNS = 5;
  private readonly TILE_ROWS = 5;

  // Buffers
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private vpgBuffer: number[] = [];
  private apgBuffer: number[] = [];
  private tileConfidence: number[] = new Array(25).fill(0);
  private frameIntervalBuffer: number[] = [];

  // AC/DC
  private redDC = 0;
  private redAC = 0;
  private greenDC = 0;
  private greenAC = 0;
  private blueDC = 0;
  private blueAC = 0;

  // Baselines dinámicas
  private redBaseline = 0;
  private greenBaseline = 0;
  private blueBaseline = 0;
  private estimatedSampleRate = 30;
  private lastFrameTimestamp = 0;

  private frameCount = 0;
  private lastLogTime = 0;

  // === ESTADO DE CONTACTO UNIFICADO ===
  private contactState: ContactState = 'NO_CONTACT';
  private fingerDetected = false;
  private signalQuality = 0;
  private fingerConfidenceCount = 0;
  private fingerLostCount = 0;
  private stableContactCount = 0;
  private readonly FINGER_CONFIRM_FRAMES = 5;   // ~170ms @ 30fps — balance velocidad/estabilidad
  private readonly FINGER_LOST_FRAMES = 90;     // ~3s tolerancia antes de degradar
  private readonly STABLE_THRESHOLD = 30;       // ~1s para STABLE — evitar parpadeo
  private readonly UNSTABLE_GRACE = 120;        // ~4s antes de NO_CONTACT total

  // Suavizado temporal — más lentos = más estable
  private smoothedRed = 0;
  private smoothedGreen = 0;
  private smoothedBlue = 0;
  private smoothedCoverage = 0;
  private smoothedFingerScore = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.05;       // era 0.10 — más suave
  private readonly COVERAGE_SMOOTH_ALPHA = 0.06;  // era 0.12 — más suave

  // IMU / Motion
  private motionScore = 0;
  private motionListenerActive = false;
  private lastAcceleration = { x: 0, y: 0, z: 0 };
  private readonly MOTION_THRESHOLD = 0.6;

  // === MULTI-SOURCE RANKING (CHROM eliminado — amplifica ruido sin dedo) ===
  private sourceBuffers: { [key: string]: number[] } = {};
  private activeSource: string = 'RG';
  private sourceScores: { [key: string]: number } = {};
  private lastSourceSwitch = 0;
  private readonly SOURCE_HYSTERESIS_MS = 2000;

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(this.estimatedSampleRate);
    this.sourceBuffers = { R: [], G: [], RG: [] };
    this.sourceScores = { R: 0, G: 0, RG: 0 };
  }

  async initialize(): Promise<void> {
    this.reset();
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    this.startMotionListener();
  }

  stop(): void {
    this.isProcessing = false;
    this.stopMotionListener();
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    this.updateSampleRate(timestamp);

    const roi = this.extractROI(imageData);
    this.updateContactState(roi);

    const motionArtifact = this.motionScore > this.MOTION_THRESHOLD;

    if (this.contactState === 'NO_CONTACT') {
      this.signalQuality = 0;
      this.onSignalReady({
        timestamp,
        rawValue: 0,
        filteredValue: 0,
        quality: 0,
        fingerDetected: false,
        contactState: 'NO_CONTACT',
        motionArtifact,
        roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
        perfusionIndex: 0,
        rawRed: roi.rawRed,
        rawGreen: roi.rawGreen,
        diagnostics: {
          message: `BUSCANDO DEDO C:${(roi.coverageRatio * 100).toFixed(0)}%`,
          hasPulsatility: false,
          pulsatilityValue: 0,
        },
      });
      return;
    }

    // Tenemos contacto (UNSTABLE o STABLE)
    this.updateChannelBaselines(roi.rawRed, roi.rawGreen, roi.rawBlue, motionArtifact);

    this.redBuffer.push(roi.rawRed);
    this.greenBuffer.push(roi.rawGreen);
    this.blueBuffer.push(roi.rawBlue);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }

    if (this.redBuffer.length >= 36) {
      this.calculateACDCPrecise();
    }

    // Multi-source extraction
    const pulseSource = this.extractBestPulseSignal(roi.rawRed, roi.rawGreen, roi.rawBlue, motionArtifact);

    this.rawBuffer.push(pulseSource.value);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }

    const filtered = this.bandpassFilter.filter(pulseSource.value);
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }

    this.calculateDerivatives();
    this.signalQuality = this.calculateSignalQuality();

    const perfusionIndex = this.calculatePerfusionIndex();
    const adjustedQuality = motionArtifact
      ? Math.max(0, this.signalQuality * 0.75)
      : this.signalQuality;
    const gatedQuality = this.contactState === 'STABLE_CONTACT' && perfusionIndex >= 0.005
      ? adjustedQuality
      : Math.min(18, adjustedQuality * 0.45);

    const now = Date.now();
    if (now - this.lastLogTime >= 2000) {
      this.lastLogTime = now;
      console.log(
        `📷 PPG [${pulseSource.label}] Filt=${filtered.toFixed(3)} ` +
        `Q=${gatedQuality.toFixed(0)}% PI=${perfusionIndex.toFixed(2)} ` +
        `Contact=${this.contactState} FPS=${this.estimatedSampleRate.toFixed(0)}`
      );
    }

    this.onSignalReady({
      timestamp,
      rawValue: pulseSource.value,
      filteredValue: filtered,
      quality: gatedQuality,
      fingerDetected: this.fingerDetected,
      contactState: this.contactState,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed: roi.rawRed,
      rawGreen: roi.rawGreen,
      diagnostics: {
        message:
          `${pulseSource.label}:${pulseSource.strength.toFixed(1)} ` +
          `PI:${perfusionIndex.toFixed(2)} C:${(this.smoothedCoverage * 100).toFixed(0)} ` +
          `${this.contactState}${motionArtifact ? ' MOV' : ''}`,
        hasPulsatility: this.contactState === 'STABLE_CONTACT' && perfusionIndex >= 0.05 && pulseSource.strength > 1.5,
        pulsatilityValue: this.contactState === 'STABLE_CONTACT' ? Math.max(perfusionIndex, pulseSource.strength * 0.02) : 0,
      },
    });
  }

  // === ESTADO DE CONTACTO UNIFICADO ===
  private updateContactState(roi: ROIMetrics): void {
    const previousState = this.contactState;
    const instantDetected = this.detectFingerInstant(roi);

    if (instantDetected) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, 100);
      this.stableContactCount++;

      if (this.fingerConfidenceCount >= this.FINGER_CONFIRM_FRAMES) {
        this.fingerDetected = true;
        // Require real perfusion for STABLE — not just visual contact
        const perfusion = this.calculatePerfusionIndex();
        this.contactState = (this.stableContactCount >= this.STABLE_THRESHOLD && perfusion > 0.003)
          ? 'STABLE_CONTACT'
          : 'UNSTABLE_CONTACT';
      }
    } else {
      // Decremento lento — no perder confianza por un solo frame malo
      this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 0.5);
      this.fingerLostCount++;
      // stableContactCount decrementa lento para no perder STABLE por glitches
      this.stableContactCount = Math.max(0, this.stableContactCount - 0.3);

      if (this.fingerDetected) {
        // Soft hold: mantener contacto con gracia — stricter thresholds
        const softHold =
          this.smoothedCoverage > 0.15 &&
          (this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2) > 8 &&
          this.smoothedFingerScore > 0.20 &&
          (this.smoothedRed / Math.max(1, this.smoothedGreen)) > 1.05;

        if (softHold || this.fingerLostCount < this.FINGER_LOST_FRAMES) {
          this.contactState = 'UNSTABLE_CONTACT';
        } else if (this.fingerLostCount < this.UNSTABLE_GRACE) {
          this.contactState = 'UNSTABLE_CONTACT';
          // Don't reset buffers yet
        } else {
          this.contactState = 'NO_CONTACT';
          this.fingerDetected = false;
          this.stableContactCount = 0;
          this.resetSignalTrackingBuffers();
          this.resetBaselines();
        }
      } else {
        this.contactState = 'NO_CONTACT';
      }
    }

    // Resetear buffers solo al entrar en contacto desde NO_CONTACT
    if (previousState === 'NO_CONTACT' && this.contactState !== 'NO_CONTACT') {
      this.resetSignalTrackingBuffers();
    }
  }

  private detectFingerInstant(roi: ROIMetrics): boolean {
    const { rawRed, rawGreen, rawBlue, coverageRatio, fingerScore } = roi;

    // Smooth inputs
    if (this.smoothedRed === 0) {
      this.smoothedRed = rawRed;
      this.smoothedGreen = rawGreen;
      this.smoothedBlue = rawBlue;
      this.smoothedCoverage = coverageRatio;
      this.smoothedFingerScore = fingerScore;
    } else {
      const a = this.RGB_SMOOTH_ALPHA;
      const ca = this.COVERAGE_SMOOTH_ALPHA;
      this.smoothedRed = this.smoothedRed * (1 - a) + rawRed * a;
      this.smoothedGreen = this.smoothedGreen * (1 - a) + rawGreen * a;
      this.smoothedBlue = this.smoothedBlue * (1 - a) + rawBlue * a;
      this.smoothedCoverage = this.smoothedCoverage * (1 - ca) + coverageRatio * ca;
      this.smoothedFingerScore = this.smoothedFingerScore * (1 - ca) + fingerScore * ca;
    }

    const r = this.smoothedRed;
    const g = this.smoothedGreen;
    const b = this.smoothedBlue;
    const totalIntensity = r + g + b;
    const redDominance = r - (g + b) / 2;
    const rgRatio = r / Math.max(1, g);
    const notBlownOut = !(r > 253 && g > 252 && b > 252);

    // === HEMOGLOBIN SIGNATURE: red MUST dominate when finger+flash ===
    if (this.fingerDetected) {
      // MAINTAIN contact — slightly relaxed thresholds
      const maintainContact =
        r > 50 &&
        rgRatio > 1.1 &&
        redDominance > 12 &&
        this.smoothedCoverage > 0.20 &&
        this.smoothedFingerScore > 0.20 &&
        notBlownOut;
      return maintainContact;
    } else {
      // ACQUIRE contact — strict hemoglobin thresholds
      const acquireContact =
        r > 80 &&
        rgRatio > 1.2 &&
        redDominance > 20 &&
        totalIntensity > 120 && totalIntensity < 760 &&
        this.smoothedCoverage > 0.35 &&
        this.smoothedFingerScore > 0.40 &&
        this.motionScore < 1.5 &&
        notBlownOut;
      return acquireContact;
    }
  }

  private updateSampleRate(timestamp: number): void {
    if (this.lastFrameTimestamp === 0) {
      this.lastFrameTimestamp = timestamp;
      return;
    }

    const delta = timestamp - this.lastFrameTimestamp;
    this.lastFrameTimestamp = timestamp;

    if (delta < 10 || delta > 100) return;

    this.frameIntervalBuffer.push(delta);
    if (this.frameIntervalBuffer.length > 30) {
      this.frameIntervalBuffer.shift();
    }

    if (this.frameIntervalBuffer.length < 8) return;

    const sorted = [...this.frameIntervalBuffer].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 33;
    const estimatedFps = this.clamp(1000 / median, 20, 40);

    if (Math.abs(estimatedFps - this.estimatedSampleRate) > 2) {
      this.estimatedSampleRate = estimatedFps;
      this.bandpassFilter.setSampleRate(this.estimatedSampleRate);
    }
  }

  private extractROI(imageData: ImageData): ROIMetrics {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    const roiSize = Math.min(width, height) * 0.78;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);

    const tiles = Array.from({ length: this.TILE_COLUMNS * this.TILE_ROWS }, () => ({
      red: 0, green: 0, blue: 0, count: 0,
    }));

    const roiWidth = Math.max(1, endX - startX);
    const roiHeight = Math.max(1, endY - startY);

    // Sample every 3rd pixel for performance
    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
        const i = (y * width + x) * 4;
        const tileX = Math.min(this.TILE_COLUMNS - 1, Math.floor(((x - startX) / roiWidth) * this.TILE_COLUMNS));
        const tileY = Math.min(this.TILE_ROWS - 1, Math.floor(((y - startY) / roiHeight) * this.TILE_ROWS));
        const tile = tiles[tileY * this.TILE_COLUMNS + tileX];

        tile.red += data[i];
        tile.green += data[i + 1];
        tile.blue += data[i + 2];
        tile.count++;
      }
    }

    const averagedTiles = tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.count > 0)
      .map(({ tile, index }) => {
        const red = tile.red / tile.count;
        const green = tile.green / tile.count;
        const blue = tile.blue / tile.count;
        const total = red + green + blue;
        const redDominance = red - (green + blue) / 2;
        const rednessRatio = red / Math.max(1, green);
        const gridX = index % this.TILE_COLUMNS;
        const gridY = Math.floor(index / this.TILE_COLUMNS);
        const normX = this.TILE_COLUMNS <= 1 ? 0 : gridX / (this.TILE_COLUMNS - 1);
        const normY = this.TILE_ROWS <= 1 ? 0 : gridY / (this.TILE_ROWS - 1);
        const distanceFromCenter = Math.sqrt((normX - 0.5) ** 2 + (normY - 0.5) ** 2);
        const centerBias = this.clamp(1 - distanceFromCenter * 1.2, 0.3, 1);

        const brightnessScore = this.clamp((total - 120) / 220, 0, 1);
        const redRatioScore = this.clamp((rednessRatio - 1.02) / 0.85, 0, 1);
        const dominanceScore = this.clamp((redDominance - 10) / 35, 0, 1);
        const frameScore = redRatioScore * 0.45 + dominanceScore * 0.4 + brightnessScore * 0.15;

        this.tileConfidence[index] = this.tileConfidence[index] * 0.75 + frameScore * centerBias * 0.25;
        const combinedScore = this.tileConfidence[index] * 0.7 + frameScore * 0.3;

        return { red, green, blue, total, redDominance, rednessRatio, centerBias, frameScore, combinedScore, temporalScore: this.tileConfidence[index] };
      });

    if (averagedTiles.length === 0) {
      return { rawRed: 0, rawGreen: 0, rawBlue: 0, coverageRatio: 0, fingerScore: 0 };
    }

    const fingerTiles = averagedTiles.filter((tile) =>
      tile.red > 55 &&
      tile.total > 120 &&
      tile.redDominance > 12 &&
      tile.rednessRatio > 1.08 &&
      tile.combinedScore > 0.42
    );

    const selectedTiles = fingerTiles.length >= 5
      ? fingerTiles
      : averagedTiles;

    const weightedAverage = (channel: 'red' | 'green' | 'blue') => {
      let ws = 0, tw = 0;
      for (const tile of selectedTiles) {
        const w = 0.3 + tile.combinedScore * 2 + tile.centerBias * 0.4;
        ws += tile[channel] * w;
        tw += w;
      }
      return tw > 0 ? ws / tw : averagedTiles.reduce((s, t) => s + t[channel], 0) / averagedTiles.length;
    };

    const coverageRatio = fingerTiles.length / averagedTiles.length;
    const avgFingerScore = fingerTiles.length > 0
      ? fingerTiles.reduce((s, t) => s + t.combinedScore, 0) / fingerTiles.length
      : 0;

    return {
      rawRed: weightedAverage('red'),
      rawGreen: weightedAverage('green'),
      rawBlue: weightedAverage('blue'),
      coverageRatio,
      fingerScore: avgFingerScore,
    };
  }

  private updateChannelBaselines(rawRed: number, rawGreen: number, rawBlue: number, motionArtifact: boolean): void {
    if (this.redBaseline === 0) {
      this.redBaseline = rawRed;
      this.greenBaseline = rawGreen;
      this.blueBaseline = rawBlue;
      return;
    }

    const alpha = motionArtifact ? 0.008 : this.contactState === 'STABLE_CONTACT' ? 0.02 : 0.04;
    this.redBaseline = this.redBaseline * (1 - alpha) + rawRed * alpha;
    this.greenBaseline = this.greenBaseline * (1 - alpha) + rawGreen * alpha;
    this.blueBaseline = this.blueBaseline * (1 - alpha) + rawBlue * alpha;
  }

  // === MULTI-SOURCE COMPETITIVE EXTRACTION ===
  private extractBestPulseSignal(
    rawRed: number, rawGreen: number, rawBlue: number, motionArtifact: boolean
  ): { value: number; label: string; strength: number } {
    const rNorm = this.redBaseline > 0 ? (this.redBaseline - rawRed) / this.redBaseline : 0;
    const gNorm = this.greenBaseline > 0 ? (this.greenBaseline - rawGreen) / this.greenBaseline : 0;
    const bNorm = this.blueBaseline > 0 ? (this.blueBaseline - rawBlue) / this.blueBaseline : 0;

    const clamp = (v: number) => this.clamp(v, -0.04, 0.04);
    const rPulse = clamp(rNorm);
    const gPulse = clamp(gNorm);

    // Source candidates (CHROM removed — amplifies noise without finger)
    const sources: { [key: string]: number } = {
      R: rPulse * 3200,
      G: gPulse * 3200,
      RG: this.blendRG(rPulse, gPulse, rawRed, rawGreen, motionArtifact) * 3200,
    };

    // Update per-source buffers
    for (const key of Object.keys(sources)) {
      this.sourceBuffers[key].push(sources[key]);
      if (this.sourceBuffers[key].length > 120) {
        this.sourceBuffers[key].shift();
      }
    }

    // Rank sources every ~1 second (30 frames)
    if (this.frameCount % 30 === 0 && this.redBuffer.length >= 60) {
      this.rankSources();
    }

    const value = this.clamp(sources[this.activeSource] ?? sources['RG'], -80, 80);
    const strength = Math.max(Math.abs(rPulse), Math.abs(gPulse)) * 1000;

    return { value, label: this.activeSource, strength };
  }

  private blendRG(rPulse: number, gPulse: number, rawRed: number, rawGreen: number, motionArtifact: boolean): number {
    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;
    const piSum = redPI + greenPI;

    let greenWeight = 0.55;
    let redWeight = 0.45;

    if (piSum > 0) {
      greenWeight = this.clamp(greenPI / piSum, 0.25, 0.8);
      redWeight = 1 - greenWeight;
    }

    // Clipping penalties
    if (rawGreen > 245) { greenWeight *= 0.4; redWeight = 1 - greenWeight; }
    if (rawRed > 245) { redWeight *= 0.4; greenWeight = 1 - redWeight; }
    if (motionArtifact) { greenWeight = this.clamp(greenWeight + 0.05, 0.3, 0.8); redWeight = 1 - greenWeight; }

    return rPulse * redWeight + gPulse * greenWeight;
  }

  private rankSources(): void {
    const now = Date.now();
    // Hysteresis: don't switch too often
    if (now - this.lastSourceSwitch < this.SOURCE_HYSTERESIS_MS) return;

    let bestSource = this.activeSource;
    let bestScore = -1;

    for (const key of Object.keys(this.sourceBuffers)) {
      const buf = this.sourceBuffers[key];
      if (buf.length < 45) continue;

      const recent = buf.slice(-90);
      const score = this.computeSourceScore(recent);
      this.sourceScores[key] = score;

      if (score > bestScore) {
        bestScore = score;
        bestSource = key;
      }
    }

    // Only switch if new source is significantly better (>20%)
    const currentScore = this.sourceScores[this.activeSource] ?? 0;
    if (bestSource !== this.activeSource && bestScore > currentScore * 1.2) {
      this.activeSource = bestSource;
      this.lastSourceSwitch = now;
    }
  }

  private computeSourceScore(buffer: number[]): number {
    if (buffer.length < 30) return 0;

    const sorted = [...buffer].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const range = p90 - p10;
    if (range < 0.3) return 0;

    const mean = buffer.reduce((a, b) => a + b, 0) / buffer.length;
    const variance = buffer.reduce((a, v) => a + (v - mean) ** 2, 0) / buffer.length;
    const snr = range / (Math.sqrt(variance) + 0.1);

    // Check for clipping
    const clipped = buffer.filter(v => Math.abs(v) > 70).length / buffer.length;
    const clipPenalty = clipped * 30;

    return Math.max(0, snr * 15 - clipPenalty);
  }

  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 36) return;

    const redW = this.redBuffer.slice(-windowSize);
    const greenW = this.greenBuffer.slice(-windowSize);
    const blueW = this.blueBuffer.slice(-windowSize);

    this.redDC = redW.reduce((a, b) => a + b, 0) / redW.length;
    this.greenDC = greenW.reduce((a, b) => a + b, 0) / greenW.length;
    this.blueDC = blueW.reduce((a, b) => a + b, 0) / blueW.length;

    if (this.redDC < 5 || this.greenDC < 5) return;

    const computeAC = (window: number[], dc: number) => {
      let sumSq = 0;
      for (let i = 0; i < window.length; i++) {
        sumSq += (window[i] - dc) ** 2;
      }
      const rms = Math.sqrt(sumSq / window.length);
      const sorted = [...window].sort((a, b) => a - b);
      const p5 = sorted[Math.floor(window.length * 0.05)] ?? 0;
      const p95 = sorted[Math.floor(window.length * 0.95)] ?? 0;
      const p2p = p95 - p5;
      return (rms * Math.sqrt(2) + p2p * 0.5) / 2;
    };

    this.redAC = computeAC(redW, this.redDC);
    this.greenAC = computeAC(greenW, this.greenDC);
    this.blueAC = computeAC(blueW, this.blueDC);

    const redPI = this.redAC / this.redDC;
    const greenPI = this.greenAC / this.greenDC;

    if (redPI < 0.0001 || greenPI < 0.0001) {
      this.redAC = 0;
      this.greenAC = 0;
    }
  }

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

  // === SQI UNIFICADO - ÚNICA FUENTE DE VERDAD ===
  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 24) return 0;
    if (this.contactState === 'NO_CONTACT') return 0;

    const perfusionIndex = this.calculatePerfusionIndex();
    const redDominance = this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2;

    // Gate: no perfusion = no real signal
    if (perfusionIndex < 0.005) return Math.min(15, this.smoothedCoverage * 20);
    // Gate: red must dominate (hemoglobin signature)
    if (redDominance < 15) return 0;

    const recent = this.filteredBuffer.slice(-90);
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? 0;
    const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
    const range = p90 - p10;

    if (range < 0.3) return 5;

    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, v) => a + (v - mean) ** 2, 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    const snr = range / (stdDev + 0.15);

    const snrScore = Math.min(35, snr * 11);
    const perfusionScore = Math.min(25, perfusionIndex * 12);
    const coverageScore = Math.min(18, this.smoothedCoverage * 30);
    const fingerScore = Math.min(18, this.smoothedFingerScore * 26);
    const motionPenalty = Math.min(20, this.motionScore * 16);

    // Bonus for stable contact + pulsatility evidence
    const stabilityBonus = this.contactState === 'STABLE_CONTACT' ? 5 : 0;
    const pulsatilityBonus = (this.redAC > 0 || this.greenAC > 0) ? 4 : 0;

    return this.clamp(snrScore + perfusionScore + coverageScore + fingerScore - motionPenalty + stabilityBonus + pulsatilityBonus, 0, 100);
  }

  private calculatePerfusionIndex(): number {
    if (this.greenDC > 0) return (this.greenAC / this.greenDC) * 100;
    if (this.redDC > 0) return (this.redAC / this.redDC) * 100;
    return 0;
  }

  private resetBaselines(): void {
    this.redBaseline = 0;
    this.greenBaseline = 0;
    this.blueBaseline = 0;
  }

  private resetSignalTrackingBuffers(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.redDC = 0; this.redAC = 0;
    this.greenDC = 0; this.greenAC = 0;
    this.blueDC = 0; this.blueAC = 0;
    this.sourceBuffers = { R: [], G: [], RG: [] };
    this.bandpassFilter.reset();
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.tileConfidence = new Array(25).fill(0);
    this.frameIntervalBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.lastFrameTimestamp = 0;
    this.estimatedSampleRate = 30;
    this.fingerDetected = false;
    this.contactState = 'NO_CONTACT';
    this.signalQuality = 0;
    this.fingerConfidenceCount = 0;
    this.fingerLostCount = 0;
    this.stableContactCount = 0;
    this.smoothedRed = 0;
    this.smoothedGreen = 0;
    this.smoothedBlue = 0;
    this.smoothedCoverage = 0;
    this.smoothedFingerScore = 0;
    this.redDC = 0; this.redAC = 0;
    this.greenDC = 0; this.greenAC = 0;
    this.blueDC = 0; this.blueAC = 0;
    this.motionScore = 0;
    this.lastAcceleration = { x: 0, y: 0, z: 0 };
    this.sourceBuffers = { R: [], G: [], RG: [] };
    this.sourceScores = { R: 0, G: 0, RG: 0 };
    this.activeSource = 'RG';
    this.lastSourceSwitch = 0;
    this.resetBaselines();
    this.bandpassFilter.setSampleRate(this.estimatedSampleRate);
    this.bandpassFilter.reset();
  }

  private handleMotionEvent = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

    const dx = (acc.x ?? 0) - this.lastAcceleration.x;
    const dy = (acc.y ?? 0) - this.lastAcceleration.y;
    const dz = (acc.z ?? 0) - this.lastAcceleration.z;

    this.lastAcceleration = { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 };

    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rot = event.rotationRate;
    let gyroRMS = 0;

    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      gyroRMS = Math.sqrt((rot.alpha ?? 0) ** 2 + (rot.beta ?? 0) ** 2 + (rot.gamma ?? 0) ** 2) / 120;
    }

    const rawScore = accelRMS * 0.5 + gyroRMS * 0.3;
    this.motionScore = this.motionScore * 0.85 + rawScore * 0.15;
  };

  private startMotionListener(): void {
    if (this.motionListenerActive) return;
    try {
      if (typeof DeviceMotionEvent !== 'undefined') {
        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
          (DeviceMotionEvent as any).requestPermission()
            .then((state: string) => {
              if (state === 'granted') {
                window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
                this.motionListenerActive = true;
              }
            })
            .catch(() => {});
        } else {
          window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
          this.motionListenerActive = true;
        }
      }
    } catch {}
  }

  private stopMotionListener(): void {
    if (!this.motionListenerActive) return;
    window.removeEventListener('devicemotion', this.handleMotionEvent);
    this.motionListenerActive = false;
    this.motionScore = 0;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  getRGBStats() {
    return {
      redAC: this.redAC, redDC: this.redDC,
      greenAC: this.greenAC, greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios: this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0
        ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC)
        : 0,
    };
  }
}
