/**
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

type Sample = { t: number; v: number };

export default class PPGChannel {
  channelId: number;
  private buffer: Sample[] = [];
  private windowSec: number;
  private gain: number;
  private minRMeanForFinger = 10; // REDUCIDO: más permisivo para detectar dedo

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
    
    // DEBUG: Log del estado del buffer
    if (this.buffer.length % 10 === 0) { // Log cada 10 muestras
      console.log(`📊 Canal ${this.channelId} - Buffer Status:`, {
        length: this.buffer.length,
        timeSpan: this.buffer.length > 0 ? (this.buffer[this.buffer.length-1].t - this.buffer[0].t).toFixed(2) + 's' : '0s',
        lastValue: v.toFixed(2),
        gain: this.gain.toFixed(2)
      });
    }
  }

  adjustGainRel(rel: number) {
    this.gain = Math.max(0.1, Math.min(10, this.gain * (1 + rel)));
  }
  setGain(g: number) { this.gain = Math.max(0.1, Math.min(10, g)); }
  getGain() { return this.gain; }

  analyze() {
    if (this.buffer.length < 5) { // REDUCIDO: buffer mínimo más pequeño para análisis más rápido
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
    const isFinger = meanRaw >= this.minRMeanForFinger && snr > 0.8 && (bpmSpectral || bpmTime); // MUY REDUCIDO snr de 1.5 a 0.8

    // DEBUG: Log de detección de dedo por canal
    console.log(`🔴 Canal ${this.channelId} - Finger Detection:`, {
      meanRaw: meanRaw.toFixed(2),
      minRMeanForFinger: this.minRMeanForFinger,
      snr: snr.toFixed(2),
      bpmSpectral,
      bpmTime,
      isFinger,
      bufferLength: this.buffer.length
    });

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
      const s0 = samples[j]; const s1 = samples[Math.min(samples.length-1,j+1)];
      if (s1.t === s0.t) out.push(s0.v); else {
        const a = (tt - s0.t)/(s1.t - s0.t);
        out.push(s0.v*(1-a) + s1.v*a);
      }
    }
    return out;
  }
  private linspace(a:number,b:number,n:number){ const r:number[]=[]; for(let i=0;i<n;i++) r.push(a + (b-a)*(i/(n-1))); return r; }
  private median(arr:number[]){ const s=arr.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length ? s[m]:0; }
}
