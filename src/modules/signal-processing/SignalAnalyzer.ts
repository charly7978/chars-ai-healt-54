// SignalAnalyzer rebuilt to remove corrupted content
import { DetectorScores, DetectionResult } from './types';

export interface SignalAnalyzerConfig {
  QUALITY_LEVELS: number;
  QUALITY_HISTORY_SIZE: number;
  MIN_CONSECUTIVE_DETECTIONS: number;
  MAX_CONSECUTIVE_NO_DETECTIONS: number;
}

/**
 * SignalAnalyzer performs quality aggregation and finger-on-sensor detection
 * using recent detector scores (colour channel, stability, pulsatility, etc.).
 *
 * The algorithm is intentionally simple: it keeps a moving window of quality
 * values, applies a weighted sum of the detector scores, and decides whether a
 * finger is present based on smoothed quality plus hysteresis controlled by
 * consecutive detection/no-detection counters.  This is sufficient for build
 * purposes and can be refined later without affecting the public API.
 */
export class SignalAnalyzer {
  private qualityHistory: number[] = [];
  private consecutiveDetections = 0;
  private consecutiveNoDetections = 0;
  private detectorScores: DetectorScores = {
    redChannel: 0,
    stability: 0,
    pulsatility: 0,
    biophysical: 0,
    periodicity: 0,
  };

  constructor(private readonly config: SignalAnalyzerConfig) {}

  /** Reset internal state (useful when starting/stopping the processor). */
  reset(): void {
    this.qualityHistory = [];
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
  }

  /** Update latest detector scores provided each frame by the processor. */
  updateDetectorScores(scores: DetectorScores): void {
    this.detectorScores = scores;
  }

  /**
   * Calculate overall quality and finger detection decision with enhanced validation.
   * @param filteredValue Current filtered signal value
   * @param trendResult   Trend analysis result for physiological validation
   */
  analyzeSignalMultiDetector(
    filteredValue: number,
    trendResult: unknown
  ): DetectionResult {
    const { redChannel, stability, pulsatility, biophysical, periodicity } =
      this.detectorScores;

    // Enhanced weighted sum with medical validation priorities
    // Prioritize biophysical and physiological signals over simple color presence
    const weighted =
      redChannel * 0.15 +        // Reduced weight - basic presence
      stability * 0.20 +         // Signal stability is important
      pulsatility * 0.30 +      // Increased weight - crucial for heartbeat detection
      biophysical * 0.25 +      // Increased weight - physiological validation
      periodicity * 0.10;       // Important for rhythm detection

    // Map 0-1 range to 0-100 and clamp
    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 100)));

    // Maintain moving average over last N frames
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    const smoothedQuality =
      this.qualityHistory.reduce((acc, v) => acc + v, 0) /
      this.qualityHistory.length;

    // Enhanced hysteresis logic with adaptive thresholds
    let isFingerDetected = false;
    
    // Adaptive threshold based on signal characteristics
    const baseThreshold = 35; // Increased base threshold for better specificity
    const adaptiveThreshold = this.calculateAdaptiveThreshold();
    const finalThreshold = Math.max(baseThreshold, adaptiveThreshold);

    // Enhanced validation with trend analysis
    const trendValidation = this.validateTrendCompatibility(trendResult);
    const physiologicalValidation = this.validatePhysiologicalConsistency();

    // Combined decision logic
    const combinedScore = smoothedQuality * (trendValidation ? 1.0 : 0.7) * (physiologicalValidation ? 1.0 : 0.8);

    if (combinedScore >= finalThreshold) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // Stricter detection criteria with enhanced hysteresis
    if (this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS) {
      isFingerDetected = true;
    } else if (
      this.consecutiveNoDetections >= this.config.MAX_CONSECUTIVE_NO_DETECTIONS
    ) {
      isFingerDetected = false;
    }

    // Additional validation: require minimum pulsatility for heartbeat detection
    if (isFingerDetected && pulsatility < 0.15) {
      isFingerDetected = false;
      this.consecutiveDetections = 0;
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }

  /**
   * Calculate adaptive threshold based on signal characteristics
   */
  private calculateAdaptiveThreshold(): number {
    if (this.qualityHistory.length < 5) return 30;

    // Calculate signal stability to adjust threshold
    const recentQuality = this.qualityHistory.slice(-5);
    const meanQuality = recentQuality.reduce((a, b) => a + b, 0) / recentQuality.length;
    const qualityVariance = recentQuality.reduce((sum, val) => sum + Math.pow(val - meanQuality, 2), 0) / recentQuality.length;

    // Increase threshold for unstable signals, decrease for stable ones
    const stabilityFactor = Math.max(0.8, Math.min(1.2, 1.0 - qualityVariance / 1000));
    return 30 * stabilityFactor;
  }

  /**
   * Validate compatibility with trend analysis
   */
  private validateTrendCompatibility(trendResult: unknown): boolean {
    // If trend result indicates non-physiological behavior, reject detection
    if (typeof trendResult === 'string') {
      return trendResult !== 'non_physiological' && trendResult !== 'unstable';
    }
    return true;
  }

  /**
   * Validate physiological consistency across detectors
   */
  private validatePhysiologicalConsistency(): boolean {
    const { redChannel, stability, pulsatility, biophysical, periodicity } = this.detectorScores;

    // Require minimum levels in key physiological indicators
    const minBiophysical = 0.2;  // Minimum biophysical plausibility
    const minPulsatility = 0.1;  // Minimum pulsatility for heartbeat detection
    const minStability = 0.15;   // Minimum signal stability

    // Check consistency between related metrics
    const biophysicalPulsatilityConsistent = Math.abs(biophysical - pulsatility) < 0.4;
    const stabilityPeriodicityConsistent = stability > 0.1 ? periodicity > 0.05 : true;

    return (
      biophysical >= minBiophysical &&
      pulsatility >= minPulsatility &&
      stability >= minStability &&
      biophysicalPulsatilityConsistent &&
      stabilityPeriodicityConsistent
    );
  }
}
