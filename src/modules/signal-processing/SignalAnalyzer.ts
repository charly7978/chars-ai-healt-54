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

    // Weighted sum optimizado para detección de dedo
    const weighted =
      redChannel * 0.4 +        // Mayor peso al canal rojo (principal indicador)
      pulsatility * 0.3 +       // Mayor peso a pulsatilidad
      stability * 0.15 +        // Menor peso a estabilidad (puede ser ruidosa inicialmente)
      biophysical * 0.1 +       // Menor peso a validación biofísica
      periodicity * 0.05;       // Peso mínimo a periodicidad

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

    // Ultra-sensitive hysteresis logic for immediate finger detection
    let isFingerDetected = false;
    console.log('[DEBUG] SignalAnalyzer - detectorScores:', this.detectorScores, 'smoothedQuality:', smoothedQuality);
    
    // Umbral dinámico basado en la calidad de la señal
    let detectionThreshold = 8; // Umbral base muy bajo
    
    // Ajustar umbral basado en componentes individuales
    if (redChannel > 0.3 || pulsatility > 0.2 || biophysical > 0.4) {
      detectionThreshold = 5; // Aún más bajo si hay buenas señales individuales
    }
    
    if (smoothedQuality >= detectionThreshold) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // Detección más rápida y persistente
    if (this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS) {
      isFingerDetected = true;
    } else if (
      this.consecutiveNoDetections >= this.config.MAX_CONSECUTIVE_NO_DETECTIONS
    ) {
      isFingerDetected = false;
    }
    
    // Override: si hay señal roja fuerte, detectar inmediatamente
    if (redChannel > 0.5 && smoothedQuality > 3) {
      isFingerDetected = true;
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
