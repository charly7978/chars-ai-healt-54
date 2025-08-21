/**
 * PPGChannel: VERSIÓN CORREGIDA con umbrales más permisivos
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
  private minRMeanForFinger = 15; // REDUCIDO DE 25 A 15 - MÁS PERMISIVO

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
    if (this.buffer.length < 5) { // REDUCIDO DE 10 A 5 - MÁS PERMISIVO
      return { calibratedSignal: [], bpm: null, snr: 0, quality: 0, isFingerDetected: false };
    }

    const N = Math.min(128, this.buffer.length); // REDUCIDO DE 256 A 128 - MÁS RÁPIDO
    const sampled = this.resampleUniform(this.buffer, N);
    const detr = this.detrend(sampled);
    const smooth = savitzkyGolay(detr, Math.min(7, N-2), 2); // PARÁMETROS MÁS PERMISIVOS
    const fs = N / this.windowSec;

    // evaluar energía en banda más amplia: 0.5-4.0 Hz (antes 0.8-3.0)
    const freqs = this.linspace(0.5, 4.0, 50); // MENOS PUNTOS, MÁS RÁPIDO
    const powers = freqs.map(f => goertzelPower(smooth, fs, f));
    const sorted = powers.slice().sort((a,b)=>b-a);
    const peak = sorted[0] || 0;
    const noiseMedian = this.median(powers.slice(Math.floor(powers.length*0.3))); // MÁS PERMISIVO
    const snr = peak / Math.max(1e-12, noiseMedian); // DENOMINADOR MÁS PEQUEÑO
    const quality = computeSNR(peak, noiseMedian);

    const peakIndex = powers.indexOf(peak);
    const peakFreq = freqs[peakIndex] || 0;
    const bpm = peak > 1e-9 ? Math.round(peakFreq * 60) : null; // UMBRAL MÁS BAJO

    // DETECCIÓN DE DEDO MÁS PERMISIVA
    const meanLast = sampled.reduce((a,b)=>a+b,0)/sampled.length;
    const isFinger = meanLast >= this.minRMeanForFinger && snr > 1.5 && peak > 1e-9; // UMBRALES REDUCIDOS

    console.log(`📊 Canal ${this.channelId}: mean=${meanLast.toFixed(1)}, snr=${snr.toFixed(2)}, peak=${peak.toExponential(2)}, dedo=${isFinger}`);

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

  // Helpers
  private linspace(a:number,b:number,n:number){ const r:number[]=[]; for(let i=0;i<n;i++) r.push(a + (b-a)*(i/(n-1))); return r; }
  private median(arr:number[]){ const s=arr.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length? s[m]:0; }

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
