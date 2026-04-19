import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';
import type { RuntimeContactState } from './contracts';

export type ContactState = RuntimeContactState;

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
    // Beer-Lambert (Fase 1) — populated when AdaptiveROIMask is wired with
    // a RadiometricProcessor (default in PPGSignalProcessor V2+)
    odR?: number;
    odG?: number;
    odB?: number;
    linRed?: number;
    linGreen?: number;
    linBlue?: number;
    // Finger contact engine evidence — populated by FingerContactClassifier
    // Audit fix: previously the classifier ran every frame but its output
    // was discarded.  Surfacing it here lets every downstream consumer
    // (gates, debug panel, tests) see *why* a frame was accepted/rejected.
    contactConfidence?: number;       // 0..1
    signalUsabilityScore?: number;    // 0..1
    pressureIndex?: number;           // 0..1
    pressureExcessive?: boolean;
    rejectionReasons?: string[];
    contactGuidance?: string;
    // ROI / source explainability
    selectedROI?: {
      tileIndex?: number;
      topTileIndices?: number[];
      coverage?: number;
      spatialUniformity?: number;
    };
    roiStability?: number;
    winningReason?: string;
    confidencePerSignal?: Record<string, number>;
    usableForBPM?: boolean;
    usableForSpO2?: boolean;
    usableForRhythm?: boolean;
    usableForBP?: boolean;
    usableForBiomarkers?: boolean;
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
