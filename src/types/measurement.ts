/**
 * Tipos de Medición con Trazabilidad Clínica
 * 
 * Cada resultado incluye: valor puntual, incertidumbre (±), calidad de señal,
 * confianza de medición, versión de algoritmo y ventana temporal.
 * 
 * Referencias:
 * - ISO 80601-2-61:2017 (SpO₂)
 * - IEEE 1708-2014 (Wearable cuffless BP)
 * - Task Force ESC/NASPE 1996 (HRV)
 */

export const ALGORITHM_VERSION = '2.0.0';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' | 'INVALID' | 'UNKNOWN';

export interface UncertaintyBand {
  value: number;
  uncertainty: number;        // ± absolute
  confidenceLevel: ConfidenceLevel;
  isCalibrated: boolean;
  requiresRecalibration: boolean;
  lastCalibratedAt?: string;  // ISO date
}

export interface HRVPersistence {
  sdnn: number;
  rmssd: number;
  pnn50: number;
  lfPower: number;
  hfPower: number;
  lfHfRatio: number;
}

export interface MeasurementRecord {
  // Identity
  user_id: string;
  measured_at: string;
  algorithm_version: string;
  measurement_window_seconds: number;
  
  // Core vitals
  heart_rate: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  
  // Extended vitals
  glucose: number | null;
  hemoglobin: number | null;
  total_cholesterol: number | null;
  triglycerides: number | null;
  
  // HRV
  sdnn: number | null;
  rmssd: number | null;
  pnn50: number | null;
  lf_power: number | null;
  hf_power: number | null;
  lf_hf_ratio: number | null;
  
  // Quality & traceability
  arrhythmia_count: number;
  quality: number;
  signal_quality_index: number;
  measurement_confidence: string;
  calibration_id: string | null;
}

/**
 * Rangos fisiológicos para validación interna
 * Fuera de estos rangos → valor rechazado (no mostrado)
 */
export const PHYSIOLOGICAL_RANGES = {
  heartRate:    { min: 30, max: 220, unit: 'bpm' },
  spo2:         { min: 70, max: 100, unit: '%' },
  systolic:     { min: 70, max: 250, unit: 'mmHg' },
  diastolic:    { min: 40, max: 150, unit: 'mmHg' },
  glucose:      { min: 40, max: 400, unit: 'mg/dL' },
  hemoglobin:   { min: 4,  max: 22,  unit: 'g/dL' },
  cholesterol:  { min: 80, max: 400, unit: 'mg/dL' },
  triglycerides:{ min: 30, max: 600, unit: 'mg/dL' },
} as const;

/**
 * Incertidumbre estimada por dominio (±)
 * Basado en literatura de PPG por cámara de smartphone
 */
export const UNCERTAINTY_ESTIMATES = {
  spo2:         { typical: 2,  highQuality: 1.5, lowQuality: 4 },    // % - ref: ISO 80601
  systolic:     { typical: 12, highQuality: 8,   lowQuality: 20 },   // mmHg - ref: IEEE 1708
  diastolic:    { typical: 8,  highQuality: 5,   lowQuality: 15 },   // mmHg
  heartRate:    { typical: 3,  highQuality: 1,   lowQuality: 8 },    // bpm
  glucose:      { typical: 25, highQuality: 15,  lowQuality: 40 },   // mg/dL - experimental
  hemoglobin:   { typical: 1.5,highQuality: 1.0, lowQuality: 2.5 },  // g/dL - experimental
  cholesterol:  { typical: 30, highQuality: 20,  lowQuality: 50 },   // mg/dL - experimental
  triglycerides:{ typical: 35, highQuality: 25,  lowQuality: 60 },   // mg/dL - experimental
} as const;

export function getUncertainty(
  metric: keyof typeof UNCERTAINTY_ESTIMATES,
  confidence: ConfidenceLevel
): number {
  const est = UNCERTAINTY_ESTIMATES[metric];
  if (confidence === 'HIGH') return est.highQuality;
  if (confidence === 'MEDIUM') return est.typical;
  return est.lowQuality;
}
