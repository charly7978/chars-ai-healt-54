import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface, ContactState } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

interface ROIMetrics {
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  coverageRatio: number;
  fingerScore: number;
}

/**
 * PPG SIGNAL PROCESSOR — Web Worker offloaded edition
 * 
 * Heavy computations (ROI extraction, autocorrelation, source ranking)
 * are dispatched to a dedicated Web Worker for zero-jank main thread.
 * 
 * Sensitivity MAXIMIZED: relaxed finger detection, lower PI gates,
 * faster contact acquisition.
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing = false;

  private bandpassFilter: BandpassFilter;

  private readonly BUFFER_SIZE = 300;
  private readonly ACDC_WINDOW = 180;

  // Buffers
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private vpgBuffer: number[] = [];
  private apgBuffer: number[] = [];
  private tileConfidence: number[] = new Array(25).fill(0);
  private frameIntervalBuffer: number[] = [];

  // AC/DC
  private redDC = 0;
  private redAC = 0;
  private greenDC = 0;
  private greenAC = 0;
  private blueDC = 0;
  private blueAC = 0;

  // Baselines
  private redBaseline = 0;
  private greenBaseline = 0;
  private blueBaseline = 0;
  private estimatedSampleRate = 30;
  private lastFrameTimestamp = 0;

  private frameCount = 0;
  private lastLogTime = 0;

  // === CONTACT STATE ===
  private contactState: ContactState = 'NO_CONTACT';
  private fingerDetected = false;
  private signalQuality = 0;
  private fingerConfidenceCount = 0;
  private fingerLostCount = 0;
  private stableContactCount = 0;
  private readonly FINGER_CONFIRM_FRAMES = 3;     // FASTER acquisition (was 5)
  private readonly FINGER_LOST_FRAMES = 120;       // MORE tolerance (was 90)
  private readonly STABLE_THRESHOLD = 20;           // FASTER stable (was 30)
  private readonly UNSTABLE_GRACE = 150;            // MORE grace (was 120)

  // Smoothing
  private smoothedRed = 0;
  private smoothedGreen = 0;
  private smoothedBlue = 0;
  private smoothedCoverage = 0;
  private smoothedFingerScore = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.08;          // Faster response (was 0.05)
  private readonly COVERAGE_SMOOTH_ALPHA = 0.10;     // Faster response (was 0.06)

  // Motion
  private motionScore = 0;
  private motionListenerActive = false;
  private lastAcceleration = { x: 0, y: 0, z: 0 };
  private readonly MOTION_THRESHOLD = 0.8;            // More tolerant (was 0.6)

  // Multi-source
  private sourceBuffers: { [key: string]: number[] } = {};
  private activeSource: string = 'RG';
  private sourceScores: { [key: string]: number } = {};
  private lastSourceSwitch = 0;
  private readonly SOURCE_HYSTERESIS_MS = 2000;

  // === WEB WORKER ===
  private worker: Worker | null = null;
  private workerReady = false;
  private pendingROI: ROIMetrics | null = null;
  private lastAutocorrScore = 0;
  private autocorrRequestPending = false;
  private rankRequestPending = false;
  private workerMsgId = 0;

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(this.estimatedSampleRate);
    this.sourceBuffers = { R: [], G: [], RG: [] };
    this.sourceScores = { R: 0, G: 0, RG: 0 };
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL('../../workers/ppg.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.worker.onmessage = (e) => this.handleWorkerMessage(e.data);
      this.worker.onerror = () => { this.workerReady = false; };
      this.workerReady = true;
    } catch {
      // Fallback: run inline if Worker not supported
      this.workerReady = false;
    }
  }

  private handleWorkerMessage(msg: any): void {
    switch (msg.type) {
      case 'roiResult':
        this.pendingROI = {
          rawRed: msg.rawRed,
          rawGreen: msg.rawGreen,
          rawBlue: msg.rawBlue,
          coverageRatio: msg.coverageRatio,
          fingerScore: msg.fingerScore,
        };
        if (msg.updatedTileConfidence) {
          this.tileConfidence = msg.updatedTileConfidence;
        }
        break;
      case 'autocorrResult':
        this.lastAutocorrScore = msg.score;
        this.autocorrRequestPending = false;
        break;
      case 'rankResult':
        this.rankRequestPending = false;
        if (msg.bestSource !== this.activeSource) {
          this.activeSource = msg.bestSource;
          this.lastSourceSwitch = Date.now();
        }
        if (msg.scores) {
          this.sourceScores = msg.scores;
        }
        break;
    }
  }

  async initialize(): Promise<void> {
    this.reset();
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    this.startMotionListener();
  }

  stop(): void {
    this.isProcessing = false;
    this.stopMotionListener();
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  processFrame(imageData: ImageData, frameTimestamp?: number): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = frameTimestamp ?? Date.now();
    this.updateSampleRate(timestamp);

    // Dispatch ROI to worker or compute inline
    const roi = this.extractROIFast(imageData);
    this.dispatchROIToWorker(imageData);

    this.updateContactState(roi);

    const motionArtifact = this.motionScore > this.MOTION_THRESHOLD;

    if (this.contactState === 'NO_CONTACT') {
      this.signalQuality = 0;
      this.onSignalReady({
        timestamp,
        rawValue: 0,
        filteredValue: 0,
        quality: 0,
        fingerDetected: false,
        contactState: 'NO_CONTACT',
        motionArtifact,
        roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
        perfusionIndex: 0,
        rawRed: roi.rawRed,
        rawGreen: roi.rawGreen,
        diagnostics: {
          message: `BUSCANDO DEDO C:${(roi.coverageRatio * 100).toFixed(0)}%`,
          hasPulsatility: false,
          pulsatilityValue: 0,
        },
      });
      return;
    }

    this.updateChannelBaselines(roi.rawRed, roi.rawGreen, roi.rawBlue, motionArtifact);

    this.redBuffer.push(roi.rawRed);
    this.greenBuffer.push(roi.rawGreen);
    this.blueBuffer.push(roi.rawBlue);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }

    if (this.redBuffer.length >= 30) {
      this.calculateACDCPrecise();
    }

    const pulseSource = this.extractBestPulseSignal(roi.rawRed, roi.rawGreen, roi.rawBlue, motionArtifact);

    this.rawBuffer.push(pulseSource.value);
    if (this.rawBuffer.length > this.BUFFER_SIZE) this.rawBuffer.shift();

    const filtered = this.bandpassFilter.filter(pulseSource.value);
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) this.filteredBuffer.shift();

    this.calculateDerivatives();

    // Dispatch autocorrelation to worker every ~60 frames (~2s)
    if (this.frameCount % 60 === 0 && this.filteredBuffer.length >= 45 && !this.autocorrRequestPending) {
      this.dispatchAutocorrelation();
    }

    this.signalQuality = this.calculateSignalQuality();

    const gatedQuality = motionArtifact
      ? Math.max(0, this.signalQuality * 0.80)  // less penalty (was 0.75)
      : this.signalQuality;

    const pi = this.calculatePerfusionIndex();
    const now = Date.now();
    if (now - this.lastLogTime >= 2000) {
      this.lastLogTime = now;
      console.log(
        `📷 PPG [${pulseSource.label}] Filt=${filtered.toFixed(3)} ` +
        `Q=${gatedQuality.toFixed(0)}% PI=${pi.toFixed(2)} ` +
        `Contact=${this.contactState} FPS=${this.estimatedSampleRate.toFixed(0)}`
      );
    }

    this.onSignalReady({
      timestamp,
      rawValue: pulseSource.value,
      filteredValue: filtered,
      quality: gatedQuality,
      fingerDetected: this.fingerDetected,
      contactState: this.contactState,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex: pi,
      rawRed: roi.rawRed,
      rawGreen: roi.rawGreen,
      diagnostics: {
        message:
          `${pulseSource.label}:${pulseSource.strength.toFixed(1)} ` +
          `PI:${pi.toFixed(2)} C:${(this.smoothedCoverage * 100).toFixed(0)} ` +
          `${this.contactState}${motionArtifact ? ' MOV' : ''}`,
        hasPulsatility:
          (this.contactState === 'STABLE_CONTACT' || this.contactState === 'UNSTABLE_CONTACT') &&
          gatedQuality >= 6 &&             // LOWER threshold (was 10)
          pulseSource.strength > 0.3,      // LOWER threshold (was 0.5)
        pulsatilityValue: Math.max(pi, pulseSource.strength * 0.02),
      },
    });
  }

  // === FAST ROI (main thread — lightweight version using worker result or inline) ===
  private extractROIFast(imageData: ImageData): ROIMetrics {
    // Use worker result if available
    if (this.pendingROI) {
      const roi = this.pendingROI;
      this.pendingROI = null;
      return roi;
    }
    // Fallback: ultra-fast center sampling (no tiles, just center 50%)
    return this.extractROICenterFast(imageData);
  }

  private extractROICenterFast(imageData: ImageData): ROIMetrics {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const cx = w >> 1, cy = h >> 1;
    const sz = Math.min(w, h) * 0.4;
    const x0 = Math.floor(cx - sz / 2);
    const y0 = Math.floor(cy - sz / 2);
    const x1 = Math.floor(cx + sz / 2);
    const y1 = Math.floor(cy + sz / 2);

    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let y = y0; y < y1; y += 4) {
      for (let x = x0; x < x1; x += 4) {
        const i = (y * w + x) * 4;
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }
    }

    if (count === 0) return { rawRed: 0, rawGreen: 0, rawBlue: 0, coverageRatio: 0, fingerScore: 0 };

    const r = rSum / count;
    const g = gSum / count;
    const b = bSum / count;
    const redDom = r - (g + b) / 2;
    const rgRatio = r / Math.max(1, g);
    const isFinger = r > 50 && redDom > 5 && rgRatio > 1.05;

    return {
      rawRed: r,
      rawGreen: g,
      rawBlue: b,
      coverageRatio: isFinger ? 0.7 : 0.1,
      fingerScore: isFinger ? Math.min(1, (redDom - 5) / 40) : 0,
    };
  }

  private dispatchROIToWorker(imageData: ImageData): void {
    if (!this.workerReady || !this.worker) return;
    // Only dispatch every 2nd frame to reduce worker pressure
    if (this.frameCount % 2 !== 0) return;

    const pixels = imageData.data;
    this.worker.postMessage({
      type: 'extractROI',
      id: ++this.workerMsgId,
      pixels,
      width: imageData.width,
      height: imageData.height,
      tileConfidence: this.tileConfidence,
    });
  }

  private dispatchAutocorrelation(): void {
    if (!this.workerReady || !this.worker) {
      // Inline fallback
      const recent = this.filteredBuffer.slice(-90);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      this.lastAutocorrScore = this.computeAutocorrelationInline(recent, mean);
      return;
    }
    this.autocorrRequestPending = true;
    const recent = this.filteredBuffer.slice(-90);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    this.worker.postMessage({
      type: 'autocorrelation',
      id: ++this.workerMsgId,
      signal: recent,
      mean,
      sampleRate: this.estimatedSampleRate,
    });
  }

  // === CONTACT STATE — MORE SENSITIVE ===
  private updateContactState(roi: ROIMetrics): void {
    const previousState = this.contactState;
    const instantDetected = this.detectFingerInstant(roi);

    if (instantDetected) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1.5, 100); // Faster ramp (was +1)
      this.stableContactCount++;

      if (this.fingerConfidenceCount >= this.FINGER_CONFIRM_FRAMES) {
        this.fingerDetected = true;
        const perfusion = this.calculatePerfusionIndex();
        this.contactState = (this.stableContactCount >= this.STABLE_THRESHOLD && perfusion > 0.001)
          ? 'STABLE_CONTACT'
          : 'UNSTABLE_CONTACT';
      }
    } else {
      this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 0.3); // Slower decay (was 0.5)
      this.fingerLostCount++;
      this.stableContactCount = Math.max(0, this.stableContactCount - 0.2); // Slower decay (was 0.3)

      if (this.fingerDetected) {
        const softHold =
          this.smoothedCoverage > 0.10 &&
          (this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2) > 5 &&
          this.smoothedFingerScore > 0.12 &&
          (this.smoothedRed / Math.max(1, this.smoothedGreen)) > 1.03;

        if (softHold || this.fingerLostCount < this.FINGER_LOST_FRAMES) {
          this.contactState = 'UNSTABLE_CONTACT';
        } else if (this.fingerLostCount < this.UNSTABLE_GRACE) {
          this.contactState = 'UNSTABLE_CONTACT';
        } else {
          this.contactState = 'NO_CONTACT';
          this.fingerDetected = false;
          this.stableContactCount = 0;
          this.resetSignalTrackingBuffers();
          this.resetBaselines();
        }
      } else {
        this.contactState = 'NO_CONTACT';
      }
    }

    if (previousState === 'NO_CONTACT' && this.contactState !== 'NO_CONTACT') {
      this.resetSignalTrackingBuffers();
    }
  }

  private detectFingerInstant(roi: ROIMetrics): boolean {
    const { rawRed, rawGreen, rawBlue, coverageRatio, fingerScore } = roi;

    if (this.smoothedRed === 0) {
      this.smoothedRed = rawRed;
      this.smoothedGreen = rawGreen;
      this.smoothedBlue = rawBlue;
      this.smoothedCoverage = coverageRatio;
      this.smoothedFingerScore = fingerScore;
    } else {
      const a = this.RGB_SMOOTH_ALPHA;
      const ca = this.COVERAGE_SMOOTH_ALPHA;
      this.smoothedRed = this.smoothedRed * (1 - a) + rawRed * a;
      this.smoothedGreen = this.smoothedGreen * (1 - a) + rawGreen * a;
      this.smoothedBlue = this.smoothedBlue * (1 - a) + rawBlue * a;
      this.smoothedCoverage = this.smoothedCoverage * (1 - ca) + coverageRatio * ca;
      this.smoothedFingerScore = this.smoothedFingerScore * (1 - ca) + fingerScore * ca;
    }

    const r = this.smoothedRed;
    const g = this.smoothedGreen;
    const b = this.smoothedBlue;
    const totalIntensity = r + g + b;
    const redDominance = r - (g + b) / 2;
    const rgRatio = r / Math.max(1, g);
    const notBlownOut = !(r > 253 && g > 252 && b > 252);

    if (this.fingerDetected) {
      // MAINTAIN — very relaxed
      return r > 40 &&
        rgRatio > 1.05 &&
        redDominance > 5 &&
        this.smoothedCoverage > 0.10 &&
        this.smoothedFingerScore > 0.10 &&
        notBlownOut;
    } else {
      // ACQUIRE — relaxed for faster detection
      return r > 60 &&
        rgRatio > 1.12 &&
        redDominance > 12 &&
        totalIntensity > 100 && totalIntensity < 760 &&
        this.smoothedCoverage > 0.20 &&
        this.smoothedFingerScore > 0.25 &&
        this.motionScore < 2.0 &&
        notBlownOut;
    }
  }

  private updateSampleRate(timestamp: number): void {
    if (this.lastFrameTimestamp === 0) {
      this.lastFrameTimestamp = timestamp;
      return;
    }

    const delta = timestamp - this.lastFrameTimestamp;
    this.lastFrameTimestamp = timestamp;

    if (delta < 10 || delta > 100) return;

    this.frameIntervalBuffer.push(delta);
    if (this.frameIntervalBuffer.length > 30) this.frameIntervalBuffer.shift();
    if (this.frameIntervalBuffer.length < 8) return;

    const sorted = [...this.frameIntervalBuffer].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 33;
    const estimatedFps = this.clamp(1000 / median, 20, 40);

    this.estimatedSampleRate = this.estimatedSampleRate * 0.85 + estimatedFps * 0.15;
  }

  private updateChannelBaselines(rawRed: number, rawGreen: number, rawBlue: number, motionArtifact: boolean): void {
    if (this.redBaseline === 0) {
      this.redBaseline = rawRed;
      this.greenBaseline = rawGreen;
      this.blueBaseline = rawBlue;
      return;
    }

    const alpha = motionArtifact ? 0.008 : this.contactState === 'STABLE_CONTACT' ? 0.02 : 0.04;
    this.redBaseline = this.redBaseline * (1 - alpha) + rawRed * alpha;
    this.greenBaseline = this.greenBaseline * (1 - alpha) + rawGreen * alpha;
    this.blueBaseline = this.blueBaseline * (1 - alpha) + rawBlue * alpha;
  }

  // === MULTI-SOURCE EXTRACTION ===
  private extractBestPulseSignal(
    rawRed: number, rawGreen: number, rawBlue: number, motionArtifact: boolean
  ): { value: number; label: string; strength: number } {
    const rNorm = this.redBaseline > 0 ? (this.redBaseline - rawRed) / this.redBaseline : 0;
    const gNorm = this.greenBaseline > 0 ? (this.greenBaseline - rawGreen) / this.greenBaseline : 0;

    const clamp = (v: number) => this.clamp(v, -0.08, 0.08); // Wider clamp (was 0.07)
    const rPulse = clamp(rNorm);
    const gPulse = clamp(gNorm);

    // More aggressive adaptive gain for weak signals
    const pulseEnergy = Math.max(Math.abs(rPulse), Math.abs(gPulse));
    const adaptiveGain = pulseEnergy < 0.003 ? 6000 : pulseEnergy < 0.008 ? 5000 : pulseEnergy < 0.015 ? 4200 : 3200;

    const sources: { [key: string]: number } = {
      R: rPulse * adaptiveGain,
      G: gPulse * adaptiveGain,
      RG: this.blendRG(rPulse, gPulse, rawRed, rawGreen, motionArtifact) * adaptiveGain,
    };

    for (const key of Object.keys(sources)) {
      this.sourceBuffers[key].push(sources[key]);
      if (this.sourceBuffers[key].length > 120) this.sourceBuffers[key].shift();
    }

    // Dispatch ranking to worker every ~30 frames
    if (this.frameCount % 30 === 0 && this.redBuffer.length >= 50 && !this.rankRequestPending) {
      this.dispatchSourceRanking();
    }

    const value = this.clamp(sources[this.activeSource] ?? sources['RG'], -100, 100);
    const strength = Math.max(Math.abs(rPulse), Math.abs(gPulse)) * 1000;

    return { value, label: this.activeSource, strength };
  }

  private dispatchSourceRanking(): void {
    if (this.workerReady && this.worker) {
      this.rankRequestPending = true;
      this.worker.postMessage({
        type: 'rankSources',
        id: ++this.workerMsgId,
        sourceBuffers: this.sourceBuffers,
        activeSource: this.activeSource,
        currentScore: this.sourceScores[this.activeSource] ?? 0,
      });
    } else {
      this.rankSourcesInline();
    }
  }

  private rankSourcesInline(): void {
    const now = Date.now();
    if (now - this.lastSourceSwitch < this.SOURCE_HYSTERESIS_MS) return;

    let bestSource = this.activeSource;
    let bestScore = -1;

    for (const key of Object.keys(this.sourceBuffers)) {
      const buf = this.sourceBuffers[key];
      if (buf.length < 40) continue;
      const recent = buf.slice(-90);
      const sorted = [...recent].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
      const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
      const range = p90 - p10;
      if (range < 0.08) { this.sourceScores[key] = 0; continue; }
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((a, v) => a + (v - mean) ** 2, 0) / recent.length;
      const snr = range / (Math.sqrt(variance) + 0.1);
      const clipped = recent.filter(v => Math.abs(v) > 70).length / recent.length;
      this.sourceScores[key] = Math.max(0, snr * 15 - clipped * 30);
      if (this.sourceScores[key] > bestScore) { bestScore = this.sourceScores[key]; bestSource = key; }
    }

    const currentScore = this.sourceScores[this.activeSource] ?? 0;
    if (bestSource !== this.activeSource && bestScore > currentScore * 1.2) {
      this.activeSource = bestSource;
      this.lastSourceSwitch = now;
    }
  }

  private blendRG(rPulse: number, gPulse: number, rawRed: number, rawGreen: number, motionArtifact: boolean): number {
    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;
    const piSum = redPI + greenPI;

    let greenWeight = 0.55;
    let redWeight = 0.45;

    if (piSum > 0) {
      greenWeight = this.clamp(greenPI / piSum, 0.25, 0.8);
      redWeight = 1 - greenWeight;
    }

    if (rawGreen > 245) { greenWeight *= 0.4; redWeight = 1 - greenWeight; }
    if (rawRed > 245) { redWeight *= 0.4; greenWeight = 1 - redWeight; }
    if (motionArtifact) { greenWeight = this.clamp(greenWeight + 0.05, 0.3, 0.8); redWeight = 1 - greenWeight; }

    return rPulse * redWeight + gPulse * greenWeight;
  }

  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 30) return;

    const redW = this.redBuffer.slice(-windowSize);
    const greenW = this.greenBuffer.slice(-windowSize);
    const blueW = this.blueBuffer.slice(-windowSize);

    this.redDC = redW.reduce((a, b) => a + b, 0) / redW.length;
    this.greenDC = greenW.reduce((a, b) => a + b, 0) / greenW.length;
    this.blueDC = blueW.reduce((a, b) => a + b, 0) / blueW.length;

    if (this.redDC < 3 || this.greenDC < 3) return; // Lower threshold (was 5)

    const computeAC = (window: number[], dc: number) => {
      let sumSq = 0;
      for (let i = 0; i < window.length; i++) sumSq += (window[i] - dc) ** 2;
      const rms = Math.sqrt(sumSq / window.length);
      const sorted = [...window].sort((a, b) => a - b);
      const p5 = sorted[Math.floor(window.length * 0.05)] ?? 0;
      const p95 = sorted[Math.floor(window.length * 0.95)] ?? 0;
      const p2p = p95 - p5;
      return (rms * Math.sqrt(2) + p2p * 0.5) / 2;
    };

    this.redAC = computeAC(redW, this.redDC);
    this.greenAC = computeAC(greenW, this.greenDC);
    this.blueAC = computeAC(blueW, this.blueDC);

    // Remove overly aggressive zero-out (was 0.0001)
    const redPI = this.redAC / this.redDC;
    const greenPI = this.greenAC / this.greenDC;
    if (redPI < 0.00001 && greenPI < 0.00001) {
      this.redAC = 0;
      this.greenAC = 0;
    }
  }

  private calculateDerivatives(): void {
    const n = this.filteredBuffer.length;
    if (n >= 3) {
      const vpg = (this.filteredBuffer[n - 1] - this.filteredBuffer[n - 3]) / 2;
      this.vpgBuffer.push(vpg);
      if (this.vpgBuffer.length > this.BUFFER_SIZE) this.vpgBuffer.shift();
    }
    if (this.vpgBuffer.length >= 3) {
      const vn = this.vpgBuffer.length;
      const apg = (this.vpgBuffer[vn - 1] - this.vpgBuffer[vn - 3]) / 2;
      this.apgBuffer.push(apg);
      if (this.apgBuffer.length > this.BUFFER_SIZE) this.apgBuffer.shift();
    }
  }

  // === SQI — USES WORKER AUTOCORRELATION RESULT ===
  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 20) return 0;
    if (this.contactState === 'NO_CONTACT') return 0;

    const perfusionIndex = this.calculatePerfusionIndex();
    const redDominance = this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2;

    // Much softer gates for early signal
    if (perfusionIndex < 0.02) return Math.min(12, this.smoothedCoverage * 18); // (was PI < 0.04, max 8)
    if (redDominance < 4) return Math.min(10, perfusionIndex * 5);              // (was redDom < 8, max 6)

    const recent = this.filteredBuffer.slice(-90);
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? 0;
    const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
    const range = p90 - p10;

    if (range < 0.1) return 8; // (was range < 0.2, returned 5)

    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, v) => a + (v - mean) ** 2, 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    const snr = range / (stdDev + 0.1); // Lower denominator bias (was 0.15)

    // Use cached autocorrelation score from worker
    const periodicityScore = this.lastAutocorrScore;

    const snrScore = Math.min(32, snr * 14);          // More generous (was 30, *12)
    const perfusionScore = Math.min(22, perfusionIndex * 15); // More generous (was 20, *12)
    const coverageScore = Math.min(12, this.smoothedCoverage * 20);
    const fingerScore = Math.min(10, this.smoothedFingerScore * 16);
    const motionPenalty = Math.min(15, this.motionScore * 12); // Less penalty (was 20, *16)
    const periodicityPts = Math.min(28, periodicityScore * 28);

    const stabilityBonus = this.contactState === 'STABLE_CONTACT' ? 6 : 2; // Bonus even for UNSTABLE (was 0)

    return this.clamp(
      snrScore + perfusionScore + coverageScore + fingerScore + periodicityPts - motionPenalty + stabilityBonus,
      0, 100
    );
  }

  // Inline fallback for autocorrelation when worker is not available
  private computeAutocorrelationInline(signal: number[], mean: number): number {
    const n = signal.length;
    if (n < 40) return 0;
    const fs = this.estimatedSampleRate;
    const minLag = Math.max(2, Math.floor(fs * 60 / 210));
    const maxLag = Math.min(Math.floor(n * 0.6), Math.floor(fs * 60 / 30));
    if (minLag >= maxLag || maxLag >= n) return 0;

    let variance = 0;
    for (let i = 0; i < n; i++) variance += (signal[i] - mean) ** 2;
    if (variance < 1e-6) return 0;

    let bestCorr = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += (signal[i] - mean) * (signal[i + lag] - mean);
      const r = sum / variance;
      if (r > bestCorr) { bestCorr = r; bestLag = lag; }
    }

    let harmonicBonus = 0;
    if (bestLag > 0 && bestCorr > 0.12) {
      const dLag = bestLag * 2;
      if (dLag < n) {
        let s2 = 0;
        for (let i = 0; i < n - dLag; i++) s2 += (signal[i] - mean) * (signal[i + dLag] - mean);
        if (s2 / variance > 0.08) harmonicBonus = 0.15;
      }
    }

    const raw = this.clamp(bestCorr + harmonicBonus, 0, 1);
    return this.clamp((raw - 0.10) / 0.55, 0, 1);
  }

  private calculatePerfusionIndex(): number {
    const greenPI = this.greenDC > 20 ? (this.greenAC / this.greenDC) * 100 : 0; // Lower DC threshold (was 30)
    const redPI = this.redDC > 20 ? (this.redAC / this.redDC) * 100 : 0;
    const candidate = Math.max(greenPI, redPI);
    if (!isFinite(candidate) || candidate <= 0) return 0;
    return this.clamp(candidate, 0, 20);
  }

  private resetBaselines(): void {
    this.redBaseline = 0;
    this.greenBaseline = 0;
    this.blueBaseline = 0;
  }

  private resetSignalTrackingBuffers(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.redDC = 0; this.redAC = 0;
    this.greenDC = 0; this.greenAC = 0;
    this.blueDC = 0; this.blueAC = 0;
    this.sourceBuffers = { R: [], G: [], RG: [] };
    this.bandpassFilter.reset();
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.tileConfidence = new Array(25).fill(0);
    this.frameIntervalBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.lastFrameTimestamp = 0;
    this.estimatedSampleRate = 30;
    this.fingerDetected = false;
    this.contactState = 'NO_CONTACT';
    this.signalQuality = 0;
    this.fingerConfidenceCount = 0;
    this.fingerLostCount = 0;
    this.stableContactCount = 0;
    this.smoothedRed = 0;
    this.smoothedGreen = 0;
    this.smoothedBlue = 0;
    this.smoothedCoverage = 0;
    this.smoothedFingerScore = 0;
    this.redDC = 0; this.redAC = 0;
    this.greenDC = 0; this.greenAC = 0;
    this.blueDC = 0; this.blueAC = 0;
    this.motionScore = 0;
    this.lastAcceleration = { x: 0, y: 0, z: 0 };
    this.sourceBuffers = { R: [], G: [], RG: [] };
    this.sourceScores = { R: 0, G: 0, RG: 0 };
    this.activeSource = 'RG';
    this.lastSourceSwitch = 0;
    this.lastAutocorrScore = 0;
    this.autocorrRequestPending = false;
    this.rankRequestPending = false;
    this.pendingROI = null;
    this.resetBaselines();
    this.bandpassFilter.setSampleRate(this.estimatedSampleRate);
    this.bandpassFilter.reset();
  }

  private handleMotionEvent = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

    const dx = (acc.x ?? 0) - this.lastAcceleration.x;
    const dy = (acc.y ?? 0) - this.lastAcceleration.y;
    const dz = (acc.z ?? 0) - this.lastAcceleration.z;

    this.lastAcceleration = { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 };

    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rot = event.rotationRate;
    let gyroRMS = 0;

    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      gyroRMS = Math.sqrt((rot.alpha ?? 0) ** 2 + (rot.beta ?? 0) ** 2 + (rot.gamma ?? 0) ** 2) / 120;
    }

    const rawScore = accelRMS * 0.5 + gyroRMS * 0.3;
    this.motionScore = this.motionScore * 0.85 + rawScore * 0.15;
  };

  private startMotionListener(): void {
    if (this.motionListenerActive) return;
    try {
      if (typeof DeviceMotionEvent !== 'undefined') {
        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
          (DeviceMotionEvent as any).requestPermission()
            .then((state: string) => {
              if (state === 'granted') {
                window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
                this.motionListenerActive = true;
              }
            })
            .catch(() => {});
        } else {
          window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
          this.motionListenerActive = true;
        }
      }
    } catch {}
  }

  private stopMotionListener(): void {
    if (!this.motionListenerActive) return;
    window.removeEventListener('devicemotion', this.handleMotionEvent);
    this.motionListenerActive = false;
    this.motionScore = 0;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  getRGBStats() {
    return {
      redAC: this.redAC, redDC: this.redDC,
      greenAC: this.greenAC, greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios: this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0
        ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC)
        : 0,
    };
  }
}
