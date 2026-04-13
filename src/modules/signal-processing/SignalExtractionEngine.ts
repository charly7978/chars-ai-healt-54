/**
 * Multi-fuente PPG: medias normalizadas, absorbancia -log, diferencias temporales, CHROM/POS.
 * Escala compatible con pipeline existente (~ miles).
 */

import { RingBuffer } from './RingBuffer';

export interface ExtractionBaselines {
  r: number;
  g: number;
  b: number;
}

export interface CandidateVector {
  label: string;
  value: number;
}

const SCALE = 4000;

export class SignalExtractionEngine {
  private rNormBuf = new RingBuffer(64);
  private gNormBuf = new RingBuffer(64);
  private bNormBuf = new RingBuffer(64);
  private prevRawR = 0;
  private prevRawG = 0;
  private prevRawB = 0;
  private hasPrev = false;

  extract(
    rawR: number,
    rawG: number,
    rawB: number,
    base: ExtractionBaselines,
    redPI: number,
    greenPI: number,
    weightedTileR: number,
    weightedTileG: number,
    weightedTileB: number
  ): CandidateVector[] {
    const eps = 1e-6;
    const rNorm = base.r > 10 ? (rawR - base.r) / base.r : 0;
    const gNorm = base.g > 10 ? (rawG - base.g) / base.g : 0;
    const bNorm = base.b > 10 ? (rawB - base.b) / base.b : 0;

    this.rNormBuf.push(rNorm);
    this.gNormBuf.push(gNorm);
    this.bNormBuf.push(bNorm);

    const clamp = (v: number) => Math.min(0.08, Math.max(-0.08, v));
    const rP = clamp(rNorm);
    const gP = clamp(gNorm);
    const bP = clamp(bNorm);

    const piSum = redPI + greenPI;
    let gW = 0.6;
    let rW = 0.4;
    if (piSum > 0) {
      gW = Math.min(0.85, Math.max(0.15, greenPI / piSum));
      rW = 1 - gW;
    }
    if (rawG > 245) {
      gW *= 0.3;
      rW = 1 - gW;
    }
    if (rawR > 245) {
      rW *= 0.3;
      gW = 1 - rW;
    }

    const tot = rawR + rawG + rawB + eps;
    const rot = rawR / tot;

    let chromVal = 0;
    let posVal = 0;
    let icaVal = 0;

    if (this.rNormBuf.length > 12) {
      const n = this.rNormBuf.length;
      let sumXChrom = 0;
      let sumYChrom = 0;
      let sqXChrom = 0;
      let sqYChrom = 0;
      let sumXPos = 0;
      let sumYPos = 0;
      let sqXPos = 0;
      let sqYPos = 0;

      for (let i = 0; i < n; i++) {
        const rn = this.rNormBuf.get(i);
        const gn = this.gNormBuf.get(i);
        const bn = this.bNormBuf.get(i);
        const x_c = 3 * rn - 2 * gn;
        const y_c = 1.5 * rn + gn - 1.5 * bn;
        sumXChrom += x_c;
        sumYChrom += y_c;
        sqXChrom += x_c * x_c;
        sqYChrom += y_c * y_c;
        const x_p = gn - bn;
        const y_p = -2 * rn + gn + bn;
        sumXPos += x_p;
        sumYPos += y_p;
        sqXPos += x_p * x_p;
        sqYPos += y_p * y_p;
      }

      const varXChrom = sqXChrom / n - (sumXChrom / n) ** 2;
      const varYChrom = sqYChrom / n - (sumYChrom / n) ** 2;
      const alphaChrom = varYChrom > eps ? Math.sqrt(Math.max(0, varXChrom / varYChrom)) : 1;
      const varXPos = sqXPos / n - (sumXPos / n) ** 2;
      const varYPos = sqYPos / n - (sumYPos / n) ** 2;
      const alphaPos = varYPos > eps ? Math.sqrt(Math.max(0, varXPos / varYPos)) : 1;

      const currXChrom = 3 * rP - 2 * gP;
      const currYChrom = 1.5 * rP + gP - 1.5 * bP;
      chromVal = currXChrom - alphaChrom * currYChrom;

      const currXPos = gP - bP;
      const currYPos = -2 * rP + gP + bP;
      posVal = currXPos + alphaPos * currYPos;

      icaVal = gP * 0.85 - rP * 0.15;
    }

    const wR = weightedTileR > 0 ? weightedTileR : rawR;
    const wG = weightedTileG > 0 ? weightedTileG : rawG;
    const wB = weightedTileB > 0 ? weightedTileB : rawB;
    const wTot = wR + wG + wB + eps;
    const wRot = wR / wTot;

    const logRatio = Math.log((wR + 30) / (wG + 30));

    /** Absorbancia tipo Beer–Lambert sobre DC local (estable) */
    const br = Math.max(12, base.r);
    const bg = Math.max(12, base.g);
    const absorbR = -Math.log((rawR + 18) / (br + 18));
    const absorbG = -Math.log((rawG + 18) / (bg + 18));

    /** Diferencia temporal acotada (pulso frame-a-frame) */
    let diffR = 0;
    if (this.hasPrev) {
      diffR = Math.max(-40, Math.min(40, rawR - this.prevRawR));
    }

    const robust = -(rP * 0.42 + gP * 0.58);

    const candidates: CandidateVector[] = [
      { label: 'R', value: -rP * SCALE },
      { label: 'G', value: -gP * SCALE },
      { label: 'RG', value: -(rP * rW + gP * gW) * SCALE },
      { label: 'CHROM', value: chromVal * SCALE * 1.5 },
      { label: 'POS', value: posVal * SCALE * 1.5 },
      { label: 'ICA_APPROX', value: -icaVal * SCALE },
      { label: 'ROT', value: -(rot - 0.33) * SCALE * 2.2 },
      { label: 'W_TILE', value: -(wRot - 0.33) * SCALE * 2.2 },
      { label: 'R_G', value: -(rP - gP) * SCALE },
      { label: 'LOG_RG', value: -logRatio * 800 },
      { label: 'LOG_R', value: absorbR * SCALE * 2.2 },
      { label: 'LOG_G', value: absorbG * SCALE * 2.2 },
      { label: 'DIFF_R', value: diffR * 120 },
      { label: 'ROBUST', value: robust * SCALE },
    ];

    this.prevRawR = rawR;
    this.prevRawG = rawG;
    this.prevRawB = rawB;
    this.hasPrev = true;

    return candidates;
  }

  reset(): void {
    this.rNormBuf.clear();
    this.gNormBuf.clear();
    this.bNormBuf.clear();
    this.prevRawR = 0;
    this.prevRawG = 0;
    this.prevRawB = 0;
    this.hasPrev = false;
  }
}
