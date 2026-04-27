/**
 * Fábrica de candidatos ópticos + fusión ponderada con inercia temporal.
 * No es winner-take-all: ensemble normalizado con colapso detectable.
 */

import { RingBuffer } from './RingBuffer';
import type { FusedSignalMeta } from './pipeline-types';
import { normalizedCrossCorrLag } from './SpectralFusionSupport';

interface SourceState {
  buffer: RingBuffer;
  sqi: number;
  lastScore: number;
}

export interface FusionUpdateInput {
  rawR: number;
  rawG: number;
  rawB: number;
  baseR: number;
  baseG: number;
  baseB: number;
  redPI: number;
  greenPI: number;
  clipHigh: number;
  motionArtifact: boolean;
  pressureState: 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE';
  spatialCoherence: number;
  /** Señal de referencia previa para continuidad temporal */
  prevFused: number;
  /** Calidad espectral global ventana [0..1] */
  spectralQuality01?: number;
}

export interface FusionOutput {
  fusedValue: number;
  primaryLabel: string;
  allSQI: Record<string, number>;
  weights: Record<string, number>;
  meta: FusedSignalMeta;
}

const LABELS = [
  'G',
  'R',
  'RG',
  'absG',
  'absR',
  'diffRG',
  'dG',
  'bandG',
  // POS (Plane Orthogonal to Skin, Wang 2017): proyección invariante a
  // iluminación. Estado del arte para señales débiles según los papers
  // 2025-2026 (POS-SSA, DeepPerfusion). En finger-PPG con flash, captura
  // el componente cardíaco residual incluso con perfusión <0.5%.
  'POS',
] as const;

export type FusionLabel = (typeof LABELS)[number];

export class SignalFusionEngine {
  private sources = new Map<string, SourceState>();
  private weightEwma = new Map<string, number>();
  private frameCount = 0;
  private readonly bufSize = 200;
  private emaFastG = 0;
  private emaSlowG = 0;
  private lastFusion = 0;
  // Buffers de POS (R/G/B normalizados) para calcular std en ventana corta.
  private posXs = new RingBuffer(60);
  private posYs = new RingBuffer(60);

  constructor() {
    for (const l of LABELS) {
      this.sources.set(l, { buffer: new RingBuffer(this.bufSize), sqi: 0, lastScore: 0 });
      this.weightEwma.set(l, 1 / LABELS.length);
    }
  }

  reset(): void {
    for (const s of this.sources.values()) {
      s.buffer.clear();
      s.sqi = 0;
      s.lastScore = 0;
    }
    for (const l of LABELS) this.weightEwma.set(l, 1 / LABELS.length);
    this.frameCount = 0;
    this.emaFastG = 0;
    this.emaSlowG = 0;
    this.lastFusion = 0;
    this.posXs.clear();
    this.posYs.clear();
  }

  update(inp: FusionUpdateInput): FusionOutput {
    this.frameCount++;
    const eps = 0.01;
    const {
      rawR,
      rawG,
      rawB,
      baseR,
      baseG,
      baseB,
      redPI,
      greenPI,
      clipHigh,
      motionArtifact,
      pressureState,
      spatialCoherence,
      prevFused,
      spectralQuality01,
    } = inp;

    const rNorm = baseR > 10 ? (baseR - rawR) / baseR : 0;
    const gNorm = baseG > 10 ? (baseG - rawG) / baseG : 0;
    // Clamp protector para outliers extremos por motion, no para señal real.
    // PPG normal: 0.5-3% de modulación; perfusión alta: 5-8%; clamp ±10%
    // permite 2σ de la población sin perder potencia. Antes ±4% decapitaba
    // los picos sistólicos en sujetos con buena perfusión.
    const clampPct = (v: number) => Math.min(0.10, Math.max(-0.10, v));
    const rPulse = clampPct(rNorm);
    const gPulse = clampPct(gNorm);

    const piSum = redPI + greenPI;
    let gW = 0.55,
      rW = 0.45;
    if (piSum > 0) {
      gW = Math.min(0.8, Math.max(0.25, greenPI / piSum));
      rW = 1 - gW;
    }
    if (rawG > 245) {
      gW *= 0.4;
      rW = 1 - gW;
    }
    if (rawR > 245) {
      rW *= 0.4;
      gW = 1 - rW;
    }

    const rg = (rPulse * rW + gPulse * gW) * 3200;
    // POS (Wang 2017): C = (Rn, Gn, Bn) normalizado por DC. Xs = R−G,
    // Ys = R + G − 2B, luego combinar Xs − α·Ys donde α = std(Xs)/std(Ys).
    // En finger-PPG con flash, el azul es muy débil → Bn ≈ 0 y POS ≈ Xs−αYs
    // se reduce a una combinación adaptativa R-G. Aporta ortogonalidad al
    // ruido de iluminación residual.
    const bNorm = baseB > 10 ? (baseB - rawB) / baseB : 0;
    const xs = rNorm - gNorm;
    const ys = rNorm + gNorm - 2 * bNorm;
    this.posXs.push(xs);
    this.posYs.push(ys);
    let posValue = 0;
    if (this.posXs.length >= 30) {
      const stdX = Math.sqrt(this.posXs.variance(60));
      const stdY = Math.sqrt(this.posYs.variance(60));
      const alpha = stdY > 1e-9 ? stdX / stdY : 1;
      posValue = (xs - alpha * ys) * 3200;
    }

    const cand: Record<string, number> = {
      R: rPulse * 3200,
      G: gPulse * 3200,
      RG: rg,
      absR: baseR > 10 ? -Math.log((rawR + eps) / baseR) * 2000 : 0,
      absG: baseG > 10 ? -Math.log((rawG + eps) / baseG) * 2000 : 0,
      diffRG: (rPulse - gPulse) * 2400,
      dG: 0,
      bandG: 0,
      POS: posValue,
    };

    const gLast = this.sources.get('G')?.buffer.length ? this.sources.get('G')!.buffer.latest() : gPulse * 3200;
    this.emaFastG = this.emaFastG === 0 ? gLast : this.emaFastG * 0.7 + gLast * 0.3;
    this.emaSlowG = this.emaSlowG === 0 ? gLast : this.emaSlowG * 0.94 + gLast * 0.06;
    cand.dG = (this.emaFastG - this.emaSlowG) * 50;
    cand.bandG = gLast - this.emaSlowG;

    for (const l of LABELS) {
      this.sources.get(l)!.buffer.push(cand[l]);
    }

    const allSQI: Record<string, number> = {};
    const scores: Record<string, number> = {};
    let collapse = true;

    for (const l of LABELS) {
      const st = this.sources.get(l)!;
      const sc = st.buffer.length >= 50 ? this.scoreSource(st, clipHigh, motionArtifact, pressureState, spatialCoherence) : 0;
      st.sqi = sc;
      st.lastScore = sc;
      allSQI[l] = sc;
      scores[l] = sc;
      if (sc > 0.12) collapse = false;
    }

    const domLab = LABELS.slice().sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))[0];
    const refBuf = this.sources.get(domLab)!.buffer;
    const pairwiseLag: Record<string, number> = {};
    const coherenceBySource: Record<string, number> = {};
    const lagPenaltyBySource: Record<string, number> = {};
    let phaseQacc = 0;
    let phaseQn = 0;
    for (const l of LABELS) {
      if (l === domLab) {
        pairwiseLag[l] = 0;
        coherenceBySource[l] = 1;
        lagPenaltyBySource[l] = 0;
        phaseQacc += 1;
        phaseQn++;
        continue;
      }
      const tgt = this.sources.get(l)!.buffer;
      const n = Math.min(80, Math.min(refBuf.length, tgt.length));
      if (n < 36) {
        pairwiseLag[l] = 0;
        coherenceBySource[l] = 0.45;
        lagPenaltyBySource[l] = 0.2;
        scores[l] *= 0.88;
      } else {
        const { lag, ncc } = normalizedCrossCorrLag(refBuf, tgt, n, 12);
        pairwiseLag[l] = lag;
        coherenceBySource[l] = ncc;
        const lp = Math.min(1, Math.abs(lag) / 11) * (1.05 - Math.min(1, ncc));
        lagPenaltyBySource[l] = lp;
        scores[l] *= Math.max(0.08, 1 - 0.52 * lp);
        phaseQacc += Math.max(0, Math.min(1, ncc * (1 - lp)));
        phaseQn++;
      }
    }

    const specQ = typeof spectralQuality01 === 'number' && isFinite(spectralQuality01) ? spectralQuality01 : 0.5;
    for (const l of LABELS) {
      const coh = coherenceBySource[l] ?? 0.5;
      scores[l] *= 0.28 + 0.72 * Math.max(0.15, specQ) * (0.38 + 0.62 * coh);
    }

    const temp = 0.09;
    let sumExp = 0;
    const rawW: Record<string, number> = {};
    for (const l of LABELS) {
      const v = Math.exp(scores[l] / temp);
      rawW[l] = v;
      sumExp += v;
    }
    const ideal = new Map<string, number>();
    for (const l of LABELS) ideal.set(l, sumExp > 1e-12 ? rawW[l] / sumExp : 1 / LABELS.length);

    const inertia = 0.82;
    for (const l of LABELS) {
      const prev = this.weightEwma.get(l) ?? 0;
      const next = prev * inertia + (ideal.get(l) ?? 0) * (1 - inertia);
      this.weightEwma.set(l, next);
    }
    let wSum = 0;
    for (const l of LABELS) wSum += this.weightEwma.get(l) ?? 0;
    const weights: Record<string, number> = {};
    for (const l of LABELS) weights[l] = wSum > 1e-9 ? (this.weightEwma.get(l) ?? 0) / wSum : 1 / LABELS.length;

    let fused = 0;
    for (const l of LABELS) fused += cand[l] * (weights[l] ?? 0);

    const cont = Math.max(0, 1 - Math.min(1, Math.abs(fused - prevFused) / (Math.abs(prevFused) + 8)));
    fused = fused * (0.88 + 0.12 * cont);
    this.lastFusion = fused;

    const dom = LABELS.slice().sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))[0];
    const phaseAlignmentQuality = phaseQn > 0 ? phaseQacc / phaseQn : 0;
    const sorted = LABELS.map((l) => scores[l] ?? 0).sort((a, b) => b - a);
    const sourceAgreement =
      sorted.length >= 2 && sorted[0] > 1e-6 ? Math.max(0, Math.min(1, 1 - sorted[1] / sorted[0])) : 0.35;
    const collapseReason = collapse
      ? specQ < 0.22
        ? 'spectral_low'
        : phaseAlignmentQuality < 0.28
          ? 'phase_misalign'
          : 'low_source_scores'
      : '';

    const meta: FusedSignalMeta = {
      dominantSources: [dom],
      weights,
      collapse,
      ensembleValue: fused,
      dominantSource: dom,
      sourceAgreement,
      phaseAlignmentQuality,
      fusionCollapseReason: collapseReason,
      pairwiseLagSamples: pairwiseLag,
      coherenceBySource,
      lagPenaltyBySource,
      dominantSourcePersistence: this.weightEwma.get(dom) ?? 0,
    };

    return {
      fusedValue: fused,
      primaryLabel: dom,
      allSQI,
      weights,
      meta,
    };
  }

  private scoreSource(
    st: SourceState,
    clipHigh: number,
    motion: boolean,
    pressureState: 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE',
    spatialCoherence: number
  ): number {
    const buf = st.buffer;
    const n = Math.min(120, buf.length);
    if (n < 40) return 0;

    const p10 = buf.percentile(0.1, n);
    const p90 = buf.percentile(0.9, n);
    const range = p90 - p10;
    const mean = buf.mean(n);
    const acdc = mean !== 0 ? range / Math.abs(mean) : 0;
    let bestAc = 0;
    for (let lag = 6; lag <= 55; lag++) {
      const ac = buf.autocorrelation(lag, n);
      if (ac > bestAc) bestAc = ac;
    }
    const v = buf.variance(n);
    const std = Math.sqrt(v);
    const snr = range / (std + 0.12);
    const first = buf.mean(Math.floor(n / 2));
    const drift = Math.abs(first - mean) / (range + 0.12);

    let pressurePen = 0;
    if (pressureState === 'HIGH_PRESSURE') pressurePen = 0.22;
    else if (pressureState === 'LOW_PRESSURE') pressurePen = 0.08;

    const motionPen = motion ? 0.18 : 0;
    const clipPen = Math.min(0.55, clipHigh * 1.1);

    const raw =
      Math.min(1, bestAc) * 0.34 +
      Math.min(1, snr / 14) * 0.22 +
      Math.min(1, acdc * 40) * 0.14 +
      spatialCoherence * 0.12 +
      Math.max(0, 1 - drift * 6) * 0.12 -
      clipPen * 0.35 -
      motionPen -
      pressurePen;

    return Math.max(0, Math.min(1, raw));
  }
}
