/**
 * Multi-fuente PPG V4: 22 fuentes con absorbancia -log, diferencias temporales, CHROM/POS,
 * Ratio-of-Ratios para SpO2, PCA real (iteración de potencia), ICA (kurtosis-based),
 * y combinaciones multi-canal.
 *
 * V4 mejoras:
 * - Dual-rate baseline EWMA (fast α=0.08 + slow α=0.012)
 * - PRISM-like adaptive α para CHROM/POS (sub-ventanas con mejor SQI)
 * - PCA real via power iteration sobre covarianza 3x3
 * - ICA via maximización de kurtosis (gradient ascent acumulativo)
 *
 * Escala compatible con pipeline existente (~ miles).
 * Basado en literatura 2024-2025 de multi-channel PPG extraction + PRISM.
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
const EPS = 1e-6;

export class SignalExtractionEngine {
  private rNormBuf = new RingBuffer(64);
  private gNormBuf = new RingBuffer(64);
  private bNormBuf = new RingBuffer(64);
  private prevRawR = 0;
  private prevRawG = 0;
  private prevRawB = 0;
  private hasPrev = false;

  // ═══ DUAL-RATE BASELINE EWMA ═══
  private readonly fastBaseline = { r: 0, g: 0, b: 0 };
  private readonly slowBaseline = { r: 0, g: 0, b: 0 };
  private readonly FAST_ALPHA = 0.08;   // Tracks pressure/position changes quickly
  private readonly SLOW_ALPHA = 0.012;  // Stable DC reference
  private baselineInitialized = false;

  // ═══ PCA STATE (power iteration) ═══
  // Accumulated covariance matrix elements (3x3 symmetric)
  private pcaCov = new Float64Array(6); // [c00, c01, c02, c11, c12, c22]
  private pcaEigenvector = [0.577, 0.577, 0.577]; // Initial uniform
  private pcaCovSamples = 0;
  private readonly PCA_DECAY = 0.995; // Exponential decay for covariance

  // ═══ ICA STATE (kurtosis maximization) ═══
  private icaW = [0.5, -0.866, 0.0]; // Initial projection direction
  private readonly ICA_LR = 0.003; // Gradient ascent learning rate

  // ═══ PRISM-like adaptive alpha tracking ═══
  private lastBestAlphaChrom = 1.0;
  private lastBestAlphaPos = 1.0;

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

    // ═══ PHASE 1: DUAL-RATE BASELINE ═══
    if (!this.baselineInitialized) {
      this.fastBaseline.r = rawR; this.fastBaseline.g = rawG; this.fastBaseline.b = rawB;
      this.slowBaseline.r = rawR; this.slowBaseline.g = rawG; this.slowBaseline.b = rawB;
      this.baselineInitialized = true;
    }

    // Fast EWMA — tracks quick pressure/position changes
    this.fastBaseline.r += (rawR - this.fastBaseline.r) * this.FAST_ALPHA;
    this.fastBaseline.g += (rawG - this.fastBaseline.g) * this.FAST_ALPHA;
    this.fastBaseline.b += (rawB - this.fastBaseline.b) * this.FAST_ALPHA;

    // Slow EWMA — stable DC reference
    this.slowBaseline.r += (rawR - this.slowBaseline.r) * this.SLOW_ALPHA;
    this.slowBaseline.g += (rawG - this.slowBaseline.g) * this.SLOW_ALPHA;
    this.slowBaseline.b += (rawB - this.slowBaseline.b) * this.SLOW_ALPHA;

    // Select best baseline per channel: fast if closer, slow otherwise
    const selR = Math.abs(this.fastBaseline.r - rawR) < Math.abs(this.slowBaseline.r - rawR) * 0.7
      ? this.fastBaseline.r : this.slowBaseline.r;
    const selG = Math.abs(this.fastBaseline.g - rawG) < Math.abs(this.slowBaseline.g - rawG) * 0.7
      ? this.fastBaseline.g : this.slowBaseline.g;
    const selB = Math.abs(this.fastBaseline.b - rawB) < Math.abs(this.slowBaseline.b - rawB) * 0.7
      ? this.fastBaseline.b : this.slowBaseline.b;

    // Normalize: AC/DC
    const rNorm = selR > 10 ? (rawR - selR) / selR : 0;
    const gNorm = selG > 10 ? (rawG - selG) / selG : 0;
    const bNorm = selB > 10 ? (rawB - selB) / selB : 0;

    this.rNormBuf.push(rNorm);
    this.gNormBuf.push(gNorm);
    this.bNormBuf.push(bNorm);

    const clamp = (v: number) => Math.min(0.08, Math.max(-0.08, v));
    const rP = clamp(rNorm);
    const gP = clamp(gNorm);
    const bP = clamp(bNorm);

    // ═══ PHASE 2: PI-WEIGHTED BLEND (RG) ═══
    const piSum = redPI + greenPI;
    let gW = 0.6;
    let rW = 0.4;
    if (piSum > 0) {
      gW = Math.min(0.85, Math.max(0.15, greenPI / piSum));
      rW = 1 - gW;
    }
    if (rawG > 245) { gW *= 0.3; rW = 1 - gW; }
    if (rawR > 245) { rW *= 0.3; gW = 1 - rW; }

    const tot = rawR + rawG + rawB + EPS;
    const rot = rawR / tot;

    // ═══ PHASE 3: CHROM/POS WITH PRISM-LIKE ADAPTIVE α ═══
    let chromVal = 0;
    let posVal = 0;

    if (this.rNormBuf.length > 12) {
      const { alphaChrom, alphaPos } = this.computeAdaptiveAlpha();

      const currXChrom = 3 * rP - 2 * gP;
      const currYChrom = 1.5 * rP + gP - 1.5 * bP;
      chromVal = currXChrom - alphaChrom * currYChrom;

      const currXPos = gP - bP;
      const currYPos = -2 * rP + gP + bP;
      posVal = currXPos + alphaPos * currYPos;
    }

    // ═══ PHASE 4: REAL PCA via Power Iteration ═══
    const pcaVal = this.computePCA(rP, gP, bP);

    // ═══ PHASE 5: ICA via Kurtosis Maximization ═══
    const icaVal = this.computeICA(rP, gP, bP);

    // ═══ PHASE 6: REMAINING CANDIDATES ═══
    const wR = weightedTileR > 0 ? weightedTileR : rawR;
    const wG = weightedTileG > 0 ? weightedTileG : rawG;
    const wB = weightedTileB > 0 ? weightedTileB : rawB;
    const wTot = wR + wG + wB + EPS;
    const wRot = wR / wTot;

    const logRatio = Math.log((wR + 30) / (wG + 30));

    const br = Math.max(12, base.r);
    const bg = Math.max(12, base.g);
    const absorbR = -Math.log((rawR + 18) / (br + 18));
    const absorbG = -Math.log((rawG + 18) / (bg + 18));

    let diffR = 0;
    if (this.hasPrev) {
      diffR = Math.max(-40, Math.min(40, rawR - this.prevRawR));
    }

    const robust = -(rP * 0.42 + gP * 0.58);

    const rbDiff = rP - bP;
    const gbDiff = gP - bP;
    const rbW = redPI > greenPI ? 0.7 : 0.3;
    const gbW = greenPI > redPI ? 0.7 : 0.3;
    const bW = 1 - rW - gW;

    const chrom2Val = (2 * rP - gP) - 1.5 * (rP + gP - 2 * bP);
    const pos2Val = (gP - bP) + 0.5 * (rP - gP);

    // ═══ SpO2 Ratio-of-Ratios ═══
    const ratioRG = gP > EPS ? rP / gP : 0;
    const ratioBG = bP > EPS ? gP / bP : 0;
    const ratioRB = bP > EPS ? rP / bP : 0;
    const ratioOfRatios = (ratioRG - 1) / (ratioRB - 1 + EPS);
    const chromRatio = (3 * rP - 2 * gP) / (1.5 * rP + gP - 1.5 * bP + EPS);
    const estimatedSpO2 = Math.min(100, Math.max(70, 110 - 25 * ratioOfRatios));
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
      { label: 'LOG_B', value: -Math.log((rawB + 18) / (Math.max(12, selB) + 18)) * SCALE * 2.2 },
      { label: 'DIFF_R', value: diffR * 120 },
      { label: 'ROBUST', value: robust * SCALE },
    ];

    const spO2: SpO2Metrics = {
      ratioRG, ratioBG, ratioRB, ratioOfRatios, chromRatio,
      estimatedSpO2, confidence: spO2Confidence,
    };

    this.prevRawR = rawR;
    this.prevRawG = rawG;
    this.prevRawB = rawB;
    this.hasPrev = true;

    return { candidates, spO2 };
  }

  /**
   * PRISM-like adaptive α: divides buffer into sub-windows, computes SQI
   * (autocorrelation in cardiac range) for each, selects the best sub-window
   * to compute α, with interpolation for smoothness.
   */
  private computeAdaptiveAlpha(): { alphaChrom: number; alphaPos: number } {
    const n = this.rNormBuf.length;
    const SUB_WIN = 16;
    const numWins = Math.floor(n / SUB_WIN);

    if (numWins < 1) {
      return { alphaChrom: this.lastBestAlphaChrom, alphaPos: this.lastBestAlphaPos };
    }

    let bestSQI = -1;
    let bestAlphaChrom = 1;
    let bestAlphaPos = 1;

    for (let w = 0; w < numWins; w++) {
      const start = w * SUB_WIN;
      const end = start + SUB_WIN;

      let sxC = 0, syC = 0, sqxC = 0, sqyC = 0;
      let sxP = 0, syP = 0, sqxP = 0, sqyP = 0;

      for (let i = start; i < end; i++) {
        const rn = this.rNormBuf.get(i);
        const gn = this.gNormBuf.get(i);
        const bn = this.bNormBuf.get(i);
        const xc = 3 * rn - 2 * gn;
        const yc = 1.5 * rn + gn - 1.5 * bn;
        sxC += xc; syC += yc; sqxC += xc * xc; sqyC += yc * yc;
        const xp = gn - bn;
        const yp = -2 * rn + gn + bn;
        sxP += xp; syP += yp; sqxP += xp * xp; sqyP += yp * yp;
      }

      const len = SUB_WIN;
      const vxC = sqxC / len - (sxC / len) ** 2;
      const vyC = sqyC / len - (syC / len) ** 2;
      const aC = vyC > EPS ? Math.sqrt(Math.max(0, vxC / vyC)) : 1;
      const vxP = sqxP / len - (sxP / len) ** 2;
      const vyP = sqyP / len - (syP / len) ** 2;
      const aP = vyP > EPS ? Math.sqrt(Math.max(0, vxP / vyP)) : 1;

      // SQI proxy: autocorrelation at lag ~8-15 (cardiac range at ~30fps)
      let sqi = 0;
      const lagStart = Math.max(1, Math.floor(SUB_WIN * 0.3));
      const lagEnd = Math.min(SUB_WIN - 1, Math.floor(SUB_WIN * 0.7));
      for (let lag = lagStart; lag <= lagEnd; lag++) {
        let cross = 0, ea = 0, eb = 0;
        for (let i = start + lag; i < end; i++) {
          const a = this.rNormBuf.get(i);
          const b = this.rNormBuf.get(i - lag);
          cross += a * b;
          ea += a * a;
          eb += b * b;
        }
        const denom = Math.sqrt(ea * eb);
        const ac = denom > EPS ? cross / denom : 0;
        if (ac > sqi) sqi = ac;
      }

      if (sqi > bestSQI) {
        bestSQI = sqi;
        bestAlphaChrom = aC;
        bestAlphaPos = aP;
      }
    }

    // Smooth transition: interpolate with previous best α
    const smooth = 0.7;
    this.lastBestAlphaChrom = this.lastBestAlphaChrom * (1 - smooth) + bestAlphaChrom * smooth;
    this.lastBestAlphaPos = this.lastBestAlphaPos * (1 - smooth) + bestAlphaPos * smooth;

    return { alphaChrom: this.lastBestAlphaChrom, alphaPos: this.lastBestAlphaPos };
  }

  /**
   * Real PCA via power iteration on exponentially-decayed covariance matrix.
   * 3x3 symmetric matrix → dominant eigenvector in 3-5 iterations.
   * Projects current [rP, gP, bP] onto the eigenvector.
   */
  private computePCA(rP: number, gP: number, bP: number): number {
    // Update covariance matrix with exponential decay
    const d = this.PCA_DECAY;
    this.pcaCov[0] = this.pcaCov[0] * d + rP * rP; // c00 = var(R)
    this.pcaCov[1] = this.pcaCov[1] * d + rP * gP; // c01 = cov(R,G)
    this.pcaCov[2] = this.pcaCov[2] * d + rP * bP; // c02 = cov(R,B)
    this.pcaCov[3] = this.pcaCov[3] * d + gP * gP; // c11 = var(G)
    this.pcaCov[4] = this.pcaCov[4] * d + gP * bP; // c12 = cov(G,B)
    this.pcaCov[5] = this.pcaCov[5] * d + bP * bP; // c22 = var(B)
    this.pcaCovSamples++;

    if (this.pcaCovSamples < 16) {
      // Fallback until enough samples
      return 0.577 * rP + 0.577 * gP + 0.577 * bP;
    }

    // Power iteration: 3 iterations (fast convergence for 3D)
    let v0 = this.pcaEigenvector[0];
    let v1 = this.pcaEigenvector[1];
    let v2 = this.pcaEigenvector[2];

    const c = this.pcaCov;
    for (let iter = 0; iter < 3; iter++) {
      // Matrix-vector multiply: Cv
      const w0 = c[0] * v0 + c[1] * v1 + c[2] * v2;
      const w1 = c[1] * v0 + c[3] * v1 + c[4] * v2;
      const w2 = c[2] * v0 + c[4] * v1 + c[5] * v2;
      // Normalize
      const norm = Math.sqrt(w0 * w0 + w1 * w1 + w2 * w2);
      if (norm < EPS) break;
      v0 = w0 / norm;
      v1 = w1 / norm;
      v2 = w2 / norm;
    }

    this.pcaEigenvector[0] = v0;
    this.pcaEigenvector[1] = v1;
    this.pcaEigenvector[2] = v2;

    // Project current sample onto eigenvector
    return v0 * rP + v1 * gP + v2 * bP;
  }

  /**
   * ICA via kurtosis maximization: gradient ascent on |kurtosis| of projected signal.
   * Single step per frame (accumulative). Projection direction converges to
   * the most non-Gaussian (most pulse-like) source.
   */
  private computeICA(rP: number, gP: number, bP: number): number {
    // Current projection
    let w0 = this.icaW[0];
    let w1 = this.icaW[1];
    let w2 = this.icaW[2];

    const y = w0 * rP + w1 * gP + w2 * bP;

    // Gradient of kurtosis approximation: g(y) = tanh(y), g'(y) = 1 - tanh²(y)
    const tanh_y = Math.tanh(y);
    const gPrime = 1 - tanh_y * tanh_y;

    // Newton-like update: w_new = E[x * g(w^T x)] - E[g'(w^T x)] * w
    // Per-sample approximation with learning rate
    const lr = this.ICA_LR;
    w0 += lr * (rP * tanh_y - gPrime * w0);
    w1 += lr * (gP * tanh_y - gPrime * w1);
    w2 += lr * (bP * tanh_y - gPrime * w2);

    // Normalize
    const norm = Math.sqrt(w0 * w0 + w1 * w1 + w2 * w2);
    if (norm > EPS) {
      w0 /= norm;
      w1 /= norm;
      w2 /= norm;
    }

    this.icaW[0] = w0;
    this.icaW[1] = w1;
    this.icaW[2] = w2;

    return y;
  }

  reset(): void {
    this.rNormBuf.clear();
    this.gNormBuf.clear();
    this.bNormBuf.clear();
    this.prevRawR = 0;
    this.prevRawG = 0;
    this.prevRawB = 0;
    this.hasPrev = false;
    this.fastBaseline.r = 0; this.fastBaseline.g = 0; this.fastBaseline.b = 0;
    this.slowBaseline.r = 0; this.slowBaseline.g = 0; this.slowBaseline.b = 0;
    this.baselineInitialized = false;
    this.pcaCov.fill(0);
    this.pcaEigenvector = [0.577, 0.577, 0.577];
    this.pcaCovSamples = 0;
    this.icaW = [0.5, -0.866, 0.0];
    this.lastBestAlphaChrom = 1.0;
    this.lastBestAlphaPos = 1.0;
  }

  /** Obtener baseline adaptativo actual (slow — DC reference) */
  getAdaptiveBaseline(): ExtractionBaselines {
    return {
      r: this.slowBaseline.r,
      g: this.slowBaseline.g,
      b: this.slowBaseline.b,
    };
  }
}
