/**
 * SpO2 PROCESSOR V2 - FASE 7 COMPLETA
 * 
 * Motor serio de SpO2 con calibración por modelo de dispositivo.
 * NO usa ecuaciones universales genéricas.
 * 
 * Principios:
 * 1. Sin perfil calibrado → status "needs_calibration", value = null
 * 2. Perfil de dispositivo → calibración de población
 * 3. Calibración de usuario (pareado con referencia) → calibración personal
 * 4. Publicación solo con suficiente evidencia y calibración
 * 
 * Calibration Profile Structure:
 * {
 *   deviceModel: string,
 *   coefficients: { A, B, C },  // SpO2 = A + B*R + C*R²
 *   validRange: { minR, maxR, minSpO2, maxSpO2 },
 *   referenceDevice: string,
 *   calibrationDate: timestamp,
 *   sampleCount: number,
 *   rmse: number,
 *   population: 'general' | 'user_specific'
 * }
 */

import type { SpO2Output, QualityFlag, DeviceCalibrationProfile } from '../../types/measurement';

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

interface SpO2Calibration {
  // Coeficientes cuadráticos: SpO2 = A + B*R + C*R²
  A: number;
  B: number;
  C: number;
  // Valid ranges
  validRRange: { min: number; max: number };
  validSpO2Range: { min: number; max: number };
  // Metadata
  deviceModel: string;
  referenceDevice?: string;
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
  perfusionRed: number;
  perfusionGreen: number;
  quality: number;
  isValid: boolean;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  // Ventanas de análisis
  RATIO_BUFFER_SIZE: 12,
  BEAT_RATIO_BUFFER_SIZE: 8,
  MIN_VALID_FRAMES: 5,
  CONSECUTIVE_INVALID_RESET: 3,
  
  // Gates de calidad
  MIN_DC: 8,
  MIN_AC_RATIO: 0.03,
  MAX_CLIP_RATIO: 0.15,
  MIN_CONTACT_STABLE_MS: 2000,
  MIN_PERFUSION_RED: 0.015,
  MIN_PERFUSION_GREEN: 0.01,
  
  // SpO2 fisiológico
  MIN_SPO2_PUBLISH: 70,
  MAX_SPO2_PUBLISH: 100,
  PLAUSIBLE_SPO2_RANGE: { min: 70, max: 100 },
  
  // Stabilidad
  RATIO_VARIATION_MAX: 0.15,
  EMA_ALPHA: 0.15,
  
  // Calibración
  MIN_CALIBRATION_SAMPLES: 10,
  MAX_CALIBRATION_AGE_DAYS: 365,
};

// ═══════════════════════════════════════════════════════════════════
//  CLASE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export class SpO2ProcessorV2 {
  private calibration: SpO2Calibration | null = null;
  private ratioHistory: RatioWindow[] = [];
  private lastOutput: SpO2Output | null = null;
  private consecutiveValid = 0;
  private consecutiveInvalid = 0;
  private sessionStartTime = 0;
  
  // User calibration points
  private userCalibrationPoints: Array<{
    referenceSpO2: number;
    measuredR: number;
    timestamp: number;
  }> = [];
  
  /**
   * Cargar calibración de dispositivo
   */
  loadDeviceCalibration(profile: DeviceCalibrationProfile): void {
    if (!profile.spo2Calibration) {
      console.warn('[SpO2V2] No calibration data in device profile');
      this.calibration = null;
      return;
    }
    
    const cal = profile.spo2Calibration;
    this.calibration = {
      A: cal.coefficients.A,
      B: cal.coefficients.B,
      C: cal.coefficients.C,
      validRRange: cal.validRange,
      validSpO2Range: { min: 70, max: 100 },
      deviceModel: profile.deviceModel,
      referenceDevice: cal.referenceDevice,
      calibrationDate: cal.calibrationDate,
      sampleCount: cal.sampleCount,
      rmse: cal.rmse,
      isUserCalibrated: false,
    };
    
    console.log('[SpO2V2] Device calibration loaded:', {
      model: profile.deviceModel,
      samples: cal.sampleCount,
      rmse: cal.rmse?.toFixed(2),
    });
  }
  
  /**
   * Agregar punto de calibración de usuario (con referencia real)
   */
  addUserCalibrationPoint(referenceSpO2: number, measuredR: number): void {
    this.userCalibrationPoints.push({
      referenceSpO2,
      measuredR,
      timestamp: Date.now(),
    });
    
    // Mantener solo los últimos puntos
    if (this.userCalibrationPoints.length > 20) {
      this.userCalibrationPoints.shift();
    }
    
    // Recalibrar si hay suficientes puntos
    if (this.userCalibrationPoints.length >= CONFIG.MIN_CALIBRATION_SAMPLES) {
      this.recalibrateFromUserData();
    }
  }
  
  /**
   * Recalibrar usando datos de usuario
   */
  private recalibrateFromUserData(): void {
    if (this.userCalibrationPoints.length < CONFIG.MIN_CALIBRATION_SAMPLES) return;
    
    // Regresión cuadrática: SpO2_ref = A + B*R + C*R²
    const n = this.userCalibrationPoints.length;
    const sumR = this.userCalibrationPoints.reduce((s, p) => s + p.measuredR, 0);
    const sumR2 = this.userCalibrationPoints.reduce((s, p) => s + p.measuredR * p.measuredR, 0);
    const sumR3 = this.userCalibrationPoints.reduce((s, p) => s + Math.pow(p.measuredR, 3), 0);
    const sumR4 = this.userCalibrationPoints.reduce((s, p) => s + Math.pow(p.measuredR, 4), 0);
    const sumS = this.userCalibrationPoints.reduce((s, p) => s + p.referenceSpO2, 0);
    const sumRS = this.userCalibrationPoints.reduce((s, p) => s + p.measuredR * p.referenceSpO2, 0);
    const sumR2S = this.userCalibrationPoints.reduce((s, p) => s + p.measuredR * p.measuredR * p.referenceSpO2, 0);
    
    // Resolver sistema lineal 3x3 para A, B, C
    // Usar Cramer's rule simplificado
    const det = n * (sumR2 * sumR4 - sumR3 * sumR3) - 
                  sumR * (sumR * sumR4 - sumR2 * sumR3) + 
                  sumR2 * (sumR * sumR3 - sumR2 * sumR2);
    
    if (Math.abs(det) < 1e-10) {
      console.warn('[SpO2V2] Cannot solve calibration - insufficient variation in R');
      return;
    }
    
    const detA = sumS * (sumR2 * sumR4 - sumR3 * sumR3) - 
                   sumR * (sumRS * sumR4 - sumR2S * sumR3) + 
                   sumR2 * (sumRS * sumR3 - sumR2S * sumR2);
    
    const detB = n * (sumRS * sumR4 - sumR2S * sumR3) - 
                   sumS * (sumR * sumR4 - sumR2 * sumR3) + 
                   sumR2 * (sumR * sumR2S - sumR2 * sumRS);
    
    const detC = n * (sumR2 * sumR2S - sumR3 * sumRS) - 
                   sumR * (sumR * sumR2S - sumR2 * sumRS) + 
                   sumS * (sumR * sumR3 - sumR2 * sumR2);
    
    const A = detA / det;
    const B = detB / det;
    const C = detC / det;
    
    // Calcular RMSE
    let sse = 0;
    for (const point of this.userCalibrationPoints) {
      const predicted = A + B * point.measuredR + C * point.measuredR * point.measuredR;
      sse += Math.pow(predicted - point.referenceSpO2, 2);
    }
    const rmse = Math.sqrt(sse / n);
    
    // Solo aplicar si el modelo es razonable
    if (rmse < 5 && C < 0) { // C negativo es físicamente correcto (SpO2 decrece con R)
      this.calibration = {
        A, B, C,
        validRRange: { min: 0.3, max: 1.2 },
        validSpO2Range: { min: 70, max: 100 },
        deviceModel: this.calibration?.deviceModel || 'user_calibrated',
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
      return this.createBlockedOutput('device_uncalibrated', {
        redAC: input.redAC, redDC: input.redDC,
        greenAC: input.greenAC, greenDC: input.greenDC,
        rawRatio: this.computeRatio(input.redAC, input.redDC, input.greenAC, input.greenDC),
      });
    }
    
    // Verificar edad de calibración
    const calAgeDays = (Date.now() - this.calibration.calibrationDate) / (1000 * 60 * 60 * 24);
    if (calAgeDays > CONFIG.MAX_CALIBRATION_AGE_DAYS && !this.calibration.isUserCalibrated) {
      return this.createBlockedOutput('calibration_stale', {
        calibrationAgeDays: calAgeDays,
        rawRatio: this.computeRatio(input.redAC, input.redDC, input.greenAC, input.greenDC),
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 1: Calidad de señal
    // ═══════════════════════════════════════════════════════════════
    const flags: QualityFlag[] = [];
    
    if (input.redDC < CONFIG.MIN_DC || input.greenDC < CONFIG.MIN_DC) {
      this.consecutiveInvalid++;
      return this.createBlockedOutput('low_perfusion', { reason: 'Low DC' });
    }
    
    if (input.redAC / input.redDC < CONFIG.MIN_PERFUSION_RED ||
        input.greenAC / input.greenDC < CONFIG.MIN_PERFUSION_GREEN) {
      this.consecutiveInvalid++;
      return this.createBlockedOutput('low_perfusion', { reason: 'Low perfusion index' });
    }
    
    if (input.clipHighRatio > CONFIG.MAX_CLIP_RATIO) {
      this.consecutiveInvalid++;
      flags.push('signal_saturation');
    }
    
    if (!input.contactStable) {
      this.consecutiveInvalid++;
      return this.createBlockedOutput('unstable_contact', { reason: 'Contact unstable' });
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
      return this.createBlockedOutput('out_of_calibrated_range', {
        reason: 'R ratio out of calibrated range',
        rawRatio: ratio,
        validRange: this.calibration.validRRange,
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
      perfusionRed,
      perfusionGreen,
      quality: input.avgBeatSQI,
      isValid: true,
    });
    
    if (this.ratioHistory.length > CONFIG.RATIO_BUFFER_SIZE) {
      this.ratioHistory.shift();
    }
    
    this.consecutiveValid++;
    this.consecutiveInvalid = 0;
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 2: Suficientes muestras válidas
    // ═══════════════════════════════════════════════════════════════
    if (this.consecutiveValid < CONFIG.MIN_VALID_FRAMES) {
      return this.createBlockedOutput('initializing', {
        consecutiveValid: this.consecutiveValid,
        rawRatio: ratio,
        perfusionRed,
        perfusionGreen,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  CALCULAR SpO2
    // ═══════════════════════════════════════════════════════════════
    // Usar mediana de ratios para robustez
    const validRatios = this.ratioHistory.filter(r => r.isValid).map(r => r.ratio);
    if (validRatios.length < 3) {
      return this.createBlockedOutput('insufficient_data', { validRatios: validRatios.length });
    }
    
    const medianRatio = this.median(validRatios);
    const rawSpO2 = this.calibration.A + 
                    this.calibration.B * medianRatio + 
                    this.calibration.C * medianRatio * medianRatio;
    
    // Clamp a rango fisiológico
    const clampedSpO2 = Math.max(CONFIG.MIN_SPO2_PUBLISH, 
                                  Math.min(CONFIG.MAX_SPO2_PUBLISH, rawSpO2));
    
    // Variación del ratio (estabilidad)
    const ratioVariation = this.coefficientOfVariation(validRatios);
    
    // ═══════════════════════════════════════════════════════════════
    //  CALCULAR CONFIDENCE
    // ═══════════════════════════════════════════════════════════════
    let confidence = 0.5;
    
    // Base: número de muestras
    confidence += Math.min(0.2, validRatios.length / 20);
    
    // Calidad de calibración
    if (this.calibration.rmse && this.calibration.rmse < 3) confidence += 0.15;
    else if (this.calibration.rmse && this.calibration.rmse < 5) confidence += 0.1;
    
    // User calibration bonus
    if (this.calibration.isUserCalibrated) confidence += 0.1;
    
    // Estabilidad de ratio
    if (ratioVariation < 0.05) confidence += 0.15;
    else if (ratioVariation < 0.1) confidence += 0.08;
    else if (ratioVariation > 0.2) confidence -= 0.2;
    
    // Perfusion quality
    const meanPerfusion = this.median(this.ratioHistory.map(r => r.perfusionRed));
    if (meanPerfusion > 0.03) confidence += 0.1;
    else if (meanPerfusion < 0.015) confidence -= 0.15;
    
    confidence = Math.max(0, Math.min(1, confidence));
    
    // ═══════════════════════════════════════════════════════════════
    //  SMOOTHING TEMPORAL
    // ═══════════════════════════════════════════════════════════════
    let finalSpO2 = clampedSpO2;
    if (this.lastOutput?.value && typeof this.lastOutput.value === 'number') {
      finalSpO2 = this.lastOutput.value * (1 - CONFIG.EMA_ALPHA) + 
                   clampedSpO2 * CONFIG.EMA_ALPHA;
    }
    
    // Determinar estado
    let status: SpO2Output['status'] = 'ok';
    if (confidence < 0.4) status = 'low_quality';
    // Sin calibración de usuario, limitar confianza
    if (!this.calibration.isUserCalibrated) {
      confidence *= 0.7; // Penalizar por ser solo calibración de dispositivo
    }
    
    this.lastOutput = {
      value: Math.round(finalSpO2),
      unit: '%',
      confidence,
      status,
      qualityFlags: flags,
      evidence: {
        sqi: input.avgBeatSQI,
        acceptedWindows: validRatios.length,
        totalWindows: this.ratioHistory.length,
        acceptedBeats: input.beatCount,
        totalBeats: input.beatCount,
        measurementDurationMs: Date.now() - (this.sessionStartTime || Date.now()),
        effectiveFps: 0,
        // SpO2-specific
        rawRatioR: medianRatio,
        medianRatioR: medianRatio,
        perfusionIndexRed: perfusionRed,
        perfusionIndexGreen: perfusionGreen,
        calibrationState: this.calibration.isUserCalibrated ? 'full' : 'device',
        deviceCalibration: this.calibration.deviceModel,
        modelVersion: this.calibration.rmse ? `rmse_${this.calibration.rmse.toFixed(1)}` : 'device_default',
        calibrationSampleCount: this.calibration.sampleCount,
        calibrationAgeDays: calAgeDays,
      },
      debug: {
        coefficients: { A: this.calibration.A, B: this.calibration.B, C: this.calibration.C },
        ratioVariation,
        rawSpO2,
        userCalibrationPoints: this.userCalibrationPoints.length,
      },
    };
    
    return this.lastOutput;
  }
  
  /**
   * Computar ratio-of-ratios R
   */
  private computeRatio(redAC: number, redDC: number, greenAC: number, greenDC: number): number {
    const redRatio = redAC / (redDC + 0.001);
    const greenRatio = greenAC / (greenDC + 0.001);
    return redRatio / (greenRatio + 0.001);
  }
  
  /**
   * Crear output bloqueado
   */
  private createBlockedOutput(
    reason: QualityFlag, 
    debugData: Record<string, any> = {}
  ): SpO2Output {
    const rawRatio = debugData.rawRatio || debugData.measuredR || 0;
    
    return {
      value: null,
      unit: '%',
      confidence: 0,
      status: reason === 'device_uncalibrated' ? 'needs_calibration' : 
              reason === 'calibration_stale' ? 'needs_calibration' :
              'blocked',
      qualityFlags: [reason],
      evidence: {
        sqi: 0,
        acceptedWindows: 0,
        totalWindows: 0,
        acceptedBeats: 0,
        totalBeats: 0,
        measurementDurationMs: 0,
        effectiveFps: 0,
        rawRatioR: rawRatio,
        medianRatioR: 0,
        perfusionIndexRed: debugData.redAC && debugData.redDC ? 
          debugData.redAC / debugData.redDC : 0,
        perfusionIndexGreen: debugData.greenAC && debugData.greenDC ? 
          debugData.greenAC / debugData.greenDC : 0,
        calibrationState: this.calibration ? 
          (this.calibration.isUserCalibrated ? 'user' : 'device') : 'uncalibrated',
        deviceCalibration: this.calibration?.deviceModel || 'none',
        modelVersion: this.calibration?.rmse ? `rmse_${this.calibration.rmse.toFixed(1)}` : 'uncalibrated',
        calibrationSampleCount: this.calibration?.sampleCount || 0,
        calibrationAgeDays: this.calibration ? 
          (Date.now() - this.calibration.calibrationDate) / (1000 * 60 * 60 * 24) : 0,
      },
      debug: debugData,
    };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═════════════════════════════════════════════════════════════════
  
  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  private mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  }
  
  private standardDeviation(arr: number[], mean?: number): number {
    const m = mean ?? this.mean(arr);
    const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length || 1);
    return Math.sqrt(variance);
  }
  
  private coefficientOfVariation(arr: number[]): number {
    const m = this.mean(arr);
    return m > 0 ? this.standardDeviation(arr, m) / m : 0;
  }
  
  /**
   * Resetear estado
   */
  reset(): void {
    this.ratioHistory = [];
    this.lastOutput = null;
    this.consecutiveValid = 0;
    this.consecutiveInvalid = 0;
    this.sessionStartTime = Date.now();
  }
  
  /**
   * Obtener estado de calibración
   */
  getCalibrationStatus(): {
    hasCalibration: boolean;
    isUserCalibrated: boolean;
    sampleCount: number;
    rmse?: number;
    ageDays: number;
    userPoints: number;
  } {
    if (!this.calibration) {
      return {
        hasCalibration: false,
        isUserCalibrated: false,
        sampleCount: 0,
        ageDays: 0,
        userPoints: this.userCalibrationPoints.length,
      };
    }
    
    return {
      hasCalibration: true,
      isUserCalibrated: this.calibration.isUserCalibrated,
      sampleCount: this.calibration.sampleCount,
      rmse: this.calibration.rmse,
      ageDays: (Date.now() - this.calibration.calibrationDate) / (1000 * 60 * 60 * 24),
      userPoints: this.userCalibrationPoints.length,
    };
  }
}
