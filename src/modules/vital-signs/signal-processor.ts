
import { Biquad } from '../signal-processing/Biquad';
import { savitzkyGolay } from '../signal-processing/SavitzkyGolayFilter';

export interface SignalMetrics {
  snr: number;
  variance: number;
  mean: number;
  quality: number;
  isStable: boolean;
}

export class SignalProcessor {
  private buffer: number[] = [];
  private timestamps: number[] = [];
  private filter: Biquad;
  
  constructor() {
    this.filter = new Biquad();
    // Configurar filtro pasabanda para PPG (0.7-4 Hz)
    this.filter.setBandpass(1.5, 0.8, 30);
  }

  addSample(value: number, timestamp: number = Date.now()) {
    this.buffer.push(value);
    this.timestamps.push(timestamp);
    
    // Mantener ventana de 8 segundos aproximadamente (240 muestras a 30fps)
    const maxSamples = 240;
    if (this.buffer.length > maxSamples) {
      this.buffer.shift();
      this.timestamps.shift();
    }
  }

  getFilteredSignal(): number[] {
    if (this.buffer.length < 10) return [];
    
    // Aplicar filtro pasabanda
    const filtered = this.buffer.map(sample => this.filter.processSample(sample));
    
    // Suavizado con Savitzky-Golay
    return savitzkyGolay(filtered, 9);
  }

  calculateMetrics(): SignalMetrics {
    if (this.buffer.length < 10) {
      return {
        snr: 0,
        variance: 0,
        mean: 0,
        quality: 0,
        isStable: false
      };
    }

    const filtered = this.getFilteredSignal();
    const mean = filtered.reduce((sum, val) => sum + val, 0) / filtered.length;
    const variance = filtered.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / filtered.length;
    
    // Calcular SNR aproximado
    const signal = Math.sqrt(variance);
    const noise = this.estimateNoise(filtered);
    const snr = noise > 0 ? 20 * Math.log10(signal / noise) : 0;
    
    // Calidad basada en SNR y estabilidad
    const quality = Math.max(0, Math.min(100, (snr + 20) * 2));
    const isStable = variance < 1000 && this.buffer.length > 30;

    return {
      snr,
      variance,
      mean,
      quality,
      isStable
    };
  }

  private estimateNoise(signal: number[]): number {
    // Estimar ruido como desviación estándar de las diferencias
    const diffs = [];
    for (let i = 1; i < signal.length; i++) {
      diffs.push(Math.abs(signal[i] - signal[i-1]));
    }
    return diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
  }

  reset() {
    this.buffer = [];
    this.timestamps = [];
    this.filter = new Biquad();
    this.filter.setBandpass(1.5, 0.8, 30);
  }
}
