/**
 * Welch PSD simplificado + métricas espectrales para SQI y fusión.
 */

export interface SpectralWindowFeatures {
  dominantFrequencyHz: number;
  dominantBpm: number;
  spectralDominanceScore: number;
  harmonicityScore: number;
  spectralEntropy: number;
  spectralEntropyPenalty: number;
  dominantFrequencyStability: number;
  peakProminenceRatio: number;
  bandPowerRatio: number;
  detectorAgreementScore: number;
}

const HR_MIN_HZ = 0.7;
const HR_MAX_HZ = 4.2;

function hann(n: number, i: number): number {
  return 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
}

function fftBinPower(signal: Float64Array, fs: number, freqHz: number): number {
  const n = signal.length;
  if (n < 8) return 0;
  let real = 0;
  let imag = 0;
  const w = (2 * Math.PI * freqHz * n) / fs;
  for (let i = 0; i < n; i++) {
    const ang = (w * i) / n;
    const wi = signal[i] * hann(n, i);
    real += wi * Math.cos(ang);
    imag -= wi * Math.sin(ang);
  }
  return (real * real + imag * imag) / (n * n + 1e-12);
}

function welchAveragePsd(
  samples: Float64Array,
  fs: number,
  segments: number
): { freqs: Float64Array; psd: Float64Array } {
  const n = samples.length;
  const segLen = Math.max(32, Math.floor(n / Math.max(1, segments)));
  const step = Math.max(8, Math.floor(segLen / 2));
  const numBins = Math.min(80, Math.floor(segLen / 2));
  const freqs = new Float64Array(numBins);
  const acc = new Float64Array(numBins);
  let segCount = 0;
  for (let b = 0; b < numBins; b++) {
    freqs[b] = (b * fs) / segLen;
  }
  for (let start = 0; start + segLen <= n; start += step) {
    const seg = new Float64Array(segLen);
    let mean = 0;
    for (let i = 0; i < segLen; i++) {
      seg[i] = samples[start + i];
      mean += seg[i];
    }
    mean /= segLen;
    for (let i = 0; i < segLen; i++) seg[i] -= mean;
    for (let b = 0; b < numBins; b++) {
      const f = freqs[b];
      acc[b] += fftBinPower(seg, fs, f);
    }
    segCount++;
  }
  if (segCount < 1) {
    return { freqs, psd: acc };
  }
  for (let b = 0; b < numBins; b++) acc[b] /= segCount;
  return { freqs, psd: acc };
}

function spectralEntropyNorm(psd: Float64Array): { entropy: number; penalty: number } {
  let s = 0;
  for (let i = 0; i < psd.length; i++) s += psd[i];
  if (s < 1e-18) return { entropy: 1, penalty: 1 };
  let ent = 0;
  for (let i = 0; i < psd.length; i++) {
    const p = psd[i] / s;
    if (p > 1e-12) ent -= p * Math.log2(p);
  }
  const n = psd.length;
  const entNorm = ent / Math.log2(Math.max(2, n));
  const penalty = Math.max(0, Math.min(1, 1.15 - entNorm));
  return { entropy: entNorm, penalty };
}

export function computeSpectralWindowFeatures(
  samples: Float64Array,
  fs: number,
  welchSegments: number,
  prevDominantHz: number,
  temporalPeakHz: number | null
): SpectralWindowFeatures {
  const empty: SpectralWindowFeatures = {
    dominantFrequencyHz: 0,
    dominantBpm: 0,
    spectralDominanceScore: 0,
    harmonicityScore: 0,
    spectralEntropy: 1,
    spectralEntropyPenalty: 1,
    dominantFrequencyStability: 0,
    peakProminenceRatio: 0,
    bandPowerRatio: 0,
    detectorAgreementScore: 0,
  };
  if (samples.length < 64 || fs < 12) return empty;

  const { freqs, psd } = welchAveragePsd(samples, fs, welchSegments);
  let bandPow = 0;
  let totalPow = 0;
  let peakIdx = -1;
  let peakVal = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const p = psd[i];
    totalPow += p;
    if (f >= HR_MIN_HZ && f <= HR_MAX_HZ) {
      bandPow += p;
      if (p > peakVal) {
        peakVal = p;
        peakIdx = i;
      }
    }
  }
  if (peakIdx < 0 || totalPow < 1e-18) return empty;

  const domF = freqs[peakIdx];
  const left = peakIdx > 0 ? psd[peakIdx - 1] : peakVal;
  const right = peakIdx < psd.length - 1 ? psd[peakIdx + 1] : peakVal;
  const neigh = (left + right) / 2 + 1e-12;
  const peakProminenceRatio = Math.min(12, peakVal / neigh);

  const h2 = domF * 2;
  let harmPow = 0;
  let bestDf = 1e9;
  for (let i = 0; i < freqs.length; i++) {
    const df = Math.abs(freqs[i] - h2);
    if (df < bestDf) {
      bestDf = df;
      harmPow = psd[i];
    }
  }
  const harmonicityScore = Math.max(0, Math.min(1, harmPow / (peakVal + 1e-12)));

  const { entropy, penalty } = spectralEntropyNorm(psd);
  const bandPowerRatio = bandPow / (totalPow + 1e-12);
  const spectralDominanceScore = Math.max(0, Math.min(1, bandPowerRatio * 0.55 + Math.min(1, peakProminenceRatio / 4) * 0.45));

  const stab =
    prevDominantHz > 0.2 ? Math.max(0, 1 - Math.abs(domF - prevDominantHz) / 0.55) : 0.35;
  const dominantFrequencyStability = stab;

  let detectorAgreementScore = 0.5;
  if (temporalPeakHz !== null && temporalPeakHz > HR_MIN_HZ && temporalPeakHz < HR_MAX_HZ) {
    const diff = Math.abs(temporalPeakHz - domF);
    detectorAgreementScore = Math.max(0, 1 - diff / 0.65);
  }

  return {
    dominantFrequencyHz: domF,
    dominantBpm: domF * 60,
    spectralDominanceScore: spectralDominanceScore,
    harmonicityScore,
    spectralEntropy: entropy,
    spectralEntropyPenalty: penalty,
    dominantFrequencyStability,
    peakProminenceRatio,
    bandPowerRatio,
    detectorAgreementScore,
  };
}

/** NCC en ventana corta; devuelve lag (muestras) del máximo en [-maxLag..maxLag] */
export function normalizedCrossCorrLag(
  ref: RingBufferLike,
  tgt: RingBufferLike,
  n: number,
  maxLag: number
): { lag: number; ncc: number } {
  let bestLag = 0;
  let best = -1;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    const mr = ref.mean(n);
    const mt = tgt.mean(n);
    for (let i = 0; i < n; i++) {
      const ir = ref.length - n + i;
      const it = tgt.length - n + i - lag;
      if (it < 0 || it >= tgt.length) continue;
      const xr = ref.get(ir) - mr;
      const xt = tgt.get(it) - mt;
      num += xr * xt;
      denA += xr * xr;
      denB += xt * xt;
    }
    const d = Math.sqrt(denA * denB + 1e-12);
    const c = num / d;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return { lag: bestLag, ncc: Math.max(0, best) };
}

export interface RingBufferLike {
  length: number;
  get(i: number): number;
  mean(n: number): number;
}
