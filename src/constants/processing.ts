/**
 * CONSTANTES DE PROCESAMIENTO PPG - USO MÉDICO-LEGAL FORENSE
 * 
 * Este archivo contiene TODOS los parámetros algorítmicos críticos para
 * el procesamiento de señales PPG en contexto forense.
 * 
 * REGLAS:
 * 1. NINGÚN valor numérico debe estar hardcodeado en el código fuente
 * 2. Todos los umbrales deben ser trazables y documentados
 * 3. Cualquier cambio requiere revisión de validación clínica
 * 4. Valores basados en literatura científica peer-reviewed
 */

// ═════════════════════════════════════════════════════════════════════════════
// BUFFER Y VENTANAS
// ═════════════════════════════════════════════════════════════════════════════

/** Tamaño de buffer para señal PPG (frames a 30fps = 12 segundos) */
export const PPG_BUFFER_SIZE = 360;

/** Tamaño de buffer para timestamps */
export const TIMESTAMP_BUFFER_SIZE = 360;

/** Tamaño de buffer de derivada */
export const DERIVATIVE_BUFFER_SIZE = 360;

/** Tamaño de buffer de slope sum function */
export const SLOPE_SUM_BUFFER_SIZE = 360;

/** Tamaño del template de latido */
export const TEMPLATE_SIZE = 30;

/** Ventana del template para actualización */
export const TEMPLATE_WINDOW = 25;

/** Tamaño de historial RR intervals */
export const MAX_RR_INTERVALS = 40;

/** Máximo de latidos aceptados */
export const MAX_ACCEPTED_BEATS = 60;

/** Máxima duración de ventana SQI (ms) */
export const MAX_SQI_WINDOW_MS = 8500;

/** Mínimo de muestras para ventana SQI válida */
export const MIN_SQI_SAMPLES = 40;

/** Tamaño de buffer de frame timing */
export const FRAME_TIME_BUFFER_SIZE = 120;

/** Buffer de luminancia */
export const LUMINANCE_BUFFER_SIZE = 36;

/** Mínimo de frames para procesamiento */
export const MIN_FRAMES_FOR_PROCESSING = 25;

/** Mínimo de señal para análisis (rango normalizado) */
export const MIN_SIGNAL_RANGE = 0.10;

// ═════════════════════════════════════════════════════════════════════════════
// MUESTRAS Y FRECUENCIA
// ═════════════════════════════════════════════════════════════════════════════

/** Frecuencia de muestreo por defecto (fps) */
export const DEFAULT_SAMPLE_RATE = 30;

/** Factor de sobremuestreo para análisis */
export const OVERSAMPLE_FACTOR = 22;

/** Mínimo de muestras para detección de candidato */
export const MIN_SAMPLES_CANDIDATE = 15;

/** Mínimo de muestras de derivada */
export const MIN_DERIVATIVE_SAMPLES = 8;

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE DETECCIÓN
// ═════════════════════════════════════════════════════════════════════════════

/** Umbral inicial de pico */
export const PEAK_THRESHOLD_INITIAL = 4.0;

/** Umbral de prominencia mínima */
export const MIN_PROMINENCE = 0.5;

/** Umbral de prominencia para detector 1 */
export const DET1_PROMINENCE_THRESHOLD = 0.6;

/** Umbral de rising slope para detector 1 */
export const DET1_RISING_SLOPE_THRESHOLD = 0.20;

/** Umbral de rising slope para detector 2 */
export const DET2_RISING_SLOPE_THRESHOLD = 0.40;

/** Umbral SSF para detector 2 */
export const DET2_SSF_THRESHOLD = 1.0;

// ═════════════════════════════════════════════════════════════════════════════
// PERIODICIDAD Y RITMO
// ═════════════════════════════════════════════════════════════════════════════

/** Mínimo intervalo RR válido (ms) - 250ms = 240 BPM */
export const MIN_RR_MS = 250;

/** Máximo intervalo RR válido (ms) - 2200ms = 27 BPM */
export const MAX_RR_MS = 2200;

/** Factor de búsqueda search-back (166% del RR esperado) */
export const SEARCH_BACK_FACTOR = 1.66;

/** Factor de reducción de umbral en search-back */
export const SEARCH_BACK_THRESHOLD_FACTOR = 0.5;

/** Mínimo tiempo desde último pico para síntesis Elgendi (ms) */
export const ELGENDI_SYNTHESIS_MIN_TIME = 280;

/** Factor mínimo de tiempo esperado para síntesis */
export const ELGENDI_SYNTHESIS_MIN_FACTOR = 0.65;

/** Factor máximo de tiempo esperado para síntesis */
export const ELGENDI_SYNTHESIS_MAX_FACTOR = 1.35;

/** Umbral de score de template para síntesis */
export const TEMPLATE_SCORE_THRESHOLD = 0.35;

/** Ventana de corroboración Elgendi (ms) */
export const ELGENDI_CORROBORATION_MS = 150;

/** Prominencia base para síntesis */
export const ELGENDI_SYNTHESIS_PROMINENCE_BASE = 2;

/** Factor de prominencia para síntesis */
export const ELGENDI_SYNTHESIS_PROMINENCE_FACTOR = 0.4;

/** Ancho de pulso para síntesis (ms) */
export const ELGENDI_SYNTHESIS_WIDTH_MS = 250;

/** Slope mínimo rising para síntesis */
export const ELGENDI_SYNTHESIS_RISING_SLOPE_MIN = 0.3;

/** Slope falling para síntesis */
export const ELGENDI_SYNTHESIS_FALLING_SLOPE = 0.3;

/** Local band power divisor para síntesis */
export const ELGENDI_SYNTHESIS_BAND_POWER_DIVISOR = 2;

/** Score mínimo para corroboración Elgendi */
export const ELGENDI_CORROBORATION_SCORE = 65;

/** IBI por defecto (ms) */
export const DEFAULT_IBI_MS = 650;

/** Penalty por source switch */
export const SOURCE_SWITCH_PENALTY = 0.3;

/** Score normal de source consistency */
export const SOURCE_SWITCH_NORMAL = 1.0;

/** Umbral de SQI para actualizar template */
export const BEAT_SQI_UPDATE_THRESHOLD = 50;

/** Tolerancia de amplitud (ratio min) */
export const AMPLITUDE_RATIO_MIN = 0.04;

/** Tolerancia de amplitud (ratio max) */
export const AMPLITUDE_RATIO_MAX = 25;

/** Máximo RR para aceptar latido perdido */
export const MAX_MISSED_BEAT_RR = 2200;

/** Factor de latido perdido (mínimo) */
export const MISSED_BEAT_FACTOR_MIN = 1.7;

/** Factor de latido perdido (máximo) */
export const MISSED_BEAT_FACTOR_MAX = 2.5;

// ═════════════════════════════════════════════════════════════════════════════
// SCORING Y MORFOLOGÍA
// ═════════════════════════════════════════════════════════════════════════════

/** Score base de prominencia (30 puntos máximo) */
export const PROMINENCE_SCORE_MAX = 30;

/** Divisor de prominencia para scoring */
export const PROMINENCE_SCORE_DIVISOR = 3;

/** Score máximo de slope */
export const SLOPE_SCORE_MAX = 25;

/** Divisor rising slope */
export const RISING_SLOPE_DIVISOR = 1.5;

/** Divisor falling slope */
export const FALLING_SLOPE_DIVISOR = 1.0;

/** Score de ancho (óptimo) */
export const WIDTH_SCORE_OPTIMAL = 12;

/** Score de ancho (aceptable) */
export const WIDTH_SCORE_ACCEPTABLE = 6;

/** Ancho mínimo óptimo (ms) */
export const WIDTH_OPTIMAL_MIN_MS = 70;

/** Ancho máximo óptimo (ms) */
export const WIDTH_OPTIMAL_MAX_MS = 600;

/** Ancho mínimo aceptable (ms) */
export const WIDTH_ACCEPTABLE_MIN_MS = 50;

/** Ancho máximo aceptable (ms) */
export const WIDTH_ACCEPTABLE_MAX_MS = 800;

/** Score de asimetría */
export const ASYMMETRY_SCORE = 10;

/** Ratio de asimetría mínimo */
export const ASYMMETRY_RATIO_MIN = 0.25;

/** Ratio de asimetría máximo */
export const ASYMMETRY_RATIO_MAX = 2.5;

/** Score base de ritmo (cercanía al esperado) */
export const RHYTHM_SCORE_NEAR = 40;

/** Score por autocorrelación existente */
export const RHYTHM_SCORE_AUTOCORR = 15;

/** Score por picos consecutivos */
export const RHYTHM_SCORE_CONSECUTIVE = 15;

/** Mínimo de picos consecutivos para score */
export const RHYTHM_MIN_CONSECUTIVE_PEAKS = 3;

/** Peso de morphology score en total */
export const MORPHOLOGY_WEIGHT = 0.45;

/** Peso de rhythm score en total */
export const RHYTHM_WEIGHT = 0.25;

/** Peso de detector agreement en total */
export const DETECTOR_AGREEMENT_WEIGHT = 30;

/** Peso de template correlation en total */
export const TEMPLATE_CORRELATION_WEIGHT = 15;

/** Bonus por contacto estable */
export const CONTACT_STABLE_BONUS = 5;

/** Score mínimo para vía rápida */
export const FAST_PATH_MIN_SCORE = 28;

/** Score mínimo para vía intermedia (inicial) */
export const MIDDLE_PATH_MIN_SCORE_INITIAL = 18;

/** Score mínimo para vía intermedia (establecido) */
export const MIDDLE_PATH_MIN_SCORE_ESTABLISHED = 24;

/** Score mínimo para aceptación por score alto */
export const HIGH_SCORE_MIN = 42;

/** Score de morphology para síntesis Elgendi */
export const ELGENDI_SYNTHESIS_MORPHOLOGY = 55;

/** Score de rhythm para síntesis Elgendi */
export const ELGENDI_SYNTHESIS_RHYTHM = 45;

/** Score total para síntesis Elgendi */
export const ELGENDI_SYNTHESIS_TOTAL = 58;

/** Detector agreement para síntesis */
export const ELGENDI_SYNTHESIS_DETECTOR_AGREEMENT = 0.7;

// ═════════════════════════════════════════════════════════════════════════════
// ADJUDICACIÓN Y RECHAZO
// ═════════════════════════════════════════════════════════════════════════════

/** Ancho mínimo aceptable (ms) */
export const WIDTH_REJECT_MIN_MS = 40;

/** Ancho máximo aceptable (ms) */
export const WIDTH_REJECT_MAX_MS = 1000;

/** Penalty máximo de clipping para rechazo */
export const CLIP_PENALTY_REJECT_THRESHOLD = 0.75;

/** Rising slope mínimo */
export const MIN_RISING_SLOPE = 0.15;

/** Falling slope mínimo */
export const MIN_FALLING_SLOPE = 0.08;

/** Score mínimo de morphology en refractario suave */
export const SOFT_REFRACTORY_MIN_MORPHOLOGY = 45;

/** Agreement mínimo en refractario suave */
export const SOFT_REFRACTORY_MIN_AGREEMENT = 0.5;

/** Umbral de threshold para aceptación (con soporte periódico) */
export const THRESHOLD_FACTOR_PERIODIC = 0.45;

/** Umbral de threshold para aceptación (sin soporte periódico) */
export const THRESHOLD_FACTOR_NON_PERIODIC = 0.70;

/** Prominencia mínima para threshold alternativo */
export const PROMINENCE_THRESHOLD_MIN = 0.9;

/** Factor de prominencia para threshold */
export const PROMINENCE_THRESHOLD_FACTOR = 0.35;

/** Template correlation mínimo para vía intermedia */
export const TEMPLATE_CORR_MIDDLE_PATH = 0.35;

/** Morphology score mínimo para vía intermedia alternativa */
export const MORPHOLOGY_SCORE_MIDDLE_ALT = 38;

// ═════════════════════════════════════════════════════════════════════════════
// REFRACTARIEDAD Y TEMPORIZACIÓN
// ═════════════════════════════════════════════════════════════════════════════

/** Período refractario duro Pan-Tompkins para PPG (ms) */
export const PT_REFRACTORY_MS = 300;

/** Factor de límite suave de refractario */
export const SOFT_REFRACTORY_FACTOR = 0.55;

/** Límite suave por defecto sin RR esperado (ms) */
export const SOFT_REFRACTORY_DEFAULT_MS = 380;

// ═════════════════════════════════════════════════════════════════════════════
// FUSIÓN DE BPM Y CONFIANZA
// ═════════════════════════════════════════════════════════════════════════════

/** Mínimo de picos consecutivos para confiabilidad */
export const PEAK_DOMAIN_MIN_PEAKS = 3;

/** SQI mínimo para confiabilidad peak domain */
export const PEAK_DOMAIN_MIN_SQI = 35;

/** Confianza spectral mínima para fusión inicial */
export const SPECTRAL_CONFIDENCE_MIN_FUSE = 0.12;

/** Confianza spectral para agreement por defecto */
export const SPECTRAL_CONFIDENCE_HIGH = 0.42;

/** BPM mínimo para cálculo de agreement */
export const AGREEMENT_MIN_BPM = 15;

/** Diferencia máxima relativa para fusión peak-autocorr */
export const PEAK_AUTOCRR_MAX_DIFF = 0.2;

/** Peso de peak BPM en fusión con autocorr (reliable) */
export const PEAK_AUTOCRR_FUSION_PEAK_WEIGHT = 0.8;

/** Peso de autocorr en fusión con peak (reliable) */
export const PEAK_AUTOCRR_FUSION_AUTO_WEIGHT = 0.2;

/** Diferencia relativa para EMA conservador */
export const EMA_DIFF_HIGH = 0.25;

/** Diferencia relativa para EMA moderado */
export const EMA_DIFF_MED = 0.12;

/** Agreement para EMA conservador */
export const EMA_AGREEMENT_LOW = 0.25;

/** Confianza base peak domain */
export const PEAK_DOMAIN_BASE_CONF = 0.5;

/** Incremento de confianza por pico consecutivo */
export const PEAK_DOMAIN_CONF_PER_PEAK = 0.06;

/** Incremento de confianza por SQI */
export const PEAK_DOMAIN_CONF_PER_SQI = 0.003;

/** Peso de peak BPM en fusión con autocorr */
export const PEAK_AUTOCRR_FUSION_WEIGHT = 0.8;

/** Peso de autocorr en fusión con peak */
export const AUTOCRR_PEAK_FUSION_WEIGHT = 0.2;

/** Umbral de agreement temporal-espectral bajo */
export const TEMP_SPEC_AGREEMENT_LOW = 0.18;

/** Peso de BPM propio cuando agreement es bajo */
export const TEMP_SPEC_LOW_BPM_WEIGHT = 0.35;

/** Peso de spectral cuando agreement es bajo */
export const TEMP_SPEC_LOW_SPEC_WEIGHT = 0.65;

/** Umbral de agreement temporal-espectral alto */
export const TEMP_SPEC_AGREEMENT_HIGH = 0.72;

/** Peso de BPM propio cuando agreement es alto */
export const TEMP_SPEC_HIGH_BPM_WEIGHT = 0.9;

/** Peso de spectral cuando agreement es alto */
export const TEMP_SPEC_HIGH_SPEC_WEIGHT = 0.1;

/** Factor de fusión autocorr-mediana cuando solo hay ambos */
export const AUTOCRR_MEDIAN_FUSION_WEIGHT = 0.5;

/** Confianza base autocorr */
export const AUTOCRR_BASE_CONF = 0.2;

/** Incremento de confianza autocorr por pico */
export const AUTOCRR_CONF_PER_PEAK = 0.04;

/** Confianza máxima autocorr */
export const AUTOCRR_MAX_CONF = 0.7;

/** Confianza base mediana sola */
export const MEDIAN_BASE_CONF = 0.15;

/** Incremento de confianza mediana por pico */
export const MEDIAN_CONF_PER_PEAK = 0.05;

/** Confianza máxima mediana */
export const MEDIAN_MAX_CONF = 0.6;

/** Confianza mínima spectral para fusión */
export const SPECTRAL_CONFIDENCE_MIN = 0.2;

/** Agreement temporal-spectral por defecto cuando hay spectral */
export const TEMP_SPEC_AGREEMENT_DEFAULT = 0.45;

/** Agreement temporal-spectral con autocorr */
export const TEMP_SPEC_WITH_AUTOCRR = 0;

/** Agreement por defecto cuando solo hay autocorr */
export const TEMP_SPEC_DEFAULT_AUTOCRR = 0;

// ═════════════════════════════════════════════════════════════════════════════
// SMOOTHING Y EMA
// ═════════════════════════════════════════════════════════════════════════════

/** Alpha EMA para template */
export const TEMPLATE_EMA_ALPHA = 0.15;

/** Umbral de diferencia relativa para EMA lento */
export const EMA_DIFF_THRESHOLD_SLOW = 0.25;

/** Alpha EMA lento */
export const EMA_ALPHA_SLOW = 0.08;

/** Umbral de diferencia relativa para EMA medio */
export const EMA_DIFF_THRESHOLD_MED = 0.12;

/** Alpha EMA medio */
export const EMA_ALPHA_MED = 0.18;

/** Alpha EMA rápido */
export const EMA_ALPHA_FAST = 0.28;

/** Min alpha para EMA adaptativo */
export const EMA_ALPHA_MIN = 0.08;

/** Max alpha para EMA adaptativo */
export const EMA_ALPHA_MAX = 0.12;

// ═════════════════════════════════════════════════════════════════════════════
// EVIDENCIA Y GATES
// ═════════════════════════════════════════════════════════════════════════════

/** Streak máximo de frames sin evidencia antes de hard reset */
export const INVALID_EVIDENCE_HARD_RESET = 30;

/** SQI upstream por defecto */
export const WINDOW_SQI_UPSTREAM_DEFAULT = 0.45;

/** Phase alignment por defecto */
export const PHASE_ALIGN_DEFAULT = 0.55;

/** Spectral aggregate por defecto */
export const SPECTRAL_AGG_DEFAULT = 0.45;

/** Penalty por motion artifact */
export const MOTION_PENALTY = 0.3;

/** Factor de clip penalty */
export const CLIP_PENALTY_FACTOR = 0.5;

/** Penalty por high pressure */
export const HIGH_PRESSURE_PENALTY = 0.4;

/** Penalty por low pressure */
export const LOW_PRESSURE_PENALTY = 0.15;

/** SQI upstream por defecto para beats */
export const UPSTREAM_SQI_DEFAULT = 50;

// ═════════════════════════════════════════════════════════════════════════════
// CORRELACIÓN Y VALIDACIÓN
// ═════════════════════════════════════════════════════════════════════════════

/** Mínimo de rango para actualizar template */
export const TEMPLATE_MIN_RANGE = 0.1;

/** Mínimo de rango para correlación válida */
export const CORR_MIN_RANGE = 0.1;

// ═════════════════════════════════════════════════════════════════════════════
// EVIDENCIA MÍNIMA FORENSE
// ═════════════════════════════════════════════════════════════════════════════

/** Mínimo de latidos aceptados para evidencia */
export const MIN_ACCEPTED_BEATS_EVIDENCE = 2;

/** Mínimo de picos consecutivos para evidencia */
export const MIN_CONSECUTIVE_PEAKS_EVIDENCE = 2;

/** SQI mínimo promedio para evidencia */
export const MIN_AVG_BEAT_SQI_EVIDENCE = 22;

/** Mínimo de RR intervals para evidencia */
export const MIN_RR_INTERVALS_EVIDENCE = 1;

/** Mínimo de buffer de señal para evidencia (frames) */
export const MIN_SIGNAL_BUFFER_EVIDENCE = 60;

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE PENALIZACIÓN Y FACTORES
// ═════════════════════════════════════════════════════════════════════════════

/** Mínimo SQI de ventana para factor upstream */
export const WINDOW_SQI_MIN = 0.2;

/** Mínimo phase align para factor upstream */
export const PHASE_ALIGN_MIN = 0.2;

/** Mínimo spectral agg para factor upstream */
export const SPECTRAL_AGG_MIN = 0.2;

/** Exponente para media geométrica de factores */
export const UPSTREAM_FACTOR_EXPONENT = 1 / 3;

/** Penalización por disagreement de detectores */
export const DETECTOR_DISAGREEMENT_PENALTY = 0.75;

/** Umbral de disagreement para penalización */
export const DETECTOR_DISAGREEMENT_THRESHOLD = 0.30;

/** Factor base de confianza BPM */
export const BPM_CONFIDENCE_BASE = 0.5;

/** Factor de upstream para confianza */
export const BPM_CONFIDENCE_UPSTREAM_FACTOR = 0.5;

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ═════════════════════════════════════════════════════════════════════════════

/** Clamps un valor entre min y max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Convierte BPM a intervalo RR (ms) */
export function bpmToRrMs(bpm: number): number {
  return bpm > 0 ? 60000 / bpm : 0;
}

/** Convierte intervalo RR (ms) a BPM */
export function rrMsToBpm(rrMs: number): number {
  return rrMs > 0 ? 60000 / rrMs : 0;
}
