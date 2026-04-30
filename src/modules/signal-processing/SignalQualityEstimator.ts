/**
 * SIGNAL QUALITY ESTIMATOR V3
 * Comprehensive SQI from multiple dimensions.
 * No simulation — pure signal analysis.
 * 
 * Referencias:
 * - Li & Bhatt 2014: Template matching SQI (AUC 0.943)
 * - Krishnan et al. 2010: Skewness + Kurtosis for PPG quality
 * - ChatPPG: Best practices for PPG signal quality assessment
 */
import type { PressureState } from '../../types/signal';

export interface SQIReport {
  sqiGlobal: number;           // 0-100
  perfusionIndex: number;
  periodicityScore: number;
  bandPowerRatio: number;
  roiValidRatio: number;
  spatialUniformity: number;
  pressureState: PressureState;
  motionScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  positionDrift: number;
  activeSource: string;
  sourceStability: number;
  guidance: string;
  // Nuevas métricas SQI avanzadas
  templateCorrelation?: number;  // Template matching SQI (-1 a 1)
  skewness?: number;             // Forma de onda: asimetría
  kurtosis?: number;             // Forma de onda: peakedness
  zeroCrossingRate?: number;     // Complejidad de la forma de onda
}

export function computeGlobalSQI(params: {
  perfusionIndex: number;
  periodicityScore: number;
  coverageRatio: number;
  spatialUniformity: number;
  pressurePenalty: number;
  motionScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  positionDrift: number;
  signalRange: number;
  redDominance: number;
  contactState: string;
  sourceStability: number;
}): number {
  const {
    perfusionIndex, periodicityScore, coverageRatio,
    spatialUniformity, pressurePenalty, motionScore,
    clipHighRatio, clipLowRatio, positionDrift,
    signalRange, redDominance, contactState, sourceStability
  } = params;

  if (contactState === 'NO_CONTACT') return 0;

  // Gate: no hemoglobin signature = no real finger
  if (redDominance < 12) return 0;

  // Gate: no perfusion = no signal
  // Threshold según Cannesson et al. 2008: PI < 0.4% = mediciones no confiables
  // Sensibilidad 0.91, especificidad 0.82 para detectar SpO2 degradada
  if (perfusionIndex < 0.4) {
    // Señal extremadamente débil pero con algún contacto
    return Math.min(15, coverageRatio * 20 + perfusionIndex * 10);
  }

  // --- Component scores ---
  // PerfScore optimizado: max 25 puntos para PI ≥ 2.5% (señal fuerte)
  // PI típico bueno: 2-10%, PI excelente: >10%
  const perfScore = Math.min(25, 8 + perfusionIndex * 6);
  const periodicScore = Math.min(20, periodicityScore * 25);
  const coverageScore = Math.min(12, coverageRatio * 18);
  const uniformityScore = Math.min(8, spatialUniformity * 10);
  const rangeScore = Math.min(10, (signalRange / 5) * 10);
  const stabilityScore = Math.min(8, sourceStability * 10);

  // --- Penalties ---
  const motionPenalty = Math.min(20, motionScore * 16);
  const clipPenalty = Math.min(25, (clipHighRatio + clipLowRatio) * 40);
  const driftPenalty = Math.min(15, positionDrift * 50);

  // Pressure multiplier (0.3-1.0)
  const base = perfScore + periodicScore + coverageScore +
    uniformityScore + rangeScore + stabilityScore -
    motionPenalty - clipPenalty - driftPenalty;

  // Stable contact bonus
  const stableBonus = contactState === 'STABLE_CONTACT' ? 5 : 0;

  return Math.max(0, Math.min(100, (base + stableBonus) * pressurePenalty));
}

// ═════════════════════════════════════════════════════════════════════════════
// MÉTRICAS SQI AVANZADAS - Basadas en literatura validada
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Calcula la correlación de Pearson (template matching SQI).
 * Según Li & Bhatt 2014, esta es la métrica SQI más discriminativa (AUC 0.943).
 * r > 0.9 indica pulso morfológicamente normal.
 * 
 * @param signal - Segmento de señal PPG
 * @param template - Template de referencia (pulso promedio limpio)
 * @returns Correlación de Pearson (-1 a 1)
 */
export function calculateTemplateCorrelation(signal: number[], template: number[]): number {
  const n = Math.min(signal.length, template.length);
  if (n < 3) return 0;

  // Calcular medias
  let meanSig = 0, meanTmpl = 0;
  for (let i = 0; i < n; i++) {
    meanSig += signal[i];
    meanTmpl += template[i];
  }
  meanSig /= n;
  meanTmpl /= n;

  // Calcular correlación de Pearson
  let numerator = 0;
  let denomSig = 0;
  let denomTmpl = 0;
  
  for (let i = 0; i < n; i++) {
    const diffSig = signal[i] - meanSig;
    const diffTmpl = template[i] - meanTmpl;
    numerator += diffSig * diffTmpl;
    denomSig += diffSig * diffSig;
    denomTmpl += diffTmpl * diffTmpl;
  }

  const denominator = Math.sqrt(denomSig * denomTmpl);
  if (denominator < 1e-12) return 0;
  
  return numerator / denominator;
}

/**
 * Calcula skewness (asimetría) de la señal.
 * Para PPG limpio: skewness típicamente -1.5 a -0.3 (asimetría negativa por upstroke rápido).
 * Valores cercanos a 0 indican señal distorsionada o ruido simétrico.
 * 
 * @param signal - Array de muestras
 * @returns Skewness (0 = simétrico, negativo = cola izquierda, positivo = cola derecha)
 */
export function calculateSkewness(signal: number[]): number {
  const n = signal.length;
  if (n < 3) return 0;

  // Calcular media
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;

  // Calcular momentos
  let m2 = 0; // Varianza
  let m3 = 0; // Tercer momento
  
  for (let i = 0; i < n; i++) {
    const diff = signal[i] - mean;
    m2 += diff * diff;
    m3 += diff * diff * diff;
  }
  
  m2 /= n;
  m3 /= n;
  
  const std = Math.sqrt(Math.max(m2, 1e-12));
  return m3 / (std * std * std + 1e-12);
}

/**
 * Calcula kurtosis (exceso) de la señal.
 * Para PPG limpio: kurtosis típicamente 2.5 a 6.0 (forma peaked).
 * Valores bajos indican forma plana (ruido o artefacto).
 * 
 * @param signal - Array de muestras
 * @returns Kurtosis (3 = normal, >3 = peaked, <3 = flat)
 */
export function calculateKurtosis(signal: number[]): number {
  const n = signal.length;
  if (n < 4) return 3;

  // Calcular media
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;

  // Calcular momentos
  let m2 = 0; // Varianza
  let m4 = 0; // Cuarto momento
  
  for (let i = 0; i < n; i++) {
    const diff = signal[i] - mean;
    const diff2 = diff * diff;
    m2 += diff2;
    m4 += diff2 * diff2;
  }
  
  m2 /= n;
  m4 /= n;
  
  if (m2 < 1e-12) return 3;
  return m4 / (m2 * m2) - 3; // Exceso de kurtosis (0 = normal)
}

/**
 * Calcula Zero-Crossing Rate de la primera derivada.
 * Indica complejidad de la forma de onda.
 * Valores normales: 2-4 cruces por ciclo cardíaco.
 * Valores >6-8 indican artefacto de movimiento significativo.
 * 
 * @param signal - Array de muestras
 * @returns Número de zero-crossings por muestra (promedio)
 */
export function calculateZeroCrossingRate(signal: number[]): number {
  const n = signal.length;
  if (n < 3) return 0;

  // Calcular primera derivada
  const derivative: number[] = [];
  for (let i = 1; i < n; i++) {
    derivative.push(signal[i] - signal[i - 1]);
  }

  // Contar zero-crossings
  let zeroCrossings = 0;
  for (let i = 1; i < derivative.length; i++) {
    if ((derivative[i - 1] > 0 && derivative[i] <= 0) ||
        (derivative[i - 1] < 0 && derivative[i] >= 0)) {
      zeroCrossings++;
    }
  }

  // Normalizar por longitud del segmento
  return zeroCrossings / (n - 1);
}

/**
 * Calcula SQI basado en forma de onda usando skewness y kurtosis.
 * Basado en Krishnan et al. 2010: combinación de skewness + kurtosis mejora
 * precisión de clasificación de calidad de 89.3% a 93.7%.
 * 
 * @param signal - Array de muestras PPG
 * @returns Score 0-1 (1 = forma óptima)
 */
export function calculateMorphologySQI(signal: number[]): number {
  const skew = calculateSkewness(signal);
  const kurt = calculateKurtosis(signal);
  
  // Rangos óptimos según literatura
  // Skewness: -1.5 a -0.3 (asimetría negativa por upstroke rápido)
  // Kurtosis: 2.0 a 6.0 (forma peaked)
  
  const skewScore = skew < 0 && skew > -2.0 ? 1 - Math.abs(skew + 0.9) / 1.5 : 0;
  const kurtScore = kurt > 1.5 && kurt < 7.0 ? 1 - Math.abs(kurt - 4) / 3 : 0;
  
  return Math.max(0, Math.min(1, (skewScore + kurtScore) / 2));
}

/**
 * Determina guidance basado en métricas SQI avanzadas.
 * Proporciona feedback específico al usuario para mejorar la señal.
 */
export function getAdvancedSQIGuidance(
  perfusionIndex: number,
  templateCorrelation: number,
  skewness: number,
  kurtosis: number,
  zeroCrossingRate: number,
  motionScore: number
): string {
  const reasons: string[] = [];
  
  // Perfusion Index check (Carnesson et al. 2008: threshold 0.4%)
  if (perfusionIndex < 0.4) {
    reasons.push('Presión insuficiente: aumentar contacto con flash');
  }
  
  // Template correlation check (Li & Bhatt 2014: r > 0.9 es óptimo)
  if (templateCorrelation < 0.7) {
    reasons.push('Forma de pulso irregular: mantener dedo estable');
  }
  
  // Skewness check (PPG normal tiene skewness negativo)
  if (skewness > -0.2 || skewness < -2.0) {
    reasons.push('Morfología anómala: verificar posición del dedo');
  }
  
  // Zero-crossing rate check (>0.15 por muestra indica artefacto)
  if (zeroCrossingRate > 0.15) {
    reasons.push('Mucha variabilidad: reducir movimiento');
  }
  
  // Motion check
  if (motionScore > 0.3) {
    reasons.push('Detectado movimiento: mantener dedo quieto');
  }
  
  if (reasons.length === 0) {
    return 'Señal óptima: mantener posición';
  }
  
  return reasons.join(' | ');
}
