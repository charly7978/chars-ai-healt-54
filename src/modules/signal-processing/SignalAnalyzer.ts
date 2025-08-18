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
    const { redChannel, stability, pulsatility, biophysical, periodicity } =
      this.detectorScores;

    // PESOS REBALANCEADOS para detección más clara de dedo real
    const weighted =
      redChannel * 0.20 +        // REDUCIDO de 0.30 a 0.20 (menos dependiente del rojo)
      stability * 0.15 +         // REDUCIDO de 0.25 a 0.15
      pulsatility * 0.35 +       // AUMENTADO de 0.25 a 0.35 (más peso a pulsatilidad)
      biophysical * 0.25 +       // AUMENTADO de 0.15 a 0.25 (más peso a validación biofísica)
      periodicity * 0.05;        // MANTENIDO

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

    // HISTÉRESIS CORREGIDA para detección más clara
    let isFingerDetected = false;
    console.log('[DEBUG] SignalAnalyzer - detectorScores:', this.detectorScores, 'smoothedQuality:', smoothedQuality);
    const DETECTION_THRESHOLD = 18; // REDUCIDO de 30 a 18 para detección más sensible
    if (smoothedQuality >= DETECTION_THRESHOLD) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // HISTÉRESIS REDUCIDA para detección más rápida y clara
    const MIN_CONSECUTIVE_DETECTIONS = 2;  // REDUCIDO de valor config
    const MAX_CONSECUTIVE_NO_DETECTIONS = 4; // REDUCIDO de valor config
    
    if (this.consecutiveDetections >= MIN_CONSECUTIVE_DETECTIONS) {
      isFingerDetected = true;
    } else if (
      this.consecutiveNoDetections >= MAX_CONSECUTIVE_NO_DETECTIONS
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
