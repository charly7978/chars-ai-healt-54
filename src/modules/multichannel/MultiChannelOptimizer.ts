import { KalmanFilter } from '../signal-processing/KalmanFilter';
import { SavitzkyGolayFilter } from '../signal-processing/SavitzkyGolayFilter';
import type {
  OptimizerConfig,
  OptimizerAPI,
  VitalChannel,
  ChannelFeedback,
  ChannelState,
  ChannelResult,
  MultiChannelOutputs,
} from '../../types/multichannel';

type InternalFilters = {
  kalman: KalmanFilter;
  sg: SavitzkyGolayFilter;
};

/**
 * MultiChannelOptimizer
 * - Accepts raw scalar PPG-derived value (e.g., red channel filteredValue)
 * - Maintains per-channel lightweight filters and shaping
 * - Provides per-channel outputs specialized per vital sign module
 * - Accepts feedback from each module to fine-tune gain/bandwidth hints
 */
export class MultiChannelOptimizer implements OptimizerAPI {
  private readonly config: Required<OptimizerConfig>;
  private lastTimestamp: number = 0;
  private lastRawValue: number = 0;
  private lastQuality: number = 0;

  private channelStates: Record<VitalChannel, ChannelState> = {} as any;
  private channelFilters: Record<VitalChannel, InternalFilters> = {} as any;
  private channelGains: Record<VitalChannel, number> = {} as any;
  private channelBands: Record<VitalChannel, [number, number]> = {} as any;

  private readonly channels: VitalChannel[] = [
    'heart',
    'spo2',
    'bloodPressure',
    'hemoglobin',
    'glucose',
    'lipids',
  ];

  constructor(cfg?: OptimizerConfig) {
    this.config = {
      samplingRateHz: cfg?.samplingRateHz ?? 30,
      defaultBandpass: cfg?.defaultBandpass ?? [0.7, 4.0],
    };

    // Initialize per-channel filters and defaults
    for (const ch of this.channels) {
      this.channelStates[ch] = {};
      this.channelFilters[ch] = {
        kalman: new KalmanFilter(),
        sg: new SavitzkyGolayFilter(),
      };
      this.channelGains[ch] = this.defaultGain(ch);
      this.channelBands[ch] = this.defaultBand(ch);
    }
  }

  pushRawSample(timestamp: number, rawValue: number, quality: number): void {
    this.lastTimestamp = timestamp;
    this.lastRawValue = rawValue;
    this.lastQuality = quality;
  }

  pushChannelFeedback(channel: VitalChannel, feedback: ChannelFeedback): void {
    // Adjust simple gain and bandpass hints based on feedback
    if (feedback.desiredGain && feedback.confidence && feedback.confidence > 0.2) {
      const clamped = Math.max(0.3, Math.min(3.0, feedback.desiredGain));
      this.channelGains[channel] = this.exponentialSmoothing(
        this.channelGains[channel],
        clamped,
        feedback.confidence * 0.5
      );
    }
    if (feedback.desiredBandwidthHz && feedback.confidence && feedback.confidence > 0.2) {
      const [lo, hi] = feedback.desiredBandwidthHz;
      const validLo = Math.max(0.1, Math.min(hi - 0.05, lo));
      const validHi = Math.max(validLo + 0.05, Math.min(8.0, hi));
      const prev = this.channelBands[channel];
      const alpha = feedback.confidence * 0.4;
      const newBand: [number, number] = [
        this.exponentialSmoothing(prev[0], validLo, alpha),
        this.exponentialSmoothing(prev[1], validHi, alpha),
      ];
      this.channelBands[channel] = newBand;
    }
  }

  compute(): MultiChannelOutputs {
    const outputs: MultiChannelOutputs = {};
    for (const ch of this.channels) {
      outputs[ch] = this.computeChannel(ch);
    }
    return outputs;
  }

  reset(): void {
    // CRÍTICO: Limpiar valores internos primero
    this.lastTimestamp = 0;
    this.lastRawValue = 0;
    this.lastQuality = 0;
    
    for (const ch of this.channels) {
      this.channelStates[ch] = {};
      this.channelFilters[ch].kalman.reset();
      this.channelFilters[ch].sg.reset();
      this.channelGains[ch] = this.defaultGain(ch);
      this.channelBands[ch] = this.defaultBand(ch);
    }
  }

  snapshot(): Record<VitalChannel, ChannelState> {
    return { ...this.channelStates };
  }

  private computeChannel(channel: VitalChannel): ChannelResult {
    const raw = this.lastRawValue;
    const q = this.lastQuality;

    // 1) base filtering: channel-specific Kalman + SG
    const k = this.channelFilters[channel].kalman.filter(raw);
    const sg = this.channelFilters[channel].sg.filter(k);

    // 2) simple band-shaping hint using gain and pseudo-bandweight
    //    we do not alter frequency content here (no FFT); we emulate with
    //    dynamic gain weighting from quality and channel band target.
    const gain = this.channelGains[channel];
    const bandWeight = this.bandWeightFromQuality(q, channel);
    const shaped = sg * gain * bandWeight;

    // 3) quality roll-off per channel
    const channelQuality = this.estimateChannelQuality(q, channel, shaped);

    // 4) write state
    this.channelStates[channel] = {
      lastInput: { timestamp: this.lastTimestamp, value: raw, quality: q },
      lastOutput: shaped,
      qualityTrend: this.trend(this.channelStates[channel]?.qualityTrend ?? channelQuality, channelQuality, 0.2),
    };

    // 5) output with passive feedback suggestion
    const feedback: ChannelFeedback | undefined = this.feedbackSuggestion(channel, channelQuality, shaped);

    return {
      output: shaped,
      quality: Math.max(0, Math.min(100, channelQuality)),
      feedback,
    };
  }

  private feedbackSuggestion(channel: VitalChannel, quality: number, value: number): ChannelFeedback | undefined {
    // Provide soft hints when quality is low
    if (quality >= 55) return undefined;

    switch (channel) {
      case 'heart':
        return {
          desiredGain: value > 0 ? 1.2 : 1.0,
          desiredBandwidthHz: [0.8, 3.0],
          confidence: 0.4,
          notes: 'Refinar banda cardíaca para picos más definidos',
        };
      case 'spo2':
        return {
          desiredGain: 1.1,
          desiredBandwidthHz: [0.5, 2.5],
          confidence: 0.35,
          notes: 'Reducir ruido de alta frecuencia para estabilidad SpO2',
        };
      case 'bloodPressure':
        return {
          desiredGain: 1.15,
          desiredBandwidthHz: [0.7, 2.2],
          confidence: 0.3,
          notes: 'Mejorar contorno dicrótico para presión estimada',
        };
      case 'hemoglobin':
        return { desiredGain: 1.1, confidence: 0.25, notes: 'Mayor estabilidad de amplitud' };
      case 'glucose':
        return { desiredGain: 1.05, confidence: 0.25, notes: 'Suavizado adicional contra micro-ruido' };
      case 'lipids':
        return { desiredGain: 1.0, confidence: 0.2, notes: 'Neutral' };
    }
  }

  private estimateChannelQuality(globalQ: number, channel: VitalChannel, value: number): number {
    const base = globalQ;
    // Channel-specific modifiers
    switch (channel) {
      case 'heart':
        return base + Math.min(15, Math.abs(value) * 5);
      case 'spo2':
        return base - Math.min(10, Math.max(0, 50 - base) * 0.3);
      case 'bloodPressure':
        return base - Math.min(12, Math.max(0, 55 - base) * 0.35);
      case 'hemoglobin':
        return base - 5;
      case 'glucose':
        return base - 8;
      case 'lipids':
        return base - 10;
    }
  }

  private bandWeightFromQuality(q: number, channel: VitalChannel): number {
    // Use quality to softly weight output amplitude per channel
    const qNorm = Math.max(0, Math.min(1, q / 100));
    switch (channel) {
      case 'heart':
        return 0.9 + 0.3 * qNorm;
      case 'spo2':
        return 0.85 + 0.25 * qNorm;
      case 'bloodPressure':
        return 0.8 + 0.2 * qNorm;
      case 'hemoglobin':
        return 0.8 + 0.15 * qNorm;
      case 'glucose':
        return 0.75 + 0.15 * qNorm;
      case 'lipids':
        return 0.7 + 0.1 * qNorm;
    }
  }

  private defaultGain(channel: VitalChannel): number {
    switch (channel) {
      case 'heart': return 1.4;
      case 'spo2': return 1.2;
      case 'bloodPressure': return 1.25;
      case 'hemoglobin': return 1.1;
      case 'glucose': return 1.05;
      case 'lipids': return 1.0;
    }
  }

  private defaultBand(channel: VitalChannel): [number, number] {
    switch (channel) {
      case 'heart': return this.config.defaultBandpass;
      case 'spo2': return [0.5, 2.5];
      case 'bloodPressure': return [0.7, 2.2];
      case 'hemoglobin': return [0.4, 2.0];
      case 'glucose': return [0.2, 1.2];
      case 'lipids': return [0.2, 1.0];
    }
  }

  private exponentialSmoothing(prev: number, next: number, alpha: number): number {
    const a = Math.max(0, Math.min(1, alpha));
    return prev * (1 - a) + next * a;
  }

  private trend(prev: number, next: number, alpha: number): number {
    return this.exponentialSmoothing(prev, next, alpha);
  }
}

export default MultiChannelOptimizer;

