export class HeartBeatProcessor {
  private readonly MIN_PEAK_INTERVAL_MS = 280;
  private readonly MAX_PEAK_INTERVAL_MS = 2200;

  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 240;

  private lastPeakTime = 0;
  private peakThreshold = 4.5;
  private lastPeakValue = 0;

  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 24;
  private smoothBPM = 0;

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
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
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
    this.updateThreshold(range);
    this.signalQualityIndex = this.calculateSQI(range);

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
            let alpha = 0.32;

            if (relativeDiff > 0.35) alpha = 0.15;
            else if (relativeDiff > 0.2) alpha = 0.22;

            if (this.consecutivePeaks < 4) {
              alpha = Math.max(0.12, alpha - 0.05);
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

    const confidence = this.calculateConfidence();

    if (this.frameCount % 60 === 0) {
      console.log(`📊 BPM=${this.smoothBPM.toFixed(1)} Conf=${(confidence * 100).toFixed(0)}% SQI=${this.signalQualityIndex.toFixed(0)}% Peaks=${this.consecutivePeaks}`);
    }

    return {
      bpm: this.smoothBPM,
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

    if (range < 0.035) {
      return { normalizedValue: 0, range: 0 };
    }

    const clipped = Math.min(high, Math.max(low, value));
    const normalizedValue = ((clipped - low) / range - 0.5) * 120;

    return { normalizedValue, range };
  }

  private normalizeWindow(values: number[]): number[] {
    const { low, high, range } = this.getRobustBounds(this.signalBuffer.slice(-150));
    if (range < 0.035) {
      return values.map(() => 0);
    }

    return values.map((value) => {
      const clipped = Math.min(high, Math.max(low, value));
      return ((clipped - low) / range - 0.5) * 120;
    });
  }

  private calculateSQI(range: number): number {
    if (this.signalBuffer.length < 40) return 0;

    const rangeFactor = Math.min(1, range / 0.35) * 35;

    const derivativeWindow = this.derivativeBuffer.slice(-60);
    const meanAbsDerivative = derivativeWindow.length > 0
      ? derivativeWindow.reduce((sum, value) => sum + Math.abs(value), 0) / derivativeWindow.length
      : 0;
    const slopeFactor = Math.min(1, meanAbsDerivative / 0.08) * 15;

    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / Math.max(1, mean);
      rrFactor = Math.max(0, 1 - cv * 2) * 25;
    }

    const peakFactor = Math.min(1, this.consecutivePeaks / 4) * 25;

    return Math.min(100, rangeFactor + slopeFactor + rrFactor + peakFactor);
  }

  private updateThreshold(range: number): void {
    const newThreshold = Math.max(3.5, Math.min(10, 3.5 + range * 6));
    this.peakThreshold = this.peakThreshold * 0.82 + newThreshold * 0.18;
  }

  private detectPeakWithDerivative(timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 9 || dn < 6) return false;

    const deriv = this.derivativeBuffer.slice(-6);
    const zeroCrossing =
      (deriv[2] > 0 && deriv[3] <= 0) ||
      (deriv[3] > 0 && deriv[4] <= 0);

    const recentNormalized = this.normalizeWindow(this.signalBuffer.slice(-9));
    const center = recentNormalized[4];
    const neighborhoodMin = Math.min(...recentNormalized);
    const prominence = center - neighborhoodMin;

    const isLocalMax =
      center >= recentNormalized[3] &&
      center > recentNormalized[5] &&
      center >= recentNormalized[2] &&
      center >= recentNormalized[6];

    const risingSlope = center - recentNormalized[1];
    const fallingSlope = center - recentNormalized[7];
    const aboveThreshold = center > this.peakThreshold || prominence > this.peakThreshold * 0.9;
    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;

    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = Math.abs(center) / Math.max(1, Math.abs(this.lastPeakValue));
      amplitudeValid = ratio > 0.12 && ratio < 8;
    }

    const morphologyValid = risingSlope > 1.4 && fallingSlope > 1.1 && prominence > 2.2;
    const derivativeAssist = zeroCrossing && prominence > 1.8;

    const isPeak = isLocalMax && aboveThreshold && notTooSoon && amplitudeValid && (morphologyValid || derivativeAssist);

    if (isPeak) {
      this.lastPeakValue = center;
    }

    return isPeak;
  }

  private calculateConfidence(): number {
    const sqiFactor = this.signalQualityIndex / 100;
    const peakSupport = Math.min(1, this.consecutivePeaks / 5);

    if (this.rrIntervals.length < 2) {
      return Math.max(0, Math.min(0.35, sqiFactor * 0.2 + peakSupport * 0.15));
    }

    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    const rrStability = Math.max(0, Math.min(1, 1 - cv * 1.8));

    return Math.max(0, Math.min(1, rrStability * 0.45 + peakSupport * 0.25 + sqiFactor * 0.3));
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
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 4.5;
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
