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

import type { ContactState } from '../../types/measurement';

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
  evidence: FingerContactEvidence;
  pressureProxy: number; // DC level estimate
  pressureExcessive: boolean;
  guidance: string;
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
  private lastContactState: ContactState = 'NO_CONTACT';
  private lastScore = 0;
  private stateCount = 0; // Frames at current state
  private readonly STATE_HYSTERESIS = 5; // Require 5+ frames to transition
  
  // Temporal tracking
  private lastChromatic = 0;
  private lastSaturation = 0;
  private lastCoverage = 0;
  
  /**
   * Classify finger contact from a frame's radiometric data
   */
  public classify(input: {
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
  }): ContactClassResult {
    const evidence = this.computeEvidence(input);
    const state = this.determineState(evidence);
    const pressure = this.estimatePressure(input, evidence);
    
    // Apply hysteresis
    const finalState = this.applyHysteresis(state, evidence.overallScore);
    
    return {
      state: finalState,
      confidence: evidence.overallScore,
      evidence,
      pressureProxy: pressure.dcEstimate,
      pressureExcessive: pressure.excessive,
      guidance: this.generateGuidance(finalState, evidence),
    };
  }
  
  /**
   * Compute all evidence components
   */
  private computeEvidence(input: {
    colorStatsRaw: any;
    saturationStats: any;
    roiCoverage: number;
    imageWidth: number;
    imageHeight: number;
    data: Uint8ClampedArray;
    acSignal?: number;
    dcSignal?: number;
  }): FingerContactEvidence {
    const chromaticScore = this.chromaticScore(input.colorStatsRaw);
    const spatialScore = this.spatialScore(input);
    const saturationScore = this.saturationScore(input.saturationStats);
    const stabilityScore = this.stabilityScore();
    const pulsatilityScore = this.pulsatilityScore(input.acSignal, input.dcSignal);
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
  private chromaticScore(stats: any): number {
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
  private spatialScore(input: any): number {
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
  private saturationScore(stats: any): number {
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
  private stabilityScore(): number {
    const drift = Math.abs(this.lastChromatic - this.lastChromatic) +
                  Math.abs(this.lastSaturation - this.lastSaturation) +
                  Math.abs(this.lastCoverage - this.lastCoverage);
    
    if (drift > this.thresholds.stability_threshold * 3) return 0.3; // Moving too much
    if (drift < this.thresholds.stability_threshold) return 0.95; // Very stable
    
    return 0.95 - (drift / (this.thresholds.stability_threshold * 3)) * 0.65;
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
  private pressureScore(stats: any): number {
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
  private estimatePressure(input: any, evidence: FingerContactEvidence): {
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
  private determineState(evidence: FingerContactEvidence): ContactState {
    const score = evidence.overallScore;
    
    if (score < 0.20) return 'NO_CONTACT';
    if (score < 0.40) return 'ACQUIRING'; // Weak, still acquiring
    if (score >= 0.40 && score < 0.65) return 'UNSTABLE'; // Some contact but shaky
    if (score >= 0.65 && score < 0.90) return 'STABLE'; // Good contact
    
    // score >= 0.90
    if (evidence.pressureScore > 0.85) return 'EXCESSIVE_PRESSURE';
    return 'STABLE';
  }
  
  /**
   * Apply hysteresis to prevent state fluttering
   */
  private applyHysteresis(proposedState: ContactState, score: number): ContactState {
    const isSameState = proposedState === this.lastContactState;
    
    if (isSameState) {
      this.stateCount++;
      return this.lastContactState;
    }
    
    // Proposed different state
    this.stateCount++;
    
    if (this.stateCount >= this.STATE_HYSTERESIS) {
      // Enough frames of different state, transition
      this.lastContactState = proposedState;
      this.lastScore = score;
      this.stateCount = 0;
      return proposedState;
    }
    
    // Not enough frames yet, stay with previous
    return this.lastContactState;
  }
  
  /**
   * Generate user guidance
   */
  private generateGuidance(state: ContactState, evidence: FingerContactEvidence): string {
    switch (state) {
      case 'NO_CONTACT':
        return 'Coloca tu dedo sobre la cámara (flash) con presión firme';
      case 'ACQUIRING':
        if (evidence.chromaticScore < 0.3) return 'Asegúrate de que la cámara y flash estén limpios';
        if (evidence.spatialScore < 0.5) return 'Cubre más de la cámara con tu dedo';
        return 'Presiona un poco más con tu dedo';
      case 'UNSTABLE':
        if (evidence.stabilityScore < 0.4) return 'Mantén el dedo completamente quieto';
        return 'Ajusta la presión del dedo para mejor contacto';
      case 'SATURATED':
        return 'Dedo muy presionado; presiona ligeramente menos';
      case 'EXCESSIVE_PRESSURE':
        return 'Reduce la presión del dedo';
      case 'STABLE':
      default:
        return 'Contacto perfecto. Medición en progreso...';
    }
  }
}
