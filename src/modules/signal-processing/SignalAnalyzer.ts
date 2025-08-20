
// SignalAnalyzer with enhanced finger detection and stability
import { DetectorScores, DetectionResult } from './types';
import { AdvancedFingerDetector } from './AdvancedFingerDetector';

export interface SignalAnalyzerConfig {
  QUALITY_LEVELS: number;
  QUALITY_HISTORY_SIZE: number;
  MIN_CONSECUTIVE_DETECTIONS: number;
  MAX_CONSECUTIVE_NO_DETECTIONS: number;
}

/**
 * Enhanced SignalAnalyzer with improved stability and reduced false positives
 * Uses advanced finger detection with multi-level consensus and adaptive thresholds
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
  
  private advancedDetector: AdvancedFingerDetector;
  private stabilityBuffer: number[] = [];
  private lastDetectionTime = 0;
  private detectionHysteresis = 0;

  constructor(private readonly config: SignalAnalyzerConfig) {
    this.advancedDetector = new AdvancedFingerDetector();
  }

  /** Reset internal state with enhanced cleanup */
  reset(): void {
    this.qualityHistory = [];
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    this.stabilityBuffer = [];
    this.lastDetectionTime = 0;
    this.detectionHysteresis = 0;
    this.advancedDetector.reset();
  }

  /** Update detector scores with enhanced validation */
  updateDetectorScores(scores: DetectorScores): void {
    this.detectorScores = scores;
    
    // Update stability buffer for trend analysis
    const currentStability = scores.stability || 0;
    this.stabilityBuffer.push(currentStability);
    if (this.stabilityBuffer.length > 15) {
      this.stabilityBuffer.shift();
    }
  }

  /**
   * Enhanced signal analysis with improved finger detection and stability
   */
  analyzeSignalMultiDetector(
    filteredValue: number,
    trendResult: unknown,
    colorValues?: { r: number; g: number; b: number }
  ): DetectionResult {
    const currentTime = Date.now();
    
    // Use advanced finger detector if color values are available
    if (colorValues) {
      const advancedResult = this.advancedDetector.detectFinger(colorValues);
      
      // Enhanced hysteresis and stability checking
      const timeSinceLastDetection = currentTime - this.lastDetectionTime;
      let finalDetection = advancedResult.isDetected;
      let finalQuality = advancedResult.quality;
      
      // Apply enhanced hysteresis logic
      if (advancedResult.isDetected) {
        this.consecutiveDetections++;
        this.consecutiveNoDetections = 0;
        this.detectionHysteresis = Math.min(this.detectionHysteresis + 2, 10);
        this.lastDetectionTime = currentTime;
      } else {
        this.consecutiveNoDetections++;
        this.consecutiveDetections = 0;
        this.detectionHysteresis = Math.max(this.detectionHysteresis - 1, 0);
      }
      
      // Apply stricter consecutive detection requirements
      const minConsecutiveRequired = Math.max(this.config.MIN_CONSECUTIVE_DETECTIONS, 8);
      const maxConsecutiveNoDetectionsAllowed = Math.min(this.config.MAX_CONSECUTIVE_NO_DETECTIONS, 6);
      
      if (this.consecutiveDetections < minConsecutiveRequired) {
        finalDetection = false;
        finalQuality = Math.min(finalQuality, 30);
      }
      
      if (this.consecutiveNoDetections >= maxConsecutiveNoDetectionsAllowed) {
        finalDetection = false;
        finalQuality = Math.max(finalQuality - 20, 0);
      }
      
      // Additional stability check using hysteresis
      if (this.detectionHysteresis < 3) {
        finalDetection = false;
      }
      
      // Quality boost for stable detections
      if (this.consecutiveDetections > minConsecutiveRequired && this.detectionHysteresis > 6) {
        finalQuality = Math.min(finalQuality + 15, 100);
      }
      
      return {
        isFingerDetected: finalDetection,
        quality: Math.round(finalQuality),
        detectorDetails: {
          ...this.detectorScores,
          advancedConfidence: advancedResult.confidence,
          perfusionIndex: advancedResult.perfusionIndex,
          colorValidation: advancedResult.details.colorValidation ? 1 : 0,
          pulsatilityValidation: advancedResult.details.pulsatilityValidation ? 1 : 0,
          stabilityValidation: advancedResult.details.stabilityValidation ? 1 : 0,
          perfusionValidation: advancedResult.details.perfusionValidation ? 1 : 0,
          temperatureValidation: advancedResult.details.temperatureValidation ? 1 : 0,
          consecutiveDetections: this.consecutiveDetections,
          consecutiveNoDetections: this.consecutiveNoDetections,
          hysteresisLevel: this.detectionHysteresis
        },
      };
    }
    
    // Fallback detection method with enhanced validation
    return this.performFallbackDetection(filteredValue);
  }
  
  private performFallbackDetection(filteredValue: number): DetectionResult {
    const { redChannel, stability, pulsatility, biophysical, periodicity, skinLikeness, stabilityScore } =
      this.detectorScores;

    // Enhanced validation with tighter thresholds for fallback mode
    if (skinLikeness !== undefined && skinLikeness < 0.15) {
      return this.createRejectResult("Low skin likeness");
    }
    
    if (stabilityScore !== undefined && stabilityScore < 0.20) {
      return this.createRejectResult("Low stability score");
    }

    // Stricter validation thresholds for fallback
    if (redChannel < 0.10 || stability < 0.15 || pulsatility < 0.12 || biophysical < 0.10) {
      return this.createRejectResult("Low detector scores");
    }

    // Enhanced weighted calculation with stability emphasis
    const avgStability = this.stabilityBuffer.length > 0 ? 
      this.stabilityBuffer.reduce((a, b) => a + b, 0) / this.stabilityBuffer.length : stability;
    
    const weighted =
      redChannel * 0.20 +
      avgStability * 0.30 +        // Increased weight for stability
      pulsatility * 0.25 +
      biophysical * 0.15 +
      periodicity * 0.05 +
      (skinLikeness || 0.3) * 0.05; // Reduced weight, more conservative default

    const qualityValue = Math.min(100, Math.max(0, Math.round(weighted * 100)));

    // Maintain quality history with enhanced smoothing
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    // Enhanced smoothing algorithm
    const smoothedQuality = this.calculateSmoothedQuality();

    // Stricter hysteresis with higher thresholds
    let isFingerDetected = false;
    const DETECTION_THRESHOLD = 25; // Increased from 3 to 25 for more reliable detection
    const STABLE_DETECTION_THRESHOLD = 35; // Higher threshold for stable detection
    
    if (smoothedQuality >= STABLE_DETECTION_THRESHOLD) {
      this.consecutiveDetections += 2; // Faster response for high-quality signals
      this.consecutiveNoDetections = 0;
    } else if (smoothedQuality >= DETECTION_THRESHOLD) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
    }

    // Enhanced consecutive detection requirements
    const requiredConsecutive = Math.max(this.config.MIN_CONSECUTIVE_DETECTIONS, 6);
    const maxNoDetections = Math.min(this.config.MAX_CONSECUTIVE_NO_DETECTIONS, 4);
    
    if (this.consecutiveDetections >= requiredConsecutive) {
      isFingerDetected = true;
    } else if (this.consecutiveNoDetections >= maxNoDetections) {
      isFingerDetected = false;
    }

    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { 
        ...this.detectorScores,
        consecutiveDetections: this.consecutiveDetections,
        consecutiveNoDetections: this.consecutiveNoDetections,
        smoothedQuality
      },
    };
  }
  
  private calculateSmoothedQuality(): number {
    if (this.qualityHistory.length === 0) return 0;
    
    // Apply exponential moving average for better smoothing
    let smoothed = this.qualityHistory[0];
    const alpha = 0.3; // Smoothing factor
    
    for (let i = 1; i < this.qualityHistory.length; i++) {
      smoothed = alpha * this.qualityHistory[i] + (1 - alpha) * smoothed;
    }
    
    return smoothed;
  }
  
  private createRejectResult(reason: string): DetectionResult {
    return {
      isFingerDetected: false,
      quality: 0,
      detectorDetails: { 
        ...this.detectorScores,
        rejectionReason: reason
      },
    };
  }
}
