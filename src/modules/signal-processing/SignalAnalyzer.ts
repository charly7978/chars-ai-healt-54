import { ProcessedSignal } from '../../types/signal';
import { DetectorScores, DetectionResult } from './types';

/**
 * Clase para análisis de señales de PPG y detección de dedo
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */
export class SignalAnalyzer {
  private readonly CONFIG: { 
    QUALITY_LEVELS: number;
    QUALITY_HISTORY_SIZE: number;
    MIN_CONSECUTIVE_DETECTIONS: number;
    MAX_CONSECUTIVE_NO_DETECTIONS: number;
  };
  private detectorScores: DetectorScores = {
    redChannel: 0,
    stability: 0,
    pulsatility: 0,
    biophysical: 0,
    periodicity: 0
  };
  private stableFrameCount: number = 0;
  private lastStableValue: number = 0;
  private consecutiveDetections: number = 0;
  private consecutiveNoDetections: number = 0;
  private isCurrentlyDetected: boolean = false;
  private lastDetectionTime: number = 0;
  private qualityHistory: number[] = [];
  private motionArtifactScore: number = 0;
  private readonly DETECTION_TIMEOUT = 5000; // Reducido para respuesta más rápida (antes 5000)
  private readonly MOTION_ARTIFACT_THRESHOLD = 0.7; // Ajustado para mejor equilibrio (era 0.7)
  private valueHistory: number[] = []; // Track signal history for artifact detection
  // Nuevo: calibración adaptativa
  private calibrationPhase: boolean = true;
  private calibrationSamples: number[] = [];
  private readonly CALIBRATION_SAMPLE_SIZE = 20;
  private adaptiveThreshold: number = 0.1; // Umbral inicial que se ajustará (más estricto)
  
  constructor(config: { 
    QUALITY_LEVELS: number;
    QUALITY_HISTORY_SIZE: number;
    MIN_CONSECUTIVE_DETECTIONS: number;
    MAX_CONSECUTIVE_NO_DETECTIONS: number;
  }) {
    // Configuración de hysteresis simétrica para detección más rápida
    this.CONFIG = {
      QUALITY_LEVELS: config.QUALITY_LEVELS,
      QUALITY_HISTORY_SIZE: config.QUALITY_HISTORY_SIZE,
      MIN_CONSECUTIVE_DETECTIONS: 6,
      MAX_CONSECUTIVE_NO_DETECTIONS: 4
    };
  }
  
  updateDetectorScores(scores: {
    redValue: number;
    redChannel: number;
    stability: number;
    pulsatility: number;
    biophysical: number;
    periodicity: number;
    textureScore?: number; // Opcional para compatibilidad
    lightQuality?: number; // Nuevo: Calidad de la luz
  }): void {
    // Store actual scores with enhancement multipliers
    this.detectorScores.redChannel = Math.max(0, Math.min(1, scores.redChannel * 1.1));
    this.detectorScores.stability = Math.max(0, Math.min(1, scores.stability * 1.1));
    this.detectorScores.pulsatility = Math.max(0, Math.min(1, scores.pulsatility * 1.15));
    this.detectorScores.biophysical = Math.max(0, Math.min(1, scores.biophysical * 1.1));
    this.detectorScores.periodicity = Math.max(0, Math.min(1, scores.periodicity * 1.1));
    
    // Store texture score if available
    if (typeof scores.textureScore !== 'undefined') {
      this.detectorScores.textureScore = scores.textureScore;
    }
    
    // Store light quality if available
    if (typeof scores.lightQuality !== 'undefined') {
      this.detectorScores.lightQuality = scores.lightQuality;
    }
    
    // Track values for motion artifact detection
    this.valueHistory.push(scores.redValue);
    if (this.valueHistory.length > 15) {
      this.valueHistory.shift();
    }
    
    // Detectar artefactos de movimiento con tolerancia ajustada
    if (this.valueHistory.length >= 5) {
      const recentValues = this.valueHistory.slice(-5);
      const maxChange = Math.max(...recentValues) - Math.min(...recentValues);
      const meanValue = recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
      
      // Calcular cambio normalizado como porcentaje de media - más tolerante
      const normalizedChange = meanValue > 0 ? maxChange / meanValue : 0;
      
      // Update motion artifact score with smoothing
      this.motionArtifactScore = this.motionArtifactScore * 0.7 + (normalizedChange > 0.5 ? 0.3 : 0); // Umbral aumentado (antes 0.5)
      
      // Aplicar penalización de artefacto más suave
      if (this.motionArtifactScore > this.MOTION_ARTIFACT_THRESHOLD) {
        this.detectorScores.stability *= 0.6; // Penalización más suave (antes 0.6)
      }
    }
    
    // Calibración adaptativa - recolectar muestras en fase de calibración
    if (this.calibrationPhase && this.detectorScores.redChannel > 0.1) {
      this.calibrationSamples.push(scores.redValue);
      
      // Cuando tenemos suficientes muestras, calibramos el umbral
      if (this.calibrationSamples.length >= this.CALIBRATION_SAMPLE_SIZE) {
        this.calibrateAdaptiveThreshold();
        this.calibrationPhase = false;
      }
    }
    
    console.log("SignalAnalyzer: Updated detector scores:", {
      redValue: scores.redValue,
      redChannel: this.detectorScores.redChannel,
      stability: this.detectorScores.stability,
      pulsatility: this.detectorScores.pulsatility,
      biophysical: this.detectorScores.biophysical,
      periodicity: this.detectorScores.periodicity,
      lightQuality: this.detectorScores.lightQuality,
      motionArtifact: this.motionArtifactScore,
      adaptiveThreshold: this.adaptiveThreshold,
      calibrationPhase: this.calibrationPhase
    });
  }

  // Nuevo método para calibración adaptativa del umbral
  private calibrateAdaptiveThreshold(): void {
    // Ordenar muestras y eliminar valores extremos (10% superior e inferior)
    const sortedSamples = [...this.calibrationSamples].sort((a, b) => a - b);
    const trimCount = Math.floor(sortedSamples.length * 0.1);
    const trimmedSamples = sortedSamples.slice(trimCount, sortedSamples.length - trimCount);
    
    // Calcular media y desviación estándar
    const mean = trimmedSamples.reduce((sum, val) => sum + val, 0) / trimmedSamples.length;
    const variance = trimmedSamples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / trimmedSamples.length;
    const stdDev = Math.sqrt(variance);
    
    // Calcular coeficiente de variación (CV) para ajustar sensibilidad
    const cv = mean > 0 ? stdDev / mean : 1;
    
    // Ajustar umbral según variabilidad - menor variabilidad requiere umbral más alto
    // para evitar falsos positivos, mayor variabilidad requiere umbral más bajo
    if (cv < 0.05) { // Muy estable
      this.adaptiveThreshold = 0.035; // Umbral más alto para evitar falsos positivos
    } else if (cv < 0.1) { // Estable
      this.adaptiveThreshold = 0.02; // Umbral moderado
    } else { // Variable
      this.adaptiveThreshold = 0.015; // Umbral más bajo para mejorar detección
    }
    
    console.log("SignalAnalyzer: Calibración adaptativa completada", {
      muestras: this.calibrationSamples.length,
      media: mean.toFixed(2),
      desviacionEstandar: stdDev.toFixed(2),
      coeficienteVariacion: cv.toFixed(3),
      umbralAdaptativo: this.adaptiveThreshold
    });
    
    // Limpiar muestras de calibración
    this.calibrationSamples = [];
  }

  // LÓGICA ULTRA-SIMPLIFICADA: solo detecta dedo si el canal rojo supera un umbral adaptativo
  analyzeSignalMultiDetector(
    filtered: number,
    trendResult: any
  ): DetectionResult {
    // Actualizar historial de calidad y calcular calidad media
    const combinedQualityFactors: number[] = [];

    // Ponderaciones de los factores de calidad (ajustadas para mayor precisión y menos falsos positivos)
    const WEIGHT_RED_CHANNEL = 0.25; // Aumentado ligeramente
    const WEIGHT_STABILITY = 0.20;    // Mantener importante
    const WEIGHT_PULSATILITY = 0.20;  // Mantener importante
    const WEIGHT_BIOPHYSICAL = 0.15;  // Mantener importante
    const WEIGHT_PERIODICITY = 0.10;  // Mantener importante
    const WEIGHT_LIGHT_QUALITY = 0.10; // Nuevo: Muy importante para evitar falsos positivos por mala iluminación

    // Calcular la calidad combinada
    let weightedSum = 
      (this.detectorScores.redChannel * WEIGHT_RED_CHANNEL) +
      (this.detectorScores.stability * WEIGHT_STABILITY) +
      (this.detectorScores.pulsatility * WEIGHT_PULSATILITY) +
      (this.detectorScores.biophysical * WEIGHT_BIOPHYSICAL) +
      (this.detectorScores.periodicity * WEIGHT_PERIODICITY);
    
    // Asegurarse de que lightQuality esté presente antes de usarlo
    if (typeof this.detectorScores.lightQuality !== 'undefined') {
      weightedSum += (this.detectorScores.lightQuality * WEIGHT_LIGHT_QUALITY);
    }

    const totalWeight = WEIGHT_RED_CHANNEL + WEIGHT_STABILITY + WEIGHT_PULSATILITY + WEIGHT_BIOPHYSICAL + WEIGHT_PERIODICITY + WEIGHT_LIGHT_QUALITY;
    const avgQuality = (weightedSum / totalWeight) * 100; // Escalar a 0-100

    this.qualityHistory.push(avgQuality);
    if (this.qualityHistory.length > this.CONFIG.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    const smoothedAvgQuality = this.qualityHistory.reduce((sum, q) => sum + q, 0) / this.qualityHistory.length;

    // Umbrales de detección más estrictos y basados en la calidad combinada
    const detectionThreshold = 50; // Umbral más alto para detección de dedo (antes 50)
    const releaseThreshold = 40;   // Umbral de liberación ligeramente más bajo (antes 40)

    // Lógica de histeresis para la detección del dedo
    if (!this.isCurrentlyDetected) {
      // Detección inicial: La calidad debe ser ALTA y la señal debe ser fisiológica y estable
      if (smoothedAvgQuality > detectionThreshold && trendResult !== 'non_physiological' &&
          this.detectorScores.pulsatility > 0.3 && // Pulsatilidad fisiológica mínima
          this.detectorScores.biophysical > 0.4 && // Rango biofísico aceptable
          (typeof this.detectorScores.lightQuality === 'undefined' || this.detectorScores.lightQuality > 0.4)) { // Buena iluminación
        this.consecutiveDetections++;
        this.consecutiveNoDetections = 0; // Resetear contador de no detección
      } else {
        this.consecutiveDetections = 0;
        this.consecutiveNoDetections++; // Contar frames sin detección
      }
    } else {
      // Mantenimiento de detección: La calidad debe mantenerse por encima de un umbral de liberación
      if (smoothedAvgQuality < releaseThreshold || trendResult === 'non_physiological' ||
          this.detectorScores.pulsatility < 0.3 || // Pérdida de pulsatilidad
          this.detectorScores.biophysical < 0.4 || // Fuera de rango biofísico
          (typeof this.detectorScores.lightQuality === 'undefined' || this.detectorScores.lightQuality < 0.3)) { // Mala iluminación
        this.consecutiveNoDetections++;
        this.consecutiveDetections = 0; // Resetear contador de detección
      } else {
        this.consecutiveNoDetections = 0;
        this.consecutiveDetections++; // Contar frames con detección
      }
    }

    // Actualizar estado de detección del dedo
    if (this.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_DETECTIONS) {
      this.isCurrentlyDetected = true;
      this.lastDetectionTime = Date.now();
    } else if (this.consecutiveNoDetections >= this.CONFIG.MAX_CONSECUTIVE_NO_DETECTIONS ||
               (this.isCurrentlyDetected && (Date.now() - this.lastDetectionTime > this.DETECTION_TIMEOUT))) {
      this.isCurrentlyDetected = false;
    }

    return {
      isFingerDetected: this.isCurrentlyDetected,
      quality: Math.round(smoothedAvgQuality),
      detectorDetails: {
        ...this.detectorScores,
        avgQuality: smoothedAvgQuality,
        consecutiveDetections: this.consecutiveDetections,
        consecutiveNoDetections: this.consecutiveNoDetections
      }
    };
  }
  
  updateLastStableValue(value: number): void {
    this.lastStableValue = value;
  }
  
  getLastStableValue(): number {
    return this.lastStableValue;
  }
  
  reset(): void {
    this.stableFrameCount = 0;
    this.lastStableValue = 0;
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    this.isCurrentlyDetected = false;
    this.lastDetectionTime = 0;
    this.qualityHistory = [];
    this.motionArtifactScore = 0;
    this.valueHistory = [];
    this.calibrationPhase = true; // Reiniciar fase de calibración
    this.calibrationSamples = []; // Limpiar muestras de calibración
    this.adaptiveThreshold = 0.1; // Restablecer umbral adaptativo
    this.detectorScores = {
      redChannel: 0,
      stability: 0,
      pulsatility: 0,
      biophysical: 0,
      periodicity: 0
    };
    console.log("SignalAnalyzer: Reset complete");
  }
}
