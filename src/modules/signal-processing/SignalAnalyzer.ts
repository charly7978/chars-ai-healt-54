import { ProcessedSignal } from '../../types/signal';
import { DetectorScores, DetectionResult } from './types';

export class SignalAnalyzer {
  [x: string]: any;
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
  
  private stableFrameCount = 0;
  private lastStableValue = 0;
  private consecutiveDetections = 0;
  private consecutiveNoDetections = 0;
  private isCurrentlyDetected = false;
  private lastDetectionTime = 0;
  private qualityHistory: number[] = [];
  private motionArtifactScore = 0;
  private readonly DETECTION_TIMEOUT = 5000;
  private readonly MOTION_ARTIFACT_THRESHOLD = 0.7;
  private valueHistory: number[] = [];
  private calibrationPhase = true;
  private calibrationSamples: number[] = [];
  private readonly CALIBRATION_SAMPLE_SIZE = 20;
  private adaptiveThreshold = 0.1;

  constructor(config: { 
    QUALITY_LEVELS: number;
    QUALITY_HISTORY_SIZE: number;
    MIN_CONSECUTIVE_DETECTIONS: number;
    MAX_CONSECUTIVE_NO_DETECTIONS: number;
  }) {
    this.CONFIG = {
      QUALITY_LEVELS: config.QUALITY_LEVELS,
      QUALITY_HISTORY_SIZE: config.QUALITY_HISTORY_SIZE,
      MIN_CONSECUTIVE_DETECTIONS: config.MIN_CONSECUTIVE_DETECTIONS,
      MAX_CONSECUTIVE_NO_DETECTIONS: config.MAX_CONSECUTIVE_NO_DETECTIONS
    };
  }

  updateDetectorScores(scores: {
    redValue: number;
    redChannel: number;
    stability: number;
    pulsatility: number;
    biophysical: number;
    periodicity: number;
    textureScore?: number;
    lightQuality?: number;
  }): void {
    this.detectorScores.redChannel = Math.max(0, Math.min(1, scores.redChannel * 1.1));
    this.detectorScores.stability = Math.max(0, Math.min(1, scores.stability * 1.1));
    this.detectorScores.pulsatility = Math.max(0, Math.min(1, scores.pulsatility * 1.15));
    this.detectorScores.biophysical = Math.max(0, Math.min(1, scores.biophysical * 1.1));
    this.detectorScores.periodicity = Math.max(0, Math.min(1, scores.periodicity * 1.1));
    
    if (typeof scores.textureScore !== 'undefined') {
      this.detectorScores.textureScore = scores.textureScore;
    }
    
    this.valueHistory.push(scores.redValue);
    if (this.valueHistory.length > 15) {
      this.valueHistory.shift();
    }
    
    if (this.valueHistory.length >= 5) {
      const recentValues = this.valueHistory.slice(-5);
      const maxChange = Math.max(...recentValues) - Math.min(...recentValues);
      const meanValue = recentValues.reduce((sum, val) => sum + val, 0) / recentValues.length;
      const normalizedChange = meanValue > 0 ? maxChange / meanValue : 0;
      
      this.motionArtifactScore = this.motionArtifactScore * 0.7 + (normalizedChange > 0.5 ? 0.3 : 0);
      
      if (this.motionArtifactScore > this.MOTION_ARTIFACT_THRESHOLD) {
        this.detectorScores.stability *= 0.6;
      }
    }
    
    if (this.calibrationPhase && this.detectorScores.redChannel > 0.1) {
      this.calibrationSamples.push(scores.redValue);
      
      if (this.calibrationSamples.length >= this.CALIBRATION_SAMPLE_SIZE) {
        this.calibrateAdaptiveThreshold();
        this.calibrationPhase = false;
      }
    }
  }

  private calibrateAdaptiveThreshold(): void {
    const sortedSamples = [...this.calibrationSamples].sort((a, b) => a - b);
    const trimCount = Math.floor(sortedSamples.length * 0.1);
    const trimmedSamples = sortedSamples.slice(trimCount, sortedSamples.length - trimCount);
    
    const mean = trimmedSamples.reduce((sum, val) => sum + val, 0) / trimmedSamples.length;
    const variance = trimmedSamples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / trimmedSamples.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 1;
    
    if (cv < 0.05) {
      this.adaptiveThreshold = 0.035;
    } else if (cv < 0.1) {
      this.adaptiveThreshold = 0.02;
    } else {
      this.adaptiveThreshold = 0.015;
    }
    
    this.calibrationSamples = [];
  }

  analyzeSignalMultiDetector(filtered: number, trendResult: any): DetectionResult {
    const WEIGHTS = {
      RED_CHANNEL: 0.25,
      STABILITY: 0.20,
      PULSATILITY: 0.25,
      BIOPHYSICAL: 0.15,
      PERIODICITY: 0.10,
      LIGHT_QUALITY: 0.05
    };

    let compositeScore = 0;
    let totalWeight = 0;

    if (this.detectorScores.redChannel >= 0) {
      compositeScore += this.detectorScores.redChannel * WEIGHTS.RED_CHANNEL;
      totalWeight += WEIGHTS.RED_CHANNEL;
    }
    
    if (this.detectorScores.stability >= 0) {
      compositeScore += this.detectorScores.stability * WEIGHTS.STABILITY;
      totalWeight += WEIGHTS.STABILITY;
    }

    if (this.detectorScores.pulsatility >= 0) {
      compositeScore += this.detectorScores.pulsatility * WEIGHTS.PULSATILITY;
      totalWeight += WEIGHTS.PULSATILITY;
    }

    if (this.detectorScores.biophysical >= 0) {
      compositeScore += this.detectorScores.biophysical * WEIGHTS.BIOPHYSICAL;
      totalWeight += WEIGHTS.BIOPHYSICAL;
    }

    if (this.detectorScores.periodicity >= 0) {
      compositeScore += this.detectorScores.periodicity * WEIGHTS.PERIODICITY;
      totalWeight += WEIGHTS.PERIODICITY;
    }

    if (typeof this.detectorScores.lightQuality !== 'undefined' && 
        this.detectorScores.lightQuality >= 0) {
      compositeScore += this.detectorScores.lightQuality * WEIGHTS.LIGHT_QUALITY;
      totalWeight += WEIGHTS.LIGHT_QUALITY;
    }

    const normalizedScore = totalWeight > 0 ? (compositeScore / totalWeight) * 100 : 0;

    this.qualityHistory.push(normalizedScore);
    if (this.qualityHistory.length > this.CONFIG.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    const smoothedQuality = this.qualityHistory.length > 0 ?
      this.qualityHistory.reduce((sum, q) => sum + q, 0) / this.qualityHistory.length : 0;

    const DETECTION_THRESHOLD = 50;
    const RELEASE_THRESHOLD = 40;
    const PHYSIOLOGICAL_MIN = 0.3;

    if (!this.isCurrentlyDetected) {
      if (smoothedQuality > DETECTION_THRESHOLD && trendResult !== 'non_physiological' &&
          this.detectorScores.pulsatility > 0.2 &&
          this.detectorScores.biophysical > PHYSIOLOGICAL_MIN &&
          (typeof this.detectorScores.lightQuality === 'undefined' || 
           this.detectorScores.lightQuality > 0.3)) {
        this.consecutiveDetections++;
        this.consecutiveNoDetections = 0;
      } else {
        this.consecutiveDetections = 0;
        this.consecutiveNoDetections++;
      }
    } else {
      if (smoothedQuality < RELEASE_THRESHOLD || trendResult === 'non_physiological' ||
          this.detectorScores.pulsatility < 0.2 ||
          this.detectorScores.biophysical < PHYSIOLOGICAL_MIN ||
          (typeof this.detectorScores.lightQuality === 'undefined' || 
           this.detectorScores.lightQuality < 0.2)) {
        this.consecutiveNoDetections++;
        this.consecutiveDetections = 0;
      } else {
        this.consecutiveNoDetections = 0;
        this.consecutiveDetections++;
      }
    }

    if (!this.isCurrentlyDetected && this.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_DETECTIONS) {
      this.isCurrentlyDetected = true;
    }
    if (this.isCurrentlyDetected && this.consecutiveNoDetections >= this.CONFIG.MAX_CONSECUTIVE_NO_DETECTIONS) {
      this.isCurrentlyDetected = false;
    }

    return {
      isFingerDetected: this.isCurrentlyDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: {
        ...this.detectorScores,
        avgQuality: smoothedQuality,
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
    this.calibrationPhase = true;
    this.calibrationSamples = [];
    this.adaptiveThreshold = 0.1;
    this.detectorScores = {
      redChannel: 0,
      stability: 0,
      pulsatility: 0,
      biophysical: 0,
      periodicity: 0
    };
  }
}
