/**
 * MULTI-SOURCE SIGNAL RANKER V3
 * 
 * Generates 6 candidate PPG signals, scores each by multi-layer SQI metrics:
 * - Amplitude utility (AC/DC, perfusion index)
 * - Spectral quality (band power, dominant frequency)
 * - Periodicity (autocorrelation peak)
 * - Temporal stability (drift, continuity)
 * - Spatial coherence (from external input)
 * - Penalties (clipping, motion, pressure/saturation)
 * 
 * Applies winner-take-all with temporal hysteresis and collapse detection.
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
  // Nuevas métricas
  spectralScore: number;
  stabilityScore: number;
  coherenceScore: number;
  pressurePenalty: number;
  motionPenalty: number;
  continuityScore: number;
  totalScore: number;
}

export interface RankingResult {
  bestCandidate: SourceCandidate | null;
  runnerUp: SourceCandidate | null;
  switchDecision: boolean;
  switchReason: string;
  hysteresisMargin: number;
  collapseDetected: boolean;
  allCandidates: SourceCandidate[];
}

interface SourceState {
  buffer: RingBuffer;
  dcEWMA: number;
  sqi: number;
  historyScore: number; // Para continuidad histórica
  stableFrames: number;
}

export class SignalSourceRanker {
  private sources: Map<string, SourceState> = new Map();
  private activeSource = 'RG';
  private lastSwitchFrame = 0;
  private readonly HYSTERESIS_FRAMES = 90; // ~3s at 30fps
  private readonly BUFFER_SIZE = 180;
  private frameCount = 0;
  private collapseDetected = false;
  private collapseScore = 0;
  private readonly COLLAPSE_THRESHOLD = 0.15; // SQI mínimo para evitar collapse

  constructor() {
    const labels = ['R', 'G', 'RG', 'absR', 'absG', 'diffRG'];
    for (const l of labels) {
      this.sources.set(l, {
        buffer: new RingBuffer(this.BUFFER_SIZE),
        dcEWMA: 0,
        sqi: 0,
        historyScore: 0,
        stableFrames: 0,
      });
    }
  }

  /** Generate all candidate signals from raw RGB + baselines */
  update(
    rawR: number, rawG: number, rawB: number,
    baseR: number, baseG: number, baseB: number,
    redPI: number, greenPI: number,
    clipHigh: number, motionArtifact: boolean,
    pressureState: 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE' = 'OPTIMAL_PRESSURE',
    spatialCoherence: number = 0
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
      const allCandidates: SourceCandidate[] = [];

      for (const [label, src] of this.sources) {
        if (src.buffer.length < 60) continue;
        const candidate = this.computeCandidate(label, src, clipHigh, motionArtifact, pressureState, spatialCoherence);
        src.sqi = candidate.totalScore;
        allSQI[label] = candidate.totalScore;
        allCandidates.push(candidate);
        
        if (candidate.totalScore > bestSQI) {
          bestSQI = candidate.totalScore;
          bestLabel = label;
        }
      }

      // Collapse detection: si el mejor candidato tiene SQI muy bajo
      if (bestSQI < this.COLLAPSE_THRESHOLD) {
        this.collapseScore++;
        if (this.collapseScore > 10) {
          this.collapseDetected = true;
        }
      } else {
        this.collapseScore = Math.max(0, this.collapseScore - 1);
        if (this.collapseScore === 0) {
          this.collapseDetected = false;
        }
      }

      // Switch only if significantly better AND past hysteresis
      const currentSQI = this.sources.get(this.activeSource)?.sqi ?? 0;
      const hysteresisMargin = bestSQI > 0 ? (bestSQI - currentSQI) / bestSQI : 0;
      
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

  private computeCandidate(
    label: string,
    src: SourceState,
    clipHigh: number,
    motion: boolean,
    pressureState: 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE',
    spatialCoherence: number
  ): SourceCandidate {
    const buf = src.buffer;
    const n = Math.min(120, buf.length);
    if (n < 30) {
      return {
        label, value: 0, acdc: 0, perfusionIndex: 0, bandPower: 0,
        periodicity: 0, clipPenalty: 0, driftPenalty: 0, sqi: 0,
        spectralScore: 0, stabilityScore: 0, coherenceScore: 0,
        pressurePenalty: 0, motionPenalty: 0, continuityScore: 0, totalScore: 0
      };
    }

    // AC/DC ratio
    const p10 = buf.percentile(0.1, n);
    const p90 = buf.percentile(0.9, n);
    const range = p90 - p10;
    const mean = buf.mean(n);
    const acdc = mean > 0 ? range / mean : 0;
    const perfusionIndex = acdc * 100;

    // Periodicity via autocorrelation peak
    let bestAutoCorr = 0;
    for (let lag = 8; lag <= 60; lag++) {
      const ac = buf.autocorrelation(lag, n);
      if (ac > bestAutoCorr) bestAutoCorr = ac;
    }

    // Spectral score (band power approximation)
    const v = buf.variance(n);
    const std = Math.sqrt(v);
    const snr = range / (std + 0.1);
    const spectralScore = Math.min(30, snr * 10) + bestAutoCorr * 35;

    // Stability score (drift penalty)
    const firstHalfMean = buf.mean(Math.floor(n / 2));
    const drift = Math.abs(firstHalfMean - mean) / (range + 0.1);
    const driftPenalty = drift * 10;
    const stabilityScore = Math.max(0, 30 - driftPenalty);

    // Coherence score (from external input)
    const coherenceScore = spatialCoherence * 20;

    // Pressure penalty
    let pressurePenalty = 0;
    if (pressureState === 'HIGH_PRESSURE') pressurePenalty = 15;
    else if (pressureState === 'LOW_PRESSURE') pressurePenalty = 5;

    // Motion penalty
    const motionPenalty = motion ? 10 : 0;

    // Clip penalty
    const clipPenalty = clipHigh * 25;

    // Continuity score (historical)
    src.historyScore = src.historyScore * 0.9 + (src.sqi > 0 ? 1 : 0) * 0.1;
    const continuityScore = src.historyScore * 15;

    // Total score
    const totalScore = Math.max(0,
      spectralScore * 0.35 +
      stabilityScore * 0.25 +
      coherenceScore * 0.15 +
      continuityScore * 0.15 -
      clipPenalty -
      motionPenalty -
      pressurePenalty
    );

    return {
      label,
      value: buf.get(buf.length - 1),
      acdc,
      perfusionIndex,
      bandPower: v,
      periodicity: bestAutoCorr,
      clipPenalty,
      driftPenalty,
      sqi: totalScore,
      spectralScore,
      stabilityScore,
      coherenceScore,
      pressurePenalty,
      motionPenalty,
      continuityScore,
      totalScore
    };
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
