/**
 * LIPID RESEARCH PROCESSOR V3 — MODELO ESPECTRAL + VASCULAR STIFFNESS
 *
 * Principio biofísico:
 *   Los lípidos en sangre (colesterol, triglicéridos) modifican:
 *   1. Las propiedades ópticas del plasma (turbidez)
 *   2. La rigidez arterial (aterosclerosis inducida)
 *   3. La morfología PPG a través de cambios en PWV
 *
 * Features críticos (Arguello-Prada 2025, Nabeel 2022):
 *   - Stiffness Index (SI): correlación directa con colesterol total
 *   - Augmentation Index: rigidez aórtica → LDL
 *   - PWV proxy: velocidad de onda de pulso → placa aterosclerótica
 *   - Dicrotic notch depth: resistencia periférica → triglicéridos
 *   - IPA (Inflection Point Area): ratio diastólico → HDL inverso
 *   - RMSSD / SDNN: variabilidad cardíaca correlaciona con dislipemia
 *   - R/G, R/B ratios: turbidez plasmática (efecto de lípidos en μs')
 *
 * Modelo: Ridge Regression multi-output por analito.
 * Salida: [CT, LDL, HDL, TG] en mg/dL con incertidumbre.
 *
 * Referencias:
 *   - Arguello-Prada et al. 2025 Biomed. Signal Process. Control
 *   - Nabeel et al. 2022 IEEE TBME (PWV and cholesterol)
 *   - Teng & Zhang 2012 IEEE Trans. BME (PPG lipid correlation)
 */

export interface LipidFeatureVector {
  stiffnessIndex: number;
  augmentationIndex: number;
  pwvProxy: number;
  dicroticDepth: number;
  ipaRatio: number;
  pw50Ms: number;
  pw75Ms: number;
  pw25Ms: number;
  diastolicTimeMs: number;
  sutMs: number;
  areaRatio: number;
  skewness: number;
  rmssd: number;
  sdnn: number;
  hr: number;
  piGreen: number;
  rgRatio: number;
  rbRatio: number;
  // Demographics (optional for personalization)
  age?: number;
  bmi?: number;
}

interface LipidSample {
  timestamp: number;
  features: LipidFeatureVector;
  labs: { totalCholesterol: number; ldl: number; hdl: number; triglycerides: number };
}

interface LipidModel {
  samples: LipidSample[];
  featureMeans: Record<string, number>;
  featureStds: Record<string, number>;
  weights: {
    totalCholesterol: Record<string, number>;
    ldl: Record<string, number>;
    hdl: Record<string, number>;
    triglycerides: Record<string, number>;
  };
  intercepts: { totalCholesterol: number; ldl: number; hdl: number; triglycerides: number };
  rmse: { totalCholesterol: number; ldl: number; hdl: number; triglycerides: number };
  createdAt: number;
}

export interface LipidResult {
  totalCholesterol: number;
  triglycerides: number;
  ldl: number;
  hdl: number;
  confidence: number;
  status: string;
  enabledState: 'ENABLED_HIGH_CONFIDENCE' | 'ENABLED_MEDIUM_CONFIDENCE' | 'ENABLED_LOW_CONFIDENCE' | 'WITHHELD_LOW_QUALITY' | 'NEEDS_CALIBRATION';
}

const MIN_SAMPLES = 10;
const RECAL_DAYS = 90;

export class LipidResearchProcessor {
  private model: LipidModel | null = null;
  private pendingSamples: LipidSample[] = [];
  private isTraining = false;
  private lastOutput: LipidResult | null = null;

  startTraining(_userId: string, _labSource: string): void {
    this.isTraining = true;
    this.pendingSamples = [];
  }

  addTrainingSample(
    features: LipidFeatureVector,
    labs: LipidSample['labs']
  ): { success: boolean; samples: number; canTrain: boolean } {
    if (!this.isTraining) return { success: false, samples: 0, canTrain: false };
    this.pendingSamples.push({ timestamp: Date.now(), features, labs });
    if (this.pendingSamples.length >= MIN_SAMPLES) this.trainModel();
    return { success: true, samples: this.pendingSamples.length, canTrain: this.pendingSamples.length >= MIN_SAMPLES };
  }

  private trainModel(): void {
    const n = this.pendingSamples.length;
    if (n < MIN_SAMPLES) return;

    const fnames = Object.keys(this.pendingSamples[0].features) as (keyof LipidFeatureVector)[];
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};

    for (const f of fnames) {
      const vals = this.pendingSamples.map(s => (s.features[f] ?? 0) as number);
      const m = vals.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / n);
      means[f as string] = m;
      stds[f as string] = Math.max(1e-8, std);
    }

    const X = this.pendingSamples.map(s =>
      fnames.map(f => ((s.features[f] ?? 0) as number - means[f as string]) / stds[f as string])
    );

    const p = fnames.length;
    const lambda = Math.max(0.1, n / (p * p));

    const targets = ['totalCholesterol', 'ldl', 'hdl', 'triglycerides'] as const;
    const weights: any = {};
    const intercepts: any = {};
    const rmse: any = {};

    for (const target of targets) {
      const y = this.pendingSamples.map(s => s.labs[target]);
      const yMean = y.reduce((a, b) => a + b, 0) / n;
      const w = this.ridgeSolve(X, y.map(v => v - yMean), p, n, lambda);
      weights[target] = Object.fromEntries(fnames.map((f, i) => [f, w[i]]));
      intercepts[target] = yMean;

      let sse = 0;
      for (let i = 0; i < n; i++) {
        let pred = yMean + X[i].reduce((s, xi, j) => s + w[j] * xi, 0);
        sse += (pred - y[i]) ** 2;
      }
      rmse[target] = Math.sqrt(sse / n);
    }

    this.model = { samples: [...this.pendingSamples], featureMeans: means, featureStds: stds, weights, intercepts, rmse, createdAt: Date.now() };
  }

  process(input: {
    cycleFeatures: {
      stiffnessIndex: number; augmentationIndex: number;
      areaRatio: number; dicroticDepth: number; pwvProxy?: number;
      pw50Ms: number; pw75Ms: number; pw25Ms: number;
      diastolicTimeMs: number; sutMs?: number;
      ipaRatio?: number; skewness?: number;
    };
    hr: number;
    rrVar: { sdnn: number; rmssd: number; cv: number };
    piGreen: number;
    contactStable: boolean;
    signalQuality: number;
    rgRatio?: number;
    rbRatio?: number;
  }): LipidResult {
    const blocked: LipidResult = {
      totalCholesterol: 0, ldl: 0, hdl: 0, triglycerides: 0,
      confidence: 0, status: 'NEEDS_CALIBRATION', enabledState: 'NEEDS_CALIBRATION',
    };

    // Gate estricto: sin señal usable no se publica.
    if (!input.contactStable || input.signalQuality < 12) {
      return { ...blocked, enabledState: 'WITHHELD_LOW_QUALITY', status: 'LOW_QUALITY' };
    }
    const ageDays = this.model ? (Date.now() - this.model.createdAt) / 86400000 : Infinity;
    if (!this.model || ageDays > RECAL_DAYS) return blocked;

    const cf = input.cycleFeatures;
    const features: LipidFeatureVector = {
      stiffnessIndex: cf.stiffnessIndex,
      augmentationIndex: cf.augmentationIndex,
      pwvProxy: cf.pwvProxy ?? 0,
      dicroticDepth: cf.dicroticDepth,
      ipaRatio: cf.ipaRatio ?? 0,
      pw50Ms: cf.pw50Ms,
      pw75Ms: cf.pw75Ms,
      pw25Ms: cf.pw25Ms,
      diastolicTimeMs: cf.diastolicTimeMs,
      sutMs: cf.sutMs ?? 0,
      areaRatio: cf.areaRatio,
      skewness: cf.skewness ?? 0,
      rmssd: input.rrVar.rmssd,
      sdnn: input.rrVar.sdnn,
      hr: input.hr,
      piGreen: input.piGreen,
      rgRatio: input.rgRatio ?? 1,
      rbRatio: input.rbRatio ?? 1,
    };

    const targets = ['totalCholesterol', 'ldl', 'hdl', 'triglycerides'] as const;
    const predictions: Record<string, number> = {};
    const model = this.model;
    const fnames = Object.keys(model.weights.totalCholesterol);
    for (const target of targets) {
      let pred = model.intercepts[target];
      for (const fname of fnames) {
        const raw = (features as any)[fname] ?? 0;
        const norm = (raw - model.featureMeans[fname]) / model.featureStds[fname];
        pred += (model.weights[target][fname] ?? 0) * norm;
      }
      predictions[target] = Math.max(50, Math.min(500, Math.round(pred)));
    }
    let confidence = 0.25;
    confidence += Math.min(0.15, model.samples.length / 200);
    for (const t of targets) { if (model.rmse[t] < 20) confidence += 0.08; }
    confidence = Math.min(0.75, confidence);

    const enabledState = confidence >= 0.60 ? 'ENABLED_HIGH_CONFIDENCE'
      : confidence >= 0.40 ? 'ENABLED_MEDIUM_CONFIDENCE'
      : confidence >= 0.20 ? 'ENABLED_LOW_CONFIDENCE'
      : 'WITHHELD_LOW_QUALITY';

    this.lastOutput = {
      totalCholesterol: predictions.totalCholesterol,
      ldl: predictions.ldl,
      hdl: predictions.hdl,
      triglycerides: predictions.triglycerides,
      confidence,
      status: enabledState === 'ENABLED_HIGH_CONFIDENCE' ? 'OK' : 'LOW_CONFIDENCE',
      enabledState,
    };
    return this.lastOutput;
  }

  private ridgeSolve(X: number[][], y: number[], p: number, n: number, lambda: number): number[] {
    // XtX (p×p)
    const XtX: number[][] = Array.from({ length: p }, (_, i) =>
      Array.from({ length: p }, (_, j) =>
        X.reduce((s, row) => s + row[i] * row[j], 0) + (i === j ? lambda : 0)
      )
    );
    const Xty: number[] = Array.from({ length: p }, (_, i) =>
      X.reduce((s, row, r) => s + row[i] * y[r], 0)
    );
    return this.solveGE(XtX, Xty, p);
  }

  private solveGE(A: number[][], b: number[], n: number): number[] {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
      }
      [M[col], M[maxRow]] = [M[maxRow], M[col]];
      for (let row = col + 1; row < n; row++) {
        const f = M[row][col] / (M[col][col] || 1e-12);
        for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = M[i][n];
      for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
      x[i] /= M[i][i] || 1e-12;
    }
    return x;
  }

  reset(): void { this.lastOutput = null; }
  fullReset(): void { this.reset(); this.pendingSamples = []; this.isTraining = false; this.model = null; }
}
