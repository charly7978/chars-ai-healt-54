/**
 * Integrated Detection System
 * Sistema integrado de detección avanzada que combina detección de dedo y latidos
 * Basado en algoritmos médicos reales de PPG sin simulaciones
 */

import { AdvancedFingerDetection, FingerDetectionResult } from './AdvancedFingerDetection';
import { AdvancedHeartbeatDetection, HeartbeatDetectionResult } from './AdvancedHeartbeatDetection';

export interface IntegratedDetectionConfig {
  fingerDetection: {
    enabled: boolean;
    minPulsatilityThreshold: number;
    maxPulsatilityThreshold: number;
    minSignalAmplitude: number;
    maxSignalAmplitude: number;
    spectralAnalysisWindow: number;
    motionArtifactThreshold: number;
    skinToneValidation: boolean;
    perfusionIndexThreshold: number;
    confidenceThreshold: number;
  };
  heartbeatDetection: {
    enabled: boolean;
    samplingRate: number;
    minHeartRate: number;
    maxHeartRate: number;
    spectralAnalysisWindow: number;
    peakDetectionSensitivity: number;
    motionArtifactThreshold: number;
    signalQualityThreshold: number;
    confidenceThreshold: number;
    adaptiveFiltering: boolean;
    spectralValidation: boolean;
  };
  fusion: {
    enabled: boolean;
    method: 'weighted' | 'voting' | 'ensemble';
    fingerWeight: number;
    heartbeatWeight: number;
    minCombinedConfidence: number;
  };
}

export interface IntegratedDetectionResult {
  // Resultados de detección de dedo
  fingerDetection: FingerDetectionResult;
  
  // Resultados de detección de latidos
  heartbeatDetection: HeartbeatDetectionResult;
  
  // Resultado integrado
  isMonitoringValid: boolean;
  combinedConfidence: number;
  overallSignalQuality: number;
  motionArtifactLevel: number;
  
  // Métricas combinadas
  combinedMetrics: {
    heartRate: number;
    pulsatilityIndex: number;
    perfusionIndex: number;
    signalToNoiseRatio: number;
    spectralEntropy: number;
  };
  
  // Validación biofísica integrada
  bioPhysicalValidation: {
    isValidFingerPosition: boolean;
    isValidHeartRate: boolean;
    isValidSignalQuality: boolean;
    isValidMotionLevel: boolean;
    isValidSpectralProfile: boolean;
  };
  
  // Información de procesamiento
  processingInfo: {
    algorithmsUsed: string[];
    fusionMethod: string;
    processingLatency: number;
    timestamp: number;
  };
}

export class IntegratedDetectionSystem {
  private config: IntegratedDetectionConfig;
  private fingerDetector: AdvancedFingerDetection;
  private heartbeatDetector: AdvancedHeartbeatDetection;
  private detectionHistory: IntegratedDetectionResult[] = [];
  private processingStartTime: number = 0;
  
  // Parámetros médicamente validados para sistema integrado
  private readonly DEFAULT_CONFIG: IntegratedDetectionConfig = {
    fingerDetection: {
      enabled: true,
      minPulsatilityThreshold: 0.15,
      maxPulsatilityThreshold: 0.85,
      minSignalAmplitude: 0.05,
      maxSignalAmplitude: 0.95,
      spectralAnalysisWindow: 300,
      motionArtifactThreshold: 0.3,
      skinToneValidation: true,
      perfusionIndexThreshold: 0.2,
      confidenceThreshold: 0.7
    },
    heartbeatDetection: {
      enabled: true,
      samplingRate: 60,
      minHeartRate: 30,
      maxHeartRate: 220,
      spectralAnalysisWindow: 300,
      peakDetectionSensitivity: 0.6,
      motionArtifactThreshold: 0.3,
      signalQualityThreshold: 0.5,
      confidenceThreshold: 0.7,
      adaptiveFiltering: true,
      spectralValidation: true
    },
    fusion: {
      enabled: true,
      method: 'weighted',
      fingerWeight: 0.4,
      heartbeatWeight: 0.6,
      minCombinedConfidence: 0.75
    }
  };

  constructor(config: Partial<IntegratedDetectionConfig> = {}) {
    this.config = this.mergeConfigs(this.DEFAULT_CONFIG, config);
    
    // Inicializar detectores
    this.fingerDetector = new AdvancedFingerDetection(this.config.fingerDetection);
    this.heartbeatDetector = new AdvancedHeartbeatDetection(this.config.heartbeatDetection);
    
    this.processingStartTime = Date.now();
  }

  /**
   * Procesa una nueva muestra de datos RGB para detección integrada
   */
  public processSample(
    red: number,
    green: number,
    blue: number,
    timestamp: number
  ): IntegratedDetectionResult | null {
    const processingStart = performance.now();
    
    // 1. Detección de dedo
    const fingerResult = this.config.fingerDetection.enabled ?
      this.fingerDetector.processSample(red, green, blue, timestamp) :
      this.createEmptyFingerResult(timestamp);
    
    // 2. Extraer señal PPG para detección de latidos
    const ppgSignal = this.extractPPGSignal(red, green, blue);
    
    // 3. Detección de latidos
    const heartbeatResult = this.config.heartbeatDetection.enabled ?
      this.heartbeatDetector.processSample(ppgSignal, timestamp) :
      this.createEmptyHeartbeatResult(timestamp);
    
    // 4. Fusión de resultados
    const fusedResult = this.fuseResults(fingerResult, heartbeatResult, timestamp);
    
    // 5. Calcular métricas combinadas
    const combinedMetrics = this.calculateCombinedMetrics(fingerResult, heartbeatResult);
    
    // 6. Validación biofísica integrada
    const bioPhysicalValidation = this.validateIntegratedBioPhysical(
      fingerResult,
      heartbeatResult,
      combinedMetrics
    );
    
    // 7. Decisión final de monitoreo válido
    const isMonitoringValid = this.makeIntegratedDecision(
      fingerResult,
      heartbeatResult,
      fusedResult,
      bioPhysicalValidation
    );
    
    // 8. Calcular confianza combinada
    const combinedConfidence = this.calculateCombinedConfidence(
      fingerResult,
      heartbeatResult,
      bioPhysicalValidation
    );
    
    // 9. Calcular calidad de señal general
    const overallSignalQuality = this.calculateOverallSignalQuality(
      fingerResult,
      heartbeatResult,
      combinedMetrics
    );
    
    // 10. Calcular nivel de artefacto de movimiento general
    const motionArtifactLevel = this.calculateOverallMotionLevel(
      fingerResult,
      heartbeatResult
    );
    
    const processingLatency = performance.now() - processingStart;
    
    const result: IntegratedDetectionResult = {
      fingerDetection: fingerResult,
      heartbeatDetection: heartbeatResult,
      isMonitoringValid,
      combinedConfidence,
      overallSignalQuality,
      motionArtifactLevel,
      combinedMetrics,
      bioPhysicalValidation,
      processingInfo: {
        algorithmsUsed: this.getAlgorithmsUsed(fingerResult, heartbeatResult),
        fusionMethod: this.config.fusion.method,
        processingLatency,
        timestamp
      }
    };
    
    // Actualizar historial
    this.updateDetectionHistory(result);
    
    return result;
  }

  /**
   * Extrae señal PPG de datos RGB
   */
  private extractPPGSignal(red: number, green: number, blue: number): number {
    // Algoritmo PPG basado en absorción de longitudes de onda
    // Verde tiene mejor absorción para PPG
    const normalizedRed = red / 255;
    const normalizedGreen = green / 255;
    const normalizedBlue = blue / 255;
    
    // Señal PPG ponderada (verde tiene mayor peso)
    const ppgSignal = 0.3 * normalizedRed + 0.6 * normalizedGreen + 0.1 * normalizedBlue;
    
    return ppgSignal;
  }

  /**
   * Fusión de resultados de detección
   */
  private fuseResults(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult,
    timestamp: number
  ): any {
    if (!this.config.fusion.enabled) {
      return {
        confidence: Math.max(fingerResult.confidence, heartbeatResult.confidence),
        method: 'none'
      };
    }
    
    switch (this.config.fusion.method) {
      case 'weighted':
        return this.weightedFusion(fingerResult, heartbeatResult);
      case 'voting':
        return this.votingFusion(fingerResult, heartbeatResult);
      case 'ensemble':
        return this.ensembleFusion(fingerResult, heartbeatResult);
      default:
        return this.weightedFusion(fingerResult, heartbeatResult);
    }
  }

  /**
   * Fusión ponderada
   */
  private weightedFusion(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult
  ): any {
    const fingerWeight = this.config.fusion.fingerWeight;
    const heartbeatWeight = this.config.fusion.heartbeatWeight;
    
    const combinedConfidence = fingerWeight * fingerResult.confidence + 
                               heartbeatWeight * heartbeatResult.confidence;
    
    return {
      confidence: combinedConfidence,
      method: 'weighted',
      fingerContribution: fingerWeight * fingerResult.confidence,
      heartbeatContribution: heartbeatWeight * heartbeatResult.confidence
    };
  }

  /**
   * Fusión por votación
   */
  private votingFusion(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult
  ): any {
    const fingerVote = fingerResult.confidence > this.config.fingerDetection.confidenceThreshold ? 1 : 0;
    const heartbeatVote = heartbeatResult.confidence > this.config.heartbeatDetection.confidenceThreshold ? 1 : 0;
    
    const totalVotes = fingerVote + heartbeatVote;
    const combinedConfidence = totalVotes / 2;
    
    return {
      confidence: combinedConfidence,
      method: 'voting',
      fingerVote,
      heartbeatVote,
      totalVotes
    };
  }

  /**
   * Fusión por ensemble
   */
  private ensembleFusion(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult
  ): any {
    // Ensemble basado en múltiples criterios
    const criteria = [
      fingerResult.confidence,
      heartbeatResult.confidence,
      fingerResult.signalQuality,
      heartbeatResult.signalQuality,
      1 - fingerResult.motionArtifactLevel,
      1 - heartbeatResult.motionArtifactLevel
    ];
    
    const combinedConfidence = criteria.reduce((sum, criterion) => sum + criterion, 0) / criteria.length;
    
    return {
      confidence: combinedConfidence,
      method: 'ensemble',
      criteria,
      averageConfidence: combinedConfidence
    };
  }

  /**
   * Cálculo de métricas combinadas
   */
  private calculateCombinedMetrics(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult
  ): IntegratedDetectionResult['combinedMetrics'] {
    return {
      heartRate: heartbeatResult.heartRate,
      pulsatilityIndex: fingerResult.pulsatilityIndex,
      perfusionIndex: fingerResult.perfusionIndex,
      signalToNoiseRatio: Math.max(
        fingerResult.spectralFeatures.signalToNoiseRatio || 0,
        heartbeatResult.spectralFeatures.signalToNoiseRatio || 0
      ),
      spectralEntropy: (fingerResult.spectralFeatures.spectralEntropy + 
                        heartbeatResult.spectralFeatures.spectralEntropy) / 2
    };
  }

  /**
   * Validación biofísica integrada
   */
  private validateIntegratedBioPhysical(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult,
    combinedMetrics: IntegratedDetectionResult['combinedMetrics']
  ): IntegratedDetectionResult['bioPhysicalValidation'] {
    return {
      isValidFingerPosition: fingerResult.isFingerDetected && 
                             fingerResult.bioPhysicalValidation.isValidSkinTone,
      isValidHeartRate: heartbeatResult.bioPhysicalValidation.isValidHeartRate,
      isValidSignalQuality: Math.min(fingerResult.signalQuality, heartbeatResult.signalQuality) > 0.5,
      isValidMotionLevel: Math.max(fingerResult.motionArtifactLevel, heartbeatResult.motionArtifactLevel) < 0.3,
      isValidSpectralProfile: fingerResult.bioPhysicalValidation.isValidSpectralProfile &&
                              heartbeatResult.bioPhysicalValidation.isValidSpectralProfile
    };
  }

  /**
   * Decisión integrada de monitoreo válido
   */
  private makeIntegratedDecision(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult,
    fusedResult: any,
    bioPhysicalValidation: IntegratedDetectionResult['bioPhysicalValidation']
  ): boolean {
    // Requerir detección de dedo
    if (!fingerResult.isFingerDetected) {
      return false;
    }
    
    // Requerir detección de latidos
    if (!heartbeatResult.isHeartbeatDetected) {
      return false;
    }
    
    // Requerir confianza combinada mínima
    if (fusedResult.confidence < this.config.fusion.minCombinedConfidence) {
      return false;
    }
    
    // Requerir validación biofísica
    const validBioPhysicalCount = Object.values(bioPhysicalValidation).filter(Boolean).length;
    if (validBioPhysicalCount < 4) {
      return false;
    }
    
    return true;
  }

  /**
   * Cálculo de confianza combinada
   */
  private calculateCombinedConfidence(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult,
    bioPhysicalValidation: IntegratedDetectionResult['bioPhysicalValidation']
  ): number {
    const fingerConfidence = fingerResult.confidence;
    const heartbeatConfidence = heartbeatResult.confidence;
    const bioPhysicalScore = Object.values(bioPhysicalValidation).filter(Boolean).length / 5;
    
    // Ponderación: 40% dedo, 40% latidos, 20% validación biofísica
    const combinedConfidence = 0.4 * fingerConfidence + 
                              0.4 * heartbeatConfidence + 
                              0.2 * bioPhysicalScore;
    
    return Math.max(0, Math.min(1, combinedConfidence));
  }

  /**
   * Cálculo de calidad de señal general
   */
  private calculateOverallSignalQuality(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult,
    combinedMetrics: IntegratedDetectionResult['combinedMetrics']
  ): number {
    const fingerQuality = fingerResult.signalQuality;
    const heartbeatQuality = heartbeatResult.signalQuality;
    const spectralQuality = Math.min(1, combinedMetrics.signalToNoiseRatio / 5.0);
    const pulsatilityQuality = Math.min(1, combinedMetrics.pulsatilityIndex / 0.3);
    
    // Calidad general ponderada
    const overallQuality = 0.3 * fingerQuality +
                          0.3 * heartbeatQuality +
                          0.2 * spectralQuality +
                          0.2 * pulsatilityQuality;
    
    return Math.max(0, Math.min(1, overallQuality));
  }

  /**
   * Cálculo de nivel de movimiento general
   */
  private calculateOverallMotionLevel(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult
  ): number {
    return Math.max(fingerResult.motionArtifactLevel, heartbeatResult.motionArtifactLevel);
  }

  /**
   * Obtener algoritmos utilizados
   */
  private getAlgorithmsUsed(
    fingerResult: FingerDetectionResult,
    heartbeatResult: HeartbeatDetectionResult
  ): string[] {
    const algorithms: string[] = [];
    
    if (this.config.fingerDetection.enabled) {
      algorithms.push('AdvancedFingerDetection');
    }
    
    if (this.config.heartbeatDetection.enabled) {
      algorithms.push('AdvancedHeartbeatDetection');
    }
    
    if (this.config.fusion.enabled) {
      algorithms.push(`Fusion_${this.config.fusion.method}`);
    }
    
    return algorithms;
  }

  /**
   * Crear resultado vacío de dedo
   */
  private createEmptyFingerResult(timestamp: number): FingerDetectionResult {
    return {
      isFingerDetected: false,
      confidence: 0,
      pulsatilityIndex: 0,
      signalQuality: 0,
      motionArtifactLevel: 0,
      skinToneValidation: false,
      perfusionIndex: 0,
      spectralFeatures: {
        dominantFrequency: 0,
        spectralPower: 0,
        spectralEntropy: 0,
        harmonicRatio: 0
      },
      bioPhysicalValidation: {
        isValidSkinTone: false,
        isValidPulsatility: false,
        isValidAmplitude: false,
        isValidSpectralProfile: false
      },
      timestamp
    };
  }

  /**
   * Crear resultado vacío de latidos
   */
  private createEmptyHeartbeatResult(timestamp: number): HeartbeatDetectionResult {
    return {
      isHeartbeatDetected: false,
      heartRate: 0,
      confidence: 0,
      signalQuality: 0,
      motionArtifactLevel: 0,
      peakAmplitude: 0,
      rrInterval: 0,
      spectralFeatures: {
        dominantFrequency: 0,
        spectralPower: 0,
        spectralEntropy: 0,
        harmonicRatio: 0,
        signalToNoiseRatio: 0
      },
      bioPhysicalValidation: {
        isValidHeartRate: false,
        isValidRRInterval: false,
        isValidSpectralProfile: false,
        isValidPeakAmplitude: false
      },
      timestamp
    };
  }

  /**
   * Actualizar historial de detección
   */
  private updateDetectionHistory(result: IntegratedDetectionResult): void {
    this.detectionHistory.push(result);
    
    // Mantener solo los últimos 100 resultados
    if (this.detectionHistory.length > 100) {
      this.detectionHistory.shift();
    }
  }

  /**
   * Combinar configuraciones
   */
  private mergeConfigs(
    defaultConfig: IntegratedDetectionConfig,
    userConfig: Partial<IntegratedDetectionConfig>
  ): IntegratedDetectionConfig {
    return {
      fingerDetection: { ...defaultConfig.fingerDetection, ...userConfig.fingerDetection },
      heartbeatDetection: { ...defaultConfig.heartbeatDetection, ...userConfig.heartbeatDetection },
      fusion: { ...defaultConfig.fusion, ...userConfig.fusion }
    };
  }

  /**
   * Obtener estadísticas del sistema
   */
  public getSystemStats(): {
    totalSamples: number;
    validMonitoringRate: number;
    averageConfidence: number;
    averageSignalQuality: number;
    averageProcessingLatency: number;
    fingerDetectionStats: any;
    heartbeatDetectionStats: any;
    lastResult: IntegratedDetectionResult | null;
  } {
    if (this.detectionHistory.length === 0) {
      return {
        totalSamples: 0,
        validMonitoringRate: 0,
        averageConfidence: 0,
        averageSignalQuality: 0,
        averageProcessingLatency: 0,
        fingerDetectionStats: null,
        heartbeatDetectionStats: null,
        lastResult: null
      };
    }
    
    const validResults = this.detectionHistory.filter(result => result.isMonitoringValid);
    const validMonitoringRate = validResults.length / this.detectionHistory.length;
    const averageConfidence = this.detectionHistory.reduce((sum, result) => sum + result.combinedConfidence, 0) / this.detectionHistory.length;
    const averageSignalQuality = this.detectionHistory.reduce((sum, result) => sum + result.overallSignalQuality, 0) / this.detectionHistory.length;
    const averageProcessingLatency = this.detectionHistory.reduce((sum, result) => sum + result.processingInfo.processingLatency, 0) / this.detectionHistory.length;
    const lastResult = this.detectionHistory[this.detectionHistory.length - 1];
    
    return {
      totalSamples: this.detectionHistory.length,
      validMonitoringRate,
      averageConfidence,
      averageSignalQuality,
      averageProcessingLatency,
      fingerDetectionStats: this.fingerDetector.getDetectionStats(),
      heartbeatDetectionStats: this.heartbeatDetector.getDetectionStats(),
      lastResult
    };
  }

  /**
   * Reset del sistema
   */
  public reset(): void {
    this.fingerDetector.reset();
    this.heartbeatDetector.reset();
    this.detectionHistory = [];
    this.processingStartTime = Date.now();
  }

  /**
   * Actualizar configuración
   */
  public updateConfig(newConfig: Partial<IntegratedDetectionConfig>): void {
    this.config = this.mergeConfigs(this.config, newConfig);
    
    // Actualizar configuraciones de detectores
    this.fingerDetector.updateConfig(this.config.fingerDetection);
    this.heartbeatDetector.updateConfig(this.config.heartbeatDetection);
  }
} 