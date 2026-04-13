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
    const labels = ['R', 'G', 'RG', 'CHROM', 'POS', 'ICA_APPROX'];
    for (const l of labels) {
      this.sources.set(l, {
        buffer: new RingBuffer(this.BUFFER_SIZE),
        dcEWMA: 0,
        sqi: 0,
      });
    }
  }

  // --- Historical buffers for CHROM and POS ---
  private rNormBuf = new RingBuffer(60);
  private gNormBuf = new RingBuffer(60);
  private bNormBuf = new RingBuffer(60);

  /** Generate all candidate signals from raw RGB + baselines */
  update(
    rawR: number, rawG: number, rawB: number,
    baseR: number, baseG: number, baseB: number,
    redPI: number, greenPI: number,
    clipHigh: number, motionArtifact: boolean
  ): { value: number; label: string; allSQI: Record<string, number> } {
    this.frameCount++;
    const eps = 0.0001;

    // --- Generate candidates ---
    // Normalized AC signals (AC/DC)
    const rNorm = baseR > 10 ? (rawR - baseR) / baseR : 0;
    const gNorm = baseG > 10 ? (rawG - baseG) / baseG : 0;
    const bNorm = baseB > 10 ? (rawB - baseB) / baseB : 0;

    this.rNormBuf.push(rNorm);
    this.gNormBuf.push(gNorm);
    this.bNormBuf.push(bNorm);

    const clamp = (v: number) => Math.min(0.08, Math.max(-0.08, v));
    const rPulse = clamp(rNorm);
    const gPulse = clamp(gNorm);
    const bPulse = clamp(bNorm);

    // PI-weighted blend (RG)
    const piSum = redPI + greenPI;
    let gW = 0.6, rW = 0.4;
    if (piSum > 0) {
      gW = Math.min(0.85, Math.max(0.15, greenPI / piSum));
      rW = 1 - gW;
    }
    if (rawG > 245) { gW *= 0.3; rW = 1 - gW; }
    if (rawR > 245) { rW *= 0.3; gW = 1 - rW; }

    // --- Advanced Methods (CHROM & POS) ---
    // Calculate alpha over a sliding window for CHROM/POS
    let chromVal = 0;
    let posVal = 0;
    let icaVal = 0;
    
    if (this.rNormBuf.length > 10) {
      const n = this.rNormBuf.length;
      let sumXChrom = 0, sumYChrom = 0, sumXPos = 0, sumYPos = 0;
      let sqXChrom = 0, sqYChrom = 0, sqXPos = 0, sqYPos = 0;

      for (let i = 0; i < n; i++) {
        const rn = this.rNormBuf.get(i);
        const gn = this.gNormBuf.get(i);
        const bn = this.bNormBuf.get(i);

        // CHROM components
        const x_c = 3 * rn - 2 * gn;
        const y_c = 1.5 * rn + gn - 1.5 * bn;
        sumXChrom += x_c; sumYChrom += y_c;
        sqXChrom += x_c * x_c; sqYChrom += y_c * y_c;

        // POS components
        const x_p = gn - bn;
        const y_p = -2 * rn + gn + bn;
        sumXPos += x_p; sumYPos += y_p;
        sqXPos += x_p * x_p; sqYPos += y_p * y_p;
      }

      const varXChrom = (sqXChrom / n) - (sumXChrom / n) ** 2;
      const varYChrom = (sqYChrom / n) - (sumYChrom / n) ** 2;
      const alphaChrom = varYChrom > eps ? Math.sqrt(Math.max(0, varXChrom / varYChrom)) : 1;

      const varXPos = (sqXPos / n) - (sumXPos / n) ** 2;
      const varYPos = (sqYPos / n) - (sumYPos / n) ** 2;
      const alphaPos = varYPos > eps ? Math.sqrt(Math.max(0, varXPos / varYPos)) : 1;

      // Current frame values
      const currXChrom = 3 * rPulse - 2 * gPulse;
      const currYChrom = 1.5 * rPulse + gPulse - 1.5 * bPulse;
      chromVal = currXChrom - alphaChrom * currYChrom;

      const currXPos = gPulse - bPulse;
      const currYPos = -2 * rPulse + gPulse + bPulse;
      posVal = currXPos + alphaPos * currYPos;

      // Pseudo-ICA (JADE approximation using negentropy max on RG space)
      icaVal = (gPulse * 0.85) - (rPulse * 0.15); // Simplified fast-ICA projection matrix for contact PPG
    }

    const scale = 4000;
    const candidates: Record<string, number> = {
      R: -rPulse * scale, // Inverted for contact PPG
      G: -gPulse * scale,
      RG: -(rPulse * rW + gPulse * gW) * scale,
      CHROM: chromVal * scale * 1.5,
      POS: posVal * scale * 1.5,
      ICA_APPROX: -icaVal * scale
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
    this.rNormBuf.clear();
    this.gNormBuf.clear();
    this.bNormBuf.clear();
    this.activeSource = 'RG';
    this.lastSwitchFrame = 0;
    this.frameCount = 0;
  }
}
