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
  // Dominio frecuencia
  lfPower: number;    // ms² - potencia baja frecuencia (0.04-0.15 Hz) simpático+parasimpático
  hfPower: number;    // ms² - potencia alta frecuencia (0.15-0.40 Hz) parasimpático
  lfHfRatio: number;  // ratio LF/HF - balance autonómico
  vlfPower: number;   // ms² - muy baja frecuencia (0.003-0.04 Hz)
  totalPower: number; // ms² - potencia total
  lfNorm: number;     // % - LF normalizado = LF/(LF+HF)*100
  hfNorm: number;     // % - HF normalizado = HF/(LF+HF)*100
  freqDomainValid: boolean;
  totalIntervals: number;
  isValid: boolean;
}

export interface PoincarePoint {
  rrN: number;    // RR(n)
  rrN1: number;   // RR(n+1)
}

const MIN_INTERVALS_FOR_HRV = 6;
const MIN_RR_MS = 300;   // ~200 BPM
const MAX_RR_MS = 2000;  // ~30 BPM

export class HRVAnalyzer {
  private static readonly FREQ_INVALID = {
    lfPower: 0, hfPower: 0, lfHfRatio: 0, vlfPower: 0,
    totalPower: 0, lfNorm: 0, hfNorm: 0, freqDomainValid: false
  };

  /**
   * Calcula todas las métricas HRV a partir de intervalos RR (ms)
   */
  static compute(rrIntervals: number[]): HRVMetrics {
    const invalid: HRVMetrics = {
      sdnn: 0, rmssd: 0, pnn50: 0,
      meanRR: 0, meanHR: 0,
      sd1: 0, sd2: 0, sd1sd2Ratio: 0,
      ...this.FREQ_INVALID,
      totalIntervals: rrIntervals.length,
      isValid: false
    };

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

    // Dominio frecuencia
    const freqMetrics = this.computeFrequencyDomain(valid);

    return {
      sdnn: Math.round(sdnn * 10) / 10,
      rmssd: Math.round(rmssd * 10) / 10,
      pnn50: Math.round(pnn50 * 10) / 10,
      meanRR: Math.round(meanRR),
      meanHR: Math.round(meanHR * 10) / 10,
      sd1: Math.round(sd1 * 10) / 10,
      sd2: Math.round(sd2 * 10) / 10,
      sd1sd2Ratio: Math.round(sd1sd2Ratio * 100) / 100,
      ...freqMetrics,
      totalIntervals: valid.length,
      isValid: true
    };
  }

  /**
   * Análisis en dominio frecuencia usando Lomb-Scargle periodogram
   * (apropiado para series RR no uniformemente muestreadas)
   * 
   * Bandas estándar (Task Force ESC/NASPE 1996):
   * - VLF: 0.003 - 0.04 Hz
   * - LF:  0.04  - 0.15 Hz (simpático + parasimpático)
   * - HF:  0.15  - 0.40 Hz (parasimpático / respiratorio)
   */
  private static computeFrequencyDomain(rrIntervals: number[]): {
    lfPower: number; hfPower: number; lfHfRatio: number;
    vlfPower: number; totalPower: number;
    lfNorm: number; hfNorm: number; freqDomainValid: boolean;
  } {
    // Necesitamos al menos ~10 intervalos para análisis frecuencial mínimamente útil
    if (rrIntervals.length < 10) return this.FREQ_INVALID;

    // Construir serie temporal acumulada (timestamps en segundos)
    const times: number[] = [0];
    for (let i = 0; i < rrIntervals.length; i++) {
      times.push(times[i] + rrIntervals[i] / 1000);
    }
    // Valores = detrended RR en ms
    const meanRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const values = rrIntervals.map(rr => rr - meanRR);
    // Timestamps centrados en cada intervalo
    const tMid = rrIntervals.map((_, i) => (times[i] + times[i + 1]) / 2);

    // Frecuencias a evaluar (0.003 a 0.40 Hz, step ~0.005 Hz)
    const freqStep = 0.005;
    const freqs: number[] = [];
    for (let f = 0.003; f <= 0.40; f += freqStep) {
      freqs.push(f);
    }

    // Lomb-Scargle periodogram
    const N = values.length;
    const psd: number[] = [];

    for (const freq of freqs) {
      const omega = 2 * Math.PI * freq;

      // Calcular tau (phase offset)
      let sin2sum = 0, cos2sum = 0;
      for (let i = 0; i < N; i++) {
        sin2sum += Math.sin(2 * omega * tMid[i]);
        cos2sum += Math.cos(2 * omega * tMid[i]);
      }
      const tau = Math.atan2(sin2sum, cos2sum) / (2 * omega);

      let cosSum = 0, sinSum = 0, cos2 = 0, sin2 = 0;
      for (let i = 0; i < N; i++) {
        const phase = omega * (tMid[i] - tau);
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        cosSum += values[i] * c;
        sinSum += values[i] * s;
        cos2 += c * c;
        sin2 += s * s;
      }

      const power = cos2 > 0 && sin2 > 0
        ? 0.5 * ((cosSum * cosSum) / cos2 + (sinSum * sinSum) / sin2)
        : 0;
      psd.push(power);
    }

    // Integrar potencia por bandas
    let vlfPower = 0, lfPower = 0, hfPower = 0;
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      const p = psd[i] * freqStep; // potencia * df para integral
      if (f >= 0.003 && f < 0.04) vlfPower += p;
      else if (f >= 0.04 && f < 0.15) lfPower += p;
      else if (f >= 0.15 && f <= 0.40) hfPower += p;
    }

    const totalPower = vlfPower + lfPower + hfPower;
    const lfHfSum = lfPower + hfPower;
    const lfHfRatio = hfPower > 0 ? lfPower / hfPower : 0;
    const lfNorm = lfHfSum > 0 ? (lfPower / lfHfSum) * 100 : 0;
    const hfNorm = lfHfSum > 0 ? (hfPower / lfHfSum) * 100 : 0;

    return {
      lfPower: Math.round(lfPower * 10) / 10,
      hfPower: Math.round(hfPower * 10) / 10,
      lfHfRatio: Math.round(lfHfRatio * 100) / 100,
      vlfPower: Math.round(vlfPower * 10) / 10,
      totalPower: Math.round(totalPower * 10) / 10,
      lfNorm: Math.round(lfNorm * 10) / 10,
      hfNorm: Math.round(hfNorm * 10) / 10,
      freqDomainValid: totalPower > 0
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
