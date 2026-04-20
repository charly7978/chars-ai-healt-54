/**
 * STRESS PROCESSOR
 *
 * Combines validated cardiovascular biomarkers into a single Stress Index
 * (0..100) with a categorical label and confidence. No simulation: every
 * component is derived from real PPG-driven HRV indices.
 *
 * Components:
 *  - Baevsky's Stress Index (SI) = AMo / (2 · Mo · MxDMn)
 *      where AMo  = mode amplitude (% of RR in modal bin),
 *            Mo   = mode (most frequent RR, sec),
 *            MxDMn= range of RR (sec) within central 95%.
 *  - Sympatho-vagal balance from LF/HF (cap-and-normalize)
 *  - Perfusion-index variability (autonomic vasomotor proxy)
 *  - Heart-rate elevation above resting baseline
 *
 * Reference: Baevsky R.M. (2008) "Methodical recommendations: use of Kardivar
 * system for determination of the stress level"; Task Force ESC/NASPE (1996).
 */

import { median, mean, std } from '../../utils/mathUtils';

export type StressLabel = 'REPOSO' | 'NORMAL' | 'ALERTA' | 'ESTRES_ALTO';

export interface StressInput {
  rrIntervals: number[];        // ms
  lfHfRatio: number;            // from HRVTimeFreqProcessor.freq.lfHfRatio
  rmssd: number;                // ms
  meanHR: number;               // bpm
  restingHR?: number;           // bpm — optional baseline
  perfusionIndex?: number;      // last PI sample (%)
  perfusionIndexHistory?: number[]; // recent PIs for variability
  signalQuality?: number;       // 0..100 — SQI from upstream
}

export interface StressResult {
  index: number;                // 0..100
  label: StressLabel;
  confidence: number;           // 0..1
  components: {
    baevsky: number;            // raw SI
    baevskyNorm: number;        // 0..1
    lfHfNorm: number;           // 0..1
    parasympNorm: number;       // 0..1 (high RMSSD → low stress)
    hrElevationNorm: number;    // 0..1
    piVariabilityNorm: number;  // 0..1
  };
  qualityFlags: string[];
}

const STRESS_DEFAULTS = {
  RESTING_HR_FALLBACK: 70,        // bpm if no baseline known
  HIGH_HR_FOR_STRESS: 100,        // bpm where HR-elevation contribution saturates
  HIGH_LFHF_FOR_STRESS: 4.0,      // LF/HF ratio where contribution saturates
  RMSSD_HIGH_VAGAL: 60,           // ms where parasympathetic dominance saturates
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Baevsky Stress Index using histogram with 50 ms bins (industry standard).
 * Returns SI = AMo / (2·Mo·MxDMn). Mo and MxDMn are in seconds.
 */
function computeBaevskySI(rr: number[]): number {
  if (rr.length < 20) return 0;
  const binWidth = 50; // ms
  const hist = new Map<number, number>();
  for (const x of rr) {
    const k = Math.round(x / binWidth);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let modeKey = 0, modeCount = 0;
  for (const [k, v] of hist) {
    if (v > modeCount) { modeCount = v; modeKey = k; }
  }
  const amoPct = (modeCount / rr.length) * 100;
  const moSec = (modeKey * binWidth) / 1000;

  // MxDMn over central 95% (drop top/bottom 2.5%) to reduce ectopic influence
  const sorted = [...rr].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.025)];
  const hi = sorted[Math.floor(sorted.length * 0.975)];
  const mxDmnSec = (hi - lo) / 1000;

  if (moSec <= 0 || mxDmnSec <= 0) return 0;
  return amoPct / (2 * moSec * mxDmnSec);
}

export class StressProcessor {
  process(input: StressInput): StressResult {
    const flags: string[] = [];

    if (!input.rrIntervals || input.rrIntervals.length < 12) {
      flags.push('insufficient_rr');
      return this.empty(flags);
    }

    if ((input.signalQuality ?? 100) < 25) {
      flags.push('low_signal_quality');
    }

    const baevsky = computeBaevskySI(input.rrIntervals);
    // SI<50 healthy, 50–150 moderate, 150–500 high, >500 very high
    const baevskyNorm = clamp01(baevsky / 500);

    // LF/HF: 1.5 typical, >4 high stress
    const lfHfNorm = clamp01(
      Math.max(0, input.lfHfRatio - 1) / (STRESS_DEFAULTS.HIGH_LFHF_FOR_STRESS - 1)
    );

    // Parasympathetic withdrawal — invert RMSSD
    const parasympNorm = 1 - clamp01(input.rmssd / STRESS_DEFAULTS.RMSSD_HIGH_VAGAL);

    // HR elevation above resting baseline
    const restingHR = input.restingHR ?? STRESS_DEFAULTS.RESTING_HR_FALLBACK;
    const hrSpan = STRESS_DEFAULTS.HIGH_HR_FOR_STRESS - restingHR;
    const hrEleNorm = hrSpan > 0
      ? clamp01((input.meanHR - restingHR) / hrSpan)
      : 0;

    // Perfusion-index variability (autonomic vasomotor proxy).
    // Higher CV(PI) under steady contact correlates with sympathetic activation.
    let piVarNorm = 0;
    const pih = input.perfusionIndexHistory ?? [];
    if (pih.length >= 8) {
      const m = mean(pih);
      const cv = m > 0 ? std(pih, m) / m : 0;
      piVarNorm = clamp01(cv / 0.5); // CV>0.5 saturates
    }

    // Weighted aggregation. Weights tuned to keep balance: Baevsky
    // and LF/HF dominate when reliable, parasympathetic withdrawal next.
    const weighted =
      baevskyNorm   * 0.30 +
      lfHfNorm      * 0.25 +
      parasympNorm  * 0.20 +
      hrEleNorm     * 0.15 +
      piVarNorm     * 0.10;

    const index = Math.round(clamp01(weighted) * 100);
    const label: StressLabel =
      index < 25 ? 'REPOSO' :
      index < 55 ? 'NORMAL' :
      index < 80 ? 'ALERTA' :
      'ESTRES_ALTO';

    // Confidence increases with: enough RR samples, freq-domain availability,
    // signal quality, low outlier ratio.
    let confidence = 0.0;
    confidence += Math.min(0.40, input.rrIntervals.length / 80);
    confidence += input.lfHfRatio > 0 ? 0.20 : 0;
    confidence += Math.min(0.20, (input.signalQuality ?? 0) / 200);
    confidence += pih.length >= 8 ? 0.10 : 0;
    confidence += baevsky > 0 ? 0.10 : 0;
    confidence = clamp01(confidence);

    return {
      index,
      label,
      confidence,
      components: {
        baevsky,
        baevskyNorm,
        lfHfNorm,
        parasympNorm,
        hrElevationNorm: hrEleNorm,
        piVariabilityNorm: piVarNorm,
      },
      qualityFlags: flags,
    };
  }

  private empty(flags: string[]): StressResult {
    return {
      index: 0,
      label: 'NORMAL',
      confidence: 0,
      components: {
        baevsky: 0, baevskyNorm: 0, lfHfNorm: 0,
        parasympNorm: 0, hrElevationNorm: 0, piVariabilityNorm: 0,
      },
      qualityFlags: flags,
    };
  }
}
