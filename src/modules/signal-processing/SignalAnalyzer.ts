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
   * Calculate overall quality and finger detection decision.
   * @param filteredValue Unused for now but kept for future algorithm updates.
   * @param trendResult   Additional context (e.g., from SignalTrendAnalyzer).
   */
  analyzeSignalMultiDetector(
    filteredValue: number,
    trendResult: unknown
  ): DetectionResult {
    const { redChannel, stability, pulsatility, biophysical, periodicity, skinLikeness, stabilityScore } =
      this.detectorScores;

    // Validación moderada
    if (skinLikeness !== undefined && skinLikeness < 0.3) {
      return {
        isFingerDetected: false,
        quality: 0,
        detectorDetails: { ...this.detectorScores },
      };
    }
    
    if (stabilityScore !== undefined && stabilityScore < 0.2) {
      return {
        isFingerDetected: false,
        quality: 0,
        detectorDetails: { ...this.detectorScores },
      };
    }

    // Validación básica moderada
    if (redChannel < 0.15 || stability < 0.15 || pulsatility < 0.15 || biophysical < 0.15) {
      return {
        isFingerDetected: false,
        quality: 0,
        detectorDetails: { ...this.detectorScores },
      };
    }

    // Weighted sum - ahora incluye las nuevas métricas anti-mesa
    const weighted =
      redChannel * 0.25 +
      stability * 0.2 +
      pulsatility * 0.2 +
      biophysical * 0.15 +
      periodicity * 0.05 +
      (skinLikeness || 0.5) * 0.1 + // Peso para similitud con piel
      (stabilityScore || 0.5) * 0.05; // Peso para estabilidad vs vibración

    // Map 0-1 range to 0-100 and clamp.
    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 100)));

    // Maintain moving average over last N frames.
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    const smoothedQuality =
      this.qualityHistory.reduce((acc, v) => acc + v, 0) /
      this.qualityHistory.length;

    // Hysteresis logic using consecutive detections.
    let isFingerDetected = false;
    const DETECTION_THRESHOLD = 30;
    if (smoothedQuality >= DETECTION_THRESHOLD) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    if (this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS) {
      isFingerDetected = true;
    } else if (
      this.consecutiveNoDetections >= this.config.MAX_CONSECUTIVE_NO_DETECTIONS
    ) {
      isFingerDetected = false;
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
