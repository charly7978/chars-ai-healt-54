/**
 * SIGNAL SOURCE RANKER V3
 * 
 * Multi-source PPG signal candidates with hysteresis:
 * - R, G, B raw channels
 * - RG, RB, GB differences
 * - abs(R), abs(G) (absolute value)
 * - Per-channel SQI with periodicity, SNR, clipping, drift
 * - Hysteresis to prevent rapid switching
 * - Enhanced SQI: spectral SNR, peak prominence, harmonic consistency, zero-crossing rate
 */

import { RingBuffer } from './RingBuffer';

export interface SourceCandidate {
  label: string;
  value: number;
  acdc: number;
  perfusionIndex: number;
  bandPower: number;
  periodicity: number;
  clipPenalty: number;
  driftPenalty: number;
  sqi: number;
}

interface SourceState {
  buffer: RingBuffer;
  sqi: number;
  stableFrames: number;
  dcEWMA: number;
  // Enhanced SQI metrics
  spectralSNR: number;
  peakProminence: number;
  harmonicConsistency: number;
  zeroCrossingRate: number;
}

export class SignalSourceRanker {
  private sources: Map<string, SourceState> = new Map();
  private activeSource = 'RG';
  private lastSwitchFrame = 0;
  private readonly HYSTERESIS_FRAMES = 90; // ~3s at 30fps
  private readonly BUFFER_SIZE = 180;
  private frameCount = 0;

  constructor() {
    const labels = ['R', 'G', 'RG', 'absR', 'absG', 'diffRG'];
    for (const l of labels) {
      this.sources.set(l, {
        buffer: new RingBuffer(this.BUFFER_SIZE),
        sqi: 0,
        stableFrames: 0,
        dcEWMA: 0,
        spectralSNR: 0,
        peakProminence: 0,
        harmonicConsistency: 0,
        zeroCrossingRate: 0,
      });
    }
  }

  /** Generate all candidate signals from raw RGB + baselines */
  update(
    rawR: number, rawG: number, rawB: number,
    baseR: number, baseG: number, baseB: number,
    redPI: number, greenPI: number,
    clipHigh: number, motionArtifact: boolean
  ): { value: number; label: string; allSQI: Record<string, number>; enhancedMetrics: { spectralSNR: number; peakProminence: number; harmonicConsistency: number; zeroCrossingRate: number } } {
    this.frameCount++;
    const eps = 0.01;

    // --- Generate candidates ---
    const rNorm = baseR > 10 ? (baseR - rawR) / baseR : 0;
    const gNorm = baseG > 10 ? (baseG - rawG) / baseG : 0;

    const clamp04 = (v: number) => Math.min(0.04, Math.max(-0.04, v));
    const rPulse = clamp04(rNorm);
    const gPulse = clamp04(gNorm);

    // PI-weighted blend
    const piSum = redPI + greenPI;
    let gW = 0.55, rW = 0.45;
    if (piSum > 0) {
      gW = Math.min(0.8, Math.max(0.25, greenPI / piSum));
      rW = 1 - gW;
    }
    if (rawG > 245) { gW *= 0.4; rW = 1 - gW; }
    if (rawR > 245) { rW *= 0.4; gW = 1 - rW; }

    const candidates: Record<string, number> = {
      R: rPulse * 3200,
      G: gPulse * 3200,
      RG: (rPulse * rW + gPulse * gW) * 3200,
      absR: baseR > 10 ? -Math.log((rawR + eps) / baseR) * 2000 : 0,
      absG: baseG > 10 ? -Math.log((rawG + eps) / baseG) * 2000 : 0,
      diffRG: (rPulse - gPulse) * 2400,
    };

    // Push values to buffers
    for (const [label, val] of Object.entries(candidates)) {
      const src = this.sources.get(label)!;
      src.buffer.push(val);
      src.dcEWMA = src.dcEWMA * 0.97 + val * 0.03;
    }

    // Rank every 30 frames
    const allSQI: Record<string, number> = {};
    if (this.frameCount % 30 === 0) {
      let bestLabel = this.activeSource;
      let bestSQI = -1;

      for (const [label, src] of this.sources) {
        if (src.buffer.length < 60) continue;
        const sqi = this.computeSQI(src, clipHigh, motionArtifact);
        src.sqi = sqi;
        allSQI[label] = sqi;
        if (sqi > bestSQI) {
          bestSQI = sqi;
          bestLabel = label;
        }
      }

      // Switch only if significantly better AND past hysteresis
      const currentSQI = this.sources.get(this.activeSource)?.sqi ?? 0;
      if (bestLabel !== this.activeSource &&
        bestSQI > currentSQI * 1.25 &&
        this.frameCount - this.lastSwitchFrame > this.HYSTERESIS_FRAMES) {
        this.activeSource = bestLabel;
        this.lastSwitchFrame = this.frameCount;
      }
    } else {
      for (const [label, src] of this.sources) {
        allSQI[label] = src.sqi;
      }
    }

    const value = Math.min(80, Math.max(-80, candidates[this.activeSource] ?? candidates['RG']));
    const activeSrc = this.sources.get(this.activeSource);
    const enhancedMetrics = activeSrc ? {
      spectralSNR: activeSrc.spectralSNR,
      peakProminence: activeSrc.peakProminence,
      harmonicConsistency: activeSrc.harmonicConsistency,
      zeroCrossingRate: activeSrc.zeroCrossingRate,
    } : { spectralSNR: 0, peakProminence: 0, harmonicConsistency: 0, zeroCrossingRate: 0 };
    return { value, label: this.activeSource, allSQI, enhancedMetrics };
  }

  private computeSQI(src: SourceState, clipHigh: number, motion: boolean): number {
    const buf = src.buffer;
    const n = Math.min(120, buf.length);
    if (n < 30) return 0;

    // AC/DC ratio
    const p10 = buf.percentile(0.1, n);
    const p90 = buf.percentile(0.9, n);
    const range = p90 - p10;
    if (range < 0.2) return 0;

    const mean = buf.mean(n);
    const v = buf.variance(n);
    const std = Math.sqrt(v);
    const snr = range / (std + 0.1);

    // Periodicity via autocorrelation peak
    let bestAutoCorr = 0;
    let bestLag = 0;
    // Search for peaks in cardiac range: 0.5-3Hz at ~30fps = lags 10-60
    for (let lag = 8; lag <= 60; lag++) {
      const ac = buf.autocorrelation(lag, n);
      if (ac > bestAutoCorr) {
        bestAutoCorr = ac;
        bestLag = lag;
      }
    }

    // Zero-crossing count (too many = noise)
    let zeroCrossings = 0;
    for (let i = 1; i < n; i++) {
      if ((buf.get(buf.length - n + i) - mean) * (buf.get(buf.length - n + i - 1) - mean) < 0) {
        zeroCrossings++;
      }
    }
    const zcRate = zeroCrossings / n;
    const zcPenalty = zcRate > 0.4 ? (zcRate - 0.4) * 30 : 0;

    // Drift penalty
    const firstHalfMean = buf.mean(Math.floor(n / 2));
    const drift = Math.abs(firstHalfMean - mean) / (range + 0.1);
    const driftPenalty = drift * 10;

    // --- Enhanced SQI metrics ---
    
    // Spectral SNR: ratio of signal power in cardiac band to noise in adjacent bands
    const spectralSNR = this.computeSpectralSNR(buf, n, bestLag);
    
    // Peak prominence: how prominent the autocorrelation peak is relative to neighbors
    const peakProminence = this.computePeakProminence(buf, n, bestLag, bestAutoCorr);
    
    // Harmonic consistency: check if harmonics of the fundamental frequency exist
    const harmonicConsistency = this.computeHarmonicConsistency(buf, n, bestLag);
    
    // Update source metrics
    src.spectralSNR = spectralSNR;
    src.peakProminence = peakProminence;
    src.harmonicConsistency = harmonicConsistency;
    src.zeroCrossingRate = zcRate;

    const snrScore = Math.min(30, snr * 10);
    const periodicityScore = bestAutoCorr * 35;
    const spectralScore = Math.min(10, spectralSNR * 5);
    const peakScore = Math.min(8, peakProminence * 8);
    const harmonicScore = Math.min(6, harmonicConsistency * 6);
    const clipPenalty = clipHigh * 25;
    const motionPenalty = motion ? 10 : 0;

    return Math.max(0, 
      snrScore + periodicityScore + spectralScore + peakScore + harmonicScore 
      - clipPenalty - motionPenalty - zcPenalty - driftPenalty
    );
  }

  private computeSpectralSNR(buf: RingBuffer, n: number, peakLag: number): number {
    if (peakLag < 10) return 0;
    
    // Estimate power in cardiac band (around the peak)
    const bandWidth = Math.max(2, Math.floor(peakLag * 0.2));
    let signalPower = 0;
    let signalCount = 0;
    
    for (let lag = peakLag - bandWidth; lag <= peakLag + bandWidth; lag++) {
      if (lag >= 1 && lag < n) {
        const ac = buf.autocorrelation(lag, n);
        signalPower += ac * ac;
        signalCount++;
      }
    }
    
    if (signalCount === 0) return 0;
    signalPower /= signalCount;
    
    // Estimate noise power in adjacent non-cardiac bands
    let noisePower = 0;
    let noiseCount = 0;
    
    for (let lag = 1; lag < n; lag++) {
      if (Math.abs(lag - peakLag) > bandWidth * 1.5) {
        const ac = buf.autocorrelation(lag, n);
        noisePower += ac * ac;
        noiseCount++;
      }
    }
    
    if (noiseCount === 0) return signalPower > 0 ? 1 : 0;
    noisePower /= noiseCount;
    
    return noisePower > 0 ? Math.min(3, signalPower / noisePower) : 0;
  }

  private computePeakProminence(buf: RingBuffer, n: number, peakLag: number, peakValue: number): number {
    if (peakLag < 5 || peakLag >= n - 5) return 0;
    
    // Find local minimum before peak
    let minBefore = peakValue;
    for (let lag = Math.max(1, peakLag - 10); lag < peakLag; lag++) {
      const ac = buf.autocorrelation(lag, n);
      if (ac < minBefore) minBefore = ac;
    }
    
    // Find local minimum after peak
    let minAfter = peakValue;
    for (let lag = peakLag + 1; lag <= Math.min(n - 1, peakLag + 10); lag++) {
      const ac = buf.autocorrelation(lag, n);
      if (ac < minAfter) minAfter = ac;
    }
    
    const minNeighbor = Math.min(minBefore, minAfter);
    const prominence = peakValue - minNeighbor;
    
    return Math.max(0, prominence);
  }

  private computeHarmonicConsistency(buf: RingBuffer, n: number, peakLag: number): number {
    if (peakLag < 5) return 0;
    
    // Check for harmonics at 2x and 3x the fundamental frequency
    const harmonics = [2, 3];
    let harmonicScore = 0;
    
    for (const h of harmonics) {
      const harmonicLag = peakLag * h;
      if (harmonicLag < n) {
        const ac = buf.autocorrelation(harmonicLag, n);
        // Harmonic should be weaker but still significant
        if (ac > 0.1) {
          harmonicScore += ac * 0.5;
        }
      }
    }
    
    return Math.min(1, harmonicScore);
  }

  getActiveSource(): string { return this.activeSource; }

  reset(): void {
    for (const src of this.sources.values()) {
      src.buffer.clear();
      src.sqi = 0;
      src.stableFrames = 0;
      src.dcEWMA = 0;
      src.spectralSNR = 0;
      src.peakProminence = 0;
      src.harmonicConsistency = 0;
      src.zeroCrossingRate = 0;
    }
    this.activeSource = 'RG';
    this.lastSwitchFrame = 0;
    this.frameCount = 0;
  }
}
