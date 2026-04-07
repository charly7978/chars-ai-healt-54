/**
 * PPG SIGNAL EXTRACTOR — Extracción seria de señal PPG desde frames de cámara.
 *
 * - ROI central configurable con muestreo por tiles
 * - Green como primary, weighted RGB como fallback
 * - Selección automática, explicable y trazable
 * - Pipeline: detrending → DC removal → normalize → bandpass → reject flatline/clipping
 */
import { PPG_CONFIG } from '../config/ppgConfig';
import { BandpassFilter } from './signal-processing/BandpassFilter';
import type {
  FrameRGBData,
  ExtractedSignal,
  SignalSourceLabel,
} from '../types/ppg-types';

const S = PPG_CONFIG.signal;
const CAM = PPG_CONFIG.camera;

export class PPGSignalExtractor {
  private bandpassFilter: BandpassFilter;

  // Buffers
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private rawSignalBuffer: number[] = [];
  private filteredBuffer: number[] = [];

  // Baselines
  private redBaseline = 0;
  private greenBaseline = 0;
  private blueBaseline = 0;

  // AC/DC
  redDC = 0; redAC = 0;
  greenDC = 0; greenAC = 0;
  blueDC = 0; blueAC = 0;

  // Source selection
  private activeSource: SignalSourceLabel = 'GREEN';
  private lastSourceSwitchTime = 0;
  private sourceReason = 'initial';

  // Tile confidence
  private tileConfidence: number[] = new Array(CAM.roiTileGrid * CAM.roiTileGrid).fill(0);

  // Diagnostics
  private clippingRate = 0;
  private flatlineDetected = false;

  constructor(private sampleRate: number = 30) {
    this.bandpassFilter = new BandpassFilter(sampleRate);
  }

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.bandpassFilter.setSampleRate(rate);
  }

  /**
   * Extract ROI data from raw ImageData
   */
  extractFrameData(imageData: ImageData): FrameRGBData {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const grid = CAM.roiTileGrid;
    const roiSize = Math.min(w, h) * S.bufferSize > 0 ? CAM.roiSizeFraction : 0.72; // Use config fraction
    const actualRoiSize = Math.min(w, h) * CAM.roiSizeFraction;
    const startX = Math.floor((w - actualRoiSize) / 2);
    const startY = Math.floor((h - actualRoiSize) / 2);
    const endX = startX + Math.floor(actualRoiSize);
    const endY = startY + Math.floor(actualRoiSize);
    const roiW = Math.max(1, endX - startX);
    const roiH = Math.max(1, endY - startY);

    const tiles = Array.from({ length: grid * grid }, () => ({
      r: 0, g: 0, b: 0, count: 0, saturated: 0, nearBlack: 0,
    }));

    // Sample every 3rd pixel
    let totalPixels = 0;
    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];

        const tileX = Math.min(grid - 1, Math.floor(((x - startX) / roiW) * grid));
        const tileY = Math.min(grid - 1, Math.floor(((y - startY) / roiH) * grid));
        const tile = tiles[tileY * grid + tileX];

        tile.r += r; tile.g += g; tile.b += b; tile.count++;
        if (r > S.clippingValueThreshold && g > S.clippingValueThreshold) tile.saturated++;
        if (r < 15 && g < 15 && b < 15) tile.nearBlack++;
        totalPixels++;
      }
    }

    // Compute per-tile averages and select best tiles
    const avgTiles = tiles
      .filter(t => t.count > 0)
      .map((t, idx) => {
        const r = t.r / t.count;
        const g = t.g / t.count;
        const b = t.b / t.count;
        const redDom = r - (g + b) / 2;
        const rgRatio = r / Math.max(1, g);
        const gx = idx % grid, gy = Math.floor(idx / grid);
        const dist = Math.sqrt(((gx / (grid - 1)) - 0.5) ** 2 + ((gy / (grid - 1)) - 0.5) ** 2);
        const centerBias = Math.max(0.3, 1 - dist * 1.2);
        const brightnessScore = clamp((r + g + b - 80) / 400, 0, 1);
        const redScore = clamp((rgRatio - 0.8) / 0.9, 0, 1) * 0.4 + clamp((redDom - 3) / 28, 0, 1) * 0.4 + brightnessScore * 0.2;

        this.tileConfidence[idx] = this.tileConfidence[idx] * 0.75 + redScore * centerBias * 0.25;

        return { r, g, b, redDom, combinedScore: this.tileConfidence[idx] * 0.7 + redScore * 0.3, centerBias,
          saturated: t.saturated, nearBlack: t.nearBlack, count: t.count };
      });

    // Select top tiles
    const sorted = [...avgTiles].sort((a, b) => b.combinedScore - a.combinedScore);
    const selected = sorted.slice(0, Math.max(7, Math.round(sorted.length * 0.55)));

    const weightedAvg = (ch: 'r' | 'g' | 'b') => {
      let ws = 0, tw = 0;
      for (const t of selected) {
        const w2 = 0.3 + t.combinedScore * 2 + t.centerBias * 0.4;
        ws += t[ch] * w2; tw += w2;
      }
      return tw > 0 ? ws / tw : 0;
    };

    const meanR = weightedAvg('r');
    const meanG = weightedAvg('g');
    const meanB = weightedAvg('b');
    const totalSat = avgTiles.reduce((s, t) => s + t.saturated, 0);
    const totalBlack = avgTiles.reduce((s, t) => s + t.nearBlack, 0);

    // Uniformity: how similar are tile scores
    const scores = avgTiles.map(t => t.combinedScore);
    const sMean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sVar = scores.reduce((a, v) => a + (v - sMean) ** 2, 0) / scores.length;
    const uniformity = Math.max(0, 1 - Math.sqrt(sVar) * 4);

    return {
      timestamp: Date.now(),
      meanR, meanG, meanB,
      medianR: meanR, medianG: meanG, medianB: meanB, // approximation
      brightness: meanR + meanG + meanB,
      saturationCount: totalSat,
      nearBlackCount: totalBlack,
      totalPixels,
      uniformity,
    };
  }

  /**
   * Extract PPG signal from frame data. Returns raw + filtered value.
   */
  extract(frameData: FrameRGBData, motionArtifact: boolean): {
    extracted: ExtractedSignal;
    filtered: number;
    perfusionIndex: number;
    clippingRate: number;
    flatline: boolean;
  } {
    const { meanR, meanG, meanB } = frameData;

    // Update buffers
    this.redBuffer.push(meanR);
    this.greenBuffer.push(meanG);
    this.blueBuffer.push(meanB);
    if (this.redBuffer.length > S.bufferSize) {
      this.redBuffer.shift(); this.greenBuffer.shift(); this.blueBuffer.shift();
    }

    // Update baselines
    this.updateBaselines(meanR, meanG, meanB, motionArtifact);

    // Update AC/DC
    if (this.redBuffer.length >= 36) this.computeACDC();

    // Source selection
    const extracted = this.selectAndExtract(meanR, meanG, meanB, motionArtifact);

    // Store raw
    this.rawSignalBuffer.push(extracted.value);
    if (this.rawSignalBuffer.length > S.bufferSize) this.rawSignalBuffer.shift();

    // Bandpass filter
    const filtered = this.bandpassFilter.filter(extracted.value);
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > S.bufferSize) this.filteredBuffer.shift();

    // Clipping rate
    this.clippingRate = this.computeClippingRate();

    // Flatline
    this.flatlineDetected = this.checkFlatline();

    // Perfusion
    const perfusionIndex = this.greenDC > 0 ? (this.greenAC / this.greenDC) * 100 : 0;

    return { extracted, filtered, perfusionIndex, clippingRate: this.clippingRate, flatline: this.flatlineDetected };
  }

  private selectAndExtract(r: number, g: number, b: number, motion: boolean): ExtractedSignal {
    const rNorm = this.redBaseline > 0 ? (this.redBaseline - r) / this.redBaseline : 0;
    const gNorm = this.greenBaseline > 0 ? (this.greenBaseline - g) / this.greenBaseline : 0;

    const greenVal = clamp(gNorm, -0.04, 0.04) * 3200;
    const redVal = clamp(rNorm, -0.04, 0.04) * 3200;

    // Evaluate green quality
    const greenClipping = g > S.clippingValueThreshold;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;
    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;

    // Default: GREEN primary
    let value = greenVal;
    let source: SignalSourceLabel = 'GREEN';
    let reason = 'green_primary_ok';

    const now = Date.now();
    const canSwitch = now - this.lastSourceSwitchTime > S.sourceHysteresisMs;

    // Check if green is degraded
    if (greenClipping || (greenPI < 0.0005 && redPI > greenPI * 2)) {
      if (canSwitch || this.activeSource !== 'GREEN') {
        // Blend or switch
        if (redPI > greenPI * S.sourceImprovementFactor) {
          // Weighted blend
          const totalPI = redPI + greenPI;
          const gw = totalPI > 0 ? clamp(greenPI / totalPI, 0.2, 0.8) : 0.5;
          const rw = 1 - gw;
          value = redVal * rw + greenVal * gw;
          if (motion) { value = greenVal * 0.6 + redVal * 0.4; }
          source = 'RG_BLEND';
          reason = greenClipping ? 'green_clipping_blend' : 'red_better_perfusion';
          if (canSwitch) this.lastSourceSwitchTime = now;
        }
      }
    }

    this.activeSource = source;
    this.sourceReason = reason;

    return {
      value: clamp(value, -S.maxClampValue, S.maxClampValue),
      source,
      reason,
      rawR: r, rawG: g, rawB: b,
      rawBrightness: r + g + b,
    };
  }

  private updateBaselines(r: number, g: number, b: number, motion: boolean): void {
    if (this.redBaseline === 0) {
      this.redBaseline = r; this.greenBaseline = g; this.blueBaseline = b;
      return;
    }
    const alpha = motion ? S.baselineAlphaMotion : S.baselineAlpha;
    this.redBaseline = this.redBaseline * (1 - alpha) + r * alpha;
    this.greenBaseline = this.greenBaseline * (1 - alpha) + g * alpha;
    this.blueBaseline = this.blueBaseline * (1 - alpha) + b * alpha;
  }

  private computeACDC(): void {
    const wSize = Math.min(S.acdcWindowSize, this.redBuffer.length);
    const rW = this.redBuffer.slice(-wSize);
    const gW = this.greenBuffer.slice(-wSize);
    const bW = this.blueBuffer.slice(-wSize);

    this.redDC = rW.reduce((a, b) => a + b, 0) / rW.length;
    this.greenDC = gW.reduce((a, b) => a + b, 0) / gW.length;
    this.blueDC = bW.reduce((a, b) => a + b, 0) / bW.length;

    if (this.redDC < 5 || this.greenDC < 5) return;

    const computeAC = (buf: number[], dc: number) => {
      let sumSq = 0;
      for (const v of buf) sumSq += (v - dc) ** 2;
      const rms = Math.sqrt(sumSq / buf.length);
      const sorted = [...buf].sort((a, b) => a - b);
      const p5 = sorted[Math.floor(buf.length * 0.05)] ?? 0;
      const p95 = sorted[Math.floor(buf.length * 0.95)] ?? 0;
      return (rms * Math.SQRT2 + (p95 - p5) * 0.5) / 2;
    };

    this.redAC = computeAC(rW, this.redDC);
    this.greenAC = computeAC(gW, this.greenDC);
    this.blueAC = computeAC(bW, this.blueDC);

    if ((this.redAC / this.redDC) < 0.0002 || (this.greenAC / this.greenDC) < 0.0002) {
      this.redAC = 0; this.greenAC = 0;
    }
  }

  private computeClippingRate(): number {
    if (this.redBuffer.length < 30) return 0;
    const recent = this.redBuffer.slice(-90);
    const clipped = recent.filter(v => v > S.clippingValueThreshold).length;
    return clipped / recent.length;
  }

  private checkFlatline(): boolean {
    if (this.filteredBuffer.length < S.flatlineWindowFrames) return false;
    const window = this.filteredBuffer.slice(-S.flatlineWindowFrames);
    let min = window[0], max = window[0];
    for (const v of window) { if (v < min) min = v; if (v > max) max = v; }
    return (max - min) < S.flatlineThresholdRange;
  }

  getFilteredBuffer(): number[] { return this.filteredBuffer; }
  getRawBuffer(): number[] { return this.rawSignalBuffer; }
  getActiveSource(): SignalSourceLabel { return this.activeSource; }
  getSourceReason(): string { return this.sourceReason; }

  reset(): void {
    this.redBuffer = []; this.greenBuffer = []; this.blueBuffer = [];
    this.rawSignalBuffer = []; this.filteredBuffer = [];
    this.redBaseline = 0; this.greenBaseline = 0; this.blueBaseline = 0;
    this.redDC = 0; this.redAC = 0;
    this.greenDC = 0; this.greenAC = 0;
    this.blueDC = 0; this.blueAC = 0;
    this.activeSource = 'GREEN'; this.lastSourceSwitchTime = 0; this.sourceReason = 'reset';
    this.tileConfidence = new Array(CAM.roiTileGrid * CAM.roiTileGrid).fill(0);
    this.clippingRate = 0; this.flatlineDetected = false;
    this.bandpassFilter.reset();
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
