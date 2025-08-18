import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

export interface ProcessedSignal {
  timestamp: number;
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  roi: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  perfusionIndex?: number;
  signalStrength?: number;
  noiseLevel?: number;
  enhancedMetrics?: EnhancedMetrics;
}

export interface EnhancedMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  signalQuality: number;
  detectionConfidence: number;
  motionArtifactLevel: number;
  contactQuality: number;
  baselineStability: number;
  adaptiveThreshold: number;
  signalConsistency: number;
  pulseDetectionQuality: number;
  fingerConfidence: number;
  peakDetected: boolean;
  peakConfidence: number;
  signalStability: number;
  detectionReasons: string[];
  environmentalFactors: {
    lighting: number;
    motion: number;
    temperature: number;
  };
  detectionScores: {
    redChannel: number;
    stability: number;
    pulsatility: number;
    biophysical: number;
    periodicity: number;
  };
}

export interface SignalQualityMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  overallQuality: number;
  timestamp: number;
  frameRate?: number;
  bufferUsage?: number;
  confidence?: number;
}

export interface ProcessingError {
  code: string;
  message: string;
  timestamp: number;
}

export interface SignalProcessor {
  initialize: () => Promise<void>;
  start: () => void;
  stop: () => void;
  calibrate: () => Promise<boolean>;
  onSignalReady?: (signal: ProcessedSignal) => void;
  onError?: (error: ProcessingError) => void;
}

declare global {
  interface Window {
    heartBeatProcessor: HeartBeatProcessor;
  }
}
