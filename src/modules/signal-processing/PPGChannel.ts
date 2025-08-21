/**
<<<<<<< HEAD
 * Canal PPG avanzado:
 * - mantiene buffer temporal (timestamps + valores)
 * - aplica normalización adaptativa (z-score con ventana)
 * - aplica biquad pasabanda + Savitzky para suavizar
 * - calcula SNR con Goertzel y detecta picos (TimeDomainPeak)
 * - devuelve métricas y mantiene gain ajustable (feedback)
 */

import { savitzkyGolay } from './SavitzkyGolayFilter';
import { Biquad } from './Biquad';
import { goertzelPower } from './Goertzel';
import { computeSNR } from './SignalQualityAnalyzer';
import { detectPeaks } from './TimeDomainPeak';
=======
 * PPGChannel OPTIMIZADO: BPM preciso con ondas más finas
 */

import { savitzkyGolay } from './SavitzkyGolayFilter';
import { goertzelPower } from './Goertzel';
import { computeSNR } from './SignalQualityAnalyzer';
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8

type Sample = { t: number; v: number };

export default class PPGChannel {
  channelId: number;
  private buffer: Sample[] = [];
  private windowSec: number;
  private gain: number;
<<<<<<< HEAD
  private minRMeanForFinger = 20; // configurable
=======
  private lastBpm: number | null = null;
  private lastSnr = 0;
  private lastQuality = 0;
  private minRMeanForFinger = 25; // RESTAURAR VALOR QUE FUNCIONABA
  private peakHistory: number[] = [];
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8

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

<<<<<<< HEAD
  adjustGainRel(rel: number) {
    this.gain = Math.max(0.1, Math.min(10, this.gain * (1 + rel)));
  }
  setGain(g: number) { this.gain = Math.max(0.1, Math.min(10, g)); }
  getGain() { return this.gain; }

  analyze() {
    if (this.buffer.length < 10) {
      return { calibratedSignal: [], bpm: null, rrIntervals: [], snr: 0, quality: 0, isFingerDetected: false, gain: this.gain };
    }

    // remuestreo uniforme a N
    const N = 256;
    const sampled = this.resampleUniform(this.buffer, N);
    // normalizar (z-score) para quitar offset lento
    const mean = sampled.reduce((a, b) => a + b, 0) / sampled.length;
    const std = Math.sqrt(sampled.reduce((a, b) => a + (b - mean)*(b - mean), 0) / sampled.length) || 1;
    const norm = sampled.map(x => (x - mean) / std);

    // filtrar pasabanda
    const fs = N / this.windowSec;
    const bi = new Biquad();
    bi.setBandpass(1.3, 0.6, fs); // centro ~1.3Hz (78 bpm), Q moderada -> amplio 0.7-3.5 Hz
    const filtered = bi.processArray(norm);

    // suavizar
    const smooth = savitzkyGolay(filtered, 11);

    // espectro con Goertzel en 0.7..3.5 Hz
    const freqs = this.linspace(0.7, 3.5, 120);
    const powers = freqs.map(f => goertzelPower(smooth, fs, f));
    const sorted = powers.slice().sort((a,b)=>b-a);
    const peak = sorted[0] || 0;
    const noiseMedian = this.median(powers.slice(Math.max(1, Math.floor(powers.length*0.25))));
    const snr = peak / Math.max(1e-9, noiseMedian);
    const quality = computeSNR(peak, noiseMedian);

    // BPM por pico espectral
    const peakIdx = powers.indexOf(peak);
    const fPeak = freqs[peakIdx] || 0;
    const bpmSpectral = peak > 1e-6 ? Math.round(fPeak * 60) : null;

    // detección picos en tiempo (para RR)
    const { peaks, peakTimesMs, rr } = detectPeaks(smooth, fs, 300, 0.2);
    const bpmTime = rr.length ? Math.round(60000 / (rr.reduce((a,b)=>a+b,0)/rr.length)) : null;

    // decisión dedo: mean raw (antes normalización) y coverage es responsabilidad del CameraView + manager;
    const meanRaw = sampled.reduce((a,b)=>a+b,0)/sampled.length;
    const isFinger = meanRaw >= this.minRMeanForFinger && snr > 3 && (bpmSpectral || bpmTime);

    return {
      calibratedSignal: smooth,
      bpm: isFinger ? (bpmTime || bpmSpectral) : null,
      rrIntervals: rr,
      snr,
      quality,
      isFingerDetected: isFinger,
      gain: this.gain
    };
  }

  // helpers
  private resampleUniform(samples: Sample[], N:number) {
    if (samples.length === 0) return [];
    const t0 = samples[0].t; const t1 = samples[samples.length-1].t;
    const T = Math.max(0.001, t1 - t0);
    const out:number[] = [];
    for (let i=0;i<N;i++){
      const tt = t0 + (i/(N-1))*T;
      let j=0; while (j < samples.length-1 && samples[j+1].t < tt) j++;
      const s0 = samples[j]; const s1 = samples[Math.min(samples.length-1, j+1)];
      if (s1.t === s0.t) out.push(s0.v); else {
        const a = (tt - s0.t)/(s1.t - s0.t);
        out.push(s0.v*(1-a) + s1.v*a);
=======
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
    // SUAVIZADO MÁS SUTIL PARA ONDAS MÁS FINAS
    const smooth = savitzkyGolay(detr, Math.min(9, N-2), 2); // Reducido de 15 a 9, grado 2
    
    const peaks = this.findRealPeaks(smooth);
    this.peakHistory = [...this.peakHistory, ...peaks].slice(-20);
    
    const fs = N / this.windowSec;

    let bpm = null;
    
    // Método 1: Intervalos entre picos - MÁS PRECISO
    if (peaks.length >= 3) {
      const intervals = [];
      for (let i = 1; i < peaks.length; i++) {
        const interval = (peaks[i] - peaks[i-1]) / fs * 1000;
        if (interval > 300 && interval < 2000) {
          intervals.push(interval);
        }
      }
      
      if (intervals.length >= 2) {
        const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
        const bpmFromPeaks = Math.round(60000 / avgInterval);
        
        if (bpmFromPeaks >= 50 && bpmFromPeaks <= 200) {
          bpm = bpmFromPeaks;
        }
      }
    }
    
    // Método 2: Análisis de frecuencia mejorado
    if (!bpm) {
      const freqs = this.linspace(0.8, 3.5, 100); // Mayor resolución
      const powers = freqs.map(f => goertzelPower(smooth, fs, f));
      
      let maxPower = 0;
      let maxFreq = 0;
      for (let i = 0; i < powers.length; i++) {
        if (powers[i] > maxPower) {
          maxPower = powers[i];
          maxFreq = freqs[i];
        }
      }
      
      if (maxPower > 1e-6) {
        const bpmFromFreq = Math.round(maxFreq * 60);
        
        if (bpmFromFreq >= 50 && bpmFromFreq <= 200) {
          bpm = bpmFromFreq;
        }
      }
    }

    // Suavizado inteligente
    if (bpm && this.lastBpm) {
      const diff = Math.abs(bpm - this.lastBpm);
      if (diff > 15) { // Menos agresivo
        bpm = Math.round((bpm * 0.7) + (this.lastBpm * 0.3));
      }
    }

    // Calidad y SNR optimizados
    const meanLast = sampled.reduce((a,b)=>a+b,0)/sampled.length;
    const variance = this.calculateVariance(sampled);
    const snr = variance > 0 ? (Math.max(...sampled) - Math.min(...sampled)) / variance : 0;
    const quality = computeSNR(variance, Math.min(...sampled));

    // DETECCIÓN DE DEDO RESTAURADA A VALORES QUE FUNCIONABAN
    const hasVariation = variance > 0.05; // Más sensible
    const hasGoodMean = meanLast >= this.minRMeanForFinger;
    const hasReasonableRange = (Math.max(...sampled) - Math.min(...sampled)) > 1.5;
    
    const isFinger = hasGoodMean && hasVariation && hasReasonableRange;

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

  // DETECTOR DE PICOS OPTIMIZADO PARA ONDAS MÁS FINAS
  private findRealPeaks(signal: number[]): number[] {
    if (signal.length < 5) return [];
    
    const peaks: number[] = [];
    const threshold = this.calculateAdaptiveThreshold(signal);
    
    for (let i = 2; i < signal.length - 2; i++) {
      const current = signal[i];
      const isLocalMax = current > signal[i-1] && current > signal[i+1] &&
                        current > signal[i-2] && current > signal[i+2];
      
      if (isLocalMax && current > threshold) {
        const tooClose = peaks.some(p => Math.abs(i - p) < 6); // Menos restrictivo
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
    return mean + variance * 0.4; // Menos restrictivo
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
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
      }
    }
    return out;
  }
<<<<<<< HEAD
  private linspace(a:number,b:number,n:number){ const r:number[]=[]; for(let i=0;i<n;i++) r.push(a + (b-a)*(i/(n-1))); return r; }
  private median(arr:number[]){ const s=arr.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length ? s[m] : 0; }
=======

  private detrend(arr:number[]){ const n=arr.length; const mean = arr.reduce((a,b)=>a+b,0)/n; return arr.map(v=>v-mean); }
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
}
