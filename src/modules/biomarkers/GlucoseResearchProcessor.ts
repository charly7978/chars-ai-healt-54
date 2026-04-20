/**
 * GLUCOSE RESEARCH PROCESSOR V3 — MODELO ESPECTROFOTOMÉTRICO MULTI-CANAL
 *
 * Principio biofísico:
 *   La glucosa en sangre modifica la absorción de luz en el espectro
 *   visible/NIR de la piel mediante:
 *     1. Efecto scattering: la glucosa reduce el coeficiente de
 *        dispersión reducido μs' en ~0.001 mm⁻¹ por mmol/L (Maier 1994)
 *     2. Absorción directa: pico absorbancia ~1050nm, ~1126nm
 *     3. Efecto en perfusión: variaciones de osmolaridad afectan
 *        el tono vasomotor y la morfología PPG
 *
 * Features optimizados para glucosa (Satter 2024, Shokrekhodaei 2020):
 *   - Ratio R/G (proxy diferencial absorción 660nm vs 530nm)
 *   - Ratio R/B (660nm vs 450nm — mayor diferencial glucosa)
 *   - Perfusion Index verde (correlaciona con visco-sidad sanguínea)
 *   - AC/DC ratio en canal verde (sensible a cambios en μs')
 *   - Stiffness Index (rigidez arterial aumenta con DM2)
 *   - Augmentation Index (mayor en DM2 por pérdida elasticidad)
 *   - SUT (sistólico upstroke): más lento en hiperglucemia
 *   - RMSSD (baja en DM2 por neuropatía autonómica)
 *   - dicrotic notch depth (cambia con viscosidad sanguínea)
 *
 * Modelo: Ridge Regression en espacio de features normalizado.
 * Salida: estimación en mg/dL con incertidumbre calibrada.
 *
 * IMPORTANTE: Este módulo requiere calibración individual con
 * glucómetro de referencia. Sin calibración, estado = NEEDS_CALIBRATION.
 *
 * Referencias:
 *   - Shokrekhodaei & Quinones 2021 IEEE Access (PPG glucose review)
 *   - Satter et al. 2024 Diagnostics (PPG morphology glucose)
 *   - Maier et al. 1994 Optics Letters (scattering coefficient)
 *   - Vashist 2012 Analytica Chimica Acta (non-invasive glucose review)
 */

export interface GlucoseFeatureVector {
  // Spectral channel ratios (proxy de absorción diferencial)
  rgRatio: number;       // Red/Green AC ratio
  rbRatio: number;       // Red/Blue AC ratio
  gbRatio: number;       // Green/Blue AC ratio
  // Perfusion
  piGreen: number;       // Perfusion index green (%)
  piRed: number;         // Perfusion index red (%)
  piRatio: number;       // piRed/piGreen
  // Morphological (correlates with blood viscosity/vessel stiffness)
  sutMs: number;
  pw50Ms: number;
  augmentationIndex: number;
  stiffnessIndex: number;
  dicroticDepth: number;
  areaRatio: number;
  // HRV (autonomic neuropathy marker)
  rmssd: number;
  sdnn: number;
  pnn50: number;
  // Context
  hr: number;
  // DC channel intensities (scattering proxy)
  redDC: number;
  greenDC: number;
}

interface GluTrainingSample {
  timestamp: number;
  features: GlucoseFeatureVector;
  referenceGlucose: number;
}

interface GluModel {
  samples: GluTrainingSample[];
  // Normalized feature means and stds
  featureMeans: Record<string, number>;
  featureStds: Record<string, number>;
  // Ridge regression weights (on normalized features)
  weights: Record<string, number>;
  intercept: number;
  ridgeLambda: number;
  rmse: number;
  coverage: number; // fraction of 70-400 mg/dL range covered
  createdAt: number;
}

export interface GlucoseResult {
  value: number;
  confidence: number;
  status: string;
  enabledState: 'ENABLED_HIGH_CONFIDENCE' | 'ENABLED_MEDIUM_CONFIDENCE' | 'ENABLED_LOW_CONFIDENCE' | 'WITHHELD_LOW_QUALITY' | 'NEEDS_CALIBRATION';
  trend?: 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN';
  uncertainty: number; // ±mg/dL
}

const MIN_SAMPLES = 15;
const TARGET_RANGE = { min: 70, max: 400 };
const RECAL_DAYS = 90;

export class GlucoseResearchProcessor {
  private model: GluModel | null = null;
  private pendingSamples: GluTrainingSample[] = [];
  private isTraining = false;
  private lastValue = 0;
  private lastTimestamp = 0;
  private featureHistory: GlucoseFeatureVector[] = [];

  startTrainingMode(_userId: string, _device: string): void {
    this.isTraining = true;
    this.pendingSamples = [];
  }

  addTrainingSample(
    features: GlucoseFeatureVector,
    referenceGlucose: number
  ): { success: boolean; samplesCollected: number; coveragePercent: number; canTrain: boolean } {
    if (!this.isTraining || referenceGlucose < 40 || referenceGlucose > 500) {
      return { success: false, samplesCollected: 0, coveragePercent: 0, canTrain: false };
    }
    this.pendingSamples.push({ timestamp: Date.now(), features, referenceGlucose });
    if (this.pendingSamples.length >= MIN_SAMPLES) this.trainRidge();

    const gVals = this.pendingSamples.map(s => s.referenceGlucose);
    const coverage = Math.min(1, (Math.max(...gVals) - Math.min(...gVals)) / (TARGET_RANGE.max - TARGET_RANGE.min));
    return {
      success: true,
      samplesCollected: this.pendingSamples.length,
      coveragePercent: Math.round(coverage * 100),
      canTrain: this.pendingSamples.length >= MIN_SAMPLES,
    };
  }

  // ── Ridge Regression Training ──────────────────────────────
  private trainRidge(): void {
    const n = this.pendingSamples.length;
    if (n < MIN_SAMPLES) return;

    const featureNames = Object.keys(this.pendingSamples[0].features) as (keyof GlucoseFeatureVector)[];
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};

    // Compute per-feature mean and std
    for (const fname of featureNames) {
      const vals = this.pendingSamples.map(s => s.features[fname] as number);
      const m = vals.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / n);
      means[fname as string] = m;
      stds[fname as string] = Math.max(1e-8, std);
    }

    // Build design matrix X (n × p) normalized
    const p = featureNames.length;
    const X: number[][] = this.pendingSamples.map(s =>
      featureNames.map(f => (s.features[f] as number - means[f as string]) / stds[f as string])
    );
    const y = this.pendingSamples.map(s => s.referenceGlucose);
    const yMean = y.reduce((a, b) => a + b, 0) / n;

    // Choose ridge lambda via L-curve (simple heuristic: lambda = n / trace(X'X))
    const lambda = Math.max(0.1, n / (p * p));

    // Ridge solution: w = (X'X + λI)^{-1} X'y
    // For p ≤ 20 use direct inversion (Cholesky not needed here)
    const XtX = this.matMul(this.transpose(X), X, p, n, p);
    for (let i = 0; i < p; i++) XtX[i][i] += lambda;
    const Xty = this.matVecMul(this.transpose(X), y.map(v => v - yMean), p, n);
    const w = this.solveLinearSystem(XtX, Xty, p);

    const weights: Record<string, number> = {};
    for (let i = 0; i < p; i++) weights[featureNames[i] as string] = w[i];

    // RMSE on training set
    let sse = 0;
    for (let i = 0; i < n; i++) {
      let pred = yMean;
      for (let j = 0; j < p; j++) pred += w[j] * X[i][j];
      sse += (pred - y[i]) ** 2;
    }
    const rmse = Math.sqrt(sse / n);

    const gVals = y;
    const coverage = (Math.max(...gVals) - Math.min(...gVals)) / (TARGET_RANGE.max - TARGET_RANGE.min);

    this.model = {
      samples: [...this.pendingSamples],
      featureMeans: means,
      featureStds: stds,
      weights,
      intercept: yMean,
      ridgeLambda: lambda,
      rmse,
      coverage: Math.min(1, coverage),
      createdAt: Date.now(),
    };
  }

  // ── Process ───────────────────────────────────────────────
  process(input: {
    cycleFeatures: {
      sutMs: number; pw50Ms: number; pw75Ms: number; pw25Ms: number;
      augmentationIndex: number; stiffnessIndex: number;
      dicroticDepth: number; areaRatio: number;
    };
    hr: number;
    rrVar: { sdnn: number; rmssd: number; cv: number };
    piGreen: number;
    rgACRatio: number;
    contactStable: boolean;
    signalQuality: number;
    beatCount: number;
    redAC?: number; redDC?: number; greenAC?: number; greenDC?: number;
    blueAC?: number; blueDC?: number;
  }): GlucoseResult {
    const blocked: GlucoseResult = {
      value: 0, confidence: 0, status: 'NEEDS_CALIBRATION',
      enabledState: 'NEEDS_CALIBRATION',
      trend: 'UNKNOWN', uncertainty: 999,
    };

    // Regla estricta anti-invención:
    // sin modelo calibrado NO se publica valor numérico de glucosa.
    if (!input.contactStable || input.signalQuality < 12) {
      return { ...blocked, enabledState: 'WITHHELD_LOW_QUALITY', status: 'LOW_QUALITY' };
    }
    const ageDays = this.model ? (Date.now() - this.model.createdAt) / 86400000 : Infinity;
    const haveCalib = !!this.model && ageDays <= RECAL_DAYS;
    if (!haveCalib) {
      return blocked;
    }

    const { cycleFeatures: cf, hr, rrVar, piGreen } = input;
    const redDC = input.redDC ?? 128;
    const greenDC = input.greenDC ?? 128;
    const redAC = input.redAC ?? 1;
    const greenAC = input.greenAC ?? 1;
    const blueAC = input.blueAC ?? 0.5;
    const blueDC = input.blueDC ?? 128;

    const piRed = redDC > 0 ? (redAC / redDC) * 100 : 0;
    const piGreenAct = greenDC > 0 ? (greenAC / greenDC) * 100 : piGreen;

    const features: GlucoseFeatureVector = {
      rgRatio: greenAC > 0 ? redAC / greenAC : 0,
      rbRatio: blueAC > 0 ? redAC / blueAC : 0,
      gbRatio: blueAC > 0 ? greenAC / blueAC : 0,
      piGreen: piGreenAct,
      piRed,
      piRatio: piGreenAct > 0 ? piRed / piGreenAct : 0,
      sutMs: cf.sutMs,
      pw50Ms: cf.pw50Ms,
      augmentationIndex: cf.augmentationIndex,
      stiffnessIndex: cf.stiffnessIndex,
      dicroticDepth: cf.dicroticDepth,
      areaRatio: cf.areaRatio,
      rmssd: rrVar.rmssd,
      sdnn: rrVar.sdnn,
      pnn50: 0,
      hr,
      redDC, greenDC,
    };

    this.featureHistory.push(features);
    if (this.featureHistory.length > 30) this.featureHistory.shift();

    // Median-smoothed features
    const smoothed = this.medianSmooth(this.featureHistory);

    const model = this.model!;
    const fnames = Object.keys(model.weights);
    let glucose = model.intercept;
    for (const fname of fnames) {
      const raw = (smoothed as any)[fname] ?? 0;
      const norm = (raw - model.featureMeans[fname]) / model.featureStds[fname];
      glucose += model.weights[fname] * norm;
    }

    const clamped = Math.max(40, Math.min(500, glucose));

    // Trend
    const trend = this.lastValue > 0
      ? (clamped - this.lastValue > 8 ? 'RISING' : clamped - this.lastValue < -8 ? 'FALLING' : 'STABLE')
      : 'UNKNOWN';

    this.lastValue = clamped;
    this.lastTimestamp = Date.now();

    // Confidence
    let confidence = 0.30;
    confidence += Math.min(0.20, model.samples.length / 75);
    if (model.rmse < 15) confidence += 0.15;
    if (model.rmse < 10) confidence += 0.10;
    confidence += Math.min(0.10, input.signalQuality / 1000);
    confidence = Math.min(0.80, confidence);
    const uncertainty = model.rmse;

    const enabledState =
      confidence >= 0.60 ? 'ENABLED_HIGH_CONFIDENCE'
      : confidence >= 0.40 ? 'ENABLED_MEDIUM_CONFIDENCE'
      : confidence >= 0.20 ? 'ENABLED_LOW_CONFIDENCE'
      : 'WITHHELD_LOW_QUALITY';

    return {
      value: Math.round(clamped),
      confidence,
      status: enabledState === 'ENABLED_HIGH_CONFIDENCE' ? 'OK' : 'LOW_CONFIDENCE',
      enabledState,
      trend: trend as 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN',
      uncertainty,
    };
  }

  // ── Linear algebra helpers ────────────────────────────────
  private transpose(A: number[][]): number[][] {
    if (A.length === 0) return [];
    const rows = A.length, cols = A[0].length;
    return Array.from({ length: cols }, (_, j) => Array.from({ length: rows }, (_, i) => A[i][j]));
  }

  private matMul(A: number[][], B: number[][], rA: number, cA: number, cB: number): number[][] {
    const C: number[][] = Array.from({ length: rA }, () => new Array(cB).fill(0));
    for (let i = 0; i < rA; i++) {
      for (let k = 0; k < cA; k++) {
        for (let j = 0; j < cB; j++) {
          C[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return C;
  }

  private matVecMul(A: number[][], v: number[], rows: number, cols: number): number[] {
    const res = new Array(rows).fill(0);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) res[i] += A[i][j] * v[j];
    }
    return res;
  }

  /** Gaussian elimination with partial pivoting */
  private solveLinearSystem(A: number[][], b: number[], n: number): number[] {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
      }
      [M[col], M[maxRow]] = [M[maxRow], M[col]];
      for (let row = col + 1; row < n; row++) {
        const factor = M[row][col] / (M[col][col] || 1e-12);
        for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
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

  private medianSmooth(history: GlucoseFeatureVector[]): GlucoseFeatureVector {
    if (history.length === 0) return {} as GlucoseFeatureVector;
    const keys = Object.keys(history[0]) as (keyof GlucoseFeatureVector)[];
    const res = {} as GlucoseFeatureVector;
    for (const k of keys) {
      const vals = history.map(h => h[k] as number).sort((a, b) => a - b);
      const mid = Math.floor(vals.length / 2);
      (res as any)[k] = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    }
    return res;
  }

  reset(): void { this.featureHistory = []; this.lastValue = 0; }
  fullReset(): void { this.reset(); this.pendingSamples = []; this.isTraining = false; this.model = null; }
}
