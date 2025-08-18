/**
 * Enhanced Finger Detection System
 * Multi-layer validation with advanced signal analysis
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */

export interface FingerDetectionMetrics {
  signalStrength: number;
  textureQuality: number;
  colorConsistency: number;
  motionStability: number;
  pulsatilityScore: number;
  physiologicalPlausibility: number;
  overallConfidence: number;
}

export interface DetectionWindow {
  startTime: number;
  endTime: number;
  confidence: number;
  isValid: boolean;
  metrics: FingerDetectionMetrics;
}

export class FingerDetectionEnhancer {
  private readonly CONFIG = {
    // Enhanced detection thresholds
    MIN_SIGNAL_STRENGTH: 0.25,      // Increased from 0.2
    MIN_TEXTURE_QUALITY: 0.20,     // Increased from 0.15
    MIN_COLOR_CONSISTENCY: 0.65,   // Increased from 0.5
    MIN_MOTION_STABILITY: 0.55,     // Increased from 0.4
    MIN_PULSATILITY_SCORE: 0.30,  // Increased from 0.25
    MIN_PHYSIOLOGICAL_SCORE: 0.55, // Increased from 0.4
    
    // Detection windows
    DETECTION_WINDOW_SIZE: 15,    // Frames for consistent detection
    CONFIDENCE_THRESHOLD: 0.75,   // Minimum confidence for valid detection
    HYSTERESIS_FACTOR: 0.15,      // Hysteresis for stable detection
    
    // Signal validation
    MAX_NOISE_LEVEL: 0.2,         // Maximum allowed noise
    MIN_PEAK_COUNT: 2,            // Minimum peaks for valid pulse
    MAX_HEART_RATE: 180,          // Maximum physiological heart rate
    MIN_HEART_RATE: 40,           // Minimum physiological heart rate
    
    // Color ratio validation
    RED_GREEN_RATIO_MIN: 0.8,     // Stricter color validation
    RED_GREEN_RATIO_MAX: 3.0,
    RED_BLUE_RATIO_MIN: 0.9,
    RED_BLUE_RATIO_MAX: 3.5
  };

  private detectionHistory: DetectionWindow[] = [];
  private signalBuffer: number[] = [];
  private textureBuffer: number[] = [];
  private colorRatioBuffer: number[] = [];
  private motionBuffer: number[] = [];
  private lastDetectionState = false;
  private detectionStabilityCounter = 0;
  private readonly BUFFER_SIZE = 30;

  /**
   * Enhanced finger detection with multi-layer validation
   */
  public detectFinger(
    redValue: number,
    textureScore: number,
    rToGRatio: number,
    rToBRatio: number,
    signalHistory: number[],
    motionLevel: number = 0
  ): { isDetected: boolean; confidence: number; metrics: FingerDetectionMetrics } {
    
    // Update internal buffers
    this.updateBuffers(redValue, textureScore, rToGRatio, motionLevel);
    
    // Calculate comprehensive detection metrics
    const metrics = this.calculateDetectionMetrics(
      redValue, 
      textureScore, 
      rToGRatio, 
      rToBRatio, 
      signalHistory, 
      motionLevel
    );

    // Apply multi-layer validation
    const validationResults = this.performMultiLayerValidation(metrics);
    
    // Calculate overall confidence with weighted scoring
    const overallConfidence = this.calculateOverallConfidence(metrics, validationResults);
    
    // Nueva validación de consistencia temporal
    const temporalConsistency = this.calculateTemporalConsistency(metrics);
    if (temporalConsistency < 0.5) {
      return { isDetected: false, confidence: 0, metrics };
    }
    
    // Optimizar cálculo de confianza
    const optimizedConfidence = (metrics.overallConfidence * 0.7) + (temporalConsistency * 0.3);
    
    // Final detection decision with hysteresis
    const isDetected = this.makeDetectionDecision(optimizedConfidence, temporalConsistency);
    
    // Update detection history
    this.updateDetectionHistory(isDetected, optimizedConfidence, metrics);
    
    return {
      isDetected,
      confidence: optimizedConfidence,
      metrics
    };
  }

  /**
   * Reset enhancer state
   */
  public reset(): void {
    this.detectionHistory = [];
    this.signalBuffer = [];
    this.textureBuffer = [];
    this.colorRatioBuffer = [];
    this.motionBuffer = [];
    this.lastDetectionState = false;
    this.detectionStabilityCounter = 0;
  }

  /**
   * Update internal buffers for signal analysis
   */
  private updateBuffers(
    redValue: number,
    textureScore: number,
    rToGRatio: number,
    motionLevel: number
  ): void {
    this.signalBuffer.push(redValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }

    this.textureBuffer.push(textureScore);
    if (this.textureBuffer.length > this.BUFFER_SIZE) {
      this.textureBuffer.shift();
    }

    this.colorRatioBuffer.push(rToGRatio);
    if (this.colorRatioBuffer.length > this.BUFFER_SIZE) {
      this.colorRatioBuffer.shift();
    }

    this.motionBuffer.push(motionLevel);
    if (this.motionBuffer.length > this.BUFFER_SIZE) {
      this.motionBuffer.shift();
    }
  }

  /**
   * Calculate comprehensive detection metrics
   */
  private calculateDetectionMetrics(
    redValue: number,
    textureScore: number,
    rToGRatio: number,
    rToBRatio: number,
    signalHistory: number[],
    motionLevel: number
  ): FingerDetectionMetrics {
    
    // Signal strength validation
    const signalStrength = this.calculateSignalStrength(redValue, signalHistory);
    
    // Texture quality assessment
    const textureQuality = this.calculateTextureQuality(textureScore);
    
    // Color consistency validation
    const colorConsistency = this.calculateColorConsistency(rToGRatio, rToBRatio);
    
    // Motion stability assessment
    const motionStability = this.calculateMotionStability(motionLevel);
    
    // Pulsatility score calculation
    const pulsatilityScore = this.calculatePulsatilityScore(signalHistory);
    
    // Physiological plausibility
    const physiologicalPlausibility = this.calculatePhysiologicalPlausibility(
      signalHistory, 
      rToGRatio, 
      rToBRatio
    );

    return {
      signalStrength,
      textureQuality,
      colorConsistency,
      motionStability,
      pulsatilityScore,
      physiologicalPlausibility,
      overallConfidence: 0 // Will be calculated later
    };
  }

  /**
   * Calculate signal strength with physiological validation
   */
  private calculateSignalStrength(redValue: number, signalHistory: number[]): number {
    if (signalHistory.length < 5) return 0;
    
    const mean = signalHistory.reduce((sum, val) => sum + val, 0) / signalHistory.length;
    const std = Math.sqrt(signalHistory.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signalHistory.length);
    
    // Signal strength based on value and stability
    const valueScore = Math.min(1, Math.max(0, (redValue - 30) / 140)); // Normalize 30-170 range
    const stabilityScore = Math.max(0, 1 - (std / (mean || 1))); // Lower std = higher stability
    
    return (valueScore * 0.7) + (stabilityScore * 0.3);
  }

  /**
   * Calculate texture quality with enhanced validation
   */
  private calculateTextureQuality(textureScore: number): number {
    // Apply non-linear scaling to better discriminate good textures
    return Math.min(1, Math.pow(textureScore, 1.5));
  }

  /**
   * Calculate color consistency with multi-channel validation
   */
  private calculateColorConsistency(rToGRatio: number, rToBRatio: number): number {
    let consistencyScore = 0;
    let validationCount = 0;
    
    // Red/Green ratio validation
    if (rToGRatio >= this.CONFIG.RED_GREEN_RATIO_MIN && rToGRatio <= this.CONFIG.RED_GREEN_RATIO_MAX) {
      consistencyScore += 1;
    }
    validationCount++;
    
    // Red/Blue ratio validation
    if (rToBRatio >= this.CONFIG.RED_BLUE_RATIO_MIN && rToBRatio <= this.CONFIG.RED_BLUE_RATIO_MAX) {
      consistencyScore += 1;
    }
    validationCount++;
    
    // Color ratio stability over time
    if (this.colorRatioBuffer.length > 5) {
      const ratioMean = this.colorRatioBuffer.reduce((sum, val) => sum + val, 0) / this.colorRatioBuffer.length;
      const ratioStd = Math.sqrt(
        this.colorRatioBuffer.reduce((sum, val) => sum + Math.pow(val - ratioMean, 2), 0) / this.colorRatioBuffer.length
      );
      const stabilityScore = Math.max(0, 1 - (ratioStd / (ratioMean || 1)));
      
      if (stabilityScore > 0.7) {
        consistencyScore += 1;
