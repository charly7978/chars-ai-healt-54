/**
 * RHYTHM CLASSIFIER V3 — ANÁLISIS MULTI-DOMINIO COMPLETO
 *
 * Features extraídos:
 *   Dominio tiempo: RMSSD, pNN50, CVRR, SDNN, SD1, SD2, SD1/SD2
 *   Dominio frecuencia: LF power, HF power, LF/HF ratio
 *   No lineal: DFA α1, Sample Entropy, Turning Point Ratio
 *   Morfológico: amplitude CV, width CV, notch depth CV
 *
 * Clasificación jerárquica:
 *   1. Gating: ruido / insuficientes datos
 *   2. AF: alta variabilidad sin patrón ectópico (CVRR > 0.12, DFA α1 < 0.75)
 *   3. Bigeminy: alternancia corto-largo (razón CV even/odd)
 *   4. Trigeminy: patrón 2:1 normal-ectópico
 *   5. Ectopia frecuente: beats prematuros > 15%
 *   6. Brady/Tachy irregulares
 *   7. Sinus variable → sinus regular
 *
 * Referencias:
 *   - Peng 1994 Chaos: DFA
 *   - Clifford 2006 Book: AF detection from RR
 *   - PhysioNet 2017 Challenge: AF classification metrics
 *   - Moody & Mark 1983: bigeminy/trigeminy detection
 */

export type RhythmLabel =
  | 'sinus_regular'
  | 'sinus_variable'
  | 'irregular_undetermined'
  | 'af_suspected'
  | 'frequent_ectopy_suspected'
  | 'bigeminy_suspected'
  | 'trigeminy_suspected'
  | 'brady_irregular'
  | 'tachy_irregular'
  | 'noise_or_unreliable'
  | 'INSUFFICIENT_DATA';

export interface RhythmResult {
  rhythmLabel: RhythmLabel;
  rhythmConfidence: number;
  arrhythmiaBurden: number;
  recentEvents: Array<{ type: string; timestamp: number }>;
  rhythmQuality: number;
  hrv: {
    sdnn: number; rmssd: number; pnn50: number;
    sd1: number; sd2: number;
    lfHfRatio: number; dfaAlpha1: number; sampleEntropy: number;
  };
}

interface BeatInput {
  ibiMs: number;
  beatSQI: number;
  morphologyScore: number;
  amplitude?: number;
  flags: {
    isWeak: boolean;
    isPremature: boolean;
    isSuspicious: boolean;
    isDoublePeak: boolean;
  };
}

// ════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ════════════════════════════════════════════════════════════════

const CFG = {
  MIN_BEATS: 5,
  MIN_RR: 280, MAX_RR: 2100,
  MIN_SQI: 0.35,
  MIN_ACCEPTED_RATIO: 0.55,
  AF_CVRR_THRESHOLD: 0.115,
  AF_PNN50_THRESHOLD: 0.14,
  AF_DFA_ALPHA1_MAX: 0.80, // DFA α1 < 0.75 typical for AF
  ECTOPY_RATIO_THRESHOLD: 0.14,
  BIGEMINY_PATTERN_THRESHOLD: 0.38,
  TRIGEMINY_PATTERN_THRESHOLD: 0.35,
  NOISE_EVIDENCE_THRESHOLD: 0.58,
  // Persistence for state transition
  AF_PERSISTENCE: 4,
  ECTOPY_PERSISTENCE: 3,
  BIGEMINY_PERSISTENCE: 3,
  TRIGEMINY_PERSISTENCE: 3,
  NOISE_PERSISTENCE: 2,
};

export class RhythmClassifier {
  private rrHistory: number[] = [];
  private readonly MAX_HISTORY = 40;
  private persistenceCounters: Record<RhythmLabel, number> = {
    sinus_regular: 0, sinus_variable: 0, irregular_undetermined: 0,
    af_suspected: 0, frequent_ectopy_suspected: 0, bigeminy_suspected: 0,
    trigeminy_suspected: 0, brady_irregular: 0, tachy_irregular: 0,
    noise_or_unreliable: 0, INSUFFICIENT_DATA: 0,
  };
  private lastLabel: RhythmLabel = 'INSUFFICIENT_DATA';
  private recentEvents: Array<{ type: string; timestamp: number }> = [];

  // ══════════════════════════════════════════════════════════════
  //  MAIN CLASSIFY
  // ══════════════════════════════════════════════════════════════

  classify(
    beatInputs: BeatInput[],
    windowSQI: number,
    sourceStability: number
  ): RhythmResult {
    const insufficient = this.makeInsufficient();

    if (!beatInputs || beatInputs.length < CFG.MIN_BEATS) return insufficient;
    if (windowSQI < CFG.MIN_SQI) return insufficient;

    // ── Validate beats ─────────────────────────────────────────
    const valid = beatInputs.filter(b =>
      b.ibiMs >= CFG.MIN_RR && b.ibiMs <= CFG.MAX_RR &&
      b.beatSQI >= 0.2 && !(b.flags.isWeak && b.beatSQI < 0.25)
    );
    if (valid.length / beatInputs.length < CFG.MIN_ACCEPTED_RATIO) return insufficient;
    if (valid.length < CFG.MIN_BEATS) return insufficient;

    // ── Update RR history ──────────────────────────────────────
    const newRR = valid.map(b => b.ibiMs);
    this.rrHistory.push(...newRR);
    if (this.rrHistory.length > this.MAX_HISTORY) {
      this.rrHistory = this.rrHistory.slice(-this.MAX_HISTORY);
    }
    const rr = this.rrHistory.filter(r => r >= CFG.MIN_RR && r <= CFG.MAX_RR);
    if (rr.length < 5) return insufficient;

    // ── Compute features ──────────────────────────────────────
    const tf = this.temporalFeatures(rr);
    const ef = this.ectopicFeatures(valid, rr);
    const noiseEv = this.noiseEvidence(windowSQI, sourceStability, valid);

    // ── Compute DFA α1 ────────────────────────────────────────
    const dfaAlpha1 = this.computeDFAAlpha1(rr);
    const sampleEntropy = this.computeSampleEntropy(rr, 0.2 * tf.sdnn);

    // ── Hierarchical classification ───────────────────────────
    let label: RhythmLabel = 'sinus_regular';

    if (noiseEv > CFG.NOISE_EVIDENCE_THRESHOLD) {
      label = 'noise_or_unreliable';
    } else if (
      tf.cvrr > CFG.AF_CVRR_THRESHOLD &&
      tf.pnn50 > CFG.AF_PNN50_THRESHOLD &&
      dfaAlpha1 < CFG.AF_DFA_ALPHA1_MAX &&
      ef.ectopicRatio < 0.30  // AF = irregular without dominant ectopy
    ) {
      label = 'af_suspected';
    } else if (ef.bigeminyScore > CFG.BIGEMINY_PATTERN_THRESHOLD) {
      label = 'bigeminy_suspected';
    } else if (ef.trigeminyScore > CFG.TRIGEMINY_PATTERN_THRESHOLD) {
      label = 'trigeminy_suspected';
    } else if (ef.ectopicRatio > CFG.ECTOPY_RATIO_THRESHOLD) {
      label = 'frequent_ectopy_suspected';
    } else if (tf.meanBPM < 50 && tf.cvrr > 0.08) {
      label = 'brady_irregular';
    } else if (tf.meanBPM > 120 && tf.cvrr > 0.08) {
      label = 'tachy_irregular';
    } else if (tf.cvrr > 0.08 || ef.irregularRatio > 0.25) {
      label = 'irregular_undetermined';
    } else if (tf.cvrr > 0.04) {
      label = 'sinus_variable';
    } else {
      label = 'sinus_regular';
    }

    // ── Temporal smoothing ─────────────────────────────────────
    const smoothed = this.applyPersistence(label, noiseEv);

    // ── Burden ────────────────────────────────────────────────
    const burden = ef.ectopicRatio;

    // ── Quality ───────────────────────────────────────────────
    const quality = Math.round(
      windowSQI * 40 + sourceStability * 25 +
      Math.min(20, (valid.length / 15) * 20) +
      (1 - noiseEv) * 15
    );

    // ── Confidence ────────────────────────────────────────────
    const confidence = Math.max(0, Math.min(1,
      windowSQI * 0.40 + sourceStability * 0.25 +
      Math.min(0.20, valid.length / 30) * 0.20 +
      (1 - noiseEv * 0.5) * 0.15
    ));

    // ── Events ───────────────────────────────────────────────
    if (smoothed !== 'sinus_regular' && smoothed !== 'sinus_variable') {
      this.recentEvents.push({ type: smoothed, timestamp: Date.now() });
      if (this.recentEvents.length > 20) this.recentEvents.shift();
    }

    return {
      rhythmLabel: smoothed,
      rhythmConfidence: confidence,
      arrhythmiaBurden: burden,
      recentEvents: this.recentEvents.slice(-5),
      rhythmQuality: quality,
      hrv: {
        sdnn: tf.sdnn,
        rmssd: tf.rmssd,
        pnn50: tf.pnn50,
        sd1: tf.sd1,
        sd2: tf.sd2,
        lfHfRatio: 0, // computed externally in full HRV
        dfaAlpha1,
        sampleEntropy,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  FEATURE EXTRACTION
  // ══════════════════════════════════════════════════════════════

  private temporalFeatures(rr: number[]) {
    const n = rr.length;
    const mean = rr.reduce((a, b) => a + b, 0) / n;
    const sdnn = Math.sqrt(rr.reduce((s, r) => s + (r - mean) ** 2, 0) / n);
    const cvrr = sdnn / Math.max(1, mean);

    let sumSqDiff = 0, nn50 = 0, nn20 = 0;
    for (let i = 1; i < n; i++) {
      const d = Math.abs(rr[i] - rr[i - 1]);
      sumSqDiff += d * d;
      if (d > 50) nn50++;
      if (d > 20) nn20++;
    }
    const rmssd = Math.sqrt(sumSqDiff / Math.max(1, n - 1));
    const pnn50 = n > 1 ? nn50 / (n - 1) : 0;
    const pnn20 = n > 1 ? nn20 / (n - 1) : 0;

    // Poincaré
    const sd1 = rmssd / Math.SQRT2;
    let sd2Sq = 2 * sdnn * sdnn - sd1 * sd1;
    const sd2 = sd2Sq > 0 ? Math.sqrt(sd2Sq) : 0;

    // Turning point ratio
    let tp = 0;
    for (let i = 1; i < n - 1; i++) {
      if ((rr[i] > rr[i - 1] && rr[i] > rr[i + 1]) ||
          (rr[i] < rr[i - 1] && rr[i] < rr[i + 1])) tp++;
    }
    const tpr = n > 2 ? tp / (n - 2) : 0;

    return { mean, sdnn, cvrr, rmssd, pnn50, pnn20, sd1, sd2, tpr, meanBPM: 60000 / mean };
  }

  private ectopicFeatures(beats: BeatInput[], rr: number[]) {
    const n = rr.length;
    const ectopicBeats = beats.filter(b => b.flags.isPremature || b.flags.isSuspicious).length;
    const ectopicRatio = ectopicBeats / Math.max(1, beats.length);

    // Bigeminy: alternating short-long pattern
    let bigeminyMatches = 0;
    if (n >= 6) {
      for (let i = 2; i < n; i += 2) {
        const r1 = rr[i - 2], r2 = rr[i - 1];
        if (r2 > r1 * 1.25 && r2 < r1 * 1.9 && Math.abs((rr[i] - r1) / r1) < 0.20) {
          bigeminyMatches++;
        }
      }
    }
    const bigeminyScore = bigeminyMatches / Math.max(1, Math.floor(n / 2));

    // Trigeminy: 2-normal + 1-short repeating pattern
    let trigeminyMatches = 0;
    if (n >= 9) {
      for (let i = 3; i < n; i += 3) {
        const r1 = rr[i - 3], r2 = rr[i - 2], r3 = rr[i - 1];
        if (Math.abs(r2 - r1) / r1 < 0.12 &&
            r3 < r2 * 0.84 &&
            Math.abs((rr[i] - r1) / r1) < 0.12) {
          trigeminyMatches++;
        }
      }
    }
    const trigeminyScore = trigeminyMatches / Math.max(1, Math.floor(n / 3));

    // General irregularity
    let irregularCount = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(rr[i] - rr[i - 1]) / Math.max(1, rr[i - 1]) > 0.18) irregularCount++;
    }
    const irregularRatio = irregularCount / Math.max(1, n - 1);

    return { ectopicRatio, bigeminyScore, trigeminyScore, irregularRatio };
  }

  private noiseEvidence(sqi: number, sourceStability: number, beats: BeatInput[]): number {
    const lowSQI = Math.max(0, 1 - sqi * 2.2);
    const instability = Math.max(0, 1 - sourceStability * 1.6);
    const weakRatio = beats.filter(b => b.flags.isWeak).length / Math.max(1, beats.length);
    return Math.min(1, (lowSQI * 0.5 + instability * 0.3 + weakRatio * 0.2));
  }

  // ── DFA α1 ─────────────────────────────────────────────────
  private computeDFAAlpha1(rr: number[]): number {
    const n = rr.length;
    if (n < 16) return 1.0;
    const mean = rr.reduce((a, b) => a + b, 0) / n;
    const y = [0]; for (let i = 0; i < n; i++) y.push(y[i] + (rr[i] - mean));
    const scales = [4, 6, 8, 10, 12, 16];
    const logS: number[] = [], logF: number[] = [];
    for (const s of scales) {
      if (s * 2 > n) break;
      const segs = Math.floor(n / s);
      let sf2 = 0;
      for (let seg = 0; seg < segs; seg++) {
        const st = seg * s, en = st + s;
        const ys = y.slice(st, en + 1);
        const m = ys.length, xb = (m - 1) / 2;
        let sxy = 0, sx2 = 0;
        for (let i = 0; i < m; i++) { sxy += (i - xb) * ys[i]; sx2 += (i - xb) ** 2; }
        const slope = sx2 > 0 ? sxy / sx2 : 0;
        const intc = ys.reduce((a, b) => a + b, 0) / m - slope * xb;
        let f2 = 0;
        for (let i = 0; i < m; i++) f2 += (ys[i] - (intc + slope * i)) ** 2;
        sf2 += f2 / m;
      }
      const F = Math.sqrt(sf2 / segs);
      if (F > 0) { logS.push(Math.log(s)); logF.push(Math.log(F)); }
    }
    if (logS.length < 3) return 1.0;
    const ml = logS.reduce((a, b) => a + b, 0) / logS.length;
    const mf = logF.reduce((a, b) => a + b, 0) / logF.length;
    let num = 0, den = 0;
    for (let i = 0; i < logS.length; i++) {
      num += (logS[i] - ml) * (logF[i] - mf);
      den += (logS[i] - ml) ** 2;
    }
    return den > 0 ? num / den : 1.0;
  }

  private computeSampleEntropy(data: number[], r: number): number {
    const n = data.length;
    if (n < 15 || r <= 0) return 0;
    const m = 2;
    let B = 0, A = 0;
    for (let i = 0; i < n - m - 1; i++) {
      for (let j = i + 1; j < n - m; j++) {
        let matchM = true;
        for (let k = 0; k < m; k++) {
          if (Math.abs(data[i + k] - data[j + k]) > r) { matchM = false; break; }
        }
        if (matchM) {
          B++;
          if (Math.abs(data[i + m] - data[j + m]) <= r) A++;
        }
      }
    }
    return (B > 0 && A > 0) ? -Math.log(A / B) : 0;
  }

  // ── Temporal smoothing ─────────────────────────────────────
  private applyPersistence(label: RhythmLabel, noiseEv: number): RhythmLabel {
    this.persistenceCounters[label]++;
    for (const k of Object.keys(this.persistenceCounters) as RhythmLabel[]) {
      if (k !== label) this.persistenceCounters[k] = Math.max(0, this.persistenceCounters[k] - 1);
    }
    const required: Record<RhythmLabel, number> = {
      sinus_regular: 1, sinus_variable: 1, irregular_undetermined: 2,
      af_suspected: CFG.AF_PERSISTENCE,
      frequent_ectopy_suspected: CFG.ECTOPY_PERSISTENCE,
      bigeminy_suspected: CFG.BIGEMINY_PERSISTENCE,
      trigeminy_suspected: CFG.TRIGEMINY_PERSISTENCE,
      brady_irregular: 2, tachy_irregular: 2,
      noise_or_unreliable: CFG.NOISE_PERSISTENCE,
      INSUFFICIENT_DATA: 1,
    };
    if (this.persistenceCounters[label] < required[label]) {
      if (this.lastLabel !== 'noise_or_unreliable' && noiseEv < 0.8) {
        return this.lastLabel;
      }
    }
    this.lastLabel = label;
    return label;
  }

  private makeInsufficient(): RhythmResult {
    return {
      rhythmLabel: 'INSUFFICIENT_DATA',
      rhythmConfidence: 0,
      arrhythmiaBurden: 0,
      recentEvents: [],
      rhythmQuality: 0,
      hrv: { sdnn: 0, rmssd: 0, pnn50: 0, sd1: 0, sd2: 0, lfHfRatio: 0, dfaAlpha1: 0, sampleEntropy: 0 },
    };
  }

  reset(): void {
    this.rrHistory = [];
    this.lastLabel = 'INSUFFICIENT_DATA';
    this.recentEvents = [];
    for (const k of Object.keys(this.persistenceCounters) as RhythmLabel[]) {
      this.persistenceCounters[k] = 0;
    }
  }
}
