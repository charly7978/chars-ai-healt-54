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

    // Weighted sum – weights can be tuned later or moved to config.
    const weighted =
      redChannel * 0.3 +
      stability * 0.25 +
      pulsatility * 0.25 +
      biophysical * 0.15 +
      periodicity * 0.05;

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
    
    // ✅ Umbral de detección reducido para mayor sensibilidad
    const DETECTION_THRESHOLD = 10;  
    
    // ✅ Lógica mejorada para detección de dedo real
    // Considerar tanto la calidad general como indicadores específicos
    const hasStrongRedSignal = redChannel > 0.3; // Señal roja fuerte indica dedo - reducido a 0.3
    const hasGoodStability = stability > 0.2; // Estabilidad mínima - reducido a 0.2
    const hasSomePulsatility = pulsatility > 0.15; // Alguna actividad pulsatil - reducido a 0.15
    
    // Umbral dinámico: si hay indicadores fuertes, reducir el umbral requerido
    const dynamicThreshold = hasStrongRedSignal && hasGoodStability ? 6 : DETECTION_THRESHOLD;
    
    if (smoothedQuality >= dynamicThreshold) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // ✅ Reducir detecciones consecutivas necesarias para respuesta más rápida
    const minDetections = hasStrongRedSignal && hasSomePulsatility ? 2 : this.config.MIN_CONSECUTIVE_DETECTIONS;
    
    if (this.consecutiveDetections >= minDetections) {
      isFingerDetected = true;
    } else if (
      this.consecutiveNoDetections >= this.config.MAX_CONSECUTIVE_NO_DETECTIONS
    ) {
      isFingerDetected = false;
    }
    
    // ✅ Logging mejorado para diagnóstico
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[ANALYZER] Quality: ${smoothedQuality.toFixed(1)}, Threshold: ${dynamicThreshold}, Red: ${redChannel.toFixed(2)}, Stability: ${stability.toFixed(2)}, Pulsatility: ${pulsatility.toFixed(2)}, Detected: ${isFingerDetected}`);
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
