
/**
 * PPGChannel CORREGIDO: BPM preciso con algoritmos mejorados
 */

import { savitzkyGolay } from './SavitzkyGolayFilter';
import { goertzelPower } from './Goertzel';
import { computeSNR } from './SignalQualityAnalyzer';

type Sample = { t: number; v: number };

export default class PPGChannel {
  channelId: number;
  private buffer: Sample[] = [];
  private windowSec: number;
  private gain: number;
  private lastBpm: number | null = null;
  private lastSnr = 0;
  private lastQuality = 0;
  private minRMeanForFinger = 12; // MUY PERMISIVO PARA DEBUG
  private peakHistory: number[] = [];

  constructor(channelId = 0, windowSec = 8, initialGain = 1) {
    this.channelId = channelId;
    this.windowSec = windowSec;
    this.gain = initialGain;
  }

  pushSample(rawValue: number, timestampMs: number) {
    const t = timestampMs / 1000;
    const v = rawValue * this.gain;
    this.buffer.push({ t, v });
    const t0 = t - this.windowSec;
    while (this.buffer.length && this.buffer[0].t < t0) this.buffer.shift();
  }

  adjustGain(delta: number) {
    this.gain = Math.max(0.1, Math.min(10, this.gain * (1 + delta)));
  }

  getGain() {
    return this.gain;
  }

  analyze(): {
    calibratedSignal: number[];
    bpm: number | null;
    snr: number;
    quality: number;
    isFingerDetected: boolean;
  } {
    if (this.buffer.length < 8) {
      return { calibratedSignal: [], bpm: null, snr: 0, quality: 0, isFingerDetected: false };
    }

    const N = Math.min(256, this.buffer.length);
    const sampled = this.resampleUniform(this.buffer, N);
    const detr = this.detrend(sampled);
    const smooth = savitzkyGolay(detr, Math.min(15, N-2), 3);
    
    // DETECTAR PICOS REALES PARA BPM PRECISO
    const peaks = this.findRealPeaks(smooth);
    this.peakHistory = [...this.peakHistory, ...peaks].slice(-20); // Mantener historial
    
    const fs = N / this.windowSec;

    // CÁLCULO BPM MEJORADO - MÚLTIPLES MÉTODOS
    let bpm = null;
    
    // Método 1: Intervalos entre picos
    if (peaks.length >= 3) {
      const intervals = [];
      for (let i = 1; i < peaks.length; i++) {
        const interval = (peaks[i] - peaks[i-1]) / fs * 1000; // ms
        if (interval > 300 && interval < 2000) { // 30-200 BPM válido
          intervals.push(interval);
        }
      }
      
      if (intervals.length >= 2) {
        const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
        const bpmFromPeaks = Math.round(60000 / avgInterval);
        console.log(`📈 Canal ${this.channelId}: BPM por picos=${bpmFromPeaks}, intervalos=${intervals.map(i => i.toFixed(0)).join(',')}`);
        
        if (bpmFromPeaks >= 50 && bpmFromPeaks <= 200) {
          bpm = bpmFromPeaks;
        }
      }
    }
    
    // Método 2: Análisis de frecuencia (fallback)
    if (!bpm) {
      // Rango cardíaco: 0.8-3.5 Hz (48-210 BPM)
      const freqs = this.linspace(0.8, 3.5, 80);
      const powers = freqs.map(f => goertzelPower(smooth, fs, f));
      
      // Encontrar pico dominante
      let maxPower = 0;
      let maxFreq = 0;
      for (let i = 0; i < powers.length; i++) {
        if (powers[i] > maxPower) {
          maxPower = powers[i];
          maxFreq = freqs[i];
        }
      }
      
      if (maxPower > 1e-6) { // Umbral mínimo
        const bpmFromFreq = Math.round(maxFreq * 60);
        console.log(`🎵 Canal ${this.channelId}: BPM por frecuencia=${bpmFromFreq}, power=${maxPower.toExponential(2)}`);
        
        if (bpmFromFreq >= 50 && bpmFromFreq <= 200) {
          bpm = bpmFromFreq;
        }
      }
    }

    // Método 3: Historial (suavizado)
    if (bpm && this.lastBpm) {
      const diff = Math.abs(bpm - this.lastBpm);
      if (diff > 20) { // Cambio muy brusco
        bpm = Math.round((bpm + this.lastBpm) / 2); // Promedio
        console.log(`🔄 Canal ${this.channelId}: BPM suavizado=${bpm}`);
      }
    }

    // Calidad y SNR
    const meanLast = sampled.reduce((a,b)=>a+b,0)/sampled.length;
    const variance = this.calculateVariance(sampled);
    const snr = variance > 0 ? (Math.max(...sampled) - Math.min(...sampled)) / variance : 0;
    const quality = computeSNR(variance, Math.min(...sampled));

    // DETECCIÓN DE DEDO MEJORADA
    const hasVariation = variance > 0.1;
    const hasGoodMean = meanLast >= this.minRMeanForFinger;
    const hasReasonableRange = (Math.max(...sampled) - Math.min(...sampled)) > 2;
    
    const isFinger = hasGoodMean && hasVariation && hasReasonableRange;

    console.log(`📊 Canal ${this.channelId}: BPM=${bpm}, mean=${meanLast.toFixed(1)}, var=${variance.toFixed(3)}, dedo=${isFinger}, picos=${peaks.length}`);

    this.lastBpm = bpm;
    this.lastSnr = snr;
    this.lastQuality = quality;

    return {
      calibratedSignal: smooth,
      bpm,
      snr,
      quality,
      isFingerDetected: isFinger
    };
  }

  // DETECTOR DE PICOS MEJORADO
  private findRealPeaks(signal: number[]): number[] {
    if (signal.length < 5) return [];
    
    const peaks: number[] = [];
    const threshold = this.calculateAdaptiveThreshold(signal);
    
    for (let i = 2; i < signal.length - 2; i++) {
      const current = signal[i];
      const isLocalMax = current > signal[i-1] && current > signal[i+1] &&
                        current > signal[i-2] && current > signal[i+2];
      
      if (isLocalMax && current > threshold) {
        // Verificar que no hay otro pico muy cerca
        const tooClose = peaks.some(p => Math.abs(i - p) < 8); // Mín 8 muestras entre picos
        if (!tooClose) {
          peaks.push(i);
        }
      }
    }
    
    return peaks;
  }

  private calculateAdaptiveThreshold(signal: number[]): number {
    const mean = signal.reduce((a,b) => a+b, 0) / signal.length;
    const variance = this.calculateVariance(signal);
    return mean + variance * 0.5; // Threshold adaptativo
  }

  private calculateVariance(arr: number[]): number {
    const mean = arr.reduce((a,b) => a+b, 0) / arr.length;
    const squareDiffs = arr.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a,b) => a+b, 0) / arr.length);
  }

  // Helpers
  private linspace(a:number,b:number,n:number){ const r:number[]=[]; for(let i=0;i<n;i++) r.push(a + (b-a)*(i/(n-1))); return r; }

  private resampleUniform(samples: Sample[], N:number){
    if (samples.length === 0) return [];
    const t0 = samples[0].t; const t1 = samples[samples.length-1].t;
    const T = Math.max(0.001, t1 - t0);
    const out:number[]=[];
    for (let i=0;i<N;i++){
      const tt = t0 + (i/(N-1))*T;
      let j=0; while (j < samples.length-1 && samples[j+1].t < tt) j++;
      const s0 = samples[j]; const s1 = samples[Math.min(samples.length-1,j+1)];
      if (s1.t === s0.t) out.push(s0.v); else {
        const alpha = (tt - s0.t)/(s1.t - s0.t);
        out.push(s0.v*(1-alpha)+s1.v*alpha);
      }
    }
    return out;
  }

  private detrend(arr:number[]){ const n=arr.length; const mean = arr.reduce((a,b)=>a+b,0)/n; return arr.map(v=>v-mean); }
}
