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

    // Validación de requisitos mínimos
    const hasMinimalQuality = redChannel > 0.3 && stability > 0.4 && pulsatility > 0.2;
    
    if (!hasMinimalQuality) {
      this.qualityHistory.push(0);
      if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
        this.qualityHistory.shift();
      }
      return {
        isFingerDetected: false,
        quality: 0,
        detectorDetails: this.detectorScores
      };
    }

    // Pesos optimizados para detección robusta
    const weighted = Math.min(1,
      (redChannel * 0.15) +     // Color de piel válido
      (stability * 0.25) +      // Estabilidad de la señal
      (pulsatility * 0.4) +     // Pulsatilidad (señal cardíaca)
      (biophysical * 0.1) +     // Características biofísicas
      (periodicity * 0.2)       // Periodicidad de la señal
    );

    // Suavizado exponencial para respuesta más rápida
    const qualityValue = Math.min(100, Math.round(weighted * 100));
    
    // Mantener historial de calidad con suavizado
    if (this.qualityHistory.length === 0) {
      this.qualityHistory = Array(this.config.QUALITY_HISTORY_SIZE).fill(qualityValue);
    } else {
      this.qualityHistory.push(qualityValue);
      if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
        this.qualityHistory.shift();
      }
    }
    
    // Calcular calidad suavizada con mayor peso en valores recientes
    const smoothedQuality = this.qualityHistory.reduce((acc, val, idx) => {
      const weight = (idx + 1) / this.qualityHistory.length; // Peso progresivo
      return acc + (val * weight);
    }, 0) / (this.qualityHistory.length * 0.5 + 0.5); // Normalización

    // Lógica de histéresis mejorada
    const DETECTION_THRESHOLD = 60;       // Umbral principal de detección
    const RELEASE_THRESHOLD = 45;         // Umbral más bajo para soltar (histeresis)
    
    let isFingerDetected = false;
    const currentQuality = smoothedQuality;
    
    // Lógica de detección con histéresis
    if (currentQuality >= DETECTION_THRESHOLD) {
      this.consecutiveDetections = Math.min(
        this.consecutiveDetections + 2, // Aumento más rápido
        this.config.MIN_CONSECUTIVE_DETECTIONS * 2
      );
      this.consecutiveNoDetections = Math.max(0, this.consecutiveNoDetections - 1);
    } else if (currentQuality < RELEASE_THRESHOLD) {
      this.consecutiveNoDetections++;
      this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
    }
    
    // Tomar decisión basada en conteos consecutivos
    const minDetections = Math.max(1, Math.floor(this.config.MIN_CONSECUTIVE_DETECTIONS * 0.7));
    isFingerDetected = this.consecutiveDetections >= minDetections;
    
    // Forzar actualización si la calidad es muy baja
    if (currentQuality < 20) {
      this.consecutiveDetections = 0;
      isFingerDetected = false;
    }
    
    // Depuración detallada
    if (currentQuality > 30 || isFingerDetected) {
      console.log('[SIGNAL]', {
        quality: Math.round(currentQuality),
        detected: isFingerDetected,
        counts: `${this.consecutiveDetections}/${this.consecutiveNoDetections}`,
        scores: {
          red: Math.round(redChannel * 100) / 100,
          stab: Math.round(stability * 100) / 100,
          pulse: Math.round(pulsatility * 100) / 100,
          bio: Math.round(biophysical * 100) / 100,
          period: Math.round(periodicity * 100) / 100
        }
      });
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
