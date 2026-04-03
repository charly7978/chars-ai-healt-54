/**
 * HRV Analyzer - Análisis de Variabilidad de Frecuencia Cardíaca
 * 
 * Métricas implementadas (dominio tiempo):
 * - SDNN: Desviación estándar de intervalos NN (ms)
 * - RMSSD: Raíz cuadrada de la media de diferencias sucesivas al cuadrado (ms)
 * - pNN50: Porcentaje de diferencias sucesivas > 50ms
 * - SD1/SD2: Ejes del gráfico Poincaré (variabilidad corto/largo plazo)
 * - Mean RR: Intervalo RR medio (ms)
 * - Mean HR: Frecuencia cardíaca media (BPM)
 * 
 * Basado en Task Force of ESC/NASPE 1996 y Shaffer & Ginsberg 2017
 */

export interface HRVMetrics {
  sdnn: number;       // ms - variabilidad global
  rmssd: number;      // ms - variabilidad corto plazo (parasimpática)
  pnn50: number;      // % - porcentaje de intervalos >50ms diferencia
  meanRR: number;     // ms - intervalo RR medio
  meanHR: number;     // BPM - frecuencia media
  sd1: number;        // ms - eje menor Poincaré (corto plazo)
  sd2: number;        // ms - eje mayor Poincaré (largo plazo)
  sd1sd2Ratio: number; // ratio SD1/SD2
  totalIntervals: number;
  isValid: boolean;   // si hay suficientes datos para cálculo fiable
}

export interface PoincarePoint {
  rrN: number;    // RR(n)
  rrN1: number;   // RR(n+1)
}

const MIN_INTERVALS_FOR_HRV = 6;
const MIN_RR_MS = 300;   // ~200 BPM
const MAX_RR_MS = 2000;  // ~30 BPM

export class HRVAnalyzer {
  /**
   * Calcula todas las métricas HRV a partir de intervalos RR (ms)
   */
  static compute(rrIntervals: number[]): HRVMetrics {
    const invalid: HRVMetrics = {
      sdnn: 0, rmssd: 0, pnn50: 0,
      meanRR: 0, meanHR: 0,
      sd1: 0, sd2: 0, sd1sd2Ratio: 0,
      totalIntervals: rrIntervals.length,
      isValid: false
    };

    // Filtrar intervalos fisiológicamente válidos
    const valid = rrIntervals.filter(rr => rr >= MIN_RR_MS && rr <= MAX_RR_MS);
    if (valid.length < MIN_INTERVALS_FOR_HRV) return invalid;

    // Mean RR
    const meanRR = valid.reduce((a, b) => a + b, 0) / valid.length;
    const meanHR = 60000 / meanRR;

    // SDNN
    const squaredDiffs = valid.map(rr => Math.pow(rr - meanRR, 2));
    const sdnn = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / valid.length);

    // RMSSD y pNN50
    let sumSquaredSuccDiff = 0;
    let countNN50 = 0;
    for (let i = 1; i < valid.length; i++) {
      const diff = Math.abs(valid[i] - valid[i - 1]);
      sumSquaredSuccDiff += diff * diff;
      if (diff > 50) countNN50++;
    }
    const rmssd = Math.sqrt(sumSquaredSuccDiff / (valid.length - 1));
    const pnn50 = (countNN50 / (valid.length - 1)) * 100;

    // Poincaré SD1 / SD2
    // SD1 = SDSD / sqrt(2) = std de diferencias sucesivas / sqrt(2)
    // SD2 = sqrt(2 * SDNN^2 - 0.5 * SDSD^2)
    const diffs: number[] = [];
    for (let i = 1; i < valid.length; i++) {
      diffs.push(valid[i] - valid[i - 1]);
    }
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const sdsd = Math.sqrt(
      diffs.reduce((sum, d) => sum + Math.pow(d - meanDiff, 2), 0) / diffs.length
    );

    const sd1 = sdsd / Math.sqrt(2);
    const sd2Squared = 2 * sdnn * sdnn - sd1 * sd1;
    const sd2 = sd2Squared > 0 ? Math.sqrt(sd2Squared) : 0;
    const sd1sd2Ratio = sd2 > 0 ? sd1 / sd2 : 0;

    return {
      sdnn: Math.round(sdnn * 10) / 10,
      rmssd: Math.round(rmssd * 10) / 10,
      pnn50: Math.round(pnn50 * 10) / 10,
      meanRR: Math.round(meanRR),
      meanHR: Math.round(meanHR * 10) / 10,
      sd1: Math.round(sd1 * 10) / 10,
      sd2: Math.round(sd2 * 10) / 10,
      sd1sd2Ratio: Math.round(sd1sd2Ratio * 100) / 100,
      totalIntervals: valid.length,
      isValid: true
    };
  }

  /**
   * Genera puntos para el gráfico Poincaré: RR(n) vs RR(n+1)
   */
  static getPoincarePoints(rrIntervals: number[]): PoincarePoint[] {
    const valid = rrIntervals.filter(rr => rr >= MIN_RR_MS && rr <= MAX_RR_MS);
    const points: PoincarePoint[] = [];
    for (let i = 0; i < valid.length - 1; i++) {
      points.push({ rrN: valid[i], rrN1: valid[i + 1] });
    }
    return points;
  }
}
