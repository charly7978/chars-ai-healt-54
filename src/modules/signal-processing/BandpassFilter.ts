/**
 * BANDPASS FILTER V2 — ADAPTIVE SAMPLE RATE + DETRENDING
 * 
 * IIR Butterworth 2nd order: HPF 0.5Hz + LPF 5Hz
 * - Recalculates coefficients only on significant sample rate change
 * - Includes robust baseline detrending before bandpass
 * - Separates: raw → detrended → bandpassed
 */
export class BandpassFilter {
  private hpfB = [0, 0, 0];
  private hpfA = [1, 0, 0];
  private lpfB = [0, 0, 0];
  private lpfA = [1, 0, 0];

  private hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
  private lpfState = { x: [0, 0, 0], y: [0, 0, 0] };

  // Detrending state (exponential moving average baseline)
  private baselineEWMA = 0;
  private baselineInitialized = false;
  private readonly DETREND_ALPHA = 0.015; // slow-moving baseline

  private sampleRate: number;
  private lastComputedRate = 0;
  private initialized = false;

  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
    this.computeCoefficients();
  }

  private computeCoefficients(): void {
    const fs = this.sampleRate;
    this.lastComputedRate = fs;

    // HPF at 0.5Hz — removes DC + slow drift
    const fcHp = 0.5;
    const kHp = Math.tan(Math.PI * fcHp / fs);
    const normHp = 1 / (1 + Math.sqrt(2) * kHp + kHp * kHp);
    this.hpfB[0] = normHp;
    this.hpfB[1] = -2 * normHp;
    this.hpfB[2] = normHp;
    this.hpfA[0] = 1;
    this.hpfA[1] = 2 * (kHp * kHp - 1) * normHp;
    this.hpfA[2] = (1 - Math.sqrt(2) * kHp + kHp * kHp) * normHp;

    // LPF at 5Hz — removes HF noise, keeps up to 300 BPM
    const fcLp = 5.0;
    const kLp = Math.tan(Math.PI * fcLp / fs);
    const normLp = 1 / (1 + Math.sqrt(2) * kLp + kLp * kLp);
    this.lpfB[0] = kLp * kLp * normLp;
    this.lpfB[1] = 2 * kLp * kLp * normLp;
    this.lpfB[2] = kLp * kLp * normLp;
    this.lpfA[0] = 1;
    this.lpfA[1] = 2 * (kLp * kLp - 1) * normLp;
    this.lpfA[2] = (1 - Math.sqrt(2) * kLp + kLp * kLp) * normLp;

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

  /** Full pipeline: detrend → HPF → LPF */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) return 0;
    const detrended = this.detrend(value);
    const hpf = this.applyBiquad(detrended, this.hpfB, this.hpfA, this.hpfState);
    return this.applyBiquad(hpf, this.lpfB, this.lpfA, this.lpfState);
  }

  /** Get detrended value only (no bandpass) */
  getDetrended(value: number): number {
    return this.detrend(value);
  }

  reset(): void {
    this.hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.baselineEWMA = 0;
    this.baselineInitialized = false;
  }

  /** Only recompute if rate changed significantly (>1.5 fps) */
  setSampleRate(rate: number): void {
    if (Math.abs(rate - this.lastComputedRate) < 1.5) return;
    this.sampleRate = rate;
    this.computeCoefficients();
    // Do NOT reset filter state for small rate changes — preserves continuity
  }
}
