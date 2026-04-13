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
}

const GRID = 7; // 7x7 tile grid
const TOTAL_TILES = GRID * GRID;
const CLIP_HIGH = 250;
const CLIP_LOW = 5;

export class AdaptiveROIMask {
  private tileConfidence: Float64Array = new Float64Array(TOTAL_TILES);
  private prevMaskValid: Uint8Array = new Uint8Array(TOTAL_TILES).fill(0);
  private frameCount = 0;

  // Reusable per-tile accumulator arrays to avoid per-frame allocation
  private tileR = new Float64Array(TOTAL_TILES);
  private tileG = new Float64Array(TOTAL_TILES);
  private tileB = new Float64Array(TOTAL_TILES);
  private tileCount = new Int32Array(TOTAL_TILES);
  private tileClipHigh = new Int32Array(TOTAL_TILES);
  private tileClipLow = new Int32Array(TOTAL_TILES);
  private tileValid = new Int32Array(TOTAL_TILES);

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
    const tileMetrics: TileMetrics[] = new Array(TOTAL_TILES);
    const allScores: number[] = [];

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
        score: combinedScore, temporalScore: this.tileConfidence[ti]
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
      for (let ti = 0; ti < TOTAL_TILES; ti++) {
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
    for (let ti = 0; ti < TOTAL_TILES; ti++) tileScores[ti] = tileMetrics[ti].score;

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
    };
  }

  reset(): void {
    this.tileConfidence.fill(0);
    this.prevMaskValid.fill(0);
    this.frameCount = 0;
  }
}
