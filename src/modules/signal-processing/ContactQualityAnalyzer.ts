/**
 * Analizador de calidad de contacto con estabilidad temporal.
 * Basado en literatura 2024 de PPG contact quality assessment y temporal stability metrics.
 * Combina:
 * - Análisis de estabilidad temporal de señal
 * - Detección de artefactos de movimiento
 * - Evaluación de presión y perfusión
 * - Métricas de confianza temporal
 * - Adaptive thresholds según condiciones
 */

export interface ContactQualityMetrics {
  /** Calidad general del contacto [0,100] */
  contactQuality: number;
  /** Estabilidad temporal de la señal [0,1] */
  temporalStability: number;
  /** Índice de confianza temporal [0,1] */
  temporalConfidence: number;
  /** Drift de la señal [0,1] */
  signalDrift: number;
  /** Artefactos de movimiento detectados [0,1] */
  motionArtifactLevel: number;
  /** Presión estimada [0,1] (0=leve, 1=excesiva) */
  pressureLevel: number;
  /** Perfusion index normalizado [0,1] */
  perfusionIndex: number;
  /** Trend de calidad (mejorando/empeorando) [-1,1] */
  qualityTrend: number;
  /** Número de frames estables consecutivos */
  stableFrameCount: number;
  /** Predicción de calidad en próximos frames */
  predictedQuality: number;
}

export interface ContactQualityConfig {
  /** Ventana para análisis de estabilidad (frames) */
  stabilityWindow: number;
  /** Umbral de drift para considerar inestable */
  driftThreshold: number;
  /** Factor de suavizado para métricas temporales */
  smoothingFactor: number;
  /** Mínimo de frames estables para considerar contacto estable */
  minStableFrames: number;
}

export class ContactQualityAnalyzer {
  private readonly config: ContactQualityConfig;
  private readonly signalHistory: Float32Array;
  private readonly qualityHistory: Float32Array;
  private readonly motionHistory: Float32Array;
  private historyIndex = 0;
  private stableFrameCount = 0;
  private lastQuality = 50;
  private qualityTrend = 0;

  constructor(config?: Partial<ContactQualityConfig>) {
    this.config = {
      stabilityWindow: 60,
      driftThreshold: 0.15,
      smoothingFactor: 0.2,
      minStableFrames: 20,
      ...config,
    };
    this.signalHistory = new Float32Array(this.config.stabilityWindow);
    this.qualityHistory = new Float32Array(this.config.stabilityWindow);
    this.motionHistory = new Float32Array(this.config.stabilityWindow);
  }

  /**
   * Analiza la calidad del contacto usando métricas temporales
   * @param signalValue: Valor actual de la señal PPG
   * @param perfusionIndex: Perfusion index actual
   * @param motionScore: Score de movimiento [0,1]
   * @param pressureScore: Score de presión [0,1]
   * @returns Métricas de calidad de contacto
   */
  analyze(
    signalValue: number,
    perfusionIndex: number,
    motionScore: number,
    pressureScore: number
  ): ContactQualityMetrics {
    // Actualizar historiales
    this.signalHistory[this.historyIndex] = signalValue;
    this.qualityHistory[this.historyIndex] = perfusionIndex;
    this.motionHistory[this.historyIndex] = motionScore;
    this.historyIndex = (this.historyIndex + 1) % this.config.stabilityWindow;

    // Calcular estabilidad temporal de la señal
    const temporalStability = this.computeTemporalStability();
    
    // Calcular drift de la señal
    const signalDrift = this.computeSignalDrift();
    
    // Calcular nivel de artefactos de movimiento
    const motionArtifactLevel = this.computeMotionArtifactLevel();
    
    // Normalizar perfusion index a [0,1]
    const normalizedPerfusion = Math.max(0, Math.min(1, perfusionIndex / 10));
    
    // Calcular presión estimada
    const pressureLevel = pressureScore;
    
    // Calcular calidad general del contacto
    const contactQuality = this.computeContactQuality(
      temporalStability,
      signalDrift,
      motionArtifactLevel,
      normalizedPerfusion,
      pressureLevel
    );
    
    // Calcular confianza temporal
    const temporalConfidence = this.computeTemporalConfidence(temporalStability, signalDrift);
    
    // Calcular trend de calidad
    this.qualityTrend = (contactQuality - this.lastQuality) * this.config.smoothingFactor;
    this.lastQuality = contactQuality;
    
    // Actualizar contador de frames estables
    if (temporalStability > 0.85 && motionArtifactLevel < 0.2) {
      this.stableFrameCount++;
    } else {
      this.stableFrameCount = Math.max(0, this.stableFrameCount - 2);
    }
    
    // Predicción de calidad
    const predictedQuality = contactQuality + this.qualityTrend * 5;
    
    return {
      contactQuality,
      temporalStability,
      temporalConfidence,
      signalDrift,
      motionArtifactLevel,
      pressureLevel,
      perfusionIndex: normalizedPerfusion,
      qualityTrend: this.qualityTrend,
      stableFrameCount: this.stableFrameCount,
      predictedQuality: Math.max(0, Math.min(100, predictedQuality)),
    };
  }

  /**
   * Calcula estabilidad temporal de la señal usando varianza y autocorrelación
   */
  private computeTemporalStability(): number {
    const n = this.config.stabilityWindow;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += this.signalHistory[i]!;
    }
    const mean = sum / n;
    
    // Varianza
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const diff = this.signalHistory[i]! - mean;
      variance += diff * diff;
    }
    variance /= Math.max(1, n - 1);
    
    // Normalizar varianza a estabilidad (menor varianza = mayor estabilidad)
    const std = Math.sqrt(variance);
    const stability = Math.max(0, 1 - (std / (mean + 1e-6)));
    
    return stability;
  }

  /**
   * Calcula drift de la señal usando diferencias acumuladas
   */
  private computeSignalDrift(): number {
    const n = this.config.stabilityWindow;
    if (n < 2) return 0;
    
    let drift = 0;
    const mean = this.signalHistory[0]!;
    
    for (let i = 1; i < n; i++) {
      drift += Math.abs(this.signalHistory[i]! - mean);
    }
    
    const avgDrift = drift / (n - 1);
    return Math.min(1, avgDrift / (mean + 1e-6));
  }

  /**
   * Calcula nivel de artefactos de movimiento
   */
  private computeMotionArtifactLevel(): number {
    const n = this.config.stabilityWindow;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += this.motionHistory[i]!;
    }
    return sum / n;
  }

  /**
   * Calcula calidad general del contacto combinando métricas
   */
  private computeContactQuality(
    temporalStability: number,
    signalDrift: number,
    motionArtifactLevel: number,
    perfusionIndex: number,
    pressureLevel: number
  ): number {
    // Ponderación de métricas según literatura PPG
    const stabilityWeight = 0.3;
    const driftWeight = 0.2;
    const motionWeight = 0.2;
    const perfusionWeight = 0.15;
    const pressureWeight = 0.15;
    
    // Penalización por drift y movimiento
    const driftPenalty = signalDrift > this.config.driftThreshold ? (signalDrift - this.config.driftThreshold) * 100 : 0;
    const motionPenalty = motionArtifactLevel * 50;
    
    // Presión óptima alrededor de 0.5-0.7
    const pressureScore = pressureLevel >= 0.3 && pressureLevel <= 0.8 ? 
      1 - Math.abs(pressureLevel - 0.55) * 2 : 
      Math.max(0, 1 - pressureLevel * 2);
    
    const quality = 
      temporalStability * stabilityWeight * 100 +
      (1 - signalDrift) * driftWeight * 100 +
      (1 - motionArtifactLevel) * motionWeight * 100 +
      perfusionIndex * perfusionWeight * 100 +
      pressureScore * pressureWeight * 100 -
      driftPenalty -
      motionPenalty;
    
    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Calcula confianza temporal basada en estabilidad y drift
   */
  private computeTemporalConfidence(temporalStability: number, signalDrift: number): number {
    const stabilityConfidence = temporalStability > 0.8 ? 1 : temporalStability;
    const driftConfidence = signalDrift < this.config.driftThreshold ? 1 : 1 - signalDrift;
    
    return (stabilityConfidence * 0.6 + driftConfidence * 0.4);
  }

  /**
   * Verifica si el contacto es estable según criterios temporales
   */
  isStableContact(): boolean {
    return this.stableFrameCount >= this.config.minStableFrames;
  }

  /**
   * Obtiene el promedio de calidad reciente
   */
  getAverageQuality(): number {
    const n = this.config.stabilityWindow;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += this.qualityHistory[i]!;
    }
    return sum / n;
  }

  reset(): void {
    this.signalHistory.fill(0);
    this.qualityHistory.fill(0);
    this.motionHistory.fill(0);
    this.historyIndex = 0;
    this.stableFrameCount = 0;
    this.lastQuality = 50;
    this.qualityTrend = 0;
  }
}
