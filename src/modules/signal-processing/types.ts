
import { ProcessedSignal, ProcessingError } from '../../types/signal';

export { ProcessedSignal, ProcessingError };

export interface ProcessingConfig {
  bufferSize?: number;
  qualityThreshold?: number;
  calibrationSamples?: number;
}

export interface SignalProcessorConfig {
  BUFFER_SIZE: number;
  MIN_RED_THRESHOLD: number;
  MAX_RED_THRESHOLD: number;
  STABILITY_WINDOW: number;
  MIN_STABILITY_COUNT: number;
  HYSTERESIS: number;
  MIN_CONSECUTIVE_DETECTIONS: number;
  MAX_CONSECUTIVE_NO_DETECTIONS: number;
  QUALITY_LEVELS: number;
  QUALITY_HISTORY_SIZE: number;
  CALIBRATION_SAMPLES: number;
  TEXTURE_GRID_SIZE: number;
  ROI_SIZE_FACTOR: number;
}

export interface CalibrationValues {
  baselineRed: number;
  baselineVariance: number;
  minRedThreshold: number;
  maxRedThreshold: number;
  isCalibrated: boolean;
}

export interface DetectorScores {
  redChannel: number;
  stability: number;
  pulsatility: number;
  biophysical: number;
  periodicity: number;
  [key: string]: number;
}

export interface FrameData {
  redValue: number;
  avgRed?: number;
  avgGreen?: number;
  avgBlue?: number;
  textureScore: number;
  rToGRatio: number;
  rToBRatio: number;
  skinLikeness: number;
  stabilityScore: number;
}

export interface DetectionResult {
  isFingerDetected: boolean;
  quality: number;
  detectorDetails: Record<string, number | string>;
}

export interface SignalQualityMetrics {
  snr: number;
  stability: number;
  consistency: number;
  overallQuality: number;
}
