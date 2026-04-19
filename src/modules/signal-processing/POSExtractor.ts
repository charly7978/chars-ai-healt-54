/**
 * POS — PLANE-ORTHOGONAL-TO-SKIN PPG EXTRACTOR
 *
 * Wang, den Brinker, Stuijk & de Haan (2017) "Algorithmic Principles of
 * Remote-PPG", IEEE TBME 64(7):1479-1491.
 *
 * The POS algorithm projects the AC component of the RGB signal onto a 2-D
 * plane that is approximately orthogonal to the dominant illumination
 * variation (the skin tone). For contact-PPG this is doubly useful because
 * the smartphone torch can flicker (PWM, AGC drift) and modulate all three
 * channels equally — POS suppresses that common-mode component.
 *
 * Original recipe (length-N sliding window):
 *   1. Normalize each channel by its window mean: C_n(t) = C(t) / mean(C)
 *   2. Project to 2 features:
 *        S1(t) =  G_n(t) − B_n(t)
 *        S2(t) =  G_n(t) + B_n(t) − 2·R_n(t)
 *   3. Output: y(t) = S1(t) + (std(S1) / std(S2)) · S2(t)
 *
 * Sliding window of `windowSec * fs` samples. We update at every push and
 * emit the last sample of the projection.
 */

export interface POSOptions {
  /** Sample rate of the input RGB stream (Hz) */
  sampleRate: number;
  /** Sliding window length (seconds). Default 1.6 s (Wang 2017). */
  windowSec?: number;
}

export class POSExtractor {
  private fs: number;
  private windowLen: number;
  private bufR: Float64Array;
  private bufG: Float64Array;
  private bufB: Float64Array;
  private idx = 0;
  private filled = 0;

  constructor(opts: POSOptions) {
    this.fs = opts.sampleRate;
    this.windowLen = Math.max(16, Math.round((opts.windowSec ?? 1.6) * this.fs));
    this.bufR = new Float64Array(this.windowLen);
    this.bufG = new Float64Array(this.windowLen);
    this.bufB = new Float64Array(this.windowLen);
  }

  setSampleRate(fs: number): void {
    if (Math.abs(fs - this.fs) < 1.5) return;
    this.fs = fs;
    this.windowLen = Math.max(16, Math.round(1.6 * fs));
    this.bufR = new Float64Array(this.windowLen);
    this.bufG = new Float64Array(this.windowLen);
    this.bufB = new Float64Array(this.windowLen);
    this.idx = 0; this.filled = 0;
  }

  reset(): void {
    this.bufR.fill(0); this.bufG.fill(0); this.bufB.fill(0);
    this.idx = 0; this.filled = 0;
  }

  /**
   * Push one RGB sample (linear or sRGB; works in either) and return the
   * latest POS output. Returns 0 until the window is full.
   */
  push(r: number, g: number, b: number): number {
    this.bufR[this.idx] = r;
    this.bufG[this.idx] = g;
    this.bufB[this.idx] = b;
    this.idx = (this.idx + 1) % this.windowLen;
    if (this.filled < this.windowLen) this.filled++;
    if (this.filled < this.windowLen) return 0;

    // Compute window means
    let mR = 0, mG = 0, mB = 0;
    for (let i = 0; i < this.windowLen; i++) {
      mR += this.bufR[i]; mG += this.bufG[i]; mB += this.bufB[i];
    }
    mR /= this.windowLen; mG /= this.windowLen; mB /= this.windowLen;
    if (mR < 1 || mG < 1 || mB < 1) return 0;

    // Compute S1 and S2 across the window, then std(S1) and std(S2)
    let s1Sum = 0, s2Sum = 0;
    let s1SqSum = 0, s2SqSum = 0;
    let s1Last = 0, s2Last = 0;
    for (let i = 0; i < this.windowLen; i++) {
      const rN = this.bufR[i] / mR;
      const gN = this.bufG[i] / mG;
      const bN = this.bufB[i] / mB;
      const s1 = gN - bN;
      const s2 = gN + bN - 2 * rN;
      s1Sum += s1; s2Sum += s2;
      s1SqSum += s1 * s1; s2SqSum += s2 * s2;
      // remember last (latest) sample
      const realIdx = (this.idx - 1 - (this.windowLen - 1 - i) + this.windowLen) % this.windowLen;
      if (realIdx === (this.idx - 1 + this.windowLen) % this.windowLen) {
        s1Last = s1; s2Last = s2;
      }
    }
    const meanS1 = s1Sum / this.windowLen;
    const meanS2 = s2Sum / this.windowLen;
    const varS1 = Math.max(0, s1SqSum / this.windowLen - meanS1 * meanS1);
    const varS2 = Math.max(1e-12, s2SqSum / this.windowLen - meanS2 * meanS2);
    const sigmaS1 = Math.sqrt(varS1);
    const sigmaS2 = Math.sqrt(varS2);
    const alpha = sigmaS2 > 0 ? sigmaS1 / sigmaS2 : 0;

    return s1Last + alpha * s2Last;
  }
}
