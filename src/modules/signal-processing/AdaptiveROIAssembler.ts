/**
 * Ensambla ROI dinámica desde TilePulsatilityMap: elipse suavizada, top-k con histéresis,
 * weighted trimmed mean, estabilidad temporal de bbox/tiles activos.
 */

import type { TileSnapshot } from './TilePulsatilityMap';

export interface AdaptiveROIResult {
  bbox: { sx: number; sy: number; ex: number; ey: number };
  /** Peso elíptico por tile (0..1) alineado con grid */
  ellipseMask: Float32Array;
  activeTiles: Uint8Array;
  discardedTiles: Uint8Array;
  /** Media recortada ponderada R,G,B */
  trimmedMean: { r: number; g: number; b: number };
  coverageEffective: number;
  globalScore: number;
  spatialStability: number;
}

export interface AssemblerConfig {
  cols: number;
  rows: number;
  topK: number;
  trimFraction: number;
  /** Histéresis: frames necesarios para añadir/quitar tile activo */
  tileHysteresisOn: number;
  tileHysteresisOff: number;
}

export class AdaptiveROIAssembler {
  readonly cols: number;
  readonly rows: number;
  private readonly topK: number;
  private readonly trimFraction: number;
  private readonly hOn: number;
  private readonly hOff: number;

  private tileOnCount: Int32Array;
  private tileOffCount: Int32Array;
  private stableActive: Uint8Array;
  private prevBbox = { sx: 0, sy: 0, ex: 0, ey: 0 };
  private bboxStableFrames = 0;
  private readonly scratchScores: Float64Array;
  private readonly scratchIdx: Uint16Array;
  private ellipseBuf: Float32Array;

  constructor(config: AssemblerConfig) {
    this.cols = config.cols;
    this.rows = config.rows;
    this.topK = config.topK;
    this.trimFraction = config.trimFraction;
    this.hOn = config.tileHysteresisOn;
    this.hOff = config.tileHysteresisOff;
    const n = this.cols * this.rows;
    this.tileOnCount = new Int32Array(n);
    this.tileOffCount = new Int32Array(n);
    this.stableActive = new Uint8Array(n);
    this.scratchScores = new Float64Array(n);
    this.scratchIdx = new Uint16Array(n);
    this.ellipseBuf = new Float32Array(n);
  }

  reset(): void {
    this.tileOnCount.fill(0);
    this.tileOffCount.fill(0);
    this.stableActive.fill(0);
    this.prevBbox = { sx: 0, sy: 0, ex: 0, ey: 0 };
    this.bboxStableFrames = 0;
  }

  assemble(
    tiles: TileSnapshot[],
    frameW: number,
    frameH: number,
    roiSx: number,
    roiSy: number,
    roiEx: number,
    roiEy: number
  ): AdaptiveROIResult {
    const cols = this.cols;
    const rows = this.rows;
    const n = cols * rows;
    const roiW = roiEx - roiSx;
    const roiH = roiEy - roiSy;

    let cx = 0;
    let cy = 0;
    let wSum = 0;
    for (let i = 0; i < n; i++) {
      const w = tiles[i]?.weight ?? 0;
      if (w <= 0) continue;
      const gx = i % cols;
      const gy = (i / cols) | 0;
      cx += (gx + 0.5) * w;
      cy += (gy + 0.5) * w;
      wSum += w;
    }
    if (wSum > 1e-6) {
      cx /= wSum;
      cy /= wSum;
    } else {
      cx = cols * 0.5;
      cy = rows * 0.5;
    }

    const a = cols * 0.48;
    const b = rows * 0.48;
    for (let i = 0; i < n; i++) {
      const gx = (i % cols) + 0.5;
      const gy = ((i / cols) | 0) + 0.5;
      const nx = (gx - cx) / a;
      const ny = (gy - cy) / b;
      const el = nx * nx + ny * ny;
      this.ellipseBuf[i] = el <= 1 ? Math.max(0.15, 1 - el) : Math.max(0, 1 - (el - 1) * 2);
    }

    for (let i = 0; i < n; i++) {
      this.scratchScores[i] = (tiles[i]?.weight ?? 0) * this.ellipseBuf[i]!;
    }

    for (let i = 0; i < n; i++) this.scratchIdx[i] = i;
    // Orden parcial: selection sort top-K por score (n pequeño <= 192)
    for (let i = 0; i < n; i++) {
      let maxI = i;
      for (let j = i + 1; j < n; j++) {
        if (this.scratchScores[this.scratchIdx[j]!]! > this.scratchScores[this.scratchIdx[maxI]!]!) maxI = j;
      }
      if (maxI !== i) {
        const t = this.scratchIdx[i]!;
        this.scratchIdx[i] = this.scratchIdx[maxI]!;
        this.scratchIdx[maxI] = t;
      }
    }

    const k = Math.min(this.topK, n);
    const candidate = new Uint8Array(n);
    for (let i = 0; i < k; i++) {
      candidate[this.scratchIdx[i]!] = 1;
    }

    for (let i = 0; i < n; i++) {
      if (candidate[i]) {
        this.tileOnCount[i]++;
        this.tileOffCount[i] = 0;
      } else {
        this.tileOffCount[i]++;
        this.tileOnCount[i] = 0;
      }
      if (this.stableActive[i]) {
        if (this.tileOffCount[i] >= this.hOff) {
          this.stableActive[i] = 0;
        }
      } else {
        if (this.tileOnCount[i] >= this.hOn) {
          this.stableActive[i] = 1;
        }
      }
    }

    let minX = cols;
    let minY = rows;
    let maxX = 0;
    let maxY = 0;
    let activeW = 0;
    for (let i = 0; i < n; i++) {
      if (!this.stableActive[i]) continue;
      const gx = i % cols;
      const gy = (i / cols) | 0;
      minX = Math.min(minX, gx);
      minY = Math.min(minY, gy);
      maxX = Math.max(maxX, gx);
      maxY = Math.max(maxY, gy);
      activeW += tiles[i]?.weight ?? 0;
    }

    const coverageEffective = (activeW / Math.max(1e-6, wSum)) * (k / n);
    const spatialStab =
      this.prevBbox.ex > 0
        ? 1 -
          Math.min(
            1,
            (Math.abs(this.prevBbox.sx - roiSx) +
              Math.abs(this.prevBbox.sy - roiSy) +
              Math.abs(this.prevBbox.ex - roiEx) +
              Math.abs(this.prevBbox.ey - roiEy)) /
              (frameW + frameH + 1e-6)
          )
        : 0.5;
    if (spatialStab > 0.92) this.bboxStableFrames++;
    else this.bboxStableFrames = Math.max(0, this.bboxStableFrames - 2);
    this.prevBbox = { sx: roiSx, sy: roiSy, ex: roiEx, ey: roiEy };

    const tw = roiW / cols;
    const th = roiH / rows;
    const bbox = {
      sx: Math.round(roiSx + minX * tw),
      sy: Math.round(roiSy + minY * th),
      ex: Math.round(roiSx + (maxX + 1) * tw),
      ey: Math.round(roiSy + (maxY + 1) * th),
    };

    // Weighted trimmed mean on active tile means
    const valsR: number[] = [];
    const valsG: number[] = [];
    const valsB: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!this.stableActive[i]) continue;
      const t = tiles[i];
      if (!t || t.meanR < 1) continue;
      const wt = t.weight * this.ellipseBuf[i]!;
      valsR.push(t.meanR);
      valsG.push(t.meanG);
      valsB.push(t.meanB);
      wts.push(wt);
    }

    const trimmedMean = this.trimmedWeightedMean3(valsR, valsG, valsB, wts);

    const discarded = new Uint8Array(n);
    const active = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      active[i] = this.stableActive[i];
      discarded[i] = this.stableActive[i] ? 0 : candidate[i] ? 1 : 0;
    }

    const globalScore =
      trimmedMean.r > 0
        ? Math.max(0, Math.min(1, (activeW / n) * 0.55 + spatialStab * 0.25 + (this.bboxStableFrames / 120) * 0.2))
        : 0;

    return {
      bbox,
      ellipseMask: this.ellipseBuf,
      activeTiles: active,
      discardedTiles: discarded,
      trimmedMean,
      coverageEffective,
      globalScore,
      spatialStability: spatialStab,
    };
  }

  private trimmedWeightedMean3(r: number[], g: number[], b: number[], w: number[]): { r: number; g: number; b: number } {
    const m = r.length;
    if (m === 0) return { r: 0, g: 0, b: 0 };
    const idx: number[] = new Array(m);
    for (let i = 0; i < m; i++) idx[i] = i;
    idx.sort((a, b) => r[a]! - r[b]!);
    const drop = Math.floor(m * this.trimFraction);
    let s0 = drop;
    let s1 = m - drop;
    if (s1 <= s0) {
      s0 = 0;
      s1 = m;
    }
    let wr = 0;
    let wg = 0;
    let wb = 0;
    let wt = 0;
    for (let i = s0; i < s1; i++) {
      const j = idx[i]!;
      const ww = w[j]!;
      wr += r[j]! * ww;
      wg += g[j]! * ww;
      wb += b[j]! * ww;
      wt += ww;
    }
    if (wt <= 1e-9) return { r: 0, g: 0, b: 0 };
    return { r: wr / wt, g: wg / wt, b: wb / wt };
  }
}
