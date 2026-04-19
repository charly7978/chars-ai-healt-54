/**
 * BANDPASS FILTER V3 — ADAPTIVE RESPIRATORY NOTCH + DETRENDING
 *
 * Architecture (backward-compatible with V2 for beat detection):
 *   1. EWMA baseline detrending (removes DC + slow drift)
 *   2. 2nd-order Butterworth HPF at 0.5 Hz  (same poles as V2 — preserves beat detector)
 *   3. 2nd-order Butterworth LPF at 5.0 Hz  (same poles as V2 — preserves beat detector)
 *   4. Optional 2nd-order IIR notch at dominant respiratory frequency (0.1–0.5 Hz),
 *      adaptively estimated every 3 s from the low-frequency power of the raw signal.
 *
 * Why NOT upgrade to 4th-order here?
 *   The HeartBeatProcessor's normalisation and peak-detection thresholds are tuned
 *   to the 2nd-order filter's phase and amplitude response.  Changing the filter order
 *   without retuning the detector would double-count harmonics and corrupt BPM estimates.
 *   The notch alone removes the dominant respiratory coupling without touching the
 *   cardiac-band response.
 *
 * References:
 *   - Proakis & Manolakis "Digital Signal Processing" 4th ed. §10.3
 *   - Elgendi 2016 "Systolic Peak Detection in PPG" Algorithms 9(1)
 *   - Mejia-Mejia 2022 Computers in Biology (respiratory notch in PPG)
 */

interface BiquadState { x: number[]; y: number[] }
interface BiquadCoeffs { b: number[]; a: number[] }

export class BandpassFilter {
  // ── 2nd-order Butterworth HPF (same as V2) ──────────────────────
  private hpfB = [0, 0, 0];
  private hpfA = [1, 0, 0];
  private hpfState: BiquadState = { x: [0, 0, 0], y: [0, 0, 0] };

  // ── 2nd-order Butterworth LPF (same as V2) ──────────────────────
  private lpfB = [0, 0, 0];
  private lpfA = [1, 0, 0];
  private lpfState: BiquadState = { x: [0, 0, 0], y: [0, 0, 0] };

  // ── Respiratory notch (NEW in V3) ────────────────────────────────
  private notchCoeffs: BiquadCoeffs = { b: [1, 0, 0], a: [1, 0, 0] };
  private notchState: BiquadState = { x: [0, 0, 0], y: [0, 0, 0] };
  private notchEnabled = false;
  private respFreqHz = 0.25;
  private readonly NOTCH_Q = 8.0;

  // ── EWMA detrend ────────────────────────────────────────────────
  private baselineEWMA = 0;
  private baselineInit = false;
  private readonly DETREND_ALPHA = 0.015;

  private sampleRate: number;
  private lastComputedRate = 0;
  private initialized = false;

  // ── Adaptive notch tracking ──────────────────────────────────────
  private respBuf: number[] = [];
  private readonly RESP_BUF_SIZE = 600;
  private lastNotchUpdate = 0;
  private readonly NOTCH_UPDATE_INTERVAL_MS = 3000;

  constructor(sampleRate = 30) {
    this.sampleRate = sampleRate;
    this.computeCoefficients();
  }

  // ══════════════════════════════════════════════════════════════════
  //  COEFFICIENT COMPUTATION
  // ══════════════════════════════════════════════════════════════════

  private computeCoefficients(): void {
    const fs = this.sampleRate;
    this.lastComputedRate = fs;

    // ── 2nd-order Butterworth HPF at 0.5 Hz (identical to V2) ──────
    const fcHp = 0.5;
    const kHp = Math.tan(Math.PI * fcHp / fs);
    const normHp = 1 / (1 + Math.sqrt(2) * kHp + kHp * kHp);
    this.hpfB[0] = normHp;
    this.hpfB[1] = -2 * normHp;
    this.hpfB[2] = normHp;
    this.hpfA[0] = 1;
    this.hpfA[1] = 2 * (kHp * kHp - 1) * normHp;
    this.hpfA[2] = (1 - Math.sqrt(2) * kHp + kHp * kHp) * normHp;

    // ── 2nd-order Butterworth LPF at 5.0 Hz (identical to V2) ──────
    const fcLp = 5.0;
    const kLp = Math.tan(Math.PI * fcLp / fs);
    const normLp = 1 / (1 + Math.sqrt(2) * kLp + kLp * kLp);
    this.lpfB[0] = kLp * kLp * normLp;
    this.lpfB[1] = 2 * kLp * kLp * normLp;
    this.lpfB[2] = kLp * kLp * normLp;
    this.lpfA[0] = 1;
    this.lpfA[1] = 2 * (kLp * kLp - 1) * normLp;
    this.lpfA[2] = (1 - Math.sqrt(2) * kLp + kLp * kLp) * normLp;

    // ── Respiratory notch at current estimate ───────────────────────
    this.notchCoeffs = this.computeNotch(this.respFreqHz, fs, this.NOTCH_Q);

    this.initialized = true;
  }

  /**
   * 2nd-order IIR notch filter (bilinear transform).
   * Q=8 → narrow 3dB bandwidth ≈ fc/8 — removes respiratory without touching cardiac.
   */
  private computeNotch(fc: number, fs: number, Q: number): BiquadCoeffs {
    if (fc <= 0 || fc >= fs / 2) return { b: [1, 0, 0], a: [1, 0, 0] };
    const omega0 = 2 * Math.PI * fc / fs;
    const alpha = Math.sin(omega0) / (2 * Q);
    const cosW = Math.cos(omega0);
    const b0 = 1 / (1 + alpha);
    const b1 = -2 * cosW / (1 + alpha);
    const b2 = 1 / (1 + alpha);
    const a1 = -2 * cosW / (1 + alpha);
    const a2 = (1 - alpha) / (1 + alpha);
    return { b: [b0, b1, b2], a: [1, a1, a2] };
  }

  // ══════════════════════════════════════════════════════════════════
  //  BIQUAD (Direct Form II Transposed)
  // ══════════════════════════════════════════════════════════════════

  private applyBiquad(
    input: number,
    b: number[], a: number[],
    state: BiquadState
  ): number {
    state.x[2] = state.x[1]; state.x[1] = state.x[0]; state.x[0] = input;
    state.y[2] = state.y[1]; state.y[1] = state.y[0];
    state.y[0] = b[0] * state.x[0] + b[1] * state.x[1] + b[2] * state.x[2]
               - a[1] * state.y[1] - a[2] * state.y[2];
    if (!isFinite(state.y[0]) || Math.abs(state.y[0]) > 1e10) state.y[0] = 0;
    return state.y[0];
  }

  // ══════════════════════════════════════════════════════════════════
  //  DETRENDING
  // ══════════════════════════════════════════════════════════════════

  detrend(value: number): number {
    if (!this.baselineInit) {
      this.baselineEWMA = value;
      this.baselineInit = true;
      return 0;
    }
    this.baselineEWMA = this.baselineEWMA * (1 - this.DETREND_ALPHA) + value * this.DETREND_ALPHA;
    return value - this.baselineEWMA;
  }

  // ══════════════════════════════════════════════════════════════════
  //  ADAPTIVE RESPIRATORY NOTCH
  // ══════════════════════════════════════════════════════════════════

  private updateRespNotch(rawValue: number): void {
    this.respBuf.push(rawValue);
    if (this.respBuf.length > this.RESP_BUF_SIZE) this.respBuf.shift();

    const now = performance.now();
    if (now - this.lastNotchUpdate < this.NOTCH_UPDATE_INTERVAL_MS) return;
    if (this.respBuf.length < 90) return;
    this.lastNotchUpdate = now;

    const detectedFreq = this.estimateRespFrequency();
    if (detectedFreq > 0.1 && detectedFreq < 0.5) {
      const change = Math.abs(detectedFreq - this.respFreqHz) / Math.max(0.01, this.respFreqHz);
      if (change > 0.10) {
        this.respFreqHz = this.respFreqHz * 0.7 + detectedFreq * 0.3;
        this.notchCoeffs = this.computeNotch(this.respFreqHz, this.sampleRate, this.NOTCH_Q);
        this.notchEnabled = true;
      }
    }
  }

  private estimateRespFrequency(): number {
    const n = Math.min(this.RESP_BUF_SIZE, this.respBuf.length);
    if (n < 60) return 0;
    const buf = this.respBuf.slice(-n);
    const mean = buf.reduce((a, b) => a + b, 0) / n;
    const detrended = buf.map(v => v - mean);
    const fs = this.sampleRate;

    const minBin = Math.max(1, Math.round(0.1 * n / fs));
    const maxBin = Math.round(0.5 * n / fs);
    let bestPower = 0, bestFreq = 0;

    for (let k = minBin; k <= maxBin; k++) {
      let re = 0, im = 0;
      const phase = (2 * Math.PI * k) / n;
      for (let i = 0; i < n; i++) {
        re += detrended[i] * Math.cos(phase * i);
        im -= detrended[i] * Math.sin(phase * i);
      }
      const power = re * re + im * im;
      if (power > bestPower) { bestPower = power; bestFreq = k * fs / n; }
    }

    return bestFreq;
  }

  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  /** Full pipeline: detrend → HPF → LPF [→ resp notch] */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) return 0;

    this.updateRespNotch(value);

    const detrended = this.detrend(value);
    let x = this.applyBiquad(detrended, this.hpfB, this.hpfA, this.hpfState);
    x = this.applyBiquad(x, this.lpfB, this.lpfA, this.lpfState);

    if (this.notchEnabled) {
      x = this.applyBiquad(x, this.notchCoeffs.b, this.notchCoeffs.a, this.notchState);
    }

    return x;
  }

  getDetrended(value: number): number { return this.detrend(value); }

  reset(): void {
    this.hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.notchState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.baselineEWMA = 0;
    this.baselineInit = false;
    this.respBuf = [];
  }

  setSampleRate(rate: number): void {
    if (Math.abs(rate - this.lastComputedRate) < 1.5) return;
    this.sampleRate = rate;
    this.computeCoefficients();
  }

  getRespFrequencyHz(): number { return this.respFreqHz; }
}
