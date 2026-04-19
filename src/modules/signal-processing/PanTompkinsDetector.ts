/**
 * PAN-TOMPKINS-LIKE DETECTOR (adapted for PPG, not ECG)
 *
 * Sequence: derivative → squaring → moving-window integration → adaptive
 * threshold (signal vs noise) with refractory enforcement. The original
 * Pan & Tompkins (1985) algorithm targets QRS complexes; here we apply the
 * same family of operations to the band-passed PPG, where the systolic
 * upstroke is the highest-energy local feature.
 *
 * The detector consumes the latest PPG sample plus a tentative sample rate
 * and returns whether *this* sample concludes a beat candidate, together
 * with a quality score in [0..1] reflecting the signal-to-noise margin
 * relative to the adaptive threshold.
 *
 * No simulation, no Math.random — pure deterministic state machine.
 */

export interface PTDetectorOpts {
  sampleRate: number;          // Hz
  refractoryMs?: number;       // minimum interval between beats (default 280 ms)
  windowMs?: number;           // moving-window integrator length (default 150 ms)
}

export interface PTDetectionTick {
  isPeak: boolean;
  /** Integrator output at this sample. */
  integrator: number;
  /** Current adaptive signal threshold. */
  signalThreshold: number;
  /** 0..1 confidence: integrator over (sigThr+noiseThr+eps). */
  quality: number;
}

export class PanTompkinsDetector {
  private sampleRate: number;
  private refractorySamples: number;
  private windowSamples: number;

  // Sliding buffers for derivative + integrator
  private derivBuf: Float64Array;
  private intBuf: Float64Array;
  private inIdx = 0;
  private samplesSeen = 0;

  // Last 5 samples for the standard 5-tap derivative
  private last5 = new Float64Array(5);

  // Adaptive thresholds (Hamilton-Tompkins style)
  private sigThr = 0;
  private noiseThr = 0;
  private spki = 0; // running peak amplitude estimate
  private npki = 0; // running noise amplitude estimate
  private lastBeatSample = -Infinity;
  private firstBeat = true;

  constructor(opts: PTDetectorOpts) {
    this.sampleRate = opts.sampleRate;
    this.refractorySamples = Math.round((opts.refractoryMs ?? 280) * this.sampleRate / 1000);
    this.windowSamples = Math.max(3, Math.round((opts.windowMs ?? 150) * this.sampleRate / 1000));
    this.derivBuf = new Float64Array(this.windowSamples + 8);
    this.intBuf = new Float64Array(this.windowSamples + 8);
  }

  /** Update sample rate without dropping internal state (use sparingly). */
  setSampleRate(fs: number): void {
    if (Math.abs(fs - this.sampleRate) < 1.5) return;
    this.sampleRate = fs;
    this.refractorySamples = Math.round(280 * fs / 1000);
    this.windowSamples = Math.max(3, Math.round(150 * fs / 1000));
    this.derivBuf = new Float64Array(this.windowSamples + 8);
    this.intBuf = new Float64Array(this.windowSamples + 8);
    this.inIdx = 0;
  }

  reset(): void {
    this.derivBuf.fill(0);
    this.intBuf.fill(0);
    this.last5.fill(0);
    this.inIdx = 0;
    this.samplesSeen = 0;
    this.sigThr = 0; this.noiseThr = 0;
    this.spki = 0; this.npki = 0;
    this.lastBeatSample = -Infinity;
    this.firstBeat = true;
  }

  push(sample: number): PTDetectionTick {
    // Shift last5 (5-tap derivative buffer)
    this.last5[0] = this.last5[1];
    this.last5[1] = this.last5[2];
    this.last5[2] = this.last5[3];
    this.last5[3] = this.last5[4];
    this.last5[4] = sample;

    // 5-tap derivative scaled by 1/8: y(n) = (1/8)[2x(n) + x(n-1) − x(n-3) − 2x(n-4)]
    const dy = (2 * this.last5[4] + this.last5[3] - this.last5[1] - 2 * this.last5[0]) / 8;
    const sq = dy * dy;

    // Push squared derivative into circular buffer for moving-window integration
    this.derivBuf[this.inIdx % this.derivBuf.length] = sq;
    this.inIdx++;
    this.samplesSeen++;

    // Moving-window integrator: average over last `windowSamples`
    let acc = 0;
    const N = Math.min(this.windowSamples, this.samplesSeen);
    for (let k = 0; k < N; k++) {
      acc += this.derivBuf[(this.inIdx - 1 - k + this.derivBuf.length) % this.derivBuf.length];
    }
    const integ = acc / N;
    this.intBuf[(this.inIdx - 1) % this.intBuf.length] = integ;

    // Wait at least one window before threshold logic
    if (this.samplesSeen < this.windowSamples) {
      return { isPeak: false, integrator: integ, signalThreshold: this.sigThr, quality: 0 };
    }

    // Detect local maximum on the integrator (compare current vs prev sample)
    const prevIdx = (this.inIdx - 2 + this.intBuf.length) % this.intBuf.length;
    const prev2Idx = (this.inIdx - 3 + this.intBuf.length) % this.intBuf.length;
    const prev = this.intBuf[prevIdx];
    const prev2 = this.intBuf[prev2Idx];
    const isLocalMax = prev > prev2 && prev > integ && prev > 0;

    let isPeak = false;
    let quality = 0;
    if (isLocalMax) {
      const peakVal = prev;
      const sinceLast = this.samplesSeen - 1 - this.lastBeatSample;
      const beyondRefractory = sinceLast > this.refractorySamples;
      const aboveThr = peakVal > this.sigThr || this.firstBeat;
      if (aboveThr && beyondRefractory) {
        isPeak = true;
        this.lastBeatSample = this.samplesSeen - 1;
        this.firstBeat = false;
        // Update signal estimator (Hamilton-Tompkins: 0.125 weight)
        this.spki = 0.125 * peakVal + 0.875 * this.spki;
        quality = peakVal / (this.sigThr + this.noiseThr + 1e-12);
      } else {
        // Treat as noise peak
        this.npki = 0.125 * peakVal + 0.875 * this.npki;
        quality = peakVal / (this.sigThr + this.noiseThr + 1e-12);
      }
      // Recompute thresholds
      this.sigThr = this.npki + 0.25 * (this.spki - this.npki);
      this.noiseThr = 0.5 * this.sigThr;
    }

    return { isPeak, integrator: integ, signalThreshold: this.sigThr, quality };
  }
}
