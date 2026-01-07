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
  // Diagnóstico de detección de dedo
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
