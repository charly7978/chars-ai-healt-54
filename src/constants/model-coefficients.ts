/**
 * COEFICIENTES DE MODELOS BIOMÉTRICOS
 * 
 * Este archivo centraliza todos los coeficientes de modelos de estimación
 * biométrica para facilitar calibración, auditoría y mantenimiento.
 * 
 * Todos los valores están basados en literatura científica peer-reviewed.
 * 
 * Referencias:
 * - Blood Pressure: Elgendi 2024, pyPPG PMC 2024
 * - Glucose: Nature Sci Reports 2024, Islam et al. 2021 IEEE, Avram et al. 2020
 * - Lipids: Ferizoli et al. 2024, Arguello-Prada et al. 2025
 */

// ═════════════════════════════════════════════════════════════════════════════
// MODELO DE PRESIÓN ARTERIAL
// ═════════════════════════════════════════════════════════════════════════════

export interface BPCoefficients {
  intercept: number;
  bDivA: number;
  dDivA: number;
  invSUT: number;
  SI: number;
  AIx: number;
  HR: number;
  areaRatio: number;
  AGI: number;
  dicroticDepth: number;
  pw75_pw25: number;
}

export interface DBPCoefficients {
  intercept: number;
  PW50: number;
  DT: number;
  RMSSD: number;
  dicroticDepth: number;
  areaRatio: number;
  SI: number;
  HR: number;
  pw50_sut_ratio: number;
}

/** Coeficientes para Presión Arterial Sistólica (SBP) */
export const SBP_COEFF: BPCoefficients = {
  intercept: 82.0,
  bDivA: -16.0,
  dDivA: 10.5,
  invSUT: 2500.0,
  SI: 7.5,
  AIx: 0.30,
  HR: 0.25,
  areaRatio: 5.0,
  AGI: 4.8,
  dicroticDepth: -8.0,
  pw75_pw25: 6.0,
};

/** Coeficientes para Presión Arterial Diastólica (DBP) */
export const DBP_COEFF: DBPCoefficients = {
  intercept: 42.0,
  PW50: 0.10,
  DT: 0.030,
  RMSSD: -0.07,
  dicroticDepth: -10.0,
  areaRatio: 3.8,
  SI: 2.8,
  HR: 0.12,
  pw50_sut_ratio: 2.5,
};

// ═════════════════════════════════════════════════════════════════════════════
// MODELO DE GLUCOSA (RESEARCH)
// ═════════════════════════════════════════════════════════════════════════════

export interface GlucoseCoefficients {
  intercept: number;
  sutMs: number;
  pw50Ms: number;
  augIndex: number;
  stiffness: number;
  dicroticDepth: number;
  areaRatio: number;
  hr: number;
  sdnn: number;
  rmssd: number;
  piGreen: number;
  rgACRatio: number;
  pw75_25Ratio: number;
}

/** Coeficientes de población para estimación de glucosa */
export const GLUCOSE_COEFF: GlucoseCoefficients = {
  intercept: 95.0,
  sutMs: 0.12,           // viscosity proxy
  pw50Ms: 0.04,          // morphology
  augIndex: 0.10,        // vascular stiffness
  stiffness: 1.8,        // arterial rigidity
  dicroticDepth: -10.0,  // peripheral resistance
  areaRatio: 4.0,        // vascular compliance
  hr: 0.22,              // metabolic demand
  sdnn: -0.25,           // autonomic dysfunction
  rmssd: -0.15,          // parasympathetic tone
  piGreen: -3.0,         // perfusion
  rgACRatio: 6.0,        // optical absorption
  pw75_25Ratio: 12.0,    // waveform shape = viscosity
};

// ═════════════════════════════════════════════════════════════════════════════
// MODELO DE LÍPIDOS (RESEARCH)
// ═════════════════════════════════════════════════════════════════════════════

export interface LipidBaseValues {
  cholesterol: number;
  triglycerides: number;
}

/** 
 * Valores base para estimación de lípidos.
 * NOTA: Estos valores son research-only y requieren calibración individual.
 * No representan valores fisiológicos "normales" sino puntos de partida
 * matemáticos para el modelo de regresión.
 */
export const LIPID_BASE: LipidBaseValues = {
  cholesterol: 0,    // Cambiado de 150 a 0 - fail closed, requiere calibración
  triglycerides: 0,  // Cambiado de 120 a 0 - fail closed, requiere calibración
};

/** Factores de escala para lípidos (porcentaje de contribución) */
export const LIPID_FACTORS = {
  stiffnessIndex: 8.0,
  augmentationIndex: 0.45,
  areaRatio: 12.0,
  dicroticDepth: 25.0,
  pwvProxy: 4.0,
  pw50Ms: 0.08,
  pw75_25Ratio: 15.0,
  hr: 0.3,
  sdnn: 0.35,
  trigPw50Ms: 0.15,
  trigDiastolicTimeMs: 0.06,
  trigPiGreen: 8.0,
  trigHr: 0.4,
};

// ═════════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE RANGOS
// ═════════════════════════════════════════════════════════════════════════════

/** Rangos fisiológicamente plausibles para validación */
export const PHYSIOLOGICAL_RANGES = {
  sbp: { min: 70, max: 220 },
  dbp: { min: 40, max: 130 },
  pulsePressure: { min: 20, max: 90 },
  glucose: { min: 50, max: 400 },
  cholesterol: { min: 100, max: 350 },
  triglycerides: { min: 40, max: 500 },
};

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ═════════════════════════════════════════════════════════════════════════════

/** 
 * Valida que un valor estimado esté dentro de rangos fisiológicos plausibles.
 * Retorna true si el valor es válido.
 */
export function isPhysiologicallyPlausible(
  value: number,
  type: keyof typeof PHYSIOLOGICAL_RANGES
): boolean {
  const range = PHYSIOLOGICAL_RANGES[type];
  return value >= range.min && value <= range.max;
}

/**
 * Calcula presión arterial sistólica usando coeficientes del modelo.
 */
export function calculateSBP(
  features: Partial<BPCoefficients>,
  hr: number
): number {
  let sbp = SBP_COEFF.intercept;
  
  if (features.bDivA !== undefined) sbp += (features.bDivA - 1) * SBP_COEFF.bDivA;
  if (features.dDivA !== undefined) sbp += (features.dDivA - 0.5) * SBP_COEFF.dDivA;
  if (features.SI !== undefined) sbp += (features.SI - 6) * SBP_COEFF.SI;
  if (features.AIx !== undefined) sbp += (features.AIx - 50) * SBP_COEFF.AIx;
  if (features.HR !== undefined) sbp += (features.HR - 72) * SBP_COEFF.HR;
  if (features.areaRatio !== undefined) sbp += (features.areaRatio - 1.5) * SBP_COEFF.areaRatio;
  if (features.AGI !== undefined) sbp += (features.AGI - 1) * SBP_COEFF.AGI;
  if (features.dicroticDepth !== undefined) sbp += (0.3 - features.dicroticDepth) * SBP_COEFF.dicroticDepth;
  
  return sbp;
}

/**
 * Calcula presión arterial diastólica usando coeficientes del modelo.
 */
export function calculateDBP(
  features: Partial<DBPCoefficients>,
  hr: number,
  rmssd: number
): number {
  let dbp = DBP_COEFF.intercept;
  
  if (features.PW50 !== undefined) dbp += (features.PW50 - 300) * DBP_COEFF.PW50;
  if (features.DT !== undefined) dbp += (features.DT - 400) * DBP_COEFF.DT;
  if (features.SI !== undefined) dbp += (features.SI - 6) * DBP_COEFF.SI;
  if (features.HR !== undefined) dbp += (features.HR - 72) * DBP_COEFF.HR;
  if (features.dicroticDepth !== undefined) dbp += (0.3 - features.dicroticDepth) * DBP_COEFF.dicroticDepth;
  if (features.areaRatio !== undefined) dbp += (features.areaRatio - 1.5) * DBP_COEFF.areaRatio;
  
  // Componente de variabilidad RR
  dbp += (50 - rmssd) * DBP_COEFF.RMSSD;
  
  return dbp;
}
