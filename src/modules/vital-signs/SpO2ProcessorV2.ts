/**
 * SpO2 PROCESSOR V2 - FASE 7 COMPLETA
 * 
 * Motor calibrado por dispositivo y usuario:
 * - Ecuación cuadrática: SpO2 = A + B*R + C*R²
 * - Sin calibración → status NEEDS_CALIBRATION
 * - Calibración dispositivo: coeficientes poblacionales
 * - Calibración usuario: regresión con referencias reales
 */

import { OutputStatus, type SpO2Output } from '../../types/measurement';

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SpO2Calibration {
  A: number;
  B: number;
  C: number;
  validRRange: { min: number; max: number };
  validSpO2Range: { min: number; max: number };
  deviceModel: string;
  calibrationDate: number;
  sampleCount: number;
  rmse?: number;
  isUserCalibrated: boolean;
}

interface RatioWindow {
  timestamp: number;
  ratio: number;
  redAC: number;
  redDC: number;
  greenAC: number;
  greenDC: number;
  isValid: boolean;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  // Rangos fisiológicos
  MIN_SPO2: 70,
  MAX_SPO2: 100,
  MIN_PERFUSION_RED: 0.015,
  MIN_PERFUSION_GREEN: 0.01,
  
  // Calibración
  MIN_USER_CALIBRATION_POINTS: 3,
  CALIBRATION_VALIDITY_DAYS: 180,
  
  // Gates
  MIN_SQI: 0.4,
  MIN_VALID_FRAMES: 10,
  RATIO_BUFFER_SIZE: 60,
  
  // Ratio-of-ratios
  VALID_R_MIN: 0.3,
  VALID_R_MAX: 1.2,
  
  // Smoothing
  EMA_ALPHA: 0.15,
};

// ═══════════════════════════════════════════════════════════════════
//  CLASE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export class SpO2ProcessorV2 {
  private calibration: SpO2Calibration | null = null;
  private userCalibrationPoints: Array<{ referenceSpO2: number; measuredR: number }> = [];
  private ratioHistory: RatioWindow[] = [];
  private lastOutput: SpO2Output | null = null;
  private sessionStartTime: number = 0;
  private consecutiveValid = 0;
  private consecutiveInvalid = 0;
  
  /**
   * Cargar calibración de dispositivo desde perfil
   */
  loadDeviceCalibration(profile: SpO2Calibration): void {
    this.calibration = { ...profile, isUserCalibrated: false };
    console.log('[SpO2V2] Device calibration loaded:', profile.deviceModel);
  }
  
  /**
   * Agregar punto de calibración de usuario
   */
  addUserCalibrationPoint(referenceSpO2: number, measuredR: number): void {
    if (referenceSpO2 < 70 || referenceSpO2 > 100 || measuredR < 0.1 || measuredR > 2) {
      console.warn('[SpO2V2] Invalid calibration point:', { referenceSpO2, measuredR });
      return;
    }
    
    this.userCalibrationPoints.push({ referenceSpO2, measuredR });
    
    if (this.userCalibrationPoints.length >= CONFIG.MIN_USER_CALIBRATION_POINTS) {
      this.computeUserCalibration();
    }
  }
  
  /**
   * Computar coeficientes desde puntos de calibración
   */
  private computeUserCalibration(): void {
    if (this.userCalibrationPoints.length < CONFIG.MIN_USER_CALIBRATION_POINTS) return;
    
    // Regresión cuadrática simple
    const n = this.userCalibrationPoints.length;
    let sumR = 0, sumR2 = 0, sumR3 = 0, sumR4 = 0;
    let sumSpO2 = 0, sumRSpO2 = 0, sumR2SpO2 = 0;
    
    for (const point of this.userCalibrationPoints) {
      const r = point.measuredR;
      const r2 = r * r;
      const spo2 = point.referenceSpO2;
      
      sumR += r;
      sumR2 += r2;
      sumR3 += r2 * r;
      sumR4 += r2 * r2;
      sumSpO2 += spo2;
      sumRSpO2 += r * spo2;
      sumR2SpO2 += r2 * spo2;
    }
    
    // Sistema: SpO2 = A + B*R + C*R²
    // Resolver usando mínimos cuadrados
    const det = n * (sumR2 * sumR4 - sumR3 * sumR3) - 
                sumR * (sumR * sumR4 - sumR3 * sumR2) + 
                sumR2 * (sumR * sumR3 - sumR2 * sumR2);
    
    if (Math.abs(det) > 0.001) {
      const A = (sumSpO2 * (sumR2 * sumR4 - sumR3 * sumR3) - 
                 sumR * (sumRSpO2 * sumR4 - sumR3 * sumR2SpO2) + 
                 sumR2 * (sumRSpO2 * sumR3 - sumR2SpO2 * sumR2)) / det;
      
      const B = (n * (sumRSpO2 * sumR4 - sumR3 * sumR2SpO2) - 
                 sumSpO2 * (sumR * sumR4 - sumR3 * sumR2) + 
                 sumR2 * (sumR * sumR2SpO2 - sumRSpO2 * sumR2)) / det;
      
      const C = (n * (sumR2 * sumR2SpO2 - sumRSpO2 * sumR3) - 
                 sumR * (sumR * sumR2SpO2 - sumRSpO2 * sumR2) + 
                 sumSpO2 * (sumR * sumR3 - sumR2 * sumR2)) / det;
      
      // Calcular RMSE
      let sse = 0;
      for (const point of this.userCalibrationPoints) {
        const pred = A + B * point.measuredR + C * point.measuredR * point.measuredR;
        sse += Math.pow(pred - point.referenceSpO2, 2);
      }
      const rmse = Math.sqrt(sse / n);
      
      this.calibration = {
        A, B, C,
        validRRange: { min: 0.3, max: 1.2 },
        validSpO2Range: { min: 70, max: 100 },
        deviceModel: 'user_calibrated',
        calibrationDate: Date.now(),
        sampleCount: n,
        rmse,
        isUserCalibrated: true,
      };
      
      console.log('[SpO2V2] User calibration applied:', { A: A.toFixed(2), B: B.toFixed(2), C: C.toFixed(2), rmse: rmse.toFixed(2) });
    }
  }
  
  /**
   * Procesar frame de SpO2
   */
  process(input: {
    redAC: number;
    redDC: number;
    greenAC: number;
    greenDC: number;
    contactStable: boolean;
    clipHighRatio: number;
    beatCount: number;
    avgBeatSQI: number;
    timestamp: number;
  }): SpO2Output {
    // ═══════════════════════════════════════════════════════════════
    //  GATE 0: Calibración disponible
    // ═══════════════════════════════════════════════════════════════
    if (!this.calibration) {
      return this.createBlockedOutput(OutputStatus.NEEDS_CALIBRATION, {
        reason: 'No calibration available',
      });
    }
    
    // Verificar vigencia de calibración
    const calAgeDays = (Date.now() - this.calibration.calibrationDate) / (1000 * 60 * 60 * 24);
    if (calAgeDays > CONFIG.CALIBRATION_VALIDITY_DAYS) {
      return this.createBlockedOutput(OutputStatus.NEEDS_CALIBRATION, {
        reason: 'Calibration expired',
        calibrationAgeDays: calAgeDays,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 1: Calidad de señal
    // ═══════════════════════════════════════════════════════════════
    if (!input.contactStable) {
      this.consecutiveInvalid++;
      return this.createBlockedOutput('blocked', { reason: 'Contact not stable' });
    }
    
    if (input.avgBeatSQI < CONFIG.MIN_SQI) {
      this.consecutiveInvalid++;
      return this.createBlockedOutput('blocked', { reason: 'Low SQI', sqi: input.avgBeatSQI });
    }
    
    if (input.clipHighRatio > 0.1) {
      this.consecutiveInvalid++;
      return this.createBlockedOutput('blocked', { reason: 'Saturation clipping', clipHighRatio: input.clipHighRatio });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  CALCULAR RATIO
    // ═══════════════════════════════════════════════════════════════
    const ratio = this.computeRatio(input.redAC, input.redDC, input.greenAC, input.greenDC);
    const perfusionRed = input.redAC / input.redDC;
    const perfusionGreen = input.greenAC / input.greenDC;
    
    // Validar rango de ratio
    if (ratio < this.calibration.validRRange.min || ratio > this.calibration.validRRange.max) {
      this.consecutiveInvalid++;
      return this.createBlockedOutput('blocked', {
        reason: 'R ratio out of calibrated range',
        rawRatio: ratio,
      });
    }
    
    // Agregar a historial
    this.ratioHistory.push({
      timestamp: input.timestamp,
      ratio,
      redAC: input.redAC,
      redDC: input.redDC,
      greenAC: input.greenAC,
      greenDC: input.greenDC,
      isValid: true,
    });
    
    if (this.ratioHistory.length > CONFIG.RATIO_BUFFER_SIZE) {
      this.ratioHistory.shift();
    }
    
    this.consecutiveValid++;
    this.consecutiveInvalid = 0;
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 2: Suficientes muestras
    // ═══════════════════════════════════════════════════════════════
    if (this.consecutiveValid < CONFIG.MIN_VALID_FRAMES) {
      return this.createBlockedOutput('blocked', {
        reason: 'Initializing',
        consecutiveValid: this.consecutiveValid,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  CALCULAR SpO2
    // ═══════════════════════════════════════════════════════════════
    const validRatios = this.ratioHistory.filter(r => r.isValid).map(r => r.ratio);
    if (validRatios.length < 3) {
      return this.createBlockedOutput('blocked', { reason: 'Insufficient valid ratios' });
    }
    
    const medianRatio = this.median(validRatios);
    const rawSpO2 = this.calibration.A + 
                    this.calibration.B * medianRatio + 
                    this.calibration.C * medianRatio * medianRatio;
    
    // Clamp a rango fisiológico
    const clampedSpO2 = Math.max(CONFIG.MIN_SPO2, Math.min(CONFIG.MAX_SPO2, rawSpO2));
    
    // Calcular variación para confidence
    const ratioVariation = this.std(validRatios) / medianRatio;
    
    // ═══════════════════════════════════════════════════════════════
    //  SMOOTHING
    // ═══════════════════════════════════════════════════════════════
    let finalSpO2 = clampedSpO2;
    if (this.lastOutput?.value && typeof this.lastOutput.value === 'number') {
      finalSpO2 = this.lastOutput.value * (1 - CONFIG.EMA_ALPHA) + 
                   clampedSpO2 * CONFIG.EMA_ALPHA;
    }
    
    // Confidence
    let confidence = 0.5;
    confidence += this.calibration.isUserCalibrated ? 0.2 : 0;
    if (this.calibration.rmse && this.calibration.rmse < 3) confidence += 0.15;
    confidence += Math.min(0.15, input.avgBeatSQI * 0.15);
    confidence -= ratioVariation * 0.3;
    confidence = Math.max(0, Math.min(1, confidence));
    
    // Edad de calibración ya calculada arriba
    
    this.lastOutput = {
      value: Math.round(finalSpO2),
      unit: '%',
      confidence,
      status: confidence > 0.6 ? OutputStatus.OK : OutputStatus.LOW_QUALITY,
      qualityFlags: confidence < 0.6 ? [{ flag: 'low_confidence', description: 'Low calibration confidence', severity: 'warning' }] : [],
      evidence: {
        sqi: input.avgBeatSQI,
        acceptedWindows: validRatios.length,
        acceptedBeats: input.beatCount,
        perfusionIndex: medianRatio, // Usar perfusionIndex para ratio
        source: this.calibration.isUserCalibrated ? 'user' : 'device',
        deviceCalibration: this.calibration.deviceModel,
      },
      debug: {
        coefficients: { A: this.calibration.A, B: this.calibration.B, C: this.calibration.C },
        ratioVariation,
        rawSpO2,
      },
    };
    
    return this.lastOutput;
  }
  
  private computeRatio(redAC: number, redDC: number, greenAC: number, greenDC: number): number {
    const redPerfusion = redAC / (redDC + 0.001);
    const greenPerfusion = greenAC / (greenDC + 0.001);
    return redPerfusion / (greenPerfusion + 0.001);
  }
  
  private createBlockedOutput(
    reason: OutputStatus | string,
    debugData: Record<string, any> = {}
  ): SpO2Output {
    const status = typeof reason === 'string' && reason === 'blocked' 
      ? OutputStatus.BLOCKED 
      : reason as OutputStatus;
      
    return {
      value: null,
      unit: '%',
      confidence: 0,
      status,
      qualityFlags: [{ flag: 'device_uncalibrated', description: 'SpO2 requires calibration', severity: 'error' }],
      evidence: {
        sqi: 0,
        acceptedWindows: 0,
        acceptedBeats: 0,
        perfusionIndex: 0,
        source: 'uncalibrated',
      },
      debug: debugData,
    };
  }
  
  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  private std(arr: number[]): number {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length);
  }
  
  reset(): void {
    this.ratioHistory = [];
    this.lastOutput = null;
    this.consecutiveValid = 0;
    this.consecutiveInvalid = 0;
    this.sessionStartTime = Date.now();
  }
  
  fullReset(): void {
    this.reset();
    this.userCalibrationPoints = [];
    this.calibration = null;
  }
}
