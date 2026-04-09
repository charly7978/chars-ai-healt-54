/**
 * ARRHYTHMIA PROCESSOR — Evidence-Based Multi-Metric Detection
 *
 * Detection approach based on published AF screening literature:
 * 1. RMSSD (Root Mean Square of Successive Differences) — time-domain HRV
 * 2. pNN50 (% of successive RR intervals differing >50ms) — irregularity marker
 * 3. Shannon Entropy of RR histogram — complexity measure
 * 4. Turning Point Ratio — randomness test for RR sequence
 * 5. Coefficient of Variation — overall variability
 *
 * Requires ALL of:
 *   - Learning period complete (baseline established)
 *   - Sufficient valid RR intervals (≥8)
 *   - Fresh rhythm data (last peak <2.5s ago)
 *   - At least 3 of 5 metrics exceed thresholds simultaneously
 *
 * This approach minimizes false positives by requiring multi-metric consensus.
 */
export class ArrhythmiaProcessor {
  // === CONFIGURATION ===
  private readonly RR_WINDOW_SIZE = 12;
  private readonly LEARNING_PERIOD_MS = 8000;
  private readonly MIN_VALID_RR_MS = 280;
  private readonly MAX_VALID_RR_MS = 2000;
  private readonly MIN_ARRHYTHMIA_INTERVAL_MS = 4000;
  private readonly FRESHNESS_TIMEOUT_MS = 2500;

  // === METRIC THRESHOLDS (tuned for specificity over sensitivity) ===
  private readonly RMSSD_THRESHOLD = 60;          // ms, elevated = irregular
  private readonly PNN50_THRESHOLD = 0.30;         // 30%+ successive diffs >50ms
  private readonly SHANNON_ENTROPY_THRESHOLD = 2.0; // bits, high = chaotic
  private readonly TURNING_POINT_RATIO_LOW = 0.50;  // below = too regular (artifact)
  private readonly TURNING_POINT_RATIO_HIGH = 0.85; // above = too random (AF-like)
  private readonly CV_THRESHOLD = 0.12;             // coefficient of variation

  // === STATE ===
  private rrIntervals: number[] = [];
  private lastPeakTime: number | null = null;
  private isLearning = true;
  private measurementStartTime = Date.now();
  private arrhythmiaDetected = false;
  private arrhythmiaCount = 0;
  private lastArrhythmiaTime = 0;

  // === COMPUTED METRICS (exposed for UI) ===
  private lastRMSSD = 0;
  private lastRRVariation = 0;
  private lastPNN50 = 0;
  private lastEntropy = 0;
  private lastTPR = 0;

  // === BASELINE (learned during calibration) ===
  private baselineRMSSD = 0;
  private baselineSamples = 0;

  private onArrhythmiaDetection?: (isDetected: boolean) => void;

  public setArrhythmiaDetectionCallback(callback: (isDetected: boolean) => void): void {
    this.onArrhythmiaDetection = callback;
  }

  public processRRData(rrData?: { intervals: number[]; lastPeakTime: number | null }): {
    arrhythmiaStatus: string;
    lastArrhythmiaData: { timestamp: number; rmssd: number; rrVariation: number } | null;
  } {
    const now = Date.now();

    // Update learning phase
    if (now - this.measurementStartTime > this.LEARNING_PERIOD_MS) {
      this.isLearning = false;
    }

    // No data → no detection
    if (!rrData?.intervals || rrData.intervals.length === 0) {
      this.arrhythmiaDetected = false;
      return this.buildResult(now);
    }

    // Filter valid RR intervals
    this.rrIntervals = rrData.intervals
      .filter(rr => rr >= this.MIN_VALID_RR_MS && rr <= this.MAX_VALID_RR_MS)
      .slice(-this.RR_WINDOW_SIZE);
    this.lastPeakTime = rrData.lastPeakTime;

    // Check freshness
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : Infinity;
    if (timeSinceLastPeak > this.FRESHNESS_TIMEOUT_MS) {
      this.arrhythmiaDetected = false;
      return this.buildResult(now);
    }

    // Need minimum intervals
    if (this.rrIntervals.length < 8) {
      this.arrhythmiaDetected = false;
      return this.buildResult(now);
    }

    // During learning: accumulate baseline RMSSD
    if (this.isLearning) {
      const rmssd = this.computeRMSSD(this.rrIntervals);
      this.baselineRMSSD = (this.baselineRMSSD * this.baselineSamples + rmssd) / (this.baselineSamples + 1);
      this.baselineSamples++;
      this.arrhythmiaDetected = false;
      return this.buildResult(now);
    }

    // === MULTI-METRIC DETECTION ===
    this.runDetection(now);

    return this.buildResult(now);
  }

  /**
   * Core detection: requires consensus of multiple metrics
   */
  private runDetection(now: number): void {
    const rr = this.rrIntervals;

    // Compute all metrics
    const rmssd = this.computeRMSSD(rr);
    const pnn50 = this.computePNN50(rr);
    const entropy = this.computeShannonEntropy(rr);
    const tpr = this.computeTurningPointRatio(rr);
    const cv = this.computeCV(rr);
    const lastRR = rr[rr.length - 1];
    const medianRR = this.median(rr);
    const rrVariation = Math.abs(lastRR - medianRR) / Math.max(1, medianRR);

    // Store for UI/debug
    this.lastRMSSD = rmssd;
    this.lastPNN50 = pnn50;
    this.lastEntropy = entropy;
    this.lastTPR = tpr;
    this.lastRRVariation = rrVariation;

    // === VOTE SYSTEM: each metric casts a vote ===
    let votes = 0;
    const totalVoters = 5;

    // Vote 1: RMSSD significantly above baseline (or absolute threshold)
    const rmssdThreshold = this.baselineRMSSD > 10 
      ? Math.max(this.RMSSD_THRESHOLD, this.baselineRMSSD * 1.8) 
      : this.RMSSD_THRESHOLD;
    if (rmssd > rmssdThreshold) votes++;

    // Vote 2: pNN50 elevated
    if (pnn50 > this.PNN50_THRESHOLD) votes++;

    // Vote 3: Shannon entropy elevated (chaotic RR pattern)
    if (entropy > this.SHANNON_ENTROPY_THRESHOLD) votes++;

    // Vote 4: Turning point ratio indicates randomness
    if (tpr > this.TURNING_POINT_RATIO_HIGH) votes++;

    // Vote 5: Coefficient of variation elevated
    if (cv > this.CV_THRESHOLD) votes++;

    // Require at least 3 of 5 metrics to agree
    const isArrhythmia = votes >= 3;

    // Notify state change
    if (isArrhythmia !== this.arrhythmiaDetected && this.onArrhythmiaDetection) {
      this.onArrhythmiaDetection(isArrhythmia);
    }

    // Count events with minimum spacing
    if (isArrhythmia && !this.arrhythmiaDetected && 
        now - this.lastArrhythmiaTime >= this.MIN_ARRHYTHMIA_INTERVAL_MS) {
      this.arrhythmiaCount++;
      this.lastArrhythmiaTime = now;
    }

    this.arrhythmiaDetected = isArrhythmia;
  }

  // === METRIC COMPUTATIONS ===

  private computeRMSSD(rr: number[]): number {
    if (rr.length < 2) return 0;
    let sumSqDiff = 0;
    for (let i = 1; i < rr.length; i++) {
      const diff = rr[i] - rr[i - 1];
      sumSqDiff += diff * diff;
    }
    return Math.sqrt(sumSqDiff / (rr.length - 1));
  }

  private computePNN50(rr: number[]): number {
    if (rr.length < 2) return 0;
    let count = 0;
    for (let i = 1; i < rr.length; i++) {
      if (Math.abs(rr[i] - rr[i - 1]) > 50) count++;
    }
    return count / (rr.length - 1);
  }

  private computeShannonEntropy(rr: number[]): number {
    if (rr.length < 3) return 0;
    // Bin RR intervals into 25ms bins
    const bins = new Map<number, number>();
    for (const r of rr) {
      const bin = Math.floor(r / 25);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    let entropy = 0;
    const n = rr.length;
    for (const count of bins.values()) {
      const p = count / n;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  /**
   * Turning Point Ratio: fraction of RR[i] that are local extrema
   * In a purely random sequence, TPR ≈ 2/3 ≈ 0.667
   * Regular rhythm → TPR ≈ 0 (monotonic)
   * Very irregular (AF) → TPR > 0.85
   */
  private computeTurningPointRatio(rr: number[]): number {
    if (rr.length < 3) return 0;
    let turningPoints = 0;
    for (let i = 1; i < rr.length - 1; i++) {
      const isMax = rr[i] > rr[i - 1] && rr[i] > rr[i + 1];
      const isMin = rr[i] < rr[i - 1] && rr[i] < rr[i + 1];
      if (isMax || isMin) turningPoints++;
    }
    return turningPoints / (rr.length - 2);
  }

  private computeCV(rr: number[]): number {
    if (rr.length < 2) return 0;
    const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
    const variance = rr.reduce((a, v) => a + (v - mean) ** 2, 0) / rr.length;
    return Math.sqrt(variance) / Math.max(1, mean);
  }

  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }

  // === OUTPUT ===

  private buildResult(now: number): {
    arrhythmiaStatus: string;
    lastArrhythmiaData: { timestamp: number; rmssd: number; rrVariation: number } | null;
  } {
    let arrhythmiaStatus: string;
    if (this.isLearning) {
      arrhythmiaStatus = "CALIBRANDO...";
    } else if (this.arrhythmiaDetected) {
      arrhythmiaStatus = `ARRITMIA DETECTADA|${this.arrhythmiaCount}`;
    } else {
      arrhythmiaStatus = `SIN ARRITMIAS|${this.arrhythmiaCount}`;
    }

    const lastArrhythmiaData = this.arrhythmiaDetected
      ? { timestamp: now, rmssd: this.lastRMSSD, rrVariation: this.lastRRVariation }
      : null;

    return { arrhythmiaStatus, lastArrhythmiaData };
  }

  public reset(): void {
    this.rrIntervals = [];
    this.lastPeakTime = null;
    this.isLearning = true;
    this.arrhythmiaDetected = false;
    this.arrhythmiaCount = 0;
    this.measurementStartTime = Date.now();
    this.lastRMSSD = 0;
    this.lastRRVariation = 0;
    this.lastPNN50 = 0;
    this.lastEntropy = 0;
    this.lastTPR = 0;
    this.lastArrhythmiaTime = 0;
    this.baselineRMSSD = 0;
    this.baselineSamples = 0;
    this.onArrhythmiaDetection?.(false);
  }
}
