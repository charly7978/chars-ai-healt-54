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

// DEFAULT_IBI_MS eliminado - no usar valores inventados para IBI
// El primer latido debe usar ibiMs=0 (sin dato previo), no un valor ficticio de 650ms (~92 BPM)

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

/** Límite refractario fisiológico mínimo (ms) - fallback cuando no hay RR previo
 * Basado en refractario cardíaco fisiológico real ~200-300ms (FC máxima ~200 BPM)
 */
export const SOFT_REFRACTORY_DEFAULT_MS = PT_REFRACTORY_MS;  // 300ms, no valor inventado

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
export const EMA_DIFF_HIGH = 0.20;  // Reducido de 0.25 para mayor estabilidad

/** Diferencia relativa para EMA moderado */
export const EMA_DIFF_MED = 0.10;   // Reducido de 0.12 para mayor estabilidad

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

/** Agreement temporal-spectral inicial - 0 sin datos reales de comparación (fail-closed) */
export const TEMP_SPEC_AGREEMENT_DEFAULT = 0;

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
export const EMA_ALPHA_SLOW = 0.05;  // Reducido de 0.08 para mayor estabilidad

/** Umbral de diferencia relativa para EMA medio */
export const EMA_DIFF_THRESHOLD_MED = 0.12;

/** Alpha EMA medio */
export const EMA_ALPHA_MED = 0.12;   // Reducido de 0.18 para mayor estabilidad

/** Alpha EMA rápido */
export const EMA_ALPHA_FAST = 0.20;  // Reducido de 0.28 para mayor estabilidad

/** Min alpha para EMA adaptativo */
export const EMA_ALPHA_MIN = 0.05;   // Reducido de 0.08 para mayor estabilidad

/** Max alpha para EMA adaptativo */
export const EMA_ALPHA_MAX = 0.10;   // Reducido de 0.12 para mayor estabilidad

// ═════════════════════════════════════════════════════════════════════════════
// EVIDENCIA Y GATES
// ═════════════════════════════════════════════════════════════════════════════

/** Streak máximo de frames sin evidencia antes de hard reset */
export const INVALID_EVIDENCE_HARD_RESET = 30;

/** SQI upstream inicial - 0 hasta tener evidencia real (fail-closed) */
export const WINDOW_SQI_UPSTREAM_DEFAULT = 0;

/** Phase alignment inicial - 0 sin datos reales */
export const PHASE_ALIGN_DEFAULT = 0;

/** Spectral aggregate inicial - 0 sin datos reales */
export const SPECTRAL_AGG_DEFAULT = 0;

/** Penalty por motion artifact */
export const MOTION_PENALTY = 0.3;

/** Factor de clip penalty */
export const CLIP_PENALTY_FACTOR = 0.5;

/** Penalty por high pressure */
export const HIGH_PRESSURE_PENALTY = 0.4;

/** Penalty por low pressure */
export const LOW_PRESSURE_PENALTY = 0.15;

/** SQI upstream inicial para beats - 0 hasta tener señal válida */
export const UPSTREAM_SQI_DEFAULT = 0;

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
// DETECCIÓN DE CANDIDATOS
// ═════════════════════════════════════════════════════════════════════════════

/** Tamaño de ventana de normalización inicial */
export const NORMALIZE_WINDOW_INITIAL = 11;

/** Centro de ventana de normalización */
export const NORMALIZE_CENTER_INDEX = 5;

/** Longitud de ventana para pocos picos consecutivos (frames) */
export const WINDOW_LEN_SHORT_PEAKS = 90;

/** Longitud de ventana para muchos picos consecutivos (frames) */
export const WINDOW_LEN_LONG_PEAKS = 150;

/** Umbral de picos consecutivos para ventana larga */
export const CONSECUTIVE_PEAKS_WINDOW_THRESHOLD = 4;

/** Offset izquierdo para análisis de pendiente */
export const SLOPE_LEFT_OFFSET = 3;

/** Offset derecho para análisis de pendiente */
export const SLOPE_RIGHT_OFFSET = 3;

/** Tamaño de buffer de derivada para zero-crossing */
export const DERIVATIVE_ZERO_CROSSING_SIZE = 8;

/** Offset de zero-crossing para análisis */
export const ZERO_CROSSING_OFFSET_1 = 3;
export const ZERO_CROSSING_OFFSET_2 = 4;
export const ZERO_CROSSING_OFFSET_3 = 5;
export const ZERO_CROSSING_OFFSET_4 = 6;

/** Mínimo de samples de slope sum para análisis */
export const MIN_SLOPE_SUM_SAMPLES = 3;

/** Offset de slope sum para análisis */
export const SLOPE_SUM_OFFSET = 3;

// ═════════════════════════════════════════════════════════════════════════════
// SQI Y CONFIANZA DE LATIDOS
// ═════════════════════════════════════════════════════════════════════════════

/** Factor de penalidad por movimiento en SQI */
export const BEAT_SQI_MOTION_FACTOR = 0.3;

/** Máximo de latidos consecutivos para SQI */
export const BEAT_SQI_MAX_CONSECUTIVE = 30;

/** Peso de penalidad por movimiento en SQI */
export const BEAT_SQI_MOTION_PENALTY = 20;

/** Peso de inconsistencia RR en SQI */
export const BEAT_SQI_RR_INCONSISTENCY_WEIGHT = 15;

/** Peso de clipping en SQI */
export const BEAT_SQI_CLIPPING_WEIGHT = 15;

/** Peso de morphología degradada en SQI */
export const BEAT_SQI_DEGRADED_MORPHOLOGY_WEIGHT = 8;

/** Peso de baja prominencia en SQI */
export const BEAT_SQI_LOW_PROMINENCE_WEIGHT = 7;

/** Peso de penalidad por presión en SQI */
export const BEAT_SQI_PRESSURE_PENALTY = 5;

/** Peso de calidad de contacto en SQI */
export const BEAT_SQI_CONTACT_QUALITY_WEIGHT = 15;

/** Peso de estabilidad de señal en SQI */
export const BEAT_SQI_SIGNAL_STABILITY_WEIGHT = 12;

/** Peso de acuerdo detector en SQI */
export const BEAT_SQI_DETECTOR_AGREEMENT_WEIGHT = 10;

/** Bonus de latido temprano en SQI */
export const BEAT_SQI_PREMATURE_BONUS = 5;

/** Factor de bonus por calidad en SQI */
export const BEAT_SQI_QUALITY_BONUS_FACTOR = 0.58;

/** Factor base de SQI */
export const BEAT_SQI_BASE_FACTOR = 0.42;

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE CONFIANZA
// ═════════════════════════════════════════════════════════════════════════════

/** Factor de confianza para inconsistencia RR */
export const CONFIDENCE_RR_INCONSISTENCY_FACTOR = 0.75;

/** Factor de decremento por inconsistencia RR */
export const CONFIDENCE_RR_DECREMENT = 0.15;

/** Factor de mejora por acuerdo detector */
export const CONFIDENCE_DETECTOR_AGREEMENT_BOOST = 0.1;

/** Mínima confianza permitida */
export const MIN_CONFIDENCE_THRESHOLD = 0.3;

/** Confianza base mínima */
export const BASE_CONFIDENCE_VALUE = 0.5;

/** Máxima reducción de confianza por latido perdido */
export const MAX_MISSED_BEAT_CONFIDENCE_REDUCTION = 0.35;

/** Reducción de confianza por latido perdido */
export const MISSED_BEAT_CONFIDENCE_PENALTY = 0.2;

// ═════════════════════════════════════════════════════════════════════════════
// UMBRALES DE PICOS Y ANÁLISIS
// ═════════════════════════════════════════════════════════════════════════════

/** Mínimo de picos consecutivos para análisis confiable */
export const MIN_CONSECUTIVE_PEAKS_ANALYSIS = 3;

/** Factor mínimo de SQI para dominio de picos */
export const PEAK_DOMAIN_SQI_FACTOR_MIN = 35;

/** Mínimo de intervalos RR para análisis */
export const MIN_RR_FOR_ANALYSIS = 2;

/** Máximo de intervalos RR recientes para análisis */
export const MAX_RECENT_RR_INTERVALS = 10;

/** Máximo de intervalos RR para trimmed mean */
export const MAX_RR_FOR_TRIMMED_MEAN = 12;

/** Factor de trim para trimmed mean */
export const TRIMMED_MEAN_FACTOR = 0.2;

// ═════════════════════════════════════════════════════════════════════════════
// EMA Y SUAVIZADO
// ═════════════════════════════════════════════════════════════════════════════

/** Alpha por defecto para EMA de BPM */
export const BPM_EMA_ALPHA_DEFAULT = 0.15;  // Reducido de 0.25 para mayor estabilidad

/** Alpha lento para EMA (cambios grandes) */
export const BPM_EMA_ALPHA_SLOW = 0.04;    // Reducido de 0.06 para mayor estabilidad

/** Alpha medio para EMA (cambios moderados) */
export const BPM_EMA_ALPHA_MED = 0.08;     // Reducido de 0.12 para mayor estabilidad

/** Umbral de diferencia relativa para EMA lento */
export const BPM_EMA_DIFF_SLOW_THRESHOLD = 0.25;  // Reducido de 0.30 para mayor estabilidad

/** Umbral de diferencia relativa para EMA medio */
export const BPM_EMA_DIFF_MED_THRESHOLD = 0.15;   // Reducido de 0.18 para mayor estabilidad

/** Alpha mínimo para EMA con pocos picos */
export const BPM_EMA_ALPHA_MIN = 0.03;    // Reducido de 0.05 para mayor estabilidad

/** Decremento de alpha con pocos picos */
export const BPM_EMA_ALPHA_DECREMENT = 0.04; // Reducido de 0.06 para mayor estabilidad

/** Umbral de picos consecutivos para EMA normal */
export const BPM_EMA_CONSECUTIVE_PEAKS_THRESHOLD = 5;

// ═════════════════════════════════════════════════════════════════════════════
// AUTO-CORRELACIÓN BPM
// ═════════════════════════════════════════════════════════════════════════════

/** Lag mínimo para auto-correlación (5 samples) */
export const AUTOCORR_MIN_LAG_SAMPLES = 5;

/** BPM máximo para auto-correlación (200 BPM) */
export const AUTOCORR_MAX_BPM = 200;

/** BPM mínimo para auto-correlación (38 BPM) */
export const AUTOCORR_MIN_BPM = 38;

/** Buffer offset para auto-correlación */
export const AUTOCORR_BUFFER_OFFSET = 10;

/** Máximo bias de ritmo */
export const AUTOCORR_RHYTHM_BIAS_MAX = 0.15;

/** Factor de bias de ritmo */
export const AUTOCORR_RHYTHM_BIAS_FACTOR = 0.1;

/** Score mínimo para aceptar lag */
export const AUTOCORR_MIN_SCORE = 0.2;

// ═════════════════════════════════════════════════════════════════════════════
// SQI GLOBAL
// ═════════════════════════════════════════════════════════════════════════════

/** Frames mínimos para SQI global */
export const GLOBAL_SQI_MIN_FRAMES = 30;

/** Window length para SQI de rango */
export const GLOBAL_SQI_RANGE_WINDOW = 60;

/** Divisor para factor de rango */
export const GLOBAL_SQI_RANGE_DIVISOR = 5;

/** Peso de factor de rango */
export const GLOBAL_SQI_RANGE_WEIGHT = 22;

/** Divisor para factor de picos */
export const GLOBAL_SQI_PEAK_DIVISOR = 5;

/** Peso de factor de picos */
export const GLOBAL_SQI_PEAK_WEIGHT = 20;

/** Window length para SQI de derivada */
export const GLOBAL_SQI_DERIV_WINDOW = 60;

/** Divisor para factor de pendiente */
export const GLOBAL_SQI_SLOPE_DIVISOR = 1.0;

/** Peso de factor de pendiente */
export const GLOBAL_SQI_SLOPE_WEIGHT = 14;

/** Factor de variación para SQI RR */
export const GLOBAL_SQI_RR_CV_FACTOR = 2;

/** Peso de factor RR */
export const GLOBAL_SQI_RR_WEIGHT = 22;

/** Factor de periodicidad */
export const GLOBAL_SQI_PERIODICITY_FACTOR = 0.6;

/** Peso de factor de periodicidad */
export const GLOBAL_SQI_PERIODICITY_WEIGHT = 22;

// ═════════════════════════════════════════════════════════════════════════════
// PAN-TOMPKINS
// ═════════════════════════════════════════════════════════════════════════════

/** Alpha para SignalLevel (0.125 = 1/8) */
export const PT_SIGNAL_LEVEL_ALPHA = 0.875;

/** Alpha para actualización de SignalLevel */
export const PT_SIGNAL_UPDATE_ALPHA = 0.125;

/** Factor de threshold adaptativo */
export const PT_THRESHOLD_FACTOR = 0.25;

/** Smooth factor para threshold */
export const PT_THRESHOLD_SMOOTH_FACTOR = 0.75;

/** Alpha para actualización de threshold */
export const PT_THRESHOLD_UPDATE_ALPHA = 0.25;

/** Smooth factor para threshold fallback */
export const PT_FALLBACK_SMOOTH_FACTOR = 0.80;

/** Alpha para actualización fallback */
export const PT_FALLBACK_UPDATE_ALPHA = 0.20;

/** Threshold base con autocorrelación */
export const PT_BASE_THRESHOLD_WITH_AUTOCORR = 1.4;

/** Threshold base sin autocorrelación */
export const PT_BASE_THRESHOLD_NO_AUTOCORR = 2.4;

/** Factor de rango para threshold */
export const PT_THRESHOLD_RANGE_FACTOR = 0.25;

/** Mínimo threshold */
export const PT_THRESHOLD_MIN = 0.9;

/** Máximo threshold */
export const PT_THRESHOLD_MAX = 6.0;

/** Default peak threshold para hardReset */
export const DEFAULT_PEAK_THRESHOLD = 4.0;

// ═════════════════════════════════════════════════════════════════════════════
// ESTIMACIÓN DE SAMPLE RATE
// ═════════════════════════════════════════════════════════════════════════════

/** Frames mínimos para estimar sample rate */
export const SAMPLE_RATE_MIN_FRAMES = 10;

/** Default sample rate (fps) */
export const SAMPLE_RATE_DEFAULT_FPS = 30;

/** Máximo de intervalos a considerar */
export const SAMPLE_RATE_MAX_INTERVALS = 50;

/** Intervalo mínimo válido (ms) */
export const SAMPLE_RATE_MIN_INTERVAL_MS = 8;

/** Intervalo máximo válido (ms) */
export const SAMPLE_RATE_MAX_INTERVAL_MS = 120;

/** Intervalos mínimos para confianza */
export const SAMPLE_RATE_MIN_INTERVALS = 6;

/** Sample rate mínimo válido (fps) */
export const SAMPLE_RATE_MIN_FPS = 15;

/** Sample rate máximo válido (fps) */
export const SAMPLE_RATE_MAX_FPS = 60;

/** Factor de conversión a ms */
export const MS_PER_SECOND = 1000;

// ═════════════════════════════════════════════════════════════════════════════
// SPECTRAL HR
// ═════════════════════════════════════════════════════════════════════════════

/** Frames mínimos para estimación spectral */
export const SPECTRAL_MIN_FRAMES = 90;

/** Tamaño máximo de buffer spectral */
export const SPECTRAL_MAX_BUFFER_SIZE = 128;

// ═════════════════════════════════════════════════════════════════════════════
// SLOPE SUM
// ═════════════════════════════════════════════════════════════════════════════

/** Window size para slope sum */
export const SLOPE_SUM_WINDOW_SIZE = 5;

// ═════════════════════════════════════════════════════════════════════════════
// SIGNAL RANGE
// ═════════════════════════════════════════════════════════════════════════════

/** Frames mínimos para signal range */
export const SIGNAL_RANGE_MIN_FRAMES = 10;

/** Percentil inferior para rango */
export const SIGNAL_RANGE_LOW_PERCENTILE = 0.1;

/** Percentil superior para rango */
export const SIGNAL_RANGE_HIGH_PERCENTILE = 0.9;

// ═════════════════════════════════════════════════════════════════════════════
// NORMALIZACIÓN
// ═════════════════════════════════════════════════════════════════════════════

/** Factor de escalado para normalización */
export const NORMALIZATION_SCALE_FACTOR = 120;

/** Offset para normalización */
export const NORMALIZATION_OFFSET = 0.5;

/** Rango mínimo para normalización válida */
export const NORMALIZATION_MIN_RANGE = 0.05;

/** Window length corta para normalización */
export const NORMALIZATION_WINDOW_SHORT = 90;

/** Window length larga para normalización */
export const NORMALIZATION_WINDOW_LONG = 150;

/** Umbral de picos para window larga */
export const NORMALIZATION_PEAK_THRESHOLD = 4;

// ═════════════════════════════════════════════════════════════════════════════
// PPG SIGNAL PROCESSOR - Constantes específicas
// ═════════════════════════════════════════════════════════════════════════════

/** Tamaño del buffer principal para señales RGB */
export const PPG_BUF_SIZE = 360;

/** Tamaño del buffer de tiempos de frame */
export const FRAME_TIME_BUF_SIZE = 120;

/** Tamaño del buffer de luminancia */
export const LUMINANCE_RING_SIZE = 36;

/** Grid de extracción multi-ROI (filas) */
export const MULTI_ROI_GRID_ROWS = 5;

/** Grid de extracción multi-ROI (columnas) */
export const MULTI_ROI_GRID_COLS = 5;

/** Fracción interna del ROI (cubre casi todo el frame cuando hay dedo) */
export const MULTI_ROI_INNER_FRACTION = 0.95;

/** Sample step para extracción multi-ROI */
export const MULTI_ROI_SAMPLE_STEP = 1;

/** Tamaño del modelo de reputación ROI */
export const ROI_REPUTATION_SIZE = 25;

/** Window size para SignalQualityEngine */
export const SIGNAL_QUALITY_ENGINE_WINDOW = 480;

/** Sample rate estimado por defecto (fps) */
export const ESTIMATED_SAMPLE_RATE = 30;

/** Umbral de movimiento */
export const MOTION_THRESHOLD = 0.6;

/** Gate espectral para dedo */
export const SPECTRAL_GATE_FOR_FINGER = 0.45;

/** Resolución de detección: ancho */
export const DETECTION_WIDTH = 160;

/** Resolución de detección: alto */
export const DETECTION_HEIGHT = 120;

/** Resolución de extracción: ancho */
export const EXTRACTION_WIDTH = 320;

/** Resolución de extracción: alto */
export const EXTRACTION_HEIGHT = 240;

/** ID del tier de extracción por defecto */
export const EXTRACTION_TIER_ID = 'M';

/** Modo de extracción por defecto */
export const EXTRACTION_MODE_DEFAULT = 'BALANCED';

/** Frames para bloqueo de posición */
export const POS_LOCK_FRAMES = 60;

/** Tolerancia de deriva de posición */
export const POS_DRIFT_TOLERANCE = 0.12;

/** Alpha para suavizado RGB */
export const RGB_ALPHA = 0.05;

/** Alpha para suavizado de cobertura */
export const COV_ALPHA = 0.06;

/** Frames mínimos para estabilidad temporal */
export const TEMPORAL_STABILITY_MIN_FRAMES = 12;

/** Window para media de luminancia */
export const LUMINANCE_MEAN_WINDOW = 24;

/** Window para varianza de luminancia */
export const LUMINANCE_VAR_WINDOW = 24;

/** Factor CV para estabilidad temporal */
export const TEMPORAL_STABILITY_CV_FACTOR = 8;

/** Fracción válida mínima para celdas centrales */
export const CENTER_CELL_VALID_FRACTION = 0.2;

/** Valor R mínimo para celdas centrales */
export const CENTER_CELL_MIN_R = 30;

/** Epsilon para evitar división por cero en coeficiente de variación */
export const CV_EPSILON = 1e-6;

/** Frames mínimos para calcular AC/DC */
export const MIN_FRAMES_ACDC = 40;

/** Divisor para calcular cobertura suavizada */
export const COVERAGE_DIVISOR = 25;

/** EMA alpha para fine boost */
export const FINE_BOOST_EMA_ALPHA = 0.18;

/** EMA (1-alpha) para fine boost */
export const FINE_BOOST_EMA_BASE = 0.82;

/** Dimensiones de refinamiento de celda */
export const CELL_REFINEMENT_DIM = 5;

/** Coeficiente R para luminancia (ITU-R BT.601) */
export const LUM_R_COEFF = 0.299;

/** Coeficiente G para luminancia (ITU-R BT.601) */
export const LUM_G_COEFF = 0.587;

/** Coeficiente B para luminancia (ITU-R BT.601) */
export const LUM_B_COEFF = 0.114;

/** Peso para autocorr peak en concentración espectral */
export const SPEC_CONC_AUTOCORR_WEIGHT = 0.55;

/** Peso para pulse corr en concentración espectral */
export const SPEC_CONC_PULSE_WEIGHT = 0.45;

/** Factor para evitar división por cero en umbral de movimiento */
export const MOTION_THRESH_EPSILON = 0.01;

// ═════════════════════════════════════════════════════════════════════════════
// PPG FEATURE EXTRACTOR - Constantes para extracción de características
// ═════════════════════════════════════════════════════════════════════════════

/** Duración mínima de ciclo cardíaco (ms) - ~171 BPM máximo */
export const CYCLE_MIN_DURATION_MS = 350;

/** Duración máxima de ciclo cardíaco (ms) - ~33 BPM mínimo */
export const CYCLE_MAX_DURATION_MS = 1800;

/** Factor para estimar posición de dicrotic notch (60% del ciclo) */
export const DIACROTIC_NOTCH_ESTIMATE_FACTOR = 0.6;

/** Offset de búsqueda para dicrotic notch */
export const DIACROTIC_NOTCH_SEARCH_OFFSET = 2;

/** Offset de búsqueda para fin de ciclo */
export const CYCLE_END_SEARCH_OFFSET = 1;

/** Nivel de amplitud para PW10 (10%) */
export const PULSE_WIDTH_LEVEL_10 = 0.10;

/** Nivel de amplitud para PW25 (25%) */
export const PULSE_WIDTH_LEVEL_25 = 0.25;

/** Nivel de amplitud para PW50 (50%) */
export const PULSE_WIDTH_LEVEL_50 = 0.50;

/** Nivel de amplitud para PW75 (75%) */
export const PULSE_WIDTH_LEVEL_75 = 0.75;

/** Factor para estimar amplitud diastólica */
export const DIASTOLIC_AMPLITUDE_FACTOR = 0.5;

/** Factor de escala para PWV proxy */
export const PWV_SCALE_FACTOR = 0.01;

/** Factor de stiffness para PWV proxy */
export const PWV_STIFFNESS_FACTOR = 0.5;

/** Base para cálculo de PWV proxy */
export const PWV_BASE = 4.0;

/** Muestras mínimas para segmento APG */
export const APG_MIN_SAMPLES = 10;

/** Longitud mínima de derivada para APG */
export const APG_MIN_DERIVATIVE_LENGTH = 8;

/** Distancia mínima entre valles (factor de sample rate) - 300ms */
export const MIN_VALLEY_DISTANCE_FACTOR = 0.3;

/** Umbral de amplitud para calidad - nivel bajo */
export const QUALITY_AMPLITUDE_LOW = 0.3;

/** Peso calidad - amplitud baja */
export const QUALITY_WEIGHT_AMPLITUDE_LOW = 0.15;

/** Umbral de amplitud para calidad - nivel medio */
export const QUALITY_AMPLITUDE_MED = 1.0;

/** Peso calidad - amplitud media */
export const QUALITY_WEIGHT_AMPLITUDE_MED = 0.1;

/** Umbral de amplitud para calidad - nivel alto */
export const QUALITY_AMPLITUDE_HIGH = 2.5;

/** Peso calidad - amplitud alta */
export const QUALITY_WEIGHT_AMPLITUDE_HIGH = 0.05;

/** SUT mínimo para calidad (ms) */
export const QUALITY_SUT_MIN_MS = 40;

/** SUT máximo para calidad (ms) */
export const QUALITY_SUT_MAX_MS = 350;

/** Peso calidad - SUT */
export const QUALITY_WEIGHT_SUT = 0.2;

/** Factor de tiempo diastólico mínimo */
export const QUALITY_DIASTOLIC_TIME_FACTOR = 0.7;

/** Peso calidad - tiempo diastólico */
export const QUALITY_WEIGHT_DIASTOLIC_TIME = 0.15;

/** PW50 mínimo para calidad (ms) */
export const QUALITY_PW50_MIN_MS = 80;

/** PW50 máximo para calidad (ms) */
export const QUALITY_PW50_MAX_MS = 800;

/** Peso calidad - PW50 */
export const QUALITY_WEIGHT_PW50 = 0.1;

/** Peso calidad - dicrotic notch */
export const QUALITY_WEIGHT_NOTCH = 0.25;

/** Muestras mínimas para buffer AC/DC */
export const AC_DC_MIN_SAMPLES = 10;

/** Ventana de muestras para cálculo AC/DC */
export const AC_DC_WINDOW_SAMPLES = 30;

/** Intervalos mínimos para variabilidad RR */
export const RR_VAR_MIN_INTERVALS = 2;

/** Intervalo RR válido mínimo (ms) */
export const RR_VALID_MIN_MS = 100;

/** Intervalo RR válido máximo (ms) */
export const RR_VALID_MAX_MS = 5000;

// ═════════════════════════════════════════════════════════════════════════════
// VITAL SIGNS PROCESSOR - Constantes para procesamiento de signos vitales
// ═════════════════════════════════════════════════════════════════════════════

/** Muestras mínimas para calibración */
export const CALIBRATION_REQUIRED_SAMPLES = 25;

/** Tamaño del historial de señal */
export const SIGNAL_HISTORY_SIZE = 90;

/** Sample rate por defecto (Hz) */
export const DEFAULT_SAMPLE_RATE = 30;

/** Sample rate mínimo (Hz) */
export const SAMPLE_RATE_MIN = 15;

/** Sample rate máximo (Hz) */
export const SAMPLE_RATE_MAX = 60;

/** Muestras mínimas para procesamiento de señal */
export const SIGNAL_MIN_SAMPLES = 20;

/** Tamaño de ventana para cálculo de calidad */
export const QUALITY_WINDOW_SIZE = 60;

/** Percentil 10 para cálculo de rango */
export const PERCENTILE_10 = 0.1;

/** Percentil 90 para cálculo de rango */
export const PERCENTILE_90 = 0.9;

/** Rango mínimo de señal */
export const SIGNAL_RANGE_MIN = 0.2;

/** Valor de calidad por defecto para rango bajo */
export const QUALITY_LOW_VALUE = 2;

/** Epsilon para evitar división por cero en SNR */
export const SNR_EPSILON = 0.05;

/** Factor de escala para SNR */
export const SNR_SCALE_FACTOR = 16;

/** Calidad mínima para confianza ALTA */
export const CONFIDENCE_HIGH_QUALITY = 45;

/** Pulso válido mínimo para confianza ALTA */
export const CONFIDENCE_HIGH_PULSES = 4;

/** Calidad mínima para confianza MEDIA */
export const CONFIDENCE_MEDIUM_QUALITY = 24;

/** Pulso válido mínimo para confianza MEDIA */
export const CONFIDENCE_MEDIUM_PULSES = 3;

/** Calidad mínima para confianza BAJA */
export const CONFIDENCE_LOW_QUALITY = 10;

/** Pulso válido mínimo para confianza BAJA */
export const CONFIDENCE_LOW_PULSES = 2;

/** Intervalo RR válido mínimo para vital signs (ms) */
export const VITALS_RR_MIN_MS = 270;

/** Intervalo RR válido máximo para vital signs (ms) */
export const VITALS_RR_MAX_MS = 2200;

/** Milisegundos por minuto */
export const MS_PER_MINUTE = 60000;

/** Muestras mínimas para SpO₂ */
export const SPO2_MIN_SAMPLES = 2;

/** Umbral mínimo de medianR para calibración SpO₂ */
export const SPO2_MEDIANR_MIN = 0;

/** Factor de varianza para calibración */
export const CALIBRATION_VARIANCE_FACTOR = 0.05;

/** Divisor para convertir porcentaje (100) */
export const PERCENTAGE_DIVISOR = 100;

/** Umbral ACDC mínimo para ratio estable */
export const ACDC_RATIO_MIN = 0.01;

/** Ratio de clipping máximo aceptable */
export const CLIPPING_RATIO_MAX = 0.08;

/** Índice de perfusión mínimo para SpO₂ */
export const PERFUSION_INDEX_MIN = 0.35;

/** Calidad mínima para ciclos cardíacos */
export const CYCLE_QUALITY_MIN = 0.2;

/** Muestras mínimas para media */
export const MIN_SAMPLES_FOR_MEAN = 1;

/** Tiempo máximo desde último pico (ms) */
export const MAX_TIME_SINCE_PEAK_MS = 4000;

/** Timestamp límite para detección de clock (1e12 = 1 trillón) */
export const TIMESTAMP_CLOCK_THRESHOLD = 1e12;

/** Calidad mínima de señal para cálculo de signos vitales */
export const VITALS_QUALITY_THRESHOLD = 8;

/** Epsilon para evitar división por cero en smoothValue */
export const SMOOTH_VALUE_EPSILON = 0.01;

/** Factor de cambio relativo alto para EMA */
export const EMA_REL_CHANGE_HIGH = 0.5;

/** Factor de cambio relativo medio para EMA */
export const EMA_REL_CHANGE_MED = 0.3;

/** Factor de cambio relativo bajo para EMA */
export const EMA_REL_CHANGE_LOW = 0.1;

/** Multiplicador EMA para cambio alto */
export const EMA_MULTIPLIER_HIGH = 0.3;

/** Multiplicador EMA para cambio medio */
export const EMA_MULTIPLIER_MED = 0.5;

/** Multiplicador EMA para cambio bajo */
export const EMA_MULTIPLIER_LOW = 1.5;

/** BPM mínimo para HR válido */
export const HR_MIN_BPM = 35;

/** BPM máximo para HR válido */
export const HR_MAX_BPM = 200;

/** Calidad mínima para procesamiento de glucosa */
export const GLUCOSE_QUALITY_THRESHOLD = 10;

/** Latidos mínimos para análisis de arritmia */
export const ARRHYTHMIA_MIN_BEATS = 8;

/** SQI mínimo para análisis de arritmia */
export const ARRHYTHMIA_MIN_SQI = 20;

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
