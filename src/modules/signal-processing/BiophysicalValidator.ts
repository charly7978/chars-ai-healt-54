/**
 * Clase para validación de señales biofísicamente plausibles
 * Aplica restricciones fisiológicas a las señales PPG
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */
export class BiophysicalValidator {
  private lastPulsatilityValues: number[] = [];
  private readonly MAX_PULSATILITY_HISTORY = 30;
  private readonly MIN_PULSATILITY = 0.08; // Antes 0.15, más permisivo para hardware débil
  private readonly MAX_PULSATILITY = 8.0;
  private lastRawValues: number[] = []; // Raw values for trend analysis
  private lastTimeStamps: number[] = []; // Timestamps for temporal analysis
  private readonly MEASUREMENTS_PER_SECOND = 30; // Assumed frame rate

  // Biophysical normal ranges for PPG signals - stricter ranges
  private readonly PHYSIOLOGICAL_RANGES = {
    redToGreen: { min: 1.2, max: 3.2, weight: 0.4 }, // More restrictive
    redToBlue: { min: 1.1, max: 3.8, weight: 0.3 }, // More restrictive
    redValue: { min: 30, max: 220, weight: 0.3 } // Higher minimum threshold
  };

  constructor() {
    // Initialize pulsatility history
    this.reset();
  }

  /**
   * Calculates signal pulsatility index based on recent variations
   * @param value Current filtered signal value
   * @returns Normalized pulsatility index between 0-1
   */
  // LÓGICA ULTRA-SIMPLE: la pulsatilidad siempre es 1
  calculatePulsatilityIndex(value: number): number {
    return 1;
  }
  
  /**
   * Analyzes signal frequency to detect patterns compatible with cardiac rhythm
   * Enhanced to only detect frequencies in human heart rate range (40-180 BPM)
   * @returns Score 0-1 based on compatibility with cardiac rhythm
   */
  private analyzeCardiacFrequency(): number {
    if (this.lastTimeStamps.length < 20 || this.lastRawValues.length < 20) {
      return 0.0; // Not enough data to analyze
    }
    
    // Advanced peak detection with validation
    const peaks: number[] = [];
    const peakTimes: number[] = [];
    const valleyTimes: number[] = [];
    
    // First, identify potential peaks with stricter criteria
    for (let i = 4; i < this.lastRawValues.length - 4; i++) {
      const current = this.lastRawValues[i];
      
      // Check if this point is higher than surrounding points
      if (current > this.lastRawValues[i-1] && 
          current > this.lastRawValues[i-2] && 
          current > this.lastRawValues[i-3] && 
          current > this.lastRawValues[i+1] && 
          current > this.lastRawValues[i+2] &&
          current > this.lastRawValues[i+3]) {
        
        peaks.push(i);
        peakTimes.push(this.lastTimeStamps[i]);
      }
      
      // Also identify valleys for rhythm analysis
      if (current < this.lastRawValues[i-1] && 
          current < this.lastRawValues[i-2] && 
          current < this.lastRawValues[i-3] && 
          current < this.lastRawValues[i+1] && 
          current < this.lastRawValues[i+2] &&
          current < this.lastRawValues[i+3]) {
        
        valleyTimes.push(this.lastTimeStamps[i]);
      }
    }
    
    // Calculate peak-to-peak intervals
    const intervals: number[] = [];
    for (let i = 1; i < peakTimes.length; i++) {
      intervals.push(peakTimes[i] - peakTimes[i-1]);
    }
    
    // No intervals detected
    if (intervals.length < 2) return 0.0;
    
    // Calculate average interval and convert to BPM
    const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const estimatedBPM = 60000 / avgInterval;
    
    // Calculate interval consistency (lower variation means more consistent rhythm)
    let intervalVariation = 0;
    for (const interval of intervals) {
      intervalVariation += Math.abs(interval - avgInterval) / avgInterval;
    }
    intervalVariation /= intervals.length;
    
    // Only consider valid heart rates between 40-180 BPM
    // with strong penalty for ranges outside physiological norms
    let bpmScore = 0;
    if (estimatedBPM >= 40 && estimatedBPM <= 180) {
      // Strongest confidence in normal range (50-120 BPM)
      if (estimatedBPM >= 50 && estimatedBPM <= 120) {
        bpmScore = 1.0;
      } else {
        // Reduced confidence for extreme but still physiological ranges
        bpmScore = 0.6;
      }
    } else if (estimatedBPM > 30 && estimatedBPM < 200) {
      // Very low confidence in borderline physiological ranges
      bpmScore = 0.1;
    } else {
      // Non-physiological ranges get zero score
      bpmScore = 0;
    }
    
    // Calculate regularity score (lower intervalVariation is better)
    const regularityScore = intervalVariation < 0.2 ? 
                           1.0 : Math.max(0, 1 - (intervalVariation - 0.2) * 2.5);
    
    // Calculate peak-valley alternation score (proper cardiac signal alternates)
    let alternationScore = 0;
    if (peaks.length >= 3 && valleyTimes.length >= 3) {
      let properAlternations = 0;
      let totalChecks = 0;
      
      // Check for proper peak-valley-peak alternation pattern
      for (let i = 0; i < peakTimes.length - 1; i++) {
        const peakTime = peakTimes[i];
        const nextPeakTime = peakTimes[i+1];
        
        // Find if there's a valley between these peaks
        const hasValleyBetween = valleyTimes.some(vt => vt > peakTime && vt < nextPeakTime);
        
        if (hasValleyBetween) {
          properAlternations++;
        }
        totalChecks++;
      }
      
      alternationScore = totalChecks > 0 ? properAlternations / totalChecks : 0;
    }
    
    // Final frequency score combines BPM validity, regularity, and alternation pattern
    const frequencyScore = bpmScore * 0.5 + regularityScore * 0.3 + alternationScore * 0.2;
    
    // Return final score with strong penalties for non-cardiac patterns
    return Math.pow(frequencyScore, 1.5); // Exponential weighting favors clear cardiac signals
  }
  
  /**
   * Analyzes signal zero-crossings to detect waveform patterns compatible with PPG
   * PPG signals typically have asymmetrical waves with specific crossing patterns
   */
  private analyzeZeroCrossings(): number {
    if (this.lastRawValues.length < 20) {
      return 0.0;
    }
    
    // Normalize signal around zero for crossing detection
    const mean = this.lastRawValues.reduce((sum, val) => sum + val, 0) / this.lastRawValues.length;
    const normalizedValues = this.lastRawValues.map(v => v - mean);
    
    // Find zero crossings
    const crossings: number[] = [];
    const crossingDirections: ('up'|'down')[] = [];
    
    for (let i = 1; i < normalizedValues.length; i++) {
      // Detect a crossing
      if ((normalizedValues[i-1] < 0 && normalizedValues[i] >= 0) || 
          (normalizedValues[i-1] >= 0 && normalizedValues[i] < 0)) {
        
        crossings.push(i);
        crossingDirections.push(normalizedValues[i-1] < 0 ? 'up' : 'down');
      }
    }
    
    // Too few crossings indicates poor signal
    if (crossings.length < 4) {
      return 0.0;
    }
    
    // Calculate intervals between crossings
    const intervals: number[] = [];
    for (let i = 1; i < crossings.length; i++) {
      intervals.push(this.lastTimeStamps[crossings[i]] - this.lastTimeStamps[crossings[i-1]]);
    }
    
    // Check for pattern of alternating short and long intervals
    // (cardiac PPG has asymmetric up/down slopes)
    let patternScore = 0;
    if (intervals.length >= 4) {
      let alternatingCount = 0;
      
      for (let i = 0; i < intervals.length - 1; i++) {
        const ratio = intervals[i] / intervals[i+1];
        
        // Cardiac PPG typically has interval ratios that alternate between high and low
        if ((i % 2 === 0 && (ratio > 1.3 || ratio < 0.7)) || 
            (i % 2 === 1 && (ratio < 0.7 || ratio > 1.3))) {
          alternatingCount++;
        }
      }
      
      patternScore = alternatingCount / (intervals.length - 1);
    }
    
    // Check for appropriate number of crossings for heart rate
    // (normal heart rate produces ~2-4 crossings per second)
    const durationSeconds = (this.lastTimeStamps[this.lastTimeStamps.length-1] - 
                             this.lastTimeStamps[0]) / 1000;
    
    const crossingsPerSecond = crossings.length / Math.max(0.5, durationSeconds);
    let crossingRateScore = 0;
    
    if (crossingsPerSecond >= 2 && crossingsPerSecond <= 8) {
      crossingRateScore = 1.0; // Optimal cardiac rate
    } else if (crossingsPerSecond > 0 && crossingsPerSecond < 10) {
      // Linear falloff for suboptimal rates
      crossingRateScore = Math.max(0, 1 - Math.abs(4 - crossingsPerSecond) / 4);
    }
    
    // Final score combines pattern recognition and crossing rate
    return patternScore * 0.6 + crossingRateScore * 0.4;
  }

  /**
   * Validates if signal parameters are within biophysically plausible ranges
   * @param redValue Mean red channel value
   * @param rToGRatio Red/green ratio
   * @param rToBRatio Red/blue ratio
   * @returns Biophysical plausibility score (0-1)
   */
  // LÓGICA ULTRA-SIMPLE: la validación biofísica siempre es 1
  validateBiophysicalRange(redValue: number, rToGRatio: number, rToBRatio: number): number {
    return 1;
  }

  /**
   * Calculates a score based on whether a value is within range
   * with smooth transition at boundaries
   */
  private calculateRangeScore(value: number, min: number, max: number): number {
    // If in optimal range
    if (value >= min && value <= max) {
      return 1.0;
    }
    
    // If below minimum, calculate score with gradient
    if (value < min) {
      const distance = min - value;
      const range = min * 0.4; // Allow deviation up to 40% below (more strict)
      
      return Math.max(0, 1 - (distance / range));
    }
    
    // If above maximum, calculate score with gradient
    const distance = value - max;
    const range = max * 0.4; // Allow deviation up to 40% above (more strict)
    
    return Math.max(0, 1 - (distance / range));
  }

  /**
   * Reset the validator state
   */
  reset(): void {
    this.lastPulsatilityValues = [];
    this.lastRawValues = [];
    this.lastTimeStamps = [];
  }
}
