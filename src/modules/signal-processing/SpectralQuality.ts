/**
 * SPECTRAL QUALITY
 * 
 * SQI espectral usando ventanas deslizantes y análisis PSD.
 */

import { RobustStats } from './RobustStats';

export interface SpectralMetrics {
  dominantFrequencyHz: number;
  dominantBpmEstimate: number;
  spectralConfidence: number;
  bandPowerRatio: number;
  peakSharpness: number;
  harmonicSupport: number;
  ambiguityPenalty: number;
  flatnessPenalty: number;
}

export class SpectralQuality {
  private windowSize: number;
  private sampleRate: number;
  private minFreq: number;
  private maxFreq: number;

  constructor(
    sampleRate: number = 30,
    windowSize: number = 120,
    minFreq: number = 0.5,
    maxFreq: number = 5.0
  ) {
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
  }

  /**
   * Calcula PSD usando Welch simplificado (periodograma promediado)
   */
  private computePSD(signal: number[]): { freqs: number[]; psd: number[] } {
    const n = signal.length;
    if (n < 8) return { freqs: [], psd: [] };

    const freqs: number[] = [];
    const psd: number[] = [];

    // FFT simplificado usando DFT para frecuencias de interés
    const numFreqs = Math.floor(n / 2);
    for (let k = 0; k < numFreqs; k++) {
      const freq = (k * this.sampleRate) / n;
      if (freq > this.maxFreq * 1.5) break; // Solo hasta 1.5x maxFreq

      let real = 0, imag = 0;
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * k * i) / n;
        real += signal[i] * Math.cos(angle);
        imag -= signal[i] * Math.sin(angle);
      }

      const magnitude = Math.sqrt(real * real + imag * imag);
      const power = (magnitude * magnitude) / (n * n);
      
      freqs.push(freq);
      psd.push(power);
    }

    return { freqs, psd };
  }

  /**
   * Calcula métricas espectrales
   */
  compute(signal: number[]): SpectralMetrics {
    if (signal.length < 30) {
      return {
        dominantFrequencyHz: 0,
        dominantBpmEstimate: 0,
        spectralConfidence: 0,
        bandPowerRatio: 0,
        peakSharpness: 0,
        harmonicSupport: 0,
        ambiguityPenalty: 1,
        flatnessPenalty: 1
      };
    }

    // Detrendear
    const mean = RobustStats.mean(signal);
    const detrended = signal.map(v => v - mean);

    // Calcular PSD
    const { freqs, psd } = this.computePSD(detrended);
    if (freqs.length === 0) {
      return this.getEmptyMetrics();
    }

    // Encontrar pico dominante en banda cardíaca
    const bandIndices = freqs
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f >= this.minFreq && f <= this.maxFreq);

    if (bandIndices.length === 0) {
      return this.getEmptyMetrics();
    }

    let maxPower = 0;
    let dominantFreq = 0;
    let dominantIdx = 0;

    for (const { f, i } of bandIndices) {
      if (psd[i] > maxPower) {
        maxPower = psd[i];
        dominantFreq = f;
        dominantIdx = i;
      }
    }

    if (maxPower === 0) {
      return this.getEmptyMetrics();
    }

    // Potencia en banda vs fuera de banda
    const bandPower = bandIndices.reduce((sum, { i }) => sum + psd[i], 0);
    const totalPower = psd.reduce((sum, p) => sum + p, 0);
    const bandPowerRatio = totalPower > 0 ? bandPower / totalPower : 0;

    // Sharpness del pico (relación pico/vecinos)
    let peakSharpness = 0;
    if (dominantIdx > 0 && dominantIdx < psd.length - 1) {
      const left = psd[dominantIdx - 1];
      const right = psd[dominantIdx + 1];
      const neighborAvg = (left + right) / 2;
      peakSharpness = neighborAvg > 0 ? maxPower / neighborAvg : 1;
    }

    // Soporte armónico (2x frecuencia)
    const harmonicFreq = dominantFreq * 2;
    const harmonicIdx = freqs.findIndex(f => Math.abs(f - harmonicFreq) < 0.2);
    let harmonicSupport = 0;
    if (harmonicIdx >= 0 && psd[harmonicIdx] > 0) {
      harmonicSupport = psd[harmonicIdx] / maxPower;
    }

    // Penalización por ambigüedad (múltiples picos similares)
    const sortedPowers = [...psd].sort((a, b) => b - a);
    const secondPeak = sortedPowers[1] || 0;
    const ambiguityPenalty = maxPower > 0 ? secondPeak / maxPower : 0;

    // Penalización por espectro plano
    const psdMean = RobustStats.mean(psd);
    const psdStd = RobustStats.std(psd);
    const flatnessPenalty = psdMean > 0 ? 1 - (psdStd / psdMean) : 1;

    // Confianza espectral combinada
    const spectralConfidence = Math.max(0, Math.min(1,
      bandPowerRatio * 0.4 +
      Math.min(1, peakSharpness / 3) * 0.25 +
      harmonicSupport * 0.15 +
      (1 - ambiguityPenalty) * 0.1 +
      (1 - flatnessPenalty) * 0.1
    ));

    return {
      dominantFrequencyHz: dominantFreq,
      dominantBpmEstimate: dominantFreq * 60,
      spectralConfidence,
      bandPowerRatio,
      peakSharpness,
      harmonicSupport,
      ambiguityPenalty,
      flatnessPenalty
    };
  }

  private getEmptyMetrics(): SpectralMetrics {
    return {
      dominantFrequencyHz: 0,
      dominantBpmEstimate: 0,
      spectralConfidence: 0,
      bandPowerRatio: 0,
      peakSharpness: 0,
      harmonicSupport: 0,
      ambiguityPenalty: 1,
      flatnessPenalty: 1
    };
  }

  /**
   * Calcula estabilidad de frecuencia dominante entre ventanas
   */
  computeFrequencyStability(previousMetrics: SpectralMetrics, currentMetrics: SpectralMetrics): number {
    if (previousMetrics.dominantFrequencyHz === 0 || currentMetrics.dominantFrequencyHz === 0) {
      return 0;
    }

    const diff = Math.abs(previousMetrics.dominantFrequencyHz - currentMetrics.dominantFrequencyHz);
    const stability = Math.max(0, 1 - diff / 0.5); // 0.5 Hz de tolerancia
    return stability;
  }

  /**
   * Cambia sample rate
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }

  /**
   * Cambia tamaño de ventana
   */
  setWindowSize(size: number): void {
    this.windowSize = size;
  }
}
