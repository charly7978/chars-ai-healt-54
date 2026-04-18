/**
 * GLUCOSE RESEARCH PROCESSOR V2 - FASE 10 COMPLETA
 * 
 * Módulo de investigación estricto para glucosa.
 * RESEARCH ONLY - NO CLÍNICO sin dataset emparejado real.
 * 
 * Principios:
 * 1. Sin dataset de calibración → status "research_only", value = null
 * 2. Dataset requiere: PPG + timestamp + referencia capilar/CGM/lab real
 * 3. Features multicanal, morfológicas, espectrales, contextuales
 * 4. Permitir entrenamiento/inferencia solo con modelo personalizado
 * 5. Ocultar al usuario final si no hay validez mínima
 * 
 * Dataset Structure:
 * {
 *   samples: Array<{
 *     ppgFeatures: GlucoseFeatureVector,
 *     referenceGlucose: number,  // mg/dL from lab/CGM
 *     timestamp: number,
 *     context: { fasting, timeOfDay, temperature }
 *   }>,
 *   model: trainedModel,
 *   coverage: number,  // 0-1 cobertura del rango glucémico
 * }
 */

import type { GlucoseOutput, QualityFlag } from '../../types/measurement';

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GlucoseFeatureVector {
  // PPG morphology
  pulseAmplitude: number;
  systolicUpstrokeTime: number;
  pulseWidth50: number;
  crestTime: number;
  areaUnderCurve: number;
  augmentationIndex: number;
  stiffnessIndex: number;
  dicroticNotchDepth: number;
  
  // Multicanal optical
  redACDC: number;
  greenACDC: number;
  blueACDC: number;
  redGreenRatio: number;
  odRed: number;      // Optical density
  odGreen: number;
  odBlue: number;
  
  // Spectral features
  dominantFreq: number;
  spectralEntropy: number;
  harmonicRatio: number;
  
  // HRV/Context
  hr: number;
  rmssd: number;
  perfusionIndex: number;
  
  // User context (optional)
  fasting?: boolean;
  timeSinceLastMeal?: number;
}

interface GlucoseDatasetSample {
  timestamp: number;
  ppgFeatures: GlucoseFeatureVector;
  referenceGlucose: number;  // mg/dL
  context?: {
    fasting?: boolean;
    timeOfDay?: number;
    temperature?: number;
  };
}

interface GlucoseCalibration {
  userId: string;
  referenceDevice: string;  // e.g., 'FreeStyle Libre', 'Accu-Chek'
  samples: GlucoseDatasetSample[];
  
  // Modelo simple: combinación lineal pesada
  coefficients: Record<string, number>;
  intercept: number;
  
  // Metadatos
  createdAt: number;
  updatedAt: number;
  coverage: {
    minGlucose: number;
    maxGlucose: number;
    rangeCoverage: number;  // 0-1
  };
  rmse: number;
  mae: number;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  // Dataset mínimo
  MIN_SAMPLES: 20,
  OPTIMAL_SAMPLES: 50,
  MAX_SAMPLES: 200,
  
  // Rango glucémico a cubrir
  TARGET_MIN_GLUCOSE: 70,
  TARGET_MAX_GLUCOSE: 180,
  MIN_RANGE_COVERAGE: 0.6,  // Cubrir 60% del rango
  
  // Gates de calidad
  MIN_SQI: 0.5,
  MIN_CONTACT_QUALITY: 0.6,
  MIN_PERFUSION: 0.02,
  MIN_MEASUREMENT_DURATION_MS: 30000,  // 30 seg mínimo
  
  // Modelo
  MAX_RMSE_FOR_PUBLICATION: 20,  // mg/dL
  RECALIBRATION_DAYS: 90,
  
  // Constantes fisiológicas
  NORMAL_FASTING_MIN: 70,
  NORMAL_FASTING_MAX: 100,
  DIABETIC_THRESHOLD: 126,
};

// ═══════════════════════════════════════════════════════════════════
//  CLASE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export class GlucoseResearchProcessorV2 {
  private calibration: GlucoseCalibration | null = null;
  private pendingSamples: GlucoseDatasetSample[] = [];
  private isTrainingMode = false;
  private lastOutput: GlucoseOutput | null = null;
  private featureHistory: GlucoseFeatureVector[] = [];
  private readonly HISTORY_SIZE = 30;
  
  /**
   * Activar modo entrenamiento (recolectar dataset)
   */
  startTrainingMode(userId: string, referenceDevice: string): void {
    this.isTrainingMode = true;
    this.pendingSamples = [];
    this.calibration = {
      userId,
      referenceDevice,
      samples: [],
      coefficients: {},
      intercept: 90,  // Default population mean
      createdAt: Date.now(),
      updatedAt: Date.now(),
      coverage: { minGlucose: 999, maxGlucose: 0, rangeCoverage: 0 },
      rmse: 999,
      mae: 999,
    };
    console.log(`[GlucoseV2] Training mode started for user ${userId}`);
  }
  
  /**
   * Agregar muestra de entrenamiento con referencia real
   */
  addTrainingSample(
    ppgFeatures: GlucoseFeatureVector,
    referenceGlucose: number,
    context?: { fasting?: boolean; timeOfDay?: number }
  ): { 
    success: boolean; 
    samplesCollected: number;
    coveragePercent: number;
    canTrain: boolean;
  } {
    if (!this.isTrainingMode || !this.calibration) {
      return { success: false, samplesCollected: 0, coveragePercent: 0, canTrain: false };
    }
    
    // Validar referencia
    if (referenceGlucose < 40 || referenceGlucose > 400) {
      return { 
        success: false, 
        samplesCollected: this.pendingSamples.length,
        coveragePercent: this.computeCoveragePercent(),
        canTrain: false,
      };
    }
    
    this.pendingSamples.push({
      timestamp: Date.now(),
      ppgFeatures,
      referenceGlucose,
      context,
    });
    
    // Limitar
    if (this.pendingSamples.length > CONFIG.MAX_SAMPLES) {
      this.pendingSamples.shift();
    }
    
    // Auto-entrenar si hay suficientes muestras
    if (this.pendingSamples.length >= CONFIG.MIN_SAMPLES) {
      this.trainModel();
    }
    
    return {
      success: true,
      samplesCollected: this.pendingSamples.length,
      coveragePercent: this.computeCoveragePercent(),
      canTrain: this.pendingSamples.length >= CONFIG.MIN_SAMPLES,
    };
  }
  
  /**
   * Finalizar entrenamiento y guardar modelo
   */
  finishTraining(): {
    success: boolean;
    samplesUsed: number;
    rmse: number;
    coveragePercent: number;
    canPublish: boolean;
  } {
    this.isTrainingMode = false;
    
    if (!this.calibration || this.pendingSamples.length < CONFIG.MIN_SAMPLES) {
      return {
        success: false,
        samplesUsed: this.pendingSamples.length,
        rmse: 999,
        coveragePercent: 0,
        canPublish: false,
      };
    }
    
    const result = this.trainModel();
    
    return {
      success: result,
      samplesUsed: this.calibration.samples.length,
      rmse: this.calibration.rmse,
      coveragePercent: this.computeCoveragePercent(),
      canPublish: this.canPublishResults(),
    };
  }
  
  /**
   * Entrenar modelo desde muestras pendientes
   */
  private trainModel(): boolean {
    if (this.pendingSamples.length < CONFIG.MIN_SAMPLES) return false;
    
    // Calcular correlaciones de features con glucosa
    const featureNames = Object.keys(this.pendingSamples[0].ppgFeatures);
    const coefficients: Record<string, number> = {};
    
    const glucoseValues = this.pendingSamples.map(s => s.referenceGlucose);
    const meanGlucose = this.mean(glucoseValues);
    
    for (const feature of featureNames) {
      const featureValues = this.pendingSamples.map(s => 
        s.ppgFeatures[feature as keyof GlucoseFeatureVector] as number || 0
      );
      
      const correlation = this.correlation(featureValues, glucoseValues);
      // Peso proporcional a correlación, con signo
      coefficients[feature] = correlation * 5;  // Escalar para magnitud
    }
    
    // Calcular intercepto
    let intercept = meanGlucose;
    for (const sample of this.pendingSamples) {
      let pred = 0;
      for (const feature of featureNames) {
        const val = sample.ppgFeatures[feature as keyof GlucoseFeatureVector] as number || 0;
        pred += coefficients[feature] * val;
      }
      intercept += sample.referenceGlucose - pred;
    }
    intercept /= this.pendingSamples.length;
    
    // Calcular métricas
    let sse = 0;
    let sae = 0;
    let minG = 999;
    let maxG = 0;
    
    for (const sample of this.pendingSamples) {
      const pred = this.predictWithModel(sample.ppgFeatures, coefficients, intercept);
      const error = pred - sample.referenceGlucose;
      sse += error * error;
      sae += Math.abs(error);
      minG = Math.min(minG, sample.referenceGlucose);
      maxG = Math.max(maxG, sample.referenceGlucose);
    }
    
    const n = this.pendingSamples.length;
    const rmse = Math.sqrt(sse / n);
    const mae = sae / n;
    
    // Calcular cobertura de rango
    const coveredRange = maxG - minG;
    const targetRange = CONFIG.TARGET_MAX_GLUCOSE - CONFIG.TARGET_MIN_GLUCOSE;
    const rangeCoverage = Math.min(1, coveredRange / targetRange);
    
    // Guardar calibración
    this.calibration.samples = [...this.pendingSamples];
    this.calibration.coefficients = coefficients;
    this.calibration.intercept = intercept;
    this.calibration.rmse = rmse;
    this.calibration.mae = mae;
    this.calibration.coverage = {
      minGlucose: minG,
      maxGlucose: maxG,
      rangeCoverage,
    };
    this.calibration.updatedAt = Date.now();
    
    console.log('[GlucoseV2] Model trained:', { rmse: rmse.toFixed(2), mae: mae.toFixed(2), rangeCoverage: (rangeCoverage * 100).toFixed(1) + '%' });
    
    return rmse < CONFIG.MAX_RMSE_FOR_PUBLICATION && rangeCoverage >= CONFIG.MIN_RANGE_COVERAGE;
  }
  
  /**
   * Procesar y estimar glucosa
   */
  process(
    features: GlucoseFeatureVector,
    sqi: number,
    durationMs: number
  ): GlucoseOutput {
    // ═══════════════════════════════════════════════════════════════
    //  GATE 0: Dataset de calibración disponible
    // ═══════════════════════════════════════════════════════════════
    if (!this.calibration || this.calibration.samples.length < CONFIG.MIN_SAMPLES) {
      return this.createResearchOutput('device_uncalibrated', {
        reason: 'No calibration dataset available',
        minSamples: CONFIG.MIN_SAMPLES,
        currentSamples: this.calibration?.samples.length || 0,
      });
    }
    
    // Verificar frescura
    const calibrationAgeDays = (Date.now() - this.calibration.updatedAt) / (1000 * 60 * 60 * 24);
    if (calibrationAgeDays > CONFIG.RECALIBRATION_DAYS) {
      return this.createResearchOutput('calibration_stale', {
        calibrationAgeDays,
        maxDays: CONFIG.RECALIBRATION_DAYS,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 1: Calidad suficiente
    // ═══════════════════════════════════════════════════════════════
    if (sqi < CONFIG.MIN_SQI) {
      return this.createResearchOutput('low_snr', { sqi, minSQI: CONFIG.MIN_SQI });
    }
    
    if (durationMs < CONFIG.MIN_MEASUREMENT_DURATION_MS) {
      return this.createResearchOutput('measurement_duration_insufficient', {
        durationMs,
        minRequired: CONFIG.MIN_MEASUREMENT_DURATION_MS,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  PREDECIR
    // ═══════════════════════════════════════════════════════════════
    this.featureHistory.push(features);
    if (this.featureHistory.length > this.HISTORY_SIZE) {
      this.featureHistory.shift();
    }
    
    // Suavizar features
    const smoothed = this.computeSmoothedFeatures();
    const glucose = this.predictWithModel(smoothed, this.calibration.coefficients, this.calibration.intercept);
    
    // Clamp a rango fisiológico plausible
    const clampedGlucose = Math.max(40, Math.min(400, glucose));
    
    // Confidence
    let confidence = 0.3;  // Base baja por ser research
    confidence += Math.min(0.2, this.calibration.samples.length / 100);
    if (this.calibration.rmse < 15) confidence += 0.15;
    if (this.calibration.coverage.rangeCoverage > 0.7) confidence += 0.1;
    confidence += Math.min(0.15, sqi * 0.15);
    confidence = Math.max(0, Math.min(0.8, confidence));  // Máximo 0.8 para research
    
    // Determinar trend
    let trend: GlucoseOutput['evidence']['trend'] = 'UNKNOWN';
    if (this.lastOutput?.value && typeof this.lastOutput.value === 'number') {
      const delta = clampedGlucose - this.lastOutput.value;
      if (delta > 5) trend = 'RISING';
      else if (delta < -5) trend = 'FALLING';
      else trend = 'STABLE';
    }
    
    this.lastOutput = {
      value: Math.round(clampedGlucose),
      unit: 'mg/dL',
      confidence,
      status: 'research_only',  // SIEMPRE research_only
      qualityFlags: ['research_only'],
      evidence: {
        sqi,
        acceptedWindows: this.featureHistory.length,
        totalWindows: this.HISTORY_SIZE,
        acceptedBeats: 0,
        totalBeats: 0,
        measurementDurationMs: durationMs,
        effectiveFps: 0,
        // Glucose-specific
        calibrationPoints: this.calibration.samples.length,
        calibrationCoverage: this.calibration.coverage.rangeCoverage,
        trend,
        featureImportance: this.getTopFeatures(3),
      },
      debug: {
        rawPrediction: glucose,
        calibrationRMSE: this.calibration.rmse,
        calibrationMAE: this.calibration.mae,
        coverage: this.calibration.coverage,
        smoothedFeatures: smoothed,
      },
    };
    
    return this.lastOutput;
  }
  
  /**
   * Predecir con modelo
   */
  private predictWithModel(
    features: GlucoseFeatureVector,
    coefficients: Record<string, number>,
    intercept: number
  ): number {
    let glucose = intercept;
    
    for (const [feature, weight] of Object.entries(coefficients)) {
      const value = features[feature as keyof GlucoseFeatureVector] as number || 0;
      glucose += weight * value;
    }
    
    return glucose;
  }
  
  /**
   * Verificar si se pueden publicar resultados
   */
  private canPublishResults(): boolean {
    if (!this.calibration) return false;
    
    return (
      this.calibration.samples.length >= CONFIG.OPTIMAL_SAMPLES &&
      this.calibration.rmse < CONFIG.MAX_RMSE_FOR_PUBLICATION &&
      this.calibration.coverage.rangeCoverage >= CONFIG.MIN_RANGE_COVERAGE
    );
  }
  
  /**
   * Calcular porcentaje de cobertura
   */
  private computeCoveragePercent(): number {
    if (this.pendingSamples.length === 0) return 0;
    
    const glucoses = this.pendingSamples.map(s => s.referenceGlucose);
    const minG = Math.min(...glucoses);
    const maxG = Math.max(...glucoses);
    const coveredRange = maxG - minG;
    const targetRange = CONFIG.TARGET_MAX_GLUCOSE - CONFIG.TARGET_MIN_GLUCOSE;
    
    return Math.min(100, Math.round((coveredRange / targetRange) * 100));
  }
  
  /**
   * Computar features suavizadas
   */
  private computeSmoothedFeatures(): GlucoseFeatureVector {
    if (this.featureHistory.length === 0) {
      return this.createEmptyFeatures();
    }
    
    const names = Object.keys(this.featureHistory[0]) as (keyof GlucoseFeatureVector)[];
    const smoothed = {} as GlucoseFeatureVector;
    
    for (const name of names) {
      const values = this.featureHistory.map(f => f[name] as number).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      (smoothed as any)[name] = values.length % 2 ? 
        values[mid] : (values[mid - 1] + values[mid]) / 2;
    }
    
    return smoothed;
  }
  
  /**
   * Crear features vacías
   */
  private createEmptyFeatures(): GlucoseFeatureVector {
    return {
      pulseAmplitude: 0, systolicUpstrokeTime: 0, pulseWidth50: 0,
      crestTime: 0, areaUnderCurve: 0, augmentationIndex: 0,
      stiffnessIndex: 0, dicroticNotchDepth: 0,
      redACDC: 0, greenACDC: 0, blueACDC: 0, redGreenRatio: 0,
      odRed: 0, odGreen: 0, odBlue: 0,
      dominantFreq: 0, spectralEntropy: 0, harmonicRatio: 0,
      hr: 0, rmssd: 0, perfusionIndex: 0,
    };
  }
  
  /**
   * Obtener features más importantes
   */
  private getTopFeatures(n: number): Record<string, number> {
    if (!this.calibration) return {};
    
    const sorted = Object.entries(this.calibration.coefficients)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, n);
    
    return Object.fromEntries(sorted);
  }
  
  /**
   * Crear output research bloqueado
   */
  private createResearchOutput(
    reason: QualityFlag,
    debugData: Record<string, any> = {}
  ): GlucoseOutput {
    return {
      value: null,
      unit: 'mg/dL',
      confidence: 0,
      status: 'research_only',
      qualityFlags: [reason, 'research_only'],
      evidence: {
        sqi: 0,
        acceptedWindows: 0,
        totalWindows: 0,
        acceptedBeats: 0,
        totalBeats: 0,
        measurementDurationMs: 0,
        effectiveFps: 0,
        calibrationPoints: this.calibration?.samples.length || 0,
        calibrationCoverage: this.calibration?.coverage.rangeCoverage || 0,
        trend: 'UNKNOWN',
        featureImportance: {},
      },
      debug: debugData,
    };
  }
  
  /**
   * Media
   */
  private mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  }
  
  /**
   * Correlación de Pearson
   */
  private correlation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    const mx = this.mean(x.slice(0, n));
    const my = this.mean(y.slice(0, n));
    
    let num = 0;
    let denX = 0;
    let denY = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx;
      const dy = y[i] - my;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    
    return num / (Math.sqrt(denX) * Math.sqrt(denY) + 0.001);
  }
  
  /**
   * Resetear
   */
  reset(): void {
    this.featureHistory = [];
    this.lastOutput = null;
    this.pendingSamples = [];
    this.isTrainingMode = false;
  }
  
  /**
   * Estado de calibración
   */
  getCalibrationStatus(): {
    hasCalibration: boolean;
    isTrainingMode: boolean;
    samplesCollected: number;
    samplesNeeded: number;
    coveragePercent: number;
    rmse: number;
    canPublish: boolean;
  } {
    return {
      hasCalibration: this.calibration !== null && this.calibration.samples.length >= CONFIG.MIN_SAMPLES,
      isTrainingMode: this.isTrainingMode,
      samplesCollected: this.pendingSamples.length,
      samplesNeeded: Math.max(0, CONFIG.MIN_SAMPLES - this.pendingSamples.length),
      coveragePercent: this.computeCoveragePercent(),
      rmse: this.calibration?.rmse || 999,
      canPublish: this.canPublishResults(),
    };
  }
}
