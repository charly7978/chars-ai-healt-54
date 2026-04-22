/**
 * Empirical Mode Decomposition (EMD) for PPG Signal Processing
 * 
 * Based on: Huang et al. (1998) "The empirical mode decomposition and the Hilbert spectrum"
 * 
 * EMD decomposes a signal into Intrinsic Mode Functions (IMFs) adaptively
 * without requiring predetermined basis functions (unlike wavelet transform).
 * 
 * Advantages for PPG:
 * - Adaptive to local signal characteristics
 * - Excellent for non-stationary signals
 * - Separates different physiological components (cardiac, respiratory, motion)
 * - No need to choose wavelet basis
 * 
 * IMF Criteria:
 * 1. Number of extrema and zero-crossings must be equal or differ by at most one
 * 2. At any point, the mean of envelopes defined by local maxima and minima is zero
 * 
 * Algorithm (Sifting Process):
 * 1. Identify all local extrema
 * 2. Interpolate upper and lower envelopes
 * 3. Compute mean of envelopes
 * 4. Subtract mean from signal
 * 5. Repeat until IMF criteria satisfied
 * 6. Extract IMF and repeat on residue
 */

export interface IMF {
  data: Float64Array;
  meanFrequency: number;
  energy: number;
}

export class EMDProcessor {
  private maxIMFs: number;
  private maxSiftIterations: number;
  private stopThreshold: number;

  constructor(
    maxIMFs: number = 8,
    maxSiftIterations: number = 10,
    stopThreshold: number = 0.05
  ) {
    this.maxIMFs = maxIMFs;
    this.maxSiftIterations = maxSiftIterations;
    this.stopThreshold = stopThreshold;
  }

  /**
   * Perform EMD decomposition on signal
   */
  decompose(signal: Float64Array): {
    imfs: IMF[];
    residue: Float64Array;
  } {
    if (signal.length < 10) {
      return {
        imfs: [],
        residue: signal
      };
    }

    const imfs: IMF[] = [];
    let residue: Float64Array = new Float64Array(signal.length);
    residue.set(signal);

    for (let i = 0; i < this.maxIMFs; i++) {
      // Check if residue is monotonic (stop condition)
      if (this.isMonotonic(residue)) {
        break;
      }

      // Extract IMF using sifting process
      const imf = this.extractIMF(residue);

      if (imf.data.length === 0) {
        break;
      }

      // Compute IMF characteristics
      imf.meanFrequency = this.estimateMeanFrequency(imf.data);
      imf.energy = this.computeEnergy(imf.data);

      imfs.push(imf);

      // Update residue
      residue = this.subtract(residue, imf.data);
    }

    return { imfs, residue };
  }

  /**
   * Extract single IMF using sifting process
   */
  private extractIMF(signal: Float64Array): IMF {
    let h: Float64Array = signal.slice();
    let prevH: Float64Array = new Float64Array(signal.length);
    let iteration = 0;

    while (iteration < this.maxSiftIterations) {
      // Store previous iteration for stopping criterion
      prevH.set(h);

      // Find extrema
      const maxima = this.findLocalMaxima(h);
      const minima = this.findLocalMinima(h);

      // Need at least 2 maxima and 2 minima to form envelopes
      if (maxima.length < 2 || minima.length < 2) {
        break;
      }

      // Interpolate envelopes (cubic spline approximation)
      const upperEnvelope = this.interpolateEnvelope(h, maxima, true);
      const lowerEnvelope = this.interpolateEnvelope(h, minima, false);

      // Compute mean envelope
      const meanEnvelope = this.computeMean(upperEnvelope, lowerEnvelope);

      // Subtract mean from signal
      h = this.subtract(h, meanEnvelope);

      // Check stopping criterion (SD)
      const sd = this.computeStandardDeviation(h, prevH);
      if (sd < this.stopThreshold) {
        break;
      }

      iteration++;
    }

    return {
      data: h,
      meanFrequency: 0,
      energy: 0
    };
  }

  /**
   * Find local maxima indices
   */
  private findLocalMaxima(signal: Float64Array): number[] {
    const maxima: number[] = [];

    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
        maxima.push(i);
      }
    }

    return maxima;
  }

  /**
   * Find local minima indices
   */
  private findLocalMinima(signal: Float64Array): number[] {
    const minima: number[] = [];

    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] < signal[i - 1] && signal[i] < signal[i + 1]) {
        minima.push(i);
      }
    }

    return minima;
  }

  /**
   * Interpolate envelope (simplified cubic spline)
   * Uses linear interpolation with smoothing for stability
   */
  private interpolateEnvelope(
    signal: Float64Array,
    extrema: number[],
    isUpper: boolean
  ): Float64Array {
    const envelope: Float64Array = new Float64Array(signal.length);

    if (extrema.length < 2) {
      // Not enough extrema, return signal
      return signal.slice();
    }

    // Linear interpolation between extrema
    for (let i = 0; i < extrema.length - 1; i++) {
      const x1 = extrema[i];
      const x2 = extrema[i + 1];
      const y1 = signal[x1];
      const y2 = signal[x2];

      for (let x = x1; x <= x2; x++) {
        const t = (x - x1) / (x2 - x1);
        envelope[x] = y1 + t * (y2 - y1);
      }
    }

    // Extrapolate edges
    const firstExt = extrema[0];
    const lastExt = extrema[extrema.length - 1];

    for (let x = 0; x < firstExt; x++) {
      envelope[x] = signal[firstExt];
    }

    for (let x = lastExt; x < signal.length; x++) {
      envelope[x] = signal[lastExt];
    }

    return envelope;
  }

  /**
   * Compute mean of two envelopes
   */
  private computeMean(env1: Float64Array, env2: Float64Array): Float64Array {
    const mean = new Float64Array(env1.length);

    for (let i = 0; i < env1.length; i++) {
      mean[i] = (env1[i] + env2[i]) / 2;
    }

    return mean;
  }

  /**
   * Subtract two arrays element-wise
   */
  private subtract(a: Float64Array, b: Float64Array): Float64Array {
    const result = new Float64Array(a.length);

    for (let i = 0; i < a.length; i++) {
      result[i] = a[i] - b[i];
    }

    return result;
  }

  /**
   * Compute standard deviation between two iterations (stopping criterion)
   */
  private computeStandardDeviation(current: Float64Array, previous: Float64Array): number {
    let sumSq = 0;
    let sumPrevSq = 0;

    for (let i = 0; i < current.length; i++) {
      sumSq += current[i] * current[i];
      sumPrevSq += previous[i] * previous[i];
    }

    let numerator = 0;
    for (let i = 0; i < current.length; i++) {
      numerator += (current[i] - previous[i]) ** 2;
    }

    const denominator = sumSq + 1e-10;

    return Math.sqrt(numerator / denominator);
  }

  /**
   * Check if signal is monotonic
   */
  private isMonotonic(signal: Float64Array): boolean {
    if (signal.length < 2) return true;

    let increasing = true;
    let decreasing = true;

    for (let i = 1; i < signal.length; i++) {
      if (signal[i] < signal[i - 1]) increasing = false;
      if (signal[i] > signal[i - 1]) decreasing = false;
    }

    return increasing || decreasing;
  }

  /**
   * Estimate mean frequency of IMF using zero-crossing rate
   */
  private estimateMeanFrequency(signal: Float64Array, sampleRate: number = 30): number {
    let zeroCrossings = 0;

    for (let i = 1; i < signal.length; i++) {
      if ((signal[i] >= 0 && signal[i - 1] < 0) || (signal[i] < 0 && signal[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }

    // Frequency = zero-crossings / (2 * duration)
    const frequency = zeroCrossings / (2 * (signal.length / sampleRate));

    return frequency;
  }

  /**
   * Compute energy of signal
   */
  private computeEnergy(signal: Float64Array): number {
    let energy = 0;

    for (let i = 0; i < signal.length; i++) {
      energy += signal[i] * signal[i];
    }

    return energy / signal.length;
  }

  /**
   * Identify cardiac IMF based on frequency
   * Cardiac component typically in 0.7-4 Hz range
   */
  identifyCardiacIMF(imfs: IMF[], sampleRate: number = 30): {
    cardiacIMF: IMF | null;
    cardiacIndex: number;
  } {
    let cardiacIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < imfs.length; i++) {
      const freq = imfs[i].meanFrequency;
      
      if (freq >= 0.7 && freq <= 4.0) {
        // Score based on energy and frequency appropriateness
        const freqScore = 1 - Math.abs(freq - 1.2) / 3.3;
        const energyScore = Math.min(1, imfs[i].energy / 100);
        const score = freqScore * 0.7 + energyScore * 0.3;

        if (score > bestScore) {
          bestScore = score;
          cardiacIndex = i;
        }
      }
    }

    return {
      cardiacIMF: cardiacIndex >= 0 ? imfs[cardiacIndex] : null,
      cardiacIndex
    };
  }

  /**
   * Denoise signal by reconstructing without high-frequency IMFs
   */
  denoise(
    signal: Float64Array,
    numLowFreqIMFs: number = 3
  ): Float64Array {
    const { imfs, residue } = this.decompose(signal);

    // Reconstruct using only low-frequency IMFs
    const reconstructed = new Float64Array(signal.length);
    const numIMFsToUse = Math.min(numLowFreqIMFs, imfs.length);

    for (let i = 0; i < numIMFsToUse; i++) {
      for (let j = 0; j < signal.length; j++) {
        reconstructed[j] += imfs[i].data[j];
      }
    }

    // Add residue
    for (let j = 0; j < signal.length; j++) {
      reconstructed[j] += residue[j];
    }

    return reconstructed;
  }

  /**
   * Remove baseline wander by excluding lowest frequency IMF
   */
  removeBaselineWander(signal: Float64Array): Float64Array {
    const { imfs, residue } = this.decompose(signal);

    if (imfs.length === 0) {
      return signal;
    }

    // Reconstruct without the lowest frequency IMF (last one)
    const reconstructed = new Float64Array(signal.length);

    for (let i = 0; i < imfs.length - 1; i++) {
      for (let j = 0; j < signal.length; j++) {
        reconstructed[j] += imfs[i].data[j];
      }
    }

    // Add residue
    for (let j = 0; j < signal.length; j++) {
      reconstructed[j] += residue[j];
    }

    return reconstructed;
  }

  /**
   * Reset processor state
   */
  reset(): void {
    // No state to reset for EMD
  }
}
