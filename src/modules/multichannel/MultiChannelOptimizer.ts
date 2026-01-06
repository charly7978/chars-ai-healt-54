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

export class MultiChannelOptimizer implements OptimizerAPI {
  private readonly config: Required<OptimizerConfig>;
  private lastTimestamp: number = 0;
  private lastRawValue: number = 0;
  private lastQuality: number = 0;

  private channelStates: Record<VitalChannel, ChannelState> = {} as any;
  private channelFilters: Record<VitalChannel, { kalman: KalmanFilter; sg: SavitzkyGolayFilter }> = {} as any;

  private readonly channels: VitalChannel[] = [
    'heart', 'spo2', 'bloodPressure', 'hemoglobin', 'glucose', 'lipids'
  ];

  constructor(cfg?: OptimizerConfig) {
    this.config = {
      samplingRateHz: cfg?.samplingRateHz ?? 30,
      defaultBandpass: cfg?.defaultBandpass ?? [0.7, 4.0],
    };

    // Inicialización CRÍTICA: Aseguramos que cada canal tenga un estado inicial
    for (const ch of this.channels) {
      this.channelFilters[ch] = {
        kalman: new KalmanFilter(),
        sg: new SavitzkyGolayFilter()
      };
      this.channelStates[ch] = {
        lastInput: { timestamp: 0, value: 0, quality: 0 },
        lastOutput: 0,
        qualityTrend: 0
      };
    }
  }

  pushRawSample(timestamp: number, rawValue: number, quality: number): void {
    this.lastTimestamp = timestamp;
    this.lastRawValue = rawValue;
    this.lastQuality = quality;
  }

  compute(): MultiChannelOutputs {
    const outputs: MultiChannelOutputs = {} as any;
    for (const ch of this.channels) {
      outputs[ch] = this.computeChannel(ch);
    }
    return outputs;
  }

  private computeChannel(channel: VitalChannel): ChannelResult {
    const raw = this.lastRawValue || 0;
    const q = this.lastQuality || 0;

    const k = this.channelFilters[channel].kalman.filter(raw);
    const shaped = this.channelFilters[channel].sg.filter(k);

    this.channelStates[channel] = {
      lastInput: { timestamp: this.lastTimestamp, value: raw, quality: q },
      lastOutput: shaped,
      qualityTrend: q,
    };

    return {
      output: shaped,
      quality: q,
      feedback: undefined
    };
  }

  reset(): void {
    for (const ch of this.channels) {
      this.channelFilters[ch].kalman.reset();
      this.channelFilters[ch].sg.reset();
      this.channelStates[ch] = {
        lastInput: { timestamp: 0, value: 0, quality: 0 },
        lastOutput: 0,
        qualityTrend: 0
      };
    }
  }

  // Métodos requeridos por la interfaz para evitar errores de "undefined"
  pushChannelFeedback(channel: VitalChannel, feedback: ChannelFeedback): void {}
  snapshot(): Record<VitalChannel, ChannelState> { return this.channelStates; }
}
