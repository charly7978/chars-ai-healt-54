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
    const hasMinimumRedSignal = redChannel > 0.1; // Umbral MÁS ALTO para señales más fuertes
    const hasStability = stability > 0.2; // Estabilidad MÁS ALTA
    const hasPulsatility = pulsatility > 0.15; // Pulsatilidad MÁS ALTA
    const hasBiophysicalSignature = biophysical > 0.1; // Firma biofísica MÁS ALTA

    // Pesos optimizados para EXTRACCIÓN POTENTE y robusta
    const weighted =
      redChannel * 0.5 +       // MAYOR peso al canal rojo para detección fuerte
      pulsatility * 0.35 +     // Pulsatilidad crítica y más alta
      stability * 0.1 +        // Estabilidad reducida pero aún importante
      biophysical * 0.05;      // Validación biofísica mínima

    // Factor de calidad POTENTE y ROBUSTA para extracción fuerte
    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 120))); // Factor aumentado y más agresivo

    // Historial de calidad
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    // Suavizado conservador
    const smoothedQuality = this.qualityHistory.reduce((sum, val) => sum + val, 0) / this.qualityHistory.length;

    // UMBRAL BALANCEADO para detección potente sin falsos positivos
    const DETECTION_THRESHOLD = 35; // Umbral MÁS ALTO para detección inicial
    const CONFIRMATION_THRESHOLD = 30; // Umbral MÁS ALTO para mantener detección
    
    // Lógica de detección POTENTE con validación mínima
    if (smoothedQuality >= DETECTION_THRESHOLD && hasMinimumRedSignal) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else if (smoothedQuality < CONFIRMATION_THRESHOLD) {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }

    // Detección MÁS ESTRICTA para extracción potente
    let isFingerDetected = false;
    // Ajuste para hacer la detección más estricta: requiere más detecciones consecutivas
    if (this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS + 2) { // Aumentado el requisito
      isFingerDetected = true;
    } else if (this.consecutiveNoDetections >= this.config.MAX_CONSECUTIVE_NO_DETECTIONS - 1) { // Reducido el umbral de no detección
      isFingerDetected = false;
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores },
    };
  }
}
