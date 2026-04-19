/**
 * GLUCOSE RESEARCH PROCESSOR V2 - FASE 10 COMPLETA
 * 
 * Módulo de investigación estricto. RESEARCH ONLY.
 * Requiere dataset de calibración con referencias reales.
 */

import { OutputStatus, type GlucoseOutput } from '../../types/measurement';

export interface GlucoseFeatureVector {
  pulseAmplitude: number;
  systolicUpstrokeTime: number;
  pulseWidth50: number;
  crestTime: number;
  areaUnderCurve: number;
  augmentationIndex: number;
  stiffnessIndex: number;
  redACDC: number;
  greenACDC: number;
  redGreenRatio: number;
  hr: number;
  rmssd: number;
  perfusionIndex: number;
}

interface GlucoseDatasetSample {
  timestamp: number;
  ppgFeatures: GlucoseFeatureVector;
  referenceGlucose: number;
}

interface GlucoseCalibration {
  samples: GlucoseDatasetSample[];
  coefficients: Record<string, number>;
  intercept: number;
  rmse: number;
  coverage: number;
  createdAt: number;
}

const CONFIG = {
  MIN_SAMPLES: 20,
  MAX_RMSE: 20,
  RECALIBRATION_DAYS: 90,
  MIN_SQI: 0.5,
  TARGET_RANGE: { min: 70, max: 180 },
};

export class GlucoseResearchProcessorV2 {
  private calibration: GlucoseCalibration | null = null;
  private pendingSamples: GlucoseDatasetSample[] = [];
  private isTrainingMode = false;
  private lastOutput: GlucoseOutput | null = null;
  private featureHistory: GlucoseFeatureVector[] = [];
  private readonly HISTORY_SIZE = 30;
  
  startTrainingMode(userId: string, referenceDevice: string): void {
    this.isTrainingMode = true;
    this.pendingSamples = [];
  }
  
  addTrainingSample(
    ppgFeatures: GlucoseFeatureVector,
    referenceGlucose: number
  ): { success: boolean; samplesCollected: number; coveragePercent: number; canTrain: boolean } {
    if (!this.isTrainingMode) return { success: false, samplesCollected: 0, coveragePercent: 0, canTrain: false };
    
    if (referenceGlucose < 40 || referenceGlucose > 400) {
      return { success: false, samplesCollected: this.pendingSamples.length, coveragePercent: 0, canTrain: false };
    }
    
    this.pendingSamples.push({ timestamp: Date.now(), ppgFeatures, referenceGlucose });
    
    if (this.pendingSamples.length >= CONFIG.MIN_SAMPLES) {
      this.trainModel();
    }
    
    const glucoses = this.pendingSamples.map(s => s.referenceGlucose);
    const minG = Math.min(...glucoses);
    const maxG = Math.max(...glucoses);
    const coverage = Math.min(1, (maxG - minG) / (CONFIG.TARGET_RANGE.max - CONFIG.TARGET_RANGE.min));
    
    return {
      success: true,
      samplesCollected: this.pendingSamples.length,
      coveragePercent: Math.round(coverage * 100),
      canTrain: this.pendingSamples.length >= CONFIG.MIN_SAMPLES,
    };
  }
  
  private trainModel(): boolean {
    if (this.pendingSamples.length < CONFIG.MIN_SAMPLES) return false;
    
    const features = Object.keys(this.pendingSamples[0].ppgFeatures);
    const coefficients: Record<string, number> = {};
    const glucoseValues = this.pendingSamples.map(s => s.referenceGlucose);
    
    for (const feature of features) {
      const fVals = this.pendingSamples.map(s => s.ppgFeatures[feature as keyof GlucoseFeatureVector] as number);
      coefficients[feature] = this.correlation(fVals, glucoseValues) * 5;
    }
    
    let intercept = this.mean(glucoseValues);
    let sse = 0;
    for (const sample of this.pendingSamples) {
      let pred = intercept;
      for (const feature of features) {
        pred += (coefficients[feature] || 0) * (sample.ppgFeatures[feature as keyof GlucoseFeatureVector] as number);
      }
      sse += Math.pow(pred - sample.referenceGlucose, 2);
    }
    
    const rmse = Math.sqrt(sse / this.pendingSamples.length);
    const glucoses = this.pendingSamples.map(s => s.referenceGlucose);
    const coverage = (Math.max(...glucoses) - Math.min(...glucoses)) / (CONFIG.TARGET_RANGE.max - CONFIG.TARGET_RANGE.min);
    
    this.calibration = {
      samples: [...this.pendingSamples],
      coefficients,
      intercept,
      rmse,
      coverage: Math.min(1, coverage),
      createdAt: Date.now(),
    };
    
    console.log('[GlucoseV2] Model trained:', { rmse: rmse.toFixed(2), coverage: (coverage * 100).toFixed(1) + '%' });
    return rmse < CONFIG.MAX_RMSE;
  }
  
  process(features: GlucoseFeatureVector, sqi: number, durationMs: number): GlucoseOutput {
    if (!this.calibration || this.calibration.samples.length < CONFIG.MIN_SAMPLES) {
      return this.createBlockedOutput(OutputStatus.NEEDS_CALIBRATION);
    }
    
    const ageDays = (Date.now() - this.calibration.createdAt) / (1000 * 60 * 60 * 24);
    if (ageDays > CONFIG.RECALIBRATION_DAYS) {
      return this.createBlockedOutput(OutputStatus.NEEDS_CALIBRATION);
    }
    
    if (sqi < CONFIG.MIN_SQI) {
      return this.createBlockedOutput(OutputStatus.BLOCKED);
    }
    
    this.featureHistory.push(features);
    if (this.featureHistory.length > this.HISTORY_SIZE) this.featureHistory.shift();
    
    const smoothed = this.computeSmoothedFeatures();
    let glucose = this.calibration.intercept;
    for (const [feature, weight] of Object.entries(this.calibration.coefficients)) {
      glucose += weight * (smoothed[feature as keyof GlucoseFeatureVector] as number || 0);
    }
    
    const clamped = Math.max(40, Math.min(400, glucose));
    
    let confidence = 0.3;
    confidence += Math.min(0.2, this.calibration.samples.length / 100);
    if (this.calibration.rmse < 15) confidence += 0.15;
    confidence = Math.max(0, Math.min(0.8, confidence));
    
    const trend = this.lastOutput?.value && typeof this.lastOutput.value === 'number'
      ? (clamped - this.lastOutput.value > 5 ? 'RISING' : clamped - this.lastOutput.value < -5 ? 'FALLING' : 'STABLE')
      : 'UNKNOWN';
    
    this.lastOutput = {
      value: Math.round(clamped),
      unit: 'mg/dL',
      confidence,
      status: OutputStatus.RESEARCH_ONLY,
      researchMode: true,
      qualityFlags: [{ flag: 'research_only', description: 'Research use only', severity: 'info' }],
      evidence: {
        sqi,
        acceptedWindows: this.featureHistory.length,
        source: `calibrated_${this.calibration.samples.length}pts`,
        userCalibration: `coverage_${(this.calibration.coverage * 100).toFixed(0)}pct`,
      },
      debug: { rawPrediction: glucose, calibrationRMSE: this.calibration.rmse },
    };
    
    return this.lastOutput;
  }
  
  private computeSmoothedFeatures(): GlucoseFeatureVector {
    if (this.featureHistory.length === 0) return {} as GlucoseFeatureVector;
    const names = Object.keys(this.featureHistory[0]) as (keyof GlucoseFeatureVector)[];
    const smoothed = {} as GlucoseFeatureVector;
    for (const name of names) {
      const values = this.featureHistory.map(f => f[name] as number).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      (smoothed as any)[name] = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    }
    return smoothed;
  }
  
  private createBlockedOutput(status: OutputStatus): GlucoseOutput {
    return {
      value: null,
      unit: 'mg/dL',
      confidence: 0,
      status,
      researchMode: true,
      qualityFlags: [{ flag: 'device_uncalibrated', description: 'Glucose requires calibration', severity: 'error' }],
      evidence: {
        sqi: 0,
        acceptedWindows: 0,
        source: 'uncalibrated',
        userCalibration: this.calibration ? `samples_${this.calibration.samples.length}` : 'none',
      },
      debug: {},
    };
  }
  
  private mean(arr: number[]): number { return arr.reduce((a, b) => a + b, 0) / (arr.length || 1); }
  private correlation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    const mx = this.mean(x.slice(0, n)), my = this.mean(y.slice(0, n));
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      num += dx * dy; denX += dx * dx; denY += dy * dy;
    }
    return num / (Math.sqrt(denX) * Math.sqrt(denY) + 0.001);
  }
  
  reset(): void {
    this.featureHistory = [];
    this.lastOutput = null;
  }

  fullReset(): void {
    this.reset();
    this.pendingSamples = [];
    this.isTrainingMode = false;
    this.calibration = null;
  }
}
