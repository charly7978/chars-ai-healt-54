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

    // Pesos optimizados para detección más sensible
    const weighted =
      redChannel * 0.4 +      // Mayor peso al canal rojo
      pulsatility * 0.3 +     // Mayor peso a pulsatilidad
      stability * 0.15 +
      biophysical * 0.1 +
      periodicity * 0.05;

    // Mapear a 0-100 con ajuste de sensibilidad
    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 120))); // Factor 120 para mayor sensibilidad

    // Historial de calidad con suavizado
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    // Suavizado con mayor peso a valores recientes
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < this.qualityHistory.length; i++) {
      const weight = (i + 1) / this.qualityHistory.length; // Peso creciente
      weightedSum += this.qualityHistory[i] * weight;
      totalWeight += weight;
    }
    const smoothedQuality = totalWeight > 0 ? weightedSum / totalWeight : qualityValue;

    // Lógica de histeresis mejorada
    let isFingerDetected = false;
    const DETECTION_THRESHOLD = 20; // Umbral más bajo para mejor detección
    
    if (smoothedQuality >= DETECTION_THRESHOLD) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // Detección más rápida
    if (this.consecutiveDetections >= Math.max(1, this.config.MIN_CONSECUTIVE_DETECTIONS - 2)) {
      isFingerDetected = true;
    } else if (this.consecutiveNoDetections >= this.config.MAX_CONSECUTIVE_NO_DETECTIONS) {
      isFingerDetected = false;
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
