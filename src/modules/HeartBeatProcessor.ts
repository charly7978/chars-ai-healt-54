export class HeartBeatProcessor {
  private readonly MIN_PEAK_INTERVAL_MS = 280;
  private readonly MAX_PEAK_INTERVAL_MS = 2200;

  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  private readonly BUFFER_SIZE = 240;

  private lastPeakTime = 0;
  private peakThreshold = 4.2;
  private lastPeakValue = 0;

  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 24;
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

    if (this.signalBuffer.length < 24) {
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0,
        sqi: 0,
      };
    }

    const { normalizedValue, range } = this.normalizeSignal(filteredValue);
    const periodicity = this.estimatePeriodicity();
    this.periodicityScore = periodicity.score;

    if (periodicity.bpm > 0) {
      this.frequencyBPM = this.frequencyBPM === 0
        ? periodicity.bpm
        : this.frequencyBPM * 0.84 + periodicity.bpm * 0.16;
    } else {
      this.frequencyBPM = this.frequencyBPM * 0.92;
    }

    this.updateThreshold(range, this.periodicityScore);
    this.signalQualityIndex = this.calculateSQI(range, this.periodicityScore);

    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : Number.MAX_SAFE_INTEGER;
    let isPeak = false;

    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeakWithDerivative(timeSinceLastPeak);

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
            let alpha = 0.34;

            if (relativeDiff > 0.35) alpha = 0.16;
            else if (relativeDiff > 0.2) alpha = 0.24;

            if (this.consecutivePeaks < 4) {
              alpha = Math.max(0.14, alpha - 0.06);
            }

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

    if ((this.smoothBPM === 0 || this.consecutivePeaks < 2) && this.frequencyBPM > 0) {
      this.smoothBPM = this.smoothBPM === 0
        ? this.frequencyBPM
        : this.smoothBPM * 0.88 + this.frequencyBPM * 0.12;
    }

    const confidence = this.calculateConfidence();
    let displayBPM = this.smoothBPM;

    if (this.frequencyBPM > 0) {
      if (displayBPM === 0) {
        displayBPM = this.frequencyBPM;
      } else if (this.consecutivePeaks < 3 || confidence < 0.38) {
        displayBPM = displayBPM * 0.6 + this.frequencyBPM * 0.4;
      } else {
        displayBPM = displayBPM * 0.84 + this.frequencyBPM * 0.16;
      }
    }

    if (this.frameCount % 60 === 0) {
      console.log(
        `📊 BPM=${displayBPM.toFixed(1)} Conf=${(confidence * 100).toFixed(0)}% ` +
        `SQI=${this.signalQualityIndex.toFixed(0)}% Peaks=${this.consecutivePeaks} ` +
        `Corr=${this.periodicityScore.toFixed(2)}`
      );
    }

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

    const current = this.signalBuffer[n - 1];
    const previous = this.signalBuffer[n - 2];
    const older = this.signalBuffer[n - 3];

    return (current - older) * 0.5 + (current - previous) * 0.5;
  }

  private getRobustBounds(values: number[]): { low: number; high: number; range: number } {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 0) {
      return { low: 0, high: 0, range: 0 };
    }

    const low = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? sorted[0];
    const high = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? sorted[sorted.length - 1];

    return {
      low,
      high,
      range: Math.max(0, high - low),
    };
  }

  private normalizeSignal(value: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-150);
    const { low, high, range } = this.getRobustBounds(recent);

    if (range < 0.18) {
      return { normalizedValue: 0, range: 0 };
    }

    const clipped = Math.min(high, Math.max(low, value));
    const normalizedValue = ((clipped - low) / range - 0.5) * 120;

    return { normalizedValue, range };
  }

  private normalizeWindow(values: number[]): number[] {
    const referenceWindow = this.signalBuffer.slice(-150);
    const { low, high, range } = this.getRobustBounds(referenceWindow);

    if (range < 0.18) {
      return values.map(() => 0);
    }

    return values.map((value) => {
      const clipped = Math.min(high, Math.max(low, value));
      return ((clipped - low) / range - 0.5) * 120;
    });
  }

  private estimateSampleRate(): number {
    if (this.timestampBuffer.length < 10) return 30;

    const recent = this.timestampBuffer.slice(-40);
    const intervals: number[] = [];

    for (let i = 1; i < recent.length; i++) {
      const delta = recent[i] - recent[i - 1];
      if (delta >= 12 && delta <= 80) {
        intervals.push(delta);
      }
    }

    if (intervals.length < 6) return 30;

    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 33;
    return this.clamp(1000 / median, 24, 36);
  }

  private estimatePeriodicity(): { bpm: number; score: number } {
    if (this.signalBuffer.length < 72) {
      return { bpm: 0, score: 0 };
    }

    const sampleRate = this.estimateSampleRate();
    const recentSignal = this.normalizeWindow(this.signalBuffer.slice(-180));
    const mean = recentSignal.reduce((sum, value) => sum + value, 0) / recentSignal.length;
    const centered = recentSignal.map((value) => value - mean);
    const energy = centered.reduce((sum, value) => sum + value * value, 0);

    if (energy < 1200) {
      return { bpm: 0, score: 0 };
    }

    const minLag = Math.max(6, Math.round((sampleRate * 60) / 180));
    const maxLag = Math.min(centered.length - 10, Math.round((sampleRate * 60) / 42));

    let bestLag = 0;
    let bestScore = 0;
    const expectedRR = this.getExpectedRR();
    const expectedLag = expectedRR > 0 ? Math.round((expectedRR / 1000) * sampleRate) : 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let cross = 0;
      let energyA = 0;
      let energyB = 0;

      for (let i = lag; i < centered.length; i++) {
        const a = centered[i];
        const b = centered[i - lag];
        cross += a * b;
        energyA += a * a;
        energyB += b * b;
      }

      if (energyA === 0 || energyB === 0) continue;

      const correlation = cross / Math.sqrt(energyA * energyB);
      const rhythmBias = expectedLag > 0
        ? 1 - Math.min(0.2, Math.abs(lag - expectedLag) / Math.max(1, expectedLag) * 0.12)
        : 1;
      const weightedScore = correlation * rhythmBias;

      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestScore < 0.18) {
      return { bpm: 0, score: Math.max(0, bestScore) };
    }

    return {
      bpm: (60 * sampleRate) / bestLag,
      score: this.clamp(bestScore, 0, 1),
    };
  }

  private calculateSQI(range: number, periodicityScore: number): number {
    if (this.signalBuffer.length < 40) return 0;

    const rangeFactor = Math.min(1, range / 6) * 24;

    const derivativeWindow = this.derivativeBuffer.slice(-60);
    const meanAbsDerivative = derivativeWindow.length > 0
      ? derivativeWindow.reduce((sum, value) => sum + Math.abs(value), 0) / derivativeWindow.length
      : 0;
    const slopeFactor = Math.min(1, meanAbsDerivative / 1.2) * 14;

    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / Math.max(1, mean);
      rrFactor = Math.max(0, 1 - cv * 2) * 22;
    }

    const peakFactor = Math.min(1, this.consecutivePeaks / 4) * 18;
    const periodicityFactor = periodicityScore * 22;

    return this.clamp(rangeFactor + slopeFactor + rrFactor + peakFactor + periodicityFactor, 0, 100);
  }

  private updateThreshold(range: number, periodicityScore: number): void {
    const baseThreshold = periodicityScore > 0.38 ? 3.4 : 4.2;
    const newThreshold = this.clamp(baseThreshold + range * 0.32, 2.8, 7.2);
    this.peakThreshold = this.peakThreshold * 0.82 + newThreshold * 0.18;
  }

  private getExpectedRR(): number {
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-5).sort((a, b) => a - b);
      return recent[Math.floor(recent.length / 2)] ?? recent[0] ?? 0;
    }

    if (this.frequencyBPM > 0) {
      return 60000 / this.frequencyBPM;
    }

    return 0;
  }

  private detectPeakWithDerivative(timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 11 || dn < 6) return false;

    const deriv = this.derivativeBuffer.slice(-6);
    const zeroCrossing =
      (deriv[2] > 0 && deriv[3] <= 0) ||
      (deriv[3] > 0 && deriv[4] <= 0);

    const recentNormalized = this.normalizeWindow(this.signalBuffer.slice(-11));
    const centerIndex = 5;
    const center = recentNormalized[centerIndex];
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
      timeSinceLastPeak >= expectedRR * 0.5 &&
      timeSinceLastPeak <= expectedRR * 1.55;

    const adaptiveThreshold = (nearExpected || this.periodicityScore > 0.4)
      ? this.peakThreshold * 0.8
      : this.peakThreshold;

    const aboveThreshold =
      center > adaptiveThreshold ||
      prominence > Math.max(1.3, adaptiveThreshold * 0.72);

    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;

    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = Math.abs(center) / Math.max(1, Math.abs(this.lastPeakValue));
      amplitudeValid = ratio > 0.06 && ratio < 10;
    }

    const morphologyValid = risingSlope > 0.75 && fallingSlope > 0.55 && prominence > 1.35;
    const derivativeAssist = zeroCrossing && prominence > 1.05;
    const rhythmAssist = nearExpected && zeroCrossing && prominence > 1.2;

    const isPeak =
      isLocalMax &&
      notTooSoon &&
      amplitudeValid &&
      ((aboveThreshold && (morphologyValid || derivativeAssist)) || rhythmAssist);

    if (isPeak) {
      this.lastPeakValue = center;
    }

    return isPeak;
  }

  private calculateConfidence(): number {
    const sqiFactor = this.signalQualityIndex / 100;
    const peakSupport = Math.min(1, this.consecutivePeaks / 5);

    if (this.rrIntervals.length < 2) {
      return this.clamp(
        sqiFactor * 0.24 + peakSupport * 0.18 + this.periodicityScore * 0.28,
        0,
        0.58
      );
    }

    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    const rrStability = this.clamp(1 - cv * 1.7, 0, 1);

    return this.clamp(
      rrStability * 0.34 + peakSupport * 0.22 + sqiFactor * 0.2 + this.periodicityScore * 0.24,
      0,
      1
    );
  }

  private vibrate(): void {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(60);
      }
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 220) return;

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

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

  getRRIntervals(): number[] {
    return [...this.rrIntervals];
  }

  getLastPeakTime(): number {
    return this.lastPeakTime;
  }

  getSQI(): number {
    return this.signalQualityIndex;
  }

  getDerivativeBuffer(): number[] {
    return [...this.derivativeBuffer];
  }

  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}

  reset(): void {
    this.signalBuffer = [];
    this.derivativeBuffer = [];
    this.timestampBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.frequencyBPM = 0;
    this.periodicityScore = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 4.2;
    this.lastPeakValue = 0;
    this.frameCount = 0;
    this.consecutivePeaks = 0;
    this.signalQualityIndex = 0;
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
