
import { savitzkyGolay } from './SavitzkyGolayFilter';
import { computeSNR } from './SignalQualityAnalyzer';

export interface PPGProcessingResult {
  isFingerDetected: boolean;
  signalQuality: number;   // 0–100
  rawValue: number;        // último rMean
  bpm: number | null;      // estimación por FFT/Goertzel
  snr: number;            
  metrics: {
    snr: number;
    isStable: boolean;
  };
}

type Sample = { t: number; v: number };

export default class PPGSignalProcessor {
  private buffer: Sample[] = [];
  private windowSec = 8; // ventana de análisis en segundos (balance: latencia vs resolución)

  // parámetros
  private minRMeanForFinger = 25; // reducido para mayor sensibilidad
  private maxStdForFinger = 80;    // aumentado para tolerar más variación
  private minACAmplitude = 0.3;   // reducido para detectar señales más débiles

  constructor(windowSec = 8) {
    this.windowSec = windowSec;
  }

  processSample(rMean: number, rStd: number, frameDiff: number, timestampMs: number): PPGProcessingResult {
    // push sample
    this.buffer.push({ t: timestampMs / 1000, v: rMean });
    // limpiar buffer viejo
    const t0 = (timestampMs / 1000) - this.windowSec;
    while (this.buffer.length && this.buffer[0].t < t0) this.buffer.shift();

    const rawValue = rMean;

    // primera heurística de detección de dedo: promedio alto y desviación razonable
    const recentMeans = this.buffer.map(s => s.v);
    const meanAll = recentMeans.reduce((a,b)=>a+b,0)/Math.max(1,recentMeans.length);
    const variance = recentMeans.reduce((a,b)=>a+(b-meanAll)*(b-meanAll),0)/Math.max(1,recentMeans.length);
    const stdAll = Math.sqrt(variance);

    // Si el promedio rojo es muy bajo o la desviación espacial muy alta -> no dedo
    const fingerCandidates = (meanAll >= this.minRMeanForFinger) && (rStd <= this.maxStdForFinger);

    // si hay movimiento grande entre frames es probable que la toma no sea estable; penalizar
    const movementPenalty = Math.min(1, frameDiff / 30); // menos estricto

    // si no hay suficientes muestras -> no hay señal todavía
    if (this.buffer.length < 15) { // reducido para respuesta más rápida
      return { 
        isFingerDetected: false, 
        signalQuality: 0, 
        rawValue, 
        bpm: null, 
        snr: 0,
        metrics: { snr: 0, isStable: false }
      };
    }

    // resample uniformemente a N puntos para análisis espectral
    const sampled = this.resampleUniform(this.buffer, 256);
    const detr = this.detrend(sampled);
    const smooth = savitzkyGolay(detr, 11);

    // análisis espectral via Goertzel en rango 0.8 - 3.0 Hz (48 - 180 BPM)
    const fs = sampled.length / this.windowSec; // Hz
    const freqs = this.linspace(0.8, 3.0, 112);
    const powers = freqs.map(f => this.goertzelPower(smooth, fs, f));

    const sorted = powers.slice().sort((a,b)=>b-a);
    const peak = sorted[0] || 0;
    const noiseMedian = this.median(powers.slice(Math.max(1, Math.floor(powers.length*0.25))));
    const snr = peak / Math.max(1e-9, noiseMedian);
    const quality = computeSNR(peak, noiseMedian);

    // encontrar frecuencia de pico y convertir a BPM
    const peakIndex = powers.indexOf(peak);
    const peakFreq = freqs[peakIndex] || 0;
    const bpm = Math.round(peakFreq * 60);

    // criterios más permisivos para detección
    const isFinger = fingerCandidates && (snr > 2) && (peak > 5e-4) && (movementPenalty < 0.9);

    return {
      isFingerDetected: !!isFinger,
      signalQuality: Math.max(0, Math.min(100, Math.round(quality * (isFinger ? 1 : 0.4)))),
      rawValue,
      bpm: isFinger ? bpm : null,
      snr,
      metrics: { snr, isStable: movementPenalty < 0.7 }
    };
  }

  // Mantener métodos para compatibilidad
  processFrame(imageData: ImageData): PPGProcessingResult {
    // Convertir ImageData a valores promedio simples
    const data = imageData.data;
    let sum = 0, sum2 = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      sum += r;
      sum2 += r * r;
    }
    const len = data.length / 4;
    const mean = sum / len;
    const variance = Math.max(0, sum2 / len - mean * mean);
    const std = Math.sqrt(variance);
    
    return this.processSample(mean, std, 0, Date.now());
  }

  // Helpers
  private linspace(a:number,b:number,n:number){
    const r:number[]=[]; for(let i=0;i<n;i++) r.push(a + (b-a)*(i/(n-1))); return r;
  }

  private median(arr:number[]){
    const s=arr.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length? s[m]:0;
  }

  private resampleUniform(samples: Sample[], N:number){
    if (samples.length === 0) return [];
    const t0 = samples[0].t; const t1 = samples[samples.length-1].t;
    const T = Math.max(0.001, t1 - t0);
    const out:number[]=[];
    for (let i=0;i<N;i++){
      const tt = t0 + (i/(N-1))*T;
      // linear interpolation
      let j=0; while (j < samples.length-1 && samples[j+1].t < tt) j++;
      const s0 = samples[j]; const s1 = samples[Math.min(samples.length-1,j+1)];
      if (s1.t === s0.t) out.push(s0.v); else {
        const alpha = (tt - s0.t)/(s1.t - s0.t);
        out.push(s0.v*(1-alpha)+s1.v*alpha);
      }
    }
    return out;
  }

  private detrend(arr:number[]){
    const n = arr.length; const mean = arr.reduce((a,b)=>a+b,0)/n; return arr.map(v=>v-mean);
  }

  // Goertzel algorithm to compute power at frequency f (Hz)
  private goertzelPower(signal:number[], fs:number, freq:number){
    const N = signal.length;
    const k = 2*Math.PI*freq/fs;
    const coeff = 2*Math.cos(k);
    let s0=0, s1=0, s2=0;
    for (let i=0;i<N;i++){ s0 = signal[i] + coeff*s1 - s2; s2 = s1; s1 = s0; }
    const real = s1 - s2*Math.cos(k);
    const imag = s2*Math.sin(k);
    return real*real + imag*imag;
  }
}
