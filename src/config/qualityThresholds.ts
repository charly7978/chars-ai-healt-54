/**
 * UMBRALES DE CALIDAD PPG - CONFIGURACIÓN CENTRALIZADA
 * 
 * Todos los umbrales de calidad y validación en un solo lugar.
 * Estos valores NO son resultados biométricos, son parámetros de control.
 */

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE CALIDAD DE SEÑAL
// ═════════════════════════════════════════════════════════════════════════════

export const SIGNAL_QUALITY_THRESHOLDS = {
  /** Calidad mínima para mostrar cualquier valor (0-100) */
  MIN_DISPLAY_QUALITY: 10,
  
  /** Calidad mínima para confianza BAJA */
  LOW_CONFIDENCE_QUALITY: 25,
  
  /** Calidad mínima para confianza MEDIA */
  MEDIUM_CONFIDENCE_QUALITY: 50,
  
  /** Calidad mínima para confianza ALTA */
  HIGH_CONFIDENCE_QUALITY: 75,
  
  /** Calidad mínima para publicar signos vitales */
  MIN_VITALS_QUALITY: 15,
  
  /** Calidad mínima para SpO2 */
  MIN_SPO2_QUALITY: 20,
  
  /** Calidad mínima para presión arterial */
  MIN_BP_QUALITY: 25,
  
  /** Calidad mínima para biomarcadores (research) */
  MIN_BIOMARKER_QUALITY: 15,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE EVIDENCIA
// ═════════════════════════════════════════════════════════════════════════════

export const EVIDENCE_THRESHOLDS = {
  /** Mínimo de picos consecutivos para evidencia válida */
  MIN_CONSECUTIVE_PEAKS: 3,
  
  /** Mínimo de latidos aceptados para evidencia */
  MIN_ACCEPTED_BEATS: 2,
  
  /** Mínimo de RR intervals para análisis */
  MIN_RR_INTERVALS: 2,
  
  /** Mínimo de ciclos cardíacos para BP */
  MIN_CARDIAC_CYCLES: 1,
  
  /** Mínimo de features de ciclo válidos */
  MIN_CYCLE_FEATURES: 5,
  
  /** Frames mínimos de buffer para procesamiento */
  MIN_BUFFER_FRAMES: 60,
  
  /** Milisegundos máximo desde último pico válido */
  MAX_MS_SINCE_PEAK: 4000,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE CONFIANZA
// ═════════════════════════════════════════════════════════════════════════════

export const CONFIDENCE_THRESHOLDS = {
  /** Confianza mínima para publicar BPM */
  MIN_BPM_CONFIDENCE: 0.18,
  
  /** Confianza mínima para publicar SpO2 */
  MIN_SPO2_CONFIDENCE: 0.25,
  
  /** Confianza mínima para publicar presión */
  MIN_BP_CONFIDENCE: 0.20,
  
  /** Confianza mínima para reportar arritmias */
  MIN_ARRHYTHMIA_CONFIDENCE: 0.30,
  
  /** Agreement mínimo detector temporal-espectral */
  MIN_DETECTOR_AGREEMENT: 0.25,
  
  /** Agreement objetivo para confianza alta */
  TARGET_DETECTOR_AGREEMENT: 0.60,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE VALIDACIÓN FÍSICA
// ═════════════════════════════════════════════════════════════════════════════

export const PHYSICAL_VALIDATION_THRESHOLDS = {
  /** Perfusion Index mínimo válido (%) */
  MIN_PERFUSION_INDEX: 0.30,
  
  /** Perfusion Index objetivo (%) */
  TARGET_PERFUSION_INDEX: 1.00,
  
  /** Ratio de clipping máximo aceptable (0-1) */
  MAX_CLIP_RATIO: 0.08,
  
  /** Ratio de clipping crítico (0-1) */
  CRITICAL_CLIP_RATIO: 0.25,
  
  /** Movimiento máximo aceptable */
  MAX_MOTION_SCORE: 0.60,
  
  /** Movimiento crítico (rechazo duro) */
  CRITICAL_MOTION_SCORE: 1.50,
  
  /** Estabilidad de fuente mínima */
  MIN_SOURCE_STABILITY: 0.30,
  
  /** Coherencia multicanal mínima */
  MIN_CHANNEL_COHERENCE: 0.50,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// CATEGORIZACIÓN DE CALIDAD PARA UI
// ═════════════════════════════════════════════════════════════════════════════

export function categorizeSignalQuality(quality: number): {
  category: 'INVALID' | 'LOW' | 'MEDIUM' | 'HIGH';
  label: string;
  color: string;
} {
  if (quality < SIGNAL_QUALITY_THRESHOLDS.MIN_DISPLAY_QUALITY) {
    return { category: 'INVALID', label: 'SIN SEÑAL', color: '#6b7280' };
  }
  if (quality < SIGNAL_QUALITY_THRESHOLDS.LOW_CONFIDENCE_QUALITY) {
    return { category: 'LOW', label: 'SEÑAL DÉBIL', color: '#ef4444' };
  }
  if (quality < SIGNAL_QUALITY_THRESHOLDS.MEDIUM_CONFIDENCE_QUALITY) {
    return { category: 'MEDIUM', label: 'SEÑAL MODERADA', color: '#f59e0b' };
  }
  if (quality < SIGNAL_QUALITY_THRESHOLDS.HIGH_CONFIDENCE_QUALITY) {
    return { category: 'MEDIUM', label: 'SEÑAL BUENA', color: '#3b82f6' };
  }
  return { category: 'HIGH', label: 'SEÑAL EXCELENTE', color: '#22c55e' };
}

export function categorizeConfidence(
  confidence: number
): { level: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'; canDisplay: boolean } {
  if (confidence < 0.10) {
    return { level: 'NONE', canDisplay: false };
  }
  if (confidence < CONFIDENCE_THRESHOLDS.MIN_BPM_CONFIDENCE) {
    return { level: 'LOW', canDisplay: true };
  }
  if (confidence < 0.50) {
    return { level: 'MEDIUM', canDisplay: true };
  }
  return { level: 'HIGH', canDisplay: true };
}

// ═════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE DISPLAY
// ═════════════════════════════════════════════════════════════════════════════

export const DISPLAY_CONFIG = {
  /** Mostrar valores aunque sean de baja confianza (true = transparencia forense) */
  SHOW_LOW_CONFIDENCE_VALUES: true,
  
  /** Mostrar advertencias de baja calidad */
  SHOW_QUALITY_WARNINGS: true,
  
  /** Mostrar información de evidencia/debug */
  SHOW_EVIDENCE_DETAILS: true,
  
  /** Formato de números: decimales para confianza */
  CONFIDENCE_DECIMALS: 2,
  
  /** Formato de BPM: sin decimales */
  BPM_DECIMALS: 0,
  
  /** Formato de SpO2: sin decimales */
  SPO2_DECIMALS: 0,
  
  /** Formato de presión: sin decimales */
  BP_DECIMALS: 0,
} as const;
