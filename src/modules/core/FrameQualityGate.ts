/**
 * FRAME QUALITY GATE
 * 
 * Strict quality gating to prevent bad data from propagating downstream.
 * Rejects frames based on:
 * - Excessive clipping
 * - High motion contamination
 * - Low signal quality (SQI)
 * - Poor contact state
 * - Under-illumination
 * - Overpressure
 * 
 * Returns pass/fail decision with rejection reason for diagnostics.
 */

export type ContactState = 'NO_CONTACT' | 'PARTIAL_CONTACT' | 'GOOD_CONTACT' | 'OVERPRESSURE' | 'UNDERILLUMINATED' | 'EXCESSIVE_CLIPPING' | 'MOTION_CONTAMINATED';

export interface FrameQualityInput {
  contactState: ContactState;
  globalSQI: number;
  clipHighRatio: number;
  clipLowRatio: number;
  motionScore: number;
  coverageRatio: number;
  perfusionIndex: number;
  spatialUniformity: number;
  brightness: number;
}

export interface FrameQualityOutput {
  pass: boolean;
  reason: string;
  confidence: number;
}

export class FrameQualityGate {
  private readonly SQI_THRESHOLD = 35;
  private readonly CLIP_HIGH_THRESHOLD = 0.25;
  private readonly CLIP_LOW_THRESHOLD = 0.15;
  private readonly MOTION_THRESHOLD = 0.7;
  private readonly COVERAGE_THRESHOLD = 0.25;
  private readonly BRIGHTNESS_MIN = 30;
  private readonly BRIGHTNESS_MAX = 700;

  /**
   * Evaluate frame quality and determine if it should pass
   */
  evaluate(input: FrameQualityInput): FrameQualityOutput {
    const {
      contactState,
      globalSQI,
      clipHighRatio,
      clipLowRatio,
      motionScore,
      coverageRatio,
      perfusionIndex,
      spatialUniformity,
      brightness,
    } = input;

    // Hard rejects - these conditions immediately fail the gate
    if (contactState === 'NO_CONTACT') {
      return {
        pass: false,
        reason: 'NO_FINGER_DETECTED',
        confidence: 0.95,
      };
    }

    if (contactState === 'EXCESSIVE_CLIPPING' || clipHighRatio > this.CLIP_HIGH_THRESHOLD) {
      return {
        pass: false,
        reason: 'EXCESSIVE_CLIPPING',
        confidence: 0.9,
      };
    }

    if (contactState === 'MOTION_CONTAMINATED' || motionScore > this.MOTION_THRESHOLD) {
      return {
        pass: false,
        reason: 'HIGH_MOTION',
        confidence: 0.85,
      };
    }

    if (contactState === 'UNDERILLUMINATED' || brightness < this.BRIGHTNESS_MIN) {
      return {
        pass: false,
        reason: 'UNDERILLUMINATED',
        confidence: 0.85,
      };
    }

    if (contactState === 'OVERPRESSURE') {
      return {
        pass: false,
        reason: 'OVERPRESSURE',
        confidence: 0.8,
      };
    }

    // Soft rejects - these conditions fail the gate but with lower confidence
    if (clipLowRatio > this.CLIP_LOW_THRESHOLD) {
      return {
        pass: false,
        reason: 'EXCESSIVE_LOW_CLIPPING',
        confidence: 0.7,
      };
    }

    if (coverageRatio < this.COVERAGE_THRESHOLD) {
      return {
        pass: false,
        reason: 'INSUFFICIENT_COVERAGE',
        confidence: 0.75,
      };
    }

    if (globalSQI < this.SQI_THRESHOLD) {
      return {
        pass: false,
        reason: 'LOW_SIGNAL_QUALITY',
        confidence: 0.7,
      };
    }

    if (spatialUniformity < 0.3) {
      return {
        pass: false,
        reason: 'POOR_SPATIAL_UNIFORMITY',
        confidence: 0.65,
      };
    }

    if (perfusionIndex < 0.02) {
      return {
        pass: false,
        reason: 'LOW_PERFUSION',
        confidence: 0.6,
      };
    }

    if (brightness > this.BRIGHTNESS_MAX) {
      return {
        pass: false,
        reason: 'OVERSATURATED',
        confidence: 0.7,
      };
    }

    // Pass - all quality checks passed
    const confidence = this.computePassConfidence(input);
    return {
      pass: true,
      reason: 'QUALITY_OK',
      confidence,
    };
  }

  /**
   * Compute confidence score for passing frames
   */
  private computePassConfidence(input: FrameQualityInput): number {
    const {
      globalSQI,
      clipHighRatio,
      clipLowRatio,
      motionScore,
      coverageRatio,
      perfusionIndex,
      spatialUniformity,
      brightness,
    } = input;

    let confidence = 0.5;

    // SQI contribution (0-30 points)
    confidence += Math.min(0.3, globalSQI / 100 * 0.3);

    // Coverage contribution (0-15 points)
    confidence += Math.min(0.15, coverageRatio * 0.15);

    // Perfusion contribution (0-15 points)
    confidence += Math.min(0.15, perfusionIndex * 5);

    // Spatial uniformity contribution (0-10 points)
    confidence += Math.min(0.1, spatialUniformity * 0.1);

    // Clipping penalty (subtract up to 10 points)
    confidence -= Math.min(0.1, (clipHighRatio + clipLowRatio) * 0.3);

    // Motion penalty (subtract up to 10 points)
    confidence -= Math.min(0.1, motionScore * 0.15);

    // Brightness penalty if too high (subtract up to 5 points)
    if (brightness > 500) {
      confidence -= Math.min(0.05, (brightness - 500) / 4000);
    }

    return Math.max(0.5, Math.min(1.0, confidence));
  }

  /**
   * Get rejection statistics for diagnostics
   */
  getRejectionStats(): {
    totalFrames: number;
    passedFrames: number;
    rejectedFrames: number;
    rejectionReasons: Record<string, number>;
  } {
    // This would be implemented with internal tracking if needed
    return {
      totalFrames: 0,
      passedFrames: 0,
      rejectedFrames: 0,
      rejectionReasons: {},
    };
  }

  /**
   * Reset gate statistics
   */
  resetStats(): void {
    // Reset internal tracking if implemented
  }
}
