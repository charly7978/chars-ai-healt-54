/**
 * LIPID RESEARCH PROCESSOR V3 — RIDGE MULTIVARIATE PER-TARGET (RESEARCH ONLY)
 *
 * Replaces V2's correlation×weight heuristic with one ridge regressor per
 * lipid target (totalCholesterol, LDL, HDL, triglycerides). LOO-RMSE per
 * target is reported honestly. Output stays RESEARCH_ONLY at all times —
 * no smartphone PPG study to date has validated lipid estimation for
 * clinical use.
 *
 * Reference (state of the art for PPG-derived lipids):
 *   Arguello-Prada et al. 2025 — feature-engineered ridge models of stiffness
 *   index + augmentation index proxy total cholesterol with MAE ~25 mg/dL.
 */

import { OutputStatus, type LipidsOutput } from '../../types/measurement';
import { fitRidgeAutoLambda, predict, type RidgeModel } from '../ml/RidgeRegressor';

export interface LipidV3Features {
  stiffnessIndex: number;
  augmentationIndex: number;
  pwvProxy: number;
  pulseAmplitude: number;
  pw50Ms: number;
  pw75Ms: number;
  pw25Ms: number;
  diastolicTimeMs: number;
  areaRatio: number;
  dicroticDepth: number;
  hr: number;
  rrSDNN: number;
  perfusionGreen: number;
  age?: number;
}

const FEATURES: (keyof LipidV3Features)[] = [
  'stiffnessIndex', 'augmentationIndex', 'pwvProxy', 'pulseAmplitude',
  'pw50Ms', 'pw75Ms', 'pw25Ms', 'diastolicTimeMs', 'areaRatio', 'dicroticDepth',
  'hr', 'rrSDNN', 'perfusionGreen',
];

interface CalibPoint {
  timestamp: number;
  features: LipidV3Features;
  refLabs: { totalCholesterol: number; ldl: number; hdl: number; triglycerides: number };
}

interface ModelSet {
  totalCholesterol: RidgeModel;
  ldl: RidgeModel;
  hdl: RidgeModel;
  triglycerides: RidgeModel;
  fitDate: number;
}

const CONFIG = {
  MIN_SAMPLES: 10,
  CLAMP: { min: 30, max: 500 },
  RECALIBRATION_DAYS: 90,
  LAMBDAS: [0.1, 1, 10, 100, 1000],
  HISTORY_SIZE: 30,
};

function toVec(f: LipidV3Features): number[] {
  return FEATURES.map(k => {
    const v = (f as any)[k];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  });
}

export class LipidResearchProcessorV3 {
  private points: CalibPoint[] = [];
  private models: ModelSet | null = null;
  private trainingMode = false;
  private history: LipidV3Features[] = [];

  startTraining(): void { this.trainingMode = true; this.points = []; }

  addTrainingSample(features: LipidV3Features, refLabs: CalibPoint['refLabs']):
    { success: boolean; samples: number; canTrain: boolean } {
    if (!this.trainingMode) return { success: false, samples: 0, canTrain: false };
    this.points.push({ timestamp: Date.now(), features, refLabs });
    if (this.points.length >= CONFIG.MIN_SAMPLES) this.refit();
    return {
      success: true,
      samples: this.points.length,
      canTrain: this.points.length >= CONFIG.MIN_SAMPLES,
    };
  }

  finishTraining(): { success: boolean; samples: number; rmse: Record<string, number> } {
    this.trainingMode = false;
    return {
      success: !!this.models,
      samples: this.points.length,
      rmse: this.models ? {
        totalCholesterol: this.models.totalCholesterol.looRMSE,
        ldl: this.models.ldl.looRMSE,
        hdl: this.models.hdl.looRMSE,
        triglycerides: this.models.triglycerides.looRMSE,
      } : {},
    };
  }

  private refit(): void {
    try {
      const X = this.points.map(p => toVec(p.features));
      const targets = ['totalCholesterol', 'ldl', 'hdl', 'triglycerides'] as const;
      const fit = (key: typeof targets[number]) =>
        fitRidgeAutoLambda(X, this.points.map(p => p.refLabs[key]), CONFIG.LAMBDAS);
      this.models = {
        totalCholesterol: fit('totalCholesterol'),
        ldl: fit('ldl'),
        hdl: fit('hdl'),
        triglycerides: fit('triglycerides'),
        fitDate: Date.now(),
      };
    } catch { this.models = null; }
  }

  process(features: LipidV3Features, sqi: number): LipidsOutput {
    this.history.push(features);
    if (this.history.length > CONFIG.HISTORY_SIZE) this.history.shift();

    if (!this.models) return this.blocked(OutputStatus.NEEDS_CALIBRATION);
    const ageDays = (Date.now() - this.models.fitDate) / 86400000;
    if (ageDays > CONFIG.RECALIBRATION_DAYS) return this.blocked(OutputStatus.NEEDS_CALIBRATION);
    if (sqi < 0.5) return this.blocked(OutputStatus.BLOCKED);

    const x = toVec(this.medianFeatures());
    const tc = Math.max(CONFIG.CLAMP.min, Math.min(CONFIG.CLAMP.max, predict(this.models.totalCholesterol, x)));
    const ldl = Math.max(CONFIG.CLAMP.min, Math.min(CONFIG.CLAMP.max, predict(this.models.ldl, x)));
    const hdl = Math.max(20, Math.min(120, predict(this.models.hdl, x)));
    const trig = Math.max(CONFIG.CLAMP.min, Math.min(CONFIG.CLAMP.max, predict(this.models.triglycerides, x)));

    let confidence = 0.25;
    confidence += Math.min(0.15, this.points.length / 200);
    if (this.models.totalCholesterol.looRMSE < 25) confidence += 0.10;
    if (this.models.triglycerides.looRMSE < 30) confidence += 0.10;
    confidence = Math.max(0, Math.min(0.75, confidence));

    return {
      value: {
        totalCholesterol: Math.round(tc),
        ldl: Math.round(ldl),
        hdl: Math.round(hdl),
        triglycerides: Math.round(trig),
      },
      unit: 'mg/dL',
      confidence,
      status: OutputStatus.RESEARCH_ONLY,
      qualityFlags: [{ flag: 'research_only', description: 'Lipids from PPG are research only', severity: 'info' }],
      evidence: { sqi, acceptedWindows: this.history.length, source: `ridge_v3_${this.points.length}pts`, perfusionIndex: features.perfusionGreen },
      debug: {
        rmse: {
          tc: this.models.totalCholesterol.looRMSE,
          ldl: this.models.ldl.looRMSE,
          hdl: this.models.hdl.looRMSE,
          trig: this.models.triglycerides.looRMSE,
        },
        lambda: {
          tc: this.models.totalCholesterol.lambda,
          ldl: this.models.ldl.lambda,
          hdl: this.models.hdl.lambda,
          trig: this.models.triglycerides.lambda,
        },
      },
    };
  }

  private medianFeatures(): LipidV3Features {
    const out: any = {};
    for (const k of FEATURES) {
      const arr = this.history.map(f => (f as any)[k] ?? 0).sort((a, b) => a - b);
      const m = Math.floor(arr.length / 2);
      out[k] = arr.length ? (arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2) : 0;
    }
    return out as LipidV3Features;
  }

  private blocked(status: OutputStatus): LipidsOutput {
    return {
      value: null, unit: 'mg/dL', confidence: 0, status,
      qualityFlags: [{ flag: 'device_uncalibrated', description: 'Lipids V3 requires calibration', severity: 'error' }],
      evidence: { sqi: 0, acceptedWindows: 0, source: 'uncalibrated', perfusionIndex: 0 },
      debug: { reason: 'No (or expired) calibration' },
    };
  }

  reset(): void { this.history = []; }
  fullReset(): void { this.reset(); this.points = []; this.models = null; this.trainingMode = false; }

  getCalibrationStatus() {
    return {
      pointsCollected: this.points.length,
      pointsNeeded: Math.max(0, CONFIG.MIN_SAMPLES - this.points.length),
      modelReady: !!this.models,
      ageDays: this.models ? (Date.now() - this.models.fitDate) / 86400000 : 0,
    };
  }

  serializeCalibration() { return { points: [...this.points], models: this.models }; }
  loadSerializedCalibration(payload: { points?: CalibPoint[]; models?: ModelSet | null }): void {
    if (!payload) return;
    if (Array.isArray(payload.points)) this.points = payload.points.map(p => ({ ...p }));
    if (payload.models) this.models = payload.models;
    else if (this.points.length >= CONFIG.MIN_SAMPLES) this.refit();
  }
}
