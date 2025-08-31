export type VitalChannel =
  | 'heart'
  | 'spo2'
  | 'bloodPressure'
  | 'hemoglobin'
  | 'glucose'
  | 'lipids';

export interface ChannelInput {
  timestamp: number;
  value: number; // optimized scalar from PPG pipeline for this channel
  quality: number; // 0-100
}

export interface ChannelFeedback {
  // Requested adjustments to upstream optimizer for better performance
  desiredGain?: number; // multiplicative gain hint (e.g., 0.8-1.5)
  desiredBandwidthHz?: [number, number]; // suggested passband in Hz
  confidence?: number; // 0-1 confidence of the feedback
  notes?: string;
}

export interface ChannelState {
  lastInput?: ChannelInput;
  lastOutput?: number;
  qualityTrend?: number; // short-term trend of quality
}

export interface ChannelResult {
  output: number; // per-channel scalar to feed the target module
  quality: number; // 0-100 channel-specific estimated quality
  feedback?: ChannelFeedback; // feedback upstream
}

export interface MultiChannelSnapshot {
  [key in VitalChannel]?: ChannelState;
}

export interface MultiChannelOutputs {
  [key in VitalChannel]?: ChannelResult;
}

export interface OptimizerConfig {
  samplingRateHz?: number; // nominal effective sampling of PPG-derived scalar
  defaultBandpass?: [number, number]; // default cardiac band
}

export interface OptimizerAPI {
  pushRawSample: (timestamp: number, rawValue: number, quality: number) => void;
  pushChannelFeedback: (channel: VitalChannel, feedback: ChannelFeedback) => void;
  compute: () => MultiChannelOutputs; // compute latest outputs for all channels
  reset: () => void;
  snapshot: () => MultiChannelSnapshot;
}


