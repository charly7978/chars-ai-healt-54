/**
 * HEARTBEAT PROCESSOR - FUSIÓN TIEMPO + FRECUENCIA
 *
 * Mejoras:
 * 1. NO resetea buffers por fingerDetected — eso lo maneja el caller
 * 2. Fusión explícita: peak-domain dominante cuando morfología buena,
 *    spectral dominante cuando señal débil
 * 3. Scoring de candidatos de pico por prominencia + pendiente + consistencia RR
 * 4. Ventanas adaptativas: cortas para señal débil, largas para estable
 */
export class HeartBeatProcessor {
  private readonly MIN_PEAK_INTERVAL_MS = 330;
  private readonly MAX_PEAK_INTERVAL_MS = 2000;

  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  private readonly BUFFER_SIZE = 300;

  private lastPeakTime = 0;
  private peakThreshold = 4.0;
  private lastPeakValue = 0;

  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 30;
  private smoothBPM = 0;
  private frequencyBPM = 0;
  private periodicityScore = 0;

  private audioContext: AudioContext | null = null;
  private audioUnlocked = false;
  private lastBeepTime = 0;

  private frameCount = 0;
  private consecutivePeaks = 0;
  private signalQualityIndex = 0;

  constructor() {
    this.setupAudio();
  }

  private setupAudio() {
    const unlock = async () => {
      if (this.audioUnlocked) return;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();
        await this.audioContext.resume();
        this.audioUnlocked = true;
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  processSignal(filteredValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    sqi: number;
  } {
    this.frameCount++;
    const now = timestamp ?? Date.now();

    this.signalBuffer.push(filteredValue);
    this.timestampBuffer.push(now);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
      this.timestampBuffer.shift();
    }

    const derivative = this.calculateDerivative();
    this.derivativeBuffer.push(derivative);
    if (this.derivativeBuffer.length > this.BUFFER_SIZE) {
      this.derivativeBuffer.shift();
    }

    if (this.signalBuffer.length < 20) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0, sqi: 0 };
    }

    // === GATE: minimum signal energy to reject noise ===
    const recentForGate = this.signalBuffer.slice(-60);
    const gSorted = [...recentForGate].sort((a, b) => a - b);
    const gRange = (gSorted[Math.floor(gSorted.length * 0.9)] ?? 0) - (gSorted[Math.floor(gSorted.length * 0.1)] ?? 0);
    if (gRange < 0.5) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0, sqi: 0 };
    }

    // Adaptive window for normalization
    const windowLen = this.consecutivePeaks < 3 ? 90 : 150;
    const { normalizedValue, range } = this.normalizeSignal(filteredValue, windowLen);
    
    const periodicity = this.estimatePeriodicity();
    this.periodicityScore = periodicity.score;

    if (periodicity.bpm > 0) {
      this.frequencyBPM = this.frequencyBPM === 0
        ? periodicity.bpm
        : this.frequencyBPM * 0.82 + periodicity.bpm * 0.18;
    } else {
      this.frequencyBPM = this.frequencyBPM * 0.94;
    }

    this.updateThreshold(range, this.periodicityScore);
    this.signalQualityIndex = this.calculateSQI(range, this.periodicityScore);

    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : Number.MAX_SAFE_INTEGER;
    let isPeak = false;

    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeakWithScoring(timeSinceLastPeak);

      if (isPeak) {
        if (this.lastPeakTime > 0 && timeSinceLastPeak <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }

          const instantBPM = 60000 / timeSinceLastPeak;

          if (this.smoothBPM === 0) {
            this.smoothBPM = instantBPM;
          } else {
            const relativeDiff = Math.abs(instantBPM - this.smoothBPM) / Math.max(1, this.smoothBPM);
            let alpha = 0.25;
            if (relativeDiff > 0.30) alpha = 0.08;
            else if (relativeDiff > 0.18) alpha = 0.15;
            if (this.consecutivePeaks < 5) alpha = Math.max(0.06, alpha - 0.08);

            this.smoothBPM = this.smoothBPM * (1 - alpha) + instantBPM * alpha;
          }

          this.consecutivePeaks++;
        }

        this.lastPeakTime = now;
        this.vibrate();
        this.playBeep();
      }
    }

    if (!isPeak && this.lastPeakTime > 0 && timeSinceLastPeak > this.MAX_PEAK_INTERVAL_MS) {
      this.consecutivePeaks = Math.max(0, this.consecutivePeaks - 1);
    }

    // === FUSIÓN TIEMPO + FRECUENCIA ===
    // BLOCK: never show frequency-only BPM without at least 1 confirmed time-domain peak
    let displayBPM = this.smoothBPM;

    if (this.frequencyBPM > 0 && this.consecutivePeaks >= 3) {
      if (this.consecutivePeaks < 5 || this.signalQualityIndex < 35) {
        // Weak signal — blend with caution
        displayBPM = displayBPM * 0.65 + this.frequencyBPM * 0.35;
      } else {
        // Strong signal — trust peaks more
        displayBPM = displayBPM * 0.88 + this.frequencyBPM * 0.12;
      }
    }
    // If no peaks confirmed yet, displayBPM stays 0 — no guessing

    const confidence = this.calculateConfidence();

    return {
      bpm: displayBPM,
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: this.signalQualityIndex,
    };
  }

  private calculateDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    return (this.signalBuffer[n - 1] - this.signalBuffer[n - 3]) * 0.5 + (this.signalBuffer[n - 1] - this.signalBuffer[n - 2]) * 0.5;
  }

  private getRobustBounds(values: number[]): { low: number; high: number; range: number } {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 0) return { low: 0, high: 0, range: 0 };
    const low = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? sorted[0];
    const high = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? sorted[sorted.length - 1];
    return { low, high, range: Math.max(0, high - low) };
  }

  private normalizeSignal(value: number, windowLen: number = 150): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-windowLen);
    const { low, high, range } = this.getRobustBounds(recent);
    if (range < 0.15) return { normalizedValue: 0, range: 0 };
    const clipped = Math.min(high, Math.max(low, value));
    const normalizedValue = ((clipped - low) / range - 0.5) * 120;
    return { normalizedValue, range };
  }

  private normalizeWindow(values: number[], windowLen: number = 150): number[] {
    const refWindow = this.signalBuffer.slice(-windowLen);
    const { low, high, range } = this.getRobustBounds(refWindow);
    if (range < 0.15) return values.map(() => 0);
    return values.map((v) => {
      const c = Math.min(high, Math.max(low, v));
      return ((c - low) / range - 0.5) * 120;
    });
  }

  private estimateSampleRate(): number {
    if (this.timestampBuffer.length < 10) return 30;
    const recent = this.timestampBuffer.slice(-50);
    const intervals: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const d = recent[i] - recent[i - 1];
      if (d >= 10 && d <= 100) intervals.push(d);
    }
    if (intervals.length < 6) return 30;
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 33;
    return this.clamp(1000 / median, 20, 40);
  }

  private estimatePeriodicity(): { bpm: number; score: number } {
    if (this.signalBuffer.length < 60) return { bpm: 0, score: 0 };

    const sampleRate = this.estimateSampleRate();
    const windowLen = this.consecutivePeaks < 3 ? 120 : 180;
    const recentSignal = this.normalizeWindow(this.signalBuffer.slice(-windowLen), windowLen);
    const mean = recentSignal.reduce((s, v) => s + v, 0) / recentSignal.length;
    const centered = recentSignal.map((v) => v - mean);
    const energy = centered.reduce((s, v) => s + v * v, 0);

    if (energy < 1800) return { bpm: 0, score: 0 };

    const minLag = Math.max(5, Math.round((sampleRate * 60) / 200));
    const maxLag = Math.min(centered.length - 8, Math.round((sampleRate * 60) / 38));

    let bestLag = 0;
    let bestScore = 0;
    const expectedRR = this.getExpectedRR();
    const expectedLag = expectedRR > 0 ? Math.round((expectedRR / 1000) * sampleRate) : 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let cross = 0, eA = 0, eB = 0;
      for (let i = lag; i < centered.length; i++) {
        cross += centered[i] * centered[i - lag];
        eA += centered[i] ** 2;
        eB += centered[i - lag] ** 2;
      }
      if (eA === 0 || eB === 0) continue;

      const correlation = cross / Math.sqrt(eA * eB);
      const rhythmBias = expectedLag > 0
        ? 1 - Math.min(0.2, Math.abs(lag - expectedLag) / Math.max(1, expectedLag) * 0.12)
        : 1;
      const weighted = correlation * rhythmBias;

      if (weighted > bestScore) {
        bestScore = weighted;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestScore < 0.2) return { bpm: 0, score: Math.max(0, bestScore) };
    return { bpm: (60 * sampleRate) / bestLag, score: this.clamp(bestScore, 0, 1) };
  }

  private calculateSQI(range: number, periodicityScore: number): number {
    if (this.signalBuffer.length < 30) return 0;

    const rangeFactor = Math.min(1, range / 5) * 22;
    const derivWindow = this.derivativeBuffer.slice(-60);
    const meanAbsDeriv = derivWindow.length > 0
      ? derivWindow.reduce((s, v) => s + Math.abs(v), 0) / derivWindow.length
      : 0;
    const slopeFactor = Math.min(1, meanAbsDeriv / 1.0) * 14;

    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const m = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const v = this.rrIntervals.reduce((a, rr) => a + (rr - m) ** 2, 0) / this.rrIntervals.length;
      const cv = Math.sqrt(v) / Math.max(1, m);
      rrFactor = Math.max(0, 1 - cv * 2) * 22;
    }

    const peakFactor = Math.min(1, this.consecutivePeaks / 4) * 20;
    const periodicityFactor = periodicityScore * 22;

    return this.clamp(rangeFactor + slopeFactor + rrFactor + peakFactor + periodicityFactor, 0, 100);
  }

  private updateThreshold(range: number, periodicityScore: number): void {
    const base = periodicityScore > 0.35 ? 3.0 : 4.0;
    const target = this.clamp(base + range * 0.3, 2.5, 7.5);
    this.peakThreshold = this.peakThreshold * 0.8 + target * 0.2;
  }

  private getExpectedRR(): number {
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-6).sort((a, b) => a - b);
      return recent[Math.floor(recent.length / 2)] ?? recent[0] ?? 0;
    }
    if (this.frequencyBPM > 0) return 60000 / this.frequencyBPM;
    return 0;
  }

  // === PEAK DETECTION WITH CANDIDATE SCORING ===
  private detectPeakWithScoring(timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 11 || dn < 6) return false;

    const deriv = this.derivativeBuffer.slice(-6);
    const zeroCrossing = (deriv[2] > 0 && deriv[3] <= 0) || (deriv[3] > 0 && deriv[4] <= 0);

    const windowLen = this.consecutivePeaks < 3 ? 90 : 150;
    const recentNormalized = this.normalizeWindow(this.signalBuffer.slice(-11), windowLen);
    const ci = 5;
    const center = recentNormalized[ci];
    const neighborhoodMin = Math.min(...recentNormalized);
    const prominence = center - neighborhoodMin;

    const isLocalMax =
      center >= recentNormalized[4] &&
      center > recentNormalized[6] &&
      center >= recentNormalized[3] &&
      center >= recentNormalized[7];

    const risingSlope = center - recentNormalized[2];
    const fallingSlope = center - recentNormalized[8];
    const expectedRR = this.getExpectedRR();
    const nearExpected = expectedRR > 0 &&
      timeSinceLastPeak >= expectedRR * 0.55 &&
      timeSinceLastPeak <= expectedRR * 1.45;

    // === CANDIDATE SCORING ===
    let score = 0;

    // Prominence gate: reject flat noise but accept real PPG
    if (prominence < 2.2) return false;

    // Morphology gate: PPG has rising edge
    if (risingSlope < 0.8) return false;

    // Prominence (0-30 points)
    score += Math.min(30, prominence * 2.5);

    // Morphology: rising + falling slope (0-20 points)
    score += Math.min(10, risingSlope * 2.0);
    score += Math.min(10, fallingSlope * 1.8);

    // Zero crossing derivative (0-15 points)
    if (zeroCrossing) score += 15;

    // First peak: need periodic support (chicken-and-egg)
    if (this.consecutivePeaks === 0 && this.periodicityScore < 0.25 && !zeroCrossing) return false;

    // Rhythm consistency (0-20 points)
    if (nearExpected) score += 20;

    // Periodicity boost (0-15 points)
    score += this.periodicityScore * 15;

    // Threshold: require minimum score scaled by consecutive peaks
    const minScore = this.consecutivePeaks < 3 ? 36 : 42;
    const thresholdCheck = center > this.peakThreshold * (nearExpected ? 0.65 : 0.9) || prominence > Math.max(2.0, this.peakThreshold * 0.55);

    // Falling slope must also be positive for real PPG morphology
    if (fallingSlope < 0.35) return false;

    const amplitudeValid = this.lastPeakValue > 0
      ? (Math.abs(center) / Math.max(1, Math.abs(this.lastPeakValue))) > 0.08 && (Math.abs(center) / Math.max(1, Math.abs(this.lastPeakValue))) < 8
      : true;

    const isPeak = isLocalMax && amplitudeValid && timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS && score >= minScore && thresholdCheck;

    if (isPeak) {
      this.lastPeakValue = center;
    }

    return isPeak;
  }

  private calculateConfidence(): number {
    const sqiFactor = this.signalQualityIndex / 100;
    const peakSupport = Math.min(1, this.consecutivePeaks / 5);

    if (this.rrIntervals.length < 2) {
      return this.clamp(sqiFactor * 0.22 + peakSupport * 0.2 + this.periodicityScore * 0.3, 0, 0.6);
    }

    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((a, rr) => a + (rr - mean) ** 2, 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    const rrStability = this.clamp(1 - cv * 1.7, 0, 1);

    return this.clamp(rrStability * 0.32 + peakSupport * 0.24 + sqiFactor * 0.2 + this.periodicityScore * 0.24, 0, 1);
  }

  private vibrate(): void {
    try { if (navigator.vibrate) navigator.vibrate(55); } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 220) return;
    try {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.frequency.setValueAtTime(820, t);
      osc.frequency.exponentialRampToValueAtTime(460, t + 0.08);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.12);
      this.lastBeepTime = now;
    } catch {}
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  getRRIntervals(): number[] { return [...this.rrIntervals]; }
  getLastPeakTime(): number { return this.lastPeakTime; }
  getSQI(): number { return this.signalQualityIndex; }
  getDerivativeBuffer(): number[] { return [...this.derivativeBuffer]; }


  reset(): void {
    this.signalBuffer = [];
    this.derivativeBuffer = [];
    this.timestampBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.frequencyBPM = 0;
    this.periodicityScore = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 4.0;
    this.lastPeakValue = 0;
    this.frameCount = 0;
    this.consecutivePeaks = 0;
    this.signalQualityIndex = 0;
  }

  dispose(): void {
    if (this.audioContext) this.audioContext.close().catch(() => {});
  }
}
