/**
 * SQI jerárquico — capa de ventana deslizante sobre señal fusionada + timestamps reales.
 */

import { RingBuffer } from './RingBuffer';
import type { SQICategory, SQIGating, WindowSQIMetrics, WindowSpectralSQISlice } from './pipeline-types';
import { computeSpectralWindowFeatures } from './SpectralFusionSupport';
import { DOMINANT_FREQ_DECAY_FACTOR } from '@/constants/processing';

export class SignalQualityEngine {
  private vBuf: RingBuffer;
  private tBuf: RingBuffer;
  private lastWindowScore = 0.35;
  private prevDominantHz = 0;
  private welchSegments = 3;

  constructor(capacity = 420) {
    this.vBuf = new RingBuffer(capacity);
    this.tBuf = new RingBuffer(capacity);
  }

  setWelchSegments(n: number): void {
    this.welchSegments = Math.max(2, Math.min(6, Math.round(n)));
  }

  reset(): void {
    this.vBuf.clear();
    this.tBuf.clear();
    this.lastWindowScore = 0.35;
    this.prevDominantHz = 0;
  }

  push(value: number, timestampMs: number): void {
    if (!isFinite(value) || !isFinite(timestampMs)) return;
    this.vBuf.push(value);
    this.tBuf.push(timestampMs);
  }

  /**
   * Estima fs efectiva por medianas de delta-t en la ventana.
   */
  computeWindowSQI(estimatedSampleRate: number): WindowSQIMetrics {
    const reasons: string[] = [];
    const n = this.vBuf.length;
    if (n < 48) {
      reasons.push('buffer corto');
      return finalize(0.15, 'poor', reasons, 'reject');
    }

    const maxDurMs = Math.min(8500, (n * 1000) / Math.max(12, estimatedSampleRate));
    const tEnd = this.tBuf.latest();
    let startIdx = n - 1;
    for (let i = n - 1; i >= 0; i--) {
      const t = this.tBuf.get(i);
      if (tEnd - t > maxDurMs) {
        startIdx = i + 1;
        break;
      }
      startIdx = i;
    }
    const m = n - startIdx;
    if (m < 40) {
      reasons.push('ventana útil corta');
      return finalize(0.2, 'poor', reasons, 'reject');
    }

    const vals = new Float64Array(m);
    for (let i = 0; i < m; i++) vals[i] = this.vBuf.get(startIdx + i);

    const mean = mean64(vals);
    let m2 = 0,
      m3 = 0,
      m4 = 0;
    for (let i = 0; i < m; i++) {
      const d = vals[i] - mean;
      const d2 = d * d;
      m2 += d2;
      m3 += d2 * d;
      m4 += d2 * d2;
    }
    m2 /= m;
    m3 /= m;
    m4 /= m;
    const std = Math.sqrt(Math.max(m2, 1e-12));
    const skew = m3 / (std * std * std + 1e-12);
    const kurt = m4 / (m2 * m2 + 1e-12) - 3;

    // Optimizado según literatura (Krishnan et al. 2010, ChatPPG):
    // - PPG limpio: skewness ∈ [-1.5, -0.3] (asimetría negativa por upstroke rápido)
    // - PPG limpio: kurtosis ∈ [2.5, 6.0] (forma peaked)
    // Valores fuera de estos rangos indican distorsión o artefacto
    const skewIdeal = -0.9; // Centro del rango ideal
    const skewDev = Math.abs(skew - skewIdeal);
    const skewPen = skewDev > 0.9 ? Math.min(0.15, (skewDev - 0.9) / 3 * 0.15) : 0;
    
    // Kurtosis: penalizar valores < 2 (plano) o > 7 (demasiado peaked)
    const kurtPen = kurt < 2.0 ? (2.0 - kurt) / 2 * 0.12 : 
                    kurt > 7.0 ? (kurt - 7.0) / 3 * 0.08 : 0;

    let ent = 0;
    const bins = 16;
    const hist = new Int32Array(bins);
    let vmin = vals[0],
      vmax = vals[0];
    for (let i = 1; i < m; i++) {
      if (vals[i] < vmin) vmin = vals[i];
      if (vals[i] > vmax) vmax = vals[i];
    }
    const span = vmax - vmin + 1e-9;
    for (let i = 0; i < m; i++) {
      const b = Math.min(bins - 1, Math.floor(((vals[i] - vmin) / span) * bins));
      hist[b]++;
    }
    for (let b = 0; b < bins; b++) {
      const p = hist[b] / m;
      if (p > 1e-8) ent -= p * Math.log2(p);
    }
    const entNorm = ent / Math.log2(bins);
    const entropyScore = Math.max(0, 1 - Math.abs(entNorm - 0.72) * 1.8) * 0.1;

    let bestAc = 0;
    let bestLagAc = 0;
    const maxLag = Math.min(80, m - 5);
    for (let lag = 6; lag <= maxLag; lag++) {
      let c = 0,
        a = 0,
        b = 0;
      for (let i = lag; i < m; i++) {
        const x = vals[i] - mean;
        const y = vals[i - lag] - mean;
        c += x * y;
        a += x * x;
        b += y * y;
      }
      const ac = c / (Math.sqrt(a * b) + 1e-12);
      if (ac > bestAc) {
        bestAc = ac;
        bestLagAc = lag;
      }
    }
    const periodicity = Math.max(0, Math.min(1, bestAc)) * 0.28;
    if (bestAc < 0.18) reasons.push('poca periodicidad');

    const p10 = percentile64(vals, 0.1);
    const p90 = percentile64(vals, 0.9);
    const range = p90 - p10;
    const wander = Math.abs(vals[m - 1] - vals[0]) / (range + 1e-6);
    const wanderPen = Math.min(1, wander * 0.35) * 0.1;
    if (wander > 2.2) reasons.push('deriva de línea base');

    const pulseBandPower = Math.min(1, range / (std * 4.5 + 1e-6)) * 0.18;

    const scoreRaw =
      periodicity +
      pulseBandPower +
      entropyScore +
      Math.max(0, 0.12 - skewPen - kurtPen - wanderPen);

    const score = Math.max(0, Math.min(1, scoreRaw));

    const deltas: number[] = [];
    for (let i = 1; i < m; i++) {
      const dt = this.tBuf.get(startIdx + i) - this.tBuf.get(startIdx + i - 1);
      if (dt > 5 && dt < 140) deltas.push(dt);
    }
    deltas.sort((a, b) => a - b);
    const medDt = deltas.length >= 4 ? deltas[Math.floor(deltas.length / 2)] : 1000 / Math.max(15, estimatedSampleRate);
    const fsEff = Math.max(14, Math.min(64, 1000 / Math.max(8, medDt)));

    const temporalPeakHz = bestLagAc > 0 ? fsEff / bestLagAc : null;
    const spec = computeSpectralWindowFeatures(vals, fsEff, this.welchSegments, this.prevDominantHz, temporalPeakHz);
    this.prevDominantHz = spec.dominantFrequencyHz > 0.2 ? spec.dominantFrequencyHz : this.prevDominantHz * DOMINANT_FREQ_DECAY_FACTOR;

    const specAgg = Math.max(
      0,
      Math.min(
        1,
        spec.spectralDominanceScore * 0.28 +
          spec.harmonicityScore * 0.18 +
          spec.dominantFrequencyStability * 0.2 +
          spec.detectorAgreementScore * 0.22 +
          (1 - spec.spectralEntropyPenalty) * 0.12
      )
    );
    if (spec.spectralDominanceScore < 0.18) reasons.push('pico espectral débil');
    if (spec.detectorAgreementScore < 0.32) reasons.push('discrepancia tempo-espectral');

    const spectralSlice: WindowSpectralSQISlice = {
      dominantFrequencyHz: spec.dominantFrequencyHz,
      dominantBpm: spec.dominantBpm,
      spectralDominanceScore: spec.spectralDominanceScore,
      harmonicityScore: spec.harmonicityScore,
      spectralEntropyPenalty: spec.spectralEntropyPenalty,
      dominantFrequencyStability: spec.dominantFrequencyStability,
      detectorAgreementScore: spec.detectorAgreementScore,
      peakProminenceRatio: spec.peakProminenceRatio,
      bandPowerRatio: spec.bandPowerRatio,
    };

    const blendedCore = score * 0.62 + specAgg * 0.38;
    this.lastWindowScore = this.lastWindowScore * 0.58 + blendedCore * 0.42;

    if (skewPen + kurtPen > 0.1) reasons.push('forma distribución rara');
    if (periodicity < 0.06) reasons.push('sin pico autocorr');

    return finalizeWindow(this.lastWindowScore, reasons, spectralSlice);
  }

  getLastScore(): number {
    return this.lastWindowScore;
  }
}

function mean64(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

function percentile64(a: Float64Array, p: number): number {
  const b = new Float64Array(a.length);
  b.set(a);
  b.sort();
  const idx = Math.floor(p * (b.length - 1));
  return b[idx];
}

function finalize(score: number, cat: SQICategory, reasons: string[], gating: SQIGating): WindowSQIMetrics {
  return { score, category: cat, reasons, gating };
}

function finalizeWindow(score: number, reasons: string[], spectral?: WindowSpectralSQISlice): WindowSQIMetrics {
  let cat: SQICategory = 'poor';
  if (score >= 0.72) cat = 'excellent';
  else if (score >= 0.55) cat = 'good';
  else if (score >= 0.35) cat = 'usable';

  let gating: SQIGating = 'reject';
  if (score >= 0.62) gating = 'accept_high_confidence';
  else if (score >= 0.42) gating = 'accept_low_confidence';
  else if (score >= 0.22) gating = 'hold_previous';
  else gating = 'reject';

  if (spectral && spectral.spectralDominanceScore < 0.14 && gating === 'accept_high_confidence') {
    gating = 'accept_low_confidence';
  }
  if (spectral && spectral.detectorAgreementScore < 0.22 && gating !== 'reject') {
    gating = 'hold_previous';
  }

  return { score, category: cat, reasons, gating, spectral };
}
