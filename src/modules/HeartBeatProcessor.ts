/**
 * PROCESADOR DE LATIDOS — DETECCIÓN ROBUSTA
 *
 * Correcciones respecto a versión anterior:
 * 1. EMA de entrada reducido (α=0.08 → preserva picos, no los aplasta)
 * 2. Umbral adaptativo basado en amplitud reciente (no fijo)
 * 3. Detección de picos por cruce descendente de derivada + máximo local
 * 4. BPM por mediana de RR + suavizado conservador
 * 5. Confianza por dispersión MAD de intervalos RR
 *
 * Referencia: Han et al. 2022 (Waveform Envelope Peak Detection)
 */

export class HeartBeatProcessor {
  private readonly MIN_PEAK_INTERVAL_MS = 300;   // ~200 BPM max
  private readonly MAX_PEAK_INTERVAL_MS = 2000;  // ~30 BPM min

  private readonly MIN_RR_MS = 320;
  private readonly MAX_RR_MS = 1500;

  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 300;

  private lastPeakTime: number = 0;
  private peakThreshold: number = 0;
  private adaptiveThresholdHigh: number = 0;
  private adaptiveThresholdLow: number = 0;

  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 12;
  private smoothBPM: number = 0;

  private readonly INPUT_EMA_ALPHA = 0.15;
  private inputEma: number = 0;
  private inputEmaReady = false;

  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;

  private frameCount: number = 0;
  private consecutiveValidBeats: number = 0;
  private lastPeakAmplitude: number = 0;
  private signalQualityIndex: number = 0;

  // Consecutive physiologically consistent beats required before reporting BPM
  private readonly MIN_CONSECUTIVE_BEATS = 2;

  // Envelope tracking for adaptive threshold
  private envelopeMax: number = 0;
  private envelopeMin: number = 0;
  private readonly ENVELOPE_ALPHA = 0.02;
  
  // Low-quality frames counter for auto-reset
  private lowQualityFrames: number = 0;

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

  private preprocessInput(value: number): number {
    if (!this.inputEmaReady) {
      this.inputEma = value;
      this.inputEmaReady = true;
      return value;
    }
    // Suavizado MUY ligero — solo quita jitter de alta frecuencia
    this.inputEma = this.INPUT_EMA_ALPHA * value + (1 - this.INPUT_EMA_ALPHA) * this.inputEma;
    return this.inputEma;
  }

  processSignal(filteredValue: number, timestamp?: number, signalQuality?: number): {
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

    if (this.signalBuffer.length < 30) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0, sqi: 0 };
    }

    // ─── AUTO-RESET when signal quality is very low for >1s ───
    if (signalQuality !== undefined && signalQuality < 10) {
      this.lowQualityFrames++;
      if (this.lowQualityFrames > 30) { // ~1 second
        this.smoothBPM = 0;
        this.rrIntervals = [];
        this.consecutiveValidBeats = 0;
        this.lastPeakAmplitude = 0;
        return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0, sqi: 0 };
      }
    } else {
      this.lowQualityFrames = 0;
    }

    this.updateEnvelope(smoothedIn);

    const { normalizedValue, range } = this.normalizeSignal(smoothedIn);
    this.updateAdaptiveThreshold(range);
    this.signalQualityIndex = this.calculateSQI();

    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : Infinity;
    let isPeak = false;

    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeak(normalizedValue, timeSinceLastPeak);

      if (isPeak) {
        let acceptBeat = true;
        if (this.lastPeakTime > 0) {
          const rr = timeSinceLastPeak;
          if (rr < this.MIN_RR_MS || rr > this.MAX_RR_MS) {
            acceptBeat = false;
            this.consecutiveValidBeats = 0; // Reset on invalid interval
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

        // Only accept beat if we have enough consecutive valid beats
        if (acceptBeat && this.consecutiveValidBeats >= this.MIN_CONSECUTIVE_BEATS) {
          this.vibrate();
          this.playBeep();
        } else if (this.consecutiveValidBeats < this.MIN_CONSECUTIVE_BEATS) {
          acceptBeat = false; // Don't report as peak until pattern is established
        }

        // Only report BPM if we have enough consecutive beats
        const reportedBPM = this.consecutiveValidBeats >= this.MIN_CONSECUTIVE_BEATS ? this.smoothBPM : 0;

        return {
          bpm: reportedBPM,
          confidence: this.calculateConfidence(),
          isPeak: acceptBeat,
          filteredValue: normalizedValue,
          arrhythmiaCount: 0,
          sqi: this.signalQualityIndex,
        };
      }
    }

    const reportedBPM = this.consecutiveValidBeats >= this.MIN_CONSECUTIVE_BEATS ? this.smoothBPM : 0;

    return {
      bpm: reportedBPM,
      confidence: this.calculateConfidence(),
      isPeak: false,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: this.signalQualityIndex,
    };
  }

  /**
   * Detección de pico mejorada:
   * 1. Cruce descendente de la derivada (de positiva a ≤0)
   * 2. Valor actual por encima del umbral adaptativo
   * 3. Máximo local en ventana de 5 muestras
   * 4. Forma de onda plausible (subida previa + caída posterior)
   */
  private detectPeak(normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 7 || dn < 4) return false;

    // Zero-crossing of derivative (descending)
    const dPrev = this.derivativeBuffer[dn - 2];
    const dCurr = this.derivativeBuffer[dn - 1];
    const zeroCrossingDown = dPrev > 0 && dCurr <= 0;
    if (!zeroCrossingDown) return false;

    const slice = this.signalBuffer.slice(-120);
    const minS = Math.min(...slice);
    const maxS = Math.max(...slice);
    const rangeS = maxS - minS;
    
    // ─── MINIMUM RANGE THRESHOLD ───
    // Require meaningful signal range (not noise)
    if (rangeS < 0.3) return false;

    const norm = (v: number) => ((v - minS) / rangeS) * 100;
    const tail = this.signalBuffer.slice(-7).map(norm);

    const vPeak = tail[4];

    // Local maximum
    const isLocalMax = vPeak >= tail[3] && vPeak >= tail[5] && vPeak >= tail[2];
    if (!isLocalMax) return false;

    // Above adaptive threshold
    if (vPeak < this.adaptiveThresholdHigh) return false;

    // ─── MINIMUM ABSOLUTE AMPLITUDE ───
    // Peak must represent meaningful pulsatile amplitude
    if (vPeak < 10) return false;

    // Waveform shape: must have risen before and started falling after
    const risingBefore = vPeak - tail[1] > 0.35;
    const fallingAfter = vPeak - tail[6] > 0.15;
    if (!risingBefore || !fallingAfter) return false;

    // Amplitude consistency vs previous peak
    if (this.lastPeakAmplitude > 0) {
      const ratio = vPeak / this.lastPeakAmplitude;
      if (ratio < 0.2 || ratio > 5.0) return false;
    }

    this.lastPeakAmplitude = vPeak;
    return true;
  }

  private updateEnvelope(value: number): void {
    if (this.frameCount <= 1) {
      this.envelopeMax = value;
      this.envelopeMin = value;
      return;
    }
    this.envelopeMax = Math.max(value, this.envelopeMax * (1 - this.ENVELOPE_ALPHA) + value * this.ENVELOPE_ALPHA);
    this.envelopeMin = Math.min(value, this.envelopeMin * (1 - this.ENVELOPE_ALPHA) + value * this.ENVELOPE_ALPHA);
  }

  private updateAdaptiveThreshold(range: number): void {
    // Umbral alto: 35% del rango (para confirmar pico real)
    // Umbral bajo: usado para refractario
    this.adaptiveThresholdHigh = Math.max(8, range * 0.35) * 0.85 + this.adaptiveThresholdHigh * 0.15;
    this.adaptiveThresholdLow = this.adaptiveThresholdHigh * 0.5;
  }

  private updateBpmFromMedian(): void {
    const valid = this.rrIntervals.filter(rr => rr >= this.MIN_RR_MS && rr <= this.MAX_RR_MS);
    if (valid.length === 0) return;

    const sorted = [...valid].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianRr = sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

    const medianBpm = 60000 / medianRr;

    if (this.smoothBPM <= 0) {
      this.smoothBPM = medianBpm;
      return;
    }

    // Suavizado adaptativo: cambios grandes → más lento, cambios pequeños → más rápido
    const diff = Math.abs(medianBpm - this.smoothBPM) / this.smoothBPM;
    const alpha = diff > 0.15 ? 0.10 : diff > 0.08 ? 0.18 : 0.30;
    this.smoothBPM = this.smoothBPM * (1 - alpha) + medianBpm * alpha;
  }

  private calculateDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    return (this.signalBuffer[n - 1] - this.signalBuffer[n - 3]) / 2;
  }

  private calculateSQI(): number {
    if (this.signalBuffer.length < 60) return 0;

    const recent = this.signalBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;

    const rangeFactor = Math.min(1, range / 6) * 40;

    let rrFactor = 0;
    const validRr = this.rrIntervals.filter(rr => rr >= this.MIN_RR_MS && rr <= this.MAX_RR_MS);
    if (validRr.length >= 3) {
      const mean = validRr.reduce((a, b) => a + b, 0) / validRr.length;
      const variance = validRr.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / validRr.length;
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

    if (range < 0.05) {
      return { normalizedValue: 0, range: 0 };
    }

    const normalizedValue = ((value - min) / range - 0.5) * 100;
    return { normalizedValue, range };
  }

  private calculateConfidence(): number {
    const valid = this.rrIntervals.filter(rr => rr >= this.MIN_RR_MS && rr <= this.MAX_RR_MS);
    if (valid.length < 3) return 0;

    const sorted = [...valid].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

    const mad = sorted.reduce((s, r) => s + Math.abs(r - median), 0) / sorted.length;
    const relative = mad / (median + 1e-6);

    return Math.max(0, Math.min(1, 1 - relative * 2.5));
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

  getRRIntervals(): number[] { return [...this.rrIntervals]; }
  getLastPeakTime(): number { return this.lastPeakTime; }
  getSQI(): number { return this.signalQualityIndex; }
  getDerivativeBuffer(): number[] { return [...this.derivativeBuffer]; }

  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}

  reset(): void {
    this.signalBuffer = [];
    this.derivativeBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.adaptiveThresholdHigh = 0;
    this.adaptiveThresholdLow = 0;
    this.frameCount = 0;
    this.consecutiveValidBeats = 0;
    this.signalQualityIndex = 0;
    this.inputEmaReady = false;
    this.inputEma = 0;
    this.lastPeakAmplitude = 0;
    this.envelopeMax = 0;
    this.envelopeMin = 0;
    this.lowQualityFrames = 0;
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
