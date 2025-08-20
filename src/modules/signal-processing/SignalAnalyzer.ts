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

    // Weighted sum – weights optimized for stability
    const weighted =
      redChannel * 0.40 +      // Aumentado peso del canal rojo para estabilidad
      stability * 0.35 +       // Aumentado peso de estabilidad
      pulsatility * 0.15 +     // Reducido peso de pulsatilidad
      biophysical * 0.08 +     // Reducido peso biofísico
      periodicity * 0.02;      // Reducido peso de periodicidad

    // Map 0-1 range to 0-100 and clamp.
    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 100)));

    // Maintain moving average over last N frames with improved stability
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    // Promedio ponderado para mayor estabilidad
    const recentWeight = 0.6; // Peso mayor para valores recientes
    const historyWeight = 0.4; // Peso menor para valores históricos
    
    const recentValues = this.qualityHistory.slice(-3); // Últimos 3 valores
    const olderValues = this.qualityHistory.slice(0, -3); // Valores anteriores
    
    const recentAvg = recentValues.length > 0 ? 
      recentValues.reduce((acc, v) => acc + v, 0) / recentValues.length : 0;
    const olderAvg = olderValues.length > 0 ? 
      olderValues.reduce((acc, v) => acc + v, 0) / olderValues.length : 0;
    
    const smoothedQuality = recentAvg * recentWeight + olderAvg * historyWeight;

    // Umbrales optimizados para estabilidad
    const DETECTION_THRESHOLD = 32; // Reducido para mayor sensibilidad
    const RELEASE_THRESHOLD = 22;   // Umbral de liberación más bajo para estabilidad

    // Hysteresis logic using consecutive detections - OPTIMIZADO para estabilidad
    let isFingerDetected = false;
    console.log('[DEBUG] SignalAnalyzer - MEJORAS APLICADAS:', {
      detectorScores: this.detectorScores, 
      smoothedQuality: smoothedQuality,
      weights: {
        redChannel: 0.35,
        stability: 0.30,
        pulsatility: 0.20,
        biophysical: 0.12,
        periodicity: 0.03
      },
      thresholds: {
        DETECTION_THRESHOLD: DETECTION_THRESHOLD,
        RELEASE_THRESHOLD: RELEASE_THRESHOLD
      },
      config: {
        MIN_CONSECUTIVE_DETECTIONS: this.config.MIN_CONSECUTIVE_DETECTIONS,
        MAX_CONSECUTIVE_NO_DETECTIONS: this.config.MAX_CONSECUTIVE_NO_DETECTIONS
      }
    });
    
    if (smoothedQuality >= DETECTION_THRESHOLD) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else if (smoothedQuality < RELEASE_THRESHOLD) {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }
    // Entre umbrales: mantener estado anterior para estabilidad

    // Lógica de detección más estable
    if (this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS) {
      isFingerDetected = true;
    } else if (
      this.consecutiveNoDetections >= this.config.MAX_CONSECUTIVE_NO_DETECTIONS
    ) {
      isFingerDetected = false;
    }
    // Si no se cumple ninguna condición, mantener el estado anterior

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
