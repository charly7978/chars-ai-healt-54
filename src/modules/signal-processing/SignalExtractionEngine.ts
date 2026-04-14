/**
 * Multi-fuente PPG V3: 16 fuentes con absorbancia -log, diferencias temporales, CHROM/POS,
 * Ratio-of-Ratios para SpO2, PCA aproximado, y combinaciones multi-canal.
 * Escala compatible con pipeline existente (~ miles).
 * Basado en literatura 2024 de multi-channel PPG extraction.
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

export interface SpO2Metrics {
  ratioRG: number;
  ratioBG: number;
  ratioRB: number;
  ratioOfRatios: number;
  chromRatio: number;
  estimatedSpO2: number;
  confidence: number;
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
  private readonly adaptiveBaseline = {
    rEWMA: 0,
    gEWMA: 0,
    bEWMA: 0,
  };
  private readonly EWMA_ALPHA = 0.02; // Para adaptive baseline

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
  ): { candidates: CandidateVector[]; spO2: SpO2Metrics } {
    // Actualizar adaptive baseline EWMA
    this.adaptiveBaseline.rEWMA = this.adaptiveBaseline.rEWMA * (1 - this.EWMA_ALPHA) + rawR * this.EWMA_ALPHA;
    this.adaptiveBaseline.gEWMA = this.adaptiveBaseline.gEWMA * (1 - this.EWMA_ALPHA) + rawG * this.EWMA_ALPHA;
    this.adaptiveBaseline.bEWMA = this.adaptiveBaseline.bEWMA * (1 - this.EWMA_ALPHA) + rawB * this.EWMA_ALPHA;
    
    // Usar adaptive baseline si es más estable que base estático
    const adaptiveR = Math.abs(this.adaptiveBaseline.rEWMA - rawR) < Math.abs(base.r - rawR) ? this.adaptiveBaseline.rEWMA : base.r;
    const adaptiveG = Math.abs(this.adaptiveBaseline.gEWMA - rawG) < Math.abs(base.g - rawG) ? this.adaptiveBaseline.gEWMA : base.g;
    const adaptiveB = Math.abs(this.adaptiveBaseline.bEWMA - rawB) < Math.abs(base.b - rawB) ? this.adaptiveBaseline.bEWMA : base.b;
    const eps = 1e-6;
    const rNorm = adaptiveR > 10 ? (rawR - adaptiveR) / adaptiveR : 0;
    const gNorm = adaptiveG > 10 ? (rawG - adaptiveG) / adaptiveG : 0;
    const bNorm = adaptiveB > 10 ? (rawB - adaptiveB) / adaptiveB : 0;

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

    // Nuevas fuentes multi-canal según literatura 2024
    const rbDiff = rP - bP;
    const gbDiff = gP - bP;
    const rgDiff = rP - gP;
    
    // Combinaciones ponderadas de perfusión
    const rbW = redPI > greenPI ? 0.7 : 0.3;
    const gbW = greenPI > redPI ? 0.7 : 0.3;
    const bW = 1 - rW - gW;
    
    // CHROM2 (variante con diferentes pesos)
    const chrom2Val = (2 * rP - gP) - 1.5 * (rP + gP - 2 * bP);
    
    // POS2 (variante optimizada)
    const pos2Val = (gP - bP) + 0.5 * (rP - gP);
    
    // PCA aproximado (primer componente principal)
    const pcaVal = 0.6 * rP + 0.3 * gP + 0.1 * bP;
    
    // Ratio-of-Ratios para SpO2
    const ratioRG = gP > eps ? rP / gP : 0;
    const ratioBG = bP > eps ? gP / bP : 0;
    const ratioRB = bP > eps ? rP / bP : 0;
    const ratioOfRatios = (ratioRG - 1) / (ratioRB - 1 + eps);
    
    // CHROM ratio para SpO2 (según literatura)
    const chromRatio = (3 * rP - 2 * gP) / (1.5 * rP + gP - 1.5 * bP + eps);
    
    // Estimación SpO2 (calibración empírica según literatura)
    const estimatedSpO2 = Math.min(100, Math.max(70, 110 - 25 * ratioOfRatios));
    
    // Calcular perfusionIndex y motionArtifactLevel para confianza
    const perfusionIndex = (redPI + greenPI) / 2;
    const motionArtifactLevel = Math.abs(rbDiff) > 0.03 ? 0.5 : 0.1;
    const spO2Confidence = Math.min(1, (perfusionIndex / 5) * (1 - motionArtifactLevel));

    const candidates: CandidateVector[] = [
      { label: 'R', value: -rP * SCALE },
      { label: 'G', value: -gP * SCALE },
      { label: 'B', value: -bP * SCALE },
      { label: 'RG', value: -(rP * rW + gP * gW) * SCALE },
      { label: 'RB', value: -(rP * rbW + bP * bW) * SCALE },
      { label: 'GB', value: -(gP * gbW + bP * (1 - gbW)) * SCALE },
      { label: 'CHROM', value: chromVal * SCALE * 1.5 },
      { label: 'CHROM2', value: chrom2Val * SCALE * 1.5 },
      { label: 'POS', value: posVal * SCALE * 1.5 },
      { label: 'POS2', value: pos2Val * SCALE * 1.5 },
      { label: 'ICA_APPROX', value: -icaVal * SCALE },
      { label: 'PCA', value: -pcaVal * SCALE },
      { label: 'ROT', value: -(rot - 0.33) * SCALE * 2.2 },
      { label: 'W_TILE', value: -(wRot - 0.33) * SCALE * 2.2 },
      { label: 'R_G', value: -(rP - gP) * SCALE },
      { label: 'RB_G', value: -(rbDiff - gbDiff) * SCALE },
      { label: 'LOG_RG', value: -logRatio * 800 },
      { label: 'LOG_R', value: absorbR * SCALE * 2.2 },
      { label: 'LOG_G', value: absorbG * SCALE * 2.2 },
      { label: 'LOG_B', value: -Math.log((rawB + 18) / (Math.max(12, adaptiveB) + 18)) * SCALE * 2.2 },
      { label: 'DIFF_R', value: diffR * 120 },
      { label: 'ROBUST', value: robust * SCALE },
    ];
    
    const spO2: SpO2Metrics = {
      ratioRG,
      ratioBG,
      ratioRB,
      ratioOfRatios,
      chromRatio,
      estimatedSpO2,
      confidence: spO2Confidence,
    };

    this.prevRawR = rawR;
    this.prevRawG = rawG;
    this.prevRawB = rawB;
    this.hasPrev = true;

    return { candidates, spO2 };
  }

  reset(): void {
    this.rNormBuf.clear();
    this.gNormBuf.clear();
    this.bNormBuf.clear();
    this.prevRawR = 0;
    this.prevRawG = 0;
    this.prevRawB = 0;
    this.hasPrev = false;
    this.adaptiveBaseline.rEWMA = 0;
    this.adaptiveBaseline.gEWMA = 0;
    this.adaptiveBaseline.bEWMA = 0;
  }
  
  /** Obtener baseline adaptativo actual */
  getAdaptiveBaseline(): ExtractionBaselines {
    return {
      r: this.adaptiveBaseline.rEWMA,
      g: this.adaptiveBaseline.gEWMA,
      b: this.adaptiveBaseline.bEWMA,
    };
  }
}
