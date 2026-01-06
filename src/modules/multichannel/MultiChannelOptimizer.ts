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

export class MultiChannelOptimizer implements OptimizerAPI {
  private readonly config: Required<OptimizerConfig>;
  private lastTimestamp: number = 0;
  private lastRawValue: number = 0;
  private lastQuality: number = 0;

  private channelStates: Record<VitalChannel, ChannelState> = {} as any;
  private channelFilters: Record<VitalChannel, InternalFilters> = {} as any;
  private channelGains: Record<VitalChannel, number> = {} as any;
  private channelBands: Record<VitalChannel, [number, number]> = {} as any;

  private readonly channels: VitalChannel[] = ['heart', 'spo2', 'bloodPressure', 'hemoglobin', 'glucose', 'lipids'];

  constructor(cfg?: OptimizerConfig) {
    this.config = {
      samplingRateHz: cfg?.samplingRateHz ?? 30,
      defaultBandpass: cfg?.defaultBandpass ?? [0.7, 4.0],
    };

    for (const ch of this.channels) {
      this.channelStates[ch] = {};
      this.channelFilters[ch] = {
        kalman: new KalmanFilter(),
        // Usamos ventana de 15 para máxima fidelidad real
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

  compute(): MultiChannelOutputs {
    const outputs: MultiChannelOutputs = {};
    for (const ch of this.channels) {
      outputs[ch] = this.computeChannel(ch);
    }
    return outputs;
  }

  private computeChannel(channel: VitalChannel): ChannelResult {
    const raw = this.lastRawValue;
    const q = this.lastQuality;

    // 1) Filtrado en Cascada (Preserva la morfología de la onda real)
    const k = this.channelFilters[channel].kalman.filter(raw);
    const filtered = this.channelFilters[channel].sg.filter(k);

    // 2) Ganancia Dinámica (Sin normalización artificial)
    const gain = this.channelGains[channel];
    // ELIMINADO: bandWeight artificial que simulaba estabilidad
    const shaped = filtered * gain;

    // 3) Calidad Real
    const channelQuality = q; // Transmitimos la calidad pura detectada por el sensor

    this.channelStates[channel] = {
      lastInput: { timestamp: this.lastTimestamp, value: raw, quality: q },
      lastOutput: shaped,
      qualityTrend: channelQuality,
    };

    return {
      output: shaped,
      quality: Math.max(0, Math.min(100, channelQuality)),
    };
  }

  private defaultGain(channel: VitalChannel): number {
    const gains: Record<string, number> = {
      heart: 1.0, spo2: 1.0, bloodPressure: 1.0, hemoglobin: 1.0, glucose: 1.0, lipids: 1.0
    };
    return gains[channel] || 1.0;
  }

  private defaultBand(channel: VitalChannel): [number, number] {
    return [0.5, 4.0]; // Banda ancha para no perder datos reales
  }

  reset(): void {
    for (const ch of this.channels) {
      this.channelFilters[ch].kalman.reset();
      this.channelFilters[ch].sg.reset();
    }
  }

  pushChannelFeedback(): void {}
  snapshot(): Record<VitalChannel, ChannelState> { return { ...this.channelStates }; }
}
