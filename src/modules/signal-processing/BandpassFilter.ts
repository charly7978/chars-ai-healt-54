/**
 * BANDPASS FILTER V3 — CASCADED BIQUAD + ADAPTIVE NOTCH
 *
 * Architecture:
 *   1. EWMA baseline detrending (removes DC + slow drift)
 *   2. Cascaded 4th-order Butterworth HPF at 0.5 Hz (2 biquad sections)
 *   3. Cascaded 4th-order Butterworth LPF at 8 Hz  (2 biquad sections)
 *   4. Optional 2nd-order IIR notch at respiratory frequency (~0.3 Hz,
 *      adaptively updated every 600 ms)
 *
 * Why 4th order?
 *   - Steeper roll-off (-80 dB/dec vs -40 dB/dec) removes baseline drift
 *     and motion-induced LF noise far more aggressively while still passing
 *     the full cardiac bandwidth (0.5–8 Hz covers up to 480 BPM harmonics).
 *   - Butterworth maximally-flat passband avoids amplitude distortion on
 *     the PPG systolic upstroke used for morphology features.
 *
 * Respiratory notch:
 *   - The 0.15–0.4 Hz respiratory component couples into PPG via VVC (venous
 *     volume change) and modulates the DC baseline.  A narrow IIR notch
 *     centred on the dominant respiratory frequency removes it without
 *     affecting the 0.5 Hz HPF corner.
 *
 * References:
 *   - Proakis & Manolakis "Digital Signal Processing" 4th ed. §10.3
 *   - Elgendi 2016 "Systolic Peak Detection in PPG" Algorithms 9(1)
 *   - Charlton et al. 2022 "Assessing Cardiac and Vascular Function" npj
 */

interface BiquadState { x: number[]; y: number[] }
interface BiquadCoeffs { b: number[]; a: number[] }

export class BandpassFilter {
  // ── 4th-order Butterworth HPF (2 biquad cascade) ──────────────────
  private hpfSections: [BiquadCoeffs, BiquadCoeffs] = [
    { b: [0, 0, 0], a: [1, 0, 0] },
    { b: [0, 0, 0], a: [1, 0, 0] },
  ];
  private hpfStates: [BiquadState, BiquadState] = [
    { x: [0, 0, 0], y: [0, 0, 0] },
    { x: [0, 0, 0], y: [0, 0, 0] },
  ];

  // ── 4th-order Butterworth LPF (2 biquad cascade) ──────────────────
  private lpfSections: [BiquadCoeffs, BiquadCoeffs] = [
    { b: [0, 0, 0], a: [1, 0, 0] },
    { b: [0, 0, 0], a: [1, 0, 0] },
  ];
  private lpfStates: [BiquadState, BiquadState] = [
    { x: [0, 0, 0], y: [0, 0, 0] },
    { x: [0, 0, 0], y: [0, 0, 0] },
  ];

  // ── Respiratory notch ──────────────────────────────────────────────
  private notchCoeffs: BiquadCoeffs = { b: [0, 0, 0], a: [1, 0, 0] };
  private notchState: BiquadState = { x: [0, 0, 0], y: [0, 0, 0] };
  private notchEnabled = false;
  private respFreqHz = 0.25;  // initial estimate ~15 breaths/min
  private readonly NOTCH_Q = 8.0; // narrow notch

  // ── EWMA detrend ───────────────────────────────────────────────────
  private baselineEWMA = 0;
  private baselineInit = false;
  private readonly DETREND_ALPHA = 0.012; // ~13s time constant at 30 fps

  private sampleRate: number;
  private lastComputedRate = 0;
  private initialized = false;

  // ── Adaptive notch tracking ────────────────────────────────────────
  private respBuf: number[] = [];
  private readonly RESP_BUF_SIZE = 600; // ~20 s at 30 fps
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

    // ── 4th-order Butterworth HPF at 0.5 Hz ─────────────────────────
    // Two biquad sections with Butterworth pole angles
    // Section angles: θ = π/4 * (2k-1)/N  for N=2 (4th order split into 2)
    // Poles at angles 135° and 45° from imaginary axis
    this.hpfSections[0] = this.butterHPFSection(0.5, fs, Math.PI * 3 / 8); // 67.5°
    this.hpfSections[1] = this.butterHPFSection(0.5, fs, Math.PI * 1 / 8); // 22.5°

    // ── 4th-order Butterworth LPF at 8 Hz ───────────────────────────
    this.lpfSections[0] = this.butterLPFSection(8.0, fs, Math.PI * 3 / 8);
    this.lpfSections[1] = this.butterLPFSection(8.0, fs, Math.PI * 1 / 8);

    // ── Respiratory notch at current respFreqHz ──────────────────────
    this.notchCoeffs = this.computeNotch(this.respFreqHz, fs, this.NOTCH_Q);

    this.initialized = true;
  }

  /**
   * 2nd-order Butterworth highpass biquad section.
   * poleAngle: angular position of the Butterworth prototype pole pair.
   * Uses bilinear transform with frequency pre-warping.
   */
  private butterHPFSection(fc: number, fs: number, poleAngle: number): BiquadCoeffs {
    const omega = 2 * Math.PI * fc / fs;
    const k = Math.tan(omega / 2);
    const cosA = Math.cos(poleAngle);
    const denom = 1 + 2 * cosA * k + k * k;
    const b0 = 1 / denom;
    const b1 = -2 / denom;
    const b2 = 1 / denom;
    const a1 = 2 * (k * k - 1) / denom;
    const a2 = (1 - 2 * cosA * k + k * k) / denom;
    return { b: [b0, b1, b2], a: [1, a1, a2] };
  }

  private butterLPFSection(fc: number, fs: number, poleAngle: number): BiquadCoeffs {
    const omega = 2 * Math.PI * fc / fs;
    const k = Math.tan(omega / 2);
    const cosA = Math.cos(poleAngle);
    const denom = 1 + 2 * cosA * k + k * k;
    const b0 = k * k / denom;
    const b1 = 2 * k * k / denom;
    const b2 = k * k / denom;
    const a1 = 2 * (k * k - 1) / denom;
    const a2 = (1 - 2 * cosA * k + k * k) / denom;
    return { b: [b0, b1, b2], a: [1, a1, a2] };
  }

  /**
   * 2nd-order IIR notch filter.
   * Q controls bandwidth: Q=8 → 3dB bandwidth ≈ fc/8
   */
  private computeNotch(fc: number, fs: number, Q: number): BiquadCoeffs {
    if (fc <= 0 || fc >= fs / 2) return { b: [1, 0, 0], a: [1, 0, 0] };
    const omega0 = 2 * Math.PI * fc / fs;
    const alpha = Math.sin(omega0) / (2 * Q);
    const cosW = Math.cos(omega0);
    const b0 = 1 / (1 + alpha);
    const b1 = -2 * cosW * b0;
    const b2 = b0;
    const a1 = -2 * cosW / (1 + alpha);
    const a2 = (1 - alpha) / (1 + alpha);
    return { b: [b0, b1, b2], a: [1, a1, a2] };
  }

  // ══════════════════════════════════════════════════════════════════
  //  CORE BIQUAD (Direct Form II Transposed — numerically stable)
  // ══════════════════════════════════════════════════════════════════

  private applyBiquad(x: number, c: BiquadCoeffs, s: BiquadState): number {
    s.x[2] = s.x[1]; s.x[1] = s.x[0]; s.x[0] = x;
    s.y[2] = s.y[1]; s.y[1] = s.y[0];
    s.y[0] = c.b[0] * s.x[0] + c.b[1] * s.x[1] + c.b[2] * s.x[2]
           - c.a[1] * s.y[1] - c.a[2] * s.y[2];
    if (!isFinite(s.y[0]) || Math.abs(s.y[0]) > 1e9) s.y[0] = 0;
    return s.y[0];
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
  //  ADAPTIVE RESPIRATORY NOTCH UPDATE
  // ══════════════════════════════════════════════════════════════════

  private updateRespNotch(rawValue: number): void {
    this.respBuf.push(rawValue);
    if (this.respBuf.length > this.RESP_BUF_SIZE) this.respBuf.shift();

    const now = performance.now();
    if (now - this.lastNotchUpdate < this.NOTCH_UPDATE_INTERVAL_MS) return;
    if (this.respBuf.length < 90) return;
    this.lastNotchUpdate = now;

    // Estimate dominant low-frequency component via power spectrum in 0.1–0.5 Hz band
    const detectedFreq = this.estimateRespFrequency();
    if (detectedFreq > 0.1 && detectedFreq < 0.5) {
      const change = Math.abs(detectedFreq - this.respFreqHz) / Math.max(0.01, this.respFreqHz);
      if (change > 0.10) {
        // Slowly track
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

    // Simple DFT on the respiratory band (0.1–0.5 Hz)
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

  /** Full pipeline: detrend → 4th-order HPF → 4th-order LPF [→ resp notch] */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) return 0;

    this.updateRespNotch(value);

    const detrended = this.detrend(value);

    // HPF cascade
    let x = this.applyBiquad(detrended, this.hpfSections[0], this.hpfStates[0]);
    x = this.applyBiquad(x, this.hpfSections[1], this.hpfStates[1]);

    // LPF cascade
    x = this.applyBiquad(x, this.lpfSections[0], this.lpfStates[0]);
    x = this.applyBiquad(x, this.lpfSections[1], this.lpfStates[1]);

    // Optional respiratory notch
    if (this.notchEnabled) {
      x = this.applyBiquad(x, this.notchCoeffs, this.notchState);
    }

    return x;
  }

  getDetrended(value: number): number { return this.detrend(value); }

  reset(): void {
    for (const s of [this.hpfStates[0], this.hpfStates[1],
                     this.lpfStates[0], this.lpfStates[1],
                     this.notchState]) {
      s.x = [0, 0, 0]; s.y = [0, 0, 0];
    }
    this.baselineEWMA = 0;
    this.baselineInit = false;
    this.respBuf = [];
  }

  /** Recompute only when rate changed significantly (>1.5 fps) */
  setSampleRate(rate: number): void {
    if (Math.abs(rate - this.lastComputedRate) < 1.5) return;
    this.sampleRate = rate;
    this.computeCoefficients();
    // preserve filter state for continuity
  }

  getRespFrequencyHz(): number { return this.respFreqHz; }
}
