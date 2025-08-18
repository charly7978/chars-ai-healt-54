/**
 * @file BiophysicalValidator.ts
 * @description Valida si una señal PPG se adhiere a características fisiológicas conocidas.
 * Comprueba la pulsatilidad, los rangos de color y la plausibilidad general de la señal.
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS.
 */

export interface ColorRatios {
  red: number;
  green: number;
  blue: number;
}

export interface PeakDetectionResult {
  peaks: number[];
  valleys: number[];
  confidence: number;
  isPhysiological: boolean;
}

/**
 * Validador Biofísico.
 * Evalúa la calidad de la señal PPG basándose en criterios fisiológicos avanzados.
 */
export class BiophysicalValidator {
  // Enhanced thresholds for better pulse detection
  private readonly MIN_PULSATILITY_THRESHOLD = 0.15; // Increased threshold for better specificity
  private readonly PULSATILITY_NORMALIZATION_FACTOR = 20.0;
  private readonly MIN_PEAK_HEIGHT = 0.1; // Minimum peak height relative to signal range
  private readonly MIN_PEAK_DISTANCE = 10; // Minimum samples between peaks (reduces noise)
  
  // Physiological frequency ranges (in Hz, assuming 30fps sampling)
  private readonly HEART_RATE_MIN = 0.7;  // 42 BPM
  private readonly HEART_RATE_MAX = 3.3;  // 200 BPM
  
  // Enhanced physiological ranges with stricter validation
  private readonly PHYSIOLOGICAL_RANGES = {
    redToGreen: { min: 1.2, max: 3.0 },    // Tighter range
    redToBlue: { min: 1.1, max: 3.5 },     // Tighter range
    redValue: { min: 30, max: 220 },       // Optimized range
    greenValue: { min: 15, max: 180 },     // Added green validation
    blueValue: { min: 10, max: 150 },      // Added blue validation
  };

  // Signal quality metrics
  private signalHistory: number[] = [];
  private peakHistory: number[] = [];
  private readonly HISTORY_SIZE = 30;

  /**
   * Enhanced pulsatility score with peak detection
   */
  public getPulsatilityScore(signalChunk: number[]): number {
    if (signalChunk.length < 10) {
      return 0;
    }

    // Basic amplitude calculation
    const max = Math.max(...signalChunk);
    const min = Math.min(...signalChunk);
    const amplitude = max - min;
    
    // Peak detection for enhanced validation
    const peaks = this.detectPeaks(signalChunk);
    const valleys = this.detectValleys(signalChunk);
    
    // Calculate peak-to-valley ratios
    let peakValleyScore = 0;
    if (peaks.length > 0 && valleys.length > 0) {
      const avgPeakHeight = peaks.reduce((sum, peak) => sum + signalChunk[peak], 0) / peaks.length;
      const avgValleyDepth = valleys.reduce((sum, valley) => sum + signalChunk[valley], 0) / valleys.length;
      const peakValleyRatio = (avgPeakHeight - avgValleyDepth) / (amplitude || 1);
      peakValleyScore = Math.min(1, peakValleyRatio);
    }

    // Frequency domain analysis for physiological validation
    const frequencyScore = this.validateFrequencyDomain(signalChunk);
    
    // Combine scores with weights
    const amplitudeScore = Math.min(1.0, amplitude / this.PULSATILITY_NORMALIZATION_FACTOR);
    const finalScore = (amplitudeScore * 0.4) + (peakValleyScore * 0.4) + (frequencyScore * 0.2);

    return finalScore;
  }

  /**
   * Advanced peak detection algorithm
   */
  private detectPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    const windowSize = 5; // Local window for peak detection
    
    for (let i = windowSize; i < signal.length - windowSize; i++) {
      const currentValue = signal[i];
      const localMax = Math.max(...signal.slice(i - windowSize, i + windowSize + 1));
      
      if (currentValue === localMax && currentValue > this.calculateLocalThreshold(signal, i)) {
        peaks.push(i);
      }
    }
    
    return this.filterPeaksByDistance(peaks, this.MIN_PEAK_DISTANCE);
  }

  /**
   * Advanced valley detection algorithm
   */
  private detectValleys(signal: number[]): number[] {
    const valleys: number[] = [];
    const windowSize = 5;
    
    for (let i = windowSize; i < signal.length - windowSize; i++) {
      const currentValue = signal[i];
      const localMin = Math.min(...signal.slice(i - windowSize, i + windowSize + 1));
      
      if (currentValue === localMin && currentValue < this.calculateLocalThreshold(signal, i, false)) {
        valleys.push(i);
      }
    }
    
    return this.filterPeaksByDistance(valleys, this.MIN_PEAK_DISTANCE);
  }

  /**
   * Calculate local adaptive threshold
   */
  private calculateLocalThreshold(signal: number[], index: number, isPeak: boolean = true): number {
    const windowSize = 10;
    const start = Math.max(0, index - windowSize);
    const end = Math.min(signal.length, index + windowSize);
    const localSignal = signal.slice(start, end);
    
    const mean = localSignal.reduce((sum, val) => sum + val, 0) / localSignal.length;
    const std = Math.sqrt(localSignal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / localSignal.length);
    
    return isPeak ? mean + std * 0.5 : mean - std * 0.5;
  }

  /**
   * Filter peaks by minimum distance to reduce noise
   */
  private filterPeaksByDistance(peaks: number[], minDistance: number): number[] {
    if (peaks.length <= 1) return peaks;
    
    const filtered: number[] = [peaks[0]];
    for (let i = 1; i < peaks.length; i++) {
      if (peaks[i] - filtered[filtered.length - 1] >= minDistance) {
        filtered.push(peaks[i]);
      }
    }
    
    return filtered;
  }

  /**
   * Frequency domain validation for physiological signals
   */
  private validateFrequencyDomain(signal: number[]): number {
    if (signal.length < 20) return 0;
    
    // Simple frequency analysis using zero-crossing rate
    const zeroCrossings = this.countZeroCrossings(signal);
    const samplingRate = 30; // Assuming 30 FPS
    const dominantFrequency = (zeroCrossings / 2) * (samplingRate / signal.length);
    
    // Check if frequency is within physiological heart rate range
    if (dominantFrequency >= this.HEART_RATE_MIN && dominantFrequency <= this.HEART_RATE_MAX) {
      return 1.0;
    }
    
    // Partial score for near-physiological frequencies
    const minFreq = this.HEART_RATE_MIN * 0.8;
    const maxFreq = this.HEART_RATE_MAX * 1.2;
    if (dominantFrequency >= minFreq && dominantFrequency <= maxFreq) {
      return 0.5;
    }
    
    return 0;
  }

  /**
   * Count zero crossings for frequency analysis
   */
  private countZeroCrossings(signal: number[]): number {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    let crossings = 0;
    
    for (let i = 1; i < signal.length; i++) {
      if ((signal[i-1] - mean) * (signal[i] - mean) < 0) {
        crossings++;
      }
    }
    
    return crossings;
  }

  /**
   * Enhanced pulsatility validation with physiological constraints
   */
  public isPulsatile(signalChunk: number[]): boolean {
    const score = this.getPulsatilityScore(signalChunk);
    
    // Additional validation: check for consistent periodicity
    const peaks = this.detectPeaks(signalChunk);
    if (peaks.length < 2) return false;
    
    // Check peak intervals for physiological consistency
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i-1]);
    }
    
    const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const intervalVariance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
    
    // Require reasonable consistency in peak intervals
    const coefficientOfVariation = Math.sqrt(intervalVariance) / avgInterval;
    const isConsistent = coefficientOfVariation < 0.3; // 30% max variation
    
    return score > this.MIN_PULSATILITY_THRESHOLD && isConsistent;
  }

  /**
   * Enhanced biophysical scoring with multi-channel validation
   */
  public getBiophysicalScore(ratios: ColorRatios): number {
    let score = 0;
    let totalWeight = 5; // Increased weight count

    const rgRatio = ratios.green > 0 ? ratios.red / ratios.green : 0;
    const rbRatio = ratios.blue > 0 ? ratios.red / ratios.blue : 0;

    // Red channel validation
    let redScore = 0;
    if (ratios.red >= this.PHYSIOLOGICAL_RANGES.redValue.min && ratios.red <= this.PHYSIOLOGICAL_RANGES.redValue.max) {
      redScore = 1;
    }

    // Green channel validation (new)
    let greenScore = 0;
    if (ratios.green >= this.PHYSIOLOGICAL_RANGES.greenValue.min && ratios.green <= this.PHYSIOLOGICAL_RANGES.greenValue.max) {
      greenScore = 1;
    }

    // Blue channel validation (new)
    let blueScore = 0;
    if (ratios.blue >= this.PHYSIOLOGICAL_RANGES.blueValue.min && ratios.blue <= this.PHYSIOLOGICAL_RANGES.blueValue.max) {
      blueScore = 1;
    }

    // Red/Green ratio validation
    let rgScore = 0;
    if (rgRatio >= this.PHYSIOLOGICAL_RANGES.redToGreen.min && rgRatio <= this.PHYSIOLOGICAL_RANGES.redToGreen.max) {
      rgScore = 1;
    }
    
    // Red/Blue ratio validation
    let rbScore = 0;
    if (rbRatio >= this.PHYSIOLOGICAL_RANGES.redToBlue.min && rbRatio <= this.PHYSIOLOGICAL_RANGES.redToBlue.max) {
      rbScore = 1;
    }

    score = redScore + greenScore + blueScore + rgScore + rbScore;

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Performs comprehensive signal validation
   */
  public validateSignal(signalChunk: number[], colorRatios: ColorRatios): PeakDetectionResult {
    const peaks = this.detectPeaks(signalChunk);
    const valleys = this.detectValleys(signalChunk);
    
    // Calculate confidence score
    const pulsatilityScore = this.getPulsatilityScore(signalChunk);
    const biophysicalScore = this.getBiophysicalScore(colorRatios);
    const consistencyScore = this.validatePeakConsistency(peaks, valleys);
    
    // Combined confidence score
    const confidence = (pulsatilityScore * 0.5) + (biophysicalScore * 0.3) + (consistencyScore * 0.2);
    
    // Determine if signal is physiological
    const isPhysiological = 
      this.isPulsatile(signalChunk) && 
      biophysicalScore > 0.6 && 
      consistencyScore > 0.5 &&
      peaks.length >= 2; // Minimum 2 peaks for cardiac signal

    return {
      peaks,
      valleys,
      confidence,
      isPhysiological
    };
  }

  /**
   * Validates peak and valley consistency
   */
  private validatePeakConsistency(peaks: number[], valleys: number[]): number {
    if (peaks.length < 2 || valleys.length < 2) return 0;
    
    // Check alternating pattern (peak-valley-peak-valley)
    let alternatingCount = 0;
    let peakIndex = 0;
    let valleyIndex = 0;
    
    while (peakIndex < peaks.length - 1 && valleyIndex < valleys.length - 1) {
      if (peaks[peakIndex] < valleys[valleyIndex] && valleys[valleyIndex] < peaks[peakIndex + 1]) {
        alternatingCount++;
      }
      peakIndex++;
      valleyIndex++;
    }
    
    const consistency = alternatingCount / Math.min(peaks.length - 1, valleys.length - 1);
    return Math.min(1, consistency);
  }

  /**
   * Reset validator state
   */
  public reset(): void {
    this.signalHistory = [];
    this.peakHistory = [];
  }
}
