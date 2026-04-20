/**
 * RESPIRATORY RATE PROCESSOR (PPG-derived)
 *
 * Extracts respiratory rate (RR, breaths per minute) from a single-site PPG
 * signal using three classical respiratory modulations and fuses them by
 * SNR-weighted vote. Reference paper (Charlton et al. 2016 IPEM, Comp.
 * Biomed. Eng.; Pimentel et al. 2017): FM > AM ≈ BW for respiratory rate
 * extraction; fusion of the three reduces individual error.
 *
 *   AM  — pulse Amplitude Modulation: per-beat (peak − valley) amplitude
 *   FM  — frequency Modulation: 60000 / RR_i (instantaneous HR)
 *   BW  — Baseline Wandering: very-low-pass envelope of the PPG itself
 *
 * Each derived modulation series is interpolated to a uniform 4 Hz grid,
 * detrended, windowed (Hann), and analyzed with Welch's method PSD over the
 * 0.1–0.5 Hz band (6–30 brpm). The three peak frequencies are fused by
 * weighted median where weights = SNR (peak / mean over band).
 *
 * No simulation, no Math.random. All math is deterministic.
 */

export interface RespRateInput {
  /** Filtered PPG samples (most recent at end). Length must be ≥ sampleRate * 30. */
  ppg: number[];
  /** Sample rate of the PPG signal in Hz. */
  sampleRate: number;
  /** Beat indices in `ppg` (peaks). Optional but improves AM accuracy. */
  beatIndices?: number[];
  /** Pre-computed RR intervals in ms (used for FM). */
  rrIntervalsMs?: number[];
}

export interface RespRateResult {
  /** Best-estimate respiratory rate in breaths per minute. 0 if unreliable. */
  brpm: number;
  /** Confidence 0..1. */
  confidence: number;
  /** Per-modulation estimates (brpm) and SNRs */
  perModulation: {
    am: { brpm: number; snr: number };
    fm: { brpm: number; snr: number };
    bw: { brpm: number; snr: number };
  };
  /** Quality flags (empty when OK) */
  qualityFlags: string[];
}

const RESP_BAND_LO_HZ = 0.10;   // 6 brpm
const RESP_BAND_HI_HZ = 0.50;   // 30 brpm
const FUSION_FS_HZ = 4;         // unified resampling rate
const MIN_PPG_SECONDS = 25;     // need ≥25 s of PPG for stable Welch

import { mean } from '../../utils/mathUtils';

/**
 * Linear interpolation of an irregularly-sampled (timesSec, values) series
 * onto a uniform target grid `tGrid` (in seconds).
 */
function linearInterp(timesSec: number[], values: number[], tGrid: number[]): number[] {
  const out = new Array<number>(tGrid.length).fill(0);
  if (timesSec.length === 0 || values.length === 0) return out;
  let j = 0;
  for (let i = 0; i < tGrid.length; i++) {
    const t = tGrid[i];
    while (j < timesSec.length - 1 && timesSec[j + 1] < t) j++;
    if (t <= timesSec[0]) { out[i] = values[0]; continue; }
    if (t >= timesSec[timesSec.length - 1]) { out[i] = values[values.length - 1]; continue; }
    const t0 = timesSec[j];
    const t1 = timesSec[j + 1];
    const dt = t1 - t0;
    if (dt <= 0) { out[i] = values[j]; continue; }
    const frac = (t - t0) / dt;
    out[i] = values[j] + (values[j + 1] - values[j]) * frac;
  }
  return out;
}

/** Hann window of length N */
function hann(N: number): Float64Array {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  return w;
}

/**
 * Naive DFT magnitude squared (PSD) over a frequency grid. Costly but fine
 * for short sequences (≤256 samples) and gives us full control over bin layout.
 * Returns powers (units of x²) for each freq in `freqsHz`.
 */
function dftPower(x: number[], fs: number, freqsHz: number[]): number[] {
  const N = x.length;
  const out: number[] = new Array(freqsHz.length).fill(0);
  for (let k = 0; k < freqsHz.length; k++) {
    const omega = (2 * Math.PI * freqsHz[k]) / fs;
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = omega * n;
      re += x[n] * Math.cos(angle);
      im -= x[n] * Math.sin(angle);
    }
    out[k] = (re * re + im * im) / N;
  }
  return out;
}

/**
 * Welch's method on a small signal: split into 50%-overlapping segments,
 * Hann-window, DFT power, then average.
 */
function welchPSD(x: number[], fs: number, freqsHz: number[]): number[] {
  const segLen = Math.min(128, x.length);
  if (x.length < 32) {
    return dftPower(x, fs, freqsHz);
  }
  const step = Math.max(1, Math.floor(segLen / 2));
  const w = hann(segLen);
  // U = window normalization
  let U = 0;
  for (let i = 0; i < segLen; i++) U += w[i] * w[i];
  U = U / segLen;

  const acc: number[] = new Array(freqsHz.length).fill(0);
  let segs = 0;
  for (let start = 0; start + segLen <= x.length; start += step) {
    const seg: number[] = new Array(segLen);
    let s = 0;
    for (let i = 0; i < segLen; i++) s += x[start + i];
    const mu = s / segLen;
    for (let i = 0; i < segLen; i++) seg[i] = (x[start + i] - mu) * w[i];
    const p = dftPower(seg, fs, freqsHz);
    for (let k = 0; k < freqsHz.length; k++) acc[k] += p[k];
    segs++;
  }
  if (segs === 0) return dftPower(x, fs, freqsHz);
  for (let k = 0; k < freqsHz.length; k++) acc[k] /= (segs * U);
  return acc;
}

/**
 * Build a frequency grid in Hz spanning the respiratory band with a fixed
 * resolution (default 0.005 Hz ≈ 0.3 brpm).
 */
function respFreqGrid(resolutionHz = 0.005): number[] {
  const out: number[] = [];
  for (let f = RESP_BAND_LO_HZ; f <= RESP_BAND_HI_HZ + 1e-9; f += resolutionHz) {
    out.push(f);
  }
  return out;
}

/** Find peak freq in PSD restricted to [fLo, fHi] and return (peakF, peakP, snr) */
function peakInBand(psd: number[], freqs: number[], fLo: number, fHi: number) {
  let peakIdx = -1, peakP = 0;
  let inBandPower = 0, inBandCount = 0;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] >= fLo && freqs[k] <= fHi) {
      inBandPower += psd[k]; inBandCount++;
      if (psd[k] > peakP) { peakP = psd[k]; peakIdx = k; }
    }
  }
  if (peakIdx < 0 || inBandCount === 0) return { peakHz: 0, snr: 0 };
  const meanInBand = inBandPower / inBandCount;
  const snr = meanInBand > 0 ? peakP / meanInBand : 0;
  return { peakHz: freqs[peakIdx], snr };
}

/**
 * Detect peaks (and corresponding valleys) in the PPG signal using a simple
 * adaptive prominence check. Used only when no beatIndices are supplied.
 */
function localPeaks(x: number[], minSepSamples: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] > x[i - 1] && x[i] >= x[i + 1]) {
      if (out.length === 0 || i - out[out.length - 1] >= minSepSamples) {
        out.push(i);
      } else if (x[i] > x[out[out.length - 1]]) {
        out[out.length - 1] = i;
      }
    }
  }
  return out;
}

function nearestValleyBefore(x: number[], peakIdx: number, lookback: number): number {
  const start = Math.max(0, peakIdx - lookback);
  let valley = peakIdx;
  let valleyVal = x[peakIdx];
  for (let i = start; i < peakIdx; i++) {
    if (x[i] < valleyVal) { valleyVal = x[i]; valley = i; }
  }
  return valley;
}

/**
 * Build the AM modulation series (peak − valley amplitude per beat) at the
 * beat times.
 */
function buildAM(ppg: number[], beats: number[], fs: number): { t: number[]; v: number[] } {
  if (beats.length < 6) return { t: [], v: [] };
  const t: number[] = [], v: number[] = [];
  const lookback = Math.max(2, Math.round(fs * 0.4));
  for (const p of beats) {
    if (p < 1 || p >= ppg.length) continue;
    const valley = nearestValleyBefore(ppg, p, lookback);
    const amp = ppg[p] - ppg[valley];
    if (isFinite(amp) && amp > 0) {
      t.push(p / fs);
      v.push(amp);
    }
  }
  return { t, v };
}

/**
 * Build the FM modulation series (instantaneous HR in bpm) at beat times.
 */
function buildFM(beats: number[], fs: number, rrMs?: number[]): { t: number[]; v: number[] } {
  if (rrMs && rrMs.length >= 6) {
    // Use the supplied RR. Place at cumulative time.
    const t: number[] = [], v: number[] = [];
    let acc = 0;
    for (const rr of rrMs) {
      if (rr < 280 || rr > 2000) continue;
      acc += rr / 1000;
      t.push(acc);
      v.push(60000 / rr);
    }
    return { t, v };
  }
  if (beats.length < 6) return { t: [], v: [] };
  const t: number[] = [], v: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const dtSamp = beats[i] - beats[i - 1];
    const rr = (dtSamp / fs) * 1000;
    if (rr < 280 || rr > 2000) continue;
    t.push(beats[i] / fs);
    v.push(60000 / rr);
  }
  return { t, v };
}

/**
 * Build the BW modulation series — very-slow EWMA of the PPG itself,
 * downsampled to ~2 Hz.
 */
function buildBW(ppg: number[], fs: number): { t: number[]; v: number[] } {
  const N = ppg.length;
  if (N < fs * 5) return { t: [], v: [] };
  const alpha = 0.05; // ~3s time constant — admits respiratory rhythm
  let ewma = ppg[0];
  const dec = Math.max(1, Math.round(fs / 2));
  const t: number[] = [], v: number[] = [];
  for (let i = 0; i < N; i++) {
    ewma = ewma * (1 - alpha) + ppg[i] * alpha;
    if (i % dec === 0) {
      t.push(i / fs);
      v.push(ewma);
    }
  }
  return { t, v };
}

/** Resample a (t, v) series onto a uniform 4 Hz grid spanning its time range. */
function resampleUniform(t: number[], v: number[]): { x: number[]; fs: number } {
  if (t.length === 0) return { x: [], fs: FUSION_FS_HZ };
  const t0 = t[0];
  const tN = t[t.length - 1];
  const dt = 1 / FUSION_FS_HZ;
  const M = Math.max(8, Math.floor((tN - t0) / dt));
  if (M < 8) return { x: [], fs: FUSION_FS_HZ };
  const grid: number[] = new Array(M);
  for (let i = 0; i < M; i++) grid[i] = t0 + i * dt;
  const x = linearInterp(t, v, grid);
  return { x, fs: FUSION_FS_HZ };
}

function brpmFromHz(hz: number): number { return hz * 60; }

/** Weighted median of [(value, weight)] pairs (deterministic). */
function weightedMedian(items: { value: number; weight: number }[]): number {
  const valid = items.filter(it => it.weight > 0 && it.value > 0);
  if (valid.length === 0) return 0;
  valid.sort((a, b) => a.value - b.value);
  const totalW = valid.reduce((s, it) => s + it.weight, 0);
  let cum = 0;
  for (const it of valid) {
    cum += it.weight;
    if (cum >= totalW / 2) return it.value;
  }
  return valid[valid.length - 1].value;
}

export class RespiratoryRateProcessor {
  process(input: RespRateInput): RespRateResult {
    const flags: string[] = [];
    const fs = input.sampleRate;
    const minSamples = Math.round(MIN_PPG_SECONDS * fs);

    if (!input.ppg || input.ppg.length < minSamples) {
      flags.push('ppg_too_short');
      return this.empty(flags);
    }

    // Beats (use supplied or detect)
    let beats = input.beatIndices ?? [];
    if (beats.length < 6) {
      const minSep = Math.max(2, Math.round(fs * 0.35));
      beats = localPeaks(input.ppg, minSep);
    }

    const am = buildAM(input.ppg, beats, fs);
    const fm = buildFM(beats, fs, input.rrIntervalsMs);
    const bw = buildBW(input.ppg, fs);

    const amU = resampleUniform(am.t, am.v);
    const fmU = resampleUniform(fm.t, fm.v);
    const bwU = resampleUniform(bw.t, bw.v);

    const grid = respFreqGrid(0.005);

    const evalMod = (samples: number[]): { brpm: number; snr: number } => {
      if (samples.length < 16) return { brpm: 0, snr: 0 };
      // Detrend (remove mean)
      const m = mean(samples);
      const xs = samples.map(v => v - m);
      const psd = welchPSD(xs, FUSION_FS_HZ, grid);
      const { peakHz, snr } = peakInBand(psd, grid, RESP_BAND_LO_HZ, RESP_BAND_HI_HZ);
      return { brpm: brpmFromHz(peakHz), snr };
    };

    const amR = evalMod(amU.x);
    const fmR = evalMod(fmU.x);
    const bwR = evalMod(bwU.x);

    // Weight by SNR but give FM a structural bonus (Charlton 2016 finds FM most reliable)
    const items = [
      { value: amR.brpm, weight: amR.snr * 0.9 },
      { value: fmR.brpm, weight: fmR.snr * 1.1 },
      { value: bwR.brpm, weight: bwR.snr * 0.8 },
    ];
    const fused = weightedMedian(items);

    const totalSnr = amR.snr + fmR.snr + bwR.snr;
    const agree = items.filter(it => it.value > 0 && Math.abs(it.value - fused) <= 3).length;
    let confidence = 0;
    confidence += Math.min(0.5, totalSnr / 30);
    confidence += agree / 3 * 0.4;
    confidence += input.ppg.length >= fs * 45 ? 0.1 : 0;
    confidence = Math.max(0, Math.min(1, confidence));

    if (fused === 0) flags.push('no_peak_in_resp_band');
    if (totalSnr < 3) flags.push('low_snr_overall');

    return {
      brpm: Math.round(fused * 10) / 10,
      confidence,
      perModulation: { am: amR, fm: fmR, bw: bwR },
      qualityFlags: flags,
    };
  }

  private empty(flags: string[]): RespRateResult {
    return {
      brpm: 0,
      confidence: 0,
      perModulation: { am: { brpm: 0, snr: 0 }, fm: { brpm: 0, snr: 0 }, bw: { brpm: 0, snr: 0 } },
      qualityFlags: flags,
    };
  }
}
