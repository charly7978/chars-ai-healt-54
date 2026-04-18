/**
 * DUAL-BAND BANDPASS FILTER V3 — ADAPTIVE SAMPLE RATE + DETRENDING
 * 
 * Two separate IIR Butterworth 2nd order filters:
 * - CONTACT/MORPHOLOGY BAND: 0.3–8.0 Hz (wider for contact detection)
 * - HEART BAND: 0.7–4.0 Hz (narrower for heart rate)
 * 
 * - Recalculates coefficients only on significant sample rate change
 * - Includes robust baseline detrending before bandpass
 * - Hampel/spike rejection for outliers
 * - Real sample rate estimation from timestamps
 * - Separates: raw → detrended → bandpassed (both bands)
 */
export class BandpassFilter {
  // CONTACT/MORPHOLOGY BAND (0.3-8.0 Hz)
  private hpfWideB = [0, 0, 0];
  private hpfWideA = [1, 0, 0];
  private lpfWideB = [0, 0, 0];
  private lpfWideA = [1, 0, 0];
  private hpfWideState = { x: [0, 0, 0], y: [0, 0, 0] };
  private lpfWideState = { x: [0, 0, 0], y: [0, 0, 0] };

  // HEART BAND (0.7-4.0 Hz)
  private hpfHeartB = [0, 0, 0];
  private hpfHeartA = [1, 0, 0];
  private lpfHeartB = [0, 0, 0];
  private lpfHeartA = [1, 0, 0];
  private hpfHeartState = { x: [0, 0, 0], y: [0, 0, 0] };
  private lpfHeartState = { x: [0, 0, 0], y: [0, 0, 0] };

  // Detrending state (exponential moving average baseline)
  private baselineEWMA = 0;
  private baselineInitialized = false;
  private readonly DETREND_ALPHA = 0.015; // slow-moving baseline

  // Hampel filter for spike rejection
  private readonly HAMPEL_WINDOW = 15;
  private readonly HAMPEL_THRESHOLD = 3.0;
  private signalBuffer: number[] = [];

  private sampleRate: number;
  private lastComputedRate = 0;
  private initialized = false;

  // Real sample rate estimation
  private timestampBuffer: number[] = [];
  private estimatedSampleRate: number;

  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
    this.estimatedSampleRate = sampleRate;
    this.computeCoefficients();
  }

  private computeCoefficients(): void {
    const fs = this.estimatedSampleRate;
    this.lastComputedRate = fs;

    // --- CONTACT/MORPHOLOGY BAND: 0.3–8.0 Hz ---
    const fcHpWide = 0.3;
    const fcLpWide = 8.0;
    const kHpWide = Math.tan(Math.PI * fcHpWide / fs);
    const kLpWide = Math.tan(Math.PI * fcLpWide / fs);
    const normHpWide = 1 / (1 + Math.sqrt(2) * kHpWide + kHpWide * kHpWide);
    const normLpWide = 1 / (1 + Math.sqrt(2) * kLpWide + kLpWide * kLpWide);

    this.hpfWideB[0] = normHpWide;
    this.hpfWideB[1] = -2 * normHpWide;
    this.hpfWideB[2] = normHpWide;
    this.hpfWideA[0] = 1;
    this.hpfWideA[1] = 2 * (kHpWide * kHpWide - 1) * normHpWide;
    this.hpfWideA[2] = (1 - Math.sqrt(2) * kHpWide + kHpWide * kHpWide) * normHpWide;

    this.lpfWideB[0] = kLpWide * kLpWide * normLpWide;
    this.lpfWideB[1] = 2 * kLpWide * kLpWide * normLpWide;
    this.lpfWideB[2] = kLpWide * kLpWide * normLpWide;
    this.lpfWideA[0] = 1;
    this.lpfWideA[1] = 2 * (kLpWide * kLpWide - 1) * normLpWide;
    this.lpfWideA[2] = (1 - Math.sqrt(2) * kLpWide + kLpWide * kLpWide) * normLpWide;

    // --- HEART BAND: 0.7–4.0 Hz ---
    const fcHpHeart = 0.7;
    const fcLpHeart = 4.0;
    const kHpHeart = Math.tan(Math.PI * fcHpHeart / fs);
    const kLpHeart = Math.tan(Math.PI * fcLpHeart / fs);
    const normHpHeart = 1 / (1 + Math.sqrt(2) * kHpHeart + kHpHeart * kHpHeart);
    const normLpHeart = 1 / (1 + Math.sqrt(2) * kLpHeart + kLpHeart * kLpHeart);

    this.hpfHeartB[0] = normHpHeart;
    this.hpfHeartB[1] = -2 * normHpHeart;
    this.hpfHeartB[2] = normHpHeart;
    this.hpfHeartA[0] = 1;
    this.hpfHeartA[1] = 2 * (kHpHeart * kHpHeart - 1) * normHpHeart;
    this.hpfHeartA[2] = (1 - Math.sqrt(2) * kHpHeart + kHpHeart * kHpHeart) * normHpHeart;

    this.lpfHeartB[0] = kLpHeart * kLpHeart * normLpHeart;
    this.lpfHeartB[1] = 2 * kLpHeart * kLpHeart * normLpHeart;
    this.lpfHeartB[2] = kLpHeart * kLpHeart * normLpHeart;
    this.lpfHeartA[0] = 1;
    this.lpfHeartA[1] = 2 * (kLpHeart * kLpHeart - 1) * normLpHeart;
    this.lpfHeartA[2] = (1 - Math.sqrt(2) * kLpHeart + kLpHeart * kLpHeart) * normLpHeart;

    this.initialized = true;
  }

  private applyBiquad(
    input: number,
    b: number[], a: number[],
    state: { x: number[], y: number[] }
  ): number {
    state.x[2] = state.x[1];
    state.x[1] = state.x[0];
    state.x[0] = input;
    state.y[2] = state.y[1];
    state.y[1] = state.y[0];
    state.y[0] = b[0] * state.x[0] + b[1] * state.x[1] + b[2] * state.x[2]
      - a[1] * state.y[1] - a[2] * state.y[2];

    if (!isFinite(state.y[0]) || Math.abs(state.y[0]) > 1e10) {
      state.y[0] = 0;
    }
    return state.y[0];
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

  /** Hampel filter: reject outliers using median absolute deviation */
  private hampelFilter(value: number): number {
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.HAMPEL_WINDOW) {
      this.signalBuffer.shift();
    }

    if (this.signalBuffer.length < this.HAMPEL_WINDOW) {
      return value;
    }

    const sorted = [...this.signalBuffer].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mad = sorted.reduce((sum, v) => sum + Math.abs(v - median), 0) / sorted.length;

    if (Math.abs(value - median) > this.HAMPEL_THRESHOLD * mad) {
      return median; // Replace outlier with median
    }
    return value;
  }

  /**
   * Full pipeline: detrend → hampel → bandpass (both bands)
   * Returns object with both filtered signals
   */
  filter(value: number, timestamp?: number): { wideBand: number; heartBand: number } {
    if (!this.initialized || !isFinite(value)) {
      return { wideBand: 0, heartBand: 0 };
    }

    // Update sample rate estimation from timestamps
    if (timestamp !== undefined) {
      this.updateSampleRate(timestamp);
    }

    const detrended = this.detrend(value);
    const cleaned = this.hampelFilter(detrended);

    // Wide band (contact/morphology)
    const hpfWide = this.applyBiquad(cleaned, this.hpfWideB, this.hpfWideA, this.hpfWideState);
    const wideBand = this.applyBiquad(hpfWide, this.lpfWideB, this.lpfWideA, this.lpfWideState);

    // Heart band (narrower)
    const hpfHeart = this.applyBiquad(cleaned, this.hpfHeartB, this.hpfHeartA, this.hpfHeartState);
    const heartBand = this.applyBiquad(hpfHeart, this.lpfHeartB, this.lpfHeartA, this.lpfHeartState);

    return { wideBand, heartBand };
  }

  /**
   * Legacy single-band filter (returns heart band for backward compatibility)
   */
  filterSingle(value: number): number {
    const result = this.filter(value);
    return result.heartBand;
  }

  /** Get detrended value only (no bandpass) */
  getDetrended(value: number): number {
    return this.detrend(value);
  }

  /** Update sample rate estimation from timestamps */
  private updateSampleRate(timestamp: number): void {
    this.timestampBuffer.push(timestamp);
    if (this.timestampBuffer.length > 30) {
      this.timestampBuffer.shift();
    }

    if (this.timestampBuffer.length < 5) return;

    // Calculate median interval
    const intervals: number[] = [];
    for (let i = 1; i < this.timestampBuffer.length; i++) {
      const delta = this.timestampBuffer[i] - this.timestampBuffer[i - 1];
      if (delta >= 8 && delta <= 200) { // Valid frame interval range
        intervals.push(delta);
      }
    }

    if (intervals.length < 3) return;

    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    const newRate = 1000 / medianInterval;

    // Clamp to reasonable range
    const clampedRate = Math.max(15, Math.min(60, newRate));

    // Only update if significantly different
    if (Math.abs(clampedRate - this.estimatedSampleRate) > 1.5) {
      this.estimatedSampleRate = clampedRate;
      this.computeCoefficients();
    }
  }

  /** Get current estimated sample rate */
  getEstimatedSampleRate(): number {
    return this.estimatedSampleRate;
  }

  /** Set sample rate directly (for backward compatibility) */
  setSampleRate(rate: number): void {
    this.estimatedSampleRate = rate;
    this.computeCoefficients();
  }

  reset(): void {
    this.hpfWideState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfWideState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.hpfHeartState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfHeartState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.baselineEWMA = 0;
    this.baselineInitialized = false;
    this.signalBuffer = [];
    this.timestampBuffer = [];
  }
}
