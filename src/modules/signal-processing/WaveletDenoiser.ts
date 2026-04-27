/**
 * ADAPTIVE WAVELET DENOISER — Multi-scale signal denoising with frame-adaptive thresholding
 * 
 * Implements Discrete Wavelet Transform (DWT) with:
 * - Frame-adaptive threshold based on noise level estimation
 * - Universal threshold (VisuShrink) + SureShrink hybrid
 * - Soft thresholding with smooth transition
 * - Level-dependent threshold scaling
 * - Automatic decomposition depth based on signal length
 * 
 * Phase 5: Adaptive thresholding for maximum SNR improvement
 * 
 * References:
 * - Donoho & Johnstone (1994): Ideal spatial adaptation by wavelet shrinkage
 * - Mallat (1999): A Wavelet Tour of Signal Processing
 */

export interface WaveletConfig {
  /** Wavelet type (only 'haar' implemented for speed) */
  wavelet: 'haar' | 'db2' | 'sym4';
  /** Decomposition levels (0 = auto based on signal length) */
  levels: number;
  /** Thresholding mode: 'soft' or 'hard' */
  thresholdMode: 'soft' | 'hard';
  /** Adaptive threshold scaling factor */
  thresholdScale: number;
  /** Enable level-dependent threshold */
  levelDependent: boolean;
}

export interface WaveletResult {
  /** Denoised signal */
  signal: Float64Array;
  /** Estimated noise level (sigma) */
  noiseSigma: number;
  /** Applied threshold per level */
  thresholds: number[];
  /** SNR improvement ratio */
  snrImprovement: number;
  /** Detail coefficients preserved per level */
  detailEnergy: number[];
}

// Haar wavelet transform (fast, integer-based)
class HaarWavelet {
  /**
   * Forward DWT (decomposition)
   * Returns approximation and detail coefficients
   */
  forward(signal: Float64Array): { approx: Float64Array; detail: Float64Array } {
    const n = signal.length;
    const half = Math.floor(n / 2);
    
    const approx = new Float64Array(half);
    const detail = new Float64Array(half);
    
    for (let i = 0; i < half; i++) {
      const a = signal[i * 2];
      const b = signal[i * 2 + 1];
      // Haar: low-pass (average) and high-pass (difference)
      approx[i] = (a + b) / Math.SQRT2;
      detail[i] = (a - b) / Math.SQRT2;
    }
    
    return { approx, detail };
  }
  
  /**
   * Inverse DWT (reconstruction)
   */
  inverse(approx: Float64Array, detail: Float64Array): Float64Array {
    const n = approx.length * 2;
    const signal = new Float64Array(n);
    
    for (let i = 0; i < approx.length; i++) {
      const a = approx[i];
      const d = detail[i];
      // Inverse Haar
      signal[i * 2] = (a + d) / Math.SQRT2;
      signal[i * 2 + 1] = (a - d) / Math.SQRT2;
    }
    
    return signal;
  }
}

export class AdaptiveWaveletDenoiser {
  private config: WaveletConfig;
  private haar = new HaarWavelet();
  
  // Noise level history for adaptive tracking
  private noiseHistory: number[] = [];
  private readonly HISTORY_SIZE = 30;
  private lastThresholds: number[] = [];
  
  constructor(config: Partial<WaveletConfig> = {}) {
    this.config = {
      wavelet: 'haar',
      levels: 0, // Auto
      thresholdMode: 'soft',
      thresholdScale: 1.0,
      levelDependent: true,
      ...config
    };
  }
  
  /**
   * Denoise signal with frame-adaptive threshold
   * 
   * @param signal Input signal
   * @param externalNoiseSigma Optional external noise estimate
   * @returns Denoised signal with metadata
   */
  denoise(signal: Float64Array, externalNoiseSigma?: number): WaveletResult {
    const n = signal.length;
    
    // Determine decomposition levels
    const levels = this.config.levels > 0 
      ? this.config.levels 
      : Math.min(6, Math.floor(Math.log2(n)) - 2);
    
    // Perform multi-level decomposition
    const decomposition = this.decompose(signal, levels);
    
    // Estimate noise level if not provided
    const noiseSigma = externalNoiseSigma ?? this.estimateNoise(decomposition.details[0]);
    
    // Update noise history for tracking
    this.updateNoiseHistory(noiseSigma);
    
    // Calculate adaptive thresholds per level
    const thresholds = this.calculateAdaptiveThresholds(
      noiseSigma, 
      levels, 
      n,
      decomposition.details
    );
    this.lastThresholds = thresholds;
    
    // Apply thresholding to detail coefficients
    const denoisedDetails = decomposition.details.map((detail, level) => 
      this.threshold(detail, thresholds[level], level)
    );
    
    // Reconstruct signal
    const denoisedSignal = this.reconstruct(decomposition.approximation, denoisedDetails);
    
    // Calculate energy preservation per level
    const detailEnergy = denoisedDetails.map(d => 
      d.reduce((sum, x) => sum + x * x, 0)
    );
    
    // Estimate SNR improvement
    const snrImprovement = this.estimateSNRImprovement(signal, denoisedSignal, noiseSigma);
    
    return {
      signal: denoisedSignal,
      noiseSigma,
      thresholds,
      snrImprovement,
      detailEnergy
    };
  }
  
  /**
   * Multi-level wavelet decomposition
   */
  private decompose(signal: Float64Array, levels: number): {
    approximation: Float64Array;
    details: Float64Array[];
  } {
    let current = new Float64Array(signal);
    const details: Float64Array[] = [];
    
    for (let i = 0; i < levels; i++) {
      // Pad to even length if necessary
      if (current.length % 2 === 1) {
        const padded = new Float64Array(current.length + 1);
        padded.set(current);
        padded[padded.length - 1] = current[current.length - 1]; // Duplicate last
        current = padded;
      }
      
      const { approx, detail } = this.haar.forward(current);
      const detailCopy = new Float64Array(detail.length);
      detailCopy.set(detail);
      details.push(detailCopy);
      const approxCopy = new Float64Array(approx.length);
      approxCopy.set(approx);
      current = approxCopy;
    }
    
    return {
      approximation: current,
      details
    };
  }
  
  /**
   * Reconstruct signal from approximation and denoised details
   */
  private reconstruct(approximation: Float64Array, details: Float64Array[]): Float64Array {
    let current = new Float64Array(approximation);
    
    // Reconstruct from coarsest to finest
    for (let i = details.length - 1; i >= 0; i--) {
      const recon = this.haar.inverse(current, details[i]);
      const reconCopy = new Float64Array(recon.length);
      reconCopy.set(recon);
      current = reconCopy;
    }
    
    return current;
  }
  
  /**
   * Estimate noise level using MAD (Median Absolute Deviation)
   * Robust estimator: sigma ≈ MAD / 0.6745
   */
  private estimateNoise(firstDetail: Float64Array): number {
    // MAD of first detail level (highest frequency = mostly noise)
    const absValues = Array.from(firstDetail).map(Math.abs);
    const median = this.median(absValues);
    const mad = this.median(absValues.map(v => Math.abs(v - median)));
    
    // Convert MAD to sigma estimate
    const sigma = mad / 0.6745;
    
    return sigma;
  }
  
  /**
   * Calculate adaptive thresholds for each decomposition level
   */
  private calculateAdaptiveThresholds(
    noiseSigma: number,
    levels: number,
    signalLength: number,
    details: Float64Array[]
  ): number[] {
    const thresholds: number[] = [];
    
    for (let level = 0; level < levels; level++) {
      // Universal threshold: lambda = sigma * sqrt(2 * log(N))
      const universalThreshold = noiseSigma * Math.sqrt(2 * Math.log(signalLength));
      
      // Level-dependent scaling (higher levels = coarser scales = higher threshold)
      const levelScale = this.config.levelDependent 
        ? Math.pow(2, level * 0.5) // Exponential scaling per level
        : 1.0;
      
      // SureShrink-style adaptive component
      const detail = details[level];
      const sureThreshold = this.sureThreshold(detail, noiseSigma);
      
      // Hybrid: min of universal and SURE, scaled by config
      const hybridThreshold = Math.min(universalThreshold, sureThreshold) * this.config.thresholdScale;
      
      // Apply temporal smoothing if we have history
      let smoothedThreshold = hybridThreshold * levelScale;
      if (this.lastThresholds.length > level) {
        // EWMA smoothing to prevent threshold jumping
        smoothedThreshold = 0.7 * smoothedThreshold + 0.3 * this.lastThresholds[level];
      }
      
      thresholds.push(Math.max(0.001, smoothedThreshold));
    }
    
    return thresholds;
  }
  
  /**
   * SURE (Stein's Unbiased Risk Estimate) threshold
   * Data-adaptive threshold for each level
   */
  private sureThreshold(detail: Float64Array, sigma: number): number {
    const n = detail.length;
    const sorted = Array.from(detail).map(Math.abs).sort((a, b) => a - b);
    
    // Find threshold that minimizes SURE
    let minRisk = Infinity;
    let bestThreshold = 0;
    
    // Sample candidate thresholds
    const candidates = sorted.filter((_, i) => i % Math.max(1, Math.floor(n / 20)) === 0);
    
    for (const t of candidates) {
      // Count coefficients below threshold (kept) and above (thresholded)
      let kept = 0;
      let thresholded = 0;
      let sumSquares = 0;
      
      for (const x of detail) {
        const absX = Math.abs(x);
        if (absX <= t) {
          kept++;
          sumSquares += x * x;
        } else {
          thresholded++;
          sumSquares += t * t; // Squared bias from soft thresholding
        }
      }
      
      // SURE risk estimate
      const risk = (sumSquares - n * sigma * sigma + 2 * sigma * sigma * kept) / n;
      
      if (risk < minRisk) {
        minRisk = risk;
        bestThreshold = t;
      }
    }
    
    return bestThreshold;
  }
  
  /**
   * Apply thresholding to coefficients
   */
  private threshold(detail: Float64Array, threshold: number, level: number): Float64Array {
    const result = new Float64Array(detail.length);
    
    if (this.config.thresholdMode === 'hard') {
      // Hard thresholding: keep or kill
      for (let i = 0; i < detail.length; i++) {
        result[i] = Math.abs(detail[i]) > threshold ? detail[i] : 0;
      }
    } else {
      // Soft thresholding: shrink towards zero
      for (let i = 0; i < detail.length; i++) {
        const x = detail[i];
        const absX = Math.abs(x);
        if (absX > threshold) {
          result[i] = Math.sign(x) * (absX - threshold);
        } else {
          result[i] = 0;
        }
      }
    }
    
    return result;
  }
  
  /**
   * Update noise level history for temporal adaptation
   */
  private updateNoiseHistory(sigma: number): void {
    this.noiseHistory.push(sigma);
    if (this.noiseHistory.length > this.HISTORY_SIZE) {
      this.noiseHistory.shift();
    }
  }
  
  /**
   * Get smoothed noise estimate from history
   */
  getSmoothedNoiseEstimate(): number {
    if (this.noiseHistory.length === 0) return 0.1;
    
    // Median of recent noise estimates (robust to outliers)
    const sorted = [...this.noiseHistory].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
  
  /**
   * Estimate SNR improvement ratio
   */
  private estimateSNRImprovement(
    original: Float64Array,
    denoised: Float64Array,
    noiseSigma: number
  ): number {
    const noiseVar = noiseSigma * noiseSigma;
    
    // Signal variance estimate
    const mean = original.reduce((a, b) => a + b, 0) / original.length;
    const signalVar = original.reduce((sum, x) => sum + (x - mean) ** 2, 0) / original.length;
    
    // Residual variance (should be close to noiseVar if denoising worked)
    const residual = new Float64Array(original.length);
    for (let i = 0; i < original.length; i++) {
      residual[i] = original[i] - denoised[i];
    }
    const residualVar = residual.reduce((sum, x) => sum + x * x, 0) / residual.length;
    
    // SNR improvement = original SNR / denoised SNR
    const originalSNR = signalVar / noiseVar;
    const denoisedSNR = signalVar / Math.max(1e-10, residualVar);
    
    return denoisedSNR / Math.max(1e-10, originalSNR);
  }
  
  /**
   * Calculate median of array
   */
  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 
      ? sorted[mid] 
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  /**
   * Get last applied thresholds (for debugging)
   */
  getLastThresholds(): number[] {
    return [...this.lastThresholds];
  }
  
  /**
   * Reset internal state
   */
  reset(): void {
    this.noiseHistory = [];
    this.lastThresholds = [];
  }
}

// Factory function
export function createAdaptiveWaveletDenoiser(config?: Partial<WaveletConfig>): AdaptiveWaveletDenoiser {
  return new AdaptiveWaveletDenoiser(config);
}

// Legacy compatibility: simple wavelet denoise function
export function waveletDenoise(signal: Float64Array, levels: number = 4): Float64Array {
  const denoiser = new AdaptiveWaveletDenoiser({
    levels,
    thresholdMode: 'soft',
    thresholdScale: 1.0
  });
  
  const result = denoiser.denoise(signal);
  return result.signal;
}
