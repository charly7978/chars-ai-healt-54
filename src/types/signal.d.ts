import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

// Extended ContactState from classifier
export type ContactState = 
  | 'NO_CONTACT' 
  | 'UNSTABLE_CONTACT' 
  | 'STABLE_CONTACT'
  | 'ACQUIRING_CONTACT'
  | 'SATURATED_CONTACT'
  | 'EXCESSIVE_PRESSURE'
  | 'LOW_PERFUSION_CONTACT'
  | 'MOTION_CONTAMINATED_CONTACT';

// Finger contact states from classifier
export type FingerContactState =
  | 'NO_FINGER'
  | 'PARTIAL_CONTACT'
  | 'GOOD_CONTACT'
  | 'OVERPRESSURE'
  | 'UNDERILLUMINATED'
  | 'EXCESSIVE_CLIPPING'
  | 'MOTION_CONTAMINATED';

export interface ProcessedSignal {
  timestamp: number;
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  contactState: ContactState;
  motionArtifact?: boolean;
  roi: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  perfusionIndex?: number;
  rawRed?: number;
  rawGreen?: number;
  diagnostics?: {
    message: string;
    hasPulsatility: boolean;
    pulsatilityValue: number;
  };
  // Enhanced metrics from new pipeline
  clipHighRatio?: number;
  clipLowRatio?: number;
  spectralSNR?: number;
  peakProminence?: number;
  harmonicConsistency?: number;
  zeroCrossingRate?: number;
  temporalStability?: number;
  // Contact classifier metrics
  contactConfidence?: number;
  contactStateExtended?: ContactState;
  // Tile fusion metrics
  fusionConfidence?: number;
  effectiveTileCount?: number;
  validTileRatio?: number;
  tileWeightMap?: number[];
  dominantTileIndices?: number[];
  // Source ranking metrics
  sourceQuality?: number;
  sourceName?: string;
  // Frame quality gate
  gateScore?: number;
  rejectionReason?: string;
  // Calibration
  calibrationReady?: boolean;
  calibrationConfidence?: number;
  // Motion
  motionScore?: number;
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
