/**
 * LIVE_PPG_EVIDENCE_GATE — FAIL-CLOSED ARCHITECTURE
 * 
 * Este gate NO bloquea por forma de dedo (finger-blocking).
 * Bloquea por AUSENCIA DE EVIDENCIA PPG VIVA (evidence-blocking).
 * 
 * La app debe aceptar cualquier región corporal viable (dedo, palma, oreja, rostro, muñeca)
 * PERO SOLO SI HAY EVIDENCIA ÓPTICA PULSÁTIL REAL.
 * 
 * REGLA MADRE: VALOR REAL O CERO.
 * Si no hay evidencia suficiente: BPM=0, SpO₂=0, presión=0/0, glucosa=0, lípidos=0.
 */

export interface LivePpgEvidenceInput {
  timestamp: number;
  sampleRate: number;
  contactState?: string;
  extendedContactState?: string;
  quality: number;
  perfusionIndex: number;
  clipHighRatio: number;
  clipLowRatio: number;
  motionArtifact: number;
  sourceStability: number;
  pressureState?: string;
  windowSQI?: {
    score: number;
    gating: string;
    spectral?: {
      dominantFrequencyHz?: number;
      spectralDominanceScore?: number;
      detectorAgreementScore?: number;
      dominantFrequencyStability?: number;
      spectralEntropyPenalty?: number;
    };
  };
  beatDebug?: {
    acceptedBeats: number;
    consecutivePeaks: number;
    avgBeatSQI: number;
    avgMorphologyScore: number;
    avgDetectorAgreement: number;
    temporalSpectralAgreement: number;
    spectralConfidence: number;
    medianRRBpm: number;
    spectralBpm: number;
    autocorrBpm: number;
  };
  roiEvidence?: {
    activeCellCount: number;
    spatialCoherence: number;
    phaseCoherence: number;
    roiReputation: number;
    backgroundCorrelation: number;
    topRoiToBackgroundPowerRatio: number;
  };
  radiometry?: {
    linearized: boolean;
    opticalDensityEnabled: boolean;
    darkFrameReady: boolean;
    whiteReferenceReady: boolean;
    redClipping: number;
    greenClipping: number;
    blueClipping: number;
    exposureLocked: boolean;
    whiteBalanceLocked: boolean;
    torchEnabled: boolean;
  };
  multichannelEvidence?: {
    channelCoherence: number;
    acDcRatioR: number;
    acDcRatioG: number;
    acDcRatioB: number;
    spectralSnrDb: number;
    autocorrelationScore: number;
  };
}

export interface LivePpgEvidenceResult {
  passed: boolean;
  score: number;
  tier: "INVALID" | "WEAK" | "PROBABLE_PPG" | "VALID_LIVE_PPG";
  reasons: string[];
  hardFail: boolean;
  metrics: Record<string, number | string | boolean>;
}

export class LivePpgEvidenceGate {
  private readonly MIN_SAMPLE_RATE = 15;
  private readonly IDEAL_SAMPLE_RATE = 30;
  private readonly MIN_PERFUSION_INDEX = 0.05;
  private readonly TARGET_PERFUSION_INDEX = 0.30;
  private readonly MIN_WINDOW_SQI = 0.30;
  private readonly TARGET_WINDOW_SQI = 0.65;
  private readonly MIN_SPECTRAL_DOMINANCE = 0.18;
  private readonly TARGET_SPECTRAL_DOMINANCE = 0.50;
  private readonly MIN_DETECTOR_AGREEMENT = 0.25;
  private readonly TARGET_DETECTOR_AGREEMENT = 0.60;
  private readonly MIN_DOMINANT_FREQ_STABILITY = 0.30;
  private readonly TARGET_DOMINANT_FREQ_STABILITY = 0.60;
  private readonly MIN_ACCEPTED_BEATS = 2;
  private readonly TARGET_ACCEPTED_BEATS = 5;
  private readonly MIN_CONSECUTIVE_PEAKS = 3;
  private readonly TARGET_CONSECUTIVE_PEAKS = 5;
  private readonly MIN_BEAT_SQI = 30;
  private readonly TARGET_BEAT_SQI = 60;
  private readonly MIN_MORPHOLOGY_SCORE = 30;
  private readonly TARGET_MORPHOLOGY_SCORE = 60;
  private readonly MIN_TEMPORAL_SPECTRAL_AGREEMENT = 0.30;
  private readonly TARGET_TEMPORAL_SPECTRAL_AGREEMENT = 0.65;
  private readonly MIN_SPECTRAL_CONFIDENCE = 0.30;
  private readonly TARGET_SPECTRAL_CONFIDENCE = 0.60;
  private readonly MIN_SPATIAL_COHERENCE = 0.30;
  private readonly TARGET_SPATIAL_COHERENCE = 0.55;
  private readonly MIN_PHASE_COHERENCE = 0.30;
  private readonly TARGET_PHASE_COHERENCE = 0.55;
  private readonly MAX_BACKGROUND_CORRELATION = 0.70;
  private readonly TARGET_BACKGROUND_CORRELATION = 0.40;
  private readonly MIN_ROI_BG_POWER_RATIO = 1.2;
  private readonly TARGET_ROI_BG_POWER_RATIO = 2.0;
  private readonly MIN_SOURCE_STABILITY = 0.30;
  private readonly TARGET_SOURCE_STABILITY = 0.65;
  private readonly TARGET_CLIP_RATIO = 0.10;
  private readonly MIN_SCORE_FOR_PASS = 0.55;
  private readonly MIN_FREQ_HZ = 0.65;
  private readonly MAX_FREQ_HZ = 3.5;
  private readonly MIN_CHANNEL_COHERENCE = 0.20;
  private readonly TARGET_CHANNEL_COHERENCE = 0.55;
  private readonly MIN_AC_DC_RATIO = 0.001;
  private readonly TARGET_AC_DC_RATIO = 0.006;
  private readonly MIN_SPECTRAL_SNR_DB = 1.5;
  private readonly TARGET_SPECTRAL_SNR_DB = 5.0;
  private readonly MIN_AUTOCORRELATION_SCORE = 0.20;
  private readonly TARGET_AUTOCORRELATION_SCORE = 0.55;

  evaluate(input: LivePpgEvidenceInput): LivePpgEvidenceResult {
    const reasons: string[] = [];
    const metrics: Record<string, number | string | boolean> = {};
    let hardFail = false;

    // === HARD FAILS — solo casos físicamente imposibles ===
    //
    // El resto de métricas degradan el SCORE pero no abortan la evaluación.
    // El usuario ve la onda en modo provisional mientras el score sube hasta
    // 0.78 (tier VALID_LIVE_PPG). Sin esto, la app se quedaba en hard-fail
    // perpetuo durante los primeros segundos sin evidencia espectral.

    // Sample rate insuficiente (cámara realmente lenta)
    if (input.sampleRate < this.MIN_SAMPLE_RATE) {
      hardFail = true;
      reasons.push(`SAMPLE_RATE_TOO_LOW: ${input.sampleRate.toFixed(1)} < ${this.MIN_SAMPLE_RATE}`);
    }
    metrics.sampleRate = input.sampleRate;

    // Clipping severo (exposición rota)
    if (input.clipHighRatio >= 0.25) {
      hardFail = true;
      reasons.push(`HIGH_CLIP_SEVERE: ${input.clipHighRatio.toFixed(3)} >= 0.25`);
    }
    if (input.clipLowRatio >= 0.25) {
      hardFail = true;
      reasons.push(`LOW_CLIP_SEVERE: ${input.clipLowRatio.toFixed(3)} >= 0.25`);
    }
    metrics.clipHighRatio = input.clipHighRatio;
    metrics.clipLowRatio = input.clipLowRatio;

    // Sin contacto explícito
    if (input.contactState === 'NO_CONTACT' || input.contactState === 'INVALID') {
      hardFail = true;
      reasons.push(`CONTACT_STATE_INVALID: ${input.contactState}`);
    }
    metrics.contactState = input.contactState ?? 'unknown';
    metrics.extendedContactState = input.extendedContactState ?? 'unknown';

    // Frecuencia dominante grotescamente fuera de banda cardíaca
    // (sólo invalida si la dominancia espectral existe; en frames tempranos
    // dominantFrequencyHz puede ser 0 mientras se acumula buffer espectral)
    if (
      input.windowSQI?.spectral?.dominantFrequencyHz !== undefined &&
      input.windowSQI.spectral.dominantFrequencyHz > 0 &&
      (input.windowSQI?.spectral?.spectralDominanceScore ?? 0) > 0.5
    ) {
      const freq = input.windowSQI.spectral.dominantFrequencyHz;
      if (freq < this.MIN_FREQ_HZ || freq > this.MAX_FREQ_HZ) {
        hardFail = true;
        reasons.push(`DOMINANT_FREQ_OUT_OF_BAND: ${freq.toFixed(2)} Hz`);
      }
    }
    metrics.dominantFrequencyHz = input.windowSQI?.spectral?.dominantFrequencyHz ?? 0;

    // Coherencia multicanal extremadamente baja (canales descorrelacionados = ruido puro)
    if (
      input.multichannelEvidence?.channelCoherence !== undefined &&
      input.multichannelEvidence.channelCoherence > 0 &&
      input.multichannelEvidence.channelCoherence < 0.18
    ) {
      hardFail = true;
      reasons.push(`CHANNEL_COHERENCE_TOO_LOW: ${input.multichannelEvidence.channelCoherence.toFixed(3)}`);
    }

    // AC/DC esencialmente nulo en todos los canales (sin perfusión)
    if (input.multichannelEvidence) {
      const { acDcRatioR, acDcRatioG, acDcRatioB } = input.multichannelEvidence;
      const maxAcDc = Math.max(acDcRatioR, acDcRatioG, acDcRatioB);
      if (maxAcDc > 0 && maxAcDc < 0.001) {
        hardFail = true;
        reasons.push(`AC_DC_RATIO_TOO_LOW: max=${maxAcDc.toFixed(5)}`);
      }
    }

    // Métricas (sin hard-fail aún): se penalizan en el score, no abortan.
    metrics.perfusionIndex = input.perfusionIndex;
    metrics.windowSQI = input.windowSQI?.score ?? 0;
    metrics.windowGating = input.windowSQI?.gating ?? 'none';
    metrics.spectralDominance = input.windowSQI?.spectral?.spectralDominanceScore ?? 0;
    metrics.detectorAgreement = input.windowSQI?.spectral?.detectorAgreementScore ?? 0;
    metrics.acceptedBeats = input.beatDebug?.acceptedBeats ?? 0;
    metrics.backgroundCorrelation = input.roiEvidence?.backgroundCorrelation ?? 0;
    metrics.roiBgPowerRatio = input.roiEvidence?.topRoiToBackgroundPowerRatio ?? 0;
    metrics.sourceStability = input.sourceStability;
    metrics.motionArtifact = input.motionArtifact;
    metrics.channelCoherence = input.multichannelEvidence?.channelCoherence ?? 0;
    metrics.acDcRatioR = input.multichannelEvidence?.acDcRatioR ?? 0;
    metrics.acDcRatioG = input.multichannelEvidence?.acDcRatioG ?? 0;
    metrics.acDcRatioB = input.multichannelEvidence?.acDcRatioB ?? 0;
    metrics.spectralSnrDb = input.multichannelEvidence?.spectralSnrDb ?? 0;
    metrics.autocorrelationScore = input.multichannelEvidence?.autocorrelationScore ?? 0;

    // Si hay hard fail, retornar inmediatamente
    if (hardFail) {
      return {
        passed: false,
        score: 0,
        tier: "INVALID",
        reasons,
        hardFail: true,
        metrics
      };
    }

    // === CÁLCULO DE SCORE NORMALIZADO ===
    
    const normalizedWindowSQI = this.normalize(
      input.windowSQI?.score ?? 0,
      this.MIN_WINDOW_SQI,
      this.TARGET_WINDOW_SQI
    );
    
    const normalizedSpectralDominance = this.normalize(
      input.windowSQI?.spectral?.spectralDominanceScore ?? 0,
      this.MIN_SPECTRAL_DOMINANCE,
      this.TARGET_SPECTRAL_DOMINANCE
    );
    
    const normalizedDetectorAgreement = this.normalize(
      input.windowSQI?.spectral?.detectorAgreementScore ?? 0,
      this.MIN_DETECTOR_AGREEMENT,
      this.TARGET_DETECTOR_AGREEMENT
    );
    
    const normalizedFreqStability = this.normalize(
      input.windowSQI?.spectral?.dominantFrequencyStability ?? 0,
      this.MIN_DOMINANT_FREQ_STABILITY,
      this.TARGET_DOMINANT_FREQ_STABILITY
    );
    
    const normalizedTemporalSpectralAgreement = this.normalize(
      input.beatDebug?.temporalSpectralAgreement ?? 0,
      this.MIN_TEMPORAL_SPECTRAL_AGREEMENT,
      this.TARGET_TEMPORAL_SPECTRAL_AGREEMENT
    );
    
    const normalizedBeatSQI = this.normalize(
      input.beatDebug?.avgBeatSQI ?? 0,
      this.MIN_BEAT_SQI,
      this.TARGET_BEAT_SQI
    );
    
    const normalizedMorphologyScore = this.normalize(
      input.beatDebug?.avgMorphologyScore ?? 0,
      this.MIN_MORPHOLOGY_SCORE,
      this.TARGET_MORPHOLOGY_SCORE
    );
    
    const normalizedSpatialCoherence = this.normalize(
      input.roiEvidence?.spatialCoherence ?? 0,
      this.MIN_SPATIAL_COHERENCE,
      this.TARGET_SPATIAL_COHERENCE
    );
    
    const normalizedPhaseCoherence = this.normalize(
      input.roiEvidence?.phaseCoherence ?? 0,
      this.MIN_PHASE_COHERENCE,
      this.TARGET_PHASE_COHERENCE
    );

    const normalizedChannelCoherence = this.normalize(
      input.multichannelEvidence?.channelCoherence ?? 0,
      this.MIN_CHANNEL_COHERENCE,
      this.TARGET_CHANNEL_COHERENCE
    );

    const normalizedAcDcRatio = this.normalize(
      Math.max(
        input.multichannelEvidence?.acDcRatioR ?? 0,
        input.multichannelEvidence?.acDcRatioG ?? 0,
        input.multichannelEvidence?.acDcRatioB ?? 0
      ),
      this.MIN_AC_DC_RATIO,
      this.TARGET_AC_DC_RATIO
    );

    const normalizedSpectralSnr = this.normalize(
      input.multichannelEvidence?.spectralSnrDb ?? 0,
      this.MIN_SPECTRAL_SNR_DB,
      this.TARGET_SPECTRAL_SNR_DB
    );

    const normalizedAutocorrelation = this.normalize(
      input.multichannelEvidence?.autocorrelationScore ?? 0,
      this.MIN_AUTOCORRELATION_SCORE,
      this.TARGET_AUTOCORRELATION_SCORE
    );

    // Score ponderado según especificación (actualizado con multicanal)
    const score =
      0.14 * normalizedWindowSQI +
      0.11 * normalizedSpectralDominance +
      0.11 * normalizedDetectorAgreement +
      0.10 * normalizedFreqStability +
      0.10 * normalizedTemporalSpectralAgreement +
      0.08 * normalizedBeatSQI +
      0.07 * normalizedMorphologyScore +
      0.06 * normalizedSpatialCoherence +
      0.04 * normalizedPhaseCoherence +
      0.09 * normalizedChannelCoherence +
      0.06 * normalizedAcDcRatio +
      0.04 * normalizedSpectralSnr;

    metrics.score = score;
    metrics.normalizedWindowSQI = normalizedWindowSQI;
    metrics.normalizedSpectralDominance = normalizedSpectralDominance;
    metrics.normalizedDetectorAgreement = normalizedDetectorAgreement;
    metrics.normalizedFreqStability = normalizedFreqStability;
    metrics.normalizedTemporalSpectralAgreement = normalizedTemporalSpectralAgreement;
    metrics.normalizedBeatSQI = normalizedBeatSQI;
    metrics.normalizedMorphologyScore = normalizedMorphologyScore;
    metrics.normalizedSpatialCoherence = normalizedSpatialCoherence;
    metrics.normalizedPhaseCoherence = normalizedPhaseCoherence;
    metrics.normalizedChannelCoherence = normalizedChannelCoherence;
    metrics.normalizedAcDcRatio = normalizedAcDcRatio;
    metrics.normalizedSpectralSnr = normalizedSpectralSnr;
    metrics.normalizedAutocorrelation = normalizedAutocorrelation;

    // === DETERMINACIÓN DE TIER ===

    let tier: "INVALID" | "WEAK" | "PROBABLE_PPG" | "VALID_LIVE_PPG";

    if (score < 0.30) {
      tier = "INVALID";
      reasons.push(`SCORE_TOO_LOW: ${score.toFixed(3)} < 0.30`);
    } else if (score < 0.45) {
      tier = "WEAK";
      reasons.push(`EVIDENCE_WEAK: ${score.toFixed(3)}`);
    } else if (score < this.MIN_SCORE_FOR_PASS) {
      tier = "PROBABLE_PPG";
      reasons.push(`EVIDENCE_PROBABLE: ${score.toFixed(3)}`);
    } else {
      tier = "VALID_LIVE_PPG";
    }

    // Promoción por evidencia temporal robusta:
    // si hay beats reales aceptados con BPM coherente entre detectores temporales
    // y espectrales, validamos aunque algunas métricas espectrales/ROI estén
    // todavía consolidándose.
    if (tier !== "VALID_LIVE_PPG" && input.beatDebug) {
      const bd = input.beatDebug;
      const tempoBpm = bd.medianRRBpm > 0 ? bd.medianRRBpm : bd.autocorrBpm;
      const bpmCoherent =
        tempoBpm > 38 &&
        tempoBpm < 200 &&
        (bd.spectralBpm <= 0 || Math.abs(bd.spectralBpm - tempoBpm) / Math.max(1, tempoBpm) < 0.20);
      if (
        bd.acceptedBeats >= this.TARGET_ACCEPTED_BEATS &&
        bd.consecutivePeaks >= this.MIN_CONSECUTIVE_PEAKS &&
        bd.avgBeatSQI >= this.MIN_BEAT_SQI &&
        bpmCoherent
      ) {
        tier = "VALID_LIVE_PPG";
        reasons.push(`PROMOTED_BY_BEAT_EVIDENCE: beats=${bd.acceptedBeats} bpm=${tempoBpm.toFixed(0)}`);
      }
    }

    // === RESULTADO FINAL ===

    const passed = tier === "VALID_LIVE_PPG";
    
    if (!passed && !hardFail) {
      if (reasons.length === 0) {
        reasons.push(`SCORE_BELOW_THRESHOLD: ${score.toFixed(3)} < ${this.MIN_SCORE_FOR_PASS}`);
      }
    }

    return {
      passed,
      score,
      tier,
      reasons,
      hardFail,
      metrics
    };
  }

  private normalize(value: number, min: number, target: number): number {
    if (value < min) return 0;
    if (value >= target) return 1;
    return (value - min) / (target - min);
  }

  /**
   * Invalida la medición actual cuando se pierde evidencia PPG
   */
  static invalidateCurrentMeasurement(reason: string, details: string[]): {
    bpm: number;
    spo2: number;
    pressure: { systolic: number; diastolic: number };
    glucose: number;
    lipids: { totalCholesterol: number; triglycerides: number };
    arrhythmiaStatus: string;
    waveform: 'flat';
    confidence: 'INVALID';
  } {
    return {
      bpm: 0,
      spo2: 0,
      pressure: { systolic: 0, diastolic: 0 },
      glucose: 0,
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      arrhythmiaStatus: "NO_VALID_PPG|0",
      waveform: 'flat',
      confidence: 'INVALID'
    };
  }
}

// Singleton instance
export const livePpgEvidenceGate = new LivePpgEvidenceGate();
