import { findPeaksAndValleys, calculatePulseWaveVelocity, calculateAugmentationIndex } from './utils/ppgAnalysis';
import { KalmanFilter } from '../signal-processing/KalmanFilter';

export class BloodPressureProcessor {
  // Configuration constants
  private readonly BP_BUFFER_SIZE = 10;
  private readonly BP_ALPHA = 0.7;
  private readonly MIN_VALID_PULSE_WIDTH_MS = 200;
  private readonly MAX_VALID_PULSE_WIDTH_MS = 1500;
  private readonly MIN_SIGNAL_QUALITY = 0.6;
  
  // State
  private systolicBuffer: number[] = [];
  private diastolicBuffer: number[] = [];
  private signalQuality: number = 0;
  private kalmanSystolic: KalmanFilter;
  private kalmanDiastolic: KalmanFilter;
  private lastProcessedTime: number = 0;
  
  constructor() {
    // Initialize Kalman filters for systolic and diastolic pressure
    this.kalmanSystolic = new KalmanFilter({
      R: 0.01,  // Measurement noise
      Q: 0.1,   // Process noise
      A: 1,     // State transition
      B: 0,     // Control input
      C: 1      // Measurement
    });
    
    this.kalmanDiastolic = new KalmanFilter({
      R: 0.01,
      Q: 0.1,
      A: 1,
      B: 0,
      C: 1
    });
  }

  /**
   * Calculates blood pressure using advanced PPG signal analysis
   * Implements PTT (Pulse Transit Time) and PWA (Pulse Wave Analysis) methods
   */
  public calculateBloodPressure(ppgSignal: number[], sampleRate: number = 30): {
    systolic: number;
    diastolic: number;
    map: number;      // Mean Arterial Pressure
    confidence: number;
    features: {
      ptt: number;    // Pulse Transit Time
      pwa: number;    // Pulse Wave Area
      ai: number;     // Augmentation Index
      pwv: number;    // Pulse Wave Velocity
    };
  } {
    const now = Date.now();
    
    // Check signal quality and minimum requirements
    if (ppgSignal.length < sampleRate * 2) { // At least 2 seconds of data
      return this.getLastValidReading();
    }
    
    // 1. Signal Preprocessing
    const preprocessedSignal = this.preprocessSignal(ppgSignal, sampleRate);
    
    // 2. Feature Extraction
    const { peakIndices, valleyIndices } = findPeaksAndValleys(preprocessedSignal);
    
    // Check if we have enough valid peaks
    if (peakIndices.length < 2 || valleyIndices.length < 1) {
      return this.getLastValidReading();
    }
    
    // Calculate signal quality metrics
    this.signalQuality = this.calculateSignalQuality(preprocessedSignal, peakIndices, valleyIndices);
    
    // 3. Calculate Pulse Wave Features
    const msPerSample = 1000 / sampleRate;
    const features = this.extractPulseWaveFeatures(preprocessedSignal, peakIndices, valleyIndices, msPerSample);
    
    // 4. Calculate Blood Pressure using PTT and PWA methods
    const { systolic, diastolic, map } = this.estimateBloodPressure(features);
    
    // 5. Apply Kalman filtering for smooth readings
    const filteredSystolic = this.kalmanSystolic.filter(systolic);
    const filteredDiastolic = this.kalmanDiastolic.filter(diastolic);
    
    // 6. Update buffers with filtered values
    this.updateBuffers(filteredSystolic, filteredDiastolic);
    this.lastProcessedTime = now;
    
    return {
      systolic: Math.round(filteredSystolic),
      diastolic: Math.round(filteredDiastolic),
      map: Math.round(map),
      confidence: this.signalQuality,
      features: {
        ptt: features.ptt,
        pwa: features.pwa,
        ai: features.ai,
        pwv: features.pwv
      }
    };
  }
  
  /**
   * Preprocess PPG signal with filtering and normalization
   */
  private preprocessSignal(signal: number[], sampleRate: number): number[] {
    // 1. Remove baseline wander using high-pass filter
    const baselineRemoved = this.removeBaselineWander(signal, sampleRate);
    
    // 2. Apply bandpass filter (0.5-5 Hz for PPG signals)
    const filtered = this.bandpassFilter(baselineRemoved, 0.5, 5, sampleRate);
    
    // 3. Normalize signal to 0-1 range
    return this.normalizeSignal(filtered);
  }
  
  /**
   * Extract key pulse wave features for BP estimation
   */
  private extractPulseWaveFeatures(
    signal: number[],
    peakIndices: number[],
    valleyIndices: number[],
    msPerSample: number
  ) {
    // Calculate Pulse Transit Time (PTT)
    const ptt = this.calculatePulseTransitTime(peakIndices, msPerSample);
    
    // Calculate Pulse Wave Area (PWA)
    const pwa = this.calculatePulseWaveArea(signal, peakIndices, valleyIndices);
    
    // Calculate Augmentation Index (AI)
    const ai = calculateAugmentationIndex(signal, peakIndices, valleyIndices);
    
    // Calculate Pulse Wave Velocity (PWV) - Simplified estimation
    const pwv = calculatePulseWaveVelocity(ptt);
    
    return { ptt, pwa, ai, pwv };
  }
  
  /**
   * Estimate blood pressure using multiple features
   */
  private estimateBloodPressure(features: {
    ptt: number;
    pwa: number;
    ai: number;
    pwv: number;
  }): { systolic: number; diastolic: number; map: number } {
    // Base values (can be calibrated per user)
    const baseSystolic = 120;
    const baseDiastolic = 80;
    
    // Calculate adjustments based on features
    const pttAdjustment = (600 - Math.min(600, features.ptt)) * 0.15; // ms to mmHg
    const pwaAdjustment = (features.pwa - 0.5) * 20; // Normalized PWA to mmHg
    const aiAdjustment = features.ai * 15; // AI to mmHg
    
    // Calculate final values with bounds checking
    const systolic = Math.max(70, Math.min(200, baseSystolic + pttAdjustment + aiAdjustment * 0.7));
    const diastolic = Math.max(40, Math.min(120, baseDiastolic + pwaAdjustment * 0.5 + aiAdjustment * 0.3));
    const map = diastolic + (systolic - diastolic) / 3; // Mean Arterial Pressure
    
    return { systolic, diastolic, map };
  }
  
  /**
   * Calculate Pulse Transit Time (PTT) from peak indices
   */
  private calculatePulseTransitTime(peakIndices: number[], msPerSample: number): number {
    if (peakIndices.length < 2) return 0;
    
    const intervals: number[] = [];
    
    // Calculate inter-peak intervals
    for (let i = 1; i < peakIndices.length; i++) {
      const interval = (peakIndices[i] - peakIndices[i - 1]) * msPerSample;
      
      // Only include physiologically valid intervals (200-1500ms)
      if (interval >= this.MIN_VALID_PULSE_WIDTH_MS && 
          interval <= this.MAX_VALID_PULSE_WIDTH_MS) {
        intervals.push(interval);
      }
    }
    
    if (intervals.length === 0) return 0;
    
    // Use median for robustness against outliers
    intervals.sort((a, b) => a - b);
    return intervals[Math.floor(intervals.length / 2)];
  }
  
  /**
   * Calculate Pulse Wave Area (PWA) for each pulse
   */
  private calculatePulseWaveArea(signal: number[], peakIndices: number[], valleyIndices: number[]): number {
    if (peakIndices.length < 2 || valleyIndices.length < 1) return 0;
    
    let totalArea = 0;
    let validPulses = 0;
    
    // Calculate area under the curve for each pulse
    for (let i = 0; i < peakIndices.length - 1; i++) {
      const startIdx = peakIndices[i];
      const endIdx = peakIndices[i + 1];
      
      // Find the lowest point (valley) between these peaks
      const valleyIdx = valleyIndices.find(v => v > startIdx && v < endIdx);
      if (!valleyIdx) continue;
      
      // Calculate area using trapezoidal rule
      let area = 0;
      for (let j = startIdx; j < endIdx; j++) {
        area += (signal[j] + signal[j + 1]) / 2;
      }
      
      // Normalize by pulse width
      const pulseWidth = endIdx - startIdx;
      if (pulseWidth > 0) {
        totalArea += area / pulseWidth;
        validPulses++;
      }
    }
    
    return validPulses > 0 ? totalArea / validPulses : 0;
  }
  
  /**
   * Calculate signal quality metrics (0-1)
   */
  private calculateSignalQuality(
    signal: number[],
    peakIndices: number[],
    valleyIndices: number[]
  ): number {
    if (peakIndices.length < 2) return 0;
    
    // 1. Peak-to-peak interval consistency (0-0.4)
    const intervals: number[] = [];
    for (let i = 1; i < peakIndices.length; i++) {
      intervals.push(peakIndices[i] - peakIndices[i - 1]);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const intervalVariance = intervals.reduce(
      (sum, val) => sum + Math.pow(val - avgInterval, 2), 0
    ) / intervals.length;
    const intervalScore = Math.exp(-intervalVariance / 100);
    
    // 2. Peak amplitude consistency (0-0.3)
    const amplitudes = peakIndices.map(idx => signal[idx]);
    const avgAmplitude = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
    const amplitudeVariance = amplitudes.reduce(
      (sum, val) => sum + Math.pow(val - avgAmplitude, 2), 0
    ) / amplitudes.length;
    const amplitudeScore = 0.3 * (1 - Math.min(1, amplitudeVariance / 0.1));
    
    // 3. Signal-to-noise ratio (0-0.3)
    const noiseLevel = this.estimateNoiseLevel(signal, peakIndices);
    const snrScore = 0.3 * Math.min(1, avgAmplitude / (noiseLevel || 0.001));
    
    return Math.min(1, intervalScore + amplitudeScore + snrScore);
  }
  
  /**
   * Update systolic and diastolic buffers with new readings
   */
  private updateBuffers(systolic: number, diastolic: number): void {
    // Add new values to buffers
    this.systolicBuffer.push(systolic);
    this.diastolicBuffer.push(diastolic);
    
    // Maintain buffer size
    if (this.systolicBuffer.length > this.BP_BUFFER_SIZE) {
      this.systolicBuffer.shift();
      this.diastolicBuffer.shift();
    }
  }
  
  /**
   * Get the last valid reading or fallback values
   */
  private getLastValidReading() {
    const hasValidReadings = this.systolicBuffer.length > 0 && this.diastolicBuffer.length > 0;
    const avgSystolic = hasValidReadings ? 
      this.systolicBuffer.reduce((a, b) => a + b, 0) / this.systolicBuffer.length : 0;
    const avgDiastolic = hasValidReadings ? 
      this.diastolicBuffer.reduce((a, b) => a + b, 0) / this.diastolicBuffer.length : 0;
    
    return {
      systolic: Math.round(avgSystolic),
      diastolic: Math.round(avgDiastolic),
      map: Math.round(avgDiastolic + (avgSystolic - avgDiastolic) / 3),
      confidence: Math.max(0, this.signalQuality - 0.2), // Reduce confidence for cached values
      features: {
        ptt: 0,
        pwa: 0,
        ai: 0,
        pwv: 0
      }
    };
  }
    const amplitude = calculateAmplitude(values, peakIndices, valleyIndices);
    const normalizedAmplitude = Math.min(100, Math.max(0, amplitude * 6.5));

    // Optimización adicional: ajustar los multiplicadores para mayor precisión
    const pttFactor = (600 - normalizedPTT) * 0.11; // Incrementado de 0.10 a 0.11
    const ampFactor = normalizedAmplitude * 0.38;   // Incrementado de 0.37 a 0.38
    
    let instantSystolic = 120 + pttFactor + ampFactor;
    let instantDiastolic = 80 + (pttFactor * 0.68) + (ampFactor * 0.30); // Ajustando de (0.65 y 0.28)

    // Enhanced physiological range enforcement
    instantSystolic = Math.max(90, Math.min(180, instantSystolic));
    instantDiastolic = Math.max(60, Math.min(110, instantDiastolic));
    
    // Maintain realistic pressure differential with improved bounds
    const differential = instantSystolic - instantDiastolic;
    if (differential < 25) {
      instantDiastolic = instantSystolic - 25;
    } else if (differential > 75) {
      instantDiastolic = instantSystolic - 75;
    }

    // Update pressure buffers with new values
    this.systolicBuffer.push(instantSystolic);
    this.diastolicBuffer.push(instantDiastolic);
    
    if (this.systolicBuffer.length > this.BP_BUFFER_SIZE) {
      this.systolicBuffer.shift();
      this.diastolicBuffer.shift();
    }

    // Calculate final smoothed values with enhanced exponential moving average
    let finalSystolic = 0;
    let finalDiastolic = 0;
    let smoothingWeightSum = 0;

    for (let i = 0; i < this.systolicBuffer.length; i++) {
      const weight = Math.pow(this.BP_ALPHA, this.systolicBuffer.length - 1 - i);
      finalSystolic += this.systolicBuffer[i] * weight;
      finalDiastolic += this.diastolicBuffer[i] * weight;
      smoothingWeightSum += weight;
    }

    finalSystolic = smoothingWeightSum > 0 ? finalSystolic / smoothingWeightSum : instantSystolic;
    finalDiastolic = smoothingWeightSum > 0 ? finalDiastolic / smoothingWeightSum : instantDiastolic;

    return {
      systolic: Math.round(finalSystolic),
      diastolic: Math.round(finalDiastolic)
    };
  }

  /**
   * Reset the blood pressure processor state
   */
  public reset(): void {
    this.systolicBuffer = [];
    this.diastolicBuffer = [];
    this.signalQuality = 0;
    this.lastProcessedTime = 0;
    
    // Reset Kalman filters
    this.kalmanSystolic = new KalmanFilter({
      R: 0.01,
      Q: 0.1,
      A: 1,
      B: 0,
      C: 1
    });
    
    this.kalmanDiastolic = new KalmanFilter({
      R: 0.01,
      Q: 0.1,
      A: 1,
      B: 0,
      C: 1
    });
  }
  
  /**
   * Get the current signal quality (0-1)
   */
  public getSignalQuality(): number {
    return this.signalQuality;
  }
  
  /**
   * Check if the processor has enough data for reliable readings
   */
  public isReady(): boolean {
    return this.systolicBuffer.length >= this.BP_BUFFER_SIZE / 2 && 
           this.signalQuality >= this.MIN_SIGNAL_QUALITY;
  }
}
