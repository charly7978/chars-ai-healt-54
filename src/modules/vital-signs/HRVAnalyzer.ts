/**
 * HRV Analyzer - Análisis de Variabilidad de Frecuencia Cardíaca
 * 
 * Dominio tiempo: SDNN, RMSSD, pNN50, SD1/SD2, Mean RR/HR
 * Dominio frecuencia: VLF, LF, HF, LF/HF (Lomb-Scargle periodogram)
 * 
 * Basado en Task Force of ESC/NASPE 1996, Shaffer & Ginsberg 2017
 */

export interface FrequencyDomainMetrics {
  vlfPower: number;   // ms² - Very Low Frequency (0.003-0.04 Hz)
  lfPower: number;    // ms² - Low Frequency (0.04-0.15 Hz)
  hfPower: number;    // ms² - High Frequency (0.15-0.40 Hz)
  lfHfRatio: number;  // ratio LF/HF
  lfNorm: number;     // % - LF normalizado = LF/(LF+HF)*100
  hfNorm: number;     // % - HF normalizado = HF/(LF+HF)*100
  totalPower: number; // ms²
  isValid: boolean;
}

export interface HRVMetrics {
  sdnn: number;
  rmssd: number;
  pnn50: number;
  meanRR: number;
  meanHR: number;
  sd1: number;
  sd2: number;
  sd1sd2Ratio: number;
  totalIntervals: number;
  isValid: boolean;
  frequency: FrequencyDomainMetrics;
}

export interface PoincarePoint {
  rrN: number;
  rrN1: number;
}

const MIN_INTERVALS_FOR_HRV = 6;
const MIN_INTERVALS_FOR_FREQ = 16;
const MIN_RR_MS = 300;
const MAX_RR_MS = 2000;

const INVALID_FREQ: FrequencyDomainMetrics = {
  vlfPower: 0, lfPower: 0, hfPower: 0, lfHfRatio: 0,
  lfNorm: 0, hfNorm: 0, totalPower: 0, isValid: false
};

export class HRVAnalyzer {
  static compute(rrIntervals: number[]): HRVMetrics {
    const invalid: HRVMetrics = {
      sdnn: 0, rmssd: 0, pnn50: 0,
      meanRR: 0, meanHR: 0,
      sd1: 0, sd2: 0, sd1sd2Ratio: 0,
      totalIntervals: rrIntervals.length,
      isValid: false,
      frequency: { ...INVALID_FREQ }
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

    // Frequency domain
    const frequency = valid.length >= MIN_INTERVALS_FOR_FREQ
      ? this.computeFrequencyDomain(valid)
      : { ...INVALID_FREQ };

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
      isValid: true,
      frequency
    };
  }

  /**
   * Lomb-Scargle periodogram para intervalos RR no uniformemente muestreados
   * Bandas: VLF (0.003-0.04), LF (0.04-0.15), HF (0.15-0.40) Hz
   */
  private static computeFrequencyDomain(rrMs: number[]): FrequencyDomainMetrics {
    // Construir serie temporal: timestamps acumulados (s) y valores centrados (ms)
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < rrMs.length; i++) {
      times.push(t / 1000); // convertir a segundos
      t += rrMs[i];
    }

    const meanRR = rrMs.reduce((a, b) => a + b, 0) / rrMs.length;
    const centered = rrMs.map(rr => rr - meanRR);
    const N = centered.length;
    const totalDuration = times[times.length - 1];

    // Resolución frecuencial: sobremuestreo x4 respecto a Nyquist
    const ofac = 4;
    const df = 1 / (totalDuration * ofac);
    const fMin = 0.003;
    const fMax = 0.42;

    // Evaluar Lomb-Scargle en frecuencias discretas
    const freqs: number[] = [];
    const power: number[] = [];

    for (let f = fMin; f <= fMax; f += df) {
      freqs.push(f);
      const omega = 2 * Math.PI * f;

      // Calcular tau (fase de referencia)
      let sin2sum = 0, cos2sum = 0;
      for (let i = 0; i < N; i++) {
        sin2sum += Math.sin(2 * omega * times[i]);
        cos2sum += Math.cos(2 * omega * times[i]);
      }
      const tau = Math.atan2(sin2sum, cos2sum) / (2 * omega);

      // Calcular potencia normalizada
      let cosSum = 0, sinSum = 0, cos2 = 0, sin2 = 0;
      for (let i = 0; i < N; i++) {
        const phase = omega * (times[i] - tau);
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        cosSum += centered[i] * c;
        sinSum += centered[i] * s;
        cos2 += c * c;
        sin2 += s * s;
      }

      const p = cos2 > 0 && sin2 > 0
        ? 0.5 * ((cosSum * cosSum) / cos2 + (sinSum * sinSum) / sin2)
        : 0;
      power.push(p);
    }

    // Integrar potencia por bandas (trapezoidal)
    const integrate = (fLow: number, fHigh: number): number => {
      let sum = 0;
      for (let i = 1; i < freqs.length; i++) {
        if (freqs[i - 1] >= fLow && freqs[i] <= fHigh) {
          sum += (power[i - 1] + power[i]) * 0.5 * (freqs[i] - freqs[i - 1]);
        }
      }
      return sum;
    };

    const vlfPower = integrate(0.003, 0.04);
    const lfPower = integrate(0.04, 0.15);
    const hfPower = integrate(0.15, 0.40);
    const totalPower = vlfPower + lfPower + hfPower;
    const lfHf = lfPower + hfPower;
    const lfHfRatio = hfPower > 0 ? lfPower / hfPower : 0;
    const lfNorm = lfHf > 0 ? (lfPower / lfHf) * 100 : 0;
    const hfNorm = lfHf > 0 ? (hfPower / lfHf) * 100 : 0;

    return {
      vlfPower: Math.round(vlfPower * 10) / 10,
      lfPower: Math.round(lfPower * 10) / 10,
      hfPower: Math.round(hfPower * 10) / 10,
      lfHfRatio: Math.round(lfHfRatio * 100) / 100,
      lfNorm: Math.round(lfNorm * 10) / 10,
      hfNorm: Math.round(hfNorm * 10) / 10,
      totalPower: Math.round(totalPower * 10) / 10,
      isValid: totalPower > 0 && lfPower + hfPower > 0
    };
  }

  static getPoincarePoints(rrIntervals: number[]): PoincarePoint[] {
    const valid = rrIntervals.filter(rr => rr >= MIN_RR_MS && rr <= MAX_RR_MS);
    const points: PoincarePoint[] = [];
    for (let i = 0; i < valid.length - 1; i++) {
      points.push({ rrN: valid[i], rrN1: valid[i + 1] });
    }
    return points;
  }
}
