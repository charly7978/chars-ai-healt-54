import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

export type ContactState = 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';

/** Estados extendidos internos del PPG; la UI usa `contactState` exportado */
export type ExtendedContactState =
  | 'NO_CONTACT'
  | 'ACQUIRING_CONTACT'
  | 'UNSTABLE_CONTACT'
  | 'STABLE_CONTACT'
  | 'SATURATED_CONTACT'
  | 'EXCESSIVE_PRESSURE';

export type PressureState = 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE';

export interface ProcessedSignal {
  timestamp: number;
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  contactState: ContactState;
  /**
   * Única condición autoritativa para medir (dedo + pulso + posición + estabilidad).
   * Calculada solo en PPGSignalProcessor con histéresis — la UI no debe reinterpretar contacto.
   */
  measurementReady: boolean;
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
  /** Telemetría etapa 1 (solo si debug activo en procesador) */
  pipelineDebug?: import('../modules/signal-processing/DebugTelemetry').DebugTelemetry;
  inputFps?: number;
  processedFps?: number;
  droppedFrames?: number;
  frameLatencyMs?: number;
  roiValidPixelRatio?: number;
  maskIoU?: number;
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
