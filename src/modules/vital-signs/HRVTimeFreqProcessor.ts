/**
 * HRV TIME + FREQUENCY DOMAIN PROCESSOR
 *
 * Computes HRV indices from a stream of RR intervals (in milliseconds):
 *  • Time-domain: meanRR, SDNN, RMSSD, pNN20, pNN50, SD1, SD2, SD1/SD2,
 *    triangular index (HRVTI), TINN
 *  • Frequency-domain (Lomb-Scargle on irregular RR samples — no resampling):
 *    VLF (<0.04 Hz), LF (0.04–0.15 Hz), HF (0.15–0.4 Hz), TP, LF/HF, LFnu, HFnu
 *  • Non-linear: DFA α1 (short-term scaling exponent, n=4..16),
 *    Sample Entropy (m=2, r=0.2*SDNN)
 *
 * No simulation, no Math.random. All math is deterministic over the input RR
 * series. Designed to be called every ~1–2 s (window length ≥30 s for FD,
 * ≥10 s for time-domain to be meaningful).
 *
 * References:
 *  - Lomb (1976), Scargle (1982): Spectral analysis of unevenly-sampled data
 *  - Task Force ESC/NASPE (1996): HRV standards
 *  - Peng et al. (1995): DFA
 *  - Richman & Moorman (2000): Sample entropy
 */

import { median, mean, std } from '../../utils/mathUtils';

export interface HRVTimeDomain {
  meanRR: number;        // ms
  sdnn: number;          // ms
  rmssd: number;         // ms
  pnn20: number;         // 0..1
  pnn50: number;         // 0..1
  sd1: number;           // ms (Poincaré)
  sd2: number;           // ms (Poincaré)
  sd1Sd2: number;        // ratio
  hrvti: number;         // triangular index (no unit)
  tinn: number;          // ms
  hr: number;            // bpm derived from meanRR
}

export interface HRVFrequencyDomain {
  vlfPower: number;      // ms²
  lfPower: number;       // ms²
  hfPower: number;       // ms²
  totalPower: number;    // ms²
  lfHfRatio: number;     // unitless
  lfNu: number;          // normalized units (0..1) — LF / (LF+HF)
  hfNu: number;          // normalized units (0..1) — HF / (LF+HF)
  peakHfHz: number;      // Hz where HF peak lives (≈ respiratory rate / 60)
}

export interface HRVNonLinear {
  dfaAlpha1: number;     // short-term scaling exponent
  sampEn: number;        // sample entropy
}

export interface HRVResult {
  time: HRVTimeDomain;
  freq: HRVFrequencyDomain;
  nonlinear: HRVNonLinear;
  /** Number of valid RR intervals used */
  nUsed: number;
  /** Total recording length the indices cover, in seconds */
  durationSec: number;
  /** Quality score 0..1 of how trustworthy these indices are */
  quality: number;
  /** Reasons why quality is low (if any) */
  qualityFlags: string[];
}

const MIN_RR_MS = 280;      // 214 bpm
const MAX_RR_MS = 2000;     // 30 bpm
const MIN_INTERVALS_TIME = 8;
const MIN_INTERVALS_FREQ = 24;

/**
 * Reject RR intervals that are physiologically impossible AND those whose
 * difference from the running median is implausible (>30% in one beat).
 */
function cleanRR(rrIntervals: number[]): number[] {
  const inRange = rrIntervals.filter(rr => rr >= MIN_RR_MS && rr <= MAX_RR_MS);
  if (inRange.length < 3) return inRange;
  const sorted = [...inRange].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  return inRange.filter(rr => Math.abs(rr - med) / med <= 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME-DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
function computeTimeDomain(rr: number[]): HRVTimeDomain {
  const meanRR = mean(rr);
  const sdnn = std(rr, meanRR);

  let sumSqDiff = 0;
  let nn20 = 0, nn50 = 0;
  for (let i = 1; i < rr.length; i++) {
    const d = rr[i] - rr[i - 1];
    sumSqDiff += d * d;
    if (Math.abs(d) > 20) nn20++;
    if (Math.abs(d) > 50) nn50++;
  }
  const rmssd = rr.length > 1 ? Math.sqrt(sumSqDiff / (rr.length - 1)) : 0;
  const pnn20 = rr.length > 1 ? nn20 / (rr.length - 1) : 0;
  const pnn50 = rr.length > 1 ? nn50 / (rr.length - 1) : 0;

  // Poincaré
  const sd1 = rmssd / Math.SQRT2;
  // SD2 = sqrt(2*SDNN^2 − 0.5*RMSSD^2)
  const sd2 = Math.sqrt(Math.max(0, 2 * sdnn * sdnn - 0.5 * rmssd * rmssd));
  const sd1Sd2 = sd2 > 0 ? sd1 / sd2 : 0;

  // HRVTI = total intervals / max(histogram bin count) using 7.8125 ms bins (128 Hz)
  const binWidthMs = 7.8125;
  const hist = new Map<number, number>();
  for (const x of rr) {
    const k = Math.round(x / binWidthMs);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let maxBin = 0, maxBinIdx = 0;
  for (const [k, v] of hist) {
    if (v > maxBin) { maxBin = v; maxBinIdx = k; }
  }
  const hrvti = maxBin > 0 ? rr.length / maxBin : 0;

  // TINN: width of triangular interpolation of histogram base
  let leftK = maxBinIdx, rightK = maxBinIdx;
  for (const [k, v] of hist) {
    if (v > 0) {
      if (k < leftK) leftK = k;
      if (k > rightK) rightK = k;
    }
  }
  const tinn = (rightK - leftK) * binWidthMs;

  return {
    meanRR,
    sdnn,
    rmssd,
    pnn20,
    pnn50,
    sd1,
    sd2,
    sd1Sd2,
    hrvti,
    tinn,
    hr: meanRR > 0 ? 60000 / meanRR : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOMB-SCARGLE PERIODOGRAM (works on unevenly-sampled RR series)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute the (normalized) Lomb-Scargle power at a single angular frequency ω.
 * Reference: Press et al. "Numerical Recipes" §13.8.
 */
function lombScarglePower(t: number[], y: number[], yMean: number, omega: number): number {
  let sumSin2 = 0, sumCos2 = 0;
  for (const ti of t) {
    sumSin2 += Math.sin(2 * omega * ti);
    sumCos2 += Math.cos(2 * omega * ti);
  }
  const tau = Math.atan2(sumSin2, sumCos2) / (2 * omega);

  let sCos = 0, sSin = 0;
  let sCos2 = 0, sSin2 = 0;
  for (let i = 0; i < t.length; i++) {
    const wt = omega * (t[i] - tau);
    const c = Math.cos(wt);
    const s = Math.sin(wt);
    const yc = (y[i] - yMean) * c;
    const ys = (y[i] - yMean) * s;
    sCos += yc;
    sSin += ys;
    sCos2 += c * c;
    sSin2 += s * s;
  }

  const denomC = sCos2 > 1e-12 ? (sCos * sCos) / sCos2 : 0;
  const denomS = sSin2 > 1e-12 ? (sSin * sSin) / sSin2 : 0;
  return 0.5 * (denomC + denomS);
}

/**
 * Build the cumulative-time axis for an RR series (in seconds), then compute
 * power in standard HRV bands using Lomb-Scargle. Returns absolute and
 * normalized units. `power` is in (units of y)² ≡ ms².
 */
function computeFrequencyDomain(rr: number[]): HRVFrequencyDomain {
  if (rr.length < MIN_INTERVALS_FREQ) {
    return {
      vlfPower: 0, lfPower: 0, hfPower: 0, totalPower: 0,
      lfHfRatio: 0, lfNu: 0, hfNu: 0, peakHfHz: 0,
    };
  }

  // Build cumulative time series. Lomb-Scargle treats the RR value as the
  // signal y(t) sampled at the times t[i] = sum(rr[0..i]).
  const t: number[] = new Array(rr.length);
  let acc = 0;
  for (let i = 0; i < rr.length; i++) {
    acc += rr[i] / 1000; // seconds
    t[i] = acc;
  }
  const totalDurSec = t[t.length - 1];
  const yMean = mean(rr);

  // Frequency grid: 0.0033..0.4 Hz, ~80 bins logarithmically spaced.
  const fMin = 0.0033, fMax = 0.4;
  const N = 96;
  const freqs: number[] = new Array(N);
  const logMin = Math.log(fMin), logMax = Math.log(fMax);
  for (let k = 0; k < N; k++) {
    freqs[k] = Math.exp(logMin + ((logMax - logMin) * k) / (N - 1));
  }

  // Compute power per bin
  let vlf = 0, lf = 0, hf = 0;
  let peakHfHz = 0, peakHfPower = 0;
  for (let k = 0; k < N - 1; k++) {
    const f = freqs[k];
    const fNext = freqs[k + 1];
    const dF = fNext - f;
    const omega = 2 * Math.PI * f;
    const p = lombScarglePower(t, rr, yMean, omega);
    const energy = p * dF; // ms² per bin (rectangle approximation)

    if (f >= 0.0033 && f < 0.04) vlf += energy;
    else if (f >= 0.04 && f < 0.15) lf += energy;
    else if (f >= 0.15 && f <= 0.4) {
      hf += energy;
      if (p > peakHfPower) { peakHfPower = p; peakHfHz = f; }
    }
  }

  const total = vlf + lf + hf;
  const lfHf = hf > 1e-9 ? lf / hf : 0;
  const lfHfDenom = lf + hf;
  const lfNu = lfHfDenom > 1e-9 ? lf / lfHfDenom : 0;
  const hfNu = lfHfDenom > 1e-9 ? hf / lfHfDenom : 0;

  return {
    vlfPower: vlf,
    lfPower: lf,
    hfPower: hf,
    totalPower: total,
    lfHfRatio: lfHf,
    lfNu, hfNu,
    peakHfHz,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NON-LINEAR
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Detrended Fluctuation Analysis short-term scaling exponent α1.
 * Window scales: n = 4..16 (Peng 1995).
 */
function computeDFAalpha1(rr: number[]): number {
  if (rr.length < 16) return 0;
  const N = rr.length;
  const m = mean(rr);
  // Integrated profile y(k) = sum_{i=1..k} (rr[i] − m)
  const y = new Array<number>(N);
  let s = 0;
  for (let i = 0; i < N; i++) { s += rr[i] - m; y[i] = s; }

  const ns: number[] = [];
  for (let n = 4; n <= 16; n += 1) {
    if (Math.floor(N / n) >= 2) ns.push(n);
  }
  if (ns.length < 4) return 0;

  const logN: number[] = [];
  const logF: number[] = [];

  for (const n of ns) {
    const M = Math.floor(N / n);
    let sumSqResid = 0;
    for (let v = 0; v < M; v++) {
      const start = v * n;
      // Linear regression on segment indices 0..n-1
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) {
        sx += i;
        sy += y[start + i];
        sxx += i * i;
        sxy += i * y[start + i];
      }
      const denom = n * sxx - sx * sx;
      if (denom === 0) continue;
      const slope = (n * sxy - sx * sy) / denom;
      const intercept = (sy - slope * sx) / n;
      for (let i = 0; i < n; i++) {
        const fit = slope * i + intercept;
        const e = y[start + i] - fit;
        sumSqResid += e * e;
      }
    }
    const Fn = Math.sqrt(sumSqResid / (M * n));
    if (Fn > 0 && isFinite(Fn)) {
      logN.push(Math.log(n));
      logF.push(Math.log(Fn));
    }
  }
  if (logN.length < 4) return 0;

  // Linear regression: slope = α1
  const lnMean = mean(logN);
  const lfMean = mean(logF);
  let num = 0, den = 0;
  for (let i = 0; i < logN.length; i++) {
    num += (logN[i] - lnMean) * (logF[i] - lfMean);
    den += (logN[i] - lnMean) * (logN[i] - lnMean);
  }
  return den > 0 ? num / den : 0;
}

/**
 * Sample Entropy with m=2, r=0.2*SDNN. Returns 0 when undefined.
 */
function computeSampEn(rr: number[], sdnn: number): number {
  const N = rr.length;
  if (N < 12) return 0;
  const r = 0.2 * sdnn;
  if (r <= 0) return 0;
  const m = 2;

  let A = 0; // matches of length m+1
  let B = 0; // matches of length m

  for (let i = 0; i < N - m; i++) {
    for (let j = i + 1; j < N - m; j++) {
      // Chebyshev distance over m-dim vectors
      let dM = 0;
      for (let k = 0; k < m; k++) {
        const d = Math.abs(rr[i + k] - rr[j + k]);
        if (d > dM) dM = d;
      }
      if (dM <= r) {
        B++;
        // Extend to (m+1)
        const dM1 = Math.abs(rr[i + m] - rr[j + m]);
        if (Math.max(dM, dM1) <= r) A++;
      }
    }
  }

  if (A === 0 || B === 0) return 0;
  return -Math.log(A / B);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
export class HRVTimeFreqProcessor {
  /**
   * Compute the full HRV report. `rrIntervals` is a list of latest RR (ms).
   * Set `minIntervalsForFreq` lower if you want LF/HF estimates earlier
   * (default 24 ≈ 24×0.8s = 19s window minimum).
   */
  compute(rrIntervals: number[], minIntervalsForFreq = MIN_INTERVALS_FREQ): HRVResult {
    const flags: string[] = [];
    const rr = cleanRR(rrIntervals);

    if (rr.length < MIN_INTERVALS_TIME) flags.push('insufficient_intervals');

    const td = rr.length >= MIN_INTERVALS_TIME
      ? computeTimeDomain(rr)
      : { meanRR: 0, sdnn: 0, rmssd: 0, pnn20: 0, pnn50: 0, sd1: 0, sd2: 0, sd1Sd2: 0, hrvti: 0, tinn: 0, hr: 0 };

    const fd = rr.length >= minIntervalsForFreq
      ? computeFrequencyDomain(rr)
      : { vlfPower: 0, lfPower: 0, hfPower: 0, totalPower: 0, lfHfRatio: 0, lfNu: 0, hfNu: 0, peakHfHz: 0 };
    if (rr.length < minIntervalsForFreq) flags.push('insufficient_for_frequency');

    const nl: HRVNonLinear = rr.length >= 16
      ? { dfaAlpha1: computeDFAalpha1(rr), sampEn: computeSampEn(rr, td.sdnn) }
      : { dfaAlpha1: 0, sampEn: 0 };

    const durationSec = rr.reduce((s, v) => s + v, 0) / 1000;

    // Quality: combine intervals count + duration + outlier ratio
    const outlierRatio = rrIntervals.length > 0 ? 1 - rr.length / rrIntervals.length : 1;
    let quality = 0;
    quality += Math.min(0.5, rr.length / 60); // up to 60 intervals → 0.5
    quality += Math.min(0.3, durationSec / 60); // up to 60s → 0.3
    quality += Math.max(0, 0.2 - outlierRatio);
    quality = Math.max(0, Math.min(1, quality));
    if (outlierRatio > 0.3) flags.push('high_outlier_ratio');

    return {
      time: td,
      freq: fd,
      nonlinear: nl,
      nUsed: rr.length,
      durationSec,
      quality,
      qualityFlags: flags,
    };
  }
}
