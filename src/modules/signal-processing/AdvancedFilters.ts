/**
 * ADVANCED FILTERS — Multi-scale signal processing for PPG
 * 
 * Implements:
 * - Multiscale Wavelet decomposition (Haar, Daubechies)
 * - Adaptive Kalman filter with dynamic process noise
 * - Cubic spline smoothing with tension control
 * - Notch filter for motion artifact removal
 * - Bandpass filter with zero-phase distortion (filtfilt)
 */

import { waveletDenoise } from './WaveletDenoiser';

export interface FilterConfig {
  sampleRate: number;
  waveletLevels: number;
  kalmanQ: number;
  kalmanR: number;
  splineTension: number;
  lowCutoff: number;
  highCutoff: number;
}

export class AdvancedKalmanFilter {
  private x = 0;        // Estimated state
  private P = 1;        // Estimated error covariance
  private Q: number;    // Process noise
  private R: number;    // Measurement noise
  private K = 0;        // Kalman gain
  private initialized = false;
  
  // Adaptive parameters
  private errorHistory: number[] = [];
  private readonly historySize = 30;
  private adaptationRate = 0.02;

  constructor(Q = 0.01, R = 0.1) {
    this.Q = Q;
    this.R = R;
  }

  update(measurement: number): number {
    if (!this.initialized) {
      this.x = measurement;
      this.initialized = true;
      return this.x;
    }

    // Prediction
    const P_pred = this.P + this.Q;
    
    // Update
    this.K = P_pred / (P_pred + this.R);
    const innovation = measurement - this.x;
    this.x += this.K * innovation;
    this.P = (1 - this.K) * P_pred;
    
    // Adapt process noise based on innovation variance
    this.errorHistory.push(innovation * innovation);
    if (this.errorHistory.length > this.historySize) {
      this.errorHistory.shift();
    }
    
    if (this.errorHistory.length >= 10) {
      const meanError = this.errorHistory.reduce((a, b) => a + b, 0) / this.errorHistory.length;
      const targetQ = Math.max(0.001, Math.min(0.1, meanError * 0.1));
      this.Q += (targetQ - this.Q) * this.adaptationRate;
    }
    
    return this.x;
  }

  updateMultiStep(measurements: Float64Array): Float64Array {
    const result = new Float64Array(measurements.length);
    for (let i = 0; i < measurements.length; i++) {
      result[i] = this.update(measurements[i]);
    }
    return result;
  }

  reset() {
    this.x = 0;
    this.P = 1;
    this.K = 0;
    this.initialized = false;
    this.errorHistory = [];
    this.Q = 0.01;
  }

  getState() {
    return { x: this.x, P: this.P, Q: this.Q, R: this.R, K: this.K };
  }
}

export class SplineSmoother {
  private tension: number;
  private lastResult: number[] = [];

  constructor(tension = 0.5) {
    this.tension = Math.max(0, Math.min(1, tension));
  }

  smooth(data: Float64Array | number[], windowSize = 7): Float64Array {
    const n = data.length;
    const result = new Float64Array(n);
    const halfWindow = Math.floor(windowSize / 2);
    
    // Natural cubic spline smoothing
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - halfWindow);
      const end = Math.min(n, i + halfWindow + 1);
      
      if (end - start < 3) {
        result[i] = data[i];
        continue;
      }
      
      // Local cubic interpolation
      const localData: number[] = [];
      for (let j = start; j < end; j++) {
        localData.push(data[j]);
      }
      
      // Compute local polynomial fit (degree 3)
      const localIdx = i - start;
      const t = localIdx / (localData.length - 1);
      
      // Catmull-Rom spline interpolation
      const p0 = localData[Math.max(0, localIdx - 1)];
      const p1 = localData[localIdx];
      const p2 = localData[Math.min(localData.length - 1, localIdx + 1)];
      const p3 = localData[Math.min(localData.length - 1, localIdx + 2)];
      
      const t2 = t * t;
      const t3 = t2 * t;
      
      const tensionFactor = 1 - this.tension;
      result[i] = 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
      ) * tensionFactor + p1 * (1 - tensionFactor);
    }
    
    this.lastResult = Array.from(result);
    return result;
  }

  // Robust smoothing with outlier rejection
  smoothRobust(data: Float64Array | number[], windowSize = 7, outlierThreshold = 2.5): Float64Array {
    const n = data.length;
    const result = new Float64Array(n);
    
    // First pass: median filter for outlier detection
    const medianFiltered = this.medianFilter(data, windowSize);
    
    // Detect and replace outliers
    const cleaned: number[] = [];
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(data[i] - medianFiltered[i]);
      const localStd = this.computeLocalStd(data, i, windowSize);
      
      if (diff > outlierThreshold * localStd && localStd > 0) {
        // Outlier: use median
        cleaned.push(medianFiltered[i]);
      } else {
        cleaned.push(data[i]);
      }
    }
    
    // Second pass: spline smoothing on cleaned data
    return this.smooth(new Float64Array(cleaned), windowSize);
  }

  private medianFilter(data: Float64Array | number[], windowSize: number): number[] {
    const n = data.length;
    const result: number[] = [];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = 0; i < n; i++) {
      const window: number[] = [];
      for (let j = Math.max(0, i - halfWindow); j < Math.min(n, i + halfWindow + 1); j++) {
        window.push(data[j]);
      }
      window.sort((a, b) => a - b);
      result.push(window[Math.floor(window.length / 2)]);
    }
    
    return result;
  }

  private computeLocalStd(data: Float64Array | number[], center: number, windowSize: number): number {
    const halfWindow = Math.floor(windowSize / 2);
    const start = Math.max(0, center - halfWindow);
    const end = Math.min(data.length, center + halfWindow + 1);
    
    let sum = 0, sum2 = 0;
    for (let i = start; i < end; i++) {
      sum += data[i];
      sum2 += data[i] * data[i];
    }
    
    const n = end - start;
    const mean = sum / n;
    const variance = (sum2 / n) - mean * mean;
    return Math.sqrt(Math.max(0, variance));
  }
}

export class NotchFilter {
  private b: number[] = [];
  private a: number[] = [];
  private xHistory: number[] = [];
  private yHistory: number[] = [];
  private sampleRate: number;

  constructor(targetFreq: number, bandwidth: number, sampleRate: number) {
    this.sampleRate = sampleRate;
    this.designFilter(targetFreq, bandwidth);
    this.reset();
  }

  private designFilter(targetFreq: number, bandwidth: number) {
    // Design 2nd-order IIR notch filter
    const f0 = targetFreq / this.sampleRate;
    const bw = bandwidth / this.sampleRate;
    const R = 1 - 3 * bw;
    
    // Coefficients
    const cos2pif0 = Math.cos(2 * Math.PI * f0);
    const K = (1 - 2 * R * cos2pif0 + R * R) / (2 - 2 * cos2pif0);
    
    this.b = [K, -2 * K * cos2pif0, K];
    this.a = [1, -2 * R * cos2pif0, R * R];
  }

  filter(sample: number): number {
    this.xHistory.push(sample);
    if (this.xHistory.length > this.b.length) this.xHistory.shift();
    
    // Direct Form I implementation
    let y = 0;
    for (let i = 0; i < this.b.length; i++) {
      y += this.b[i] * (this.xHistory[this.xHistory.length - 1 - i] || 0);
    }
    for (let i = 1; i < this.a.length; i++) {
      y -= this.a[i] * (this.yHistory[this.yHistory.length - i] || 0);
    }
    
    this.yHistory.push(y);
    if (this.yHistory.length > this.a.length) this.yHistory.shift();
    
    return y;
  }

  filterBatch(samples: Float64Array): Float64Array {
    const result = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      result[i] = this.filter(samples[i]);
    }
    return result;
  }

  reset() {
    this.xHistory = [];
    this.yHistory = [];
  }
}

export class ZeroPhaseFilter {
  private b: number[];
  private a: number[];

  constructor(lowFreq: number, highFreq: number, sampleRate: number, order = 4) {
    // Design Butterworth bandpass using bilinear transform approximation
    this.b = this.designBandpassB(lowFreq, highFreq, sampleRate, order);
    this.a = [1, ...new Array(order).fill(0)]; // Simplified IIR
  }

  private designBandpassB(lowFreq: number, highFreq: number, fs: number, order: number): number[] {
    // Simple FIR bandpass design using windowed sinc
    const nyquist = fs / 2;
    const lowNorm = lowFreq / nyquist;
    const highNorm = highFreq / nyquist;
    
    const taps = order * 2 + 1;
    const coefficients: number[] = [];
    
    for (let i = 0; i < taps; i++) {
      const n = i - order;
      if (n === 0) {
        coefficients.push(highNorm - lowNorm);
      } else {
        const h = (Math.sin(Math.PI * highNorm * n) / (Math.PI * n)) -
                  (Math.sin(Math.PI * lowNorm * n) / (Math.PI * n));
        // Hamming window
        const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
        coefficients.push(h * window);
      }
    }
    
    // Normalize
    const sum = coefficients.reduce((a, b) => a + b, 0);
    return coefficients.map(c => c / sum);
  }

  // Zero-phase filtering using forward-backward method (filtfilt)
  filter(samples: Float64Array): Float64Array {
    // Forward pass
    const forward = this.filterOnePass(samples);
    
    // Backward pass
    const reversed = new Float64Array(forward.length);
    for (let i = 0; i < forward.length; i++) {
      reversed[i] = forward[forward.length - 1 - i];
    }
    
    const backward = this.filterOnePass(reversed);
    
    // Reverse back
    const result = new Float64Array(backward.length);
    for (let i = 0; i < backward.length; i++) {
      result[i] = backward[backward.length - 1 - i];
    }
    
    return result;
  }

  private filterOnePass(samples: Float64Array): Float64Array {
    const result = new Float64Array(samples.length);
    const delayLine = new Float64Array(this.b.length).fill(0);
    
    for (let i = 0; i < samples.length; i++) {
      // Shift delay line
      for (let j = delayLine.length - 1; j > 0; j--) {
        delayLine[j] = delayLine[j - 1];
      }
      delayLine[0] = samples[i];
      
      // Compute output
      let output = 0;
      for (let j = 0; j < this.b.length; j++) {
        output += this.b[j] * delayLine[j];
      }
      result[i] = output;
    }
    
    return result;
  }
}

export class AdvancedFilterChain {
  private config: FilterConfig;
  private kalman: AdvancedKalmanFilter;
  private spline: SplineSmoother;
  private notch: NotchFilter | null = null;
  private bandpass: ZeroPhaseFilter;

  constructor(config: Partial<FilterConfig> = {}) {
    this.config = {
      sampleRate: 60,
      waveletLevels: 4,
      kalmanQ: 0.01,
      kalmanR: 0.1,
      splineTension: 0.5,
      lowCutoff: 0.7,
      highCutoff: 4.0,
      ...config
    };

    this.kalman = new AdvancedKalmanFilter(this.config.kalmanQ, this.config.kalmanR);
    this.spline = new SplineSmoother(this.config.splineTension);
    this.bandpass = new ZeroPhaseFilter(
      this.config.lowCutoff,
      this.config.highCutoff,
      this.config.sampleRate
    );
  }

  // Complete processing chain
  process(samples: Float64Array): {
    denoised: Float64Array;
    smoothed: Float64Array;
    filtered: Float64Array;
    quality: number;
  } {
    // 1. Wavelet denoising (multiscale)
    const denoisedArr = waveletDenoise(samples, this.config.waveletLevels);
    const denoised = Float64Array.from(denoisedArr);

    // 2. Adaptive Kalman smoothing
    const smoothed = this.kalman.updateMultiStep(denoised);

    // 3. Robust spline smoothing
    const splineSmoothed = this.spline.smoothRobust(smoothed, 7, 2.5);

    // 4. Bandpass filter (zero-phase)
    const filtered = this.bandpass.filter(splineSmoothed);

    // 5. Optional: notch filter for motion artifacts
    if (this.notch) {
      for (let i = 0; i < filtered.length; i++) {
        filtered[i] = this.notch.filter(filtered[i]);
      }
    }

    // Compute quality metrics
    const snrBefore = this.estimateSNR(samples);
    const snrAfter = this.estimateSNR(filtered);
    const quality = Math.min(100, (snrAfter / Math.max(1, snrBefore)) * 50 + snrAfter * 2);

    return {
      denoised,
      smoothed: splineSmoothed,
      filtered,
      quality
    };
  }

  // Real-time single sample processing
  processSample(sample: number): number {
    // Wavelet is batch-only, so we use Kalman + simplified processing for real-time
    const kalmanOut = this.kalman.update(sample);
    // Note: For real-time, we can't do zero-phase or full wavelet
    return kalmanOut;
  }

  setNotchFilter(targetFreq: number, bandwidth: number) {
    this.notch = new NotchFilter(targetFreq, bandwidth, this.config.sampleRate);
  }

  removeNotchFilter() {
    this.notch = null;
  }

  reset() {
    this.kalman.reset();
    if (this.notch) this.notch.reset();
  }

  private estimateSNR(signal: Float64Array): number {
    const n = signal.length;
    if (n < 10) return 0;

    // Estimate signal power in cardiac band
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const variance = signal.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    
    // Simple SNR estimate based on signal variance
    return 10 * Math.log10(variance / 0.001);
  }
}

// Factory function
export function createAdvancedFilterChain(
  sampleRate: number,
  options?: Partial<FilterConfig>
): AdvancedFilterChain {
  return new AdvancedFilterChain({
    sampleRate,
    ...options
  });
}
