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
  private readonly DETECTION_TIMEOUT = 3000; // Reducido para respuesta más rápida (antes 5000)
  private readonly MOTION_ARTIFACT_THRESHOLD = 0.75; // Ajustado para mejor equilibrio (era 0.7)
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
      MIN_CONSECUTIVE_DETECTIONS: 3,
      MAX_CONSECUTIVE_NO_DETECTIONS: 3
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
  }): void {
    // Store actual scores with enhancement multipliers
    this.detectorScores.redChannel = Math.max(0, Math.min(1, scores.redChannel * 1.2)); // Aumentado (antes 1.1)
    this.detectorScores.stability = Math.max(0, Math.min(1, scores.stability * 1.1)); // Incrementado levemente (antes 1.05)
    this.detectorScores.pulsatility = Math.max(0, Math.min(1, scores.pulsatility * 1.25)); // Aumentado significativamente (antes 1.15)
    this.detectorScores.biophysical = Math.max(0, Math.min(1, scores.biophysical * 1.1)); // Ahora también se aumenta (antes sin multiplicador)
    this.detectorScores.periodicity = Math.max(0, Math.min(1, scores.periodicity * 1.1)); // Aumentado levemente (antes sin multiplicador)
    
    // Store texture score if available
    if (typeof scores.textureScore !== 'undefined') {
      this.detectorScores.textureScore = scores.textureScore;
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
      this.motionArtifactScore = this.motionArtifactScore * 0.7 + (normalizedChange > 0.55 ? 0.3 : 0); // Umbral aumentado (antes 0.5)
      
      // Aplicar penalización de artefacto más suave
      if (this.motionArtifactScore > this.MOTION_ARTIFACT_THRESHOLD) {
        this.detectorScores.stability *= 0.7; // Penalización más suave (antes 0.6)
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
      this.adaptiveThreshold = 0.04; // Umbral más alto para evitar falsos positivos
    } else if (cv < 0.1) { // Estable
      this.adaptiveThreshold = 0.025; // Umbral moderado
    } else { // Variable
      this.adaptiveThreshold = 0.02; // Umbral más bajo para mejorar detección
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
    this.qualityHistory.push(this.detectorScores.redChannel);
    if (this.qualityHistory.length > this.CONFIG.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    const avgQuality = this.qualityHistory.reduce((sum, q) => sum + q, 0) / this.qualityHistory.length;
    // Umbrales de calidad para detección inicial
    const qualityOn = this.adaptiveThreshold;
    const qualityOff = this.adaptiveThreshold * 0.5;
    // Umbrales adicionales para robustez en adquisición
    const stabilityOn = 0.4;
    const pulseOn = 0.3;
    // Nuevo umbral de periodicidad para evitar detecciones sin pulso real
    const periodicityOn = 0.5;
    // Lógica de histeresis: adquisición vs mantenimiento
    if (!this.isCurrentlyDetected) {
      // Detección inicial: calidad, tendencia válida, estabilidad, pulsatilidad y periodicidad
      if (avgQuality > qualityOn && trendResult !== 'non_physiological' &&
          this.detectorScores.stability > stabilityOn &&
          this.detectorScores.pulsatility > pulseOn &&
          this.detectorScores.periodicity > periodicityOn) {
        this.consecutiveDetections++;
      } else {
        this.consecutiveDetections = 0;
      }
    } else {
      // Mantenimiento: estabilidad, pulsatilidad y periodicidad para confirmar dedo
      const stabilityOff = 0.3;
      const pulseOff = 0.25;
      const periodicityOff = 0.4;
      if (avgQuality < qualityOff || trendResult === 'non_physiological' ||
          this.detectorScores.stability < stabilityOff ||
          this.detectorScores.pulsatility < pulseOff ||
          this.detectorScores.periodicity < periodicityOff) {
        this.consecutiveNoDetections++;
      } else {
        this.consecutiveNoDetections = 0;
      }
    }
    // Cambiar estado tras N cuadros consecutivos
    if (!this.isCurrentlyDetected && this.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_DETECTIONS) {
      this.isCurrentlyDetected = true;
    }
    if (this.isCurrentlyDetected && this.consecutiveNoDetections >= this.CONFIG.MAX_CONSECUTIVE_NO_DETECTIONS) {
      this.isCurrentlyDetected = false;
    }
    return {
      isFingerDetected: this.isCurrentlyDetected,
      quality: Math.round(avgQuality * 100),
      detectorDetails: {
        ...this.detectorScores,
        avgQuality,
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
