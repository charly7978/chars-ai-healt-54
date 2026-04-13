/**
 * ROI adaptativa — delegada en TilePulsatilityMap + AdaptiveROIAssembler.
 * Mantiene ROIMaskResult para compatibilidad con exports y documentación.
 */

import { TilePulsatilityMap, type TileSnapshot } from './TilePulsatilityMap';
import { AdaptiveROIAssembler } from './AdaptiveROIAssembler';

/** Alias de compatibilidad — métricas detalladas en TileSnapshot */
export type TileMetrics = TileSnapshot;

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
  /** Debug: bbox ROI meta usada */
  debugBbox?: { sx: number; sy: number; ex: number; ey: number };
}

const COLS = 12;
const ROWS = 16;

export class AdaptiveROIMask {
  private readonly tileMap: TilePulsatilityMap;
  private readonly assembler: AdaptiveROIAssembler;
  private readonly snapshots: TileSnapshot[];
  private metaStabilityEma = 0.5;
  private pulsatilityEma = 0.35;
  private lastRawRedForMeta = 0;
  private prevMaskChangeRate = 0;

  constructor() {
    this.tileMap = new TilePulsatilityMap({ cols: COLS, rows: ROWS, pixelStep: 2 });
    this.assembler = new AdaptiveROIAssembler({
      cols: COLS,
      rows: ROWS,
      topK: 28,
      trimFraction: 0.12,
      tileHysteresisOn: 4,
      tileHysteresisOff: 8,
    });
    const n = COLS * ROWS;
    this.snapshots = new Array(n);
    for (let i = 0; i < n; i++) {
      this.snapshots[i] = {
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
      };
    }
  }

  process(imageData: ImageData): ROIMaskResult {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;

    const metaQ = 0.5 * this.metaStabilityEma + 0.5 * this.pulsatilityEma;
    const roiFrac = Math.max(0.58, Math.min(0.88, 0.63 + 0.2 * metaQ));
    const roiSize = Math.min(w, h) * roiFrac;
    const sx = Math.floor((w - roiSize) / 2);
    const sy = Math.floor((h - roiSize) / 2);
    const ex = sx + Math.floor(roiSize);
    const ey = sy + Math.floor(roiSize);

    this.tileMap.processFrame(data, w, h, sx, sy, ex, ey, this.snapshots, 0);
    const assembled = this.assembler.assemble(this.snapshots, w, h, sx, sy, ex, ey);

    let totalClipHi = 0;
    let totalClipLo = 0;
    let totalW = 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      const t = this.snapshots[i]!;
      const wt = t.weight;
      totalClipHi += t.clipHigh * wt;
      totalClipLo += t.clipLow * wt;
      totalW += wt;
    }
    const clipHighRatio = totalW > 0 ? totalClipHi / totalW : 0;
    const clipLowRatio = totalW > 0 ? totalClipLo / totalW : 0;

    const tr = assembled.trimmedMean.r;
    const tg = assembled.trimmedMean.g;
    const tb = assembled.trimmedMean.b;

    const dr =
      this.lastRawRedForMeta > 0 ? Math.abs(tr - this.lastRawRedForMeta) / (this.lastRawRedForMeta + 1e-6) : 0;
    this.pulsatilityEma = this.pulsatilityEma * 0.88 + Math.min(1, dr * 35) * 0.12;
    this.lastRawRedForMeta = tr;

    let changes = 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      if (assembled.discardedTiles[i]) changes++;
    }
    this.prevMaskChangeRate = changes / (COLS * ROWS);
    this.metaStabilityEma = this.metaStabilityEma * 0.9 + (1 - Math.min(1, this.prevMaskChangeRate * 2.2)) * 0.1;

    const tileScores = new Float64Array(COLS * ROWS);
    for (let i = 0; i < COLS * ROWS; i++) tileScores[i] = this.snapshots[i]!.weight;

    const brightness = tr + tg + tb;
    const brightnessVariance = assembled.spatialStability;

    return {
      rawRed: tr,
      rawGreen: tg,
      rawBlue: tb,
      coverageRatio: assembled.coverageEffective,
      fingerScore: assembled.globalScore,
      clipHighRatio,
      clipLowRatio,
      spatialUniformity: assembled.spatialStability,
      centerCoverage: assembled.coverageEffective * 0.85,
      brightness,
      brightnessVariance,
      validPixelCount: Math.floor(assembled.coverageEffective * COLS * ROWS * 48),
      totalPixelCount: (ex - sx) * (ey - sy),
      tileScores,
      debugBbox: { sx, sy, ex, ey },
    };
  }

  reset(): void {
    this.tileMap.reset();
    this.assembler.reset();
    this.metaStabilityEma = 0.5;
    this.pulsatilityEma = 0.35;
    this.lastRawRedForMeta = 0;
    this.prevMaskChangeRate = 0;
  }
}
