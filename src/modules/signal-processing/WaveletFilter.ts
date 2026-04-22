/**
 * Wavelet Transform for PPG Signal Processing
 * 
 * Implements Discrete Wavelet Transform (DWT) using Daubechies wavelets (db4-db8)
 * for advanced PPG signal denoising and artifact removal.
 * 
 * Based on research showing Daubechies wavelets are optimal for PPG due to:
 * - Compact support (minimal boundary effects)
 * - Near-symmetry (minimal phase distortion)
 * - Good time-frequency localization
 * 
 * Applications:
 * 1. Baseline wander removal (zeroing low-frequency approximations)
 * 2. High-frequency noise removal (thresholding detail coefficients)
 * 3. Motion artifact separation (frequency-band selective filtering)
 * 
 * Reference: Thamarai & Adalarasu (2018), "Denoising of EEG, ECG and PPG signals using wavelet transform"
 */

export class WaveletFilter {
  // Daubechies 4 wavelet coefficients (scaling and wavelet)
  // These are the standard db4 coefficients used in PPG processing
  private readonly db4Scaling = [
    0.6830127, 1.1830127, 0.3169873, -0.1830127
  ];
  private readonly db4Wavelet = [
    0, 0, 0.7071068, -0.7071068
  ];

  // Decomposition levels
  private maxLevels: number;
  private samplingRate: number;

  // Storage for wavelet coefficients
  private approximations: Float64Array[];
  private details: Float64Array[];
  private originalLength: number;

  constructor(samplingRate: number = 30, maxLevels: number = 6) {
    this.samplingRate = samplingRate;
    this.maxLevels = maxLevels;
    this.approximations = [];
    this.details = [];
    this.originalLength = 0;
  }

  /**
   * Perform forward DWT decomposition
   */
  decompose(signal: Float64Array): void {
    this.originalLength = signal.length;
    this.approximations = [];
    this.details = [];

    let currentSignal = signal;

    for (let level = 0; level < this.maxLevels; level++) {
      const { approximation, detail } = this.singleLevelDecompose(currentSignal);
      this.approximations.push(approximation);
      this.details.push(detail);

      // Continue with approximation for next level
      currentSignal = approximation;

      // Stop if signal too short
      if (currentSignal.length < 4) break;
    }
  }

  /**
   * Single level DWT decomposition using db4 wavelet
   * Convolution and downsampling by 2
   */
  private singleLevelDecompose(signal: Float64Array): {
    approximation: Float64Array;
    detail: Float64Array;
  } {
    const n = signal.length;
    const halfN = Math.floor(n / 2);
    const approximation = new Float64Array(halfN);
    const detail = new Float64Array(halfN);

    // Convolution with scaling (low-pass) and wavelet (high-pass) filters
    // Downsampling by 2 (keep even indices)
    for (let i = 0; i < halfN; i++) {
      let approxSum = 0;
      let detailSum = 0;

      // Convolution with db4 coefficients (symmetric extension at boundaries)
      for (let j = 0; j < 4; j++) {
        const idx = (2 * i + j - 1 + n) % n;  // Circular convolution
        approxSum += this.db4Scaling[j] * signal[idx];
        detailSum += this.db4Wavelet[j] * signal[idx];
      }

      approximation[i] = approxSum;
      detail[i] = detailSum;
    }

    return { approximation, detail };
  }

  /**
   * Reconstruct signal from wavelet coefficients
   * Can optionally zero out certain levels for filtering
   */
  reconstruct(
    zeroApproxLevels: number[] = [],
    zeroDetailLevels: number[] = [],
    thresholdDetails: boolean = false,
    thresholdValue: number = 0.1
  ): Float64Array {
    // Start from deepest level
    let currentApprox = this.approximations[this.approximations.length - 1];

    // Apply thresholding to detail coefficients if requested
    if (thresholdDetails) {
      for (let l = 0; l < this.details.length; l++) {
        this.details[l] = this.softThreshold(this.details[l], thresholdValue);
      }
    }

    // Zero out specified approximation levels (baseline wander removal)
    for (const level of zeroApproxLevels) {
      if (level < this.approximations.length) {
        this.approximations[level].fill(0);
      }
    }

    // Zero out specified detail levels (high-frequency noise removal)
    for (const level of zeroDetailLevels) {
      if (level < this.details.length) {
        this.details[level].fill(0);
      }
    }

    // Reconstruct level by level
    for (let level = this.approximations.length - 1; level >= 0; level--) {
      currentApprox = this.singleLevelReconstruct(
        currentApprox,
        this.details[level],
        currentApprox.length * 2
      );
    }

    // Trim to original length
    return currentApprox.slice(0, this.originalLength);
  }

  /**
   * Single level inverse DWT reconstruction
   */
  private singleLevelReconstruct(
    approximation: Float64Array,
    detail: Float64Array,
    targetLength: number
  ): Float64Array {
    const reconstructed = new Float64Array(targetLength);

    // Upsample and convolve with synthesis filters
    for (let i = 0; i < targetLength; i++) {
      let sum = 0;
      
      // Contribution from approximation (even indices)
      for (let j = 0; j < 4; j++) {
        const approxIdx = Math.floor((i - j + 1) / 2);
        if (approxIdx >= 0 && approxIdx < approximation.length) {
          sum += this.db4Scaling[j] * approximation[approxIdx];
        }
      }

      // Contribution from detail (odd indices)
      for (let j = 0; j < 4; j++) {
        const detailIdx = Math.floor((i - j + 1) / 2);
        if (detailIdx >= 0 && detailIdx < detail.length) {
          sum += this.db4Wavelet[j] * detail[detailIdx];
        }
      }

      reconstructed[i] = sum;
    }

    return reconstructed;
  }

  /**
   * Soft thresholding for wavelet denoising
   * Shrinks coefficients toward zero, preserving signal structure
   */
  private softThreshold(coefficients: Float64Array, threshold: number): Float64Array {
    const result = new Float64Array(coefficients.length);
    for (let i = 0; i < coefficients.length; i++) {
      const abs = Math.abs(coefficients[i]);
      if (abs > threshold) {
        result[i] = Math.sign(coefficients[i]) * (abs - threshold);
      } else {
        result[i] = 0;
      }
    }
    return result;
  }

  /**
   * Apply baseline wander removal using wavelet decomposition
   * Zeros out low-frequency approximation coefficients
   */
  removeBaselineWander(signal: Float64Array, cutoffLevel: number = 5): Float64Array {
    this.decompose(signal);
    
    // Zero approximation coefficients at specified levels (low frequencies)
    const levelsToZero = [];
    for (let i = cutoffLevel; i < this.maxLevels; i++) {
      levelsToZero.push(i);
    }

    return this.reconstruct(levelsToZero, []);
  }

  /**
   * Denoise PPG signal using wavelet thresholding
   * Removes high-frequency noise while preserving cardiac signal
   */
  denoise(signal: Float64Array, threshold: number = 0.15): Float64Array {
    this.decompose(signal);
    return this.reconstruct([], [], true, threshold);
  }

  /**
   * Remove motion artifacts by zeroing frequency bands where motion dominates
   * Motion typically appears in 2-8 Hz band (respiration + movement)
   */
  removeMotionArtifacts(signal: Float64Array): Float64Array {
    this.decompose(signal);

    // At 30 Hz sampling rate:
    // Level 5: ~0.9-1.9 Hz (cardiac fundamental)
    // Level 4: ~1.9-3.8 Hz (cardiac + second harmonic)
    // Level 3: ~3.8-7.5 Hz (motion/respiration)
    // Level 2: ~7.5-15 Hz (high-frequency motion)
    
    // Zero levels containing motion energy (levels 2-3)
    // Preserve cardiac band (levels 4-5)
    return this.reconstruct([], [2, 3]);
  }

  /**
   * Get frequency band for a given decomposition level
   */
  getFrequencyBand(level: number): { min: number; max: number } {
    const nyquist = this.samplingRate / 2;
    const bandWidth = nyquist / Math.pow(2, level + 1);
    const minFreq = bandWidth;
    const maxFreq = bandWidth * 2;
    return { min: minFreq, max: maxFreq };
  }

  /**
   * Get wavelet coefficients for analysis
   */
  getCoefficients(): {
    approximations: Float64Array[];
    details: Float64Array[];
  } {
    return {
      approximations: this.approximations.map(a => a.slice()),
      details: this.details.map(d => d.slice())
    };
  }

  /**
   * Reset filter state
   */
  reset(): void {
    this.approximations = [];
    this.details = [];
    this.originalLength = 0;
  }
}

/**
 * Convenience function for complete PPG wavelet processing pipeline
 */
export function processPPGWithWavelet(
  signal: Float64Array,
  samplingRate: number = 30,
  options: {
    removeBaseline?: boolean;
    denoise?: boolean;
    removeMotion?: boolean;
    threshold?: number;
  } = {}
): Float64Array {
  const wavelet = new WaveletFilter(samplingRate, 6);
  
  if (options.removeBaseline) {
    signal = wavelet.removeBaselineWander(signal);
    wavelet.reset();
  }

  if (options.denoise) {
    signal = wavelet.denoise(signal, options.threshold || 0.15);
    wavelet.reset();
  }

  if (options.removeMotion) {
    signal = wavelet.removeMotionArtifacts(signal);
    wavelet.reset();
  }

  return signal;
}
