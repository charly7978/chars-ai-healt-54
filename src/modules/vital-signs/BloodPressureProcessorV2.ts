/**
 * BLOOD PRESSURE PROCESSOR V2 - FASE 9 COMPLETA
 * 
 * Módulo cuffless calibrado por usuario con referencias reales de tensiómetro.
 */

import { OutputStatus, type BloodPressureOutput } from '../../types/measurement';

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export interface BPFeatureVector {
  pulseAmplitude: number;
  acdcRatio: number;
  sutMs: number;
  pw25Ms: number;
  pw50Ms: number;
  pw75Ms: number;
  crestTimeMs: number;
  areaUnderCurve: number;
  stiffnessIndex: number;
  augmentationIndex: number;
  dicroticNotchDepth: number;
  hr: number;
  rrVariability: number;
  perfusionIndex: number;
  contactQuality: number;
}

interface BPCalibrationPoint {
  timestamp: number;
  ppgFeatures: BPFeatureVector;
  referenceSBP: number;
  referenceDBP: number;
}

interface BPModelCoefficients {
  sbp: { intercept: number; weights: Record<string, number> };
  dbp: { intercept: number; weights: Record<string, number> };
}

interface BPCalibration {
  userId: string;
  referenceDevice: string;
  points: BPCalibrationPoint[];
  coefficients: BPModelCoefficients;
  calibrationDate: number;
  validityDays: number;
  rmseSBP: number;
  rmseDBP: number;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  MIN_CALIBRATION_POINTS: 3,
  MAX_CALIBRATION_AGE_DAYS: 30,
  MIN_SBP: 70, MAX_SBP: 220,
  MIN_DBP: 40, MAX_DBP: 130,
  MIN_SQI: 0.5,
  MIN_CONTACT_QUALITY: 0.6,
  EMA_ALPHA: 0.25,
};

// ═══════════════════════════════════════════════════════════════════
//  CLASE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export class BloodPressureProcessorV2 {
  private calibration: BPCalibration | null = null;
  private pendingCalibrationPoints: BPCalibrationPoint[] = [];
  private lastOutput: BloodPressureOutput | null = null;
  private calibrationWizardActive = false;
  private featureHistory: BPFeatureVector[] = [];
  private readonly HISTORY_SIZE = 20;
  
  startCalibrationWizard(referenceDevice: string, userId: string): void {
    this.calibrationWizardActive = true;
    this.pendingCalibrationPoints = [];
    console.log(`[BPV2] Calibration wizard started with ${referenceDevice}`);
  }
  
  addCalibrationPoint(
    ppgFeatures: BPFeatureVector,
    referenceSBP: number,
    referenceDBP: number
  ): { success: boolean; pointsCollected: number; pointsNeeded: number } {
    if (!this.calibrationWizardActive) {
      return { success: false, pointsCollected: 0, pointsNeeded: CONFIG.MIN_CALIBRATION_POINTS };
    }
    
    if (referenceSBP < CONFIG.MIN_SBP || referenceSBP > CONFIG.MAX_SBP ||
        referenceDBP < CONFIG.MIN_DBP || referenceDBP > CONFIG.MAX_DBP ||
        referenceSBP <= referenceDBP) {
      return { success: false, pointsCollected: this.pendingCalibrationPoints.length, 
               pointsNeeded: CONFIG.MIN_CALIBRATION_POINTS };
    }
    
    this.pendingCalibrationPoints.push({
      timestamp: Date.now(),
      ppgFeatures,
      referenceSBP,
      referenceDBP,
    });
    
    if (this.pendingCalibrationPoints.length >= CONFIG.MIN_CALIBRATION_POINTS) {
      this.computeCalibrationModel();
    }
    
    return {
      success: true,
      pointsCollected: this.pendingCalibrationPoints.length,
      pointsNeeded: Math.max(0, CONFIG.MIN_CALIBRATION_POINTS - this.pendingCalibrationPoints.length),
    };
  }
  
  finishCalibrationWizard(): { 
    success: boolean; 
    calibrationActive: boolean;
    pointsUsed: number;
    rmseSBP: number;
    rmseDBP: number;
  } {
    this.calibrationWizardActive = false;
    
    if (!this.calibration) {
      return { success: false, calibrationActive: false, pointsUsed: 0, rmseSBP: 0, rmseDBP: 0 };
    }
    
    return {
      success: true,
      calibrationActive: true,
      pointsUsed: this.calibration.points.length,
      rmseSBP: this.calibration.rmseSBP,
      rmseDBP: this.calibration.rmseDBP,
    };
  }
  
  private computeCalibrationModel(): void {
    if (this.pendingCalibrationPoints.length < CONFIG.MIN_CALIBRATION_POINTS) return;
    
    const n = this.pendingCalibrationPoints.length;
    const features = ['stiffnessIndex', 'augmentationIndex', 'sutMs', 'pw50Ms', 'hr'];
    
    const sbpWeights: Record<string, number> = {};
    const dbpWeights: Record<string, number> = {};
    
    for (const feature of features) {
      const fVals = this.pendingCalibrationPoints.map(p => p.ppgFeatures[feature as keyof BPFeatureVector] as number);
      const sbpVals = this.pendingCalibrationPoints.map(p => p.referenceSBP);
      const dbpVals = this.pendingCalibrationPoints.map(p => p.referenceDBP);
      
      sbpWeights[feature] = this.correlation(fVals, sbpVals) * 10;
      dbpWeights[feature] = this.correlation(fVals, dbpVals) * 10;
    }
    
    let sbpIntercept = this.mean(this.pendingCalibrationPoints.map(p => p.referenceSBP));
    let dbpIntercept = this.mean(this.pendingCalibrationPoints.map(p => p.referenceDBP));
    
    // Calcular RMSE
    let sbpSSE = 0, dbpSSE = 0;
    for (const point of this.pendingCalibrationPoints) {
      let sbpPred = sbpIntercept, dbpPred = dbpIntercept;
      for (const feature of features) {
        const val = point.ppgFeatures[feature as keyof BPFeatureVector] as number;
        sbpPred += sbpWeights[feature] * val;
        dbpPred += dbpWeights[feature] * val;
      }
      sbpSSE += Math.pow(sbpPred - point.referenceSBP, 2);
      dbpSSE += Math.pow(dbpPred - point.referenceDBP, 2);
    }
    
    const rmseSBP = Math.sqrt(sbpSSE / n);
    const rmseDBP = Math.sqrt(dbpSSE / n);
    
    if (rmseSBP < 15 && rmseDBP < 10) {
      this.calibration = {
        userId: 'user_calibrated',
        referenceDevice: 'bp_monitor',
        points: [...this.pendingCalibrationPoints],
        coefficients: {
          sbp: { intercept: sbpIntercept, weights: sbpWeights },
          dbp: { intercept: dbpIntercept, weights: dbpWeights },
        },
        calibrationDate: Date.now(),
        validityDays: CONFIG.MAX_CALIBRATION_AGE_DAYS,
        rmseSBP,
        rmseDBP,
      };
      console.log('[BPV2] Calibration model computed:', { rmseSBP: rmseSBP.toFixed(2), rmseDBP: rmseDBP.toFixed(2) });
    }
  }
  
  process(
    features: BPFeatureVector,
    sqi: number,
    beatCount: number,
    durationMs: number
  ): BloodPressureOutput {
    // GATE 0: Calibración
    if (!this.calibration) {
      return this.createBlockedOutput('needs_calibration', { reason: 'No user calibration available' });
    }
    
    const calAgeDays = (Date.now() - this.calibration.calibrationDate) / (1000 * 60 * 60 * 24);
    if (calAgeDays > this.calibration.validityDays) {
      return this.createBlockedOutput('calibration_stale', { calibrationAgeDays: calAgeDays });
    }
    
    // GATE 1: Calidad
    if (sqi < CONFIG.MIN_SQI) {
      return this.createBlockedOutput('low_snr', { sqi });
    }
    
    if (features.contactQuality < CONFIG.MIN_CONTACT_QUALITY) {
      return this.createBlockedOutput('unstable_contact', { contactQuality: features.contactQuality });
    }
    
    // Predict
    this.featureHistory.push(features);
    if (this.featureHistory.length > this.HISTORY_SIZE) this.featureHistory.shift();
    
    const smoothed = this.computeSmoothedFeatures();
    const prediction = this.predictWithModel(smoothed);
    
    // Validate
    if (prediction.sbp < CONFIG.MIN_SBP || prediction.sbp > CONFIG.MAX_SBP ||
        prediction.dbp < CONFIG.MIN_DBP || prediction.dbp > CONFIG.MAX_DBP) {
      return this.createBlockedOutput('blocked', { predictedSBP: prediction.sbp, predictedDBP: prediction.dbp });
    }
    
    // Smoothing
    let finalSBP = prediction.sbp, finalDBP = prediction.dbp;
    if (this.lastOutput?.value && typeof this.lastOutput.value === 'object') {
      const lastVal = this.lastOutput.value;
      finalSBP = lastVal.systolic * (1 - CONFIG.EMA_ALPHA) + prediction.sbp * CONFIG.EMA_ALPHA;
      finalDBP = lastVal.diastolic * (1 - CONFIG.EMA_ALPHA) + prediction.dbp * CONFIG.EMA_ALPHA;
    }
    
    const map = finalDBP + (finalSBP - finalDBP) / 3;
    
    let confidence = 0.5;
    confidence += Math.min(0.2, this.calibration.points.length / 20);
    if (this.calibration.rmseSBP < 5) confidence += 0.15;
    confidence += Math.min(0.1, sqi * 0.1);
    confidence = Math.max(0, Math.min(1, confidence));
    
    this.lastOutput = {
      value: {
        systolic: Math.round(finalSBP),
        diastolic: Math.round(finalDBP),
        map: Math.round(map),
      },
      unit: 'mmHg',
      confidence,
      status: confidence > 0.6 ? OutputStatus.OK : OutputStatus.LOW_QUALITY,
      qualityFlags: [],
      evidence: {
        sqi,
        acceptedWindows: this.featureHistory.length,
        acceptedBeats: beatCount,
        perfusionIndex: features.perfusionIndex,
        source: `calibrated_${this.calibration.points.length}pts`,
      },
      debug: { rawPrediction: prediction, smoothedFeatures: smoothed },
    };
    
    return this.lastOutput;
  }
  
  private predictWithModel(features: BPFeatureVector): { sbp: number; dbp: number } {
    let sbp = this.calibration!.coefficients.sbp.intercept;
    let dbp = this.calibration!.coefficients.dbp.intercept;
    
    for (const [feature, weight] of Object.entries(this.calibration!.coefficients.sbp.weights)) {
      sbp += weight * (features[feature as keyof BPFeatureVector] as number || 0);
    }
    for (const [feature, weight] of Object.entries(this.calibration!.coefficients.dbp.weights)) {
      dbp += weight * (features[feature as keyof BPFeatureVector] as number || 0);
    }
    
    return { sbp, dbp };
  }
  
  private computeSmoothedFeatures(): BPFeatureVector {
    if (this.featureHistory.length === 0) return {} as BPFeatureVector;
    const names = Object.keys(this.featureHistory[0]) as (keyof BPFeatureVector)[];
    const smoothed = {} as BPFeatureVector;
    for (const name of names) {
      const values = this.featureHistory.map(f => f[name] as number).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      (smoothed as any)[name] = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    }
    return smoothed;
  }
  
  private createBlockedOutput(
    reason: string,
    debugData: Record<string, any> = {}
  ): BloodPressureOutput {
    const statusMap: Record<string, OutputStatus> = {
      'needs_calibration': OutputStatus.NEEDS_CALIBRATION,
      'calibration_stale': OutputStatus.NEEDS_CALIBRATION,
      'low_snr': OutputStatus.BLOCKED,
      'unstable_contact': OutputStatus.BLOCKED,
      'blocked': OutputStatus.BLOCKED,
    };
    
    return {
      value: null,
      unit: 'mmHg',
      confidence: 0,
      status: statusMap[reason] || OutputStatus.BLOCKED,
      qualityFlags: [{ flag: 'device_uncalibrated', description: 'BP requires calibration', severity: 'error' }],
      evidence: {
        sqi: 0,
        acceptedWindows: 0,
        acceptedBeats: 0,
      },
      debug: debugData,
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
}
