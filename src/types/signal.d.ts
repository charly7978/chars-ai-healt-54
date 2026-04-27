import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';
import type { WindowSpectralSQISlice } from '../modules/signal-processing/pipeline-types';
import type { ROIReputationDebug } from '../modules/signal-processing/ROIReputationModel';

export type ContactState = 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';

/** Estados extendidos internos del PPG; la UI usa `contactState` exportado */
export type ExtendedContactState =
  | 'NO_CONTACT'
  | 'ACQUIRING_CONTACT'
  | 'UNSTABLE_CONTACT'
  | 'STABLE_CONTACT'
  | 'SATURATED_CONTACT'
  | 'EXCESSIVE_PRESSURE'
  | 'PARTIAL_CONTACT'
  | 'CONTACT_UNSTABLE'
  | 'CONTACT_STABLE_WARMUP'
  | 'MEASUREMENT_READY'
  | 'MEASUREMENT_DEGRADED';

export type PressureState = 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE';

export interface ProcessedSignal {
  timestamp: number;
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  contactState: ContactState;
  /** Estado fino del contacto (para gating biomarcadores) */
  extendedContactState?: ExtendedContactState;
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
  /** AC/DC RGB último frame (útil cuando el DSP corre en worker) */
  acStats?: {
    redAC: number;
    redDC: number;
    greenAC: number;
    greenDC: number;
    rgRatio: number;
    ratioOfRatios: number;
  };
  positionQuality?: {
    locked: boolean;
    drifting: boolean;
    spatialUniformity: number;
    centerCoverage: number;
    positionDrift: number;
    guidance: string;
    qualityScore: number;
  };
  clipHighRatio?: number;
  clipLowRatio?: number;
  roiCoverage?: number;
  pressureState?: PressureState;
  activeSource?: string;
  sourceStability?: number;
  sqiBySource?: Record<string, number>;
  estimatedSampleRate?: number;
  realFps?: number;
  processingDurationMs?: number;
  diagnostics?: {
    message: string;
    hasPulsatility: boolean;
    pulsatilityValue: number;
  };
  /** Telemetría del pipeline (debug / panel) */
  pipelineDebug?: {
    fingerMeasurementState?: string;
    topRois?: Array<{
      id: number;
      row: number;
      col: number;
      score: number;
      meanR: number;
      meanG: number;
      meanB: number;
      clipRatio: number;
      acdcProxy: number;
      rejectedReason?: string;
    }>;
    fusionWeights?: Record<string, number>;
    fusionCollapse?: boolean;
    windowSQI?: {
      score: number;
      category: string;
      reasons: string[];
      gating: string;
      spectral?: WindowSpectralSQISlice;
    };
    fusionMeta?: Record<string, unknown>;
    acquisition?: Record<string, unknown>;
    performanceProfile?: string;
    roiReputation?: ROIReputationDebug;
    frameTiming?: { intervalMs: number; effectiveFps: number; droppedEstimate: number };
    profiler?: Record<string, number>;
    fingerFeatures?: Record<string, number>;
    /** Autocorrelación periodicity calculada por el procesador (0..1) */
    autocorrPeak?: number;
    /** Self-correlation a lag corto (0..1) */
    pulseSelfCorr?: number;
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
  processFrame?: (imageData: ImageData, frameTimestamp?: number) => void;
  processFrameDual?: (detectionImageData: ImageData, extractionImageData: ImageData, frameTimestamp?: number) => void;
  onSignalReady?: (signal: ProcessedSignal) => void;
  onError?: (error: ProcessingError) => void;
}

declare global {
  interface Window {
    heartBeatProcessor: HeartBeatProcessor;
  }
}
