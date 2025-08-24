
// Tipos compartidos del módulo PPG
export type CameraSample = {
  timestamp: number; // ms
  rMean: number;
  gMean: number;
  bMean: number;
  brightnessMean: number;
  brightnessStd: number;
  rStd: number;
  gStd: number;
  bStd: number;
  frameDiff: number; // abs diff prev mean brightness
  coverageRatio: number; // 0..1 -> % pix que cumplen condiciones de dedo
  rgRatio: number; // rMean/gMean
  redFraction: number; // rMean/(r+g+b)
  saturationRatio: number; // % de pixeles con rojo saturado
  // Campos opcionales para robustecer la detección
  fingerConfidence?: number; // 0..1 confianza de dedo sobre lente
  exposureState?: 'ok' | 'dark' | 'saturated' | 'low_coverage' | 'moving';
};

export type ChannelResult = {
  channelId: number;
  calibratedSignal: number[]; // ventana procesada
  bpm: number | null;
  rrIntervals: number[]; // ms
  snr: number;
  quality: number; // 0..100
  isFingerDetected: boolean;
  gain: number;
};

export type MultiChannelResult = {
  timestamp: number;
  channels: ChannelResult[];
  aggregatedBPM: number | null;
  aggregatedQuality: number;
  fingerDetected: boolean;
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
