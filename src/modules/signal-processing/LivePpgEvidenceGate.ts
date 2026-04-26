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
  private readonly MIN_PERFUSION_INDEX = 0.20;
  private readonly TARGET_PERFUSION_INDEX = 0.35;
  private readonly MIN_WINDOW_SQI = 0.55;
  private readonly TARGET_WINDOW_SQI = 0.72;
  private readonly MIN_SPECTRAL_DOMINANCE = 0.35;
  private readonly TARGET_SPECTRAL_DOMINANCE = 0.55;
  private readonly MIN_DETECTOR_AGREEMENT = 0.45;
  private readonly TARGET_DETECTOR_AGREEMENT = 0.65;
  private readonly MIN_DOMINANT_FREQ_STABILITY = 0.50;
  private readonly TARGET_DOMINANT_FREQ_STABILITY = 0.65;
  private readonly MIN_SPECTRAL_ENTROPY_PENALTY = 0.55;
  private readonly TARGET_SPECTRAL_ENTROPY_PENALTY = 0.45;
  private readonly MIN_ACCEPTED_BEATS = 4;
  private readonly TARGET_ACCEPTED_BEATS = 6;
  private readonly MIN_CONSECUTIVE_PEAKS = 4;
  private readonly TARGET_CONSECUTIVE_PEAKS = 6;
  private readonly MIN_BEAT_SQI = 55;
  private readonly TARGET_BEAT_SQI = 65;
  private readonly MIN_MORPHOLOGY_SCORE = 55;
  private readonly TARGET_MORPHOLOGY_SCORE = 65;
  private readonly MIN_TEMPORAL_SPECTRAL_AGREEMENT = 0.55;
  private readonly TARGET_TEMPORAL_SPECTRAL_AGREEMENT = 0.70;
  private readonly MIN_SPECTRAL_CONFIDENCE = 0.55;
  private readonly TARGET_SPECTRAL_CONFIDENCE = 0.70;
  private readonly MIN_SPATIAL_COHERENCE = 0.40;
  private readonly TARGET_SPATIAL_COHERENCE = 0.55;
  private readonly MIN_PHASE_COHERENCE = 0.40;
  private readonly TARGET_PHASE_COHERENCE = 0.55;
  private readonly MAX_BACKGROUND_CORRELATION = 0.60;
  private readonly TARGET_BACKGROUND_CORRELATION = 0.35;
  private readonly MIN_ROI_BG_POWER_RATIO = 1.5;
  private readonly TARGET_ROI_BG_POWER_RATIO = 2.5;
  private readonly MIN_SOURCE_STABILITY = 0.60;
  private readonly TARGET_SOURCE_STABILITY = 0.75;
  private readonly MAX_CLIP_RATIO = 0.15;
  private readonly TARGET_CLIP_RATIO = 0.08;
  private readonly MIN_SCORE_FOR_PASS = 0.78;
  private readonly MIN_FREQ_HZ = 0.65;
  private readonly MAX_FREQ_HZ = 3.5;

  evaluate(input: LivePpgEvidenceInput): LivePpgEvidenceResult {
    const reasons: string[] = [];
    const metrics: Record<string, number | string | boolean> = {};
    let hardFail = false;

    // === HARD FAILS (rechenazo inmediato) ===
    
    // 1. Sample rate insuficiente
    if (input.sampleRate < this.MIN_SAMPLE_RATE) {
      hardFail = true;
      reasons.push(`SAMPLE_RATE_TOO_LOW: ${input.sampleRate.toFixed(1)} < ${this.MIN_SAMPLE_RATE}`);
    }
    metrics.sampleRate = input.sampleRate;

    // 2. Clipping severo
    if (input.clipHighRatio >= this.MAX_CLIP_RATIO) {
      hardFail = true;
      reasons.push(`HIGH_CLIP_SEVERE: ${input.clipHighRatio.toFixed(3)} >= ${this.MAX_CLIP_RATIO}`);
    }
    if (input.clipLowRatio >= this.MAX_CLIP_RATIO) {
      hardFail = true;
      reasons.push(`LOW_CLIP_SEVERE: ${input.clipLowRatio.toFixed(3)} >= ${this.MAX_CLIP_RATIO}`);
    }
    metrics.clipHighRatio = input.clipHighRatio;
    metrics.clipLowRatio = input.clipLowRatio;

    // 3. Perfusion index casi nulo
    if (input.perfusionIndex < this.MIN_PERFUSION_INDEX) {
      hardFail = true;
      reasons.push(`PERFUSION_TOO_LOW: ${input.perfusionIndex.toFixed(3)} < ${this.MIN_PERFUSION_INDEX}`);
    }
    metrics.perfusionIndex = input.perfusionIndex;

    // 4. Window SQI muy bajo
    if (input.windowSQI && input.windowSQI.score < this.MIN_WINDOW_SQI) {
      hardFail = true;
      reasons.push(`WINDOW_SQI_TOO_LOW: ${input.windowSQI.score.toFixed(3)} < ${this.MIN_WINDOW_SQI}`);
    }
    metrics.windowSQI = input.windowSQI?.score ?? 0;
    metrics.windowGating = input.windowSQI?.gating ?? 'none';

    // 5. Espectral dominancia muy baja
    if (input.windowSQI?.spectral?.spectralDominanceScore !== undefined &&
        input.windowSQI.spectral.spectralDominanceScore < this.MIN_SPECTRAL_DOMINANCE) {
      hardFail = true;
      reasons.push(`SPECTRAL_DOMINANCE_TOO_LOW: ${input.windowSQI.spectral.spectralDominanceScore.toFixed(3)} < ${this.MIN_SPECTRAL_DOMINANCE}`);
    }
    metrics.spectralDominance = input.windowSQI?.spectral?.spectralDominanceScore ?? 0;

    // 6. Detector agreement muy bajo
    if (input.windowSQI?.spectral?.detectorAgreementScore !== undefined &&
        input.windowSQI.spectral.detectorAgreementScore < this.MIN_DETECTOR_AGREEMENT) {
      hardFail = true;
      reasons.push(`DETECTOR_AGREEMENT_TOO_LOW: ${input.windowSQI.spectral.detectorAgreementScore.toFixed(3)} < ${this.MIN_DETECTOR_AGREEMENT}`);
    }
    metrics.detectorAgreement = input.windowSQI?.spectral?.detectorAgreementScore ?? 0;

    // 7. Beats insuficientes
    if (input.beatDebug && input.beatDebug.acceptedBeats < this.MIN_ACCEPTED_BEATS) {
      hardFail = true;
      reasons.push(`ACCEPTED_BEATS_TOO_LOW: ${input.beatDebug.acceptedBeats} < ${this.MIN_ACCEPTED_BEATS}`);
    }
    metrics.acceptedBeats = input.beatDebug?.acceptedBeats ?? 0;

    // 8. Background correlation alto (señal global, no localizada)
    if (input.roiEvidence && input.roiEvidence.backgroundCorrelation > this.MAX_BACKGROUND_CORRELATION) {
      hardFail = true;
      reasons.push(`BACKGROUND_CORRELATION_TOO_HIGH: ${input.roiEvidence.backgroundCorrelation.toFixed(3)} > ${this.MAX_BACKGROUND_CORRELATION}`);
    }
    metrics.backgroundCorrelation = input.roiEvidence?.backgroundCorrelation ?? 0;

    // 9. ROI-to-background power ratio bajo (sin diferenciación espacial)
    if (input.roiEvidence && input.roiEvidence.topRoiToBackgroundPowerRatio < this.MIN_ROI_BG_POWER_RATIO) {
      hardFail = true;
      reasons.push(`ROI_BG_POWER_RATIO_TOO_LOW: ${input.roiEvidence.topRoiToBackgroundPowerRatio.toFixed(3)} < ${this.MIN_ROI_BG_POWER_RATIO}`);
    }
    metrics.roiBgPowerRatio = input.roiEvidence?.topRoiToBackgroundPowerRatio ?? 0;

    // 10. Source stability bajo
    if (input.sourceStability < this.MIN_SOURCE_STABILITY) {
      hardFail = true;
      reasons.push(`SOURCE_STABILITY_TOO_LOW: ${input.sourceStability.toFixed(3)} < ${this.MIN_SOURCE_STABILITY}`);
    }
    metrics.sourceStability = input.sourceStability;

    // 11. Contact state inválido
    if (input.contactState === 'NO_CONTACT' || input.contactState === 'INVALID') {
      hardFail = true;
      reasons.push(`CONTACT_STATE_INVALID: ${input.contactState}`);
    }
    metrics.contactState = input.contactState ?? 'unknown';

    // 12. Extended contact state no listo
    if (input.extendedContactState && input.extendedContactState !== 'MEASUREMENT_READY') {
      hardFail = true;
      reasons.push(`EXTENDED_CONTACT_NOT_READY: ${input.extendedContactState}`);
    }
    metrics.extendedContactState = input.extendedContactState ?? 'unknown';

    // 13. Motion artifact alto
    if (input.motionArtifact > 0.5) {
      hardFail = true;
      reasons.push(`MOTION_ARTIFACT_HIGH: ${input.motionArtifact.toFixed(3)}`);
    }
    metrics.motionArtifact = input.motionArtifact;

    // 14. Frecuencia dominante fuera de banda cardíaca
    if (input.windowSQI?.spectral?.dominantFrequencyHz !== undefined) {
      const freq = input.windowSQI.spectral.dominantFrequencyHz;
      if (freq < this.MIN_FREQ_HZ || freq > this.MAX_FREQ_HZ) {
        hardFail = true;
        reasons.push(`DOMINANT_FREQ_OUT_OF_BAND: ${freq.toFixed(2)} Hz (${this.MIN_FREQ_HZ}-${this.MAX_FREQ_HZ} Hz expected)`);
      }
    }
    metrics.dominantFrequencyHz = input.windowSQI?.spectral?.dominantFrequencyHz ?? 0;

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

    // Score ponderado según especificación
    const score =
      0.18 * normalizedWindowSQI +
      0.14 * normalizedSpectralDominance +
      0.14 * normalizedDetectorAgreement +
      0.12 * normalizedFreqStability +
      0.12 * normalizedTemporalSpectralAgreement +
      0.10 * normalizedBeatSQI +
      0.08 * normalizedMorphologyScore +
      0.07 * normalizedSpatialCoherence +
      0.05 * normalizedPhaseCoherence;

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

    // === DETERMINACIÓN DE TIER ===
    
    let tier: "INVALID" | "WEAK" | "PROBABLE_PPG" | "VALID_LIVE_PPG";
    
    if (score < 0.45) {
      tier = "INVALID";
      reasons.push(`SCORE_TOO_LOW: ${score.toFixed(3)} < 0.45`);
    } else if (score < 0.60) {
      tier = "WEAK";
      reasons.push(`EVIDENCE_WEAK: ${score.toFixed(3)} (WEAK)`);
    } else if (score < this.MIN_SCORE_FOR_PASS) {
      tier = "PROBABLE_PPG";
      reasons.push(`EVIDENCE_PROBABLE: ${score.toFixed(3)} (PROBABLE_PPG)`);
    } else {
      tier = "VALID_LIVE_PPG";
    }

    // === VERIFICACIONES ADICIONALES PARA VALID_LIVE_PPG ===
    
    if (tier === "VALID_LIVE_PPG") {
      // Verificar gating de window SQI
      if (input.windowSQI && input.windowSQI.gating !== 'accept_high_confidence') {
        tier = "PROBABLE_PPG";
        reasons.push(`WINDOW_GATING_NOT_HIGH_CONFIDENCE: ${input.windowSQI.gating}`);
      }
      
      // Verificar beats consecutivos
      if (input.beatDebug && input.beatDebug.consecutivePeaks < this.TARGET_CONSECUTIVE_PEAKS) {
        tier = "PROBABLE_PPG";
        reasons.push(`CONSECUTIVE_PEAKS_BELOW_TARGET: ${input.beatDebug.consecutivePeaks} < ${this.TARGET_CONSECUTIVE_PEAKS}`);
      }
      
      // Verificar spectral confidence
      if (input.beatDebug && input.beatDebug.spectralConfidence < this.TARGET_SPECTRAL_CONFIDENCE) {
        tier = "PROBABLE_PPG";
        reasons.push(`SPECTRAL_CONFIDENCE_BELOW_TARGET: ${input.beatDebug.spectralConfidence.toFixed(3)} < ${this.TARGET_SPECTRAL_CONFIDENCE}`);
      }
      
      // Verificar background correlation
      if (input.roiEvidence && input.roiEvidence.backgroundCorrelation > this.TARGET_BACKGROUND_CORRELATION) {
        tier = "PROBABLE_PPG";
        reasons.push(`BACKGROUND_CORRELATION_ABOVE_TARGET: ${input.roiEvidence.backgroundCorrelation.toFixed(3)} > ${this.TARGET_BACKGROUND_CORRELATION}`);
      }
    }

    // === RESULTADO FINAL ===
    
    const passed = tier === "VALID_LIVE_PPG" && score >= this.MIN_SCORE_FOR_PASS;
    
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
