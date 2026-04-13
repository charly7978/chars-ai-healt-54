/**
 * RHYTHM CLASSIFIER V1
 * 
 * Replaces simple arrhythmia boolean with multi-label rhythm classification.
 * Uses RR intervals, morphology instability, HRV metrics, and beat quality.
 * 
 * Labels:
 * - SINUS_STABLE / SINUS_VARIABLE
 * - BRADYCARDIA_PATTERN / TACHYCARDIA_PATTERN
 * - IRREGULAR_RHYTHM / POSSIBLE_AF
 * - POSSIBLE_ECTOPY / BIGEMINY_TRIGEMINY_PATTERN
 * - UNDETERMINED_LOW_QUALITY
 * 
 * References:
 * - Chong et al. 2015: AF detection from smartphone PPG
 * - Pereira et al. 2020: RMSSD + Shannon entropy for AF screening
 * - Bashar et al. 2019: Smartphone PPG arrhythmia detection
 */

export type RhythmLabel =
  | 'SINUS_STABLE'
  | 'SINUS_VARIABLE'
  | 'BRADYCARDIA_PATTERN'
  | 'TACHYCARDIA_PATTERN'
  | 'IRREGULAR_RHYTHM'
  | 'POSSIBLE_AF'
  | 'POSSIBLE_ECTOPY'
  | 'BIGEMINY_TRIGEMINY_PATTERN'
  | 'UNDETERMINED_LOW_QUALITY'
  | 'INSUFFICIENT_DATA';

export interface RhythmEvent {
  timestamp: number;
  label: RhythmLabel;
  severity: 'info' | 'warning' | 'alert';
  metrics: {
    rmssd: number;
    sdnn: number;
    shannonEntropy: number;
    pnn50: number;
    rrCV: number;
  };
}

export interface RhythmResult {
  rhythmLabel: RhythmLabel;
  rhythmConfidence: number;       // 0-1
  rhythmQuality: number;          // 0-100
  arrhythmiaBurden: number;       // 0-1 (fraction of irregular beats in window)
  recentEvents: RhythmEvent[];    // last N events
  undeterminedReason: string;
  // Feature details
  features: RhythmFeatures;
}

export interface RhythmFeatures {
  rmssd: number;
  sdnn: number;
  pnn50: number;
  shannonEntropy: number;
  sampleEntropy: number;
  sd1: number;
  sd2: number;
  sd1sd2Ratio: number;
  rrCV: number;
  medianHR: number;
  rrIrregularityScore: number;
  morphologyInstabilityScore: number;
  detectorDisagreementBurden: number;
  sourceSwitchBurden: number;
  beatAmplitudeCV: number;
  ectopySuspicionScore: number;
  afLikeScore: number;
}

interface BeatInput {
  ibiMs: number;
  beatSQI: number;
  morphologyScore: number;
  detectorAgreement: number;
  flags: {
    isWeak: boolean;
    isPremature: boolean;
    isSuspicious: boolean;
    isDoublePeak: boolean;
  };
  amplitude?: number;
}

export class RhythmClassifier {
  private readonly MIN_BEATS = 8;
  private readonly WINDOW_SIZE = 20;
  private events: RhythmEvent[] = [];
  private readonly MAX_EVENTS = 50;
  private lastLabel: RhythmLabel = 'INSUFFICIENT_DATA';
  private labelStableCount = 0;
  private irregularBeatCount = 0;
  private totalBeatCount = 0;
  private startTime = 0;

  classify(
    beats: BeatInput[],
    avgBeatSQI: number,
    sourceStability: number
  ): RhythmResult {
    const empty: RhythmResult = {
      rhythmLabel: 'INSUFFICIENT_DATA',
      rhythmConfidence: 0,
      rhythmQuality: 0,
      arrhythmiaBurden: 0,
      recentEvents: [],
      undeterminedReason: 'not_enough_beats',
      features: this.emptyFeatures(),
    };

    if (beats.length < this.MIN_BEATS) return empty;

    const recent = beats.slice(-this.WINDOW_SIZE);
    const ibis = recent.map(b => b.ibiMs).filter(i => i >= 250 && i <= 2200);
    if (ibis.length < 6) return { ...empty, undeterminedReason: 'too_few_valid_rr' };

    // ── Compute features ──
    const features = this.computeFeatures(ibis, recent, sourceStability);

    // ── Quality gate ──
    const windowQuality = this.assessWindowQuality(recent, avgBeatSQI, features);
    if (windowQuality < 25) {
      return {
        ...empty,
        rhythmLabel: 'UNDETERMINED_LOW_QUALITY',
        rhythmQuality: windowQuality,
        undeterminedReason: `window_quality_${windowQuality.toFixed(0)}`,
        features,
      };
    }

    // ── Classification rules (interpretable first) ──
    const label = this.classifyRhythm(features, ibis);
    const confidence = this.computeConfidence(label, features, windowQuality, ibis.length);

    // Hysteresis: require stability before changing label
    if (label !== this.lastLabel) {
      this.labelStableCount++;
      if (this.labelStableCount < 3 && this.lastLabel !== 'INSUFFICIENT_DATA') {
        // Hold previous label for stability
        return {
          rhythmLabel: this.lastLabel,
          rhythmConfidence: confidence * 0.7,
          rhythmQuality: windowQuality,
          arrhythmiaBurden: this.getArrhythmiaBurden(),
          recentEvents: this.events.slice(-10),
          undeterminedReason: '',
          features,
        };
      }
    }
    this.labelStableCount = label === this.lastLabel ? 0 : this.labelStableCount;

    // Track burden
    this.totalBeatCount += recent.length;
    if (label !== 'SINUS_STABLE' && label !== 'SINUS_VARIABLE') {
      this.irregularBeatCount += recent.filter(b => b.flags.isPremature || b.flags.isSuspicious).length;
    }

    // Emit event on label change
    if (label !== this.lastLabel && label !== 'INSUFFICIENT_DATA') {
      this.emitEvent(label, features);
    }
    this.lastLabel = label;

    return {
      rhythmLabel: label,
      rhythmConfidence: confidence,
      rhythmQuality: windowQuality,
      arrhythmiaBurden: this.getArrhythmiaBurden(),
      recentEvents: this.events.slice(-10),
      undeterminedReason: '',
      features,
    };
  }

  /**
   * Fallback cuando hay menos de 8 latidos con entidad rica: ritmo desde intervalos RR
   * (evita `arrhythmiaStatus` / `lastRhythm` obsoletos cuando el umbral de 8 no se cumple).
   */
  classifyFromRRIntervals(
    rrIntervalsMs: number[],
    avgBeatSQI: number,
    sourceStability: number,
    beatEntityCount: number
  ): RhythmResult {
    const filtered = rrIntervalsMs.filter((i) => i >= 250 && i <= 2200).slice(-12);

    if (filtered.length < 2) {
      return {
        rhythmLabel: 'INSUFFICIENT_DATA',
        rhythmConfidence: 0,
        rhythmQuality: 0,
        arrhythmiaBurden: 0,
        recentEvents: [],
        undeterminedReason: 'rr_too_few',
        features: this.emptyFeatures(),
      };
    }

    if (filtered.length === 2) {
      const d = Math.abs(filtered[1] - filtered[0]);
      const mean = (filtered[0] + filtered[1]) / 2;
      const rrCV = mean > 0 ? d / mean : 0;
      const medianHR = 60000 / this.median(filtered);
      return {
        rhythmLabel: 'INSUFFICIENT_DATA',
        rhythmConfidence: 0,
        rhythmQuality: Math.min(25, avgBeatSQI * 0.35),
        arrhythmiaBurden: 0,
        recentEvents: [],
        undeterminedReason: 'need_more_rr_pairs',
        features: {
          ...this.emptyFeatures(),
          rmssd: d,
          sdnn: d / Math.sqrt(2),
          rrCV,
          medianHR,
        },
      };
    }

    const synthetic: BeatInput[] = filtered.map((ibi) => ({
      ibiMs: ibi,
      beatSQI: avgBeatSQI,
      morphologyScore: beatEntityCount >= 4 ? 48 : 34,
      detectorAgreement: Math.max(0.35, sourceStability),
      flags: {
        isWeak: beatEntityCount < 6,
        isPremature: false,
        isSuspicious: beatEntityCount < 4,
        isDoublePeak: false,
      },
    }));

    const ibis = synthetic.map((b) => b.ibiMs);
    const features = this.computeFeatures(ibis, synthetic, sourceStability);
    let windowQuality = this.assessWindowQuality(synthetic, avgBeatSQI, features);
    if (beatEntityCount < 8) windowQuality = Math.min(windowQuality, 44);

    let label: RhythmLabel;
    let undeterminedReason = '';

    if (filtered.length < 4 || beatEntityCount < 3) {
      label = 'INSUFFICIENT_DATA';
      undeterminedReason = 'partial_beat_or_rr_window';
    } else if (windowQuality < 22 || (beatEntityCount < 5 && windowQuality < 34)) {
      label = 'UNDETERMINED_LOW_QUALITY';
      undeterminedReason = `window_quality_${windowQuality.toFixed(0)}`;
    } else {
      label = this.classifyRhythm(features, ibis);
      if (beatEntityCount < 8 && label === 'SINUS_STABLE' && features.rrCV > 0.065) {
        label = 'SINUS_VARIABLE';
      }
    }

    let confidence = this.computeConfidence(label, features, windowQuality, ibis.length);
    if (beatEntityCount < 8) confidence *= 0.62;
    if (label === 'INSUFFICIENT_DATA' || label === 'UNDETERMINED_LOW_QUALITY') {
      confidence = Math.min(confidence, 0.45);
    }

    const burden = Math.min(1, features.rrIrregularityScore * 0.45 + (beatEntityCount < 5 ? 0.08 : 0));

    return {
      rhythmLabel: label,
      rhythmConfidence: confidence,
      rhythmQuality: windowQuality,
      arrhythmiaBurden: burden,
      recentEvents: this.events.slice(-10),
      undeterminedReason,
      features,
    };
  }

  private computeFeatures(
    ibis: number[],
    recentBeats: BeatInput[],
    sourceStability: number
  ): RhythmFeatures {
    // 1. Time-domain HRV (RMSSD, SDNN, pNN50)
    let rmssd = 0, sdnn = 0, pnn50 = 0, rrCV = 0;
    const diffs: number[] = [];
    let pnnCount = 0;

    if (ibis.length > 1) {
      const mean = ibis.reduce((a, b) => a + b, 0) / ibis.length;
      sdnn = Math.sqrt(ibis.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (ibis.length - 1));
      rrCV = mean > 0 ? (sdnn / mean) * 100 : 0;

      let sumSq = 0;
      for (let i = 1; i < ibis.length; i++) {
        const d = Math.abs(ibis[i] - ibis[i - 1]);
        diffs.push(d);
        sumSq += d * d;
        if (d > 50) pnnCount++;
      }
      rmssd = Math.sqrt(sumSq / diffs.length);
      pnn50 = (pnnCount / diffs.length) * 100;
    }

    // 2. Non-linear HRV (Poincaré SD1/SD2)
    // SD1 = standard deviation of instantaneous beat-to-beat variability (short-term)
    // SD2 = standard deviation of continuous long-term variability
    let sd1 = 0, sd2 = 0, sd1sd2Ratio = 0;
    if (diffs.length > 0) {
      sd1 = Math.sqrt(0.5) * rmssd;
      // SD2 calculation approximated via SDNN and SD1: SDNN^2 = 0.5 * SD1^2 + 0.5 * SD2^2
      const sd2Sq = 2 * (sdnn * sdnn) - (sd1 * sd1);
      sd2 = sd2Sq > 0 ? Math.sqrt(sd2Sq) : 0;
      sd1sd2Ratio = sd2 > 0 ? sd1 / sd2 : 0;
    }

    // 3. Shannon Entropy (complexity of RR distribution)
    let shannonEntropy = 0;
    if (ibis.length > 3) {
      const binSize = 50; // 50ms bins
      const bins = new Map<number, number>();
      for (const rr of ibis) {
        const b = Math.floor(rr / binSize);
        bins.set(b, (bins.get(b) || 0) + 1);
      }
      for (const count of bins.values()) {
        const p = count / ibis.length;
        shannonEntropy -= p * Math.log2(p);
      }
    }

    const medianHR = ibis.length > 0 ? 60000 / ibis[Math.floor(ibis.length / 2)] : 0;

    // 4. Morphology Instability
    const morphScores = recentBeats.map(b => b.morphologyScore);
    const mMean = morphScores.reduce((a, b) => a + b, 0) / (morphScores.length || 1);
    const mVar = morphScores.reduce((s, x) => s + Math.pow(x - mMean, 2), 0) / (morphScores.length || 1);
    const morphologyInstabilityScore = Math.min(100, Math.sqrt(mVar) * 2);

    // 5. AFib Likelihood Scoring (Based on SD1/SD2, Entropy, RMSSD, and irregular burden)
    const irrBurden = recentBeats.filter(b => b.flags.isPremature || b.flags.isSuspicious).length / (recentBeats.length || 1);
    
    let afLikeScore = 0;
    if (shannonEntropy > 1.2) afLikeScore += 25; // High complexity
    if (rrCV > 15) afLikeScore += 25;           // High variability
    if (sd1sd2Ratio > 0.8) afLikeScore += 25;   // Spherical Poincaré plot (typical of AFib)
    if (irrBurden > 0.3) afLikeScore += 25;     // High irregular burden

    // 6. Ectopy (PAC/PVC) Scoring
    let ectopySuspicionScore = 0;
    if (pnn50 > 10 && afLikeScore < 50) ectopySuspicionScore += 40; // Isolated large jumps
    if (irrBurden > 0.1 && irrBurden <= 0.3) ectopySuspicionScore += 40;
    if (sd1 > 20 && sd2 < 50) ectopySuspicionScore += 20; // Torpedo-shaped Poincaré

    return {
      rmssd,
      sdnn,
      pnn50,
      shannonEntropy,
      sampleEntropy: 0, // Placeholder
      sd1,
      sd2,
      sd1sd2Ratio,
      rrCV,
      medianHR,
      rrIrregularityScore: Math.min(100, rrCV * 3),
      morphologyInstabilityScore,
      detectorDisagreementBurden: 0, // Simplified
      sourceSwitchBurden: 1 - sourceStability,
      beatAmplitudeCV: 0, // Simplified
      ectopySuspicionScore: Math.min(100, ectopySuspicionScore),
      afLikeScore: Math.min(100, afLikeScore),
    };
  }

  private classifyRhythm(f: RhythmFeatures, ibis: number[]): RhythmLabel {
    if (ibis.length < 5) return 'INSUFFICIENT_DATA';

    // 1. High confidence Atrial Fibrillation (AF) pattern
    if (f.afLikeScore >= 75 && f.shannonEntropy > 1.5 && f.rrCV > 18) {
      return 'POSSIBLE_AF';
    }

    // 2. High irregular burden (Undetermined highly irregular)
    if (f.rrIrregularityScore > 70 && f.afLikeScore >= 50) {
      return 'IRREGULAR_RHYTHM';
    }

    // 3. Ectopic beats (PACs / PVCs)
    if (f.ectopySuspicionScore >= 60) {
      // Check for bigeminy/trigeminy patterns (alternating long-short RR)
      let alternatingCount = 0;
      for (let i = 2; i < ibis.length; i++) {
        const d1 = ibis[i-1] - ibis[i-2];
        const d2 = ibis[i] - ibis[i-1];
        if (d1 * d2 < 0 && Math.abs(d1) > 100 && Math.abs(d2) > 100) alternatingCount++;
      }
      if (alternatingCount >= 3) return 'BIGEMINY_TRIGEMINY_PATTERN';
      return 'POSSIBLE_ECTOPY';
    }

    // 4. Stable but abnormal rates
    if (f.medianHR > 100) return 'TACHYCARDIA_PATTERN';
    if (f.medianHR < 50) return 'BRADYCARDIA_PATTERN';

    // 5. Sinus patterns
    if (f.rrCV > 5 && f.rrCV <= 12) return 'SINUS_VARIABLE';
    return 'SINUS_STABLE';
  }

  private computeIrregularityScore(ibis: number[]): number {
    if (ibis.length < 4) return 0;
    const diffs: number[] = [];
    for (let i = 1; i < ibis.length; i++) {
      diffs.push(Math.abs(ibis[i] - ibis[i - 1]));
    }
    const med = this.median(ibis);
    const outliers = diffs.filter(d => d > med * 0.15).length;
    return Math.min(1, outliers / diffs.length);
  }

  private detectBigeminyTrigeminy(ibis: number[]): boolean {
    if (ibis.length < 6) return false;
    // Check alternating short-long pattern
    let bigeminyCount = 0;
    for (let i = 2; i < ibis.length; i += 2) {
      const ratio1 = ibis[i - 1] / Math.max(1, ibis[i - 2]);
      const ratio2 = ibis[i] > 0 ? ibis[i - 1] / ibis[i] : 0;
      if ((ratio1 < 0.75 || ratio1 > 1.33) && Math.abs(ratio2 - 1 / ratio1) < 0.3) {
        bigeminyCount++;
      }
    }
    return bigeminyCount >= 2;
  }

  private poincare(ibis: number[]): { sd1: number; sd2: number } {
    if (ibis.length < 3) return { sd1: 0, sd2: 0 };
    let sumD1 = 0, sumD2 = 0;
    for (let i = 1; i < ibis.length; i++) {
      const d = ibis[i] - ibis[i - 1];
      sumD1 += d * d;
      const s = ibis[i] + ibis[i - 1];
      const mean2 = 2 * (ibis.reduce((a, b) => a + b, 0) / ibis.length);
      sumD2 += (s - mean2) ** 2;
    }
    const n = ibis.length - 1;
    return {
      sd1: Math.sqrt(sumD1 / (2 * n)),
      sd2: Math.sqrt(sumD2 / (2 * n)),
    };
  }

  private computeSampleEntropy(data: number[]): number {
    if (data.length < 5) return 0;
    const m = 2;
    const r = 0.2 * this.std(data);
    const count = (template: number) => {
      let matches = 0;
      for (let i = 0; i < data.length - template; i++) {
        for (let j = i + 1; j < data.length - template; j++) {
          let match = true;
          for (let k = 0; k < template; k++) {
            if (Math.abs(data[i + k] - data[j + k]) > r) { match = false; break; }
          }
          if (match) matches++;
        }
      }
      return matches;
    };
    const A = count(m + 1);
    const B = count(m);
    if (B === 0 || A === 0) return 0;
    return -Math.log(A / B);
  }

  private assessWindowQuality(beats: BeatInput[], avgSQI: number, f: RhythmFeatures): number {
    let q = 0;
    q += Math.min(25, avgSQI * 0.25);
    q += Math.min(20, beats.length * 1.5);
    const goodBeats = beats.filter(b => b.beatSQI > 40).length;
    q += Math.min(25, (goodBeats / beats.length) * 25);
    q += Math.min(15, (1 - f.detectorDisagreementBurden) * 15);
    q += Math.min(15, (1 - f.sourceSwitchBurden) * 15);
    return Math.min(100, Math.round(q));
  }

  private computeConfidence(label: RhythmLabel, f: RhythmFeatures, quality: number, nBeats: number): number {
    let conf = quality / 100 * 0.4;
    conf += Math.min(0.2, nBeats * 0.01);
    if (label === 'SINUS_STABLE') conf += 0.2;
    else if (label === 'POSSIBLE_AF' && f.afLikeScore > 0.7) conf += 0.15;
    else if (label.startsWith('POSSIBLE')) conf += 0.05;
    conf += (1 - f.morphologyInstabilityScore) * 0.1;
    conf += (1 - f.sourceSwitchBurden) * 0.1;
    return Math.min(1, Math.max(0, conf));
  }

  private getArrhythmiaBurden(): number {
    if (this.totalBeatCount === 0) return 0;
    return this.irregularBeatCount / this.totalBeatCount;
  }

  private emitEvent(label: RhythmLabel, f: RhythmFeatures): void {
    const severity: RhythmEvent['severity'] =
      label === 'POSSIBLE_AF' || label === 'POSSIBLE_ECTOPY' ? 'alert' :
      label === 'IRREGULAR_RHYTHM' || label === 'BIGEMINY_TRIGEMINY_PATTERN' ? 'warning' : 'info';

    this.events.push({
      timestamp: performance.now(),
      label,
      severity,
      metrics: {
        rmssd: f.rmssd,
        sdnn: f.sdnn,
        shannonEntropy: f.shannonEntropy,
        pnn50: f.pnn50,
        rrCV: f.rrCV,
      },
    });
    if (this.events.length > this.MAX_EVENTS) this.events.shift();
  }

  private median(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  private std(arr: number[]): number {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  }

  private emptyFeatures(): RhythmFeatures {
    return {
      rmssd: 0, sdnn: 0, pnn50: 0, shannonEntropy: 0, sampleEntropy: 0,
      sd1: 0, sd2: 0, sd1sd2Ratio: 0, rrCV: 0, medianHR: 0,
      rrIrregularityScore: 0, morphologyInstabilityScore: 0,
      detectorDisagreementBurden: 0, sourceSwitchBurden: 0,
      beatAmplitudeCV: 0, ectopySuspicionScore: 0, afLikeScore: 0,
    };
  }

  reset(): void {
    this.events = [];
    this.lastLabel = 'INSUFFICIENT_DATA';
    this.labelStableCount = 0;
    this.irregularBeatCount = 0;
    this.totalBeatCount = 0;
    this.startTime = 0;
  }
}
