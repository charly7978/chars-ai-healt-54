/**
 * GATE 5 - VITAL SIGNS AUTHORIZATION GATE
 * 
 * AUTORIZADOR FINAL DE SIGNOS VITALES
 * 
 * Ningún componente UI ni procesador puede mostrar signos vitales sin este objeto.
 * 
 * Reglas estrictas:
 * - Si no hay LIVE_PULSE_CONFIRMED: bloquear todo
 * - Si hay pulso pero SQI < 0.85: mostrar solo waveform debug, no valores
 * - Si hay pulso confirmado pero sin calibración SpO₂: no mostrar SpO₂ como número real
 * - Si no hay calibración individual: glucosa, lípidos y presión deben quedar null
 * - Si la señal es válida solo para BPM: authorizationLevel = PULSE_ONLY
 * - Si se pierde contacto: invalidar valores inmediatamente
 * - No mantener valores viejos como actuales
 * - Mostrar timestamp de última medición válida si se decide conservar historial
 */

import type { LivenessResult } from './FingerLivenessGate';
import type { ExtractionResult } from './PPGExtractionEngine';
import type { SignalQualityResult } from './SignalQualityHardGate';
import type { PhysiologicalLivenessResult } from './PhysiologicalLivenessVerifier';

export type AuthorizationLevel = 'NONE' | 'PULSE_ONLY' | 'LIMITED' | 'FULL';

export interface VitalSignsAuthorization {
  authorized: boolean;
  authorizationLevel: AuthorizationLevel;
  allowedMetrics: string[];
  blockedMetrics: string[];
  reasons: string[];
  evidence: {
    livenessPassed: boolean;
    extractionPassed: boolean;
    qualityPassed: boolean;
    physiologicalPassed: boolean;
    overallConfidence: number;
    lastValidTimestamp: number;
    timeSinceLastValid: number;
  };
  vitalSigns: {
    heartRate: number | null;
    oxygenSaturation: number | null;
    bloodPressure: { systolic: number | null; diastolic: number | null } | null;
    glucose: number | null;
    lipids: {
      cholesterol: number | null;
      triglycerides: number | null;
      ldl: number | null;
      hdl: number | null;
    } | null;
    respiratoryRate: number | null;
    temperature: number | null;
  };
  calibrationStatus: {
    spo2Calibrated: boolean;
    pressureCalibrated: boolean;
    glucoseCalibrated: boolean;
    lipidsCalibrated: boolean;
    calibrationSamples: {
      spo2: number;
      pressure: number;
      glucose: number;
      lipids: number;
    };
  };
}

export interface AuthorizationConfig {
  // Umbrales de autorización
  minOverallConfidence: number;
  minTimeStable: number; // segundos
  
  // Requisitos por métrica
  heartRateRequirements: {
    minSQI: number;
    minStableTime: number;
    minValidPulses: number;
  };
  
  spo2Requirements: {
    minSQI: number;
    minStableTime: number;
    requiresCalibration: boolean;
    minCalibrationSamples: number;
  };
  
  pressureRequirements: {
    minSQI: number;
    minStableTime: number;
    requiresCalibration: boolean;
    minCalibrationSamples: number;
  };
  
  glucoseRequirements: {
    minSQI: number;
    minStableTime: number;
    requiresCalibration: boolean;
    minCalibrationSamples: number;
  };
  
  lipidsRequirements: {
    minSQI: number;
    minStableTime: number;
    requiresCalibration: boolean;
    minCalibrationSamples: number;
  };
  
  // Tiempos de expiración
  vitalSignExpirationTime: number; // segundos
}

const DEFAULT_CONFIG: AuthorizationConfig = {
  minOverallConfidence: 0.8,
  minTimeStable: 10.0,
  
  heartRateRequirements: {
    minSQI: 0.85,
    minStableTime: 8.0,
    minValidPulses: 8,
  },
  
  spo2Requirements: {
    minSQI: 0.9,
    minStableTime: 15.0,
    requiresCalibration: true,
    minCalibrationSamples: 20,
  },
  
  pressureRequirements: {
    minSQI: 0.9,
    minStableTime: 20.0,
    requiresCalibration: true,
    minCalibrationSamples: 15,
  },
  
  glucoseRequirements: {
    minSQI: 0.95,
    minStableTime: 30.0,
    requiresCalibration: true,
    minCalibrationSamples: 25,
  },
  
  lipidsRequirements: {
    minSQI: 0.95,
    minStableTime: 30.0,
    requiresCalibration: true,
    minCalibrationSamples: 20,
  },
  
  vitalSignExpirationTime: 5.0,
};

export class VitalSignsAuthorizationGate {
  private config: AuthorizationConfig;
  private lastAuthorization: VitalSignsAuthorization | null = null;
  private calibrationData: {
    spo2: Array<{ timestamp: number; reference: number; estimated: number }>;
    pressure: Array<{ timestamp: number; reference: { systolic: number; diastolic: number }; estimated: { systolic: number; diastolic: number } }>;
    glucose: Array<{ timestamp: number; reference: number; estimated: number }>;
    lipids: Array<{ timestamp: number; reference: any; estimated: any }>;
  };

  constructor(config: Partial<AuthorizationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.calibrationData = {
      spo2: [],
      pressure: [],
      glucose: [],
      lipids: [],
    };
  }

  /**
   * Evaluar autorización completa
   */
  evaluate(
    livenessResult: LivenessResult,
    extractionResult: ExtractionResult,
    qualityResult: SignalQualityResult,
    physiologicalResult: PhysiologicalLivenessResult
  ): VitalSignsAuthorization {
    const now = performance.now();
    const reasons: string[] = [];
    const allowedMetrics: string[] = [];
    const blockedMetrics: string[] = [];

    // 1. Verificar evidencia básica
    const livenessPassed = livenessResult.isLiveTissueLikely && livenessResult.confidence > 0.7;
    const extractionPassed = extractionResult.hasValidSignal && extractionResult.qualityScore > 0.7;
    const qualityPassed = qualityResult.passed && qualityResult.sqi >= 0.85;
    const physiologicalPassed = physiologicalResult.isPhysiologicallyAlive && physiologicalResult.confidence > 0.7;

    // 2. Calcular confianza general
    const overallConfidence = (
      (livenessResult.confidence * 0.2) +
      (extractionResult.qualityScore * 0.2) +
      (qualityResult.sqi * 0.3) +
      (physiologicalResult.confidence * 0.3)
    );

    // 3. Determinar nivel de autorización
    let authorizationLevel: AuthorizationLevel = 'NONE';
    let authorized = false;

    if (!livenessPassed) {
      reasons.push('No hay evidencia de tejido vivo');
      blockedMetrics.push('ALL');
    } else if (!extractionPassed) {
      reasons.push('Extracción PPG inválida');
      blockedMetrics.push('ALL');
    } else if (!qualityPassed) {
      reasons.push(`Calidad de señal insuficiente: SQI=${qualityResult.sqi.toFixed(3)}`);
      blockedMetrics.push('ALL');
    } else if (!physiologicalPassed) {
      reasons.push('No se verifica liveness fisiológico');
      blockedMetrics.push('ALL');
    } else if (overallConfidence < this.config.minOverallConfidence) {
      reasons.push(`Confianza general baja: ${(overallConfidence * 100).toFixed(1)}%`);
      blockedMetrics.push('ALL');
    } else {
      // Pasó verificaciones básicas
      authorized = true;

      // Evaluar cada métrica específicamente
      const heartRateAuthorized = this.evaluateHeartRate(qualityResult, overallConfidence);
      const spo2Authorized = this.evaluateSpO2(qualityResult, overallConfidence);
      const pressureAuthorized = this.evaluateBloodPressure(qualityResult, overallConfidence);
      const glucoseAuthorized = this.evaluateGlucose(qualityResult, overallConfidence);
      const lipidsAuthorized = this.evaluateLipids(qualityResult, overallConfidence);

      if (heartRateAuthorized) allowedMetrics.push('heartRate');
      else blockedMetrics.push('heartRate');

      if (spo2Authorized) allowedMetrics.push('oxygenSaturation');
      else blockedMetrics.push('oxygenSaturation');

      if (pressureAuthorized) allowedMetrics.push('bloodPressure');
      else blockedMetrics.push('bloodPressure');

      if (glucoseAuthorized) allowedMetrics.push('glucose');
      else blockedMetrics.push('glucose');

      if (lipidsAuthorized) allowedMetrics.push('lipids');
      else blockedMetrics.push('lipids');

      // Determinar nivel de autorización
      if (allowedMetrics.length === 0) {
        authorizationLevel = 'NONE';
        authorized = false;
        reasons.push('Ninguna métrica autorizada');
      } else if (allowedMetrics.length === 1 && allowedMetrics.includes('heartRate')) {
        authorizationLevel = 'PULSE_ONLY';
      } else if (allowedMetrics.includes('heartRate') && allowedMetrics.length <= 3) {
        authorizationLevel = 'LIMITED';
      } else {
        authorizationLevel = 'FULL';
      }
    }

    // 4. Calcular signos vitales (solo si están autorizados)
    const vitalSigns = this.calculateVitalSigns(
      extractionResult,
      allowedMetrics
    );

    // 5. Verificar expiración de valores previos
    const timeSinceLastValid = this.lastAuthorization ? 
      (now - this.lastAuthorization.evidence.lastValidTimestamp) / 1000 : 
      Infinity;

    if (timeSinceLastValid > this.config.vitalSignExpirationTime) {
      // Expiraron los valores previos
      allowedMetrics.forEach(metric => {
        if (!this.isMetricCurrentlyValid(metric, extractionResult, qualityResult)) {
          blockedMetrics.push(metric);
          const index = allowedMetrics.indexOf(metric);
          if (index > -1) allowedMetrics.splice(index, 1);
        }
      });

      if (allowedMetrics.length === 0) {
        authorized = false;
        authorizationLevel = 'NONE';
        reasons.push('Valores previos expirados');
      }
    }

    // 6. Crear autorización final
    const authorization: VitalSignsAuthorization = {
      authorized,
      authorizationLevel,
      allowedMetrics,
      blockedMetrics,
      reasons,
      evidence: {
        livenessPassed,
        extractionPassed,
        qualityPassed,
        physiologicalPassed,
        overallConfidence,
        lastValidTimestamp: authorized ? now : (this.lastAuthorization?.evidence.lastValidTimestamp || 0),
        timeSinceLastValid: timeSinceLastValid,
      },
      vitalSigns,
      calibrationStatus: {
        spo2Calibrated: this.calibrationData.spo2.length >= this.config.spo2Requirements.minCalibrationSamples,
        pressureCalibrated: this.calibrationData.pressure.length >= this.config.pressureRequirements.minCalibrationSamples,
        glucoseCalibrated: this.calibrationData.glucose.length >= this.config.glucoseRequirements.minCalibrationSamples,
        lipidsCalibrated: this.calibrationData.lipids.length >= this.config.lipidsRequirements.minCalibrationSamples,
        calibrationSamples: {
          spo2: this.calibrationData.spo2.length,
          pressure: this.calibrationData.pressure.length,
          glucose: this.calibrationData.glucose.length,
          lipids: this.calibrationData.lipids.length,
        },
      },
    };

    this.lastAuthorization = authorization;
    return authorization;
  }

  /**
   * Evaluar autorización para frecuencia cardíaca
   */
  private evaluateHeartRate(qualityResult: SignalQualityResult, overallConfidence: number): boolean {
    return qualityResult.sqi >= this.config.heartRateRequirements.minSQI &&
           qualityResult.timeInState >= this.config.heartRateRequirements.minStableTime &&
           qualityResult.pulsesAnalyzed >= this.config.heartRateRequirements.minValidPulses &&
           overallConfidence >= 0.8;
  }

  /**
   * Evaluar autorización para SpO2
   */
  private evaluateSpO2(qualityResult: SignalQualityResult, overallConfidence: number): boolean {
    const basicRequirements = qualityResult.sqi >= this.config.spo2Requirements.minSQI &&
                              qualityResult.timeInState >= this.config.spo2Requirements.minStableTime &&
                              overallConfidence >= 0.9;

    if (!basicRequirements) return false;

    if (this.config.spo2Requirements.requiresCalibration) {
      return this.calibrationData.spo2.length >= this.config.spo2Requirements.minCalibrationSamples;
    }

    return true;
  }

  /**
   * Evaluar autorización para presión arterial
   */
  private evaluateBloodPressure(qualityResult: SignalQualityResult, overallConfidence: number): boolean {
    const basicRequirements = qualityResult.sqi >= this.config.pressureRequirements.minSQI &&
                              qualityResult.timeInState >= this.config.pressureRequirements.minStableTime &&
                              overallConfidence >= 0.9;

    if (!basicRequirements) return false;

    if (this.config.pressureRequirements.requiresCalibration) {
      return this.calibrationData.pressure.length >= this.config.pressureRequirements.minCalibrationSamples;
    }

    return true;
  }

  /**
   * Evaluar autorización para glucosa
   */
  private evaluateGlucose(qualityResult: SignalQualityResult, overallConfidence: number): boolean {
    const basicRequirements = qualityResult.sqi >= this.config.glucoseRequirements.minSQI &&
                              qualityResult.timeInState >= this.config.glucoseRequirements.minStableTime &&
                              overallConfidence >= 0.95;

    if (!basicRequirements) return false;

    if (this.config.glucoseRequirements.requiresCalibration) {
      return this.calibrationData.glucose.length >= this.config.glucoseRequirements.minCalibrationSamples;
    }

    return true;
  }

  /**
   * Evaluar autorización para lípidos
   */
  private evaluateLipids(qualityResult: SignalQualityResult, overallConfidence: number): boolean {
    const basicRequirements = qualityResult.sqi >= this.config.lipidsRequirements.minSQI &&
                              qualityResult.timeInState >= this.config.lipidsRequirements.minStableTime &&
                              overallConfidence >= 0.95;

    if (!basicRequirements) return false;

    if (this.config.lipidsRequirements.requiresCalibration) {
      return this.calibrationData.lipids.length >= this.config.lipidsRequirements.minCalibrationSamples;
    }

    return true;
  }

  /**
   * Calcular signos vitales (solo valores básicos sin calibración)
   */
  private calculateVitalSigns(
    extractionResult: ExtractionResult,
    allowedMetrics: string[]
  ): VitalSignsAuthorization['vitalSigns'] {
    const vitalSigns: VitalSignsAuthorization['vitalSigns'] = {
      heartRate: null,
      oxygenSaturation: null,
      bloodPressure: null,
      glucose: null,
      lipids: null,
      respiratoryRate: null,
      temperature: null,
    };

    // Frecuencia cardíaca (BPM desde frecuencia dominante)
    if (allowedMetrics.includes('heartRate') && extractionResult.features) {
      const avgFreq = (extractionResult.features.dominantFrequencyR + 
                      extractionResult.features.dominantFrequencyG + 
                      extractionResult.features.dominantFrequencyB) / 3;
      
      if (avgFreq >= 40 && avgFreq <= 200) {
        vitalSigns.heartRate = Math.round(avgFreq);
      }
    }

    // SpO2 (requiere calibración - null por ahora)
    if (allowedMetrics.includes('oxygenSaturation')) {
      vitalSigns.oxygenSaturation = null; // Requiere calibración
    }

    // Presión arterial (requiere calibración - null por ahora)
    if (allowedMetrics.includes('bloodPressure')) {
      vitalSigns.bloodPressure = null; // Requiere calibración
    }

    // Glucosa (requiere calibración - null por ahora)
    if (allowedMetrics.includes('glucose')) {
      vitalSigns.glucose = null; // Requiere calibración
    }

    // Lípidos (requiere calibración - null por ahora)
    if (allowedMetrics.includes('lipids')) {
      vitalSigns.lipids = null; // Requiere calibración
    }

    return vitalSigns;
  }

  /**
   * Verificar si una métrica sigue siendo válida
   */
  private isMetricCurrentlyValid(
    metric: string,
    extractionResult: ExtractionResult,
    qualityResult: SignalQualityResult
  ): boolean {
    // Si no hay señal actual, no es válida
    if (!extractionResult.hasValidSignal || !qualityResult.passed) {
      return false;
    }

    // Verificar requisitos específicos por métrica
    switch (metric) {
      case 'heartRate':
        return this.evaluateHeartRate(qualityResult, 0.8);
      case 'oxygenSaturation':
        return this.evaluateSpO2(qualityResult, 0.9);
      case 'bloodPressure':
        return this.evaluateBloodPressure(qualityResult, 0.9);
      case 'glucose':
        return this.evaluateGlucose(qualityResult, 0.95);
      case 'lipids':
        return this.evaluateLipids(qualityResult, 0.95);
      default:
        return false;
    }
  }

  /**
   * Agregar dato de calibración
   */
  addCalibrationData(
    metric: 'spo2' | 'pressure' | 'glucose' | 'lipids',
    reference: number | any,
    estimated: number | any
  ): void {
    const timestamp = performance.now();

    switch (metric) {
      case 'spo2':
        if (typeof reference === 'number' && typeof estimated === 'number') {
          this.calibrationData.spo2.push({ timestamp, reference, estimated });
          // Mantener solo últimos 100 datos
          if (this.calibrationData.spo2.length > 100) {
            this.calibrationData.spo2.shift();
          }
        }
        break;
      case 'pressure':
        if (typeof reference === 'object' && typeof estimated === 'object') {
          this.calibrationData.pressure.push({ timestamp, reference, estimated });
          if (this.calibrationData.pressure.length > 100) {
            this.calibrationData.pressure.shift();
          }
        }
        break;
      case 'glucose':
        if (typeof reference === 'number' && typeof estimated === 'number') {
          this.calibrationData.glucose.push({ timestamp, reference, estimated });
          if (this.calibrationData.glucose.length > 100) {
            this.calibrationData.glucose.shift();
          }
        }
        break;
      case 'lipids':
        if (typeof reference === 'object' && typeof estimated === 'object') {
          this.calibrationData.lipids.push({ timestamp, reference, estimated });
          if (this.calibrationData.lipids.length > 100) {
            this.calibrationData.lipids.shift();
          }
        }
        break;
    }
  }

  /**
   * Invalidar autorización actual
   */
  invalidate(): void {
    if (this.lastAuthorization) {
      this.lastAuthorization.authorized = false;
      this.lastAuthorization.allowedMetrics = [];
      this.lastAuthorization.blockedMetrics = ['ALL'];
      this.lastAuthorization.reasons = ['Autorización invalidada manualmente'];
    }
  }

  /**
   * Resetear gate
   */
  reset(): void {
    this.lastAuthorization = null;
    this.calibrationData = {
      spo2: [],
      pressure: [],
      glucose: [],
      lipids: [],
    };
  }

  /**
   * Obtener última autorización
   */
  getLastAuthorization(): VitalSignsAuthorization | null {
    return this.lastAuthorization ? { ...this.lastAuthorization } : null;
  }

  /**
   * Obtener estado de calibración
   */
  getCalibrationStatus(): VitalSignsAuthorization['calibrationStatus'] {
    return {
      spo2Calibrated: this.calibrationData.spo2.length >= this.config.spo2Requirements.minCalibrationSamples,
      pressureCalibrated: this.calibrationData.pressure.length >= this.config.pressureRequirements.minCalibrationSamples,
      glucoseCalibrated: this.calibrationData.glucose.length >= this.config.glucoseRequirements.minCalibrationSamples,
      lipidsCalibrated: this.calibrationData.lipids.length >= this.config.lipidsRequirements.minCalibrationSamples,
      calibrationSamples: {
        spo2: this.calibrationData.spo2.length,
        pressure: this.calibrationData.pressure.length,
        glucose: this.calibrationData.glucose.length,
        lipids: this.calibrationData.lipids.length,
      },
    };
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<AuthorizationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): AuthorizationConfig {
    return { ...this.config };
  }
}
