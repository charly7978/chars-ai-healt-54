
import { ProcessedSignal, ProcessingError } from '../../types/signal';

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
  PEAK_DETECTION_THRESHOLD: number;
  MIN_PEAK_SEPARATION: number;
  HEART_RATE_MIN: number;
  HEART_RATE_MAX: number;
  MOTION_THRESHOLD: number;
  SIGNAL_TO_NOISE_MIN: number;
  MIN_PULSATILITY_SCORE: number;
  COLOR_RATIO_MIN: number;
  COLOR_RATIO_MAX: number;
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
}

export interface DetectionResult {
  isFingerDetected: boolean;
  quality: number;
  detectorDetails: Record<string, number | string>;
}
