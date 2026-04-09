/**
 * HEARTBEAT PROCESSOR — SRMAC-INSPIRED PEAK DETECTION
 *
 * Based on:
 * - SRMAC (Smoothed Recursive Moving Average Crossover) for real-time systolic peak detection
 * - Aboy++ adaptive HR estimation with windowed percentile thresholds
 * - Dual moving average crossover (fast/slow EMA) with refractory period
 *
 * Key principles:
 * 1. Fast EMA tracks signal closely, slow EMA tracks baseline
 * 2. Peak = fast crosses above slow (upward crossover) + local maximum confirmation
 * 3. Adaptive refractory period based on estimated HR
 * 4. Amplitude validation via rolling percentile thresholds
 * 5. No frequency-domain guessing without time-domain confirmation
 */
export class HeartBeatProcessor {
  // === PHYSIOLOGICAL LIMITS ===
  private readonly MIN_BPM = 30;
  private readonly MAX_BPM = 220;
  private readonly MIN_RR_MS = Math.round(60000 / 220); // ~273ms
  private readonly MAX_RR_MS = Math.round(60000 / 30);  // 2000ms

  // === SIGNAL BUFFERS ===
  private readonly BUFFER_SIZE = 512;
  private signalBuffer: number[] = [];
  private timestampBuffer: number[] = [];

  // === DUAL EMA (SRMAC core) ===
  private emaFast = 0;
  private emaSlow = 0;
  private readonly ALPHA_FAST = 0.25;  // slightly smoother to reduce noise-triggered crossovers
  private readonly ALPHA_SLOW = 0.055; // slightly smoother baseline
  private emaInitialized = false;

  // === PEAK STATE ===
  private lastPeakTime = 0;
  private lastPeakAmplitude = 0;
  private inUpswing = false;        // fast > slow
  private upswingPeakValue = -Infinity;
  private upswingPeakTime = 0;
  private upswingStartTime = 0;    // track upswing duration to reject noise spikes
  private refractoryMs = 330;       // adaptive refractory period

  // === RR INTERVAL TRACKING ===
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 40;
  private smoothBPM = 0;

  // === AMPLITUDE STATISTICS (Aboy++ inspired) ===
  private amplitudeWindow: number[] = [];
  private readonly AMP_WINDOW_SIZE = 200;
  private amplitudeP25 = 0;
  private amplitudeP75 = 0;

  // === QUALITY & CONFIDENCE ===
  private consecutiveValidPeaks = 0;
  private signalQualityIndex = 0;
  private frameCount = 0;

  // === AUDIO ===
  private audioContext: AudioContext | null = null;
  private audioUnlocked = false;
  private lastBeepTime = 0;

  constructor() {
    this.setupAudio();
  }

  private setupAudio(): void {
    const unlock = async () => {
      if (this.audioUnlocked) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AC();
        await this.audioContext.resume();
        this.audioUnlocked = true;
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
      } catch { /* silent */ }
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

    // Buffer management
    this.signalBuffer.push(filteredValue);
    this.timestampBuffer.push(now);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
      this.timestampBuffer.shift();
    }

    // Need minimum samples
    if (this.signalBuffer.length < 15) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0, sqi: 0 };
    }

    // === SIGNAL ENERGY GATE ===
    const recent60 = this.signalBuffer.slice(-60);
    const sorted60 = [...recent60].sort((a, b) => a - b);
    const p10 = sorted60[Math.floor(sorted60.length * 0.1)] ?? 0;
    const p90 = sorted60[Math.floor(sorted60.length * 0.9)] ?? 0;
    const dynamicRange = p90 - p10;
    if (dynamicRange < 0.12) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0, sqi: 0 };
    }

    // === NORMALIZE signal to [0,100] range using robust percentiles ===
    const normalizedValue = dynamicRange > 0 
      ? ((filteredValue - p10) / dynamicRange) * 100 
      : 50;
    const clampedValue = Math.max(0, Math.min(100, normalizedValue));

    // === UPDATE AMPLITUDE STATISTICS ===
    this.amplitudeWindow.push(clampedValue);
    if (this.amplitudeWindow.length > this.AMP_WINDOW_SIZE) {
      this.amplitudeWindow.shift();
    }
    this.updateAmplitudePercentiles();

    // === DUAL EMA CROSSOVER (SRMAC) ===
    if (!this.emaInitialized) {
      this.emaFast = clampedValue;
      this.emaSlow = clampedValue;
      this.emaInitialized = true;
    } else {
      this.emaFast = this.ALPHA_FAST * clampedValue + (1 - this.ALPHA_FAST) * this.emaFast;
      this.emaSlow = this.ALPHA_SLOW * clampedValue + (1 - this.ALPHA_SLOW) * this.emaSlow;
    }

    const crossoverDelta = this.emaFast - this.emaSlow;
    const wasInUpswing = this.inUpswing;
    this.inUpswing = crossoverDelta > 0;

    // Track maximum during upswing
    if (this.inUpswing && clampedValue > this.upswingPeakValue) {
      this.upswingPeakValue = clampedValue;
      this.upswingPeakTime = now;
    }

    let isPeak = false;
    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : Infinity;

    // === PEAK DETECTION: downward crossover after upswing ===
    if (wasInUpswing && !this.inUpswing && timeSinceLastPeak >= this.refractoryMs) {
      const peakValue = this.upswingPeakValue;
      const peakTime = this.upswingPeakTime;
      const upswingDuration = peakTime - this.upswingStartTime;

      // Reject noise spikes: real cardiac upswing lasts at least ~40ms
      if (upswingDuration >= 35 && this.validatePeak(peakValue, timeSinceLastPeak)) {
        isPeak = true;
        const peakInterval = this.lastPeakTime > 0 ? peakTime - this.lastPeakTime : 0;
        
        this.lastPeakTime = peakTime;
        this.lastPeakAmplitude = peakValue;

        if (peakInterval >= this.MIN_RR_MS && peakInterval <= this.MAX_RR_MS) {
          this.rrIntervals.push(peakInterval);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }
          this.updateBPM(peakInterval);
          this.consecutiveValidPeaks++;
        }

        this.updateRefractoryPeriod();
        this.vibrate();
        this.playBeep();
      }
    }

    // Reset upswing tracker on new upswing
    if (!wasInUpswing && this.inUpswing) {
      this.upswingPeakValue = clampedValue;
      this.upswingPeakTime = now;
      this.upswingStartTime = now;
    }

    // === Decay consecutive peaks if no peak for too long ===
    if (this.lastPeakTime > 0 && timeSinceLastPeak > this.MAX_RR_MS * 1.5) {
      this.consecutiveValidPeaks = Math.max(0, this.consecutiveValidPeaks - 1);
    }

    // === SIGNAL QUALITY INDEX ===
    this.signalQualityIndex = this.computeSQI(dynamicRange);

    // === CONFIDENCE ===
    const confidence = this.computeConfidence();

    // Only output BPM after sufficient confirmed peaks
    const displayBPM = this.consecutiveValidPeaks >= 2 ? this.smoothBPM : 0;

    return {
      bpm: displayBPM,
      confidence,
      isPeak,
      filteredValue: (clampedValue - 50) * 2.4, // scale for display
      arrhythmiaCount: 0, // arrhythmia handled by ArrhythmiaProcessor
      sqi: this.signalQualityIndex,
    };
  }

  /**
   * PEAK VALIDATION — Aboy++ inspired amplitude + morphology check
   */
  private validatePeak(peakValue: number, timeSinceLastPeak: number): boolean {
    // 1. Minimum amplitude: peak must be above 25th percentile + margin
    const amplitudeRange = this.amplitudeP75 - this.amplitudeP25;
    const minAmplitude = this.amplitudeP25 + amplitudeRange * 0.35;
    if (peakValue < minAmplitude) return false;

    // 2. Prominence: peak must stand out from slow EMA — adaptive threshold
    const prominence = peakValue - this.emaSlow;
    // Lower prominence for weak signals (small amplitude range), stricter for strong
    const minProminence = amplitudeRange > 20 
      ? Math.max(2.5, amplitudeRange * 0.12) 
      : Math.max(1.5, amplitudeRange * 0.08);
    if (prominence < minProminence) return false;

    // 3. Amplitude consistency: if we have a previous peak, check ratio
    if (this.lastPeakAmplitude > 0) {
      const ratio = peakValue / this.lastPeakAmplitude;
      if (ratio < 0.15 || ratio > 6) return false; // extreme amplitude change = artifact
    }

    // 4. RR consistency check — stricter with history
    if (this.rrIntervals.length >= 3) {
      const medianRR = this.getMedianRR();
      // Tight window: 50-165% of expected RR
      if (timeSinceLastPeak < medianRR * 0.50 || timeSinceLastPeak > medianRR * 1.65) {
        // Reject if we have moderate RR history
        if (this.rrIntervals.length >= 4 && this.consecutiveValidPeaks >= 3) {
          return false;
        }
      }
    }

    // 5. RR coherence: if we have ≥5 intervals, check that CV is not too high (reject random noise)
    if (this.rrIntervals.length >= 5) {
      const recent = this.rrIntervals.slice(-8);
      const meanRR = recent.reduce((a, b) => a + b, 0) / recent.length;
      const varRR = recent.reduce((a, rr) => a + (rr - meanRR) ** 2, 0) / recent.length;
      const cvRR = Math.sqrt(varRR) / Math.max(1, meanRR);
      // CV > 0.45 means intervals are too random — likely noise, not heartbeat
      if (cvRR > 0.45) {
        this.consecutiveValidPeaks = Math.max(0, this.consecutiveValidPeaks - 2);
        return false;
      }
    }

    return true;
  }

  /**
   * Adaptive refractory period based on current HR estimate
   */
  private updateRefractoryPeriod(): void {
    if (this.rrIntervals.length >= 2) {
      const medianRR = this.getMedianRR();
      // Refractory = 40% of median RR, clamped to physiological range
      this.refractoryMs = this.clamp(medianRR * 0.40, this.MIN_RR_MS * 0.9, 800);
    }
  }

  /**
   * BPM update with outlier-resistant smoothing
   */
  private updateBPM(interval: number): void {
    const instantBPM = 60000 / interval;
    
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
      return;
    }

    // Adaptive alpha: trust new value less when it deviates a lot
    const deviation = Math.abs(instantBPM - this.smoothBPM) / Math.max(1, this.smoothBPM);
    let alpha: number;
    if (deviation > 0.35) {
      alpha = 0.05; // large deviation → very slow update (likely artifact)
    } else if (deviation > 0.20) {
      alpha = 0.12;
    } else if (deviation > 0.10) {
      alpha = 0.22;
    } else {
      alpha = 0.30; // consistent → fast convergence
    }

    // Early peaks (building confidence): slower update
    if (this.consecutiveValidPeaks < 4) {
      alpha = Math.min(alpha, 0.15);
    }

    this.smoothBPM = this.smoothBPM * (1 - alpha) + instantBPM * alpha;
  }

  /**
   * Compute amplitude percentiles for adaptive thresholding
   */
  private updateAmplitudePercentiles(): void {
    if (this.amplitudeWindow.length < 30) return;
    const sorted = [...this.amplitudeWindow].sort((a, b) => a - b);
    const n = sorted.length;
    this.amplitudeP25 = sorted[Math.floor(n * 0.25)] ?? 0;
    this.amplitudeP75 = sorted[Math.floor(n * 0.75)] ?? 100;
  }

  private getMedianRR(): number {
    if (this.rrIntervals.length === 0) return 800;
    const recent = this.rrIntervals.slice(-8);
    const sorted = [...recent].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 800;
  }

  /**
   * Signal Quality Index — multi-factor assessment
   */
  private computeSQI(dynamicRange: number): number {
    // Factor 1: signal range (0-25 pts)
    const rangeFactor = Math.min(1, dynamicRange / 5) * 25;

    // Factor 2: RR interval regularity (0-30 pts)
    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-8);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((a, rr) => a + (rr - mean) ** 2, 0) / recent.length;
      const cv = Math.sqrt(variance) / Math.max(1, mean);
      rrFactor = Math.max(0, 1 - cv * 2.5) * 30;
    }

    // Factor 3: consecutive valid peaks (0-25 pts)
    const peakFactor = Math.min(1, this.consecutiveValidPeaks / 6) * 25;

    // Factor 4: sample rate consistency (0-20 pts)
    let sampleFactor = 0;
    if (this.timestampBuffer.length >= 10) {
      const recent = this.timestampBuffer.slice(-30);
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        const d = recent[i] - recent[i - 1];
        if (d > 5 && d < 150) intervals.push(d);
      }
      if (intervals.length >= 5) {
        const meanDt = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const dtVar = intervals.reduce((a, d) => a + (d - meanDt) ** 2, 0) / intervals.length;
        const dtCV = Math.sqrt(dtVar) / Math.max(1, meanDt);
        sampleFactor = Math.max(0, 1 - dtCV * 3) * 20;
      }
    }

    return this.clamp(rangeFactor + rrFactor + peakFactor + sampleFactor, 0, 100);
  }

  /**
   * Confidence in current BPM estimate
   */
  private computeConfidence(): number {
    if (this.rrIntervals.length < 2 || this.consecutiveValidPeaks < 2) {
      return this.clamp(
        (this.consecutiveValidPeaks / 5) * 0.3 + (this.signalQualityIndex / 100) * 0.2,
        0, 0.4
      );
    }

    const recent = this.rrIntervals.slice(-8);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, rr) => a + (rr - mean) ** 2, 0) / recent.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    const rrStability = this.clamp(1 - cv * 2, 0, 1);

    const peakSupport = Math.min(1, this.consecutiveValidPeaks / 6);
    const sqiFactor = this.signalQualityIndex / 100;

    return this.clamp(
      rrStability * 0.40 + peakSupport * 0.30 + sqiFactor * 0.30,
      0, 1
    );
  }

  // === AUDIO/HAPTIC ===
  private vibrate(): void {
    try { if (navigator.vibrate) navigator.vibrate(55); } catch { /* silent */ }
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
    } catch { /* silent */ }
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
  }

  // === PUBLIC API ===
  getRRIntervals(): number[] { return [...this.rrIntervals]; }
  getLastPeakTime(): number { return this.lastPeakTime; }
  getSQI(): number { return this.signalQualityIndex; }

  // Legacy stubs (no-op, arrhythmia handled externally)
  setArrhythmiaDetected(_: boolean): void {}
  setFingerDetected(_: boolean): void {}

  reset(): void {
    this.signalBuffer = [];
    this.timestampBuffer = [];
    this.amplitudeWindow = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.emaFast = 0;
    this.emaSlow = 0;
    this.emaInitialized = false;
    this.lastPeakTime = 0;
    this.lastPeakAmplitude = 0;
    this.inUpswing = false;
    this.upswingPeakValue = -Infinity;
    this.upswingPeakTime = 0;
    this.upswingStartTime = 0;
    this.refractoryMs = 330;
    this.consecutiveValidPeaks = 0;
    this.signalQualityIndex = 0;
    this.frameCount = 0;
  }

  dispose(): void {
    if (this.audioContext) this.audioContext.close().catch(() => {});
  }
}
