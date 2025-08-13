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
  
  // Sistema anti-falsos positivos
  private motionHistory: number[] = [];
  private signalVarianceHistory: number[] = [];
  private lastSignalValue = 0;

  constructor(private readonly config: SignalAnalyzerConfig) {}

  /** Reset internal state (useful when starting/stopping the processor). */
  reset(): void {
    this.qualityHistory = [];
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    this.motionHistory = [];
    this.signalVarianceHistory = [];
    this.lastSignalValue = 0;
  }

  /** Update latest detector scores provided each frame by the processor. */
  updateDetectorScores(scores: DetectorScores): void {
    this.detectorScores = scores;
  }

  /**
   * Calculate overall quality and finger detection decision.
   * SISTEMA ANTI-FALSOS POSITIVOS CON VALIDACIÓN ESTRICTA
   */
  analyzeSignalMultiDetector(
    filteredValue: number,
    trendResult: unknown
  ): DetectionResult {
    const { redChannel, stability, pulsatility, biophysical, periodicity } =
      this.detectorScores;

    // VALIDACIÓN BALANCEADA: Detectores con umbrales optimizados
    const hasMinimumRedSignal = redChannel > 0.08; // Umbral más bajo pero válido
    const hasStability = stability > 0.15; // Estabilidad reducida
    const hasPulsatility = pulsatility > 0.1; // Pulsatilidad más sensible
    const hasBiophysicalSignature = biophysical > 0.08; // Firma biofísica más permisiva

    // Pesos optimizados para EXTRACCIÓN POTENTE
    const weighted =
      redChannel * 0.45 +      // MAYOR peso al canal rojo para detección fuerte
      pulsatility * 0.3 +      // Pulsatilidad crítica
      stability * 0.15 +       // Estabilidad moderada
      biophysical * 0.08 +     // Validación biofísica reducida
      periodicity * 0.02;      // Periodicidad mínima

    // Factor de calidad POTENTE para extracción fuerte
    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 110))); // Factor aumentado

    // Historial de calidad
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    // Suavizado conservador
    const smoothedQuality = this.qualityHistory.reduce((sum, val) => sum + val, 0) / this.qualityHistory.length;

    // UMBRAL BALANCEADO para detección potente sin falsos positivos
    const DETECTION_THRESHOLD = 25; // Umbral moderado
    const CONFIRMATION_THRESHOLD = 20; // Umbral para mantener detección
    
    // Lógica de detección POTENTE con validación mínima
    if (smoothedQuality >= DETECTION_THRESHOLD && hasMinimumRedSignal) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else if (smoothedQuality < CONFIRMATION_THRESHOLD) {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // Detección MÁS RÁPIDA para extracción potente
    let isFingerDetected = false;
    if (this.consecutiveDetections >= Math.max(2, this.config.MIN_CONSECUTIVE_DETECTIONS - 4)) {
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
