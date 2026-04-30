/**
 * ADAPTIVE ROI MASK V3
 * 
 * Per-frame adaptive mask with:
 * 1. Configurable tile grid (default 7x7)
 * 2. Enhanced per-tile metrics (chromaticity, variance, coherence)
 * 3. Coarse mask for detection, fine mask for extraction
 * 4. Adaptive thresholding with percentiles
 * 5. Temporal smoothing and hysteresis
 * 6. Detailed telemetry for debugging
 */

import { SPATIAL_UNIFORMITY_OPTIMAL_THRESHOLD } from '@/constants/processing';

export interface TileMetrics {
  meanR: number;
  meanG: number;
  meanB: number;
  redDominance: number;
  rgRatio: number;
  rbRatio: number;
  intensity: number;
  luminance: number;
  chromaticity: { r: number; g: number; b: number };
  clipHighPct: number;
  clipLowPct: number;
  validPixels: number;
  centerBias: number;
  variance: number;
  score: number;
  temporalScore: number;
  coherence: number;
}

export interface ROIMaskResult {
  // Weighted RGB from valid tiles only
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
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
  tileMetrics: TileMetrics[];
  coarseMask: Uint8Array; // Para detección
  fineMask: Uint8Array; // Para extracción
  activeTileIndices: number[];
  telemetry: {
    frameCount: number;
    maskStability: number;
    avgTileScore: number;
    topTileScore: number;
    gridWidth: number;
    gridHeight: number;
  };
}

export interface ROIMaskConfig {
  gridWidth: number;
  gridHeight: number;
  clipHigh: number;
  clipLow: number;
  sampleStep: number;
  roiFraction: number;
  centerBiasStrength: number;
  temporalSmoothing: number;
  minValidPixelsPerTile: number;
}

const DEFAULT_CONFIG: ROIMaskConfig = {
  gridWidth: 7,
  gridHeight: 7,
  clipHigh: 250,
  clipLow: 5,
  sampleStep: 2,
  roiFraction: 0.80,
  centerBiasStrength: 1.4,
  temporalSmoothing: 0.7,
  minValidPixelsPerTile: 3
};

export class AdaptiveROIMask {
  private config: ROIMaskConfig;
  private totalTiles: number;
  private tileConfidence: Float64Array;
  private prevMaskValid: Uint8Array;
  private frameCount = 0;
  private maskStabilityHistory: number[] = [];

  // Reusable per-tile accumulator arrays
  private tileR: Float64Array;
  private tileG: Float64Array;
  private tileB: Float64Array;
  private tileCount: Int32Array;
  private tileClipHigh: Int32Array;
  private tileClipLow: Int32Array;
  private tileValid: Int32Array;
  private tileR2: Float64Array; // Para varianza
  private tileG2: Float64Array;
  private tileB2: Float64Array;

  constructor(config: Partial<ROIMaskConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.totalTiles = this.config.gridWidth * this.config.gridHeight;
    
    this.tileConfidence = new Float64Array(this.totalTiles);
    this.prevMaskValid = new Uint8Array(this.totalTiles).fill(0);
    
    this.tileR = new Float64Array(this.totalTiles);
    this.tileG = new Float64Array(this.totalTiles);
    this.tileB = new Float64Array(this.totalTiles);
    this.tileCount = new Int32Array(this.totalTiles);
    this.tileClipHigh = new Int32Array(this.totalTiles);
    this.tileClipLow = new Int32Array(this.totalTiles);
    this.tileValid = new Int32Array(this.totalTiles);
    this.tileR2 = new Float64Array(this.totalTiles);
    this.tileG2 = new Float64Array(this.totalTiles);
    this.tileB2 = new Float64Array(this.totalTiles);
  }

  process(imageData: ImageData): ROIMaskResult {
    this.frameCount++;
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const { gridWidth, gridHeight, clipHigh, clipLow, sampleStep, roiFraction, centerBiasStrength, temporalSmoothing, minValidPixelsPerTile } = this.config;

    // Central ROI
    const roiSize = Math.min(w, h) * roiFraction;
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
    this.tileR2.fill(0);
    this.tileG2.fill(0);
    this.tileB2.fill(0);
    this.tileCount.fill(0);
    this.tileClipHigh.fill(0);
    this.tileClipLow.fill(0);
    this.tileValid.fill(0);

    let totalPixels = 0;
    let totalClipHigh = 0;
    let totalClipLow = 0;

    // Sample pixels
    for (let y = sy; y < ey; y += sampleStep) {
      const rowOff = y * w;
      for (let x = sx; x < ex; x += sampleStep) {
        const i = (rowOff + x) << 2;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const tileX = Math.min(gridWidth - 1, ((x - sx) * gridWidth / roiW) | 0);
        const tileY = Math.min(gridHeight - 1, ((y - sy) * gridHeight / roiH) | 0);
        const ti = tileY * gridWidth + tileX;

        totalPixels++;

        const isClipHigh = r >= clipHigh || g >= clipHigh || b >= clipHigh;
        const isClipLow = r <= clipLow && g <= clipLow && b <= clipLow;

        if (isClipHigh) {
          this.tileClipHigh[ti]++;
          totalClipHigh++;
        }
        if (isClipLow) {
          this.tileClipLow[ti]++;
          totalClipLow++;
        }

        if (!isClipHigh && !isClipLow) {
          this.tileR[ti] += r;
          this.tileG[ti] += g;
          this.tileB[ti] += b;
          this.tileR2[ti] += r * r;
          this.tileG2[ti] += g * g;
          this.tileB2[ti] += b * b;
          this.tileValid[ti]++;
        }
        this.tileCount[ti]++;
      }
    }

    // Compute per-tile metrics
    const tileMetrics: TileMetrics[] = new Array(this.totalTiles);
    const allScores: number[] = [];

    for (let ti = 0; ti < this.totalTiles; ti++) {
      const cnt = this.tileValid[ti];
      const total = this.tileCount[ti];
      if (cnt === 0 || total === 0) {
        tileMetrics[ti] = {
          meanR: 0, meanG: 0, meanB: 0, redDominance: 0,
          rgRatio: 0, rbRatio: 0, intensity: 0, luminance: 0,
          chromaticity: { r: 0, g: 0, b: 0 },
          clipHighPct: 0, clipLowPct: 0,
          validPixels: 0, centerBias: 0, variance: 0,
          score: 0, temporalScore: 0, coherence: 0
        };
        continue;
      }

      const meanR = this.tileR[ti] / cnt;
      const meanG = this.tileG[ti] / cnt;
      const meanB = this.tileB[ti] / cnt;
      const intensity = meanR + meanG + meanB;
      const luminance = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB;
      const redDominance = meanR - (meanG + meanB) / 2;
      const rgRatio = meanG > 1 ? meanR / meanG : 0;
      const rbRatio = meanB > 1 ? meanR / meanB : 0;
      const chromaticity = {
        r: intensity > 0 ? meanR / intensity : 0,
        g: intensity > 0 ? meanG / intensity : 0,
        b: intensity > 0 ? meanB / intensity : 0
      };
      const clipHighPct = this.tileClipHigh[ti] / total;
      const clipLowPct = this.tileClipLow[ti] / total;

      // Variance
      const varR = (this.tileR2[ti] / cnt) - (meanR * meanR);
      const varG = (this.tileG2[ti] / cnt) - (meanG * meanG);
      const varB = (this.tileB2[ti] / cnt) - (meanB * meanB);
      const variance = (varR + varG + varB) / 3;

      // Center bias
      const gx = ti % gridWidth;
      const gy = Math.floor(ti / gridWidth);
      const nx = gridWidth > 1 ? gx / (gridWidth - 1) : 0.5;
      const ny = gridHeight > 1 ? gy / (gridHeight - 1) : 0.5;
      const dist = Math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2);
      const centerBias = Math.max(0.2, 1 - dist * centerBiasStrength);

      // Hemoglobin signature score
      const redScore = Math.max(0, Math.min(1, (rgRatio - 1.0) / 0.8));
      const domScore = Math.max(0, Math.min(1, (redDominance - 5) / 40));
      const brightScore = Math.max(0, Math.min(1, (intensity - 80) / 300));
      const clipPenalty = Math.min(1, (clipHighPct + clipLowPct) * 3);
      const validRatio = cnt / total;
      const variancePenalty = Math.min(1, variance / 1000);

      const frameScore = (redScore * 0.3 + domScore * 0.25 + brightScore * 0.15 + validRatio * 0.2) * (1 - clipPenalty) * (1 - variancePenalty);

      // Temporal smoothing
      this.tileConfidence[ti] = this.tileConfidence[ti] * temporalSmoothing + frameScore * centerBias * (1 - temporalSmoothing);
      const combinedScore = this.tileConfidence[ti] * 0.6 + frameScore * 0.4;

      tileMetrics[ti] = {
        meanR, meanG, meanB, redDominance,
        rgRatio, rbRatio, intensity, luminance, chromaticity,
        clipHighPct, clipLowPct,
        validPixels: cnt, centerBias, variance,
        score: combinedScore, temporalScore: this.tileConfidence[ti], coherence: 0
      };
      allScores.push(combinedScore);
    }

    // Adaptive thresholding
    allScores.sort((a, b) => a - b);
    const p50 = allScores.length > 0 ? allScores[Math.floor(allScores.length * 0.5)] : 0;
    const fingerThreshold = Math.max(0.25, p50 * SPATIAL_UNIFORMITY_OPTIMAL_THRESHOLD);

    // Identify valid finger tiles
    const coarseMask = new Uint8Array(this.totalTiles);
    const fineMask = new Uint8Array(this.totalTiles);
    const validTileIndices: number[] = [];

    for (let ti = 0; ti < this.totalTiles; ti++) {
      const m = tileMetrics[ti];
      const isFingerTile =
        m.score > fingerThreshold &&
        m.meanR > 40 &&
        m.rgRatio > 1.05 &&
        m.redDominance > 5 &&
        m.intensity > 80 &&
        m.clipHighPct < 0.5 &&
        m.clipLowPct < 0.5 &&
        m.validPixels >= minValidPixelsPerTile;

      if (isFingerTile) {
        coarseMask[ti] = 1;
        validTileIndices.push(ti);
      }
      
      // Fine mask: solo tiles con score alto y baja varianza
      if (isFingerTile && m.score > fingerThreshold * 1.2 && m.variance < 500) {
        fineMask[ti] = 1;
      }
    }

    // Temporal intersection
    let maskChangeCount = 0;
    for (let ti = 0; ti < this.totalTiles; ti++) {
      if (coarseMask[ti] !== this.prevMaskValid[ti]) maskChangeCount++;
    }
    this.prevMaskValid.set(coarseMask);
    
    const maskStability = 1 - (maskChangeCount / this.totalTiles);
    this.maskStabilityHistory.push(maskStability);
    if (this.maskStabilityHistory.length > 30) this.maskStabilityHistory.shift();

    // Weighted average over valid tiles
    let wR = 0, wG = 0, wB = 0, wTotal = 0;
    let brightSum = 0, brightSqSum = 0;
    let totalValidPx = 0;

    for (const ti of validTileIndices) {
      const m = tileMetrics[ti];
      const w = 0.2 + m.score * 2 + m.centerBias * 0.5;
      wR += m.meanR * w;
      wG += m.meanG * w;
      wB += m.meanB * w;
      wTotal += w;
      brightSum += m.intensity;
      brightSqSum += m.intensity * m.intensity;
      totalValidPx += m.validPixels;
    }

    // Fallback to all tiles if no finger tiles
    if (wTotal === 0) {
      for (let ti = 0; ti < this.totalTiles; ti++) {
        const m = tileMetrics[ti];
        if (m.validPixels === 0) continue;
        wR += m.meanR;
        wG += m.meanG;
        wB += m.meanB;
        wTotal += 1;
      }
    }

    const rawRed = wTotal > 0 ? wR / wTotal : 0;
    const rawGreen = wTotal > 0 ? wG / wTotal : 0;
    const rawBlue = wTotal > 0 ? wB / wTotal : 0;

    const coverageRatio = validTileIndices.length / this.totalTiles;
    const avgFingerScore = validTileIndices.length > 0
      ? validTileIndices.reduce((s, ti) => s + tileMetrics[ti].score, 0) / validTileIndices.length
      : 0;

    // Spatial uniformity
    let uniformity = 0;
    if (validTileIndices.length >= 3) {
      const scores = validTileIndices.map(ti => tileMetrics[ti].score);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      uniformity = Math.max(0, Math.min(1, 1 - cv));
    }

    // Cobertura central: rejilla interna ~3x3 relativa al tamaño de grilla
    const cw = Math.max(1, Math.floor(gridWidth / 3));
    const ch = Math.max(1, Math.floor(gridHeight / 3));
    const x0 = Math.floor((gridWidth - cw) / 2);
    const y0 = Math.floor((gridHeight - ch) / 2);
    let centerCount = 0;
    let centerTotal = 0;
    for (let yy = y0; yy < y0 + ch; yy++) {
      for (let xx = x0; xx < x0 + cw; xx++) {
        const ti = yy * gridWidth + xx;
        if (ti >= 0 && ti < coarseMask.length) {
          centerTotal++;
          if (coarseMask[ti] === 1) centerCount++;
        }
      }
    }
    const centerCov = centerTotal > 0 ? centerCount / centerTotal : 0;

    const brightness = validTileIndices.length > 0
      ? brightSum / validTileIndices.length : 0;
    const brightnessVar = validTileIndices.length > 1
      ? (brightSqSum / validTileIndices.length) - brightness * brightness : 0;

    const tileScores = new Float64Array(this.totalTiles);
    for (let ti = 0; ti < this.totalTiles; ti++) tileScores[ti] = tileMetrics[ti].score;

    const avgMaskStability = this.maskStabilityHistory.length > 0
      ? this.maskStabilityHistory.reduce((a, b) => a + b, 0) / this.maskStabilityHistory.length
      : 0;

    return {
      rawRed, rawGreen, rawBlue,
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
      tileMetrics,
      coarseMask,
      fineMask,
      activeTileIndices: validTileIndices,
      telemetry: {
        frameCount: this.frameCount,
        maskStability: avgMaskStability,
        avgTileScore: avgFingerScore,
        topTileScore: allScores.length > 0 ? allScores[allScores.length - 1] : 0,
        gridWidth,
        gridHeight
      }
    };
  }

  reset(): void {
    this.tileConfidence.fill(0);
    this.prevMaskValid.fill(0);
    this.frameCount = 0;
    this.maskStabilityHistory = [];
  }
}
