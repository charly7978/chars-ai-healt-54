/**
 * Núcleo de análisis por frame: tiles pulsátiles, ROI adaptativa, contacto, presión,
 * extracción multi-fuente y ranking SQI — usable en main thread o en Worker.
 *
 * Etapa B (ROI): servo al centroide + fracción de ventana modulada por EMA de clip alto/bajo
 * (literatura frame-adaptive ROI / meta-ROI frente a saturación y cámara móvil).
 */

import { ContactStateMachine, type ContactMachineState, type ContactScoreInput } from './ContactStateMachine';
import { TilePulsatilityMap, type TileSnapshot } from './TilePulsatilityMap';
import { AdaptiveROIAssembler, type AdaptiveROIResult } from './AdaptiveROIAssembler';
import { PressureProxyEstimator } from './PressureProxyEstimator';
import { SignalExtractionEngine, type CandidateVector } from './SignalExtractionEngine';
import { SignalQualityScorer } from './SignalQualityScorer';
import { RingBuffer } from './RingBuffer';
import type { SourceSQIDetail } from './SignalQualityScorer';

/** ROI agregada para compatibilidad con exports legacy */
export interface ROIMaskResult {
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  coverageRatio: number;
  fingerScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  spatialUniformity: number;
  centerCoverage: number;
  brightness: number;
  brightnessVariance: number;
  validPixelCount: number;
  totalPixelCount: number;
  tileScores: Float64Array;
  debugBbox?: { sx: number; sy: number; ex: number; ey: number };
}

const LABELS = [
  'R',
  'G',
  'RG',
  'CHROM',
  'POS',
  'ICA_APPROX',
  'ROT',
  'W_TILE',
  'R_G',
  'LOG_RG',
  'LOG_R',
  'LOG_G',
  'DIFF_R',
  'ROBUST',
] as const;

export interface FrameAnalysisResult {
  timestamp: number;
  roi: ROIMaskResult;
  contactRaw: ContactMachineState;
  aggregateContactScore: number;
  pressureState: import('./PressureProxyEstimator').PressureState;
  pressurePenalty: number;
  pressureScore: number;
  trimmedMean: { r: number; g: number; b: number };
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  clipHighRatio: number;
  clipLowRatio: number;
  coverageRatio: number;
  fingerScore: number;
  spatialUniformity: number;
  centerCoverage: number;
  brightness: number;
  brightnessVariance: number;
  activeSource: string;
  sourceValue: number;
  allSQI: Record<string, number>;
  sqiDetail: Record<string, SourceSQIDetail>;
  globalMotion: number;
  readinessReason: string;
  perfusionIndex: number;
  redAC: number;
  redDC: number;
  greenAC: number;
  greenDC: number;
  assemblerCoverage: number;
  spatialStabilityROI: number;
  roiBBox: { sx: number; sy: number; ex: number; ey: number };
  /** Tiles con máscara activa tras histéresis */
  activeTileCount: number;
  /** Tiles excluidos explícitamente */
  discardedTileCount: number;
  /** Hasta 32 índices de tiles activos (debug) */
  activeTileSample: number[];
  /** Fs estimada en el núcleo (Δt entre frames); alinear filtro en PPGSignalProcessor */
  sampleRateHint: number;
  /** Intersección máscara tile activa vs frame anterior [0,1] */
  maskIoU: number;
  /** Fracción de píxeles válidos (no saturados/cut-off) en tiles ponderados */
  roiValidPixelRatio: number;
  gridCols: number;
  gridRows: number;
  /**
   * Firma de pose/ángulo respecto al ROI (dedo yema vs base): centroide del tejido en [0,1]²
   * y gradientes normalizados de R (asimetría iluminación/ángulo). Estables solo con contacto.
   */
  poseCentroidNorm: { x: number; y: number };
  /** (R_arriba − R_abajo) / DC — proxy de inclinación vertical del dedo */
  poseRedGradientY: number;
  /** (R_izq − R_der) / DC — proxy de rotación/azimut */
  poseRedGradientX: number;
}

export class FrameAnalysisEngine {
  private readonly tileMap: TilePulsatilityMap;
  private readonly assembler: AdaptiveROIAssembler;
  private readonly contactMachine: ContactStateMachine;
  private readonly pressureEstimator: PressureProxyEstimator;
  private readonly extraction: SignalExtractionEngine;
  private readonly scorer: SignalQualityScorer;

  private readonly tileSnapshots: TileSnapshot[];
  private readonly sourceBuffers = new Map<string, RingBuffer>();
  private activeSource: string = 'RG';
  private lastBestLabel = 'RG';
  private bestStreak = 0;
  private frameCount = 0;

  private redBaseline = 0;
  private greenBaseline = 0;
  private blueBaseline = 0;

  private redAC = 0;
  private redDC = 0;
  private greenAC = 0;
  private greenDC = 0;
  private blueAC = 0;
  private blueDC = 0;

  private metaStabilityEma = 0.5;
  private pulsatilityEma = 0.35;
  private lastRawRedForMeta = 0;
  private prevMaskChangeRate = 0;

  private lumaPrev: Float32Array | null = null;
  private lumaScratch: Float32Array | null = null;
  private readonly lumaW = 24;
  private readonly lumaH = 18;

  /** Servo espacial del ROI hacia el centroide del tejido (meta-ROI; px, referidos al centro del frame) */
  private roiBiasPx = 0;
  private roiBiasPy = 0;

  /** Fs nominal: lo fija WorkerizedFramePipeline/PPG antes de cada processFrame (Etapa A). */
  private estimatedSampleRate = 30;

  private readonly redBuf = new RingBuffer(320);
  private readonly greenBuf = new RingBuffer(320);
  private readonly blueBuf = new RingBuffer(320);

  private lastAllSQI: Record<string, number> = {};

  /** EMA brillo R para umbrales adaptativos por sesión */
  private sessionRedEma = 88;
  private prevStableMask: Uint8Array | null = null;

  /** EMA de clip del frame anterior → ajuste causal de tamaño ROI (sin doble pasada) */
  private clipHighEma = 0;
  private clipLowEma = 0;

  /**
   * PPG contacto dedo + flash: el rojo suele portar más pulsación útil que el verde.
   * Prior determinista (sin aleatoriedad) para ranking y fusión cuando R≫G.
   */
  private flashContactPrior(tr: number, tg: number, label: string): number {
    const rg = tr / Math.max(tg, 1e-3);
    if (rg < 1.035) return 0;
    const t = Math.min(1, (rg - 1.035) / 0.24);
    const redHeavy = new Set([
      'R',
      'RG',
      'LOG_R',
      'LOG_RG',
      'ROT',
      'W_TILE',
      'R_G',
      'DIFF_R',
      'ROBUST',
    ]);
    const chromatic = new Set(['CHROM', 'POS', 'ICA_APPROX']);
    if (redHeavy.has(label)) return 0.055 * t + (rg > 1.1 ? 0.035 : 0);
    if (label === 'LOG_G') return 0.03 * t;
    if (chromatic.has(label)) return 0.028 * t;
    if (label === 'G') return rg > 1.08 ? -0.045 * t : 0;
    return 0;
  }

  /** Combina top-3 fuentes con peso ∝ SQI² para reducir saltos cuando varias son válidas */
  private fusedSourceValue(
    candidates: CandidateVector[],
    sqiByLabel: Record<string, number>,
    tr: number,
    tg: number
  ): number {
    type Labeled = { label: string; s: number };
    const ranked: Labeled[] = [];
    for (const l of LABELS) {
      const raw = sqiByLabel[l];
      if (raw === undefined || raw < 0) continue;
      const s = raw + this.flashContactPrior(tr, tg, l);
      ranked.push({ label: l, s: Math.max(0.001, s) });
    }
    ranked.sort((a, b) => b.s - a.s);
    const top = ranked.slice(0, 3);
    let sumW = 0;
    let acc = 0;
    for (const { label, s } of top) {
      const cand = candidates.find((c) => c.label === label);
      if (!cand) continue;
      const w = s * s;
      sumW += w;
      acc += w * cand.value;
    }
    if (sumW < 1e-12) {
      const fb = candidates.find((c) => c.label === this.activeSource) ?? candidates.find((c) => c.label === 'RG');
      return fb?.value ?? 0;
    }
    return acc / sumW;
  }

  constructor() {
    this.tileMap = new TilePulsatilityMap({ cols: 9, rows: 9, pixelStep: 2 });
    this.assembler = new AdaptiveROIAssembler({
      cols: 9,
      rows: 9,
      topK: 42,
      trimFraction: 0.11,
      tileHysteresisOn: 5,
      tileHysteresisOff: 9,
    });
    this.contactMachine = new ContactStateMachine();
    this.pressureEstimator = new PressureProxyEstimator();
    this.extraction = new SignalExtractionEngine();
    this.scorer = new SignalQualityScorer();

    const n = this.tileMap.tileCount;
    this.tileSnapshots = new Array(n);
    for (let i = 0; i < n; i++) {
      this.tileSnapshots[i] = {
        meanR: 0,
        meanG: 0,
        meanB: 0,
        varR: 0,
        varG: 0,
        varB: 0,
        redRatio: 0,
        redDominance: 0,
        clipHigh: 0,
        clipLow: 0,
        saturationIndex: 0,
        perfusionACDC: 0,
        periodicityProxy: 0,
        temporalStability: 0,
        motionProxy: 0,
        weight: 0,
        spectralTissueScore: 0,
        validPixelRatio: 0,
      };
    }

    for (const l of LABELS) {
      this.sourceBuffers.set(l, new RingBuffer(180));
    }
  }

  setSampleRate(sr: number): void {
    this.estimatedSampleRate = Math.max(15, Math.min(60, sr));
  }

  reset(): void {
    this.tileMap.reset();
    this.assembler.reset();
    this.contactMachine.reset();
    this.pressureEstimator.reset();
    this.extraction.reset();
    this.activeSource = 'RG';
    this.lastBestLabel = 'RG';
    this.bestStreak = 0;
    this.frameCount = 0;
    this.redBaseline = 0;
    this.greenBaseline = 0;
    this.blueBaseline = 0;
    this.redAC = 0;
    this.redDC = 0;
    this.greenAC = 0;
    this.greenDC = 0;
    this.blueAC = 0;
    this.blueDC = 0;
    this.metaStabilityEma = 0.5;
    this.pulsatilityEma = 0.35;
    this.lastRawRedForMeta = 0;
    this.prevMaskChangeRate = 0;
    this.lumaPrev = null;
    this.lumaScratch = null;
    this.roiBiasPx = 0;
    this.roiBiasPy = 0;
    for (const b of this.sourceBuffers.values()) b.clear();
    this.lastAllSQI = {};
    this.sessionRedEma = 88;
    this.prevStableMask = null;
    this.clipHighEma = 0;
    this.clipLowEma = 0;
  }

  processFrame(imageData: ImageData, timestamp: number, motionArtifact: boolean): FrameAnalysisResult {
    const t0 = performance.now();
    this.frameCount++;

    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;

    const globalMotion = this.computeGlobalMotion(data, w, h);

    const metaQ = 0.5 * this.metaStabilityEma + 0.5 * this.pulsatilityEma;
    let roiFrac = Math.max(0.58, Math.min(0.88, 0.63 + 0.2 * metaQ));
    const chPrev = this.clipHighEma;
    const clPrev = this.clipLowEma;
    if (chPrev > 0.07) {
      const shrink = 0.055 + 0.13 * Math.min(1, (chPrev - 0.07) / 0.45);
      roiFrac *= 1 - shrink;
    }
    if (clPrev > 0.12 && chPrev < 0.24) {
      roiFrac *= 1 + 0.038 * Math.min(1, (clPrev - 0.12) / 0.38);
    }
    roiFrac = Math.max(0.52, Math.min(0.88, roiFrac));
    const roiSize = Math.min(w, h) * roiFrac;
    const roiInt = Math.floor(roiSize);
    const maxShift = Math.min(w, h) * 0.14;
    let sx = Math.floor((w - roiInt) / 2 + this.roiBiasPx);
    let sy = Math.floor((h - roiInt) / 2 + this.roiBiasPy);
    sx = Math.max(0, Math.min(sx, w - roiInt));
    sy = Math.max(0, Math.min(sy, h - roiInt));
    const ex = sx + roiInt;
    const ey = sy + roiInt;

    this.tileMap.processFrame(data, w, h, sx, sy, ex, ey, this.tileSnapshots, globalMotion);

    const assembled = this.assembler.assemble(this.tileSnapshots, w, h, sx, sy, ex, ey);

    const roiW = ex - sx;
    const roiH = ey - sy;
    const errX = (assembled.centroidNorm.x - 0.5) * roiW;
    const errY = (assembled.centroidNorm.y - 0.5) * roiH;
    this.roiBiasPx = this.roiBiasPx * 0.84 + errX * 0.16;
    this.roiBiasPy = this.roiBiasPy * 0.84 + errY * 0.16;
    this.roiBiasPx = Math.max(-maxShift, Math.min(maxShift, this.roiBiasPx));
    this.roiBiasPy = Math.max(-maxShift, Math.min(maxShift, this.roiBiasPy));

    this.sessionRedEma = this.sessionRedEma * 0.985 + assembled.trimmedMean.r * 0.015;

    const nMask = this.tileMap.tileCount;
    let maskIoU = 1;
    if (this.prevStableMask && this.prevStableMask.length === nMask) {
      let inter = 0;
      let uni = 0;
      for (let i = 0; i < nMask; i++) {
        const a = assembled.activeTiles[i] ? 1 : 0;
        const b = this.prevStableMask[i] ? 1 : 0;
        if (a || b) uni++;
        if (a && b) inter++;
      }
      maskIoU = uni > 0 ? inter / uni : 0;
    }
    if (!this.prevStableMask || this.prevStableMask.length !== nMask) {
      this.prevStableMask = new Uint8Array(nMask);
    }
    for (let i = 0; i < nMask; i++) {
      this.prevStableMask[i] = assembled.activeTiles[i] ? 1 : 0;
    }

    let totalClipHi = 0;
    let totalClipLo = 0;
    let totalW = 0;
    let fingerW = 0;
    let activeTiles = 0;
    let discarded = 0;
    const activeTileSample: number[] = [];
    const SAMPLE_CAP = 32;
    for (let i = 0; i < this.tileMap.tileCount; i++) {
      const t = this.tileSnapshots[i]!;
      const wt = t.weight;
      totalClipHi += t.clipHigh * wt;
      totalClipLo += t.clipLow * wt;
      totalW += wt;
      if (assembled.activeTiles[i]) {
        fingerW += wt;
        activeTiles++;
        if (activeTileSample.length < SAMPLE_CAP) activeTileSample.push(i);
      }
      if (assembled.discardedTiles[i]) discarded++;
    }
    const clipHighRatio = totalW > 0 ? totalClipHi / totalW : 0;
    const clipLowRatio = totalW > 0 ? totalClipLo / totalW : 0;
    this.clipHighEma = this.clipHighEma * 0.88 + clipHighRatio * 0.12;
    this.clipLowEma = this.clipLowEma * 0.88 + clipLowRatio * 0.12;

    const tr = assembled.trimmedMean.r;
    const poseSig = this.computePoseSignature(assembled, tr, nMask);
    const tg = assembled.trimmedMean.g;
    const tb = assembled.trimmedMean.b;

    const dr =
      this.lastRawRedForMeta > 0 ? Math.abs(tr - this.lastRawRedForMeta) / (this.lastRawRedForMeta + 1e-6) : 0;
    this.pulsatilityEma = this.pulsatilityEma * 0.88 + Math.min(1, dr * 35) * 0.12;
    this.lastRawRedForMeta = tr;

    let maskChanges = 0;
    for (let i = 0; i < this.tileMap.tileCount; i++) {
      if (assembled.discardedTiles[i]) maskChanges++;
    }
    this.prevMaskChangeRate = maskChanges / this.tileMap.tileCount;
    const maskStab = 0.55 + 0.45 * maskIoU;
    this.metaStabilityEma =
      this.metaStabilityEma * 0.9 +
      (1 - Math.min(1, this.prevMaskChangeRate * 2.2)) * 0.1 * maskStab;

    this.updateBaselines(tr, tg, tb);
    this.redBuf.push(tr);
    this.greenBuf.push(tg);
    this.blueBuf.push(tb);
    if (this.redBuf.length >= 36) {
      this.calculateACDC();
    }

    const perfusionIndex = this.greenDC > 0 ? (this.greenAC / this.greenDC) * 100 : (this.redDC > 0 ? (this.redAC / this.redDC) * 100 : 0);
    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;

    const baselineDrift = this.getBaselineDrift();

    const brightness = tr + tg + tb;
    let brightVar = 0;
    let cntB = 0;
    for (let i = 0; i < this.tileMap.tileCount; i++) {
      if (!assembled.activeTiles[i]) continue;
      const t = this.tileSnapshots[i]!;
      const inten = t.meanR + t.meanG + t.meanB;
      brightVar += inten * inten;
      cntB++;
    }
    const brightnessVariance = cntB > 0 ? Math.max(0, brightVar / cntB - (brightness / Math.max(1, cntB)) ** 2) : 0;

    const pressure = this.pressureEstimator.estimate({
      coverageRatio: assembled.coverageEffective,
      clipHighRatio,
      clipLowRatio,
      perfusionIndex: perfusionIndex / 100,
      spatialUniformity: assembled.spatialStability,
      brightness,
      brightnessVariance,
      baselineDrift,
    });

    let specNum = 0;
    let specDen = 0;
    for (let i = 0; i < this.tileMap.tileCount; i++) {
      const t = this.tileSnapshots[i]!;
      if (t.meanR < 10) continue;
      const ww = Math.max(1e-4, t.weight);
      specNum += t.spectralTissueScore * ww;
      specDen += ww;
    }
    const spectralMean = specDen > 1e-6 ? specNum / specDen : 0;
    const tissueInstant = Math.max(
      0,
      Math.min(1, assembled.globalScore * (0.2 + 0.8 * spectralMean))
    );
    const pulsatilityQuality = Math.max(0, Math.min(1, perfusionIndex / 8));
    const dcDriftPenalty = Math.max(0, Math.min(1, baselineDrift * 4));

    let validNum = 0;
    let validDen = 0;
    for (let i = 0; i < this.tileMap.tileCount; i++) {
      const t = this.tileSnapshots[i]!;
      const ww = Math.max(1e-6, t.weight);
      validNum += t.validPixelRatio * ww;
      validDen += ww;
    }
    const roiValidPixelRatio = validDen > 0 ? validNum / validDen : 0;

    const contactInput: ContactScoreInput = {
      coverage: assembled.coverageEffective,
      redDominance: tr - (tg + tb) / 2,
      rgRatio: tg > 1 ? tr / tg : 0,
      rbRatio: tb > 0.75 ? tr / tb : 0,
      clipHigh: clipHighRatio,
      clipLow: clipLowRatio,
      spatialStability: assembled.spatialStability,
      temporalStability: this.metaStabilityEma,
      pulsatilityQuality,
      dcDriftPenalty,
      pressureProxy: pressure.score,
      tissueInstant,
      highPressure: pressure.state === 'HIGH_PRESSURE',
      tileSpectralMean: spectralMean,
    };

    const contactOut = this.contactMachine.update(contactInput);

    const candidates = this.extraction.extract(
      tr,
      tg,
      tb,
      { r: this.redBaseline, g: this.greenBaseline, b: this.blueBaseline },
      redPI,
      greenPI,
      tr,
      tg,
      tb
    );

    const sqiDetail: Record<string, SourceSQIDetail> = {};
    const allSQI: Record<string, number> = {};

    for (const c of candidates) {
      const buf = this.sourceBuffers.get(c.label);
      if (!buf) continue;
      buf.push(c.value);
    }

    // Score ALL sources EVERY frame (V2: no skip; ~0.1ms for 14 labels is negligible)
    {
      let best = this.activeSource;
      let bestScore = -1;
      for (const l of LABELS) {
        const buf = this.sourceBuffers.get(l)!;
        const d = this.scorer.scoreSource(buf, clipHighRatio, clipLowRatio, motionArtifact, this.estimatedSampleRate);
        sqiDetail[l] = d;
        allSQI[l] = d.sqi;
        const boosted = d.sqi + this.flashContactPrior(tr, tg, l);
        if (boosted > bestScore) {
          bestScore = boosted;
          best = l;
        }
      }
      this.lastAllSQI = { ...allSQI };

      const curRaw = this.scorer.scoreSource(
        this.sourceBuffers.get(this.activeSource)!,
        clipHighRatio,
        clipLowRatio,
        motionArtifact,
        this.estimatedSampleRate
      ).sqi;
      const curBoosted = curRaw + this.flashContactPrior(tr, tg, this.activeSource);

      const rgRatio = tr / Math.max(tg, 1e-3);
      const switchMult = rgRatio > 1.08 ? 1.06 : 1.1;
      const streakNeed = rgRatio > 1.08 ? 5 : 6;

      if (best !== this.activeSource && bestScore > curBoosted * switchMult) {
        if (best === this.lastBestLabel) this.bestStreak++;
        else {
          this.lastBestLabel = best;
          this.bestStreak = 1;
        }
        if (this.bestStreak >= streakNeed) {
          this.activeSource = best;
          this.bestStreak = 0;
        }
      } else {
        this.bestStreak = 0;
      }
    }

    const sqiFusion = allSQI;
    const sourceValue = this.fusedSourceValue(candidates, sqiFusion, tr, tg);

    const fingerScore = assembled.globalScore;
    const spatialUniformity = assembled.spatialStability;
    const centerCoverage = activeTiles / Math.max(1, this.tileMap.tileCount);

    const tileScores = new Float64Array(this.tileMap.tileCount);
    for (let i = 0; i < this.tileMap.tileCount; i++) tileScores[i] = this.tileSnapshots[i]!.weight;

    const roi: ROIMaskResult = {
      rawRed: tr,
      rawGreen: tg,
      rawBlue: tb,
      coverageRatio: assembled.coverageEffective,
      fingerScore,
      clipHighRatio,
      clipLowRatio,
      spatialUniformity,
      centerCoverage,
      brightness,
      brightnessVariance,
      validPixelCount: Math.floor(
        roiValidPixelRatio * assembled.coverageEffective * (ex - sx) * (ey - sy)
      ),
      totalPixelCount: (ex - sx) * (ey - sy),
      tileScores,
    };

    let readinessReason = 'ok';
    if (contactOut.state === 'NO_FINGER' || contactOut.state === 'ACQUIRING') readinessReason = 'contact_not_ready';
    else if (contactOut.state === 'SATURATED') readinessReason = 'saturated';
    else if (contactOut.state === 'LOW_PERFUSION') readinessReason = 'low_perfusion';
    else if (contactOut.state === 'EXCESS_PRESSURE') readinessReason = 'excess_pressure';
    else if (clipHighRatio > 0.35) readinessReason = 'clipping';

    return {
      timestamp,
      roi,
      contactRaw: contactOut.state,
      aggregateContactScore: contactOut.aggregateScore,
      pressureState: pressure.state,
      pressurePenalty: pressure.penalty,
      pressureScore: pressure.score,
      trimmedMean: { r: tr, g: tg, b: tb },
      rawRed: tr,
      rawGreen: tg,
      rawBlue: tb,
      clipHighRatio,
      clipLowRatio,
      coverageRatio: assembled.coverageEffective,
      fingerScore,
      spatialUniformity,
      centerCoverage,
      brightness,
      brightnessVariance,
      activeSource: this.activeSource,
      sourceValue,
      allSQI,
      sqiDetail,
      globalMotion,
      readinessReason,
      perfusionIndex,
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      assemblerCoverage: assembled.coverageEffective,
      spatialStabilityROI: assembled.spatialStability,
      roiBBox: assembled.bbox,
      activeTileCount: activeTiles,
      discardedTileCount: discarded,
      activeTileSample,
      sampleRateHint: this.estimatedSampleRate,
      maskIoU,
      roiValidPixelRatio,
      gridCols: this.tileMap.cols,
      gridRows: this.tileMap.rows,
      poseCentroidNorm: poseSig.poseCentroidNorm,
      poseRedGradientY: poseSig.poseRedGradientY,
      poseRedGradientX: poseSig.poseRedGradientX,
    };
  }

  /** Proxy determinista de ángulo dedo/lente/flash a partir del grid de tejido activo */
  private computePoseSignature(
    assembled: AdaptiveROIResult,
    tr: number,
    nMask: number
  ): { poseCentroidNorm: { x: number; y: number }; poseRedGradientY: number; poseRedGradientX: number } {
    const cols = this.tileMap.cols;
    const rows = this.tileMap.rows;
    const denom = tr + 1e-3;
    let tR = 0,
      bR = 0,
      lR = 0,
      rR = 0,
      tW = 0,
      bW = 0,
      lW = 0,
      rW = 0;
    for (let i = 0; i < nMask; i++) {
      if (!assembled.activeTiles[i]) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const t = this.tileSnapshots[i]!;
      const ww = Math.max(1e-6, t.weight);
      const mr = t.meanR;
      if (row < rows / 3) {
        tR += mr * ww;
        tW += ww;
      }
      if (row >= (2 * rows) / 3) {
        bR += mr * ww;
        bW += ww;
      }
      if (col < cols / 3) {
        lR += mr * ww;
        lW += ww;
      }
      if (col >= (2 * cols) / 3) {
        rR += mr * ww;
        rW += ww;
      }
    }
    const poseRedGradientY = tW > 1e-5 && bW > 1e-5 ? (tR / tW - bR / bW) / denom : 0;
    const poseRedGradientX = lW > 1e-5 && rW > 1e-5 ? (lR / lW - rR / rW) / denom : 0;
    return {
      poseCentroidNorm: { x: assembled.centroidNorm.x, y: assembled.centroidNorm.y },
      poseRedGradientY,
      poseRedGradientX,
    };
  }

  private updateBaselines(r: number, g: number, b: number): void {
    if (this.redBaseline === 0) {
      this.redBaseline = r;
      this.greenBaseline = g;
      this.blueBaseline = b;
      return;
    }
    const alpha = 0.035;
    this.redBaseline += (r - this.redBaseline) * alpha;
    this.greenBaseline += (g - this.greenBaseline) * alpha;
    this.blueBaseline += (b - this.blueBaseline) * alpha;
  }

  private getBaselineDrift(): number {
    if (this.redBuf.length < 60) return 0;
    const recent = this.redBuf.mean(40);
    const older = this.redBuf.mean(90);
    return Math.abs(recent - older) / (this.redBaseline + 1);
  }

  private calculateACDC(): void {
    const n = Math.min(200, this.redBuf.length);
    this.redDC = this.redBuf.mean(n);
    this.greenDC = this.greenBuf.mean(n);
    this.blueDC = this.blueBuf.mean(n);
    if (this.redDC < 4) return;

    const ac = (buf: RingBuffer, dc: number) => {
      const p5 = buf.percentile(0.05, n);
      const p95 = buf.percentile(0.95, n);
      const p2p = p95 - p5;
      const rms = Math.sqrt(buf.variance(n)) * Math.sqrt(2);
      return (rms + p2p * 0.5) / 2;
    };

    this.redAC = ac(this.redBuf, this.redDC);
    this.greenAC = ac(this.greenBuf, this.greenDC);
    this.blueAC = ac(this.blueBuf, this.blueDC);
  }

  private computeGlobalMotion(data: Uint8ClampedArray, w: number, h: number): number {
    const lw = this.lumaW;
    const lh = this.lumaH;
    if (!this.lumaPrev) {
      this.lumaPrev = new Float32Array(lw * lh);
      this.fillLumaDownsample(data, w, h, this.lumaPrev, lw, lh);
      return 0;
    }
    if (!this.lumaScratch) this.lumaScratch = new Float32Array(lw * lh);
    this.fillLumaDownsample(data, w, h, this.lumaScratch, lw, lh);
    let sum = 0;
    for (let i = 0; i < lw * lh; i++) {
      sum += Math.abs(this.lumaScratch[i]! - this.lumaPrev[i]!);
    }
    const swap = this.lumaPrev;
    this.lumaPrev = this.lumaScratch;
    this.lumaScratch = swap;
    return Math.min(1, (sum / (lw * lh)) / 32);
  }

  private fillLumaDownsample(
    data: Uint8ClampedArray,
    w: number,
    h: number,
    out: Float32Array,
    lw: number,
    lh: number
  ): void {
    const stepX = w / lw;
    const stepY = h / lh;
    let k = 0;
    for (let gy = 0; gy < lh; gy++) {
      const y = Math.min(h - 1, Math.floor((gy + 0.5) * stepY));
      for (let gx = 0; gx < lw; gx++) {
        const x = Math.min(w - 1, Math.floor((gx + 0.5) * stepX));
        const i = (y * w + x) << 2;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        out[k++] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }
  }
}
