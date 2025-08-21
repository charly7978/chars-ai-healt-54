
// Tipos compartidos
export type CameraSample = {
  timestamp: number; // ms
  rMean: number;     // 0-255
  rStd: number;
  frameDiff: number;
};

export type ChannelResult = {
  channelId: number;
  calibratedSignal: number[]; // última ventana procesada (valor por muestra)
  bpm: number | null;
  snr: number;
  quality: number; // 0-100
  isFingerDetected: boolean;
  gain: number; // factor de calibración adaptativa
};

export type MultiChannelResult = {
  timestamp: number;
  channels: ChannelResult[];
  aggregatedBPM: number | null;
  aggregatedQuality: number; // promedio
};

// Mantener tipos existentes para compatibilidad
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
