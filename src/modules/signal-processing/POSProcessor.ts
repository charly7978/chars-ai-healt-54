/**
 * POS (Plane Orthogonal to Skin) PPG Signal Extraction
 * 
 * Based on: Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2016)
 * "Algorithmic principles of remote PPG." IEEE Transactions on Biomedical Engineering, 64(7), 1479-1491.
 * 
 * POS projects RGB signals onto a plane orthogonal to the skin tone direction,
 * providing robust pulse extraction even under varying illumination and motion.
 * 
 * Key advantages over CHROM:
 * - Better performance in low-light conditions
 * - More robust to specular reflections
 * - Adaptive weighting based on signal quality
 * 
 * Algorithm steps:
 * 1. Normalize RGB to remove illumination
 * 2. Compute temporal standard deviations
 * 3. Project onto plane orthogonal to skin tone
 * 4. Apply bandpass filtering
 */

export class POSProcessor {
  private bufferR: Float64Array;
  private bufferG: Float64Array;
  private bufferB: Float64Array;
  private bufferSize: number;
  private bufferIndex: number = 0;
  private filled: boolean = false;

  // Skin tone direction vector (standard skin subspace)
  private readonly skinDirection = [1, -1, 0];  // Simplified direction

  // Bandpass filter state (0.7 Hz - 4 Hz for heart rate 42-240 BPM)
  private filterState = {
    x1: 0, x2: 0, x3: 0,
    y1: 0, y2: 0, y3: 0
  };

  // Butterworth bandpass coefficients (3rd order, 0.7-4 Hz at 30 Hz sample rate)
  private readonly bandpassCoeffs = {
    b0: 0.0181, b1: 0, b2: -0.0543, b3: 0,
    a1: -2.6114, a2: 2.2899, a3: -0.6566
  };

  constructor(bufferSize: number = 300) {
    this.bufferSize = bufferSize;
    this.bufferR = new Float64Array(bufferSize);
    this.bufferG = new Float64Array(bufferSize);
    this.bufferB = new Float64Array(bufferSize);
  }

  /**
   * Process a new RGB frame and extract POS-based PPG signal
   */
  processFrame(r: number, g: number, b: number): number | null {
    this.bufferR[this.bufferIndex] = r;
    this.bufferG[this.bufferIndex] = g;
    this.bufferB[this.bufferIndex] = b;

    this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
    if (this.bufferIndex === 0) this.filled = true;

    if (!this.filled && this.bufferIndex < 60) return null;

    const effectiveLength = this.filled ? this.bufferSize : this.bufferIndex;
    const posSignal = this.extractPOSSignal(effectiveLength);

    return this.bandpassFilter(posSignal);
  }

  /**
   * Extract POS signal using plane orthogonal projection
   */
  private extractPOSSignal(length: number): number {
    // Normalize RGB
    const normalizedR = new Float64Array(length);
    const normalizedG = new Float64Array(length);
    const normalizedB = new Float64Array(length);

    for (let i = 0; i < length; i++) {
      const sum = this.bufferR[i] + this.bufferG[i] + this.bufferB[i];
      if (sum > 0) {
        normalizedR[i] = this.bufferR[i] / sum;
        normalizedG[i] = this.bufferG[i] / sum;
        normalizedB[i] = this.bufferB[i] / sum;
      }
    }

    // Compute temporal standard deviations
    const stdR = this.computeStd(normalizedR, length);
    const stdG = this.computeStd(normalizedG, length);
    const stdB = this.computeStd(normalizedB, length);

    // Adaptive weighting based on signal quality
    const totalStd = stdR + stdG + stdB;
    const wR = totalStd > 0 ? stdR / totalStd : 1/3;
    const wG = totalStd > 0 ? stdG / totalStd : 1/3;
    const wB = totalStd > 0 ? stdB / totalStd : 1/3;

    // Get latest frame
    const idx = (this.bufferIndex - 1 + this.bufferSize) % this.bufferSize;
    const nr = normalizedR[idx];
    const ng = normalizedG[idx];
    const nb = normalizedB[idx];

    // Project onto plane orthogonal to skin tone
    // S = wR*(R - G) + wG*(2*G - R - B) + wB*(B - G)
    const posSignal = wR * (nr - ng) + wG * (2 * ng - nr - nb) + wB * (nb - ng);

    return posSignal;
  }

  /**
   * Compute standard deviation of signal
   */
  private computeStd(signal: Float64Array, length: number): number {
    if (length === 0) return 0;

    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += signal[i];
    }
    const mean = sum / length;

    let variance = 0;
    for (let i = 0; i < length; i++) {
      const diff = signal[i] - mean;
      variance += diff * diff;
    }

    return Math.sqrt(variance / length);
  }

  /**
   * Apply 3rd order Butterworth bandpass filter
   */
  private bandpassFilter(input: number): number {
    const output = 
      this.bandpassCoeffs.b0 * input +
      this.bandpassCoeffs.b1 * this.filterState.x1 +
      this.bandpassCoeffs.b2 * this.filterState.x2 +
      this.bandpassCoeffs.b3 * this.filterState.x3 -
      this.bandpassCoeffs.a1 * this.filterState.y1 -
      this.bandpassCoeffs.a2 * this.filterState.y2 -
      this.bandpassCoeffs.a3 * this.filterState.y3;

    this.filterState.x3 = this.filterState.x2;
    this.filterState.x2 = this.filterState.x1;
    this.filterState.x1 = input;
    this.filterState.y3 = this.filterState.y2;
    this.filterState.y2 = this.filterState.y1;
    this.filterState.y1 = output;

    return output;
  }

  /**
   * Get the entire POS signal buffer
   */
  getSignal(): Float64Array {
    const result = new Float64Array(this.bufferSize);
    const length = this.filled ? this.bufferSize : this.bufferIndex;

    for (let i = 0; i < length; i++) {
      const sum = this.bufferR[i] + this.bufferG[i] + this.bufferB[i];
      if (sum > 0) {
        const nr = this.bufferR[i] / sum;
        const ng = this.bufferG[i] / sum;
        const nb = this.bufferB[i] / sum;
        result[i] = nr - ng;  // Simplified POS
      }
    }

    return result;
  }

  /**
   * Get signal quality metrics
   */
  getQualityMetrics(): {
    snr: number;
    stability: number;
    power: number;
  } {
    const signal = this.getSignal();
    const length = this.filled ? this.bufferSize : this.bufferIndex;

    if (length < 30) return { snr: 0, stability: 0, power: 0 };

    let power = 0;
    for (let i = 0; i < length; i++) {
      power += signal[i] * signal[i];
    }
    power /= length;

    let envelope = 0;
    for (let i = 1; i < length; i++) {
      envelope += Math.abs(signal[i] - signal[i-1]);
    }
    const stability = length > 0 ? 1 - (envelope / length) : 0;

    const snr = power > 0 ? Math.min(100, power * 10000) : 0;

    return { snr, stability: Math.max(0, stability), power };
  }

  /**
   * Reset processor state
   */
  reset(): void {
    this.bufferIndex = 0;
    this.filled = false;
    this.filterState = { x1: 0, x2: 0, x3: 0, y1: 0, y2: 0, y3: 0 };
    this.bufferR.fill(0);
    this.bufferG.fill(0);
    this.bufferB.fill(0);
  }
}
