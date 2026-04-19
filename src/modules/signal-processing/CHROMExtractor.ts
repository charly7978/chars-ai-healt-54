/**
 * CHROM — CHROMINANCE-BASED PPG EXTRACTOR
 *
 * de Haan & Jeanne (2013), "Robust Pulse Rate from Chrominance-based rPPG",
 * IEEE TBME 60(10):2878-2886.
 *
 * CHROM forms two chromatic difference signals from the AC-normalized RGB:
 *     X(t) = 3·R'(t) − 2·G'(t)
 *     Y(t) = 1.5·R'(t) + G'(t) − 1.5·B'(t)
 * and combines them with an std-balancing coefficient:
 *     S(t) = X(t) − (std(X) / std(Y)) · Y(t)
 * where R', G', B' are the channels normalized by their window means.
 *
 * Sliding-window style identical to POSExtractor for a clean fold-in at
 * SignalSourceRanker.
 */

export interface CHROMOptions {
  sampleRate: number;
  /** Sliding window (s). 1.6 s recommended. */
  windowSec?: number;
}

export class CHROMExtractor {
  private fs: number;
  private windowLen: number;
  private bufR: Float64Array;
  private bufG: Float64Array;
  private bufB: Float64Array;
  private idx = 0;
  private filled = 0;

  constructor(opts: CHROMOptions) {
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

  push(r: number, g: number, b: number): number {
    this.bufR[this.idx] = r;
    this.bufG[this.idx] = g;
    this.bufB[this.idx] = b;
    this.idx = (this.idx + 1) % this.windowLen;
    if (this.filled < this.windowLen) this.filled++;
    if (this.filled < this.windowLen) return 0;

    let mR = 0, mG = 0, mB = 0;
    for (let i = 0; i < this.windowLen; i++) {
      mR += this.bufR[i]; mG += this.bufG[i]; mB += this.bufB[i];
    }
    mR /= this.windowLen; mG /= this.windowLen; mB /= this.windowLen;
    if (mR < 1 || mG < 1 || mB < 1) return 0;

    let xSum = 0, ySum = 0, xSqSum = 0, ySqSum = 0;
    let xLast = 0, yLast = 0;
    const lastIdx = (this.idx - 1 + this.windowLen) % this.windowLen;
    for (let i = 0; i < this.windowLen; i++) {
      const rN = this.bufR[i] / mR;
      const gN = this.bufG[i] / mG;
      const bN = this.bufB[i] / mB;
      const x = 3 * rN - 2 * gN;
      const y = 1.5 * rN + gN - 1.5 * bN;
      xSum += x; ySum += y;
      xSqSum += x * x; ySqSum += y * y;
      if (i === lastIdx) { xLast = x; yLast = y; }
    }
    const meanX = xSum / this.windowLen;
    const meanY = ySum / this.windowLen;
    const varX = Math.max(0, xSqSum / this.windowLen - meanX * meanX);
    const varY = Math.max(1e-12, ySqSum / this.windowLen - meanY * meanY);
    const alpha = Math.sqrt(varX) / Math.sqrt(varY);

    return xLast - alpha * yLast;
  }
}
