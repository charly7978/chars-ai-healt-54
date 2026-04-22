/**
 * ADVANCED ARRHYTHMIA DETECTOR V2
 * 
 * Based on 2024-2025 research on PPG-based arrhythmia detection:
 * - RMSSD + SDNN for HRV analysis (Task Force 1996 standards)
 * - Shannon entropy for irregularity detection
 * - Sample entropy for complexity analysis
 * - Poincaré plot (SD1, SD2, SD1/SD2 ratio)
 * - pNN50 for beat-to-beat variability
 * - AF detection: irregularly irregular pattern + high entropy
 * - Ectopy detection: premature beat patterns
 * - Bigeminy/Trigeminy detection: alternating short-long patterns
 * 
 * References:
 * - Shaffer & Ginsberg 2017: HRV metrics and norms
 * - Chong et al. 2015: AF detection from smartphone PPG
 * - Pereira et al. 2020: RMSSD + Shannon entropy for AF screening
 * - Task Force 1996: Heart rate variability standards
 */

export interface ArrhythmiaDetection {
  isDetected: boolean;
  type: 'NORMAL' | 'AF' | 'ECTOPY' | 'BIGEMINY_TRIGEMINY' | 'IRREGULAR' | 'BRADYCARDIA' | 'TACHYCARDIA';
  confidence: number; // 0-1
  metrics: ArrhythmiaMetrics;
  timestamp: number;
}

export interface ArrhythmiaMetrics {
  // Time-domain HRV
  rmssd: number;
  sdnn: number;
  pnn50: number;
  rrMean: number;
  rrMedian: number;
  rrCV: number;
  
  // Non-linear metrics
  shannonEntropy: number;
  sampleEntropy: number;
  sd1: number;
  sd2: number;
  sd1sd2Ratio: number;
  
  // Pattern detection
  afLikeScore: number;
  ectopyScore: number;
  bigeminyScore: number;
  irregularityScore: number;
  
  // Heart rate
  heartRate: number;
}

export class ArrhythmiaProcessor {
  // Configuration based on Task Force 1996 standards
  private readonly MIN_VALID_RR_MS = 300;
  private readonly MAX_VALID_RR_MS = 2000;
  private readonly MIN_BEATS_FOR_ANALYSIS = 12;
  private readonly WINDOW_SIZE = 20;
  private readonly LEARNING_PERIOD_MS = 5000;
  
  // Thresholds based on clinical research
  private readonly RMSSD_NORMAL_UPPER = 50; // ms
  private readonly SDNN_NORMAL_UPPER = 50; // ms
  private readonly PNN50_NORMAL_UPPER = 0.03;
  private readonly SHANNON_ENTROPY_AF_THRESHOLD = 1.9;
  private readonly SD1SD2_AF_THRESHOLD = 0.5;
  private readonly AF_LIKE_SCORE_THRESHOLD = 0.7;
  
  // State
  private rrHistory: number[] = [];
  private lastPeakTime: number | null = null;
  private isLearningPhase = true;
  private detectionHistory: ArrhythmiaDetection[] = [];
  private readonly MAX_HISTORY = 30;
  private startTime = performance.now();
  
  // Callback
  private onDetection?: (detection: ArrhythmiaDetection) => void;

  /**
   * Set callback for arrhythmia detection events
   */
  public setDetectionCallback(callback: (detection: ArrhythmiaDetection) => void): void {
    this.onDetection = callback;
  }

  /**
   * Process RR intervals and detect arrhythmias
   */
  public processRRData(rrData?: { intervals: number[]; lastPeakTime: number | null }): ArrhythmiaDetection {
    const currentTime = performance.now();
    
    // Update RR history
    if (rrData?.intervals && rrData.intervals.length > 0) {
      const validRR = rrData.intervals
        .filter(i => i >= this.MIN_VALID_RR_MS && i <= this.MAX_VALID_RR_MS)
        .slice(-this.WINDOW_SIZE);
      
      this.rrHistory = validRR;
      this.lastPeakTime = rrData.lastPeakTime;
    }
    
    // Check learning phase
    const timeSinceStart = currentTime - this.startTime;
    this.isLearningPhase = timeSinceStart < this.LEARNING_PERIOD_MS;
    
    // Perform detection
    const detection = this.detect();
    
    // Add to history
    this.detectionHistory.push(detection);
    if (this.detectionHistory.length > this.MAX_HISTORY) {
      this.detectionHistory.shift();
    }
    
    // Notify callback
    if (this.onDetection && detection.isDetected) {
      this.onDetection(detection);
    }
    
    return detection;
  }

  /**
   * Main detection logic
   */
  private detect(): ArrhythmiaDetection {
    const empty: ArrhythmiaDetection = {
      isDetected: false,
      type: 'NORMAL',
      confidence: 0,
      metrics: this.getEmptyMetrics(),
      timestamp: performance.now()
    };
    
    if (this.isLearningPhase || this.rrHistory.length < this.MIN_BEATS_FOR_ANALYSIS) {
      return { ...empty, type: 'NORMAL' };
    }
    
    const metrics = this.computeMetrics();
    const type = this.classifyArrhythmia(metrics);
    const confidence = this.computeConfidence(type, metrics);
    
    return {
      isDetected: type !== 'NORMAL',
      type,
      confidence,
      metrics,
      timestamp: performance.now()
    };
  }

  /**
   * Compute all HRV metrics
   */
  private computeMetrics(): ArrhythmiaMetrics {
    const rr = this.rrHistory;
    const n = rr.length;
    
    // Basic statistics
    const mean = rr.reduce((a, b) => a + b, 0) / n;
    const sorted = [...rr].sort((a, b) => a - b);
    const median = sorted[Math.floor(n / 2)];
    
    // SDNN
    const sdnn = Math.sqrt(rr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / n);
    
    // RMSSD
    let sumSqDiff = 0;
    let pnn50Count = 0;
    for (let i = 1; i < n; i++) {
      const diff = rr[i] - rr[i - 1];
      sumSqDiff += diff * diff;
      if (Math.abs(diff) > 50) pnn50Count++;
    }
    const rmssd = Math.sqrt(sumSqDiff / (n - 1));
    const pnn50 = pnn50Count / (n - 1);
    
    // Coefficient of variation
    const rrCV = sdnn / Math.max(1, mean);
    
    // Heart rate
    const heartRate = 60000 / median;
    
    // Shannon entropy
    const shannonEntropy = this.computeShannonEntropy(rr);
    
    // Sample entropy
    const sampleEntropy = this.computeSampleEntropy(rr);
    
    // Poincaré plot
    const { sd1, sd2 } = this.computePoincare(rr);
    const sd1sd2Ratio = sd2 > 0 ? sd1 / sd2 : 0;
    
    // Pattern detection scores
    const afLikeScore = this.computeAFLikeScore(shannonEntropy, pnn50, sd1sd2Ratio, rrCV);
    const ectopyScore = this.detectEctopy(rr);
    const bigeminyScore = this.detectBigeminyTrigeminy(rr);
    const irregularityScore = this.computeIrregularityScore(rr);
    
    return {
      rmssd,
      sdnn,
      pnn50,
      rrMean: mean,
      rrMedian: median,
      rrCV,
      shannonEntropy,
      sampleEntropy,
      sd1,
      sd2,
      sd1sd2Ratio,
      afLikeScore,
      ectopyScore,
      bigeminyScore,
      irregularityScore,
      heartRate
    };
  }

  /**
   * Classify arrhythmia type based on metrics
   */
  private classifyArrhythmia(m: ArrhythmiaMetrics): ArrhythmiaDetection['type'] {
    // Rate-based classifications
    if (m.heartRate < 50 && m.rrCV < 0.08) return 'BRADYCARDIA';
    if (m.heartRate > 110 && m.rrCV < 0.08) return 'TACHYCARDIA';
    
    // AF detection: irregularly irregular + high entropy + high pNN50
    if (m.afLikeScore > this.AF_LIKE_SCORE_THRESHOLD) {
      if (m.shannonEntropy > this.SHANNON_ENTROPY_AF_THRESHOLD && 
          m.pnn50 > 0.15 && 
          m.sd1sd2Ratio < this.SD1SD2_AF_THRESHOLD) {
        return 'AF';
      }
    }
    
    // Bigeminy/Trigeminy pattern
    if (m.bigeminyScore > 0.6) return 'BIGEMINY_TRIGEMINY';
    
    // Ectopy detection
    if (m.ectopyScore > 0.5) return 'ECTOPY';
    
    // General irregularity
    if (m.irregularityScore > 0.5 && m.rmssd > this.RMSSD_NORMAL_UPPER) {
      return 'IRREGULAR';
    }
    
    return 'NORMAL';
  }

  /**
   * Compute confidence score for detection
   */
  private computeConfidence(type: ArrhythmiaDetection['type'], m: ArrhythmiaMetrics): number {
    if (type === 'NORMAL') return 1 - m.irregularityScore;
    
    let confidence = 0.5;
    
    // Add confidence based on metric strength
    if (m.rmssd > this.RMSSD_NORMAL_UPPER) confidence += 0.15;
    if (m.sdnn > this.SDNN_NORMAL_UPPER) confidence += 0.1;
    if (m.pnn50 > this.PNN50_NORMAL_UPPER) confidence += 0.1;
    if (m.shannonEntropy > this.SHANNON_ENTROPY_AF_THRESHOLD) confidence += 0.15;
    
    // Type-specific confidence
    if (type === 'AF' && m.afLikeScore > 0.8) confidence += 0.2;
    if (type === 'ECTOPY' && m.ectopyScore > 0.7) confidence += 0.2;
    if (type === 'BIGEMINY_TRIGEMINY' && m.bigeminyScore > 0.7) confidence += 0.2;
    
    return Math.min(1, confidence);
  }

  /**
   * Compute AF-like score combining multiple metrics
   */
  private computeAFLikeScore(shannonEntropy: number, pnn50: number, sd1sd2Ratio: number, rrCV: number): number {
    const entropyScore = Math.min(1, shannonEntropy / 2.5);
    const pnnScore = Math.min(1, pnn50 / 0.5);
    const poincareScore = sd1sd2Ratio < 0.6 ? 1 - (sd1sd2Ratio / 0.6) : 0;
    const cvScore = Math.min(1, rrCV / 0.2);
    
    return (entropyScore * 0.35) + (pnnScore * 0.25) + (poincareScore * 0.2) + (cvScore * 0.2);
  }

  /**
   * Detect ectopic beats (premature beats)
   */
  private detectEctopy(rr: number[]): number {
    if (rr.length < 6) return 0;
    
    const median = this.median(rr);
    let ectopyCount = 0;
    
    for (let i = 1; i < rr.length; i++) {
      const prev = rr[i - 1];
      const curr = rr[i];
      const ratio = curr / Math.max(1, prev);
      
      // Premature beat: significantly shorter than previous
      if (ratio < 0.8 && curr < median * 0.85) {
        ectopyCount++;
      }
    }
    
    return Math.min(1, ectopyCount / (rr.length - 1) * 3);
  }

  /**
   * Detect bigeminy/trigeminy patterns
   */
  private detectBigeminyTrigeminy(rr: number[]): number {
    if (rr.length < 6) return 0;
    
    let patternCount = 0;
    
    for (let i = 2; i < rr.length; i++) {
      const r1 = rr[i - 2];
      const r2 = rr[i - 1];
      const r3 = rr[i];
      
      // Bigeminy: alternating short-long-short-long
      const ratio1 = r2 / Math.max(1, r1);
      const ratio2 = r3 / Math.max(1, r2);
      
      if ((ratio1 < 0.75 || ratio1 > 1.33) && 
          Math.abs(ratio2 - (1 / ratio1)) < 0.3) {
        patternCount++;
      }
    }
    
    return Math.min(1, patternCount / (rr.length - 2) * 2);
  }

  /**
   * Compute irregularity score
   */
  private computeIrregularityScore(rr: number[]): number {
    if (rr.length < 4) return 0;
    
    const diffs: number[] = [];
    for (let i = 1; i < rr.length; i++) {
      diffs.push(Math.abs(rr[i] - rr[i - 1]));
    }
    
    const medianDiff = this.median(diffs);
    const outlierCount = diffs.filter(d => d > medianDiff * 1.5).length;
    
    return Math.min(1, outlierCount / diffs.length * 2);
  }

  /**
   * Shannon entropy calculation
   */
  private computeShannonEntropy(rr: number[]): number {
    if (rr.length < 5) return 0;
    
    const histogram = new Map<number, number>();
    const binWidth = 50;
    
    rr.forEach(r => {
      const bin = Math.floor(r / binWidth) * binWidth;
      histogram.set(bin, (histogram.get(bin) || 0) + 1);
    });
    
    let entropy = 0;
    const total = rr.length;
    
    histogram.forEach(count => {
      const p = count / total;
      entropy -= p * Math.log2(p);
    });
    
    return entropy;
  }

  /**
   * Sample entropy calculation (simplified)
   */
  private computeSampleEntropy(rr: number[]): number {
    if (rr.length < 10) return 0;
    
    const m = 2;
    const r = 0.2 * this.std(rr);
    
    let A = 0;
    let B = 0;
    
    for (let i = 0; i < rr.length - m; i++) {
      for (let j = i + 1; j < rr.length - m; j++) {
        let matchM = true;
        
        for (let k = 0; k < m; k++) {
          if (Math.abs(rr[i + k] - rr[j + k]) > r) {
            matchM = false;
            break;
          }
        }
        
        if (matchM) {
          B++;
          if (Math.abs(rr[i + m] - rr[j + m]) <= r) {
            A++;
          }
        }
      }
    }
    
    if (B === 0 || A === 0) return 0;
    return -Math.log(A / B);
  }

  /**
   * Poincaré plot metrics (SD1, SD2)
   */
  private computePoincare(rr: number[]): { sd1: number; sd2: number } {
    if (rr.length < 3) return { sd1: 0, sd2: 0 };
    
    let sumD1 = 0;
    let sumD2 = 0;
    
    for (let i = 1; i < rr.length; i++) {
      const d = rr[i] - rr[i - 1];
      sumD1 += d * d;
      
      const s = rr[i] + rr[i - 1];
      const mean2 = 2 * (rr.reduce((a, b) => a + b, 0) / rr.length);
      sumD2 += (s - mean2) ** 2;
    }
    
    const n = rr.length - 1;
    return {
      sd1: Math.sqrt(sumD1 / (2 * n)),
      sd2: Math.sqrt(sumD2 / (2 * n))
    };
  }

  // Utility functions
  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  private std(arr: number[]): number {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / arr.length);
  }

  private getEmptyMetrics(): ArrhythmiaMetrics {
    return {
      rmssd: 0,
      sdnn: 0,
      pnn50: 0,
      rrMean: 0,
      rrMedian: 0,
      rrCV: 0,
      shannonEntropy: 0,
      sampleEntropy: 0,
      sd1: 0,
      sd2: 0,
      sd1sd2Ratio: 0,
      afLikeScore: 0,
      ectopyScore: 0,
      bigeminyScore: 0,
      irregularityScore: 0,
      heartRate: 0
    };
  }

  /**
   * Get detection history
   */
  public getDetectionHistory(): ArrhythmiaDetection[] {
    return [...this.detectionHistory];
  }

  /**
   * Reset processor state
   */
  public reset(): void {
    this.rrHistory = [];
    this.lastPeakTime = null;
    this.isLearningPhase = true;
    this.detectionHistory = [];
    this.startTime = performance.now();
  }
}