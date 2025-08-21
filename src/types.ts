<<<<<<< HEAD
// Tipos compartidos del módulo PPG
export type CameraSample = {
  timestamp: number; // ms
  rMean: number;
  gMean: number;
  bMean: number;
  brightnessMean: number;
  rStd: number;
  gStd: number;
  bStd: number;
  frameDiff: number; // abs diff prev mean brightness
  coverageRatio: number; // 0..1 -> % pix que cumplen condiciones de dedo
=======

// Tipos compartidos
export type CameraSample = {
  timestamp: number; // ms
  rMean: number;     // 0-255
  rStd: number;
  frameDiff: number;
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
};

export type ChannelResult = {
  channelId: number;
<<<<<<< HEAD
  calibratedSignal: number[]; // ventana procesada
  bpm: number | null;
  rrIntervals: number[]; // ms
  snr: number;
  quality: number; // 0..100
  isFingerDetected: boolean;
  gain: number;
=======
  calibratedSignal: number[]; // última ventana procesada (valor por muestra)
  bpm: number | null;
  snr: number;
  quality: number; // 0-100
  isFingerDetected: boolean;
  gain: number; // factor de calibración adaptativa
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
};

export type MultiChannelResult = {
  timestamp: number;
  channels: ChannelResult[];
  aggregatedBPM: number | null;
<<<<<<< HEAD
  aggregatedQuality: number;
  fingerDetected: boolean;
};
=======
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
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
