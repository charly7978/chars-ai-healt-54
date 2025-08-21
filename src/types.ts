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
