/**
 * TILE FUSION ENGINE — ROBUST SPATIAL FUSION
 * 
 * Takes per-tile scores (from AdaptiveROIMask) and fuses them into:
 * 1. Consolidated RGB values using robust weighting
 * 2. Spatial quality metrics
 * 3. Top-K tile tracking for morphology and reference
 * 
 * Methods:
 * - Huber-weighted mean: reduces influence of outlier tiles
 * - Trimmed mean: removes lowest/highest quality tiles
 * - Per-channel fusion with independent quality gates
 * - Temporal fusion: cross-frame consistency
 * 
 * References:
 * - Tukey (1960): Robust statistics
 * - Huber (1981): M-estimation
 * - Hampel et al. (1986): Influence functions
 */

export interface TileData {
  r: number;
  g: number;
  b: number;
  quality: number; // 0-1
  coverage: number; // 0-1
  temporalConfidence: number; // 0-1
  tileIndex: number;
}

export interface FusionResult {
  fusedR: number;
  fusedG: number;
  fusedB: number;
  fusedQuality: number;
  topTiles: TileData[]; // Best 3 tiles
  spatialUniformity: number; // 0-1, how similar tiles are
  tileWeights: number[]; // For debugging
}

// ═══════════════════════════════════════════════════════════════════
// TILE FUSION ENGINE
// ═══════════════════════════════════════════════════════════════════

export class TileFusionEngine {
  private readonly TILE_COUNT = 49; // 7x7 grid
  private readonly TOP_K = 3;
  private readonly TRIM_RATIO = 0.15; // Trim bottom 15%, top 5%
  
  // Temporal tracking for consistency
  private lastFusedValues: { r: number; g: number; b: number } = { r: 128, g: 128, b: 128 };
  private lastTileCenters: number[] = new Array(this.TILE_COUNT).fill(0);
  private readonly TEMPORAL_ALPHA = 0.15; // Smoothing factor
  
  /**
   * Fuse multiple tiles into consolidated PPG signal
   */
  public fuse(tiles: TileData[]): FusionResult {
    if (tiles.length === 0) {
      return this.emptyResult();
    }
    
    // Normalize qualities and coverage to 0-1
    const normalizedTiles = tiles.map((t, idx) => ({
      ...t,
      tileIndex: idx,
      quality: Math.max(0, Math.min(1, t.quality)),
      coverage: Math.max(0, Math.min(1, t.coverage)),
    }));
    
    // Compute per-channel fused values using Huber weights
    const fusedR = this.huberWeightedMean(normalizedTiles.map(t => t.r), normalizedTiles);
    const fusedG = this.huberWeightedMean(normalizedTiles.map(t => t.g), normalizedTiles);
    const fusedB = this.huberWeightedMean(normalizedTiles.map(t => t.b), normalizedTiles);
    
    // Also compute trimmed mean for comparison
    const trimmedR = this.trimmedMean(normalizedTiles.map(t => t.r), normalizedTiles);
    const trimmedG = this.trimmedMean(normalizedTiles.map(t => t.g), normalizedTiles);
    const trimmedB = this.trimmedMean(normalizedTiles.map(t => t.b), normalizedTiles);
    
    // Weighted average between Huber and trimmed (80/20)
    const finalR = fusedR * 0.8 + trimmedR * 0.2;
    const finalG = fusedG * 0.8 + trimmedG * 0.2;
    const finalB = fusedB * 0.8 + trimmedB * 0.2;
    
    // Apply temporal smoothing
    const smoothR = this.lastFusedValues.r * (1 - this.TEMPORAL_ALPHA) + finalR * this.TEMPORAL_ALPHA;
    const smoothG = this.lastFusedValues.g * (1 - this.TEMPORAL_ALPHA) + finalG * this.TEMPORAL_ALPHA;
    const smoothB = this.lastFusedValues.b * (1 - this.TEMPORAL_ALPHA) + finalB * this.TEMPORAL_ALPHA;
    
    this.lastFusedValues = { r: smoothR, g: smoothG, b: smoothB };
    
    // Compute quality metrics
    const fusedQuality = this.computeFusionQuality(normalizedTiles);
    const spatialUniformity = this.computeUniformity(normalizedTiles);
    
    // Find top-K tiles for reference
    const topTiles = this.selectTopTiles(normalizedTiles, this.TOP_K);
    
    // Compute tile weights for debugging
    const tileWeights = this.computeWeights(normalizedTiles);
    
    return {
      fusedR: smoothR,
      fusedG: smoothG,
      fusedB: smoothB,
      fusedQuality,
      topTiles,
      spatialUniformity,
      tileWeights,
    };
  }
  
  /**
   * Huber-weighted mean: robust to outliers
   * Uses influence function that downweights extreme values
   */
  private huberWeightedMean(values: number[], tiles: any[]): number {
    if (values.length === 0) return 128;
    
    // Compute MAD (median absolute deviation)
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const deviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)] || 1;
    
    // Huber constant k = 1.345 (standard for robust fitting)
    const k = 1.345 * mad;
    
    // Compute weights
    let weightedSum = 0;
    let weightSum = 0;
    
    for (let i = 0; i < values.length; i++) {
      const tileQuality = tiles[i].quality;
      const deviation = Math.abs(values[i] - median);
      
      // Huber weight: linear near center, constant far away
      let weight: number;
      if (deviation < k) {
        weight = 1.0;
      } else {
        weight = k / deviation;
      }
      
      // Modulate by tile quality
      weight *= tileQuality;
      
      weightedSum += values[i] * weight;
      weightSum += weight;
    }
    
    return weightSum > 0 ? weightedSum / weightSum : median;
  }
  
  /**
   * Trimmed mean: remove lowest and highest tiles
   */
  private trimmedMean(values: number[], tiles: any[]): number {
    if (values.length === 0) return 128;
    
    // Sort by quality
    const indexed = values.map((v, i) => ({ value: v, quality: tiles[i].quality, idx: i }));
    indexed.sort((a, b) => a.quality - b.quality);
    
    // Trim bottom and top
    const trimCount = Math.max(1, Math.floor(indexed.length * this.TRIM_RATIO));
    const trimmedValues = indexed.slice(trimCount, indexed.length - Math.ceil(trimCount / 2));
    
    if (trimmedValues.length === 0) return median(values);
    
    const sum = trimmedValues.reduce((s, t) => s + t.value, 0);
    return sum / trimmedValues.length;
  }
  
  /**
   * Compute overall quality of fusion
   */
  private computeFusionQuality(tiles: any[]): number {
    if (tiles.length === 0) return 0;
    
    // Average quality weighted by coverage
    let qualitySum = 0;
    let coverageSum = 0;
    
    for (const tile of tiles) {
      qualitySum += tile.quality * tile.coverage;
      coverageSum += tile.coverage;
    }
    
    if (coverageSum === 0) return 0;
    
    return qualitySum / coverageSum;
  }
  
  /**
   * Compute spatial uniformity: how similar tiles are
   */
  private computeUniformity(tiles: any[]): number {
    if (tiles.length <= 1) return 1;
    
    // Collect valid tile intensities
    const intensities = tiles
      .filter(t => t.quality > 0.3)
      .map(t => (t.r + t.g + t.b) / 3);
    
    if (intensities.length < 2) return 0.5;
    
    const mean = intensities.reduce((a, b) => a + b, 0) / intensities.length;
    const variance = intensities.reduce((s, i) => s + (i - mean) ** 2, 0) / intensities.length;
    const std = Math.sqrt(variance);
    const cv = std / (mean + 1); // Coefficient of variation
    
    // Low CV = uniform, high CV = scattered
    // Map CV to 0-1: CV=0 → 1.0, CV=0.5 → 0.5, CV=2 → close to 0
    return Math.exp(-cv * 1.5);
  }
  
  /**
   * Select top-K tiles by quality
   */
  private selectTopTiles(tiles: any[], k: number): any[] {
    const sorted = [...tiles].sort((a, b) => b.quality - a.quality);
    return sorted.slice(0, Math.min(k, sorted.length));
  }
  
  /**
   * Compute weight per tile (for debugging/visualization)
   */
  private computeWeights(tiles: any[]): number[] {
    const weights: number[] = new Array(tiles.length).fill(0);
    
    // Compute MAD
    const intensities = tiles.map(t => (t.r + t.g + t.b) / 3);
    const sorted = [...intensities].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    let weightSum = 0;
    for (let i = 0; i < tiles.length; i++) {
      const deviation = Math.abs(intensities[i] - median);
      const mad = 1; // Simplified
      const k = 1.345 * mad;
      
      let weight = deviation < k ? 1.0 : k / (deviation + 0.1);
      weight *= tiles[i].quality;
      
      weights[i] = weight;
      weightSum += weight;
    }
    
    // Normalize
    if (weightSum > 0) {
      for (let i = 0; i < weights.length; i++) {
        weights[i] /= weightSum;
      }
    }
    
    return weights;
  }
  
  /**
   * Empty result (no tiles)
   */
  private emptyResult(): FusionResult {
    return {
      fusedR: 128,
      fusedG: 128,
      fusedB: 128,
      fusedQuality: 0,
      topTiles: [],
      spatialUniformity: 0,
      tileWeights: [],
    };
  }
}

/**
 * Helper: compute median
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
