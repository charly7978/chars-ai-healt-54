/**
 * Mapa de tiles con métricas por celda para ROI dinámico y pulsatility-aware.
 * Grid configurable (p.ej. 12x16). Hot path sin allocations — buffers reutilizados.
 */

export interface TilePulsatilityConfig {
  cols: number;
  rows: number;
  /** Paso de muestreo de píxeles dentro del ROI */
  pixelStep: number;
}

export interface TileSnapshot {
  meanR: number;
  meanG: number;
  meanB: number;
  varR: number;
  varG: number;
  varB: number;
  redRatio: number;
  redDominance: number;
  clipHigh: number;
  clipLow: number;
  saturationIndex: number;
  perfusionACDC: number;
  periodicityProxy: number;
  temporalStability: number;
  motionProxy: number;
  weight: number;
}

const CLIP_HI = 250;
const CLIP_LO = 5;

export class TilePulsatilityMap {
  readonly cols: number;
  readonly rows: number;
  readonly tileCount: number;
  private readonly pixelStep: number;

  private sumR: Float32Array;
  private sumG: Float32Array;
  private sumB: Float32Array;
  private sumR2: Float32Array;
  private sumG2: Float32Array;
  private sumB2: Float32Array;
  private cnt: Int32Array;
  private nClipHi: Int32Array;
  private nClipLo: Int32Array;

  private prevMeanR: Float32Array;
  private prevMeanG: Float32Array;
  private emaPeriodicity: Float32Array;
  private emaWeight: Float32Array;

  constructor(config?: Partial<TilePulsatilityConfig>) {
    this.cols = config?.cols ?? 12;
    this.rows = config?.rows ?? 16;
    this.pixelStep = config?.pixelStep ?? 2;
    this.tileCount = this.cols * this.rows;
    const n = this.tileCount;
    this.sumR = new Float32Array(n);
    this.sumG = new Float32Array(n);
    this.sumB = new Float32Array(n);
    this.sumR2 = new Float32Array(n);
    this.sumG2 = new Float32Array(n);
    this.sumB2 = new Float32Array(n);
    this.cnt = new Int32Array(n);
    this.nClipHi = new Int32Array(n);
    this.nClipLo = new Int32Array(n);
    this.prevMeanR = new Float32Array(n);
    this.prevMeanG = new Float32Array(n);
    this.emaPeriodicity = new Float32Array(n);
    this.emaWeight = new Float32Array(n);
  }

  reset(): void {
    this.sumR.fill(0);
    this.sumG.fill(0);
    this.sumB.fill(0);
    this.sumR2.fill(0);
    this.sumG2.fill(0);
    this.sumB2.fill(0);
    this.cnt.fill(0);
    this.nClipHi.fill(0);
    this.nClipLo.fill(0);
    this.prevMeanR.fill(0);
    this.prevMeanG.fill(0);
    this.emaPeriodicity.fill(0);
    this.emaWeight.fill(0);
  }

  /**
   * Procesa ROI rectangular [sx,sy,ex,ey) sobre ImageData RGBA.
   * Devuelve snapshots por tile en buffer reutilizable `out` (length >= tileCount).
   */
  processFrame(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    out: TileSnapshot[],
    globalMotionHint: number
  ): void {
    const cols = this.cols;
    const rows = this.rows;
    const roiW = ex - sx;
    const roiH = ey - sy;
    if (roiW < 8 || roiH < 8) {
      for (let i = 0; i < this.tileCount; i++) {
        out[i] = this.emptySnapshot();
      }
      return;
    }

    this.sumR.fill(0);
    this.sumG.fill(0);
    this.sumB.fill(0);
    this.sumR2.fill(0);
    this.sumG2.fill(0);
    this.sumB2.fill(0);
    this.cnt.fill(0);
    this.nClipHi.fill(0);
    this.nClipLo.fill(0);

    const step = this.pixelStep;
    for (let y = sy; y < ey; y += step) {
      const row = y * width;
      for (let x = sx; x < ex; x += step) {
        const i = (row + x) << 2;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const tx = Math.min(cols - 1, (((x - sx) * cols) / roiW) | 0);
        const ty = Math.min(rows - 1, (((y - sy) * rows) / roiH) | 0);
        const ti = ty * cols + tx;

        const c = this.cnt[ti] + 1;
        this.cnt[ti] = c;
        this.sumR[ti] += r;
        this.sumG[ti] += g;
        this.sumB[ti] += b;
        this.sumR2[ti] += r * r;
        this.sumG2[ti] += g * g;
        this.sumB2[ti] += b * b;

        const ch = r >= CLIP_HI || g >= CLIP_HI || b >= CLIP_HI;
        const cl = r <= CLIP_LO && g <= CLIP_LO && b <= CLIP_LO;
        if (ch) this.nClipHi[ti]++;
        if (cl) this.nClipLo[ti]++;
      }
    }

    for (let ti = 0; ti < this.tileCount; ti++) {
      const c = this.cnt[ti];
      if (c < 4) {
        out[ti] = this.emptySnapshot();
        continue;
      }

      const meanR = this.sumR[ti] / c;
      const meanG = this.sumG[ti] / c;
      const meanB = this.sumB[ti] / c;
      const vr = Math.max(0, this.sumR2[ti] / c - meanR * meanR);
      const vg = Math.max(0, this.sumG2[ti] / c - meanG * meanG);
      const vb = Math.max(0, this.sumB2[ti] / c - meanB * meanB);
      const tot = meanR + meanG + meanB + 1e-6;
      const redRatio = meanR / tot;
      const redDom = meanR - (meanG + meanB) / 2;
      const clipHigh = this.nClipHi[ti] / c;
      const clipLow = this.nClipLo[ti] / c;
      const sat = Math.max(clipHigh, clipLow);

      const rg = meanG > 1 ? meanR / meanG : 0;
      const acR = Math.sqrt(vr);
      const acG = Math.sqrt(vg);
      const perf = meanR > 8 ? acR / meanR : meanG > 8 ? acG / meanG : 0;

      const dR = this.prevMeanR[ti] > 0 ? Math.abs(meanR - this.prevMeanR[ti]) / this.prevMeanR[ti] : 0;
      const dG = this.prevMeanG[ti] > 0 ? Math.abs(meanG - this.prevMeanG[ti]) / this.prevMeanG[ti] : 0;
      this.prevMeanR[ti] = meanR;
      this.prevMeanG[ti] = meanG;
      const periodicity = Math.min(1, (dR + dG) * 8);
      this.emaPeriodicity[ti] = this.emaPeriodicity[ti] * 0.88 + periodicity * 0.12;

      const chaos = Math.sqrt(vr + vg + vb) / (meanR + meanG + meanB + 1e-6);
      const temporalStab = Math.max(0, Math.min(1, 1 - chaos * 6));

      const gx = (ti % cols) / Math.max(1, cols - 1);
      const gy = (ti / cols) | 0;
      const gyN = rows > 1 ? gy / (rows - 1) : 0.5;
      const dist = Math.sqrt((gx - 0.5) ** 2 + (gyN - 0.5) ** 2);
      const centerPrior = 0.75 + 0.25 * (1 - Math.min(1, dist * 1.25));

      let w =
        perf * 0.42 +
        this.emaPeriodicity[ti] * 0.22 +
        Math.max(0, Math.min(1, redDom / 40)) * 0.12 +
        Math.max(0, Math.min(1, (rg - 1) / 0.5)) * 0.1 +
        temporalStab * 0.1 +
        centerPrior * 0.04;
      w *= Math.max(0.12, 1 - sat * 2.1);
      w *= Math.max(0.15, 1 - clipHigh * 2.4);
      w *= Math.max(0.2, 1 - clipLow * 1.8);
      if (meanR < 18 || meanR > 245) w *= 0.35;
      w *= Math.max(0.35, 1 - globalMotionHint);

      this.emaWeight[ti] = this.emaWeight[ti] * 0.86 + w * 0.14;
      const weight = Math.max(0, this.emaWeight[ti]);

      out[ti] = {
        meanR,
        meanG,
        meanB,
        varR: vr,
        varG: vg,
        varB: vb,
        redRatio,
        redDominance: redDom,
        clipHigh,
        clipLow,
        saturationIndex: sat,
        perfusionACDC: perf,
        periodicityProxy: this.emaPeriodicity[ti],
        temporalStability: temporalStab,
        motionProxy: globalMotionHint,
        weight,
      };
    }
  }

  private emptySnapshot(): TileSnapshot {
    return {
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
