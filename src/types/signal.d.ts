import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

export type ContactState = 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';

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
  rawBlue?: number;
  // Extended telemetry for V2 pipeline
  telemetry?: {
    // Quality metrics
    clipHighRatio: number;
    clipLowRatio: number;
    spatialUniformity: number;
    centerCoverage: number;
    // Source metrics
    activeSourceLabel: string;
    sourceStability: number;
    allSourceSQI: Record<string, number>;
    // Pressure & Motion
    pressureState: string;
    pressurePenalty: number;
    motionScore: number;
    // Contact
    fingerConfidenceCount: number;
    stableContactCount: number;
    // Processing
    processingTimeMs: number;
    realFps: number;
    // Coverage
    coverageRatio: number;
  };
  diagnostics?: {
    message: string;
    hasPulsatility: boolean;
    pulsatilityValue: number;
  };
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
