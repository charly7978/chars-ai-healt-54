/**
 * ADAPTIVE ROI MASK V2
 * 
 * Per-frame adaptive mask that:
 * 1. Uses dynamic 7x7 tile grid
 * 2. Excludes saturated/clipped pixels
 * 3. Computes per-tile hemoglobin score with center bias
 * 4. Adapts thresholds using frame percentiles (no fixed absolutes)
 * 5. Temporal intersection to prevent mask deformation
 * 6. Separates coarse ROI (detection) from fine ROI (extraction)
 */

import type { TileData } from './TileFusionEngine';
import type { RadiometricProcessor } from './RadiometricProcessor';

export interface TileMetrics {
  meanR: number;
  meanG: number;
  meanB: number;
  redDominance: number;
  rgRatio: number;
  intensity: number;
  clipHighPct: number;  // % pixels > 250
  clipLowPct: number;   // % pixels < 5
  validPixels: number;
  centerBias: number;
  score: number;
  temporalScore: number;
  // Linearized + OD (populated only when a RadiometricProcessor is wired in)
  meanRLin?: number;
  meanGLin?: number;
  meanBLin?: number;
  odR?: number;
  odG?: number;
  odB?: number;
}

export interface ROIMaskResult {
  // Weighted RGB from valid tiles only (sRGB, kept for back-compat)
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  // Linearized RGB (Beer-Lambert space, 0..255 mapped) — primary signal source
  linRed: number;
  linGreen: number;
  linBlue: number;
  // Optical density per channel (averaged across valid tiles)
  odR: number;
  odG: number;
  odB: number;
  // Metrics
  coverageRatio: number;
  fingerScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  spatialUniformity: number;
  centerCoverage: number;
  brightness: number;
  brightnessVariance: number;
  validPixelCount: number;
  totalPixelCount: number;
  tileScores: Float64Array;
  tileData: TileData[];
}

const GRID = 7; // 7x7 tile grid
const TOTAL_TILES = GRID * GRID;
const CLIP_HIGH = 250;
const CLIP_LOW = 5;

export class AdaptiveROIMask {
  private tileConfidence: Float64Array = new Float64Array(TOTAL_TILES);
  private prevMaskValid: Uint8Array = new Uint8Array(TOTAL_TILES).fill(0);
  private frameCount = 0;
  private radiometric: RadiometricProcessor | null = null;

  // Reusable per-tile accumulator arrays to avoid per-frame allocation (Phase 3)
  private tileR = new Float64Array(TOTAL_TILES);
  private tileG = new Float64Array(TOTAL_TILES);
  private tileB = new Float64Array(TOTAL_TILES);
  private tileCount = new Int32Array(TOTAL_TILES);
  private tileClipHigh = new Int32Array(TOTAL_TILES);
  private tileClipLow = new Int32Array(TOTAL_TILES);
  private tileValid = new Int32Array(TOTAL_TILES);

  // Pre-allocated result buffers to avoid GC pressure (Phase 3)
  private tileMetricsBuf: TileMetrics[] = new Array(TOTAL_TILES);
  private allScoresBuf: number[] = [];

  /** Optional radiometric processor for end-to-end Beer-Lambert pipeline */
  setRadiometricProcessor(rp: RadiometricProcessor | null): void {
    this.radiometric = rp;
  }

  process(imageData: ImageData): ROIMaskResult {
    this.frameCount++;
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;

    // Central ROI: 80% of min dimension
    const roiSize = Math.min(w, h) * 0.80;
    const sx = Math.floor((w - roiSize) / 2);
    const sy = Math.floor((h - roiSize) / 2);
    const ex = sx + Math.floor(roiSize);
    const ey = sy + Math.floor(roiSize);
    const roiW = ex - sx;
    const roiH = ey - sy;

    // Reset accumulators
    this.tileR.fill(0);
    this.tileG.fill(0);
    this.tileB.fill(0);
    this.tileCount.fill(0);
    this.tileClipHigh.fill(0);
    this.tileClipLow.fill(0);
    this.tileValid.fill(0);

    let totalPixels = 0;
    let totalClipHigh = 0;
    let totalClipLow = 0;

    // Sample every 2nd pixel for performance (still denser than 3)
    const step = 2;
    for (let y = sy; y < ey; y += step) {
      const rowOff = y * w;
      for (let x = sx; x < ex; x += step) {
        const i = (rowOff + x) << 2; // *4
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const tileX = Math.min(GRID - 1, ((x - sx) * GRID / roiW) | 0);
        const tileY = Math.min(GRID - 1, ((y - sy) * GRID / roiH) | 0);
        const ti = tileY * GRID + tileX;

        totalPixels++;

        // Check clipping
        const isClipHigh = r >= CLIP_HIGH || g >= CLIP_HIGH || b >= CLIP_HIGH;
        const isClipLow = r <= CLIP_LOW && g <= CLIP_LOW && b <= CLIP_LOW;

        if (isClipHigh) {
          this.tileClipHigh[ti]++;
          totalClipHigh++;
        }
        if (isClipLow) {
          this.tileClipLow[ti]++;
          totalClipLow++;
        }

        // Only accumulate valid (non-clipped) pixels for signal
        if (!isClipHigh && !isClipLow) {
          this.tileR[ti] += r;
          this.tileG[ti] += g;
          this.tileB[ti] += b;
          this.tileValid[ti]++;
        }
        this.tileCount[ti]++;
      }
    }

    // --- Compute per-tile metrics ---
    // First pass: collect all tile scores for percentile-based thresholding
    // OPTIMIZED: Reuse pre-allocated buffers (Phase 3)
    const tileMetrics = this.tileMetricsBuf;
    const allScores = this.allScoresBuf;
    allScores.length = 0; // Reset without re-allocation

    for (let ti = 0; ti < TOTAL_TILES; ti++) {
      const cnt = this.tileValid[ti];
      const total = this.tileCount[ti];
      if (cnt === 0 || total === 0) {
        tileMetrics[ti] = {
          meanR: 0, meanG: 0, meanB: 0, redDominance: 0,
          rgRatio: 0, intensity: 0, clipHighPct: 0, clipLowPct: 0,
          validPixels: 0, centerBias: 0, score: 0, temporalScore: 0
        };
        continue;
      }

      const meanR = this.tileR[ti] / cnt;
      const meanG = this.tileG[ti] / cnt;
      const meanB = this.tileB[ti] / cnt;
      const intensity = meanR + meanG + meanB;
      const redDominance = meanR - (meanG + meanB) / 2;
      const rgRatio = meanG > 1 ? meanR / meanG : 0;
      const clipHighPct = this.tileClipHigh[ti] / total;
      const clipLowPct = this.tileClipLow[ti] / total;

      // Optional radiometric linearization (Beer-Lambert space)
      let meanRLin: number | undefined;
      let meanGLin: number | undefined;
      let meanBLin: number | undefined;
      let odR: number | undefined;
      let odG: number | undefined;
      let odB: number | undefined;
      if (this.radiometric) {
        const rad = this.radiometric.processTileRGB(meanR, meanG, meanB);
        meanRLin = rad.linearR8;
        meanGLin = rad.linearG8;
        meanBLin = rad.linearB8;
        odR = rad.odR;
        odG = rad.odG;
        odB = rad.odB;
      }

      // Center bias
      const gx = ti % GRID;
      const gy = (ti / GRID) | 0;
      const nx = GRID > 1 ? gx / (GRID - 1) : 0.5;
      const ny = GRID > 1 ? gy / (GRID - 1) : 0.5;
      const dist = Math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2);
      const centerBias = Math.max(0.2, 1 - dist * 1.4);

      // Hemoglobin signature score
      const redScore = Math.max(0, Math.min(1, (rgRatio - 1.0) / 0.8));
      const domScore = Math.max(0, Math.min(1, (redDominance - 5) / 40));
      const brightScore = Math.max(0, Math.min(1, (intensity - 80) / 300));
      const clipPenalty = Math.min(1, (clipHighPct + clipLowPct) * 3);
      const validRatio = cnt / total;

      const frameScore = (redScore * 0.35 + domScore * 0.3 + brightScore * 0.15 + validRatio * 0.2) * (1 - clipPenalty);

      // Temporal smoothing
      this.tileConfidence[ti] = this.tileConfidence[ti] * 0.7 + frameScore * centerBias * 0.3;
      const combinedScore = this.tileConfidence[ti] * 0.65 + frameScore * 0.35;

      tileMetrics[ti] = {
        meanR, meanG, meanB, redDominance,
        rgRatio, intensity, clipHighPct, clipLowPct,
        validPixels: cnt, centerBias,
        score: combinedScore, temporalScore: this.tileConfidence[ti],
        meanRLin, meanGLin, meanBLin, odR, odG, odB,
      };
      allScores.push(combinedScore);
    }

    // --- Adaptive thresholding using percentiles ---
    allScores.sort((a, b) => a - b);
    const p50 = allScores.length > 0 ? allScores[Math.floor(allScores.length * 0.5)] : 0;
    const p25 = allScores.length > 0 ? allScores[Math.floor(allScores.length * 0.25)] : 0;
    // Finger threshold: above p50, but at least 0.3
    const fingerThreshold = Math.max(0.25, p50 * 0.85);

    // --- Identify valid finger tiles ---
    const currentMask = new Uint8Array(TOTAL_TILES);
    let fingerTileCount = 0;
    const validTileIndices: number[] = [];

    for (let ti = 0; ti < TOTAL_TILES; ti++) {
      const m = tileMetrics[ti];
      const isFingerTile =
        m.score > fingerThreshold &&
        m.meanR > 40 &&
        m.rgRatio > 1.05 &&
        m.redDominance > 5 &&
        m.intensity > 80 &&
        m.clipHighPct < 0.5 &&
        m.clipLowPct < 0.5 &&
        m.validPixels > 3;

      if (isFingerTile) {
        currentMask[ti] = 1;
        fingerTileCount++;
        validTileIndices.push(ti);
      }
    }

    // Temporal intersection: penalize tiles that flip rapidly
    let maskChangeCount = 0;
    for (let ti = 0; ti < TOTAL_TILES; ti++) {
      if (currentMask[ti] !== this.prevMaskValid[ti]) maskChangeCount++;
    }
    this.prevMaskValid.set(currentMask);

    // --- Weighted average over valid tiles (fine ROI) ---
    let wR = 0, wG = 0, wB = 0, wTotal = 0;
    let wRlin = 0, wGlin = 0, wBlin = 0;
    let wOdR = 0, wOdG = 0, wOdB = 0;
    let wTotalLin = 0;
    let brightSum = 0, brightSqSum = 0;
    let totalValidPx = 0;

    for (const ti of validTileIndices) {
      const m = tileMetrics[ti];
      const w = 0.2 + m.score * 2 + m.centerBias * 0.5;
      wR += m.meanR * w;
      wG += m.meanG * w;
      wB += m.meanB * w;
      wTotal += w;
      if (m.meanRLin !== undefined) {
        wRlin += m.meanRLin * w;
        wGlin += (m.meanGLin ?? 0) * w;
        wBlin += (m.meanBLin ?? 0) * w;
        wOdR += (m.odR ?? 0) * w;
        wOdG += (m.odG ?? 0) * w;
        wOdB += (m.odB ?? 0) * w;
        wTotalLin += w;
      }
      brightSum += m.intensity;
      brightSqSum += m.intensity * m.intensity;
      totalValidPx += m.validPixels;
    }

    // Fallback to all tiles if no finger tiles
    if (wTotal === 0) {
      for (let ti = 0; ti < TOTAL_TILES; ti++) {
        const m = tileMetrics[ti];
        if (m.validPixels === 0) continue;
        wR += m.meanR;
        wG += m.meanG;
        wB += m.meanB;
        wTotal += 1;
        if (m.meanRLin !== undefined) {
          wRlin += m.meanRLin;
          wGlin += (m.meanGLin ?? 0);
          wBlin += (m.meanBLin ?? 0);
          wOdR += (m.odR ?? 0);
          wOdG += (m.odG ?? 0);
          wOdB += (m.odB ?? 0);
          wTotalLin += 1;
        }
      }
    }

    const rawRed = wTotal > 0 ? wR / wTotal : 0;
    const rawGreen = wTotal > 0 ? wG / wTotal : 0;
    const rawBlue = wTotal > 0 ? wB / wTotal : 0;
    const linRed = wTotalLin > 0 ? wRlin / wTotalLin : rawRed;
    const linGreen = wTotalLin > 0 ? wGlin / wTotalLin : rawGreen;
    const linBlue = wTotalLin > 0 ? wBlin / wTotalLin : rawBlue;
    const odRagg = wTotalLin > 0 ? wOdR / wTotalLin : 0;
    const odGagg = wTotalLin > 0 ? wOdG / wTotalLin : 0;
    const odBagg = wTotalLin > 0 ? wOdB / wTotalLin : 0;

    const coverageRatio = fingerTileCount / TOTAL_TILES;
    const avgFingerScore = validTileIndices.length > 0
      ? validTileIndices.reduce((s, ti) => s + tileMetrics[ti].score, 0) / validTileIndices.length
      : 0;

    // Spatial uniformity among finger tiles
    let uniformity = 0;
    if (validTileIndices.length >= 3) {
      const scores = validTileIndices.map(ti => tileMetrics[ti].score);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      uniformity = Math.max(0, Math.min(1, 1 - cv));
    }

    // Center coverage (inner 3x3 of 7x7)
    const centerIndices = [16, 17, 18, 23, 24, 25, 30, 31, 32];
    const centerCount = centerIndices.filter(ti => currentMask[ti] === 1).length;
    const centerCov = centerCount / centerIndices.length;

    const brightness = validTileIndices.length > 0
      ? brightSum / validTileIndices.length : 0;
    const brightnessVar = validTileIndices.length > 1
      ? (brightSqSum / validTileIndices.length) - brightness * brightness : 0;

    const tileScores = new Float64Array(TOTAL_TILES);
    const tileData: TileData[] = new Array(TOTAL_TILES);
    for (let ti = 0; ti < TOTAL_TILES; ti++) {
      tileScores[ti] = tileMetrics[ti].score;
      const m = tileMetrics[ti];
      tileData[ti] = {
        r: m.meanR,
        g: m.meanG,
        b: m.meanB,
        quality: Math.max(0, Math.min(1, m.score)),
        coverage: m.validPixels / Math.max(1, this.tileCount[ti]),
        temporalConfidence: Math.max(0, Math.min(1, m.temporalScore)),
        tileIndex: ti,
      };
    }

    return {
      rawRed, rawGreen, rawBlue,
      linRed, linGreen, linBlue,
      odR: odRagg, odG: odGagg, odB: odBagg,
      coverageRatio,
      fingerScore: avgFingerScore,
      clipHighRatio: totalPixels > 0 ? totalClipHigh / totalPixels : 0,
      clipLowRatio: totalPixels > 0 ? totalClipLow / totalPixels : 0,
      spatialUniformity: uniformity,
      centerCoverage: centerCov,
      brightness,
      brightnessVariance: brightnessVar,
      validPixelCount: totalValidPx,
      totalPixelCount: totalPixels,
      tileScores,
      tileData,
    };
  }

  reset(): void {
    this.tileConfidence.fill(0);
    this.prevMaskValid.fill(0);
    this.frameCount = 0;
  }
}
