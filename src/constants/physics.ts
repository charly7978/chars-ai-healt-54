/**
 * CONSTANTES FÍSICAS CENTRALIZADAS - PPG Health Monitor
 * 
 * Este archivo contiene todas las constantes físicas y fisiológicas
 * usadas en el sistema. Evita duplicación y garantiza consistencia.
 * 
 * Regla: Si una constante aparece en 2+ archivos, debe estar aquí.
 */

// ═════════════════════════════════════════════════════════════════════════════
// FÍSICA CARDÍACA
// ═════════════════════════════════════════════════════════════════════════════

/** Milisegundos en un minuto */
export const MS_PER_MINUTE = 60000;

/** BPM mínimo fisiológicamente posible (33 BPM → ~1800ms RR) */
export const MIN_BPM = 33;

/** BPM máximo fisiológicamente posible (171 BPM → ~350ms RR) */
export const MAX_BPM = 171;

/** RR mínimo válido en ms (350ms → 171 BPM) */
export const MIN_RR_MS = 350;

/** RR máximo válido en ms (1800ms → 33 BPM) */
export const MAX_RR_MS = 1800;

/** Frecuencia cardíaca mínima para cálculos (38 BPM) */
export const MIN_HR_BPM = 38;

/** Frecuencia cardíaca máxima para cálculos (195 BPM) */
export const MAX_HR_BPM = 195;

/** Cambio máximo fisiológico de BPM por segundo (reacción al esfuerzo) */
export const MAX_BPM_CHANGE_PER_SEC = 25;

/** Máxima variación RR aceptable para un latido válido */
export const MAX_RR_VARIATION_FACTOR = 1.7;

// ═════════════════════════════════════════════════════════════════════════════
// PROCESAMIENTO DE SEÑAL
// ═════════════════════════════════════════════════════════════════════════════

/** Sample rate objetivo para PPG (fps) */
export const TARGET_SAMPLE_RATE = 30;

/** Sample rate mínimo aceptable */
export const MIN_SAMPLE_RATE = 15;

/** Sample rate máximo */
export const MAX_SAMPLE_RATE = 60;

/** Tamaño de buffer circular estándar (2 segundos a 30fps) */
export const STANDARD_BUFFER_SIZE = 360;

/** Tamaño mínimo de buffer para procesamiento válido */
export const MIN_BUFFER_SIZE = 60;

/** Período refractario cardíaco mínimo entre latidos (ms) - PPG es más lento que ECG */
export const PPG_REFRACTORY_MS = 280;

/** Período refractario duro (ms) */
export const HARD_REFRACTORY_MS = 300;

/** Factor de throttling para procesamiento (ms) */
export const PROCESSING_THROTTLE_MS = 12;

// ═════════════════════════════════════════════════════════════════════════════
// CROMÁTICA Y ÓPTICA
// ═════════════════════════════════════════════════════════════════════════════

/** Umbral meanR para ataque (entrada) - tejido perfundido */
export const CHROMA_ATK_MEAN_R = 130;

/** Umbral meanR para release (salida) - más permisivo para valles fisiológicos */
export const CHROMA_REL_MEAN_R = 95;

/** Umbral R/max(G,B) para ataque */
export const CHROMA_ATK_R_OVER_MAX = 1.55;

/** Umbral R/max(G,B) para release */
export const CHROMA_REL_R_OVER_MAX = 1.20;

/** Umbral R-max(G,B) absoluto para ataque */
export const CHROMA_ATK_R_MINUS_MAX = 25;

/** Umbral R-max(G,B) absoluto para release */
export const CHROMA_REL_R_MINUS_MAX = 14;

/** Umbral DC rojo para ataque */
export const CHROMA_ATK_DC_RED = 110;

/** Umbral DC rojo para release */
export const CHROMA_REL_DC_RED = 80;

/** Frames consecutivos para confirmar cromática (ataque) */
export const CHROMA_CONFIRM_FRAMES = 4;

/** Frames consecutivos sin cromática para reset (release) */
export const CHROMA_PERSIST_FAIL_FRAMES = 36;

/** Alpha para EMA cromática (tau ~500ms a 30fps) */
export const CHROMA_EMA_ALPHA = 0.10;

/** DC rojo mínimo para validación cruzada */
export const DC_RED_MIN_FOR_VALIDATION = 70;

// ═════════════════════════════════════════════════════════════════════════════
// EVIDENCIA PPG Y CALIDAD
// ═════════════════════════════════════════════════════════════════════════════

/** Perfusion Index mínimo válido (0.3% = perfusión débil pero medible) */
export const MIN_PERFUSION_INDEX = 0.30;

/** Perfusion Index objetivo (1.0% = estándar clínico) */
export const TARGET_PERFUSION_INDEX = 1.00;

/** Window SQI mínimo */
export const MIN_WINDOW_SQI = 0.30;

/** Window SQI objetivo */
export const TARGET_WINDOW_SQI = 0.65;

/** Spectral dominance mínimo */
export const MIN_SPECTRAL_DOMINANCE = 0.18;

/** Spectral dominance objetivo */
export const TARGET_SPECTRAL_DOMINANCE = 0.50;

/** Detector agreement mínimo */
export const MIN_DETECTOR_AGREEMENT = 0.25;

/** Detector agreement objetivo */
export const TARGET_DETECTOR_AGREEMENT = 0.60;

/** Latidos aceptados mínimos */
export const MIN_ACCEPTED_BEATS = 2;

/** Latidos aceptados objetivo */
export const TARGET_ACCEPTED_BEATS = 5;

/** Picos consecutivos mínimos */
export const MIN_CONSECUTIVE_PEAKS = 3;

/** Beat SQI mínimo */
export const MIN_BEAT_SQI = 30;

/** Morphology score mínimo */
export const MIN_MORPHOLOGY_SCORE = 30;

/** Umbral de confianza BPM para publicar */
export const MIN_BPM_CONFIDENCE_TO_PUBLISH = 0.18;

// ═════════════════════════════════════════════════════════════════════════════
// THRESHOLDS Y LÍMITES
// ═════════════════════════════════════════════════════════════════════════════

/** Frames sin contacto antes de reset */
export const NO_CONTACT_RESET_THRESHOLD = 90;

/** Frames sin evidencia antes de hard-reset */
export const INVALID_EVIDENCE_HARD_RESET = 30;

/** Frames de gate fail antes de invalidar */
export const GATE_FAIL_INVALIDATE_FRAMES = 8;

/** Frames inestables antes de mostrar 0 */
export const UNSTABLE_ZERO_THRESHOLD = 12;

/** Tiempo de hold para último BPM válido (ms) */
export const BPM_HOLD_MS = 2500;

/** Máximo clip ratio aceptable */
export const MAX_ACCEPTABLE_CLIP_RATIO = 0.08;

// ═════════════════════════════════════════════════════════════════════════════
// SUAVIZADO (EMA)
// ═════════════════════════════════════════════════════════════════════════════

/** Alpha EMA estándar para valores estables */
export const EMA_ALPHA_STABLE = 0.20;

/** Alpha EMA dinámico para valores en cambio */
export const EMA_ALPHA_DYNAMIC = 0.30;

/** Alpha EMA para UI */
export const EMA_ALPHA_UI = 0.30;

/** Alpha para RGB suavizado */
export const RGB_ALPHA = 0.05;

/** Alpha para coverage suavizado */
export const COV_ALPHA = 0.06;

/** Alpha EMA lento para calibración (respuesta lenta) */
export const EMA_ALPHA_SLOW = 0.10;

/** Alpha EMA para biomarcadores (glucosa, lípidos) */
export const EMA_ALPHA_BIOMARKER = 0.12;

/** Alpha EMA para presión arterial */
export const EMA_ALPHA_BP = 0.22;

/** Alpha EMA para research processors */
export const EMA_ALPHA_RESEARCH_GLUCOSE = 0.20;
export const EMA_ALPHA_RESEARCH_LIPID = 0.18;

// ═════════════════════════════════════════════════════════════════════════════
// FRECUENCIAS ESPECTRALES
// ═════════════════════════════════════════════════════════════════════════════

/** Frecuencia mínima cardíaca en Hz (0.65Hz = 39 BPM) */
export const MIN_FREQ_HZ = 0.65;

/** Frecuencia máxima cardíaca en Hz (3.5Hz = 210 BPM) */
export const MAX_FREQ_HZ = 3.5;

// ═════════════════════════════════════════════════════════════════════════════
// RESOLUCIONES DE CANVAS
// ═════════════════════════════════════════════════════════════════════════════

/** Ancho canvas de detección */
export const DETECTION_WIDTH = 160;

/** Alto canvas de detección */
export const DETECTION_HEIGHT = 120;

/** Ancho canvas de extracción base */
export const EXTRACTION_WIDTH = 320;

/** Alto canvas de extracción base */
export const EXTRACTION_HEIGHT = 240;

// ═════════════════════════════════════════════════════════════════════════════
// CALIBRACIÓN Y MUESTREO
// ═════════════════════════════════════════════════════════════════════════════

/** Muestras requeridas para calibración */
export const CALIBRATION_REQUIRED_SAMPLES = 25;

/** Tamaño de historial de señal */
export const SIGNAL_HISTORY_SIZE = 90;

/** Tamaño máximo de RR intervals */
export const MAX_RR_INTERVALS = 40;

/** Tamaño máximo de accepted beats */
export const MAX_ACCEPTED_BEATS = 60;

/** Intervalo de procesamiento de vitales (frames) */
export const VITALS_PROCESS_EVERY_N_FRAMES = 3;

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ═════════════════════════════════════════════════════════════════════════════

/** Convierte RR (ms) a BPM */
export const rrToBpm = (rrMs: number): number => MS_PER_MINUTE / rrMs;

/** Convierte BPM a RR (ms) */
export const bpmToRr = (bpm: number): number => MS_PER_MINUTE / bpm;

/** Verifica si un valor RR está en rango fisiológico */
export const isValidRr = (rrMs: number): boolean => rrMs >= MIN_RR_MS && rrMs <= MAX_RR_MS;

/** Verifica si un BPM está en rango válido */
export const isValidBpm = (bpm: number): boolean => bpm >= MIN_HR_BPM && bpm <= MAX_HR_BPM;
