/**
 * PROCESADOR DE LATIDOS — ESTABILIDAD PRIORITARIA
 *
 * - Suavizado EMA de la entrada (menos jitter antes de derivar)
 * - Intervalos RR solo si son fisiológicos (~40–188 BPM)
 * - BPM a partir de mediana de RR válidos + suavizado fuerte
 * - Picos: cruce VPG descendente Y máximo local (menos falsos positivos)
 * - Confianza por dispersión robusta (MAD) de RR
 */

export class HeartBeatProcessor {
  private readonly MIN_PEAK_INTERVAL_MS = 270;
  private readonly MAX_PEAK_INTERVAL_MS = 2000;

  /** RR válidos ~40–188 BPM @ 30fps equivalente temporal */
  private readonly MIN_RR_MS = 300;
  private readonly MAX_RR_MS = 1650;

  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 180;

  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;

  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 12;
  private smoothBPM: number = 0;

  private inputEma: number = 0;
  private inputEmaReady = false;
  private readonly INPUT_EMA_ALPHA = 0.32;

  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;

  private frameCount: number = 0;
  private consecutiveValidBeats: number = 0;
  private lastPeakValue: number = 0;
  private signalQualityIndex: number = 0;

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

  private preprocessInput(filteredValue: number): number {
    if (!this.inputEmaReady) {
      this.inputEma = filteredValue;
      this.inputEmaReady = true;
      return filteredValue;
    }
    this.inputEma =
      this.INPUT_EMA_ALPHA * filteredValue + (1 - this.INPUT_EMA_ALPHA) * this.inputEma;
    return this.inputEma;
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
    const now = timestamp || Date.now();
    const smoothedIn = this.preprocessInput(filteredValue);

    this.signalBuffer.push(smoothedIn);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }

    const derivative = this.calculateDerivative();
    this.derivativeBuffer.push(derivative);
    if (this.derivativeBuffer.length > this.BUFFER_SIZE) {
      this.derivativeBuffer.shift();
    }

    if (this.signalBuffer.length < 36) {
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0,
        sqi: 0,
      };
    }

    const { normalizedValue, range } = this.normalizeSignal(smoothedIn);
    this.updateThreshold(range);
    this.signalQualityIndex = this.calculateSQI();

    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : Infinity;
    let isPeak = false;
    let peakForUi = false;

    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeakWithDerivative(timeSinceLastPeak);

      if (isPeak) {
        let acceptBeat = true;
        if (this.lastPeakTime > 0) {
          const rr = timeSinceLastPeak;
          if (rr < this.MIN_RR_MS || rr > this.MAX_RR_MS) {
            acceptBeat = false;
          } else {
            this.rrIntervals.push(rr);
            if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
              this.rrIntervals.shift();
            }
            this.updateBpmFromMedian();
            this.consecutiveValidBeats++;
          }
        }

        this.lastPeakTime = now;
        peakForUi = acceptBeat;

        if (acceptBeat) {
          this.vibrate();
          this.playBeep();
        }
      }
    }

    const confidence = this.calculateConfidence();

    return {
      bpm: this.smoothBPM,
      confidence,
      isPeak: peakForUi,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: this.signalQualityIndex,
    };
  }

  private updateBpmFromMedian(): void {
    const valid = this.rrIntervals.filter(
      (rr) => rr >= this.MIN_RR_MS && rr <= this.MAX_RR_MS
    );
    if (valid.length === 0) return;

    const sorted = [...valid].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianRr =
      sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;

    const medianBpm = 60000 / medianRr;

    if (this.smoothBPM <= 0) {
      this.smoothBPM = medianBpm;
      return;
    }

    const diff = Math.abs(medianBpm - this.smoothBPM) / this.smoothBPM;
    const alpha = diff > 0.12 ? 0.12 : diff > 0.06 ? 0.18 : 0.28;
    this.smoothBPM = this.smoothBPM * (1 - alpha) + medianBpm * alpha;
  }

  private calculateDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    const current = this.signalBuffer[n - 1];
    const older = this.signalBuffer[n - 3];
    return (current - older) / 2;
  }

  private calculateSQI(): number {
    if (this.signalBuffer.length < 60) return 0;

    const recent = this.signalBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;

    const rangeFactor = Math.min(1, range / 6) * 40;

    let rrFactor = 0;
    const validRr = this.rrIntervals.filter(
      (rr) => rr >= this.MIN_RR_MS && rr <= this.MAX_RR_MS
    );
    if (validRr.length >= 3) {
      const mean = validRr.reduce((a, b) => a + b, 0) / validRr.length;
      const variance =
        validRr.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / validRr.length;
      const cv = Math.sqrt(variance) / mean;
      rrFactor = Math.max(0, (1 - cv * 2.2)) * 35;
    }

    const beatFactor = Math.min(1, this.consecutiveValidBeats / 6) * 25;

    return Math.min(100, rangeFactor + rrFactor + beatFactor);
  }

  private normalizeSignal(value: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-120);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;

    if (range < 0.035) {
      return { normalizedValue: 0, range: 0 };
    }

    const normalizedValue = ((value - min) / range - 0.5) * 100;
    return { normalizedValue, range };
  }

  private updateThreshold(range: number): void {
    const newThreshold = Math.max(6, range * 0.22);
    this.peakThreshold = this.peakThreshold * 0.88 + newThreshold * 0.12;
  }

  private detectPeakWithDerivative(timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 8 || dn < 5) return false;

    const dPrev = this.derivativeBuffer[dn - 2];
    const dCurr = this.derivativeBuffer[dn - 1];
    const zeroCrossingDown = dPrev > 0 && dCurr <= 0;

    const slice = this.signalBuffer.slice(-120);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    const range = max - min;
    if (range < 0.035) return false;

    const norm = (v: number) => ((v - min) / range - 0.5) * 100;
    const tail = this.signalBuffer.slice(-7);
    const nv = tail.map(norm);

    const vPeak = nv[4];
    const isLocalMax =
      vPeak >= nv[3] &&
      vPeak >= nv[5] &&
      vPeak >= nv[2] &&
      vPeak >= nv[1] * 0.86;

    const aboveThreshold = vPeak > this.peakThreshold;

    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = vPeak / this.lastPeakValue;
      amplitudeValid = ratio > 0.25 && ratio < 4.0;
    }

    const risingBefore = vPeak - nv[1] > 0.4;
    const fallingAfter = vPeak - nv[6] > 0.18;

    const strictPeak =
      zeroCrossingDown &&
      isLocalMax &&
      aboveThreshold &&
      risingBefore &&
      fallingAfter &&
      timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS &&
      amplitudeValid;

    if (strictPeak) {
      this.lastPeakValue = vPeak;
    }

    return strictPeak;
  }

  private calculateConfidence(): number {
    const valid = this.rrIntervals.filter(
      (rr) => rr >= this.MIN_RR_MS && rr <= this.MAX_RR_MS
    );
    if (valid.length < 3) return 0;

    const sorted = [...valid].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;

    const mad =
      sorted.reduce((s, r) => s + Math.abs(r - median), 0) / sorted.length;
    const relative = mad / (median + 1e-6);

    return Math.max(0, Math.min(1, 1 - relative * 2.8));
  }

  private vibrate(): void {
    try {
      if (navigator.vibrate) navigator.vibrate(35);
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 280) return;

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.frequency.setValueAtTime(660, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.1);

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
    this.peakThreshold = 10;
    this.frameCount = 0;
    this.consecutiveValidBeats = 0;
    this.signalQualityIndex = 0;
    this.inputEmaReady = false;
    this.inputEma = 0;
    this.lastPeakValue = 0;
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
