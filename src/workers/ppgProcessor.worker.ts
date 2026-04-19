/**
 * PPG SIGNAL PROCESSOR WORKER
 * Offloads heavy signal processing from main thread
 * Handles: FFT, advanced filtering, peak detection, quality metrics
 */

import { waveletDenoise } from '../modules/signal-processing/WaveletDenoiser';
import { Kalman1D } from '../modules/signal-processing/Kalman1D';

// Simple FFT implementation for worker
class FFT {
  private size: number;
  private cosTable: Float64Array;
  private sinTable: Float64Array;
  private reverseTable: Uint32Array;

  constructor(size: number) {
    this.size = size;
    this.cosTable = new Float64Array(size);
    this.sinTable = new Float64Array(size);
    this.reverseTable = new Uint32Array(size);
    
    // Precompute tables
    for (let i = 0; i < size; i++) {
      this.cosTable[i] = Math.cos(-Math.PI * 2 * i / size);
      this.sinTable[i] = Math.sin(-Math.PI * 2 * i / size);
    }
    
    // Bit reversal
    let limit = 1;
    let bit = size >> 1;
    while (limit < bit) {
      for (let i = 0; i < limit; i++) {
        this.reverseTable[i + limit] = this.reverseTable[i] + bit;
      }
      limit <<= 1;
      bit >>= 1;
    }
  }

  forward(input: Float64Array): Float64Array {
    const n = this.size;
    const output = new Float64Array(n * 2);
    
    // Bit reversal
    for (let i = 0; i < n; i++) {
      const j = this.reverseTable[i];
      output[j * 2] = input[i];
      output[j * 2 + 1] = 0;
    }
    
    // Cooley-Tukey
    for (let size = 2; size <= n; size <<= 1) {
      const halfsize = size >> 1;
      const tablestep = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
          const tpre = output[j + halfsize * 2] * this.cosTable[k] + 
                       output[j + halfsize * 2 + 1] * this.sinTable[k];
          const tpim = output[j + halfsize * 2 + 1] * this.cosTable[k] - 
                       output[j + halfsize * 2] * this.sinTable[k];
          output[j + halfsize * 2] = output[j * 2] - tpre;
          output[j + halfsize * 2 + 1] = output[j * 2 + 1] - tpim;
          output[j * 2] += tpre;
          output[j * 2 + 1] += tpim;
        }
      }
    }
    
    return output;
  }
}

// Worker state
const state = {
  sampleRate: 60,
  bufferSize: 1024,
  fft: null as FFT | null,
  kalman: null as Kalman1D | null,
  signalBuffer: new Float64Array(1024),
  bufferIndex: 0,
  initialized: false,
};

// Message handler
self.onmessage = (e: MessageEvent) => {
  const { type, data, id } = e.data;
  
  switch (type) {
    case 'INIT':
      initialize(data);
      break;
      
    case 'PROCESS_FRAME':
      processFrame(data, id);
      break;
      
    case 'PROCESS_BATCH':
      processBatch(data, id);
      break;
      
    case 'FFT_ANALYSIS':
      performFFT(data, id);
      break;
      
    case 'WAVELET_DENOISE':
      waveletDenoiseWorker(data, id);
      break;
      
    case 'PEAK_DETECT':
      detectPeaks(data, id);
      break;
      
    case 'QUALITY_METRICS':
      computeQualityMetrics(data, id);
      break;
      
    case 'RESET':
      reset();
      break;
  }
};

function initialize(config: { sampleRate: number; bufferSize: number }) {
  state.sampleRate = config.sampleRate;
  state.bufferSize = config.bufferSize || 1024;
  state.signalBuffer = new Float64Array(state.bufferSize);
  state.bufferIndex = 0;
  
  // Initialize processing modules
  state.fft = new FFT(state.bufferSize);
  state.kalman = new Kalman1D(0.1, 4.0);
  
  state.initialized = true;
  
  self.postMessage({
    type: 'INIT_COMPLETE',
    data: { sampleRate: state.sampleRate, bufferSize: state.bufferSize }
  });
}

function processFrame(data: { 
  timestamp: number; 
  red: number; 
  green: number; 
  blue: number;
  quality: number;
}, id: string) {
  if (!state.initialized) {
    self.postMessage({ type: 'ERROR', id, error: 'Worker not initialized' });
    return;
  }
  
  // Add to circular buffer
  state.signalBuffer[state.bufferIndex] = data.green;
  state.bufferIndex = (state.bufferIndex + 1) % state.bufferSize;
  
  // Quick spectral estimate using Goertzel (lightweight)
  const cardiacPower = estimateCardiacPower();
  
  self.postMessage({
    type: 'FRAME_PROCESSED',
    id,
    data: {
      timestamp: data.timestamp,
      cardiacPower,
      bufferFill: state.bufferIndex / state.bufferSize,
    }
  });
}

function processBatch(data: { 
  samples: Float64Array;
  timestamps: Float64Array;
}, id: string) {
  if (!state.initialized || !state.kalman) {
    self.postMessage({ type: 'ERROR', id, error: 'Worker not initialized' });
    return;
  }
  
  const samples = data.samples;
  const n = samples.length;
  
  // 1. Wavelet denoising (multiscale decomposition)
  const denoisedArr = waveletDenoise(samples, 4);
  const denoised = Float64Array.from(denoisedArr);
  
  // 2. Kalman smoothing
  const smoothed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    smoothed[i] = state.kalman!.update(denoised[i]);
  }
  
  // 3. Bandpass filter (0.7-4 Hz cardiac band)
  const filtered = bandpassFilter(smoothed, 0.7, 4.0, state.sampleRate);
  
  // 4. Quality metrics
  const snr = computeSNR(filtered);
  const perfusion = computePerfusionIndex(filtered);
  
  self.postMessage({
    type: 'BATCH_PROCESSED',
    id,
    data: {
      denoised,
      smoothed,
      filtered,
      snr,
      perfusion,
      quality: Math.min(100, snr * 10 + perfusion * 50),
    }
  });
}

function performFFT(data: { samples: Float64Array }, id: string) {
  if (!state.initialized || !state.fft) {
    self.postMessage({ type: 'ERROR', id, error: 'FFT not initialized' });
    return;
  }
  
  const input = data.samples;
  const n = input.length;
  
  // Zero-pad or truncate to power of 2
  const fftSize = nextPowerOf2(n);
  const padded = new Float64Array(fftSize);
  padded.set(input.slice(0, Math.min(n, fftSize)));
  
  // Apply window
  const windowed = applyHannWindow(padded);
  
  // Perform FFT
  const spectrum = state.fft.forward(windowed);
  
  // Compute magnitude and find dominant frequencies
  const magnitudes = new Float64Array(fftSize / 2);
  const frequencies = new Float64Array(fftSize / 2);
  
  for (let i = 0; i < fftSize / 2; i++) {
    const real = spectrum[i * 2];
    const imag = spectrum[i * 2 + 1];
    magnitudes[i] = Math.sqrt(real * real + imag * imag);
    frequencies[i] = (i * state.sampleRate) / fftSize;
  }
  
  // Find cardiac peak (0.7-4 Hz = 42-240 BPM)
  let cardiacPeak = { freq: 0, mag: 0 };
  const minIdx = Math.floor(0.7 * fftSize / state.sampleRate);
  const maxIdx = Math.ceil(4.0 * fftSize / state.sampleRate);
  
  for (let i = minIdx; i <= maxIdx && i < magnitudes.length; i++) {
    if (magnitudes[i] > cardiacPeak.mag) {
      cardiacPeak = { freq: frequencies[i], mag: magnitudes[i] };
    }
  }
  
  // Harmonic analysis
  const harmonics = findHarmonics(magnitudes, frequencies, cardiacPeak.freq);
  
  self.postMessage({
    type: 'FFT_COMPLETE',
    id,
    data: {
      frequencies: Array.from(frequencies),
      magnitudes: Array.from(magnitudes),
      cardiacPeak,
      bpm: cardiacPeak.freq * 60,
      harmonics,
      spectralEntropy: computeSpectralEntropy(magnitudes),
    }
  });
}

function waveletDenoiseWorker(data: { samples: Float64Array; threshold?: number; levels?: number }, id: string) {
  const denoised = waveletDenoise(data.samples, data.levels || 4);
  const result = Float64Array.from(denoised);
  
  (self as any).postMessage({
    type: 'WAVELET_COMPLETE',
    id,
    data: { denoised: result }
  }, { transfer: [result.buffer] });
}

function detectPeaks(data: { 
  samples: Float64Array; 
  minDistance: number;
  threshold: number;
}, id: string) {
  const samples = data.samples;
  const minSamples = Math.floor(data.minDistance * state.sampleRate / 1000);
  const threshold = data.threshold;
  
  const peaks: Array<{ index: number; value: number; prominence: number }> = [];
  let lastPeakIdx = -minSamples;
  
  for (let i = 2; i < samples.length - 2; i++) {
    // Check local maximum
    if (samples[i] > samples[i-1] && samples[i] > samples[i-2] &&
        samples[i] > samples[i+1] && samples[i] > samples[i+2]) {
      
      // Check threshold
      if (samples[i] > threshold && i - lastPeakIdx >= minSamples) {
        // Compute prominence
        const leftMin = Math.min(...samples.slice(Math.max(0, i - minSamples), i));
        const rightMin = Math.min(...samples.slice(i + 1, Math.min(samples.length, i + minSamples + 1)));
        const prominence = samples[i] - Math.max(leftMin, rightMin);
        
        peaks.push({ index: i, value: samples[i], prominence });
        lastPeakIdx = i;
      }
    }
  }
  
  // Compute RR intervals and HRV metrics
  const rrIntervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    rrIntervals.push((peaks[i].index - peaks[i-1].index) * 1000 / state.sampleRate);
  }
  
  const hrv = computeHRV(rrIntervals);
  
  self.postMessage({
    type: 'PEAKS_DETECTED',
    id,
    data: {
      peaks,
      rrIntervals,
      count: peaks.length,
      hrv,
    }
  });
}

function computeQualityMetrics(data: { samples: Float64Array; }, id: string) {
  const samples = data.samples;
  const n = samples.length;
  
  // Signal quality metrics
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  
  // Skewness and kurtosis
  let skewness = 0, kurtosis = 0;
  for (let i = 0; i < n; i++) {
    const diff = samples[i] - mean;
    skewness += diff ** 3;
    kurtosis += diff ** 4;
  }
  skewness = skewness / (n * std ** 3);
  kurtosis = kurtosis / (n * std ** 4) - 3;
  
  // Signal-to-noise estimate using autocorrelation
  const snr = computeSNR(samples);
  
  // Perfusion index approximation
  const ac = std * Math.sqrt(2);
  const dc = mean;
  const perfusion = (ac / dc) * 100;
  
  // Template correlation (periodicity)
  const periodicity = computePeriodicity(samples);
  
  // Overall SQI (0-100)
  const sqi = Math.min(100, 
    snr * 15 + 
    Math.min(40, perfusion * 2) + 
    periodicity * 30 +
    Math.max(0, 10 - Math.abs(skewness) * 5)
  );
  
  self.postMessage({
    type: 'QUALITY_METRICS',
    id,
    data: {
      sqi,
      snr,
      perfusion,
      periodicity,
      skewness,
      kurtosis,
      mean,
      std,
      dynamicRange: Math.max(...samples) - Math.min(...samples),
    }
  });
}

// Helper functions
function estimateCardiacPower(): number {
  // Lightweight Goertzel-based estimate
  const targetFreq = 1.5; // ~90 BPM
  const coeff = 2 * Math.cos(2 * Math.PI * targetFreq / state.sampleRate);
  let s0 = 0, s1 = 0, s2 = 0;
  
  for (let i = 0; i < state.signalBuffer.length; i++) {
    const idx = (state.bufferIndex - 1 - i + state.signalBuffer.length) % state.signalBuffer.length;
    s0 = state.signalBuffer[idx] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  
  const power = s2 * s2 + s1 * s1 - coeff * s1 * s2;
  return Math.sqrt(power) / state.signalBuffer.length;
}

function bandpassFilter(signal: Float64Array, lowFreq: number, highFreq: number, fs: number): Float64Array {
  // Butterworth bandpass approximation (biquad cascade)
  const result = new Float64Array(signal);
  const n = signal.length;
  
  // Simple IIR bandpass (cascade of highpass and lowpass)
  // Highpass (remove DC and slow drift)
  const rc = 1 / (2 * Math.PI * lowFreq);
  const dt = 1 / fs;
  const alpha = rc / (rc + dt);
  
  let prev = signal[0];
  for (let i = 1; i < n; i++) {
    result[i] = alpha * (result[i-1] + signal[i] - prev);
    prev = signal[i];
  }
  
  // Lowpass (smooth high frequency noise)
  const rc2 = 1 / (2 * Math.PI * highFreq);
  const alpha2 = dt / (rc2 + dt);
  
  for (let i = 1; i < n; i++) {
    result[i] = alpha2 * signal[i] + (1 - alpha2) * result[i-1];
  }
  
  return result;
}

function computeSNR(signal: Float64Array): number {
  const n = signal.length;
  
  // Estimate signal power (cardiac band)
  const filtered = bandpassFilter(signal, 0.7, 4.0, state.sampleRate);
  const signalPower = filtered.reduce((a, b) => a + b * b, 0) / n;
  
  // Estimate noise power (outside cardiac band)
  const noiseLow = bandpassFilter(signal, 0.1, 0.5, state.sampleRate);
  const noiseHigh = bandpassFilter(signal, 5.0, 20.0, state.sampleRate);
  const noisePower = (noiseLow.reduce((a, b) => a + b * b, 0) + 
                     noiseHigh.reduce((a, b) => a + b * b, 0)) / (2 * n);
  
  return noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : 40;
}

function computePerfusionIndex(signal: Float64Array): number {
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / signal.length;
  const ac = Math.sqrt(variance) * Math.sqrt(2);
  return mean > 0 ? (ac / mean) * 100 : 0;
}

function computeHRV(rrIntervals: number[]): {
  sdnn: number;
  rmssd: number;
  pnn50: number;
  meanHR: number;
} {
  if (rrIntervals.length < 2) {
    return { sdnn: 0, rmssd: 0, pnn50: 0, meanHR: 0 };
  }
  
  const mean = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
  
  // SDNN (standard deviation of NN intervals)
  const variance = rrIntervals.reduce((a, b) => a + (b - mean) ** 2, 0) / rrIntervals.length;
  const sdnn = Math.sqrt(variance);
  
  // RMSSD (root mean square of successive differences)
  let sumSquaredDiff = 0;
  let nn50 = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    const diff = rrIntervals[i] - rrIntervals[i-1];
    sumSquaredDiff += diff * diff;
    if (Math.abs(diff) > 50) nn50++;
  }
  const rmssd = Math.sqrt(sumSquaredDiff / (rrIntervals.length - 1));
  const pnn50 = (nn50 / (rrIntervals.length - 1)) * 100;
  
  const meanHR = 60000 / mean;
  
  return { sdnn, rmssd, pnn50, meanHR };
}

function computePeriodicity(signal: Float64Array): number {
  if (signal.length < 120) return 0;
  
  // Autocorrelation at expected cardiac lags
  const n = Math.min(240, signal.length);
  const minLag = Math.floor(state.sampleRate * 0.4); // 150ms (400 BPM max)
  const maxLag = Math.floor(state.sampleRate * 1.5); // 1500ms (40 BPM min)
  
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += signal[i] * signal[i + lag];
      count++;
    }
    const corr = sum / count;
    if (corr > bestCorr) bestCorr = corr;
  }
  
  return Math.max(0, Math.min(1, bestCorr));
}

function computeSpectralEntropy(magnitudes: Float64Array): number {
  const total = magnitudes.reduce((a, b) => a + b, 0);
  if (total === 0) return 1;
  
  let entropy = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const p = magnitudes[i] / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  
  const maxEntropy = Math.log2(magnitudes.length);
  return entropy / maxEntropy;
}

function findHarmonics(magnitudes: Float64Array, frequencies: Float64Array, fundamental: number): number[] {
  const harmonics: number[] = [];
  for (let h = 2; h <= 4; h++) {
    const targetFreq = fundamental * h;
    const idx = frequencies.findIndex(f => Math.abs(f - targetFreq) < 0.1);
    if (idx >= 0 && idx < magnitudes.length) {
      harmonics.push(magnitudes[idx]);
    }
  }
  return harmonics;
}

function applyHannWindow(signal: Float64Array): Float64Array {
  const n = signal.length;
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    result[i] = signal[i] * window;
  }
  return result;
}

function nextPowerOf2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

function reset() {
  state.bufferIndex = 0;
  state.signalBuffer.fill(0);
  if (state.kalman) state.kalman.reset();
  state.initialized = false;
  
  self.postMessage({ type: 'RESET_COMPLETE' });
}
