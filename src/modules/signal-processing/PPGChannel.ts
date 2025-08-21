
/**
 * Canal PPG avanzado CORREGIDO:
 * - Umbrales ajustados para valores reales de cámara (0-255)
 * - Detección de dedo más robusta y balanceada
 * - SNR calculado correctamente
 * - Logging mejorado para debug
 */

import { savitzkyGolay } from './SavitzkyGolayFilter';
import { Biquad } from './Biquad';
import { goertzelPower } from './Goertzel';
import { computeSNR } from './SignalQualityAnalyzer';
import { detectPeaks } from './TimeDomainPeak';

type Sample = { t: number; v: number };

export default class PPGChannel {
  channelId: number;
  private buffer: Sample[] = [];
  private windowSec: number;
  private gain: number;
  
  // CORREGIDO: Umbrales realistas para valores de cámara (0-255)
  private minRMeanForFinger = 80;  // Mínimo brillo para detectar dedo
  private maxRMeanForFinger = 250; // Máximo brillo (evitar saturación)
  private minVarianceForPulse = 2;  // Mínima variación para pulso
  private minSNRForFinger = 1.2;   // SNR mínimo aceptable

  constructor(channelId = 0, windowSec = 8, initialGain = 1) {
    this.channelId = channelId;
    this.windowSec = windowSec;
    this.gain = initialGain;
  }

  pushSample(rawValue: number, timestampMs: number) {
    const t = timestampMs / 1000;
    const v = rawValue * this.gain;
    this.buffer.push({ t, v });
    
    // Mantener ventana temporal
    const t0 = t - this.windowSec;
    while (this.buffer.length && this.buffer[0].t < t0) {
      this.buffer.shift();
    }
    
    // Debug logging cada 50 muestras
    if (this.buffer.length % 50 === 0) {
      console.log(`📊 Canal ${this.channelId}:`, {
        bufferSize: this.buffer.length,
        timeSpan: this.buffer.length > 0 ? 
          (this.buffer[this.buffer.length-1].t - this.buffer[0].t).toFixed(2) + 's' : '0s',
        lastValue: v.toFixed(2),
        gain: this.gain.toFixed(3),
        rawValue: rawValue.toFixed(1)
      });
    }
  }

  adjustGainRel(rel: number) {
    this.gain = Math.max(0.1, Math.min(10, this.gain * (1 + rel)));
  }

  setGain(g: number) { 
    this.gain = Math.max(0.1, Math.min(10, g)); 
  }

  getGain() { 
    return this.gain; 
  }

  analyze() {
    if (this.buffer.length < 30) { // Mínimo buffer para análisis confiable
      return { 
        calibratedSignal: [], 
        bpm: null, 
        rrIntervals: [], 
        snr: 0, 
        quality: 0, 
        isFingerDetected: false, 
        gain: this.gain 
      };
    }

    // Remuestreo uniforme
    const N = 256;
    const sampled = this.resampleUniform(this.buffer, N);
    
    // Calcular estadísticas básicas
    const mean = sampled.reduce((a, b) => a + b, 0) / sampled.length;
    const variance = sampled.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sampled.length;
    const std = Math.sqrt(variance);

    // Normalización z-score
    const normalized = std > 0.1 ? 
      sampled.map(x => (x - mean) / std) : 
      sampled.map(x => x - mean);

    // Filtrado pasabanda (0.7-4 Hz para rango cardíaco)
    const fs = N / this.windowSec;
    const biquad = new Biquad();
    biquad.setBandpass(1.5, 0.7, fs); // Centro 1.5Hz (90 bpm), ancho moderado
    const filtered = biquad.processArray(normalized);

    // Suavizado
    const smooth = savitzkyGolay(filtered, 11);

    // Análisis espectral con Goertzel
    const freqs = this.linspace(0.7, 4.0, 150);
    const powers = freqs.map(f => goertzelPower(smooth, fs, f));
    
    // Encontrar pico espectral
    const maxPower = Math.max(...powers);
    const maxIdx = powers.indexOf(maxPower);
    const peakFreq = freqs[maxIdx];
    
    // Calcular SNR mejorado
    const sortedPowers = powers.slice().sort((a, b) => b - a);
    const signalPower = sortedPowers[0];
    const noisePower = this.median(sortedPowers.slice(Math.floor(sortedPowers.length * 0.3)));
    const snr = signalPower / Math.max(1e-9, noisePower);
    
    // Calidad basada en múltiples factores
    const qualitySpectral = Math.min(100, Math.max(0, (snr - 1) * 30));
    const qualityVariance = variance > this.minVarianceForPulse ? 20 : 0;
    const qualityStability = this.buffer.length >= 100 ? 20 : 0;
    const quality = qualitySpectral + qualityVariance + qualityStability;

    // BPM del pico espectral
    const bpmSpectral = maxPower > 1e-6 ? Math.round(peakFreq * 60) : null;

    // Detección de picos temporales para RR
    const { peaks, peakTimesMs, rr } = detectPeaks(smooth, fs, 300, 0.15);
    const bpmTemporal = rr.length >= 2 ? 
      Math.round(60000 / (rr.reduce((a,b) => a+b, 0) / rr.length)) : null;

    // CRITERIOS DE DETECCIÓN DE DEDO MEJORADOS
    const brightnessOk = mean >= this.minRMeanForFinger && mean <= this.maxRMeanForFinger;
    const varianceOk = variance >= this.minVarianceForPulse;
    const snrOk = snr >= this.minSNRForFinger;
    const bpmOk = (bpmSpectral && bpmSpectral >= 45 && bpmSpectral <= 180) || 
                  (bpmTemporal && bpmTemporal >= 45 && bpmTemporal <= 180);
    
    const isFingerDetected = brightnessOk && varianceOk && snrOk && bpmOk;

    // Debug detección completa
    if (this.channelId === 0 || isFingerDetected) {
      console.log(`🔍 Canal ${this.channelId} Detección:`, {
        mean: mean.toFixed(1),
        variance: variance.toFixed(2),
        snr: snr.toFixed(2),
        quality: quality.toFixed(1),
        bpmSpectral,
        bpmTemporal,
        brightnessOk,
        varianceOk,
        snrOk,
        bpmOk,
        isFingerDetected
      });
    }

    return {
      calibratedSignal: smooth,
      bpm: isFingerDetected ? (bpmTemporal || bpmSpectral) : null,
      rrIntervals: rr,
      snr,
      quality: Math.round(quality),
      isFingerDetected,
      gain: this.gain
    };
  }

  // Helper methods
  private resampleUniform(samples: Sample[], N: number) {
    if (samples.length === 0) return [];
    
    const t0 = samples[0].t;
    const t1 = samples[samples.length - 1].t;
    const T = Math.max(0.001, t1 - t0);
    const output: number[] = [];
    
    for (let i = 0; i < N; i++) {
      const targetTime = t0 + (i / (N - 1)) * T;
      let j = 0;
      
      // Encontrar muestras adyacentes
      while (j < samples.length - 1 && samples[j + 1].t < targetTime) {
        j++;
      }
      
      const s0 = samples[j];
      const s1 = samples[Math.min(samples.length - 1, j + 1)];
      
      if (s1.t === s0.t) {
        output.push(s0.v);
      } else {
        // Interpolación lineal
        const alpha = (targetTime - s0.t) / (s1.t - s0.t);
        output.push(s0.v * (1 - alpha) + s1.v * alpha);
      }
    }
    
    return output;
  }

  private linspace(start: number, end: number, num: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < num; i++) {
      result.push(start + (end - start) * (i / (num - 1)));
    }
    return result;
  }

  private median(arr: number[]): number {
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length > 0 ? sorted[mid] : 0;
  }
}
