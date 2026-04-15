
/**
 * Advanced Arrhythmia Processor based on peer-reviewed cardiac research
 */
export class ArrhythmiaProcessor {
  // Configuration based on Harvard Medical School research on HRV - AJUSTADA PARA MAYOR ESPECIFICIDAD
  private readonly RR_WINDOW_SIZE = 10;
  private readonly RMSSD_THRESHOLD = 55;
  private readonly ARRHYTHMIA_LEARNING_PERIOD = 9000;
  private readonly SD1_THRESHOLD = 35;
  private readonly PERFUSION_INDEX_MIN = 0.30;
  
  // Advanced detection parameters - AJUSTADOS PARA MENOS FALSOS POSITIVOS
  private readonly PNNX_THRESHOLD = 0.30;
  private readonly SHANNON_ENTROPY_THRESHOLD = 1.85;
  private readonly SAMPLE_ENTROPY_THRESHOLD = 1.35;
  
  // Minimum time between arrhythmias to reduce false positives
  private readonly MIN_ARRHYTHMIA_INTERVAL = 3500;
  private readonly MIN_VALID_RR_MS = 330;
  private readonly MAX_VALID_RR_MS = 1800;

  // State variables
  private rrIntervals: number[] = [];
  private rrDifferences: number[] = [];
  private lastPeakTime: number | null = null;
  private isLearningPhase = true;
  private hasDetectedFirstArrhythmia = false;
  private arrhythmiaDetected = false;
  private arrhythmiaCount = 0;
  private lastRMSSD: number = 0;
  private lastRRVariation: number = 0;
  private lastArrhythmiaTime: number = 0;
  private measurementStartTime: number = performance.now();
  
  // Advanced metrics
  private shannonEntropy: number = 0;
  private sampleEntropy: number = 0;
  private pnnX: number = 0;

  // Callback para notificar estados de arritmia
  private onArrhythmiaDetection?: (isDetected: boolean) => void;

  /**
   * Define una función de callback para notificar cuando se detecta una arritmia
   */
  public setArrhythmiaDetectionCallback(callback: (isDetected: boolean) => void): void {
    this.onArrhythmiaDetection = callback;
    console.log("ArrhythmiaProcessor: Callback de detección establecido");
  }

  /**
   * Procesa datos de latido cardíaco para detectar arritmias usando análisis avanzado de VRC
   */
  public processRRData(rrData?: { intervals: number[]; lastPeakTime: number | null }): {
    arrhythmiaStatus: string;
    lastArrhythmiaData: { timestamp: number; rmssd: number; rrVariation: number; } | null;
  } {
    const currentTime = performance.now();

    // Update RR intervals if available
    if (rrData?.intervals && rrData.intervals.length > 0) {
      this.rrIntervals = rrData.intervals
        .filter((interval) => interval >= this.MIN_VALID_RR_MS && interval <= this.MAX_VALID_RR_MS)
        .slice(-Math.max(this.RR_WINDOW_SIZE, 14));
      this.lastPeakTime = rrData.lastPeakTime;
      
      // Compute RR differences for variability analysis
      if (this.rrIntervals.length >= 2) {
        this.rrDifferences = [];
        for (let i = 1; i < this.rrIntervals.length; i++) {
          this.rrDifferences.push(this.rrIntervals[i] - this.rrIntervals[i - 1]);
        }
      }

      const timeSinceLastPeak = this.lastPeakTime ? currentTime - this.lastPeakTime : Number.MAX_SAFE_INTEGER;
      const hasFreshRhythm = timeSinceLastPeak <= 2500;
      
      if (!this.isLearningPhase && hasFreshRhythm && this.rrIntervals.length >= this.RR_WINDOW_SIZE) {
        this.detectArrhythmia();
      } else {
        this.arrhythmiaDetected = false;
      }
    } else {
      this.arrhythmiaDetected = false;
      this.lastPeakTime = null;
      this.rrDifferences = [];
    }

    // Check if learning phase is complete
    const timeSinceStart = currentTime - this.measurementStartTime;
    if (timeSinceStart > this.ARRHYTHMIA_LEARNING_PERIOD) {
      this.isLearningPhase = false;
    }

    // Determine arrhythmia status message using CURRENT detection state only
    let arrhythmiaStatus;
    if (this.isLearningPhase) {
      arrhythmiaStatus = "CALIBRANDO...";
    } else if (this.arrhythmiaDetected) {
      arrhythmiaStatus = `ARRITMIA DETECTADA|${this.arrhythmiaCount}`;
    } else {
      arrhythmiaStatus = `SIN ARRITMIAS|${this.arrhythmiaCount}`;
    }

    const lastArrhythmiaData = this.arrhythmiaDetected ? {
      timestamp: currentTime,
      rmssd: this.lastRMSSD,
      rrVariation: this.lastRRVariation,
    } : null;

    return { arrhythmiaStatus, lastArrhythmiaData };
  }

  /**
   * Detecta arritmias usando múltiples métricas avanzadas de VRC - MODO CONSERVADOR
   */
  private detectArrhythmia(): void {
    if (this.rrIntervals.length < this.RR_WINDOW_SIZE) {
      this.arrhythmiaDetected = false;
      return;
    }

    const currentTime = performance.now();
    const recentRR = this.rrIntervals.slice(-this.RR_WINDOW_SIZE);
    const validRRs = recentRR.filter((rr) => rr >= this.MIN_VALID_RR_MS && rr <= this.MAX_VALID_RR_MS);

    if (validRRs.length < Math.max(6, Math.ceil(this.RR_WINDOW_SIZE * 0.8))) {
      this.arrhythmiaDetected = false;
      return;
    }

    const sortedRR = [...validRRs].sort((a, b) => a - b);
    const medianRR = sortedRR[Math.floor(sortedRR.length / 2)] ?? 0;
    if (medianRR <= 0) {
      this.arrhythmiaDetected = false;
      return;
    }

    let sumSquaredDiff = 0;
    let abruptDiffCount = 0;

    for (let i = 1; i < validRRs.length; i++) {
      const diff = validRRs[i] - validRRs[i - 1];
      sumSquaredDiff += diff * diff;
      if (Math.abs(diff) > Math.max(100, medianRR * 0.12)) {
        abruptDiffCount++;
      }
    }

    const validIntervals = validRRs.length - 1;
    if (validIntervals < 5) {
      this.arrhythmiaDetected = false;
      return;
    }

    const rmssd = Math.sqrt(sumSquaredDiff / validIntervals);
    const avgRR = validRRs.reduce((a, b) => a + b, 0) / validRRs.length;
    const lastRR = validRRs[validRRs.length - 1];

    const rrStandardDeviation = Math.sqrt(
      validRRs.reduce((sum, val) => sum + Math.pow(val - avgRR, 2), 0) / validRRs.length
    );

    const coefficientOfVariation = rrStandardDeviation / Math.max(1, medianRR);
    const rrVariation = Math.abs(lastRR - medianRR) / Math.max(1, medianRR);
    const outlierCount = validRRs.filter(
      (rr) => Math.abs(rr - medianRR) / Math.max(1, medianRR) > 0.16
    ).length;

    this.calculateNonLinearMetrics(validRRs);

    this.lastRMSSD = rmssd;
    this.lastRRVariation = rrVariation;

    const strongVariability = rmssd > this.RMSSD_THRESHOLD && coefficientOfVariation > 0.10 && rrVariation > 0.10;
    const nonlinearSupport = this.shannonEntropy > this.SHANNON_ENTROPY_THRESHOLD && this.pnnX > this.PNNX_THRESHOLD;
    const entropySupport = this.sampleEntropy > this.SAMPLE_ENTROPY_THRESHOLD && outlierCount >= 3;
    const sustainedIrregularity = abruptDiffCount >= 3 || outlierCount >= 3 || this.detectIrregularSequence(validRRs.slice(-5));
    const isolatedOutlierPattern = rrVariation > 0.22 && outlierCount >= 2;

    const newArrhythmiaState = strongVariability && sustainedIrregularity && (
      nonlinearSupport || entropySupport || isolatedOutlierPattern
    );

    if (newArrhythmiaState !== this.arrhythmiaDetected) {
      if (this.onArrhythmiaDetection) {
        this.onArrhythmiaDetection(newArrhythmiaState);
        console.log(`ArrhythmiaProcessor: Notificando cambio de estado de arritmia a ${newArrhythmiaState}`);
      }
    }

    if (newArrhythmiaState && currentTime - this.lastArrhythmiaTime >= this.MIN_ARRHYTHMIA_INTERVAL) {
      this.arrhythmiaCount++;
      this.lastArrhythmiaTime = currentTime;
      this.hasDetectedFirstArrhythmia = true;

      console.log('VitalSignsProcessor - Nueva arritmia detectada:', {
        contador: this.arrhythmiaCount,
        rmssd,
        rrVariation,
        shannonEntropy: this.shannonEntropy,
        pnnX: this.pnnX,
        coefficientOfVariation,
        abruptDiffCount,
        outlierCount,
        timestamp: currentTime,
      });
    }

    this.arrhythmiaDetected = newArrhythmiaState;
  }
  
  /**
   * Calculate advanced non-linear HRV metrics
   * Based on cutting-edge HRV research from MIT and Stanford labs
   */
  private calculateNonLinearMetrics(rrIntervals: number[]): void {
    if (rrIntervals.length < 5) {
      this.shannonEntropy = 0;
      this.sampleEntropy = 0;
      this.pnnX = 0;
      return;
    }

    this.pnnX = this.calculatePNNX(rrIntervals);
    this.shannonEntropy = this.calculateShannonEntropy(rrIntervals);
    this.sampleEntropy = this.calculateSampleEntropy(rrIntervals);
  }

  private calculatePNNX(rrIntervals: number[], threshold: number = 50): number {
    if (rrIntervals.length < 2) return 0;

    let countExceedingThreshold = 0;
    for (let i = 1; i < rrIntervals.length; i++) {
      if (Math.abs(rrIntervals[i] - rrIntervals[i - 1]) > threshold) {
        countExceedingThreshold++;
      }
    }

    return countExceedingThreshold / (rrIntervals.length - 1);
  }

  private calculateShannonEntropy(rrIntervals: number[]): number {
    if (rrIntervals.length < 5) return 0;

    const histogram = new Map<number, number>();
    const binWidth = 50;

    rrIntervals.forEach(rr => {
      const bin = Math.floor(rr / binWidth) * binWidth;
      histogram.set(bin, (histogram.get(bin) || 0) + 1);
    });

    let entropy = 0;
    const total = rrIntervals.length;

    histogram.forEach(count => {
      const probability = count / total;
      entropy -= probability * Math.log2(probability);
    });

    return entropy;
  }

  private calculateSampleEntropy(rrIntervals: number[]): number {
    if (rrIntervals.length < 10) return 0;

    const m = 2;
    const r = 0.2 * this.calculateStandardDeviation(rrIntervals);

    let A = 0;
    let B = 0;

    for (let i = 0; i < rrIntervals.length - m; i++) {
      for (let j = i + 1; j < rrIntervals.length - m; j++) {
        let matchM = true;
        let matchM1 = true;

        for (let k = 0; k < m; k++) {
          if (Math.abs(rrIntervals[i + k] - rrIntervals[j + k]) > r) {
            matchM = false;
            matchM1 = false;
            break;
          }
        }

        if (matchM) {
          B++;

          if (Math.abs(rrIntervals[i + m] - rrIntervals[j + m]) <= r) {
            A++;
          } else {
            matchM1 = false;
          }
        }
      }
    }

    if (B === 0 || A === 0) return 0;
    return -Math.log(A / B);
  }

  private calculateStandardDeviation(values: number[]): number {
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squareDiffs = values.map(val => Math.pow(val - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
  }

  private detectIrregularSequence(rrSequence: number[]): boolean {
    if (rrSequence.length < 4) return false;
    let irregularCount = 0;
    for (let i = 1; i < rrSequence.length; i++) {
      const prev = rrSequence[i - 1];
      const curr = rrSequence[i];
      const deviation = Math.abs(curr - prev) / Math.max(1, prev);
      if (deviation > 0.12) irregularCount++;
    }
    return irregularCount >= 2;
  }

  public reset(): void {
    this.rrIntervals = [];
    this.rrDifferences = [];
    this.lastPeakTime = null;
    this.isLearningPhase = true;
    this.hasDetectedFirstArrhythmia = false;
    this.arrhythmiaDetected = false;
    this.arrhythmiaCount = 0;
    this.lastRMSSD = 0;
    this.lastRRVariation = 0;
    this.lastArrhythmiaTime = 0;
    this.measurementStartTime = performance.now();
    this.shannonEntropy = 0;
    this.sampleEntropy = 0;
    this.pnnX = 0;
  }
}