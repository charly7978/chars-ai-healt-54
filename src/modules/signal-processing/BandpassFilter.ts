/**
 * BANDPASS FILTER V3 — LINEAR PHASE FIR (WINDOWED-SINC)
 * 
 * Replaces IIR Butterworth with a Finite Impulse Response (FIR) filter using a Hamming window.
 * 
 * WHY FIR?
 * - Zero phase distortion (Linear Phase): IIR filters distort the phase, moving the
 *   dicrotic notch and systolic peaks out of their true temporal locations. FIR keeps
 *   the entire wave shape intact, which is mathematically CRITICAL for Stiffness Index,
 *   Augmentation Index, and Blood Pressure estimation.
 * - Stability: FIR filters are inherently stable (no feedback loop).
 * 
 * Bandpass: ~0.5 Hz (30 BPM) to ~4.5 Hz (270 BPM)
 */
import { RingBuffer } from './RingBuffer';

export class BandpassFilter {
  private sampleRate: number;
  private lastComputedRate = 0;
  
  // FIR Filter specifications
  private readonly ORDER = 40; // N=40 -> 41 taps. Good balance of resolution and low delay at 30-60fps
  private coefficients: Float64Array;
  private history: RingBuffer;

  // Detrending state (exponential moving average baseline)
  private baselineEWMA = 0;
  private baselineInitialized = false;
  private readonly DETREND_ALPHA = 0.015; // slow-moving baseline

  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
    this.coefficients = new Float64Array(this.ORDER + 1);
    this.history = new RingBuffer(this.ORDER + 1);
    this.computeCoefficients();
  }

  /**
   * Generates Bandpass FIR coefficients using the Windowed-Sinc method (Hamming Window)
   */
  private computeCoefficients(): void {
    const fs = this.sampleRate;
    this.lastComputedRate = fs;

    // Frequencies
    const fLow = 0.5; // High-pass cutoff
    const fHigh = 4.5; // Low-pass cutoff

    // Normalized angular frequencies (0 to PI)
    const w1 = 2 * Math.PI * (fLow / fs);
    const w2 = 2 * Math.PI * (fHigh / fs);

    const M = this.ORDER / 2;
    let sum = 0;

    for (let i = 0; i <= this.ORDER; i++) {
      const n = i - M;
      let h = 0;

      // Ideal bandpass impulse response: Lowpass(w2) - Lowpass(w1)
      if (n === 0) {
        h = (w2 - w1) / Math.PI;
      } else {
        h = (Math.sin(w2 * n) - Math.sin(w1 * n)) / (Math.PI * n);
      }

      // Hamming window
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / this.ORDER);
      h = h * window;

      this.coefficients[i] = h;
      sum += h;
    }

    // Optional: Normalization to preserve amplitude scale
    // For a bandpass, we normalize by the gain at the center frequency
    const wCenter = (w1 + w2) / 2;
    let gain = 0;
    for (let i = 0; i <= this.ORDER; i++) {
      const n = i - M;
      gain += this.coefficients[i] * Math.cos(wCenter * n);
    }
    
    if (Math.abs(gain) > 0.001) {
      for (let i = 0; i <= this.ORDER; i++) {
        this.coefficients[i] /= gain;
      }
    }
  }

  /** Detrend: remove slow baseline wander */
  detrend(value: number): number {
    if (!this.baselineInitialized) {
      this.baselineEWMA = value;
      this.baselineInitialized = true;
      return 0;
    }
    this.baselineEWMA = this.baselineEWMA * (1 - this.DETREND_ALPHA) + value * this.DETREND_ALPHA;
    return value - this.baselineEWMA;
  }

  /** Full pipeline: detrend → FIR Bandpass */
  filter(value: number): number {
    if (!isFinite(value)) return 0;
    
    // 1. Remove massive DC wandering
    const detrended = this.detrend(value);
    
    // 2. Push to history buffer
    this.history.push(detrended);

    // 3. Wait until buffer is full enough to filter
    if (this.history.length < this.ORDER + 1) {
      return 0; // Pre-roll phase
    }

    // 4. Apply FIR Filter (Convolution)
    let output = 0;
    const len = this.ORDER + 1;
    // history.get(0) is the oldest, history.get(len-1) is the newest.
    // Convolution: sum(coeff[i] * x[n - i])
    for (let i = 0; i < len; i++) {
      // history.get(len - 1 - i) gets the sample delayed by 'i'
      output += this.coefficients[i] * this.history.get(len - 1 - i);
    }

    return output;
  }

  /** Get detrended value only (no bandpass) */
  getDetrended(value: number): number {
    return this.detrend(value);
  }

  reset(): void {
    this.history.clear();
    this.baselineEWMA = 0;
    this.baselineInitialized = false;
  }

  /** Only recompute if rate changed significantly (>2.0 fps) */
  setSampleRate(rate: number): void {
    if (Math.abs(rate - this.lastComputedRate) < 2.0) return;
    this.sampleRate = rate;
    this.computeCoefficients();
  }
}
