/**
 * SIGNAL QUALITY ENGINE — Autoridad única para decidir si una ventana es analizable.
 *
 * Calcula: SNR, estabilidad de amplitud, periodicidad, correlación entre pulsos,
 * regularidad RR, energía en banda cardíaca, drift ratio, clipping, flatline,
 * motion index, perfusion index, confidence global.
 *
 * Clasificación: GOOD / MODERATE / POOR / UNUSABLE
 */
import { PPG_CONFIG } from '../config/ppgConfig';
import type {
  QualityLevel,
  InvalidReason,
  SignalQualityResult,
} from '../types/ppg-types';

const Q = PPG_CONFIG.quality;
const S = PPG_CONFIG.signal;

export class SignalQualityEngine {

  evaluate(
    filteredBuffer: number[],
    rrIntervals: number[],
    consecutiveBeats: number,
    motionScore: number,
    perfusionIndex: number,
    clippingRate: number,
    fpsEffective: number,
    warmupComplete: boolean,
  ): SignalQualityResult {
    const reasons: InvalidReason[] = [];

    // --- SNR ---
    const snr = this.computeSNR(filteredBuffer);

    // --- Amplitude stability ---
    const amplitudeStability = this.computeAmplitudeStability(filteredBuffer);

    // --- Periodicity ---
    const periodicityScore = this.computePeriodicity(filteredBuffer, fpsEffective);

    // --- Pulse correlation ---
    const pulseCorrelation = this.computePulseCorrelation(filteredBuffer, rrIntervals, fpsEffective);

    // --- RR regularity ---
    const rrRegularity = this.computeRRRegularity(rrIntervals);

    // --- Band energy ratio ---
    const bandEnergy = this.computeBandEnergy(filteredBuffer, fpsEffective);

    // --- Drift ratio ---
    const signalDriftRatio = this.computeDrift(filteredBuffer);

    // --- Flatline rate ---
    const flatlineRate = this.computeFlatlineRate(filteredBuffer);

    // --- Build score ---
    let score = 0;
    score += Math.min(20, (snr / Q.goodSNR) * 20);
    score += Math.min(12, amplitudeStability * 12);
    score += Math.min(15, periodicityScore * 15);
    score += Math.min(10, pulseCorrelation * 10);
    score += Math.min(12, rrRegularity * 12);
    score += Math.min(8, bandEnergy * 8);
    score += Math.min(8, Math.max(0, 1 - signalDriftRatio) * 8);
    score += Math.min(5, (1 - clippingRate) * 5);
    score += Math.min(5, (1 - flatlineRate) * 5);
    score += Math.min(5, Math.max(0, (1 - motionScore / Q.maxMotionScore)) * 5);

    // Perfusion bonus
    if (perfusionIndex > Q.goodPerfusion) score += 5;
    else if (perfusionIndex > Q.minPerfusion) score += 2;

    score = Math.max(0, Math.min(100, score));

    // --- Collect invalid reasons ---
    if (motionScore > Q.maxMotionScore) reasons.push('excessive_motion');
    if (perfusionIndex < Q.minPerfusion && perfusionIndex > 0) reasons.push('low_perfusion');
    if (clippingRate > 0.1) reasons.push('clipping');
    if (flatlineRate > 0.3) reasons.push('flatline');
    if (fpsEffective < PPG_CONFIG.camera.minOperationalFps) reasons.push('unstable_fps');
    if (consecutiveBeats < 3) reasons.push('insufficient_beats');
    if (rrRegularity < 0.3 && rrIntervals.length >= 4) reasons.push('inconsistent_peak_sets');
    if (!warmupComplete) reasons.push('warmup_not_completed');
    if (snr < Q.minSNR && filteredBuffer.length > 60) reasons.push('signal_too_weak');

    // --- Classify ---
    let level: QualityLevel;
    if (score >= Q.goodThreshold && reasons.length === 0) level = 'GOOD';
    else if (score >= Q.moderateThreshold) level = 'MODERATE';
    else if (score >= Q.poorThreshold) level = 'POOR';
    else level = 'UNUSABLE';

    // Force UNUSABLE if critical reasons
    const critical: InvalidReason[] = ['excessive_motion', 'poor_contact', 'flatline', 'unstable_fps'];
    if (critical.some(r => reasons.includes(r))) {
      if (level === 'GOOD') level = 'MODERATE';
    }

    const confidence = score / 100;

    return {
      level, score, snr, amplitudeStability, periodicityScore,
      pulseCorrelation, rrRegularity, bandEnergy, signalDriftRatio,
      clippingRate, flatlineRate, motionIndex: motionScore,
      perfusionIndex, confidence, invalidReasons: reasons,
    };
  }

  private computeSNR(buf: number[]): number {
    if (buf.length < 30) return 0;
    const recent = buf.slice(-120);
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const range = p90 - p10;
    if (range < 0.1) return 0;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, v) => a + (v - mean) ** 2, 0) / recent.length;
    return range / (Math.sqrt(variance) + 0.1);
  }

  private computeAmplitudeStability(buf: number[]): number {
    if (buf.length < 60) return 0;
    const w1 = buf.slice(-60, -30);
    const w2 = buf.slice(-30);
    const range1 = this.getRange(w1);
    const range2 = this.getRange(w2);
    if (range1 < 0.1 || range2 < 0.1) return 0;
    const ratio = Math.min(range1, range2) / Math.max(range1, range2);
    return ratio;
  }

  private computePeriodicity(buf: number[], fps: number): number {
    if (buf.length < 60) return 0;
    const recent = buf.slice(-Math.min(180, buf.length));
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const centered = recent.map(v => v - mean);
    const energy = centered.reduce((a, v) => a + v * v, 0);
    if (energy < 100) return 0;

    const minLag = Math.max(4, Math.round(fps * 60 / 200));
    const maxLag = Math.min(centered.length - 5, Math.round(fps * 60 / 35));

    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let cross = 0, eA = 0, eB = 0;
      for (let i = lag; i < centered.length; i++) {
        cross += centered[i] * centered[i - lag];
        eA += centered[i] ** 2;
        eB += centered[i - lag] ** 2;
      }
      if (eA === 0 || eB === 0) continue;
      const corr = cross / Math.sqrt(eA * eB);
      if (corr > bestScore) bestScore = corr;
    }
    return Math.max(0, bestScore);
  }

  private computePulseCorrelation(buf: number[], rrIntervals: number[], fps: number): number {
    if (rrIntervals.length < 2 || buf.length < 60) return 0;
    const avgRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const pulseSamples = Math.round((avgRR / 1000) * fps);
    if (pulseSamples < 5 || pulseSamples * 2 > buf.length) return 0;

    const pulse1 = buf.slice(-pulseSamples * 2, -pulseSamples);
    const pulse2 = buf.slice(-pulseSamples);

    const m1 = pulse1.reduce((a, b) => a + b, 0) / pulse1.length;
    const m2 = pulse2.reduce((a, b) => a + b, 0) / pulse2.length;
    let cross = 0, e1 = 0, e2 = 0;
    const len = Math.min(pulse1.length, pulse2.length);
    for (let i = 0; i < len; i++) {
      const a = pulse1[i] - m1;
      const b = pulse2[i] - m2;
      cross += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    if (e1 === 0 || e2 === 0) return 0;
    return Math.max(0, cross / Math.sqrt(e1 * e2));
  }

  private computeRRRegularity(intervals: number[]): number {
    if (intervals.length < 3) return 0;
    const recent = intervals.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, rr) => a + (rr - mean) ** 2, 0) / recent.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    return Math.max(0, Math.min(1, 1 - cv * 3));
  }

  private computeBandEnergy(buf: number[], fps: number): number {
    // Simplified: ratio of energy in cardiac band vs total
    if (buf.length < 60) return 0;
    // Already bandpass-filtered, so most energy should be in-band
    const recent = buf.slice(-120);
    const energy = recent.reduce((a, v) => a + v * v, 0);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const dcEnergy = mean * mean * recent.length;
    const totalE = energy + 0.001;
    const acEnergy = Math.max(0, energy - dcEnergy);
    return Math.min(1, acEnergy / totalE);
  }

  private computeDrift(buf: number[]): number {
    if (buf.length < 60) return 0;
    const recent = buf.slice(-90);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));
    const m1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const m2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const range = this.getRange(recent);
    if (range < 0.1) return 1;
    return Math.min(1, Math.abs(m2 - m1) / range);
  }

  private computeFlatlineRate(buf: number[]): number {
    if (buf.length < S.flatlineWindowFrames) return 0;
    const window = buf.slice(-S.flatlineWindowFrames);
    const range = this.getRange(window);
    return range < S.flatlineThresholdRange ? 1 : 0;
  }

  private getRange(arr: number[]): number {
    if (arr.length === 0) return 0;
    let min = arr[0], max = arr[0];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < min) min = arr[i];
      if (arr[i] > max) max = arr[i];
    }
    return max - min;
  }
}
