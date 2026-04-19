/**
 * LIPID RESEARCH PROCESSOR V2 - FASE 11 COMPLETA
 * 
 * Motor de investigación cardiovascular/lípidos.
 * RESEARCH ONLY - Soporta modelos solo con paired labs reales.
 */

import { OutputStatus, type LipidOutput } from '../../types/measurement';

export interface LipidFeatureVector {
  stiffnessIndex: number;
  augmentationIndex: number;
  pulseWaveVelocity: number;
  pulseAmplitude: number;
  pulseWidth50: number;
  crestTime: number;
  areaUnderCurve: number;
  dicroticNotchDepth: number;
  hr: number;
  rmssd: number;
  sdnn: number;
  perfusionIndex: number;
  contactQuality: number;
  age?: number;
  gender?: 'M' | 'F';
}

interface LipidDatasetSample {
  timestamp: number;
  ppgFeatures: LipidFeatureVector;
  referenceLabs: {
    totalCholesterol: number;
    ldl: number;
    hdl: number;
    triglycerides: number;
  };
}

interface LipidCalibration {
  samples: LipidDatasetSample[];
  coefficients: {
    totalCholesterol: Record<string, number>;
    ldl: Record<string, number>;
    hdl: Record<string, number>;
    triglycerides: Record<string, number>;
  };
  intercepts: {
    totalCholesterol: number;
    ldl: number;
    hdl: number;
    triglycerides: number;
  };
  rmse: Record<string, number>;
  createdAt: number;
}

const CONFIG = {
  MIN_SAMPLES: 10,
  OPTIMAL_SAMPLES: 30,
  MAX_RMSE: 25,
  RECALIBRATION_DAYS: 90,
  MIN_SQI: 0.5,
};

export class LipidResearchProcessorV2 {
  private calibration: LipidCalibration | null = null;
  private pendingSamples: LipidDatasetSample[] = [];
  private isTrainingMode = false;
  
  startTraining(userId: string, labSource: string): void {
    this.isTrainingMode = true;
    this.pendingSamples = [];
  }
  
  addTrainingSample(
    ppgFeatures: LipidFeatureVector,
    referenceLabs: LipidDatasetSample['referenceLabs']
  ): { success: boolean; samples: number; canTrain: boolean } {
    if (!this.isTrainingMode) return { success: false, samples: 0, canTrain: false };
    
    this.pendingSamples.push({ timestamp: Date.now(), ppgFeatures, referenceLabs });
    
    if (this.pendingSamples.length >= CONFIG.MIN_SAMPLES) {
      this.trainModel();
    }
    
    return {
      success: true,
      samples: this.pendingSamples.length,
      canTrain: this.pendingSamples.length >= CONFIG.MIN_SAMPLES,
    };
  }
  
  private trainModel(): boolean {
    if (this.pendingSamples.length < CONFIG.MIN_SAMPLES) return false;
    
    const targets = ['totalCholesterol', 'ldl', 'hdl', 'triglycerides'] as const;
    const features = Object.keys(this.pendingSamples[0].ppgFeatures);
    
    this.calibration = {
      samples: [...this.pendingSamples],
      coefficients: { totalCholesterol: {}, ldl: {}, hdl: {}, triglycerides: {} },
      intercepts: { totalCholesterol: 180, ldl: 100, hdl: 50, triglycerides: 100 },
      rmse: { totalCholesterol: 999, ldl: 999, hdl: 999, triglycerides: 999 },
      createdAt: Date.now(),
    };
    
    for (const target of targets) {
      const coefficients: Record<string, number> = {};
      for (const feature of features) {
        const fVals = this.pendingSamples.map(s => s.ppgFeatures[feature as keyof LipidFeatureVector] as number || 0);
        const tVals = this.pendingSamples.map(s => s.referenceLabs[target]);
        coefficients[feature] = this.correlation(fVals, tVals) * 3;
      }
      
      const tVals = this.pendingSamples.map(s => s.referenceLabs[target]);
      let intercept = this.mean(tVals);
      
      let sse = 0;
      for (const sample of this.pendingSamples) {
        let pred = intercept;
        for (const feature of features) {
          pred += (coefficients[feature] || 0) * (sample.ppgFeatures[feature as keyof LipidFeatureVector] as number || 0);
        }
        sse += Math.pow(pred - sample.referenceLabs[target], 2);
      }
      
      this.calibration.coefficients[target] = coefficients;
      this.calibration.intercepts[target] = intercept;
      this.calibration.rmse[target] = Math.sqrt(sse / this.pendingSamples.length);
    }
    
    console.log('[LipidV2] Model trained, RMSE:', this.calibration.rmse);
    return true;
  }
  
  process(features: LipidFeatureVector, sqi: number): LipidsOutput {
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
    
    const targets = ['totalCholesterol', 'ldl', 'hdl', 'triglycerides'] as const;
    const predictions: Record<string, number> = {};
    
    for (const target of targets) {
      let pred = this.calibration.intercepts[target];
      for (const [feature, weight] of Object.entries(this.calibration.coefficients[target])) {
        pred += weight * (features[feature as keyof LipidFeatureVector] as number || 0);
      }
      predictions[target] = Math.round(Math.max(50, Math.min(400, pred)));
    }
    
    let confidence = 0.25;
    confidence += Math.min(0.15, this.calibration.samples.length / 200);
    for (const rmse of Object.values(this.calibration.rmse)) {
      if (rmse < 15) confidence += 0.1;
    }
    confidence = Math.max(0, Math.min(0.75, confidence));
    
    return {
      value: {
        totalCholesterol: predictions.totalCholesterol,
        ldl: predictions.ldl,
        hdl: predictions.hdl,
        triglycerides: predictions.triglycerides,
      },
      unit: 'mg/dL',
      confidence,
      status: OutputStatus.RESEARCH_ONLY,
      qualityFlags: [{ flag: 'research_only', description: 'Research use only', severity: 'info' }],
      evidence: {
        sqi,
        acceptedWindows: 1,
        source: `calibrated_${this.calibration.samples.length}pts`,
        perfusionIndex: features.perfusionIndex,
      },
      debug: { rmse: this.calibration.rmse },
    };
  }
  
  private createBlockedOutput(status: OutputStatus): LipidsOutput {
    return {
      value: null,
      unit: 'mg/dL',
      confidence: 0,
      status,
      qualityFlags: [{ flag: 'device_uncalibrated', description: 'Lipids require calibration', severity: 'error' }],
      evidence: {
        sqi: 0,
        acceptedWindows: 0,
        source: 'uncalibrated',
        perfusionIndex: 0,
      },
      debug: { reason: 'No calibration' },
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
    this.pendingSamples = [];
    this.isTrainingMode = false;
  }
}
