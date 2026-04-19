/**
 * GOERTZEL FILTER BANK — selective DFT bin probing
 *
 * For HR estimation we don't need a full FFT; we need power at a small set
 * of frequencies covering the cardiac band (0.6 .. 3.5 Hz, i.e. 36–210 bpm).
 * The Goertzel algorithm computes the magnitude of a single DFT bin in
 * O(N) per bin without complex multiplications, which is cheaper than a
 * full FFT for ≤30 bins.
 *
 * Reference: Goertzel (1958), "An algorithm for the evaluation of finite
 * trigonometric series".
 */

export interface GoertzelBin {
  /** Centre frequency in Hz */
  freqHz: number;
  /** Power at this bin (last call). 0 until at least N samples were processed. */
  power: number;
}

export class GoertzelBank {
  private sampleRate: number;
  private freqs: number[];
  private coeffs: Float64Array;
  // Per-bin filter state s_{n-1}, s_{n-2}
  private s1: Float64Array;
  private s2: Float64Array;
  // Sliding-window sum: number of samples that have been pushed since last
  // power compute
  private samplesInWindow = 0;
  private windowSize: number;
  private latestPower: Float64Array;

  /**
   * @param sampleRate sample rate of the input PPG signal (Hz)
   * @param freqs array of centre frequencies to probe (Hz)
   * @param windowSize samples per analysis window (default 256)
   */
  constructor(sampleRate: number, freqs: number[], windowSize = 256) {
    this.sampleRate = sampleRate;
    this.freqs = [...freqs];
    this.windowSize = windowSize;
    this.coeffs = new Float64Array(freqs.length);
    this.s1 = new Float64Array(freqs.length);
    this.s2 = new Float64Array(freqs.length);
    this.latestPower = new Float64Array(freqs.length);
    this.recomputeCoefficients();
  }

  setSampleRate(fs: number): void {
    if (Math.abs(fs - this.sampleRate) < 1.5) return;
    this.sampleRate = fs;
    this.recomputeCoefficients();
    this.reset();
  }

  setFrequencies(freqs: number[]): void {
    this.freqs = [...freqs];
    this.coeffs = new Float64Array(freqs.length);
    this.s1 = new Float64Array(freqs.length);
    this.s2 = new Float64Array(freqs.length);
    this.latestPower = new Float64Array(freqs.length);
    this.recomputeCoefficients();
  }

  private recomputeCoefficients(): void {
    for (let k = 0; k < this.freqs.length; k++) {
      const omega = 2 * Math.PI * this.freqs[k] / this.sampleRate;
      this.coeffs[k] = 2 * Math.cos(omega);
    }
  }

  reset(): void {
    this.s1.fill(0);
    this.s2.fill(0);
    this.latestPower.fill(0);
    this.samplesInWindow = 0;
  }

  /** Push one sample. Returns true when a window completed and powers were updated. */
  push(sample: number): boolean {
    for (let k = 0; k < this.freqs.length; k++) {
      const s0 = sample + this.coeffs[k] * this.s1[k] - this.s2[k];
      this.s2[k] = this.s1[k];
      this.s1[k] = s0;
    }
    this.samplesInWindow++;
    if (this.samplesInWindow >= this.windowSize) {
      // Compute powers and reset state for next window
      for (let k = 0; k < this.freqs.length; k++) {
        const re = this.s1[k] - this.s2[k] * Math.cos(2 * Math.PI * this.freqs[k] / this.sampleRate);
        const im = this.s2[k] * Math.sin(2 * Math.PI * this.freqs[k] / this.sampleRate);
        this.latestPower[k] = (re * re + im * im) / this.windowSize;
        this.s1[k] = 0;
        this.s2[k] = 0;
      }
      this.samplesInWindow = 0;
      return true;
    }
    return false;
  }

  /** Return the bin with the highest power (call after push() returned true). */
  bestBin(): GoertzelBin {
    let bestIdx = 0;
    let bestPower = 0;
    for (let k = 0; k < this.freqs.length; k++) {
      if (this.latestPower[k] > bestPower) { bestPower = this.latestPower[k]; bestIdx = k; }
    }
    return { freqHz: this.freqs[bestIdx], power: bestPower };
  }

  /** Convenience: search peak in bpm range. */
  bestBpmInRange(minBpm: number, maxBpm: number): { bpm: number; power: number } {
    let bestIdx = -1;
    let bestPower = 0;
    for (let k = 0; k < this.freqs.length; k++) {
      const bpm = this.freqs[k] * 60;
      if (bpm < minBpm || bpm > maxBpm) continue;
      if (this.latestPower[k] > bestPower) { bestPower = this.latestPower[k]; bestIdx = k; }
    }
    if (bestIdx < 0) return { bpm: 0, power: 0 };
    return { bpm: this.freqs[bestIdx] * 60, power: bestPower };
  }

  /** Build a default cardiac-range bank (0.5..3.5 Hz, 0.05 Hz steps). */
  static cardiac(sampleRate: number, windowSize = 256): GoertzelBank {
    const freqs: number[] = [];
    for (let f = 0.5; f <= 3.5 + 1e-9; f += 0.05) freqs.push(Math.round(f * 100) / 100);
    return new GoertzelBank(sampleRate, freqs, windowSize);
  }
}
