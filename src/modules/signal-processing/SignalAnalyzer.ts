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

    // VALIDACIÓN CRÍTICA: Todos los detectores deben tener valores mínimos
    const hasMinimumRedSignal = redChannel > 0.15; // Señal roja mínima real
    const hasStability = stability > 0.25; // Estabilidad mínima
    const hasPulsatility = pulsatility > 0.2; // Pulsatilidad detectable
    const hasBiophysicalSignature = biophysical > 0.15; // Firma biofísica
    
    // SISTEMA DE VETO: Si falla alguna validación crítica, NO hay dedo
    if (!hasMinimumRedSignal || !hasStability) {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
      
      return {
        isFingerDetected: false,
        quality: 0,
        detectorDetails: { ...this.detectorScores },
      };
    }

    // Pesos rebalanceados para evitar falsos positivos
    const weighted =
      redChannel * 0.35 +      // Canal rojo importante pero no dominante
      stability * 0.25 +       // Estabilidad crítica
      pulsatility * 0.25 +     // Pulsatilidad crítica
      biophysical * 0.1 +      // Validación biofísica
      periodicity * 0.05;      // Periodicidad menor peso

    // Factor de calidad más conservador
    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 85))); // Factor reducido

    // Historial de calidad
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    // Suavizado conservador
    const smoothedQuality = this.qualityHistory.reduce((sum, val) => sum + val, 0) / this.qualityHistory.length;

    // UMBRAL ESTRICTO ANTI-FALSOS POSITIVOS
    const DETECTION_THRESHOLD = 45; // Umbral mucho más alto
    const CONFIRMATION_THRESHOLD = 35; // Umbral para mantener detección
    
    // Lógica de detección estricta
    if (smoothedQuality >= DETECTION_THRESHOLD && hasPulsatility && hasBiophysicalSignature) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else if (smoothedQuality < CONFIRMATION_THRESHOLD) {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // Requiere múltiples confirmaciones consecutivas
    let isFingerDetected = false;
    if (this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS) {
      isFingerDetected = true;
    } else if (this.consecutiveNoDetections >= Math.max(3, this.config.MAX_CONSECUTIVE_NO_DETECTIONS - 3)) {
      isFingerDetected = false;
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
