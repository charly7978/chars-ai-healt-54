/**
 * Tipos y interfaces para el procesamiento de señales PPG
 */

// Tipos base
export type ErrorType = 'VALIDATION_ERROR' | 'PROCESSOR_ERROR' | 'GENERIC_ERROR' | 'CALIBRATION_ERROR' | 'CALLBACK_ERROR' | 'INIT_ERROR';

// Interfaces principales
export interface ProcessedSignal {
  timestamp: number;
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  // Agrega más propiedades según sea necesario
}

export interface ProcessingError {
  message: string;
  timestamp: number;
  type: ErrorType;
  details?: unknown;
}

export interface SignalStats {
  minValue: number;
  maxValue: number;
  avgValue: number;
  totalValues: number;
  lastQualityUpdateTime: number;
}

export interface QualityTransition {
  time: number;
  from: number;
  to: number;
}

// Interfaces para el procesador
export interface PPGProcessorCallbacks {
  onSignalReady: (signal: ProcessedSignal) => void;
  onError: (error: ProcessingError) => void;
  onProcessingStateChange?: (isRunning: boolean) => void;
}

export interface PPGProcessorOptions {
  sampleRate?: number;
  minQualityThreshold?: number;
  maxQualityThreshold?: number;
  // Agrega más opciones según sea necesario
}

// Tipos de utilidad
export type SignalValidator = (signal: ProcessedSignal) => { isValid: boolean; reason?: string };
export type SignalProcessor = (signal: ProcessedSignal) => ProcessedSignal | null;

// Estado global del procesador
export interface SignalProcessorState {
  isProcessing: boolean;
  lastError: ProcessingError | null;
  stats: SignalStats;
  signalHistory: ProcessedSignal[];
  qualityTransitions: QualityTransition[];
}
