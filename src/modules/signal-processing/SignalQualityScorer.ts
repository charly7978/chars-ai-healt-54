/**
 * Puntuación SQI 0..1 por fuente candidata: bandpower cardíaco, autocorrelación,
 * SNR espectral proxy, drift, clipping, plantilla de pulso simple, entropía aproximada.
 */

import { RingBuffer } from './RingBuffer';

export interface SourceSQIDetail {
  sqi: number;
  bandPowerRatio: number;
  periodicity: number;
  peakStability: number;
  snrSpectral: number;
  driftPenalty: number;
  clipPenalty: number;
  templateCorr: number;
  zeroCrossSanity: number;
  entropyPenalty: number;
  reasons: string[];
}

export class SignalQualityScorer {
  scoreSource(
    buf: RingBuffer,
    clipHigh: number,
    clipLow: number,
    motion: boolean,
    sampleRate: number
  ): SourceSQIDetail {
    const reasons: string[] = [];
    const sr = Math.max(15, Math.min(60, sampleRate));
    const n = Math.min(128, buf.length);
    if (n < 40) {
      return {
        sqi: 0,
        bandPowerRatio: 0,
        periodicity: 0,
        peakStability: 0,
        snrSpectral: 0,
        driftPenalty: 0,
        clipPenalty: 0,
        templateCorr: 0,
        zeroCrossSanity: 0,
        entropyPenalty: 0,
        reasons: ['short_buffer'],
      };
    }

    const minLag = Math.max(6, Math.floor(sr * 0.33));
    const maxLag = Math.min(90, Math.floor(sr * 1.4));

    let bestAuto = 0;
    let bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const ac = buf.autocorrelation(lag, n);
      if (ac > bestAuto) {
        bestAuto = ac;
        bestLag = lag;
      }
    }

    let secondPeak = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (Math.abs(lag - bestLag) < 3) continue;
      const ac = buf.autocorrelation(lag, n);
      if (ac > secondPeak) secondPeak = ac;
    }
    const peakStability = Math.max(0, Math.min(1, bestAuto - secondPeak * 0.85));

    const p10 = buf.percentile(0.08, n);
    const p90 = buf.percentile(0.92, n);
    const range = p90 - p10;
    const mean = buf.mean(n);
    const std = Math.sqrt(buf.variance(n));
    const snrSpectral = range / (std + 0.15);

    const half = Math.floor(n / 2);
    let mFirst = 0;
    let mSecond = 0;
    for (let i = 0; i < half; i++) mFirst += buf.get(buf.length - n + i);
    mFirst /= Math.max(1, half);
    for (let i = half; i < n; i++) mSecond += buf.get(buf.length - n + i);
    mSecond /= Math.max(1, n - half);
    const driftPenalty = Math.abs(mFirst - mSecond) / (range + 0.2);

    const clipPenalty = clipHigh * 1.1 + clipLow * 0.6;
    if (clipHigh > 0.12) reasons.push('clip_high');
    if (clipLow > 0.18) reasons.push('clip_low');

    const templateCorr = this.pulseTemplateCorrelation(buf, n, sr);

    let zc = 0;
    for (let i = 1; i < n; i++) {
      const a = buf.get(buf.length - n + i) - mean;
      const b = buf.get(buf.length - n + i - 1) - mean;
      if (a * b < 0) zc++;
    }
    const zcRate = zc / n;
    const zeroCrossSanity = zcRate > 0.55 ? Math.max(0, 1 - (zcRate - 0.55) * 3) : 1;

    const entropyPenalty = this.approxEntropy(buf, n);

    const bandPowerRatio = Math.min(1, (range * bestAuto) / (std + 0.05));

    let sqi =
      bandPowerRatio * 0.22 +
      bestAuto * 0.24 +
      peakStability * 0.12 +
      Math.min(1, snrSpectral / 8) * 0.14 +
      templateCorr * 0.12 +
      zeroCrossSanity * 0.08 +
      (1 - Math.min(1, driftPenalty * 3)) * 0.06 -
      clipPenalty * 0.35 -
      entropyPenalty * 0.12;
    if (motion) sqi -= 0.18;
    if (motion) reasons.push('motion');

    sqi = Math.max(0, Math.min(1, sqi));

    return {
      sqi,
      bandPowerRatio: Math.min(1, bandPowerRatio),
      periodicity: bestAuto,
      peakStability,
      snrSpectral: Math.min(1, snrSpectral / 10),
      driftPenalty,
      clipPenalty,
      templateCorr,
      zeroCrossSanity,
      entropyPenalty,
      reasons,
    };
  }

  private pulseTemplateCorrelation(buf: RingBuffer, n: number, sr: number): number {
    const center = Math.floor(sr * 0.45);
    const sigma = Math.max(3, sr * 0.09);
    let sum = 0;
    let sumTT = 0;
    for (let i = 0; i < n; i++) {
      const t = i - center;
      const tpl = Math.exp(-(t * t) / (2 * sigma * sigma));
      const v = buf.get(buf.length - n + i);
      sum += v * tpl;
      sumTT += tpl * tpl;
    }
    const vm = buf.mean(n);
    let vv = 0;
    for (let i = 0; i < n; i++) {
      const d = buf.get(buf.length - n + i) - vm;
      vv += d * d;
    }
    const denom = Math.sqrt(vv * sumTT + 1e-9);
    return Math.max(0, Math.min(1, sum / denom));
  }

  private approxEntropy(buf: RingBuffer, n: number): number {
    const bins = 16;
    const hist = new Int32Array(bins);
    const mm = buf.minMax(n);
    const span = mm.max - mm.min + 1e-9;
    for (let i = 0; i < n; i++) {
      const v = buf.get(buf.length - n + i);
      const b = Math.min(bins - 1, Math.floor(((v - mm.min) / span) * bins));
      hist[b]++;
    }
    let H = 0;
    for (let i = 0; i < bins; i++) {
      const p = hist[i]! / n;
      if (p > 1e-9) H -= p * Math.log2(p);
    }
    const Hnorm = H / Math.log2(bins);
    return Math.max(0, Hnorm - 0.55) * 1.2;
  }
}
