/**
 * Banco de ROIs candidatas sobre región central (rejilla configurable).
 * Métricas por ROI sin asignaciones por píxel en el bucle caliente más de lo necesario.
 */

import type { ROIQualityRow } from './pipeline-types';

export interface MultiROIConfig {
  gridRows: number;
  gridCols: number;
  /** Fracción del ancho/alto útil (0.72 = excluye bordes ~14% cada lado) */
  innerFraction: number;
  clipHigh: number;
  clipLow: number;
  sampleStep: number;
}

const DEFAULT: MultiROIConfig = {
  gridRows: 5,
  gridCols: 5,
  innerFraction: 0.72,
  clipHigh: 250,
  clipLow: 5,
  sampleStep: 2,
};

export interface ROICellMetrics {
  id: number;
  row: number;
  col: number;
  meanR: number;
  meanG: number;
  meanB: number;
  stdR: number;
  stdG: number;
  stdB: number;
  dcLevel: number;
  acdcProxy: number;
  clipRatio: number;
  saturationRatio: number;
  validFraction: number;
}

export interface MultiROIFrameResult {
  cells: ROICellMetrics[];
  globalClipHigh: number;
  globalClipLow: number;
  sampledPixels: number;
  innerRect: { sx: number; sy: number; w: number; h: number };
}

/** Elipse normalizada (cx,cy)=(0.5,0.5); radios fracción de ROI */
function ellipseWeight(px: number, py: number, sx: number, sy: number, w: number, h: number): number {
  const nx = (px - sx - w * 0.5) / (w * 0.5 + 1e-6);
  const ny = (py - sy - h * 0.5) / (h * 0.5 + 1e-6);
  const d = nx * nx + ny * ny;
  return d <= 1.05 ? 1 : 0.35;
}

export class MultiROIExtractor {
  private cfg: MultiROIConfig;
  private sumR: Float64Array;
  private sumG: Float64Array;
  private sumB: Float64Array;
  private sumR2: Float64Array;
  private sumG2: Float64Array;
  private sumB2: Float64Array;
  private cnt: Int32Array;
  private clipH: Int32Array;
  private clipL: Int32Array;
  private nCells: number;

  constructor(cfg: Partial<MultiROIConfig> = {}) {
    this.cfg = { ...DEFAULT, ...cfg };
    this.nCells = this.cfg.gridRows * this.cfg.gridCols;
    this.sumR = new Float64Array(this.nCells);
    this.sumG = new Float64Array(this.nCells);
    this.sumB = new Float64Array(this.nCells);
    this.sumR2 = new Float64Array(this.nCells);
    this.sumG2 = new Float64Array(this.nCells);
    this.sumB2 = new Float64Array(this.nCells);
    this.cnt = new Int32Array(this.nCells);
    this.clipH = new Int32Array(this.nCells);
    this.clipL = new Int32Array(this.nCells);
  }

  process(imageData: ImageData): MultiROIFrameResult {
    const { gridRows, gridCols, innerFraction, clipHigh, clipLow, sampleStep } = this.cfg;
    const data = imageData.data;
    const iw = imageData.width;
    const ih = imageData.height;

    this.sumR.fill(0);
    this.sumG.fill(0);
    this.sumB.fill(0);
    this.sumR2.fill(0);
    this.sumG2.fill(0);
    this.sumB2.fill(0);
    this.cnt.fill(0);
    this.clipH.fill(0);
    this.clipL.fill(0);

    const roiW = Math.floor(iw * innerFraction);
    const roiH = Math.floor(ih * innerFraction);
    const sx = Math.floor((iw - roiW) / 2);
    const sy = Math.floor((ih - roiH) / 2);

    let sampled = 0;
    let gClipH = 0;
    let gClipL = 0;

    for (let y = sy; y < sy + roiH; y += sampleStep) {
      const rowOff = y * iw;
      for (let x = sx; x < sx + roiW; x += sampleStep) {
        const wE = ellipseWeight(x, y, sx, sy, roiW, roiH);
        if (wE < 0.5) continue;

        const i = (rowOff + x) << 2;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const tx = Math.min(gridCols - 1, ((x - sx) * gridCols) / roiW);
        const ty = Math.min(gridRows - 1, ((y - sy) * gridRows) / roiH);
        const ci = (ty | 0) * gridCols + (tx | 0);

        sampled++;
        const ch = r >= clipHigh || g >= clipHigh || b >= clipHigh;
        const cl = r <= clipLow && g <= clipLow && b <= clipLow;
        if (ch) {
          this.clipH[ci]++;
          gClipH++;
        }
        if (cl) {
          this.clipL[ci]++;
          gClipL++;
        }
        if (!ch && !cl) {
          this.sumR[ci] += r;
          this.sumG[ci] += g;
          this.sumB[ci] += b;
          this.sumR2[ci] += r * r;
          this.sumG2[ci] += g * g;
          this.sumB2[ci] += b * b;
        }
        this.cnt[ci]++;
      }
    }

    const cells: ROICellMetrics[] = [];
    for (let id = 0; id < this.nCells; id++) {
      const row = Math.floor(id / gridCols);
      const col = id % gridCols;
      const c = this.cnt[id];
      const v = c - this.clipH[id] - this.clipL[id];
      const validF = c > 0 ? Math.max(0, v) / c : 0;

      if (v <= 0 || c === 0) {
        cells.push({
          id,
          row,
          col,
          meanR: 0,
          meanG: 0,
          meanB: 0,
          stdR: 0,
          stdG: 0,
          stdB: 0,
          dcLevel: 0,
          acdcProxy: 0,
          clipRatio: c > 0 ? this.clipH[id] / c : 0,
          saturationRatio: c > 0 ? (this.clipH[id] + this.clipL[id]) / c : 0,
          validFraction: validF,
        });
        continue;
      }

      const meanR = this.sumR[id] / v;
      const meanG = this.sumG[id] / v;
      const meanB = this.sumB[id] / v;
      const vr = Math.max(0, this.sumR2[id] / v - meanR * meanR);
      const vg = Math.max(0, this.sumG2[id] / v - meanG * meanG);
      const vb = Math.max(0, this.sumB2[id] / v - meanB * meanB);
      const stdR = Math.sqrt(vr);
      const stdG = Math.sqrt(vg);
      const stdB = Math.sqrt(vb);
      const dc = (meanR + meanG + meanB) / 3;
      const ac = (stdR + stdG + stdB) / 3;
      const acdcProxy = dc > 1e-3 ? ac / dc : 0;

      cells.push({
        id,
        row,
        col,
        meanR,
        meanG,
        meanB,
        stdR,
        stdG,
        stdB,
        dcLevel: dc,
        acdcProxy,
        clipRatio: this.clipH[id] / c,
        saturationRatio: (this.clipH[id] + this.clipL[id]) / c,
        validFraction: validF,
      });
    }

    return {
      cells,
      globalClipHigh: sampled > 0 ? gClipH / sampled : 0,
      globalClipLow: sampled > 0 ? gClipL / sampled : 0,
      sampledPixels: sampled,
      innerRect: { sx, sy, w: roiW, h: roiH },
    };
  }

  /** Fusión ponderada RGB de las filas rankeadas externamente */
  static fuseWeightedRGB(cells: ROICellMetrics[], weights: Float64Array): { r: number; g: number; b: number } {
    let wr = 0,
      wg = 0,
      wb = 0,
      ws = 0;
    for (let i = 0; i < cells.length && i < weights.length; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      wr += cells[i].meanR * w;
      wg += cells[i].meanG * w;
      wb += cells[i].meanB * w;
      ws += w;
    }
    if (ws <= 1e-9) return { r: 0, g: 0, b: 0 };
    return { r: wr / ws, g: wg / ws, b: wb / ws };
  }

  static rowsToQualityRows(cells: ROICellMetrics[], scores: Float64Array, reasons: (string | undefined)[]): ROIQualityRow[] {
    const out: ROIQualityRow[] = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      out.push({
        id: c.id,
        row: c.row,
        col: c.col,
        score: scores[i],
        meanR: c.meanR,
        meanG: c.meanG,
        meanB: c.meanB,
        clipRatio: c.clipRatio,
        acdcProxy: c.acdcProxy,
        rejectedReason: reasons[i],
      });
    }
    return out;
  }
}
