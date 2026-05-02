/**
 * CONFIGURACIÓN DE VALIDACIÓN PPG - SISTEMA FORENSE
 * 
 * Validación runtime de integridad de señal y prevención de datos simulados.
 * Este archivo contiene reglas estrictas que se ejecutan en tiempo real.
 */

import { isValidBpm } from '@/constants/physics';

/**
 * Resultado de validación forense
 */
export interface ForensicValidationResult {
  valid: boolean;
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  timestamp: number;
}

/**
 * Reglas de validación runtime
 */
export const PPG_VALIDATION_RULES = {
  // BPM: Debe provenir de cálculo real, no valores por defecto
  bpm: {
    validate: (bpm: number, evidence: { peaksDetected: number; rrIntervals: number[] }): boolean => {
      // Rechazar BPM sin picos detectados
      if (bpm > 0 && evidence.peaksDetected === 0) return false;
      // Rechazar BPM sin RR intervals
      if (bpm > 0 && evidence.rrIntervals.length === 0) return false;
      // Validar rango fisiológico
      return bpm === 0 || isValidBpm(bpm);
    },
    errorCode: 'BPM_NO_EVIDENCE',
    errorMessage: 'BPM sin evidencia de picos PPG reales',
  },

  // SpO2: Debe provenir de cálculo óptico real
  spo2: {
    validate: (spo2: number, evidence: { 
      redAC: number; 
      redDC: number; 
      greenAC: number; 
      greenDC: number;
      ratioR: number;
    }): boolean => {
      // Si hay SpO2, debe haber señal óptica real
      if (spo2 > 0) {
        if (evidence.redDC <= 0 || evidence.greenDC <= 0) return false;
        if (evidence.redAC <= 0 || evidence.greenAC <= 0) return false;
        if (evidence.ratioR <= 0) return false;
      }
      return true;
    },
    errorCode: 'SPO2_NO_OPTICAL',
    errorMessage: 'SpO2 sin evidencia de señal óptica AC/DC real',
  },

  // Presión Arterial: Debe provenir de features PPG reales
  pressure: {
    validate: (bp: { systolic: number; diastolic: number }, evidence: {
      cyclesDetected: number;
      featuresExtracted: boolean;
    }): boolean => {
      // Si hay presión, debe haber ciclos PPG detectados
      if (bp.systolic > 0 || bp.diastolic > 0) {
        if (evidence.cyclesDetected === 0) return false;
        if (!evidence.featuresExtracted) return false;
      }
      return true;
    },
    errorCode: 'BP_NO_CYCLES',
    errorMessage: 'Presión arterial sin ciclos PPG detectados',
  },

  // Arritmias: Deben provenir de análisis de RR real
  arrhythmia: {
    validate: (arrhythmiaCount: number, evidence: {
      rrIntervals: number[];
      analysisPerformed: boolean;
    }): boolean => {
      // Si se reportan arritmias, debe haber análisis de RR real
      if (arrhythmiaCount > 0) {
        if (evidence.rrIntervals.length < 3) return false;
        if (!evidence.analysisPerformed) return false;
      }
      return true;
    },
    errorCode: 'ARR_NO_RR_ANALYSIS',
    errorMessage: 'Arritmias sin análisis de variabilidad RR real',
  },

  // Glucosa/Lípidos: Modo research requiere features reales
  biomarkers: {
    validate: (value: number, evidence: {
      cycleFeatures: number;
      signalQuality: number;
    }): boolean => {
      if (value > 0) {
        if (evidence.cycleFeatures < 5) return false;
        if (evidence.signalQuality < 15) return false;
      }
      return true;
    },
    errorCode: 'BIOMARKER_INSUFFICIENT',
    errorMessage: 'Biomarcador sin features de ciclo PPG suficientes',
  },
} as const;

/**
 * Validador forense runtime
 */
export class PPGForensicValidator {
  private violations: ForensicValidationResult[] = [];
  private maxViolations = 100;

  validateBpm(
    bpm: number,
    evidence: { peaksDetected: number; rrIntervals: number[] }
  ): ForensicValidationResult {
    const valid = PPG_VALIDATION_RULES.bpm.validate(bpm, evidence);
    const result: ForensicValidationResult = {
      valid,
      code: valid ? 'BPM_OK' : PPG_VALIDATION_RULES.bpm.errorCode,
      message: valid ? 'BPM con evidencia válida' : PPG_VALIDATION_RULES.bpm.errorMessage,
      severity: valid ? 'INFO' : 'ERROR',
      timestamp: Date.now(),
    };
    if (!valid) this.addViolation(result);
    return result;
  }

  validateSpO2(
    spo2: number,
    evidence: { redAC: number; redDC: number; greenAC: number; greenDC: number; ratioR: number }
  ): ForensicValidationResult {
    const valid = PPG_VALIDATION_RULES.spo2.validate(spo2, evidence);
    const result: ForensicValidationResult = {
      valid,
      code: valid ? 'SPO2_OK' : PPG_VALIDATION_RULES.spo2.errorCode,
      message: valid ? 'SpO2 con evidencia óptica válida' : PPG_VALIDATION_RULES.spo2.errorMessage,
      severity: valid ? 'INFO' : 'ERROR',
      timestamp: Date.now(),
    };
    if (!valid) this.addViolation(result);
    return result;
  }

  validatePressure(
    bp: { systolic: number; diastolic: number },
    evidence: { cyclesDetected: number; featuresExtracted: boolean }
  ): ForensicValidationResult {
    const valid = PPG_VALIDATION_RULES.pressure.validate(bp, evidence);
    const result: ForensicValidationResult = {
      valid,
      code: valid ? 'BP_OK' : PPG_VALIDATION_RULES.pressure.errorCode,
      message: valid ? 'Presión con ciclos PPG válidos' : PPG_VALIDATION_RULES.pressure.errorMessage,
      severity: valid ? 'INFO' : 'ERROR',
      timestamp: Date.now(),
    };
    if (!valid) this.addViolation(result);
    return result;
  }

  validateArrhythmia(
    count: number,
    evidence: { rrIntervals: number[]; analysisPerformed: boolean }
  ): ForensicValidationResult {
    const valid = PPG_VALIDATION_RULES.arrhythmia.validate(count, evidence);
    const result: ForensicValidationResult = {
      valid,
      code: valid ? 'ARR_OK' : PPG_VALIDATION_RULES.arrhythmia.errorCode,
      message: valid ? 'Arritmias con análisis RR válido' : PPG_VALIDATION_RULES.arrhythmia.errorMessage,
      severity: valid ? 'INFO' : 'ERROR',
      timestamp: Date.now(),
    };
    if (!valid) this.addViolation(result);
    return result;
  }

  private addViolation(violation: ForensicValidationResult): void {
    this.violations.push(violation);
    if (this.violations.length > this.maxViolations) {
      this.violations.shift();
    }
  }

  getViolations(): readonly ForensicValidationResult[] {
    return this.violations;
  }

  clearViolations(): void {
    this.violations = [];
  }

  hasCriticalViolations(): boolean {
    return this.violations.some(v => v.severity === 'ERROR');
  }
}

// Singleton para uso global
export const forensicValidator = new PPGForensicValidator();
