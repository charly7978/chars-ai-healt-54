/**
 * MULTI-SOURCE SIGNAL RANKER V2
 * 
 * Generates 6 candidate PPG signals, scores each by SQI metrics,
 * applies winner-take-all with temporal hysteresis.
 * No simulation — pure competitive extraction.
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
  dcEWMA: number;
  sqi: number;
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
        dcEWMA: 0,
        sqi: 0,
      });
    }
  }

  /** Generate all candidate signals from raw RGB + baselines */
  update(
    rawR: number, rawG: number, rawB: number,
    baseR: number, baseG: number, baseB: number,
    redPI: number, greenPI: number,
    clipHigh: number, motionArtifact: boolean
  ): { value: number; label: string; allSQI: Record<string, number> } {
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
    return { value, label: this.activeSource, allSQI };
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
    // Search for peaks in cardiac range: 0.5-3Hz at ~30fps = lags 10-60
    for (let lag = 8; lag <= 60; lag++) {
      const ac = buf.autocorrelation(lag, n);
      if (ac > bestAutoCorr) bestAutoCorr = ac;
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

    const snrScore = Math.min(30, snr * 10);
    const periodicityScore = bestAutoCorr * 35;
    const clipPenalty = clipHigh * 25;
    const motionPenalty = motion ? 10 : 0;

    return Math.max(0, snrScore + periodicityScore - clipPenalty - motionPenalty - zcPenalty - driftPenalty);
  }

  getActiveSource(): string { return this.activeSource; }

  reset(): void {
    for (const src of this.sources.values()) {
      src.buffer.clear();
      src.dcEWMA = 0;
      src.sqi = 0;
    }
    this.activeSource = 'RG';
    this.lastSwitchFrame = 0;
    this.frameCount = 0;
  }
}
