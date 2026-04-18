/**
 * FRAME QUALITY GATE V2 - HONEST QUALITY ASSESSMENT
 * 
 * Provides continuous quality scoring (0-1) with explicit rejection criteria.
 * Does NOT block signal flow - only reports quality degradation.
 * 
 * Quality Dimensions:
 * - Contact quality (finger presence, pressure, coverage)
 * - Signal fidelity (SQI, perfusion, spectral metrics)
 * - Environmental (motion, illumination, clipping)
 * - Temporal consistency (stability over time)
 * 
 * Output: Quality score [0-1], rejection flags, detailed diagnostics
 */

import type { ContactState } from '../../types/signal';

// ═══════════════════════════════════════════════════════════════════
//  INPUT / OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════

export interface FrameQualityInput {
  // Contact state (from FingerContactClassifier)
  contactState: ContactState;
  contactConfidence: number;
  
  // Signal quality metrics
  globalSQI: number;
  perfusionIndex: number;
  sourceQuality: number;
  
  // Environmental factors
  clipHighRatio: number;
  clipLowRatio: number;
  motionScore: number;
  motionState: string;
  
  // Spatial metrics
  coverageRatio: number;
  spatialUniformity: number;
  centerCoverage: number;
  
  // Illumination
  brightness: number;
  
  // Extended spectral metrics (from SignalSourceRanker)
  spectralSNR?: number;
  peakProminence?: number;
  harmonicConsistency?: number;
  zeroCrossingRate?: number;
  
  // Temporal
  temporalStability?: number;
  
  // Fusion
  fusionConfidence?: number;
}

export type RejectionSeverity = 'NONE' | 'MINOR' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
export type RejectionCategory = 
  | 'CONTACT' 
  | 'SIGNAL' 
  | 'ENVIRONMENT' 
  | 'MOTION' 
  | 'ILLUMINATION';

export interface QualityFailure {
  category: RejectionCategory;
  severity: RejectionSeverity;
  metric: string;
  threshold: number;
  actual: number;
  description: string;
}

export interface FrameQualityOutput {
  // Continuous quality score (0-1, higher is better)
  qualityScore: number;
  
  // Binary pass/fail (for compatibility, but signal always flows)
  pass: boolean;
  
  // Primary rejection reason (if any)
  reason: string;
  
  // Detailed failure analysis
  failures: QualityFailure[];
  
  // Per-dimension scores
  dimensionScores: {
    contact: number;
    signal: number;
    environment: number;
    motion: number;
    illumination: number;
  };
  
  // Confidence in the quality assessment itself
  assessmentConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface QualityGateConfig {
  // Thresholds for each quality dimension (0-1)
  contactThreshold: number;
  signalThreshold: number;
  environmentThreshold: number;
  motionThreshold: number;
  illuminationThreshold: number;
  
  // Overall quality thresholds
  excellentThreshold: number;  // >= this: excellent quality
  acceptableThreshold: number; // >= this: acceptable, < this: poor
  
  // Weights for composite score
  contactWeight: number;
  signalWeight: number;
  environmentWeight: number;
  motionWeight: number;
  illuminationWeight: number;
  
  // Temporal smoothing
  temporalAlpha: number;
}

const DEFAULT_CONFIG: QualityGateConfig = {
  contactThreshold: 0.4,
  signalThreshold: 0.35,
  environmentThreshold: 0.4,
  motionThreshold: 0.5,
  illuminationThreshold: 0.3,
  
  excellentThreshold: 0.8,
  acceptableThreshold: 0.5,
  
  contactWeight: 0.25,
  signalWeight: 0.30,
  environmentWeight: 0.20,
  motionWeight: 0.15,
  illuminationWeight: 0.10,
  
  temporalAlpha: 0.2,
};

// ═══════════════════════════════════════════════════════════════════
//  QUALITY GATE CLASS
// ═══════════════════════════════════════════════════════════════════

export class FrameQualityGate {
  private config: QualityGateConfig;
  private smoothedQuality = 0.5;
  private frameCount = 0;
  private rejectionHistory: QualityFailure[] = [];
  private readonly HISTORY_SIZE = 30;

  constructor(config: Partial<QualityGateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate frame quality - returns continuous score, never blocks
   */
  evaluate(input: FrameQualityInput): FrameQualityOutput {
    this.frameCount++;
    
    // Compute per-dimension scores
    const contactScore = this.computeContactScore(input);
    const signalScore = this.computeSignalScore(input);
    const environmentScore = this.computeEnvironmentScore(input);
    const motionScore = this.computeMotionScore(input);
    const illuminationScore = this.computeIlluminationScore(input);
    
    // Detect failures
    const failures: QualityFailure[] = [];
    
    if (contactScore < this.config.contactThreshold) {
      failures.push({
        category: 'CONTACT',
        severity: this.getSeverity(contactScore, this.config.contactThreshold),
        metric: 'contactScore',
        threshold: this.config.contactThreshold,
        actual: contactScore,
        description: this.getContactFailureDescription(input),
      });
    }
    
    if (signalScore < this.config.signalThreshold) {
      failures.push({
        category: 'SIGNAL',
        severity: this.getSeverity(signalScore, this.config.signalThreshold),
        metric: 'signalScore',
        threshold: this.config.signalThreshold,
        actual: signalScore,
        description: this.getSignalFailureDescription(input),
      });
    }
    
    if (environmentScore < this.config.environmentThreshold) {
      failures.push({
        category: 'ENVIRONMENT',
        severity: this.getSeverity(environmentScore, this.config.environmentThreshold),
        metric: 'environmentScore',
        threshold: this.config.environmentThreshold,
        actual: environmentScore,
        description: this.getEnvironmentFailureDescription(input),
      });
    }
    
    if (motionScore < this.config.motionThreshold) {
      failures.push({
        category: 'MOTION',
        severity: this.getSeverity(motionScore, this.config.motionThreshold),
        metric: 'motionScore',
        threshold: this.config.motionThreshold,
        actual: motionScore,
        description: `Motion contamination: ${input.motionState}`,
      });
    }
    
    if (illuminationScore < this.config.illuminationThreshold) {
      failures.push({
        category: 'ILLUMINATION',
        severity: this.getSeverity(illuminationScore, this.config.illuminationThreshold),
        metric: 'illuminationScore',
        threshold: this.config.illuminationThreshold,
        actual: illuminationScore,
        description: this.getIlluminationFailureDescription(input),
      });
    }
    
    // Compute composite quality score (weighted average)
    const rawQuality = 
      contactScore * this.config.contactWeight +
      signalScore * this.config.signalWeight +
      environmentScore * this.config.environmentWeight +
      motionScore * this.config.motionWeight +
      illuminationScore * this.config.illuminationWeight;
    
    // Temporal smoothing
    this.smoothedQuality = this.smoothedQuality * (1 - this.config.temporalAlpha) + 
                           rawQuality * this.config.temporalAlpha;
    
    // Update rejection history
    if (failures.length > 0) {
      this.rejectionHistory.push(...failures);
      if (this.rejectionHistory.length > this.HISTORY_SIZE) {
        this.rejectionHistory = this.rejectionHistory.slice(-this.HISTORY_SIZE);
      }
    }
    
    // Determine pass/fail (for backwards compatibility)
    const pass = this.smoothedQuality >= this.config.acceptableThreshold;
    
    // Primary rejection reason (most severe failure)
    const primaryFailure = this.getMostSevereFailure(failures);
    const reason = primaryFailure?.description || 'QUALITY_OK';
    
    // Assessment confidence based on input data quality
    const assessmentConfidence = this.computeAssessmentConfidence(input);
    
    return {
      qualityScore: this.smoothedQuality,
      pass,
      reason,
      failures,
      dimensionScores: {
        contact: contactScore,
        signal: signalScore,
        environment: environmentScore,
        motion: motionScore,
        illumination: illuminationScore,
      },
      assessmentConfidence,
    };
  }

  // ═════════════════════════════════════════════════════════════════
  //  SCORING METHODS
  // ═════════════════════════════════════════════════════════════════
  
  private computeContactScore(input: FrameQualityInput): number {
    const { contactState, contactConfidence, coverageRatio, centerCoverage, spatialUniformity } = input;
    
    // Base score from contact state
    let score = 0;
    switch (contactState) {
      case 'GOOD_CONTACT':
      case 'STABLE_CONTACT':
        score = 1.0;
        break;
      case 'PARTIAL_CONTACT':
      case 'UNSTABLE_CONTACT':
        score = 0.6;
        break;
      case 'OVERPRESSURE':
      case 'EXCESSIVE_PRESSURE':
        score = 0.3;
        break;
      case 'NO_FINGER':
      case 'NO_CONTACT':
        score = 0;
        break;
      default:
        score = 0.4;
    }
    
    // Adjust by confidence and metrics
    score *= (0.5 + contactConfidence * 0.5); // 0.5-1.0 multiplier
    score *= (0.3 + coverageRatio * 0.7);     // Coverage factor
    score *= (0.5 + centerCoverage * 0.5);    // Center coverage factor
    score *= (0.5 + spatialUniformity * 0.5); // Uniformity factor
    
    return Math.min(1, Math.max(0, score));
  }
  
  private computeSignalScore(input: FrameQualityInput): number {
    const { globalSQI, perfusionIndex, sourceQuality, spectralSNR, peakProminence, harmonicConsistency } = input;
    
    // Normalize metrics to 0-1
    const sqiNorm = Math.min(1, globalSQI / 100);
    const perfusionNorm = Math.min(1, perfusionIndex * 20); // 0.05 perfusion = 1.0
    const sourceNorm = Math.min(1, sourceQuality / 100);
    const snrNorm = Math.min(1, (spectralSNR ?? 0) / 5);
    const peakNorm = Math.min(1, (peakProminence ?? 0) * 2);
    const harmonicNorm = Math.min(1, harmonicConsistency ?? 0);
    
    // Weighted combination
    return (
      sqiNorm * 0.30 +
      perfusionNorm * 0.25 +
      sourceNorm * 0.20 +
      snrNorm * 0.10 +
      peakNorm * 0.10 +
      harmonicNorm * 0.05
    );
  }
  
  private computeEnvironmentScore(input: FrameQualityInput): number {
    const { clipHighRatio, clipLowRatio, temporalStability } = input;
    
    // Clipping penalties
    const highClipPenalty = Math.min(1, clipHighRatio / 0.3); // 0.3 = full penalty
    const lowClipPenalty = Math.min(1, clipLowRatio / 0.2);   // 0.2 = full penalty
    
    // Temporal stability bonus
    const stabilityBonus = temporalStability ?? 0.5;
    
    return Math.max(0, Math.min(1, 
      1.0 - highClipPenalty * 0.6 - lowClipPenalty * 0.3 + stabilityBonus * 0.1
    ));
  }
  
  private computeMotionScore(input: FrameQualityInput): number {
    const { motionScore, motionState } = input;
    
    // Score is inverse of motion (lower motion = higher score)
    const baseScore = 1 - Math.min(1, motionScore);
    
    // State-based adjustment
    switch (motionState) {
      case 'STATIONARY': return 1.0;
      case 'LOW': return Math.max(0.7, baseScore);
      case 'MODERATE': return Math.max(0.4, baseScore * 0.8);
      case 'HIGH': return Math.max(0.2, baseScore * 0.5);
      case 'EXTREME': return 0;
      default: return baseScore;
    }
  }
  
  private computeIlluminationScore(input: FrameQualityInput): number {
    const { brightness, clipHighRatio } = input;
    
    // Optimal brightness range: 50-400
    let score = 1.0;
    
    if (brightness < 30) {
      score = brightness / 30; // Under-illuminated
    } else if (brightness > 500) {
      score = Math.max(0, 1 - (brightness - 500) / 500); // Over-illuminated
    }
    
    // Clip-high indicates overexposure
    score *= (1 - clipHighRatio);
    
    return Math.max(0, Math.min(1, score));
  }

  // ═════════════════════════════════════════════════════════════════
  //  HELPER METHODS
  // ═════════════════════════════════════════════════════════════════
  
  private getSeverity(score: number, threshold: number): RejectionSeverity {
    const ratio = score / threshold;
    if (ratio < 0.3) return 'CRITICAL';
    if (ratio < 0.5) return 'SEVERE';
    if (ratio < 0.7) return 'MODERATE';
    if (ratio < 0.9) return 'MINOR';
    return 'NONE';
  }
  
  private getMostSevereFailure(failures: QualityFailure[]): QualityFailure | null {
    if (failures.length === 0) return null;
    
    const severityOrder: RejectionSeverity[] = ['CRITICAL', 'SEVERE', 'MODERATE', 'MINOR', 'NONE'];
    return failures.reduce((worst, current) => {
      return severityOrder.indexOf(current.severity) < severityOrder.indexOf(worst.severity) 
        ? current 
        : worst;
    });
  }
  
  private getContactFailureDescription(input: FrameQualityInput): string {
    const { contactState, coverageRatio } = input;
    if (contactState === 'NO_FINGER' || contactState === 'NO_CONTACT') {
      return 'No finger detected on camera';
    }
    if (contactState === 'OVERPRESSURE' || contactState === 'EXCESSIVE_PRESSURE') {
      return 'Excessive pressure - reduce finger pressure';
    }
    if (coverageRatio < 0.2) {
      return 'Insufficient finger coverage';
    }
    return `Poor contact quality: ${contactState}`;
  }
  
  private getSignalFailureDescription(input: FrameQualityInput): string {
    const { globalSQI, perfusionIndex } = input;
    if (globalSQI < 20) {
      return 'Very low signal quality index';
    }
    if (perfusionIndex < 0.01) {
      return 'No detectable pulsatility';
    }
    return `Low signal quality (SQI: ${globalSQI.toFixed(0)})`;
  }
  
  private getEnvironmentFailureDescription(input: FrameQualityInput): string {
    const { clipHighRatio, clipLowRatio } = input;
    if (clipHighRatio > 0.2) {
      return 'Signal saturation from overpressure';
    }
    if (clipLowRatio > 0.15) {
      return 'Under-illuminated or poor contact';
    }
    return 'Environmental quality degraded';
  }
  
  private getIlluminationFailureDescription(input: FrameQualityInput): string {
    const { brightness } = input;
    if (brightness < 30) {
      return 'Too dark - enable flash or adjust finger';
    }
    if (brightness > 700) {
      return 'Overexposed - reduce illumination';
    }
    return 'Suboptimal illumination';
  }
  
  private computeAssessmentConfidence(input: FrameQualityInput): number {
    // Confidence based on availability of input metrics
    let confidence = 0.5;
    
    if (input.contactConfidence > 0) confidence += 0.1;
    if (input.globalSQI > 0) confidence += 0.1;
    if (input.spectralSNR !== undefined) confidence += 0.1;
    if (input.peakProminence !== undefined) confidence += 0.1;
    if (input.temporalStability !== undefined) confidence += 0.1;
    
    return Math.min(1, confidence);
  }

  // ═════════════════════════════════════════════════════════════════
  //  PUBLIC API - DIAGNOSTICS
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Get quality trend over recent frames
   */
  getQualityTrend(): { improving: boolean; stability: number } {
    if (this.rejectionHistory.length < 5) {
      return { improving: false, stability: 0 };
    }
    
    const recent = this.rejectionHistory.slice(-5);
    const criticalCount = recent.filter(f => f.severity === 'CRITICAL').length;
    const severeCount = recent.filter(f => f.severity === 'SEVERE').length;
    
    return {
      improving: criticalCount === 0 && severeCount < 2,
      stability: 1 - (criticalCount * 0.3 + severeCount * 0.15),
    };
  }
  
  /**
   * Get most frequent rejection category
   */
  getPrimaryIssue(): RejectionCategory | null {
    if (this.rejectionHistory.length === 0) return null;
    
    const counts: Partial<Record<RejectionCategory, number>> = {};
    for (const failure of this.rejectionHistory) {
      counts[failure.category] = (counts[failure.category] || 0) + 1;
    }
    
    return (Object.entries(counts) as [RejectionCategory, number][])
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  
  /**
   * Get rejection statistics
   */
  getRejectionStats(): {
    totalFrames: number;
    failureCount: number;
    failureRate: number;
    byCategory: Record<RejectionCategory, number>;
    bySeverity: Record<RejectionSeverity, number>;
  } {
    const byCategory: Partial<Record<RejectionCategory, number>> = {};
    const bySeverity: Partial<Record<RejectionSeverity, number>> = {};
    
    for (const failure of this.rejectionHistory) {
      byCategory[failure.category] = (byCategory[failure.category] || 0) + 1;
      bySeverity[failure.severity] = (bySeverity[failure.severity] || 0) + 1;
    }
    
    return {
      totalFrames: this.frameCount,
      failureCount: this.rejectionHistory.length,
      failureRate: this.frameCount > 0 ? this.rejectionHistory.length / this.frameCount : 0,
      byCategory: byCategory as Record<RejectionCategory, number>,
      bySeverity: bySeverity as Record<RejectionSeverity, number>,
    };
  }
  
  /**
   * Reset gate state
   */
  reset(): void {
    this.smoothedQuality = 0.5;
    this.frameCount = 0;
    this.rejectionHistory = [];
  }
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY EXPORTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Quality level from score
 */
export function getQualityLevel(score: number): 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'POOR' | 'CRITICAL' {
  if (score >= 0.9) return 'EXCELLENT';
  if (score >= 0.7) return 'GOOD';
  if (score >= 0.5) return 'ACCEPTABLE';
  if (score >= 0.3) return 'POOR';
  return 'CRITICAL';
}

/**
 * Check if quality is acceptable for measurement
 */
export function isQualityAcceptable(output: FrameQualityOutput): boolean {
  return output.qualityScore >= 0.5 && 
         !output.failures.some(f => f.severity === 'CRITICAL');
}

