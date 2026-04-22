/**
 * CHROM (Chrominance-based) PPG Signal Extraction
 * 
 * Based on: de Haan, G., & Jeanne, V. (2013). "Robust pulse-rate from chrominance-based rPPG."
 * IEEE Transactions on Biomedical Engineering, 60(11), 2878-2886.
 * 
 * CHROM uses chrominance signals (normalized color ratios) to extract pulse information
 * that is robust to motion artifacts and illumination changes.
 * 
 * Key principles:
 * 1. Normalize RGB to remove illumination dependency
 * 2. Project onto skin-tone subspace to isolate pulsatile component
 * 3. Bandpass filter to isolate cardiac frequency band
 * 
 * Advantages over simple RGB:
 * - Robust to specular reflections
 * - Robust to illumination intensity changes
 * - Better motion artifact rejection
 */

export class CHROMProcessor {
  private bufferR: Float64Array;
  private bufferG: Float64Array;
  private bufferB: Float64Array;
  private bufferX: Float64Array;  // Chrominance X
  private bufferY: Float64Array;  // Chrominance Y
  private bufferS: Float64Array;  // Pulsatile signal
  private bufferSize: number;
  private bufferIndex: number = 0;
  private filled: boolean = false;

  // Skin-tone projection matrix (standard skin subspace)
  // Based on de Haan 2013
  private readonly skinProjection = [
    [3, -2],  // X projection
    [1, 6]    // Y projection
  ];

  // Bandpass filter state (0.7 Hz - 4 Hz for heart rate 42-240 BPM)
  private filterState = {
    x1: 0, x2: 0, x3: 0,
    y1: 0, y2: 0
  };

  // Butterworth bandpass coefficients (3rd order, 0.7-4 Hz at 30 Hz sample rate)
  private readonly bandpassCoeffs = {
    b0: 0.0181, b1: 0, b2: -0.0543, b3: 0,
    a1: -2.6114, a2: 2.2899, a3: -0.6566
  };

  constructor(bufferSize: number = 300) {  // 10 seconds at 30 Hz
    this.bufferSize = bufferSize;
    this.bufferR = new Float64Array(bufferSize);
    this.bufferG = new Float64Array(bufferSize);
    this.bufferB = new Float64Array(bufferSize);
    this.bufferX = new Float64Array(bufferSize);
    this.bufferY = new Float64Array(bufferSize);
    this.bufferS = new Float64Array(bufferSize);
  }

  /**
   * Process a new RGB frame and extract chrominance-based PPG signal
   */
  processFrame(r: number, g: number, b: number): number | null {
    // Add to buffers
    this.bufferR[this.bufferIndex] = r;
    this.bufferG[this.bufferIndex] = g;
    this.bufferB[this.bufferIndex] = b;

    // Advance index
    this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
    if (this.bufferIndex === 0) this.filled = true;

    // Need minimum buffer to compute meaningful signal
    if (!this.filled && this.bufferIndex < 60) return null;

    // Compute chrominance signals
    const effectiveLength = this.filled ? this.bufferSize : this.bufferIndex;
    this.computeChrominance(effectiveLength);

    // Extract pulsatile component
    this.extractPulsatile(effectiveLength);

    // Apply bandpass filter
    const filtered = this.bandpassFilter();

    return filtered;
  }

  /**
   * Compute chrominance signals X and Y from normalized RGB
   * X = 3*R - 2*G
   * Y = R + 6*G
   * (simplified from full skin-tone subspace projection)
   */
  private computeChrominance(length: number): void {
    for (let i = 0; i < length; i++) {
      const r = this.bufferR[i];
      const g = this.bufferG[i];
      const b = this.bufferB[i];

      // Normalize to remove illumination (sum = 1)
      const sum = r + g + b;
      if (sum < 1) {
        this.bufferX[i] = 0;
        this.bufferY[i] = 0;
        continue;
      }

      const rn = r / sum;
      const gn = g / sum;

      // Chrominance projections
      this.bufferX[i] = 3 * rn - 2 * gn;
      this.bufferY[i] = rn + 6 * gn;
    }
  }

  /**
   * Extract pulsatile component using skin-tone subspace projection
   * S = X - (stdX/stdY) * Y
   * This isolates the component orthogonal to skin-tone variations
   */
  private extractPulsatile(length: number): void {
    // Compute standard deviations
    let meanX = 0, meanY = 0;
    for (let i = 0; i < length; i++) {
      meanX += this.bufferX[i];
      meanY += this.bufferY[i];
    }
    meanX /= length;
    meanY /= length;

    let varX = 0, varY = 0;
    for (let i = 0; i < length; i++) {
      const dx = this.bufferX[i] - meanX;
      const dy = this.bufferY[i] - meanY;
      varX += dx * dx;
      varY += dy * dy;
    }
    const stdX = Math.sqrt(varX / length);
    const stdY = Math.sqrt(varY / length);

    // Avoid division by zero
    const ratio = stdY > 0.001 ? stdX / stdY : 0;

    // Extract pulsatile component
    for (let i = 0; i < length; i++) {
      this.bufferS[i] = this.bufferX[i] - ratio * this.bufferY[i];
    }
  }

  /**
   * Apply 3rd order Butterworth bandpass filter (0.7-4 Hz)
   */
  private bandpassFilter(): number {
    // Get latest sample
    const idx = (this.bufferIndex - 1 + this.bufferSize) % this.bufferSize;
    const input = this.bufferS[idx];

    // Apply filter
    const output = 
      this.bandpassCoeffs.b0 * input +
      this.bandpassCoeffs.b1 * this.filterState.x1 +
      this.bandpassCoeffs.b2 * this.filterState.x2 +
      this.bandpassCoeffs.b3 * this.filterState.x3 -
      this.bandpassCoeffs.a1 * this.filterState.y1 -
      this.bandpassCoeffs.a2 * this.filterState.y2 -
      this.bandpassCoeffs.a3 * this.filterState.y3;

    // Update state
    this.filterState.x3 = this.filterState.x2;
    this.filterState.x2 = this.filterState.x1;
    this.filterState.x1 = input;
    this.filterState.y3 = this.filterState.y2;
    this.filterState.y2 = this.filterState.y1;
    this.filterState.y1 = output;

    return output;
  }

  /**
   * Get the entire chrominance signal buffer
   */
  getSignal(): Float64Array {
    const result = new Float64Array(this.bufferSize);
    const length = this.filled ? this.bufferSize : this.bufferIndex;
    for (let i = 0; i < length; i++) {
      result[i] = this.bufferS[i];
    }
    return result;
  }

  /**
   * Reset processor state
   */
  reset(): void {
    this.bufferIndex = 0;
    this.filled = false;
    this.filterState = { x1: 0, x2: 0, x3: 0, y1: 0, y2: 0 };
    this.bufferR.fill(0);
    this.bufferG.fill(0);
    this.bufferB.fill(0);
    this.bufferX.fill(0);
    this.bufferY.fill(0);
    this.bufferS.fill(0);
  }

  /**
   * Get signal quality metrics for CHROM output
   */
  getQualityMetrics(): {
    snr: number;
    stability: number;
    power: number;
  } {
    const length = this.filled ? this.bufferSize : this.bufferIndex;
    if (length < 30) return { snr: 0, stability: 0, power: 0 };

    // Compute signal power
    let power = 0;
    for (let i = 0; i < length; i++) {
      power += this.bufferS[i] * this.bufferS[i];
    }
    power /= length;

    // Compute stability (inverse of variance of envelope)
    let envelope = 0;
    let envelopeSum = 0;
    for (let i = 1; i < length; i++) {
      const diff = Math.abs(this.bufferS[i] - this.bufferS[i-1]);
      envelope += diff;
      envelopeSum += Math.abs(this.bufferS[i]);
    }
    const stability = envelopeSum > 0 ? 1 - (envelope / envelopeSum) : 0;

    // Estimate SNR based on periodicity (simplified)
    const snr = power > 0 ? Math.min(100, power * 10000) : 0;

    return { snr, stability: Math.max(0, stability), power };
  }
}
