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

  private classifyRhythm(f: RhythmFeatures, ibis: number[]): RhythmLabel {
    const hr = f.medianHR;

    // ── Rate-based patterns ──
    if (hr < 50 && f.rrCV < 0.12) return 'BRADYCARDIA_PATTERN';
    if (hr > 110 && f.rrCV < 0.12) return 'TACHYCARDIA_PATTERN';

    // ── AF-like: irregularly irregular + high entropy ──
    if (f.afLikeScore > 0.65 && f.rrCV > 0.12 && f.shannonEntropy > 1.8 && f.pnn50 > 0.30) {
      return 'POSSIBLE_AF';
    }

    // ── Bigeminy/Trigeminy pattern ──
    if (this.detectBigeminyTrigeminy(ibis)) {
      return 'BIGEMINY_TRIGEMINY_PATTERN';
    }

    // ── Ectopy ──
    if (f.ectopySuspicionScore > 0.5 && f.morphologyInstabilityScore > 0.4) {
      return 'POSSIBLE_ECTOPY';
    }

    // ── General irregularity ──
    if (f.rrIrregularityScore > 0.5 && f.rmssd > 60 && f.rrCV > 0.10) {
      return 'IRREGULAR_RHYTHM';
    }

    // ── Sinus with variability ──
    if (f.rrCV > 0.08 || f.rmssd > 40) {
      return 'SINUS_VARIABLE';
    }

    return 'SINUS_STABLE';
  }

  private computeFeatures(ibis: number[], beats: BeatInput[], sourceStab: number): RhythmFeatures {
    const n = ibis.length;
    const mean = ibis.reduce((a, b) => a + b, 0) / n;
    const sdnn = Math.sqrt(ibis.reduce((s, i) => s + (i - mean) ** 2, 0) / n);
    const rrCV = sdnn / Math.max(1, mean);

    // RMSSD
    let ssd = 0;
    let pnn50Count = 0;
    for (let i = 1; i < n; i++) {
      const d = ibis[i] - ibis[i - 1];
      ssd += d * d;
      if (Math.abs(d) > 50) pnn50Count++;
    }
    const rmssd = Math.sqrt(ssd / Math.max(1, n - 1));
    const pnn50 = pnn50Count / Math.max(1, n - 1);

    // Shannon entropy
    const bins: Record<number, number> = {};
    const binW = 30;
    for (const i of ibis) {
      const k = Math.floor(i / binW);
      bins[k] = (bins[k] || 0) + 1;
    }
    let shannonEntropy = 0;
    for (const c of Object.values(bins)) {
      const p = c / n;
      shannonEntropy -= p * Math.log2(p);
    }

    // Sample entropy (simplified)
    const sampleEntropy = this.computeSampleEntropy(ibis);

    // Poincaré
    const { sd1, sd2 } = this.poincare(ibis);

    // Morphology instability
    const morphScores = beats.map(b => b.morphologyScore);
    const morphMean = morphScores.reduce((a, b) => a + b, 0) / morphScores.length;
    const morphVar = morphScores.reduce((s, v) => s + (v - morphMean) ** 2, 0) / morphScores.length;
    const morphologyInstabilityScore = Math.min(1, Math.sqrt(morphVar) / 30);

    // Detector disagreement burden
    const disagreeCount = beats.filter(b => b.detectorAgreement < 0.5).length;
    const detectorDisagreementBurden = disagreeCount / beats.length;

    // Source switch burden (inverse of stability)
    const sourceSwitchBurden = 1 - sourceStab;

    // Beat amplitude CV
    const amps = beats.filter(b => b.amplitude && b.amplitude > 0).map(b => b.amplitude!);
    let beatAmplitudeCV = 0;
    if (amps.length > 2) {
      const ampMean = amps.reduce((a, b) => a + b, 0) / amps.length;
      const ampStd = Math.sqrt(amps.reduce((s, v) => s + (v - ampMean) ** 2, 0) / amps.length);
      beatAmplitudeCV = ampMean > 0 ? ampStd / ampMean : 0;
    }

    // Ectopy suspicion
    const prematureCount = beats.filter(b => b.flags.isPremature).length;
    const ectopySuspicionScore = Math.min(1, prematureCount / Math.max(1, beats.length) * 3);

    // AF-like score: combine irregularity metrics
    const rrIrregularityScore = this.computeIrregularityScore(ibis);
    const afLikeScore = Math.min(1,
      (rrIrregularityScore * 0.3) +
      (Math.min(1, shannonEntropy / 3) * 0.25) +
      (Math.min(1, pnn50 / 0.5) * 0.2) +
      (Math.min(1, rrCV / 0.2) * 0.15) +
      (sd1 > 0 && sd2 > 0 ? Math.min(1, sd1 / sd2) * 0.1 : 0)
    );

    const medianHR = 60000 / this.median(ibis);

    return {
      rmssd, sdnn, pnn50, shannonEntropy, sampleEntropy,
      sd1, sd2, sd1sd2Ratio: sd2 > 0 ? sd1 / sd2 : 0,
      rrCV, medianHR, rrIrregularityScore,
      morphologyInstabilityScore, detectorDisagreementBurden,
      sourceSwitchBurden, beatAmplitudeCV,
      ectopySuspicionScore, afLikeScore,
    };
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
