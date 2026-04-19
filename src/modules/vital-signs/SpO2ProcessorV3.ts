/**
 * SpO2 PROCESSOR V3 — MULTI-CHANNEL R/G + R/B FUSION
 *
 * Improvements over V2 (preserved as fallback in VitalSignsProcessor):
 *  - Two ratio-of-ratios candidates: R_RG and R_RB
 *      R_RG = (Rac/Rdc) / (Gac/Gdc)   (V2 used only this)
 *      R_RB = (Rac/Rdc) / (Bac/Bdc)
 *    Combined as  R = α·R_RG + (1−α)·R_RB
 *    α defaults to 0.65 (R/G dominates because green tracks pulse better in
 *    smartphone PPG, but blue contributes meaningful chromatic variation).
 *  - Quadratic device calibration with optional Tikhonov regularization
 *    (ridge λ ≥ 1e-3) keeps the inverse stable when calibration points
 *    cluster near a single SpO2 value.
 *  - Adaptive blend learning: when the user provides ≥4 calibration points
 *    AND blue channel data is available, α is grid-searched in [0.4, 0.85]
 *    to minimize calibration RMSE.
 *  - Median-of-window R buffer kept (60 frames) for noise rejection.
 *  - Reference: Multi-Channel Ratio-of-Ratios (Banerjee 2021,
 *    arXiv 2107.08528) reports MAE 1.26% vs traditional dual-wavelength.
 */

import { OutputStatus, type SpO2Output } from '../../types/measurement';
import type { SpO2Calibration } from './SpO2ProcessorV2';

interface RatioWindow {
  timestamp: number;
  ratio: number;
  ratioRG: number;
  ratioRB: number;
  isValid: boolean;
}

const CONFIG = {
  MIN_SPO2: 70,
  MAX_SPO2: 100,
  MIN_USER_CALIBRATION_POINTS: 3,
  CALIBRATION_VALIDITY_DAYS: 180,
  MIN_SQI: 0.4,
  MIN_VALID_FRAMES: 10,
  RATIO_BUFFER_SIZE: 60,
  VALID_R_MIN: 0.30,
  VALID_R_MAX: 1.50,
  EMA_ALPHA: 0.15,
  RIDGE_LAMBDA: 1e-3,
  ALPHA_GRID_LO: 0.40,
  ALPHA_GRID_HI: 0.85,
  ALPHA_GRID_STEPS: 19,
};

export interface SpO2ProcessV3Input {
  redAC: number; redDC: number;
  greenAC: number; greenDC: number;
  blueAC?: number; blueDC?: number;
  contactStable: boolean;
  pressureOptimal?: boolean;
  clipHighRatio: number;
  beatCount: number;
  avgBeatSQI: number;
  sourceStability: number;
  timestamp?: number;
}

export class SpO2ProcessorV3 {
  private calibration: SpO2Calibration | null = null;
  private userCalibrationPoints: Array<{ referenceSpO2: number; measuredR: number; ratioRG: number; ratioRB: number }> = [];
  private ratioHistory: RatioWindow[] = [];
  private lastOutput: SpO2Output | null = null;
  private consecutiveValid = 0;
  private consecutiveInvalid = 0;

  /** Blend factor between R_RG (α) and R_RB (1−α). Default 0.65. */
  private alphaRG = 0.65;

  loadDeviceCalibration(profile: SpO2Calibration): void {
    this.calibration = { ...profile, isUserCalibrated: false };
  }

  setBlendAlpha(alpha: number): void {
    this.alphaRG = Math.max(0, Math.min(1, alpha));
  }

  getBlendAlpha(): number { return this.alphaRG; }

  addUserCalibrationPoint(referenceSpO2: number, measuredR: number, ratioRG = 0, ratioRB = 0): void {
    if (referenceSpO2 < 70 || referenceSpO2 > 100 || measuredR < 0.1 || measuredR > 2) return;
    this.userCalibrationPoints.push({ referenceSpO2, measuredR, ratioRG, ratioRB });
    if (this.userCalibrationPoints.length >= CONFIG.MIN_USER_CALIBRATION_POINTS) {
      this.computeUserCalibration();
    }
  }

  /**
   * Solve a 3x3 linear system Ax = b using Cramer's rule (good enough for the
   * tiny systems we build from quadratic regression). Returns null if the
   * matrix is singular under the chosen ridge λ.
   */
  private solve3x3(A: number[][], b: number[]): number[] | null {
    const det3 = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

    const D = det3(A);
    if (Math.abs(D) < 1e-12) return null;

    const colReplace = (col: number) => A.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)));
    const x = [det3(colReplace(0)) / D, det3(colReplace(1)) / D, det3(colReplace(2)) / D];
    return x;
  }

  /**
   * Compute calibration coefficients [A, B, C] for SpO2 = A + B*R + C*R²
   * using ridge regression (least squares + λI). With our 3x3 reduced normal
   * equations, ridge λ adds to the diagonal.
   */
  private fitQuadratic(points: { referenceSpO2: number; measuredR: number }[], lambda: number) {
    const n = points.length;
    let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    let y0 = 0, y1 = 0, y2 = 0;
    for (const p of points) {
      const r = p.measuredR;
      const r2 = r * r;
      s1 += r; s2 += r2; s3 += r2 * r; s4 += r2 * r2;
      y0 += p.referenceSpO2;
      y1 += r * p.referenceSpO2;
      y2 += r2 * p.referenceSpO2;
    }
    const A: number[][] = [
      [s0 + lambda, s1, s2],
      [s1, s2 + lambda, s3],
      [s2, s3, s4 + lambda],
    ];
    const b = [y0, y1, y2];
    const sol = this.solve3x3(A, b);
    return sol ? { A: sol[0], B: sol[1], C: sol[2] } : null;
  }

  private rmse(points: { referenceSpO2: number; measuredR: number }[], coefs: { A: number; B: number; C: number }) {
    let sse = 0;
    for (const p of points) {
      const pred = coefs.A + coefs.B * p.measuredR + coefs.C * p.measuredR * p.measuredR;
      sse += (pred - p.referenceSpO2) ** 2;
    }
    return Math.sqrt(sse / points.length);
  }

  /**
   * Build a calibration model from the accumulated points. If blue-channel
   * ratios are present in ≥2 points, α is grid-searched to minimize RMSE.
   */
  private computeUserCalibration(): void {
    const pts = this.userCalibrationPoints;
    if (pts.length < CONFIG.MIN_USER_CALIBRATION_POINTS) return;
    const hasBlue = pts.filter(p => p.ratioRB > 0).length >= 2;

    let bestAlpha = this.alphaRG;
    let bestCoefs: { A: number; B: number; C: number } | null = null;
    let bestRMSE = Infinity;

    if (hasBlue) {
      // Grid search over α
      for (let i = 0; i < CONFIG.ALPHA_GRID_STEPS; i++) {
        const α = CONFIG.ALPHA_GRID_LO +
          (i / (CONFIG.ALPHA_GRID_STEPS - 1)) * (CONFIG.ALPHA_GRID_HI - CONFIG.ALPHA_GRID_LO);
        const blended = pts.map(p => ({
          referenceSpO2: p.referenceSpO2,
          measuredR: α * (p.ratioRG || p.measuredR) + (1 - α) * (p.ratioRB || p.measuredR),
        }));
        const c = this.fitQuadratic(blended, CONFIG.RIDGE_LAMBDA);
        if (!c) continue;
        const e = this.rmse(blended, c);
        if (e < bestRMSE) { bestRMSE = e; bestCoefs = c; bestAlpha = α; }
      }
    } else {
      const fit = this.fitQuadratic(pts, CONFIG.RIDGE_LAMBDA);
      if (fit) { bestCoefs = fit; bestRMSE = this.rmse(pts, fit); bestAlpha = 1.0; }
    }

    if (!bestCoefs || !isFinite(bestRMSE)) return;

    this.alphaRG = bestAlpha;
    this.calibration = {
      A: bestCoefs.A, B: bestCoefs.B, C: bestCoefs.C,
      validRRange: { min: CONFIG.VALID_R_MIN, max: CONFIG.VALID_R_MAX },
      validSpO2Range: { min: CONFIG.MIN_SPO2, max: CONFIG.MAX_SPO2 },
      deviceModel: 'user_calibrated_v3',
      calibrationDate: Date.now(),
      sampleCount: pts.length,
      rmse: bestRMSE,
      isUserCalibrated: true,
    };
  }

  /** Evaluate quadratic SpO2(R) using current calibration. */
  private evalSpO2(R: number): number {
    if (!this.calibration) return 0;
    const { A, B, C } = this.calibration;
    return A + B * R + C * R * R;
  }

  process(input: SpO2ProcessV3Input): SpO2Output {
    if (!this.calibration) return this.blocked(OutputStatus.NEEDS_CALIBRATION, { reason: 'No calibration available' });

    const ageDays = (Date.now() - this.calibration.calibrationDate) / 86400000;
    if (ageDays > CONFIG.CALIBRATION_VALIDITY_DAYS) {
      return this.blocked(OutputStatus.NEEDS_CALIBRATION, { reason: 'Calibration expired', calibrationAgeDays: ageDays });
    }
    if (!input.contactStable) { this.consecutiveInvalid++; return this.blocked('blocked', { reason: 'Contact not stable' }); }
    if (input.avgBeatSQI < CONFIG.MIN_SQI) { this.consecutiveInvalid++; return this.blocked('blocked', { reason: 'Low SQI', sqi: input.avgBeatSQI }); }
    if (input.clipHighRatio > 0.1) { this.consecutiveInvalid++; return this.blocked('blocked', { reason: 'Saturation clipping', clipHighRatio: input.clipHighRatio }); }

    const eps = 0.001;
    const Rrg = (input.redAC / (input.redDC + eps)) / Math.max(eps, input.greenAC / (input.greenDC + eps));
    const Rrb = (input.blueDC && input.blueAC && input.blueDC > 0)
      ? (input.redAC / (input.redDC + eps)) / Math.max(eps, input.blueAC / (input.blueDC + eps))
      : 0;
    const useBlue = Rrb > 0 && isFinite(Rrb);
    const R = useBlue
      ? this.alphaRG * Rrg + (1 - this.alphaRG) * Rrb
      : Rrg;

    if (R < this.calibration.validRRange.min || R > this.calibration.validRRange.max) {
      this.consecutiveInvalid++;
      return this.blocked('blocked', { reason: 'R ratio out of calibrated range', rawRatio: R, ratioRG: Rrg, ratioRB: Rrb });
    }

    this.ratioHistory.push({
      timestamp: input.timestamp ?? Date.now(),
      ratio: R, ratioRG: Rrg, ratioRB: Rrb, isValid: true,
    });
    if (this.ratioHistory.length > CONFIG.RATIO_BUFFER_SIZE) this.ratioHistory.shift();

    this.consecutiveValid++;
    this.consecutiveInvalid = 0;
    if (this.consecutiveValid < CONFIG.MIN_VALID_FRAMES) {
      return this.blocked('blocked', { reason: 'Initializing', consecutiveValid: this.consecutiveValid });
    }

    const valid = this.ratioHistory.filter(r => r.isValid).map(r => r.ratio);
    if (valid.length < 3) return this.blocked('blocked', { reason: 'Insufficient valid ratios' });

    const Rmed = this.median(valid);
    const raw = this.evalSpO2(Rmed);
    const clamped = Math.max(CONFIG.MIN_SPO2, Math.min(CONFIG.MAX_SPO2, raw));
    const ratioVar = this.std(valid) / Math.max(eps, Rmed);

    let final = clamped;
    if (this.lastOutput?.value && typeof this.lastOutput.value === 'number') {
      final = this.lastOutput.value * (1 - CONFIG.EMA_ALPHA) + clamped * CONFIG.EMA_ALPHA;
    }

    let confidence = 0.5;
    confidence += this.calibration.isUserCalibrated ? 0.2 : 0;
    if (this.calibration.rmse !== undefined && this.calibration.rmse < 3) confidence += 0.15;
    confidence += Math.min(0.15, input.avgBeatSQI * 0.15);
    confidence -= ratioVar * 0.3;
    confidence += useBlue ? 0.05 : 0;
    confidence = Math.max(0, Math.min(1, confidence));

    this.lastOutput = {
      value: Math.round(final),
      unit: '%',
      confidence,
      status: confidence > 0.6 ? OutputStatus.OK : OutputStatus.LOW_QUALITY,
      qualityFlags: confidence < 0.6 ? [{ flag: 'low_confidence', description: 'Low calibration confidence', severity: 'warning' }] : [],
      evidence: {
        sqi: input.avgBeatSQI,
        acceptedWindows: valid.length,
        acceptedBeats: input.beatCount,
        perfusionIndex: Rmed,
        source: this.calibration.isUserCalibrated ? 'user_v3' : 'device_v3',
        deviceCalibration: this.calibration.deviceModel,
      },
      debug: {
        coefficients: { A: this.calibration.A, B: this.calibration.B, C: this.calibration.C },
        alphaRG: this.alphaRG,
        Rrg, Rrb, R: Rmed,
        ratioVariation: ratioVar,
        rawSpO2: raw,
        usedMultiChannel: useBlue,
      },
    };
    return this.lastOutput;
  }

  reset(): void {
    this.ratioHistory = [];
    this.lastOutput = null;
    this.consecutiveValid = 0;
    this.consecutiveInvalid = 0;
  }

  fullReset(): void {
    this.reset();
    this.userCalibrationPoints = [];
    this.calibration = null;
    this.alphaRG = 0.65;
  }

  // ─── persistence ───
  serializeCalibration(): { calibration: SpO2Calibration | null; alphaRG: number; userPoints: typeof this.userCalibrationPoints } {
    return {
      calibration: this.calibration,
      alphaRG: this.alphaRG,
      userPoints: [...this.userCalibrationPoints],
    };
  }

  loadSerializedCalibration(payload: { calibration: SpO2Calibration | null; alphaRG?: number; userPoints?: typeof this.userCalibrationPoints }): void {
    if (!payload) return;
    if (payload.calibration) this.calibration = { ...payload.calibration };
    if (typeof payload.alphaRG === 'number') this.alphaRG = Math.max(0, Math.min(1, payload.alphaRG));
    if (Array.isArray(payload.userPoints)) this.userCalibrationPoints = [...payload.userPoints];
  }

  // ─── helpers ───
  private blocked(reason: OutputStatus | string, debug: Record<string, any> = {}): SpO2Output {
    const status = typeof reason === 'string' && reason === 'blocked'
      ? OutputStatus.BLOCKED
      : reason as OutputStatus;
    return {
      value: null, unit: '%', confidence: 0, status,
      qualityFlags: [{ flag: 'device_uncalibrated', description: 'SpO2 V3 requires calibration', severity: 'error' }],
      evidence: { sqi: 0, acceptedWindows: 0, acceptedBeats: 0, perfusionIndex: 0, source: 'uncalibrated' },
      debug,
    };
  }
  private median(a: number[]): number {
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  private std(a: number[]): number {
    const mu = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - mu) * (v - mu), 0) / a.length);
  }
}
