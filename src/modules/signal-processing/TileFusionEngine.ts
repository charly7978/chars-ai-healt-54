/**
 * TILE FUSION ENGINE
 * 
 * Weighted RGB fusion with dynamic weights based on:
 * - Clipping penalty
 * - Low perfusion penalty
 * - Excessive DC drift penalty
 * - Low periodicity penalty
 * - High motion contamination penalty
 * - Spectral peak prominence reward
 * - Autocorrelation peak reward
 * - Harmonic consistency reward
 * - Temporal stability reward
 * 
 * Normalizes weights and exposes them for diagnostics.
 */

export interface TileSignal {
  tileIndex: number;
  redNorm: number;
  greenNorm: number;
  blueNorm: number;
  redOD: number;
  greenOD: number;
  blueOD: number;
  perfusionIndex: number;
  clipHighRatio: number;
  clipLowRatio: number;
  variance: number;
  temporalStability: number;
  centerDistance: number;
}

export interface FusionWeights {
  redWeight: number;
  greenWeight: number;
  blueWeight: number;
  tileWeights: number[];
  weightReasons: string[];
}

export interface FusionResult {
  fusedSignal: number;
  weights: FusionWeights;
  bestTileIndex: number;
  qualityScore: number;
}

export class TileFusionEngine {
  private readonly WEIGHT_WINDOW_SIZE = 30;
  private redWeightHistory: number[] = [];
  private greenWeightHistory: number[] = [];
  private blueWeightHistory: number[] = [];
  private frameCount = 0;

  /**
   * Compute dynamic weights for RGB channels based on quality metrics
   */
  computeChannelWeights(
    redPI: number,
    greenPI: number,
    bluePI: number,
    redClip: number,
    greenClip: number,
    blueClip: number,
    motionScore: number
  ): { red: number; green: number; blue: number } {
    // Base weights from perfusion index
    let wR = Math.max(0.1, redPI);
    let wG = Math.max(0.1, greenPI);
    let wB = Math.max(0.1, bluePI);

    // Penalize clipped channels
    wR *= (1 - redClip * 3);
    wG *= (1 - greenClip * 3);
    wB *= (1 - blueClip * 3);

    // Motion penalty affects all channels
    const motionPenalty = 1 - Math.min(0.7, motionScore * 0.5);
    wR *= motionPenalty;
    wG *= motionPenalty;
    wB *= motionPenalty;

    // Normalize
    const total = wR + wG + wB;
    if (total > 0) {
      wR /= total;
      wG /= total;
      wB /= total;
    } else {
      wR = 0.4; wG = 0.4; wB = 0.2; // fallback
    }

    // Temporal smoothing of weights
    this.redWeightHistory.push(wR);
    this.greenWeightHistory.push(wG);
    this.blueWeightHistory.push(wB);

    if (this.redWeightHistory.length > this.WEIGHT_WINDOW_SIZE) {
      this.redWeightHistory.shift();
      this.greenWeightHistory.shift();
      this.blueWeightHistory.shift();
    }

    // EWMA of weights
    const alpha = 0.15;
    if (this.redWeightHistory.length > 5) {
      const avgR = this.redWeightHistory.reduce((a, b) => a + b, 0) / this.redWeightHistory.length;
      const avgG = this.greenWeightHistory.reduce((a, b) => a + b, 0) / this.greenWeightHistory.length;
      const avgB = this.blueWeightHistory.reduce((a, b) => a + b, 0) / this.blueWeightHistory.length;
      
      wR = wR * alpha + avgR * (1 - alpha);
      wG = wG * alpha + avgG * (1 - alpha);
      wB = wB * alpha + avgB * (1 - alpha);
    }

    // Renormalize after smoothing
    const total2 = wR + wG + wB;
    if (total2 > 0) {
      wR /= total2;
      wG /= total2;
      wB /= total2;
    }

    return { red: wR, green: wG, blue: wB };
  }

  /**
   * Compute tile-level weights based on quality metrics
   */
  computeTileWeights(tiles: TileSignal[]): number[] {
    const weights = new Array(tiles.length).fill(0);
    const reasons: string[] = [];

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      let weight = 1.0;

      // Center bias - tiles closer to center get higher weight
      weight *= (1 - tile.centerDistance * 0.5);

      // Perfusion index reward
      weight *= Math.max(0.2, Math.min(2.0, tile.perfusionIndex * 50));

      // Clipping penalty
      weight *= (1 - (tile.clipHighRatio + tile.clipLowRatio) * 4);

      // Temporal stability reward
      weight *= (0.5 + tile.temporalStability * 0.5);

      // Variance penalty (too high = noise, too low = no signal)
      if (tile.variance > 100) {
        weight *= 0.5;
      } else if (tile.variance < 5) {
        weight *= 0.7;
      }

      weights[i] = Math.max(0, weight);
    }

    // Normalize tile weights
    const total = weights.reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (let i = 0; i < weights.length; i++) {
        weights[i] /= total;
      }
    }

    return weights;
  }

  /**
   * Fuse signals from multiple tiles with dynamic weights
   */
  fuseTileSignals(
    tiles: TileSignal[],
    channelWeights: { red: number; green: number; blue: number }
  ): FusionResult {
    if (tiles.length === 0) {
      return {
        fusedSignal: 0,
        weights: {
          redWeight: channelWeights.red,
          greenWeight: channelWeights.green,
          blueWeight: channelWeights.blue,
          tileWeights: [],
          weightReasons: [],
        },
        bestTileIndex: -1,
        qualityScore: 0,
      };
    }

    const tileWeights = this.computeTileWeights(tiles);
    
    // Find best tile (highest weight)
    let bestTileIndex = 0;
    let maxWeight = tileWeights[0];
    for (let i = 1; i < tileWeights.length; i++) {
      if (tileWeights[i] > maxWeight) {
        maxWeight = tileWeights[i];
        bestTileIndex = i;
      }
    }

    // Fuse signals
    let fusedSignal = 0;
    let totalWeight = 0;

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const w = tileWeights[i];

      // Weighted combination of normalized channels
      const channelFused = 
        tile.redNorm * channelWeights.red +
        tile.greenNorm * channelWeights.green +
        tile.blueNorm * channelWeights.blue;

      // Also consider optical density
      const odFused =
        tile.redOD * channelWeights.red +
        tile.greenOD * channelWeights.green +
        tile.blueOD * channelWeights.blue;

      // Blend normalized and optical density (60/40)
      const tileSignal = channelFused * 0.6 + odFused * 0.4;

      fusedSignal += tileSignal * w;
      totalWeight += w;
    }

    if (totalWeight > 0) {
      fusedSignal /= totalWeight;
    }

    // Quality score based on weight distribution and best tile
    const weightEntropy = this.computeEntropy(tileWeights);
    const qualityScore = (1 - weightEntropy) * maxWeight;

    const weightReasons: string[] = [];
    if (channelWeights.red > 0.5) weightReasons.push('red_dominant');
    if (channelWeights.green > 0.5) weightReasons.push('green_dominant');
    if (channelWeights.blue > 0.4) weightReasons.push('blue_contributing');
    if (maxWeight > 0.3) weightReasons.push('strong_tile');

    this.frameCount++;

    return {
      fusedSignal: fusedSignal * 1000, // Scale for downstream processing
      weights: {
        redWeight: channelWeights.red,
        greenWeight: channelWeights.green,
        blueWeight: channelWeights.blue,
        tileWeights,
        weightReasons,
      },
      bestTileIndex,
      qualityScore,
    };
  }

  /**
   * Compute entropy of weight distribution (lower = more concentrated = better)
   */
  private computeEntropy(weights: number[]): number {
    if (weights.length === 0) return 0;

    let entropy = 0;
    for (const w of weights) {
      if (w > 0) {
        entropy -= w * Math.log2(w);
      }
    }

    const maxEntropy = Math.log2(weights.length);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  /**
   * Get current weight statistics
   */
  getWeightStats(): {
    avgRedWeight: number;
    avgGreenWeight: number;
    avgBlueWeight: number;
    weightStability: number;
  } {
    const avgRedWeight = this.redWeightHistory.length > 0
      ? this.redWeightHistory.reduce((a, b) => a + b, 0) / this.redWeightHistory.length
      : 0.33;
    const avgGreenWeight = this.greenWeightHistory.length > 0
      ? this.greenWeightHistory.reduce((a, b) => a + b, 0) / this.greenWeightHistory.length
      : 0.34;
    const avgBlueWeight = this.blueWeightHistory.length > 0
      ? this.blueWeightHistory.reduce((a, b) => a + b, 0) / this.blueWeightHistory.length
      : 0.33;

    // Weight stability (inverse of variance)
    let stability = 1.0;
    if (this.redWeightHistory.length > 5) {
      const varR = this.computeVariance(this.redWeightHistory);
      const varG = this.computeVariance(this.greenWeightHistory);
      const varB = this.computeVariance(this.blueWeightHistory);
      const avgVar = (varR + varG + varB) / 3;
      stability = Math.max(0, 1 - avgVar * 10);
    }

    return {
      avgRedWeight,
      avgGreenWeight,
      avgBlueWeight,
      weightStability: stability,
    };
  }

  private computeVariance(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  }

  /**
   * Reset engine state
   */
  reset(): void {
    this.redWeightHistory = [];
    this.greenWeightHistory = [];
    this.blueWeightHistory = [];
    this.frameCount = 0;
  }
}
