/**
 * HEMOGLOBIN PROCESSOR (research)
 *
 * Estimates hemoglobin concentration (g/dL) from contact PPG features +
 * Beer-Lambert Optical Density across the smartphone's three native
 * channels. The model is a per-user ridge regressor trained on paired
 * (PPG features, lab Hb) measurements; without ≥3 calibration points the
 * processor publishes a population-prior value and flags it as
 * RESEARCH_ONLY.
 *
 * Approach is informed by:
 *  - Wang et al. (2021, IEEE JBHI) — RGB-imaging anemia screening
 *  - Devadhasan et al. (2024, Nature Sci Rep) — fingernail RGB Hb estimate
 *  - Kavsaoğlu et al. (2015) — PPG morphology features for Hb proxy
 *
 * Disclaimer: Without paired lab data this is a **screening proxy**, not
 * a clinical hemoglobinometer. Output is gated to RESEARCH_ONLY until the
 * user provides ≥3 lab calibration points.
 */

import { OutputStatus, type OutputContract } from '../../types/measurement';
import { fitRidgeAutoLambda, predict, type RidgeModel } from '../ml/RidgeRegressor';

export interface HemoglobinFeatures {
  /** Raw red channel mean (linearized 0..255) */
  meanRedLin: number;
  /** Raw green channel mean (linearized 0..255) */
  meanGreenLin: number;
  /** Raw blue channel mean (linearized 0..255) */
  meanBlueLin: number;
  /** Optical density per channel (Beer-Lambert) */
  odR: number;
  odG: number;
  odB: number;
  /** AC/DC perfusion indices */
  perfusionRed: number;
  perfusionGreen: number;
  /** Pulse morphology features useful for Hb */
  pulseAmplitude: number;
  dicroticDepth: number;
  rgRatio: number;
  hr: number;
  /** Optional anthropometrics that improve population priors */
  age?: number;
  gender?: 'M' | 'F';
}

export interface HemoglobinOutput extends OutputContract<number> {
  unit: 'g/dL';
  /** Boolean flag: estimated Hb below sex-specific anemia threshold */
  anemiaScreening?: boolean;
  /** RESEARCH_ONLY when no user calibration */
  researchMode: boolean;
}

interface HemoCalibrationPoint {
  timestamp: number;
  features: HemoglobinFeatures;
  refHbgDl: number;
}

const FEATURE_KEYS: (keyof HemoglobinFeatures)[] = [
  'meanRedLin', 'meanGreenLin', 'meanBlueLin',
  'odR', 'odG', 'odB',
  'perfusionRed', 'perfusionGreen',
  'pulseAmplitude', 'dicroticDepth', 'rgRatio', 'hr',
];

function featuresToVector(f: HemoglobinFeatures): number[] {
  return FEATURE_KEYS.map(k => {
    const v = (f as any)[k];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  });
}

const CONFIG = {
  MIN_CALIBRATION_POINTS: 3,
  MAX_CALIBRATION_AGE_DAYS: 90,
  MIN_HB: 4, MAX_HB: 22,
  RIDGE_LAMBDAS: [0.01, 0.1, 1, 10, 100],
  ANEMIA_F: 12.0, // g/dL — WHO non-pregnant women
  ANEMIA_M: 13.0, // g/dL — WHO men
  EMA_ALPHA: 0.30,
};

/** Population prior — used until the user provides paired lab data. */
function populationPrior(features: HemoglobinFeatures): number {
  const sexBase = features.gender === 'F' ? 13.5 : 14.5;
  // Modulate by red dominance and perfusion. These bounds are intentionally
  // narrow because we do NOT pretend to be a hemoglobinometer.
  const redBoost = (features.rgRatio - 2.0) * 0.6;
  const perfBoost = Math.max(-0.4, Math.min(0.4, (features.perfusionGreen - 0.02) * 8));
  return Math.max(11, Math.min(17, sexBase + redBoost + perfBoost));
}

export class HemoglobinProcessor {
  private points: HemoCalibrationPoint[] = [];
  private model: RidgeModel | null = null;
  private modelDate = 0;
  private wizardActive = false;
  private lastValue: number | null = null;
  private history: HemoglobinFeatures[] = [];
  private readonly HISTORY_SIZE = 20;

  startCalibrationWizard(): void { this.wizardActive = true; this.points = []; }

  addCalibrationPoint(features: HemoglobinFeatures, refHbgDl: number):
    { success: boolean; pointsCollected: number; pointsNeeded: number } {
    if (!this.wizardActive) return { success: false, pointsCollected: 0, pointsNeeded: CONFIG.MIN_CALIBRATION_POINTS };
    if (refHbgDl < CONFIG.MIN_HB || refHbgDl > CONFIG.MAX_HB) {
      return { success: false, pointsCollected: this.points.length, pointsNeeded: CONFIG.MIN_CALIBRATION_POINTS };
    }
    this.points.push({ timestamp: Date.now(), features, refHbgDl });
    if (this.points.length >= CONFIG.MIN_CALIBRATION_POINTS) this.refit();
    return {
      success: true,
      pointsCollected: this.points.length,
      pointsNeeded: Math.max(0, CONFIG.MIN_CALIBRATION_POINTS - this.points.length),
    };
  }

  finishCalibrationWizard(): { success: boolean; nPoints: number; rmse: number } {
    this.wizardActive = false;
    if (!this.model) return { success: false, nPoints: 0, rmse: 0 };
    return { success: true, nPoints: this.points.length, rmse: this.model.looRMSE };
  }

  private refit(): void {
    if (this.points.length < CONFIG.MIN_CALIBRATION_POINTS) return;
    try {
      const X = this.points.map(p => featuresToVector(p.features));
      const y = this.points.map(p => p.refHbgDl);
      this.model = fitRidgeAutoLambda(X, y, CONFIG.RIDGE_LAMBDAS);
      this.modelDate = Date.now();
    } catch { this.model = null; }
  }

  /**
   * Compute Hb estimate. When a user-calibrated model exists, returns a
   * regression-based value with confidence proportional to model quality.
   * Otherwise returns the population prior with RESEARCH_ONLY status.
   */
  process(features: HemoglobinFeatures): HemoglobinOutput {
    this.history.push(features);
    if (this.history.length > this.HISTORY_SIZE) this.history.shift();
    const smoothed = this.medianFeatures();

    let value: number;
    let confidence: number;
    let researchMode = true;
    let status: OutputStatus = OutputStatus.RESEARCH_ONLY;
    const flags: { flag: string; description: string; severity: 'info' | 'warning' | 'error' }[] = [];

    if (this.model && (Date.now() - this.modelDate) / 86400000 <= CONFIG.MAX_CALIBRATION_AGE_DAYS) {
      const x = featuresToVector(smoothed);
      const raw = predict(this.model, x);
      value = Math.max(CONFIG.MIN_HB, Math.min(CONFIG.MAX_HB, raw));
      researchMode = false;
      status = this.model.looRMSE < 1.5 ? OutputStatus.OK : OutputStatus.LOW_QUALITY;
      confidence = 0.45;
      if (this.model.looRMSE < 1.0) confidence += 0.30;
      else if (this.model.looRMSE < 1.5) confidence += 0.15;
      confidence += Math.min(0.20, this.points.length / 30);
      confidence = Math.max(0, Math.min(1, confidence));
      if (this.model.looRMSE > 2.0) flags.push({
        flag: 'high_loo_rmse',
        description: 'Calibration LOO-RMSE > 2.0 g/dL — treat as screening only',
        severity: 'warning',
      });
    } else {
      value = populationPrior(smoothed);
      confidence = 0.20;
      flags.push({
        flag: 'research_only',
        description: 'Population prior; calibrate with ≥3 lab Hb references for personal estimate',
        severity: 'info',
      });
    }

    // EMA smoothing across calls
    if (this.lastValue !== null) value = this.lastValue * (1 - CONFIG.EMA_ALPHA) + value * CONFIG.EMA_ALPHA;
    this.lastValue = value;

    const anemiaThr = features.gender === 'F' ? CONFIG.ANEMIA_F : CONFIG.ANEMIA_M;
    const anemiaScreening = value < anemiaThr;

    return {
      value: Math.round(value * 10) / 10,
      unit: 'g/dL',
      confidence,
      status,
      researchMode,
      anemiaScreening,
      qualityFlags: flags,
      evidence: {
        sqi: 0,
        acceptedWindows: this.history.length,
        source: this.model ? `ridge_${this.points.length}pts` : 'population_prior',
        userCalibration: this.model ? `points_${this.points.length}` : 'none',
      },
      debug: {
        looRMSE: this.model?.looRMSE,
        lambda: this.model?.lambda,
      },
    };
  }

  reset(): void { this.history = []; this.lastValue = null; }
  fullReset(): void {
    this.reset();
    this.points = [];
    this.model = null;
    this.modelDate = 0;
    this.wizardActive = false;
  }

  getCalibrationStatus() {
    return {
      pointsCollected: this.points.length,
      pointsNeeded: Math.max(0, CONFIG.MIN_CALIBRATION_POINTS - this.points.length),
      modelReady: !!this.model,
      rmse: this.model?.looRMSE ?? 0,
      ageDays: this.model ? (Date.now() - this.modelDate) / 86400000 : 0,
    };
  }

  // Persistence
  serializeCalibration() { return { points: [...this.points], model: this.model, modelDate: this.modelDate }; }
  loadSerializedCalibration(payload: { points?: HemoCalibrationPoint[]; model?: RidgeModel | null; modelDate?: number }): void {
    if (!payload) return;
    if (Array.isArray(payload.points)) this.points = payload.points.map(p => ({ ...p }));
    if (payload.model) { this.model = payload.model; this.modelDate = payload.modelDate ?? Date.now(); }
    else if (this.points.length >= CONFIG.MIN_CALIBRATION_POINTS) this.refit();
  }

  private medianFeatures(): HemoglobinFeatures {
    const out: any = {};
    for (const k of FEATURE_KEYS) {
      const arr = this.history.map(f => (f as any)[k] ?? 0).sort((a, b) => a - b);
      const m = Math.floor(arr.length / 2);
      out[k] = arr.length ? (arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2) : 0;
    }
    out.age = this.history[this.history.length - 1]?.age;
    out.gender = this.history[this.history.length - 1]?.gender;
    return out as HemoglobinFeatures;
  }
}
