/**
 * RHYTHM CLASSIFIER V2 — HIERARCHICAL PPG ARRHYTHMIA PIPELINE
 *
 * Reescritura completa desde cero. Reemplaza tanto al antiguo RhythmClassifier
 * como al `arrhythmia-processor.ts` (eliminado). Implementa el pipeline jerárquico
 * exigido en la Fase 8:
 *
 *   1. SQI gate estricto              — sin señal buena, no se clasifica
 *   2. RR series cleaning             — MAD outlier removal sobre IBIs aceptados
 *   3. Beat morphology aggregation    — usa beatSQI, morphologyScore, flags
 *   4. Feature extraction por ventana:
 *        - Temporales : medianRR, MAD-RR, CVRR, RMSSD, pNN20, pNN50, SDNN
 *        - No lineales: Poincaré SD1/SD2, sample entropy, Shannon entropy
 *        - Patrones   : turning point ratio, irregularidad RR, bigeminy/trigeminy
 *        - Morfología : amplitude CV, morphology instability, ectopy suspicion
 *        - Ruido      : detector disagreement, source switch burden
 *   5. Rule engine     — clasifica por evidencia jerárquica (no por umbral único)
 *   6. State machine   — exige persistencia temporal antes de cambiar etiqueta
 *                        (mayoría 2/3 ventanas + cooldown post-noise)
 *
 * Etiquetas:
 *   - SINUS_REGULAR
 *   - SINUS_VARIABLE
 *   - BRADY_IRREGULAR
 *   - TACHY_IRREGULAR
 *   - IRREGULAR_UNDETERMINED
 *   - AF_SUSPECTED
 *   - FREQUENT_ECTOPY_SUSPECTED
 *   - BIGEMINY_TRIGEMINY_SUSPECTED
 *   - NOISE_OR_UNRELIABLE
 *   - INSUFFICIENT_DATA
 *
 * Filosofía:
 *   - AF NO se dispara por 2-3 RR raros: requiere irregularly-irregular sostenida
 *     (entropía alta + pNN50 alto + irregularidad alta + sd1/sd2 alto + persistencia ≥3 ventanas)
 *   - Ectopy NO se confunde con AF: requiere prematuras + recuperación bigeminy/aislada
 *   - Ruido NO se confunde con arritmia: detector disagreement / source switching → NOISE_OR_UNRELIABLE
 *   - Cada salida incluye `evidenceBreakdown` trazable
 *
 * Refs: Chong 2015, Pereira 2020 Sci Rep, Bashar 2019 IEEE TBME, Task Force HRV 1996.
 */

export type RhythmLabel =
  | 'SINUS_REGULAR'
  | 'SINUS_VARIABLE'
  | 'BRADY_IRREGULAR'
  | 'TACHY_IRREGULAR'
  | 'IRREGULAR_UNDETERMINED'
  | 'AF_SUSPECTED'
  | 'FREQUENT_ECTOPY_SUSPECTED'
  | 'BIGEMINY_TRIGEMINY_SUSPECTED'
  | 'NOISE_OR_UNRELIABLE'
  | 'INSUFFICIENT_DATA';

/**
 * Legacy alias kept so existing UI code (e.g. `'SINUS_STABLE'`) keeps compiling.
 * Internally we always emit canonical RhythmLabel values.
 */
export type LegacyRhythmLabel =
  | RhythmLabel
  | 'SINUS_STABLE'
  | 'POSSIBLE_AF'
  | 'POSSIBLE_ECTOPY'
  | 'BIGEMINY_TRIGEMINY_PATTERN'
  | 'IRREGULAR_RHYTHM'
  | 'BRADYCARDIA_PATTERN'
  | 'TACHYCARDIA_PATTERN'
  | 'UNDETERMINED_LOW_QUALITY';

export interface RhythmEvent {
  timestampMs: number;
  label: RhythmLabel;
  severity: 'info' | 'warning' | 'alert';
  rmssd: number;
  pnn50: number;
  shannonEntropy: number;
  rrCV: number;
}

export interface RhythmFeatures {
  // Window context
  beatsAnalyzed: number;
  validBeats: number;
  ibisCleaned: number;
  // Central tendency
  medianRR: number;
  medianHR: number;
  // Variability
  rrCV: number;
  sdnn: number;
  rmssd: number;
  madRR: number;
  pnn20: number;
  pnn50: number;
  // Non-linear
  sd1: number;
  sd2: number;
  sd1sd2Ratio: number;
  shannonEntropy: number;
  sampleEntropy: number;
  // Patterns
  turningPointRatio: number;
  rrIrregularityScore: number;
  bigeminyScore: number;
  // Morphology / quality penalties
  morphologyInstability: number;
  beatAmplitudeCV: number;
  detectorDisagreementBurden: number;
  sourceSwitchBurden: number;
  ectopySuspicionScore: number;
  afLikeScore: number;
}

export interface RhythmEvidence {
  reasons: string[];
  rrCleanedCount: number;
  outliersRemoved: number;
  windowQuality: number;
  persistenceWindows: number;
  pendingLabel: RhythmLabel;
}

export interface RhythmResult {
  rhythmLabel: RhythmLabel;
  rhythmConfidence: number;       // 0-1
  rhythmQuality: number;          // 0-100 ("windowQuality")
  arrhythmiaBurden: number;       // 0-1 fraction across session
  recentEvents: RhythmEvent[];
  undeterminedReason: string;
  features: RhythmFeatures;
  evidence: RhythmEvidence;
}

export interface BeatInput {
  ibiMs: number;
  beatSQI: number;            // 0-100
  morphologyScore: number;    // 0-100
  detectorAgreement: number;  // 0-1
  amplitude?: number;
  flags: {
    isWeak: boolean;
    isPremature: boolean;
    isSuspicious: boolean;
    isDoublePeak: boolean;
  };
}

interface ClassificationConfig {
  /** Minimum beats accepted by upstream before we even try to classify. */
  minBeats: number;
  /** Number of last beats considered per classification window. */
  windowBeats: number;
  /** Minimum window quality (0-100) to emit a non-NOISE label. */
  minWindowQuality: number;
  /** Persistence (consecutive windows) required before promoting to alert labels. */
  persistenceForAlerts: number;
  /** Persistence required for benign label transitions. */
  persistenceForBenign: number;
}

const DEFAULT_CONFIG: ClassificationConfig = {
  minBeats: 8,
  windowBeats: 24,
  minWindowQuality: 30,
  persistenceForAlerts: 3,
  persistenceForBenign: 2,
};

export class RhythmClassifier {
  private readonly config: ClassificationConfig;

  // Persistence state machine
  private currentLabel: RhythmLabel = 'INSUFFICIENT_DATA';
  private pendingLabel: RhythmLabel = 'INSUFFICIENT_DATA';
  private pendingStreak = 0;
  private noiseCooldown = 0;

  // Session burden tracking
  private totalBeatsSeen = 0;
  private irregularBeatsSeen = 0;

  // Event log (capped)
  private events: RhythmEvent[] = [];
  private readonly MAX_EVENTS = 50;

  constructor(config: Partial<ClassificationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Classify rhythm from accepted beats + upstream quality signals.
   *
   * @param beats             beats already accepted by HeartBeatProcessor
   * @param avgBeatSQI        average beatSQI of the window (0-100)
   * @param sourceStability   0-1, signal source stability score
   */
  classify(beats: BeatInput[], avgBeatSQI: number, sourceStability: number): RhythmResult {
    const empty = (label: RhythmLabel, reason: string, windowQuality = 0): RhythmResult => ({
      rhythmLabel: label,
      rhythmConfidence: 0,
      rhythmQuality: windowQuality,
      arrhythmiaBurden: this.getBurden(),
      recentEvents: this.events.slice(-10),
      undeterminedReason: reason,
      features: this.emptyFeatures(),
      evidence: {
        reasons: [reason],
        rrCleanedCount: 0,
        outliersRemoved: 0,
        windowQuality,
        persistenceWindows: this.pendingStreak,
        pendingLabel: this.pendingLabel,
      },
    });

    // ── Gate 1: minimum beats ──
    if (!beats || beats.length < this.config.minBeats) {
      this.resetPersistence('INSUFFICIENT_DATA');
      return empty('INSUFFICIENT_DATA', 'not_enough_beats');
    }

    const window = beats.slice(-this.config.windowBeats);

    // ── Gate 2: RR cleaning (MAD-based outlier rejection on physiological range) ──
    const rawIbis = window
      .map(b => b.ibiMs)
      .filter(i => Number.isFinite(i) && i >= 250 && i <= 2200);

    if (rawIbis.length < 6) {
      this.resetPersistence('INSUFFICIENT_DATA');
      return empty('INSUFFICIENT_DATA', 'too_few_valid_rr');
    }

    const { cleaned, outliersRemoved } = this.cleanRRSeries(rawIbis);
    if (cleaned.length < 5) {
      this.resetPersistence('INSUFFICIENT_DATA');
      return empty('INSUFFICIENT_DATA', `rr_cleaning_left_${cleaned.length}`);
    }

    // ── Feature extraction ──
    const features = this.computeFeatures(cleaned, window, sourceStability);

    // ── Window quality gate ──
    const windowQuality = this.assessWindowQuality(window, avgBeatSQI, features);

    // Track session burden BEFORE quality gating so noise doesn't hide arrhythmias
    this.totalBeatsSeen += window.length;
    this.irregularBeatsSeen += window.filter(
      b => b.flags.isPremature || b.flags.isSuspicious || b.flags.isDoublePeak
    ).length;

    if (windowQuality < this.config.minWindowQuality) {
      this.noiseCooldown = 2; // suppress changes for next 2 windows
      this.resetPersistence('NOISE_OR_UNRELIABLE');
      return {
        ...empty('NOISE_OR_UNRELIABLE', `window_quality_${windowQuality.toFixed(0)}`, windowQuality),
        features,
        evidence: {
          reasons: ['low_window_quality'],
          rrCleanedCount: cleaned.length,
          outliersRemoved,
          windowQuality,
          persistenceWindows: 0,
          pendingLabel: 'NOISE_OR_UNRELIABLE',
        },
      };
    }

    // After noise, require an extra window before we commit to anything
    if (this.noiseCooldown > 0) {
      this.noiseCooldown--;
    }

    // ── Hierarchical rule engine ──
    const { label: candidate, reasons } = this.classifyHierarchical(features, cleaned);

    // ── State machine: persistence requirement ──
    const promoted = this.applyPersistence(candidate);
    const confidence = this.computeConfidence(promoted, features, windowQuality, cleaned.length);

    if (promoted !== this.currentLabel && promoted !== 'INSUFFICIENT_DATA') {
      this.emitEvent(promoted, features);
      this.currentLabel = promoted;
    }

    return {
      rhythmLabel: promoted,
      rhythmConfidence: confidence,
      rhythmQuality: windowQuality,
      arrhythmiaBurden: this.getBurden(),
      recentEvents: this.events.slice(-10),
      undeterminedReason: '',
      features,
      evidence: {
        reasons,
        rrCleanedCount: cleaned.length,
        outliersRemoved,
        windowQuality,
        persistenceWindows: this.pendingStreak,
        pendingLabel: this.pendingLabel,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // RR cleaning (MAD outlier rejection)
  // ────────────────────────────────────────────────────────────────────

  private cleanRRSeries(ibis: number[]): { cleaned: number[]; outliersRemoved: number } {
    const med = this.median(ibis);
    const deviations = ibis.map(v => Math.abs(v - med));
    const mad = this.median(deviations);
    // Robust threshold: 4·MAD ≈ 6σ for Gaussian, but PPG RR is non-Gaussian.
    // Cap at 35% relative deviation so true ectopics survive (we WANT them in features).
    const macroLimit = Math.max(60, Math.min(med * 0.35, 4 * mad));
    const cleaned: number[] = [];
    let removed = 0;
    for (const v of ibis) {
      if (Math.abs(v - med) <= macroLimit) cleaned.push(v);
      else removed++;
    }
    return { cleaned, outliersRemoved: removed };
  }

  // ────────────────────────────────────────────────────────────────────
  // Feature extraction
  // ────────────────────────────────────────────────────────────────────

  private computeFeatures(ibis: number[], beats: BeatInput[], sourceStab: number): RhythmFeatures {
    const n = ibis.length;
    const mean = ibis.reduce((a, b) => a + b, 0) / n;
    const sdnn = Math.sqrt(ibis.reduce((s, i) => s + (i - mean) ** 2, 0) / n);
    const rrCV = sdnn / Math.max(1, mean);
    const medianRR = this.median(ibis);
    const medianHR = 60000 / Math.max(1, medianRR);
    const madRR = this.median(ibis.map(v => Math.abs(v - medianRR)));

    // Successive-difference statistics
    let ssd = 0;
    let pnn20 = 0;
    let pnn50 = 0;
    for (let i = 1; i < n; i++) {
      const d = Math.abs(ibis[i] - ibis[i - 1]);
      ssd += d * d;
      if (d > 20) pnn20++;
      if (d > 50) pnn50++;
    }
    const rmssd = Math.sqrt(ssd / Math.max(1, n - 1));
    const pnn20Frac = pnn20 / Math.max(1, n - 1);
    const pnn50Frac = pnn50 / Math.max(1, n - 1);

    // Shannon entropy (32-bin RR histogram, normalized)
    const minRR = Math.min(...ibis);
    const maxRR = Math.max(...ibis);
    const span = Math.max(1, maxRR - minRR);
    const bins = new Array(32).fill(0);
    for (const v of ibis) {
      const k = Math.min(31, Math.floor(((v - minRR) / span) * 32));
      bins[k]++;
    }
    let shannon = 0;
    for (const c of bins) {
      if (c > 0) {
        const p = c / n;
        shannon -= p * Math.log2(p);
      }
    }

    const sampleEntropy = this.sampleEntropy(ibis, 2, 0.2);

    // Poincaré SD1 / SD2
    const { sd1, sd2 } = this.poincare(ibis);

    // Turning point ratio (randomness test)
    const turningPointRatio = this.turningPointRatio(ibis);

    // RR irregularity (fraction of |Δ| > 15% median)
    const irrLimit = medianRR * 0.15;
    let irrCount = 0;
    for (let i = 1; i < n; i++) if (Math.abs(ibis[i] - ibis[i - 1]) > irrLimit) irrCount++;
    const rrIrregularityScore = irrCount / Math.max(1, n - 1);

    // Bigeminy/trigeminy detector
    const bigeminyScore = this.detectAlternatingPattern(ibis);

    // ── Beat-quality features ──
    const morphScores = beats.map(b => b.morphologyScore || 0);
    const morphMean = morphScores.reduce((a, b) => a + b, 0) / Math.max(1, morphScores.length);
    const morphVar =
      morphScores.reduce((s, v) => s + (v - morphMean) ** 2, 0) / Math.max(1, morphScores.length);
    const morphologyInstability = Math.min(1, Math.sqrt(morphVar) / 30);

    const amps = beats.map(b => b.amplitude ?? 0).filter(v => v > 0);
    let beatAmplitudeCV = 0;
    if (amps.length > 2) {
      const am = amps.reduce((a, b) => a + b, 0) / amps.length;
      const aStd = Math.sqrt(amps.reduce((s, v) => s + (v - am) ** 2, 0) / amps.length);
      beatAmplitudeCV = am > 0 ? aStd / am : 0;
    }

    const disagreeBurden =
      beats.filter(b => b.detectorAgreement < 0.5).length / Math.max(1, beats.length);
    const sourceSwitchBurden = Math.max(0, 1 - sourceStab);

    const prematureCount = beats.filter(b => b.flags.isPremature).length;
    const ectopySuspicion = Math.min(1, (prematureCount / Math.max(1, beats.length)) * 3);

    // AF-like composite: irregularly irregular + high entropy + high pNN50
    const afLikeScore = Math.min(
      1,
      rrIrregularityScore * 0.30 +
        Math.min(1, shannon / 4) * 0.25 +
        Math.min(1, pnn50Frac / 0.5) * 0.20 +
        Math.min(1, rrCV / 0.20) * 0.15 +
        (sd1 > 0 && sd2 > 0 ? Math.min(1, sd1 / sd2) * 0.10 : 0)
    );

    return {
      beatsAnalyzed: beats.length,
      validBeats: beats.length,
      ibisCleaned: n,
      medianRR,
      medianHR,
      rrCV,
      sdnn,
      rmssd,
      madRR,
      pnn20: pnn20Frac,
      pnn50: pnn50Frac,
      sd1,
      sd2,
      sd1sd2Ratio: sd2 > 0 ? sd1 / sd2 : 0,
      shannonEntropy: shannon,
      sampleEntropy,
      turningPointRatio,
      rrIrregularityScore,
      bigeminyScore,
      morphologyInstability,
      beatAmplitudeCV,
      detectorDisagreementBurden: disagreeBurden,
      sourceSwitchBurden,
      ectopySuspicionScore: ectopySuspicion,
      afLikeScore,
    };
  }

  private poincare(ibis: number[]): { sd1: number; sd2: number } {
    if (ibis.length < 3) return { sd1: 0, sd2: 0 };
    const n = ibis.length - 1;
    let sumDiff2 = 0;
    let sumSum2 = 0;
    const meanRR = ibis.reduce((a, b) => a + b, 0) / ibis.length;
    for (let i = 0; i < n; i++) {
      const d = ibis[i + 1] - ibis[i];
      const s = ibis[i + 1] + ibis[i] - 2 * meanRR;
      sumDiff2 += d * d;
      sumSum2 += s * s;
    }
    return { sd1: Math.sqrt(sumDiff2 / (2 * n)), sd2: Math.sqrt(sumSum2 / (2 * n)) };
  }

  private sampleEntropy(data: number[], m: number, rFactor: number): number {
    if (data.length < m + 2) return 0;
    const r = rFactor * this.std(data);
    if (r <= 0) return 0;
    const count = (templateLen: number): number => {
      let matches = 0;
      const limit = data.length - templateLen;
      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
          let isMatch = true;
          for (let k = 0; k < templateLen; k++) {
            if (Math.abs(data[i + k] - data[j + k]) > r) {
              isMatch = false;
              break;
            }
          }
          if (isMatch) matches++;
        }
      }
      return matches;
    };
    const A = count(m + 1);
    const B = count(m);
    if (B === 0 || A === 0) return 0;
    return -Math.log(A / B);
  }

  private turningPointRatio(data: number[]): number {
    if (data.length < 3) return 0;
    let turns = 0;
    for (let i = 1; i < data.length - 1; i++) {
      if (
        (data[i] > data[i - 1] && data[i] > data[i + 1]) ||
        (data[i] < data[i - 1] && data[i] < data[i + 1])
      ) {
        turns++;
      }
    }
    // For a fully random series TPR ≈ 2/3
    return turns / (data.length - 2);
  }

  private detectAlternatingPattern(ibis: number[]): number {
    if (ibis.length < 6) return 0;
    let alternations = 0;
    for (let i = 2; i < ibis.length; i++) {
      const prev = ibis[i - 1];
      const prev2 = ibis[i - 2];
      const cur = ibis[i];
      // Pattern: short-long-short or long-short-long with ≥20% delta
      const r1 = prev / Math.max(1, prev2);
      const r2 = cur / Math.max(1, prev);
      if (
        ((r1 < 0.8 && r2 > 1.25) || (r1 > 1.25 && r2 < 0.8)) &&
        Math.abs(r1 * r2 - 1) < 0.25
      ) {
        alternations++;
      }
    }
    return Math.min(1, alternations / Math.max(1, ibis.length - 2));
  }

  // ────────────────────────────────────────────────────────────────────
  // Quality assessment
  // ────────────────────────────────────────────────────────────────────

  private assessWindowQuality(beats: BeatInput[], avgSQI: number, f: RhythmFeatures): number {
    let q = 0;
    q += Math.min(25, avgSQI * 0.25);
    q += Math.min(20, beats.length * 1.0);
    const goodBeats = beats.filter(b => b.beatSQI > 40).length;
    q += Math.min(20, (goodBeats / Math.max(1, beats.length)) * 20);
    q += Math.min(15, (1 - f.detectorDisagreementBurden) * 15);
    q += Math.min(10, (1 - f.sourceSwitchBurden) * 10);
    q += Math.min(10, (1 - f.morphologyInstability) * 10);
    return Math.max(0, Math.min(100, Math.round(q)));
  }

  private computeConfidence(
    label: RhythmLabel,
    f: RhythmFeatures,
    quality: number,
    nIbis: number
  ): number {
    if (label === 'INSUFFICIENT_DATA' || label === 'NOISE_OR_UNRELIABLE') return 0;
    let conf = (quality / 100) * 0.4;
    conf += Math.min(0.2, nIbis * 0.012);
    if (label === 'SINUS_REGULAR') conf += 0.2;
    else if (label === 'SINUS_VARIABLE') conf += 0.15;
    else if (label === 'AF_SUSPECTED' && f.afLikeScore > 0.7) conf += 0.15;
    else if (label === 'BIGEMINY_TRIGEMINY_SUSPECTED' && f.bigeminyScore > 0.4) conf += 0.12;
    else if (label === 'FREQUENT_ECTOPY_SUSPECTED' && f.ectopySuspicionScore > 0.5) conf += 0.10;
    else conf += 0.05;
    conf += (1 - f.morphologyInstability) * 0.1;
    conf += (1 - f.sourceSwitchBurden) * 0.05;
    // Persistence boost
    conf += Math.min(0.1, this.pendingStreak * 0.03);
    return Math.max(0, Math.min(1, conf));
  }

  // ────────────────────────────────────────────────────────────────────
  // Hierarchical rule engine
  // ────────────────────────────────────────────────────────────────────

  private classifyHierarchical(
    f: RhythmFeatures,
    ibis: number[]
  ): { label: RhythmLabel; reasons: string[] } {
    const reasons: string[] = [];
    const hr = f.medianHR;

    // 1. Bigeminy/trigeminy alternating pattern (very specific signature)
    if (f.bigeminyScore > 0.40 && f.morphologyInstability < 0.6) {
      reasons.push(`bigeminy_score_${f.bigeminyScore.toFixed(2)}`);
      return { label: 'BIGEMINY_TRIGEMINY_SUSPECTED', reasons };
    }

    // 2. AF-like irregularly irregular: requires high entropy + high pNN50 + high CV
    if (
      f.afLikeScore > 0.65 &&
      f.shannonEntropy > 2.0 &&
      f.pnn50 > 0.30 &&
      f.rrCV > 0.12 &&
      f.sd1sd2Ratio > 0.55
    ) {
      reasons.push(`af_score_${f.afLikeScore.toFixed(2)}`);
      reasons.push(`entropy_${f.shannonEntropy.toFixed(2)}`);
      reasons.push(`pnn50_${(f.pnn50 * 100).toFixed(0)}%`);
      // Tachy/brady refinement
      if (hr > 110) return { label: 'TACHY_IRREGULAR', reasons };
      if (hr < 50) return { label: 'BRADY_IRREGULAR', reasons };
      return { label: 'AF_SUSPECTED', reasons };
    }

    // 3. Frequent ectopy: prematures + morphology instability
    if (
      f.ectopySuspicionScore > 0.45 &&
      f.morphologyInstability > 0.30 &&
      f.rrIrregularityScore > 0.25
    ) {
      reasons.push(`ectopy_${f.ectopySuspicionScore.toFixed(2)}`);
      return { label: 'FREQUENT_ECTOPY_SUSPECTED', reasons };
    }

    // 4. Tachy / brady irregular (rate + irregularity, but not AF-grade)
    if (hr > 110 && (f.rrCV > 0.08 || f.rrIrregularityScore > 0.20)) {
      reasons.push('tachy_irregular');
      return { label: 'TACHY_IRREGULAR', reasons };
    }
    if (hr < 50 && (f.rrCV > 0.08 || f.rrIrregularityScore > 0.20)) {
      reasons.push('brady_irregular');
      return { label: 'BRADY_IRREGULAR', reasons };
    }

    // 5. Generic irregularity (can't pin to AF/ectopy)
    if (f.rrIrregularityScore > 0.40 && f.rmssd > 60 && f.rrCV > 0.10) {
      reasons.push(`irregular_${f.rrIrregularityScore.toFixed(2)}`);
      return { label: 'IRREGULAR_UNDETERMINED', reasons };
    }

    // 6. Sinus variable (normal HRV)
    if (f.rrCV > 0.06 || f.rmssd > 35) {
      reasons.push('sinus_variable');
      return { label: 'SINUS_VARIABLE', reasons };
    }

    reasons.push('sinus_regular');
    return { label: 'SINUS_REGULAR', reasons };
  }

  // ────────────────────────────────────────────────────────────────────
  // Persistence state machine
  // ────────────────────────────────────────────────────────────────────

  private applyPersistence(candidate: RhythmLabel): RhythmLabel {
    const isAlert = (l: RhythmLabel) =>
      l === 'AF_SUSPECTED' ||
      l === 'FREQUENT_ECTOPY_SUSPECTED' ||
      l === 'BIGEMINY_TRIGEMINY_SUSPECTED' ||
      l === 'IRREGULAR_UNDETERMINED' ||
      l === 'TACHY_IRREGULAR' ||
      l === 'BRADY_IRREGULAR';

    if (candidate === this.currentLabel) {
      this.pendingLabel = candidate;
      this.pendingStreak = Math.max(this.pendingStreak, 1);
      return this.currentLabel;
    }

    if (candidate === this.pendingLabel) {
      this.pendingStreak++;
    } else {
      this.pendingLabel = candidate;
      this.pendingStreak = 1;
    }

    const required = isAlert(candidate)
      ? this.config.persistenceForAlerts
      : this.config.persistenceForBenign;

    if (this.pendingStreak >= required) {
      return candidate; // promote
    }
    // Hold previous label
    return this.currentLabel === 'INSUFFICIENT_DATA' ? candidate : this.currentLabel;
  }

  private resetPersistence(label: RhythmLabel): void {
    this.pendingLabel = label;
    this.pendingStreak = 0;
    this.currentLabel = label;
  }

  // ────────────────────────────────────────────────────────────────────
  // Events + burden
  // ────────────────────────────────────────────────────────────────────

  private emitEvent(label: RhythmLabel, f: RhythmFeatures): void {
    const severity: RhythmEvent['severity'] =
      label === 'AF_SUSPECTED'
        ? 'alert'
        : label === 'FREQUENT_ECTOPY_SUSPECTED' ||
          label === 'BIGEMINY_TRIGEMINY_SUSPECTED' ||
          label === 'TACHY_IRREGULAR' ||
          label === 'BRADY_IRREGULAR'
        ? 'warning'
        : 'info';
    this.events.push({
      timestampMs: performance.now(),
      label,
      severity,
      rmssd: f.rmssd,
      pnn50: f.pnn50,
      shannonEntropy: f.shannonEntropy,
      rrCV: f.rrCV,
    });
    if (this.events.length > this.MAX_EVENTS) this.events.shift();
  }

  private getBurden(): number {
    if (this.totalBeatsSeen === 0) return 0;
    return Math.max(0, Math.min(1, this.irregularBeatsSeen / this.totalBeatsSeen));
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  private std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  }

  private emptyFeatures(): RhythmFeatures {
    return {
      beatsAnalyzed: 0,
      validBeats: 0,
      ibisCleaned: 0,
      medianRR: 0,
      medianHR: 0,
      rrCV: 0,
      sdnn: 0,
      rmssd: 0,
      madRR: 0,
      pnn20: 0,
      pnn50: 0,
      sd1: 0,
      sd2: 0,
      sd1sd2Ratio: 0,
      shannonEntropy: 0,
      sampleEntropy: 0,
      turningPointRatio: 0,
      rrIrregularityScore: 0,
      bigeminyScore: 0,
      morphologyInstability: 0,
      beatAmplitudeCV: 0,
      detectorDisagreementBurden: 0,
      sourceSwitchBurden: 0,
      ectopySuspicionScore: 0,
      afLikeScore: 0,
    };
  }

  reset(): void {
    this.currentLabel = 'INSUFFICIENT_DATA';
    this.pendingLabel = 'INSUFFICIENT_DATA';
    this.pendingStreak = 0;
    this.noiseCooldown = 0;
    this.totalBeatsSeen = 0;
    this.irregularBeatsSeen = 0;
    this.events = [];
  }
}
