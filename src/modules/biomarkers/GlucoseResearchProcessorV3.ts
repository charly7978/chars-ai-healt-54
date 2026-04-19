/**
 * GLUCOSE RESEARCH PROCESSOR V3 — RIDGE MULTIVARIATE (RESEARCH ONLY)
 *
 * Replaces V2's correlation×weight heuristic with an honest closed-form
 * ridge regression (Tikhonov), reports leave-one-out RMSE, and adds OD-
 * based features (Beer-Lambert ratios) on top of the existing morphology.
 *
 * IMPORTANT: This module is RESEARCH ONLY. Output is gated to
 * OutputStatus.RESEARCH_ONLY at all times — even when calibrated. Smartphone
 * cameras lack the NIR window (~940 nm) where glucose absorbs strongest, so
 * any RGB+OD model is at best a weak proxy. The processor exists to support
 * dataset collection and pilot studies, NOT clinical decisions.
 *
 * Reference for state-of-the-art targets (smartphone PPG only):
 *   Sahranavard 2024 Sci Rep — RMSE ~19.7 mg/dL, Clarke A 76.6%
 *   Kim et al. 2025 Comm Med — MARD 9.59–16.40% with monthly recalibration
 */

import { OutputStatus, type GlucoseOutput } from '../../types/measurement';
import { fitRidgeAutoLambda, predict, type RidgeModel } from '../ml/RidgeRegressor';

export interface GlucoseV3Features {
  sutMs: number;
  pw50Ms: number;
  pw75Ms: number;
  pw25Ms: number;
  augmentationIndex: number;
  stiffnessIndex: number;
  dicroticDepth: number;
  areaRatio: number;
  hr: number;
  rrSDNN: number;
  perfusionGreen: number;
  rgRatio: number;
  // Beer-Lambert OD (Phase 1)
  odR: number;
  odG: number;
  odB: number;
}

interface CalibPoint {
  timestamp: number;
  features: GlucoseV3Features;
  refGlucose: number;
}

const FEATURES: (keyof GlucoseV3Features)[] = [
  'sutMs', 'pw50Ms', 'pw75Ms', 'pw25Ms',
  'augmentationIndex', 'stiffnessIndex', 'dicroticDepth', 'areaRatio',
  'hr', 'rrSDNN', 'perfusionGreen', 'rgRatio',
  'odR', 'odG', 'odB',
];

function toVec(f: GlucoseV3Features): number[] {
  return FEATURES.map(k => {
    const v = (f as any)[k];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  });
}

const CONFIG = {
  MIN_SAMPLES: 20,
  TARGET_RANGE: { min: 70, max: 180 },
  MIN_COVERAGE: 30,                 // mg/dL spread required across calibration set
  MAX_RECALIBRATION_DAYS: 90,
  CLAMP: { min: 40, max: 400 },
  LAMBDAS: [0.01, 0.1, 1, 10, 100, 1000],
  EMA_ALPHA: 0.30,
  HISTORY_SIZE: 30,
};

export class GlucoseResearchProcessorV3 {
  private points: CalibPoint[] = [];
  private model: RidgeModel | null = null;
  private modelDate = 0;
  private trainingMode = false;
  private history: GlucoseV3Features[] = [];
  private lastValue: number | null = null;

  startTrainingMode(): void { this.trainingMode = true; this.points = []; }

  addTrainingSample(features: GlucoseV3Features, refGlucose: number):
    { success: boolean; samplesCollected: number; coverageMgDl: number; canTrain: boolean } {
    if (!this.trainingMode || refGlucose < 40 || refGlucose > 400) {
      return {
        success: false,
        samplesCollected: this.points.length,
        coverageMgDl: this.coverage(),
        canTrain: false,
      };
    }
    this.points.push({ timestamp: Date.now(), features, refGlucose });
    if (this.points.length >= CONFIG.MIN_SAMPLES && this.coverage() >= CONFIG.MIN_COVERAGE) {
      this.refit();
    }
    return {
      success: true,
      samplesCollected: this.points.length,
      coverageMgDl: this.coverage(),
      canTrain: this.points.length >= CONFIG.MIN_SAMPLES && this.coverage() >= CONFIG.MIN_COVERAGE,
    };
  }

  finishTraining(): { success: boolean; nPoints: number; rmse: number; coverageMgDl: number } {
    this.trainingMode = false;
    return {
      success: !!this.model,
      nPoints: this.points.length,
      rmse: this.model?.looRMSE ?? 0,
      coverageMgDl: this.coverage(),
    };
  }

  private coverage(): number {
    if (this.points.length === 0) return 0;
    const ys = this.points.map(p => p.refGlucose);
    return Math.max(...ys) - Math.min(...ys);
  }

  private refit(): void {
    try {
      const X = this.points.map(p => toVec(p.features));
      const y = this.points.map(p => p.refGlucose);
      this.model = fitRidgeAutoLambda(X, y, CONFIG.LAMBDAS);
      this.modelDate = Date.now();
    } catch { this.model = null; }
  }

  /** Compute the smoothed feature vector across recent windows. */
  private medianFeatures(): GlucoseV3Features {
    const out: any = {};
    for (const k of FEATURES) {
      const arr = this.history.map(f => (f as any)[k] ?? 0).sort((a, b) => a - b);
      const m = Math.floor(arr.length / 2);
      out[k] = arr.length ? (arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2) : 0;
    }
    return out as GlucoseV3Features;
  }

  process(features: GlucoseV3Features, sqi: number): GlucoseOutput {
    this.history.push(features);
    if (this.history.length > CONFIG.HISTORY_SIZE) this.history.shift();

    const flags: { flag: string; description: string; severity: 'info' | 'warning' | 'error' }[] = [];

    if (!this.model || (Date.now() - this.modelDate) / 86400000 > CONFIG.MAX_RECALIBRATION_DAYS) {
      return this.blocked(OutputStatus.NEEDS_CALIBRATION, { reason: 'No (or expired) calibration model' });
    }
    if (sqi < 0.4) return this.blocked(OutputStatus.BLOCKED, { reason: 'Low SQI', sqi });

    const smoothed = this.medianFeatures();
    const x = toVec(smoothed);
    const raw = predict(this.model, x);
    const clamped = Math.max(CONFIG.CLAMP.min, Math.min(CONFIG.CLAMP.max, raw));
    const value = this.lastValue !== null
      ? this.lastValue * (1 - CONFIG.EMA_ALPHA) + clamped * CONFIG.EMA_ALPHA
      : clamped;
    this.lastValue = value;

    const trend: 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN' = this.lastValue !== null && this.history.length >= 4
      ? (clamped - (this.lastValue as number) > 5 ? 'RISING'
        : clamped - (this.lastValue as number) < -5 ? 'FALLING'
        : 'STABLE')
      : 'UNKNOWN';

    let confidence = 0.30;
    if (this.model.looRMSE < 12) confidence += 0.25;
    else if (this.model.looRMSE < 20) confidence += 0.10;
    confidence += Math.min(0.20, this.points.length / 50);
    confidence = Math.max(0, Math.min(0.85, confidence));

    if (this.model.looRMSE > 25) flags.push({
      flag: 'high_loo_rmse',
      description: 'Calibration LOO-RMSE > 25 mg/dL — research only',
      severity: 'warning',
    });
    flags.push({ flag: 'research_only', description: 'Glucose from PPG is research-only; NOT for clinical decisions', severity: 'info' });

    return {
      value: Math.round(value),
      unit: 'mg/dL',
      confidence,
      status: OutputStatus.RESEARCH_ONLY,
      researchMode: true,
      qualityFlags: flags,
      evidence: {
        sqi,
        acceptedWindows: this.history.length,
        source: `ridge_v3_${this.points.length}pts`,
      },
      debug: {
        looRMSE: this.model.looRMSE,
        lambda: this.model.lambda,
        rawPrediction: raw,
        trend,
      },
    };
  }

  reset(): void { this.history = []; this.lastValue = null; }
  fullReset(): void {
    this.reset();
    this.points = [];
    this.model = null;
    this.modelDate = 0;
    this.trainingMode = false;
  }

  getCalibrationStatus() {
    return {
      pointsCollected: this.points.length,
      pointsNeeded: Math.max(0, CONFIG.MIN_SAMPLES - this.points.length),
      coverageMgDl: this.coverage(),
      coverageNeeded: CONFIG.MIN_COVERAGE,
      modelReady: !!this.model,
      rmse: this.model?.looRMSE ?? 0,
      ageDays: this.model ? (Date.now() - this.modelDate) / 86400000 : 0,
    };
  }

  serializeCalibration() { return { points: [...this.points], model: this.model, modelDate: this.modelDate }; }
  loadSerializedCalibration(payload: { points?: CalibPoint[]; model?: RidgeModel | null; modelDate?: number }): void {
    if (!payload) return;
    if (Array.isArray(payload.points)) this.points = payload.points.map(p => ({ ...p }));
    if (payload.model) { this.model = payload.model; this.modelDate = payload.modelDate ?? Date.now(); }
    else if (this.points.length >= CONFIG.MIN_SAMPLES) this.refit();
  }

  private blocked(status: OutputStatus, debug: Record<string, any>): GlucoseOutput {
    return {
      value: null, unit: 'mg/dL', confidence: 0, status, researchMode: true,
      qualityFlags: [{ flag: 'device_uncalibrated', description: 'Glucose V3 requires calibration', severity: 'error' }],
      evidence: { sqi: 0, acceptedWindows: 0, source: 'uncalibrated' },
      debug,
    };
  }
}
