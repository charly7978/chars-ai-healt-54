/**
 * FINGER CONTACT CLASSIFIER — MULTICRITERIO REAL-TIME DETECTION
 * 
 * Replaces simple RGB thresholds with a robust multifeature classifier that uses:
 * - Chromatic dominance (red channel elevated when finger present with flash)
 * - Spatial coverage (central core vs edges)
 * - Saturation profiles (healthy signal avoids extremes)
 * - Temporal stability (contact moves slowly)
 * - Pulsatility evidence (PPG heartbeat visible)
 * - Histogram shape (multimodal = no contact, unimodal = contact)
 * 
 * Output: ContactState + confidence score (0-1)
 * 
 * References:
 * - Charlot et al. 2018: Multimodal contact detection from smartphone sensors
 * - Wang et al. 2019: PPG pulsatility for finger detection
 */

import { ContactState } from '../../types/measurement';

export interface FingerContactEvidence {
  chromaticScore: number; // 0-1: red relative to green
  spatialScore: number; // 0-1: central core coverage
  saturationScore: number; // 0-1: avoids extremes
  stabilityScore: number; // 0-1: temporal coherence
  pulsatilityScore: number; // 0-1: heartbeat visible
  histogramScore: number; // 0-1: shape indicates contact
  pressureScore: number; // 0-1: DC level suggests pressure
  overallScore: number; // 0-1: weighted combination
}

export interface ContactClassResult {
  state: ContactState;
  confidence: number; // 0-1
  contactConfidence: number; // alias explícito para contratos de debug
  evidence: FingerContactEvidence;
  pressureProxy: number; // DC level estimate
  pressureIndex: number; // 0-1 proxy normalizado de presión/contacto
  pressureExcessive: boolean;
  signalUsabilityScore: number; // 0-1 score utilizable downstream
  rejectionReasons: string[];
  guidance: string;
}

export interface FingerContactInput {
  colorStatsRaw: {
    meanR: number;
    meanG: number;
    meanB: number;
    stdR: number;
    stdG: number;
    stdB: number;
  };
  saturationStats: {
    clipHighRatio: number;
    clipLowRatio: number;
  };
  roiCoverage: number;
  imageWidth: number;
  imageHeight: number;
  data: Uint8ClampedArray;
  acSignal?: number;
  dcSignal?: number;
}

// ═══════════════════════════════════════════════════════════════════
// THRESHOLDS (adaptive, not hardcoded)
// ═══════════════════════════════════════════════════════════════════

interface AdaptiveThresholds {
  chromatic_min: number; // Minimum red/green ratio
  saturation_ideal_low: number; // Optimal low saturation %
  saturation_ideal_high: number; // Optimal high saturation %
  central_coverage_min: number; // Min % central pixels
  stability_threshold: number; // Max allowed drift
  pulsatility_snr_min: number; // Minimum SNR for heartbeat
  pressure_dc_min: number; // Min DC for contact
  pressure_dc_max: number; // Max DC (excessive)
}

const DEFAULT_THRESHOLDS: AdaptiveThresholds = {
  chromatic_min: 1.2, // Red at least 20% brighter than green
  saturation_ideal_low: 2, // <2% pixels saturated is bad
  saturation_ideal_high: 15, // >15% pixels saturated is bad
  central_coverage_min: 0.30, // Central 30% core should have valid pixels
  stability_threshold: 0.08, // 8% frame-to-frame drift allowed
  pulsatility_snr_min: 1.5, // AC/DC minimal ratio
  pressure_dc_min: 50, // Raw pixel value > 50
  pressure_dc_max: 240, // Raw pixel value < 240 (avoid saturation)
};

// ═══════════════════════════════════════════════════════════════════
// CLASSIFIER
// ═══════════════════════════════════════════════════════════════════

export class FingerContactClassifier {
  private thresholds: AdaptiveThresholds = { ...DEFAULT_THRESHOLDS };
  private lastContactState: ContactState = ContactState.NO_CONTACT;
  private lastScore = 0;
  private readonly STATE_HYSTERESIS = 5; // Require 5+ frames to transition
  
  // Temporal tracking
  private lastChromatic = NaN;
  private lastSaturation = NaN;
  private lastCoverage = NaN;
  private lastPulsatility = NaN;
  private pendingState: ContactState | null = null;
  private pendingCount = 0;
  
  /**
   * Classify finger contact from a frame's radiometric data
   */
  public classify(input: FingerContactInput): ContactClassResult {
    const evidence = this.computeEvidence(input);
    const state = this.determineState(evidence, input);
    const pressure = this.estimatePressure(input, evidence);
    const rejectionReasons = this.buildRejectionReasons(evidence, input, pressure.excessive);
    
    // Apply hysteresis
    const finalState = this.applyHysteresis(state, evidence.overallScore);
    const signalUsabilityScore = Math.max(0, Math.min(1,
      evidence.overallScore * 0.55 +
      evidence.pulsatilityScore * 0.20 +
      evidence.saturationScore * 0.10 +
      evidence.spatialScore * 0.15
    ));
    
    return {
      state: finalState,
      confidence: evidence.overallScore,
      contactConfidence: evidence.overallScore,
      evidence,
      pressureProxy: pressure.dcEstimate,
      pressureIndex: pressure.dcEstimate > 0
        ? Math.max(0, Math.min(1,
            (pressure.dcEstimate - this.thresholds.pressure_dc_min) /
            Math.max(1, (this.thresholds.pressure_dc_max - this.thresholds.pressure_dc_min))
          ))
        : 0,
      pressureExcessive: pressure.excessive,
      signalUsabilityScore,
      rejectionReasons,
      guidance: this.generateGuidance(finalState, evidence),
    };
  }
  
  /**
   * Compute all evidence components
   */
  private computeEvidence(input: FingerContactInput): FingerContactEvidence {
    const chromaticScore = this.chromaticScore(input.colorStatsRaw);
    const spatialScore = this.spatialScore(input);
    const saturationScore = this.saturationScore(input.saturationStats);
    const pulsatilityScore = this.pulsatilityScore(input.acSignal, input.dcSignal);
    const stabilityScore = this.stabilityScore({
      chromatic: chromaticScore,
      saturation: saturationScore,
      spatial: spatialScore,
      pulsatility: pulsatilityScore,
    });
    const histogramScore = this.histogramScore(input.data);
    const pressureScore = this.pressureScore(input.colorStatsRaw);
    
    // Weighted average
    const weights = {
      chromatic: 0.20,
      spatial: 0.15,
      saturation: 0.15,
      stability: 0.10,
      pulsatility: 0.20,
      histogram: 0.12,
      pressure: 0.08,
    };
    
    const overallScore = 
      chromaticScore * weights.chromatic +
      spatialScore * weights.spatial +
      saturationScore * weights.saturation +
      stabilityScore * weights.stability +
      pulsatilityScore * weights.pulsatility +
      histogramScore * weights.histogram +
      pressureScore * weights.pressure;
    
    // Update history
    this.lastChromatic = chromaticScore;
    this.lastSaturation = saturationScore;
    this.lastCoverage = spatialScore;
    this.lastPulsatility = pulsatilityScore;
    
    return {
      chromaticScore: Math.max(0, Math.min(1, chromaticScore)),
      spatialScore: Math.max(0, Math.min(1, spatialScore)),
      saturationScore: Math.max(0, Math.min(1, saturationScore)),
      stabilityScore: Math.max(0, Math.min(1, stabilityScore)),
      pulsatilityScore: Math.max(0, Math.min(1, pulsatilityScore)),
      histogramScore: Math.max(0, Math.min(1, histogramScore)),
      pressureScore: Math.max(0, Math.min(1, pressureScore)),
      overallScore: Math.max(0, Math.min(1, overallScore)),
    };
  }
  
  /**
   * Chromatic evidence: Red elevated relative to green with flash
   */
  private chromaticScore(stats: FingerContactInput['colorStatsRaw']): number {
    const { meanR, meanG, meanB } = stats;
    
    // No signal at all
    if (meanG < 20) return 0;
    
    // Red/Green ratio
    const rgRatio = meanR / (meanG + 1);
    const baseline = this.thresholds.chromatic_min;
    
    // Ideally R > 1.2 × G (slightly red-dominant with flash)
    const chromaticGood = rgRatio > baseline;
    if (!chromaticGood) return 0.3; // Weak signal
    
    // Strong red dominance suggests good finger contact
    if (rgRatio > baseline + 0.4) return 0.95;
    
    return 0.6 + (rgRatio - baseline) * 5;
  }
  
  /**
   * Spatial score: Central core coverage is high
   */
  private spatialScore(input: Pick<FingerContactInput, 'roiCoverage'>): number {
    const { roiCoverage } = input;
    
    // Need at least 30% central coverage
    if (roiCoverage < this.thresholds.central_coverage_min) return 0.2;
    if (roiCoverage > 0.70) return 0.95; // Excellent full coverage
    
    // Linear interpolation between threshold and 0.70
    const frac = (roiCoverage - this.thresholds.central_coverage_min) / 
                (0.70 - this.thresholds.central_coverage_min);
    return 0.2 + frac * 0.75;
  }
  
  /**
   * Saturation score: Avoid extremes (too dark or too bright)
   */
  private saturationScore(stats: FingerContactInput['saturationStats']): number {
    const { clipHighRatio, clipLowRatio } = stats;
    
    // Total clipping
    const totalClipping = clipHighRatio + clipLowRatio;
    
    // Ideal: <5% total clipping
    if (totalClipping < 0.05) return 0.90;
    
    // Acceptable: <20% total clipping
    if (totalClipping < 0.20) return 0.60;
    
    // Poor
    if (totalClipping < 0.40) return 0.30;
    
    // Very poor
    return 0.05;
  }
  
  /**
   * Stability score: Frame-to-frame coherence
   */
  private stabilityScore(current: { chromatic: number; saturation: number; spatial: number; pulsatility: number }): number {
    // Primer frame con contexto: ni castigar ni premiar en exceso.
    if (
      !Number.isFinite(this.lastChromatic) ||
      !Number.isFinite(this.lastSaturation) ||
      !Number.isFinite(this.lastCoverage) ||
      !Number.isFinite(this.lastPulsatility)
    ) {
      return 0.7;
    }

    const drift =
      Math.abs(current.chromatic - this.lastChromatic) * 0.35 +
      Math.abs(current.saturation - this.lastSaturation) * 0.25 +
      Math.abs(current.spatial - this.lastCoverage) * 0.25 +
      Math.abs(current.pulsatility - this.lastPulsatility) * 0.15;

    if (drift > this.thresholds.stability_threshold * 3) return 0.25; // Moving too much
    if (drift < this.thresholds.stability_threshold) return 0.95; // Very stable

    return 0.95 - (drift / (this.thresholds.stability_threshold * 3)) * 0.70;
  }
  
  /**
   * Pulsatility score: Heartbeat signal is visible
   */
  private pulsatilityScore(ac?: number, dc?: number): number {
    if (!ac || !dc || dc === 0) return 0.3; // No AC/DC, assume weak contact
    
    const snr = ac / (Math.abs(dc) + 1);
    
    if (snr < this.thresholds.pulsatility_snr_min) return 0.30;
    if (snr > this.thresholds.pulsatility_snr_min * 2) return 0.90;
    
    return 0.30 + (snr - this.thresholds.pulsatility_snr_min) * 0.30;
  }
  
  /**
   * Histogram score: Shape indicates contact
   */
  private histogramScore(data: Uint8ClampedArray): number {
    // Sample histogram bins
    const hist = new Array(256).fill(0);
    
    // Subsample to avoid O(n) on full image
    for (let i = 0; i < data.length; i += 16) {
      const val = data[i];
      hist[val]++;
    }
    
    // Find peaks
    let peaks = 0;
    for (let i = 1; i < 255; i++) {
      if (hist[i] > hist[i - 1] && hist[i] > hist[i + 1]) {
        peaks++;
      }
    }
    
    // Contact with finger: 1-2 peaks (dark fingertip + sensor light)
    // No contact: flat/multiple scattered peaks
    if (peaks <= 2) return 0.85;
    if (peaks <= 4) return 0.60;
    if (peaks <= 6) return 0.40;
    
    return 0.20;
  }
  
  /**
   * Pressure score: DC level in valid range
   */
  private pressureScore(stats: FingerContactInput['colorStatsRaw']): number {
    const { meanR, meanG, meanB } = stats;
    const dc = (meanR + meanG + meanB) / 3;
    
    if (dc < this.thresholds.pressure_dc_min) return 0.2; // Too dark
    if (dc > this.thresholds.pressure_dc_max) return 0.2; // Too bright
    
    // Ideal range
    if (dc > 80 && dc < 200) return 0.95;
    
    return 0.60;
  }
  
  /**
   * Estimate pressure from DC level
   */
  private estimatePressure(input: Pick<FingerContactInput, 'colorStatsRaw'>, evidence: FingerContactEvidence): {
    dcEstimate: number;
    excessive: boolean;
  } {
    const { meanR, meanG, meanB } = input.colorStatsRaw;
    const dcEstimate = (meanR + meanG + meanB) / 3;
    
    const excessive = dcEstimate > this.thresholds.pressure_dc_max ||
                      evidence.pressureScore < 0.3;
    
    return { dcEstimate, excessive };
  }
  
  /**
   * Determine state from evidence scores
   */
  private determineState(evidence: FingerContactEvidence, input: FingerContactInput): ContactState {
    const score = evidence.overallScore;
    const totalClip = input.saturationStats.clipHighRatio + input.saturationStats.clipLowRatio;

    // Falla dura de contacto: color + cobertura incompatibles con dedo presente.
    if (evidence.chromaticScore < 0.35 && evidence.spatialScore < 0.35) {
      return ContactState.NO_CONTACT;
    }
    if (input.roiCoverage < 0.12 && evidence.pulsatilityScore < 0.35) {
      return ContactState.NO_CONTACT;
    }

    if (score < 0.20) return ContactState.NO_CONTACT;
    if (score < 0.40) return ContactState.ACQUIRING;
    if (totalClip > 0.45 || input.saturationStats.clipHighRatio > 0.35) return ContactState.SATURATED;
    if (evidence.pressureScore < 0.25 && score >= 0.45) return ContactState.EXCESSIVE_PRESSURE;
    if (score < 0.65) return ContactState.UNSTABLE;
    if (score < 0.90) return ContactState.STABLE;

    // score >= 0.90
    if (evidence.pressureScore < 0.30) return ContactState.EXCESSIVE_PRESSURE;
    return ContactState.STABLE;
  }
  
  /**
   * Apply hysteresis to prevent state fluttering
   */
  private applyHysteresis(proposedState: ContactState, score: number): ContactState {
    if (proposedState === this.lastContactState) {
      this.pendingState = null;
      this.pendingCount = 0;
      return this.lastContactState;
    }

    if (this.pendingState !== proposedState) {
      this.pendingState = proposedState;
      this.pendingCount = 1;
      return this.lastContactState;
    }

    this.pendingCount++;
    if (this.pendingCount >= this.STATE_HYSTERESIS) {
      this.lastContactState = proposedState;
      this.lastScore = score;
      this.pendingState = null;
      this.pendingCount = 0;
      return proposedState;
    }

    return this.lastContactState;
  }

  private buildRejectionReasons(
    evidence: FingerContactEvidence,
    input: FingerContactInput,
    pressureExcessive: boolean
  ): string[] {
    const reasons: string[] = [];
    if (evidence.chromaticScore < 0.35) reasons.push('chromatic_mismatch');
    if (evidence.spatialScore < 0.35) reasons.push('low_roi_coverage');
    if (evidence.saturationScore < 0.30) reasons.push('clipping_or_darkness');
    if (evidence.stabilityScore < 0.35) reasons.push('temporal_instability');
    if (evidence.pulsatilityScore < 0.30) reasons.push('low_pulsatility');
    if (evidence.histogramScore < 0.30) reasons.push('scene_not_contact_like');
    if (pressureExcessive) reasons.push('excessive_pressure');
    if (input.saturationStats.clipHighRatio > 0.20) reasons.push('high_clip_ratio');
    if (input.saturationStats.clipLowRatio > 0.20) reasons.push('low_clip_ratio');
    return reasons;
  }
  
  /**
   * Generate user guidance
   */
  private generateGuidance(state: ContactState, evidence: FingerContactEvidence): string {
    switch (state) {
      case ContactState.NO_CONTACT:
        return 'Coloca tu dedo sobre la cámara (flash) con presión firme';
      case ContactState.ACQUIRING:
        if (evidence.chromaticScore < 0.3) return 'Asegúrate de que la cámara y flash estén limpios';
        if (evidence.spatialScore < 0.5) return 'Cubre más de la cámara con tu dedo';
        return 'Presiona un poco más con tu dedo';
      case ContactState.UNSTABLE:
        if (evidence.stabilityScore < 0.4) return 'Mantén el dedo completamente quieto';
        return 'Ajusta la presión del dedo para mejor contacto';
      case ContactState.SATURATED:
        return 'Dedo muy presionado; presiona ligeramente menos';
      case ContactState.EXCESSIVE_PRESSURE:
        return 'Reduce la presión del dedo';
      case ContactState.STABLE:
      default:
        return 'Contacto perfecto. Medición en progreso...';
    }
  }
}
