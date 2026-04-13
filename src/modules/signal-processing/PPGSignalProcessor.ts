import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface, ContactState } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { RingBuffer } from './RingBuffer';
import { AdaptiveROIMask, type ROIMaskResult } from './AdaptiveROIMask';
import { PressureProxyEstimator, type PressureState, type PressureEstimate } from './PressureProxyEstimator';
import { SignalSourceRanker } from './SignalSourceRanker';
import { computeGlobalSQI } from './SignalQualityEstimator';

// Extended contact states
type ExtendedContactState = ContactState | 'ACQUIRING_CONTACT' | 'SATURATED_CONTACT' | 'EXCESSIVE_PRESSURE';

/**
 * PPG SIGNAL PROCESSOR V2
 * 
 * Complete rewrite with:
 * - AdaptiveROIMask (7x7 tiles, saturation exclusion, percentile thresholds)
 * - PressureProxyEstimator (LOW/OPTIMAL/HIGH)
 * - SignalSourceRanker (6 candidates, autocorrelation SQI, hysteresis)
 * - RingBuffer (Float64Array, zero-alloc hot path)
 * - Real frame timing from requestVideoFrameCallback metadata
 * - Comprehensive SQI from SignalQualityEstimator
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing = false;

  // --- Sub-modules ---
  private bandpassFilter: BandpassFilter;
  private roiMask = new AdaptiveROIMask();
  private pressureEstimator = new PressureProxyEstimator();
  private sourceRanker = new SignalSourceRanker();

  // --- Ring buffers (zero-alloc) ---
  private readonly BUF_SIZE = 300;
  private redBuf = new RingBuffer(300);
  private greenBuf = new RingBuffer(300);
  private blueBuf = new RingBuffer(300);
  private rawSignalBuf = new RingBuffer(300);
  private filteredBuf = new RingBuffer(300);
  private vpgBuf = new RingBuffer(300);
  private apgBuf = new RingBuffer(300);
  private frameTimeBuf = new RingBuffer(120);

  // --- AC/DC ---
  private redDC = 0; private redAC = 0;
  private greenDC = 0; private greenAC = 0;
  private blueDC = 0; private blueAC = 0;

  // --- Baselines ---
  private redBaseline = 0;
  private greenBaseline = 0;
  private blueBaseline = 0;
  private estimatedSampleRate = 30;
  private lastFrameTime = 0; // performance.now() based

  private frameCount = 0;
  private lastLogTime = 0;

  // --- Contact state machine ---
  private contactState: ExtendedContactState = 'NO_CONTACT';
  private exportedContactState: ContactState = 'NO_CONTACT';
  private fingerDetected = false;
  private signalQuality = 0;
  private fingerConfidenceCount = 0;
  private fingerLostCount = 0;
  private stableContactCount = 0;
  private readonly FINGER_CONFIRM = 10;   // ~333ms strict
  private readonly FINGER_LOST = 120;     // ~4s tolerance
  private readonly STABLE_THRESHOLD = 40; // ~1.3s for STABLE
  private readonly UNSTABLE_GRACE = 160;

  // --- Smoothed metrics (EWMA) ---
  private smoothedRed = 0;
  private smoothedGreen = 0;
  private smoothedBlue = 0;
  private smoothedCoverage = 0;
  private smoothedFingerScore = 0;
  private readonly RGB_ALPHA = 0.04;
  private readonly COV_ALPHA = 0.05;

  // --- Position lock ---
  private positionLocked = false;
  private lockedRedBase = 0;
  private lockedGreenBase = 0;
  private lockedCoverage = 0;
  private positionStabilityCount = 0;
  private readonly POS_LOCK_FRAMES = 60;
  private readonly POS_DRIFT_TOL = 0.12;
  private positionDrifting = false;
  private positionDrift = 0;
  private positionGuidance = 'COLOQUE SU DEDO SOBRE LA CÁMARA Y EL FLASH';
  private positionQualityScore = 0;
  private spatialUniformity = 0;
  private centerCoverage = 0;

  // --- Pressure ---
  private pressureState: PressureState = 'LOW_PRESSURE';
  private pressurePenalty = 1.0;

  // --- Motion ---
  private motionScore = 0;
  private motionListenerActive = false;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private readonly MOTION_THRESH = 0.6;

  // --- Debug / telemetry ---
  private debugEnabled = false;
  private lastROIResult: ROIMaskResult | null = null;
  private activeSourceLabel = 'RG';
  private allSourceSQI: Record<string, number> = {};
  private clipHighRatio = 0;
  private clipLowRatio = 0;
  private processingTimeMs = 0;
  private realFps = 0;
  private sourceStability = 0;
  private lastSourceLabel = 'RG';
  private sourceStableFrames = 0;

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(this.estimatedSampleRate);
  }

  async initialize(): Promise<void> { this.reset(); }

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

  async calibrate(): Promise<boolean> { return true; }

  /** Accept frame timestamp from requestVideoFrameCallback metadata */
  processFrame(imageData: ImageData, frameTimestamp?: number): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    const t0 = performance.now();
    this.frameCount++;
    const timestamp = frameTimestamp ?? performance.now();
    this.updateSampleRate(timestamp);

    // --- ADAPTIVE ROI ---
    const roi = this.roiMask.process(imageData);
    this.lastROIResult = roi;
    this.clipHighRatio = roi.clipHighRatio;
    this.clipLowRatio = roi.clipLowRatio;
    this.spatialUniformity = roi.spatialUniformity;
    this.centerCoverage = roi.centerCoverage;

    // --- PRESSURE ESTIMATION ---
    const pressure = this.pressureEstimator.estimate({
      coverageRatio: roi.coverageRatio,
      clipHighRatio: roi.clipHighRatio,
      clipLowRatio: roi.clipLowRatio,
      perfusionIndex: this.calculatePerfusionIndex(),
      spatialUniformity: roi.spatialUniformity,
      brightness: roi.brightness,
      brightnessVariance: roi.brightnessVariance,
      baselineDrift: this.getBaselineDrift(),
    });
    this.pressureState = pressure.state;
    this.pressurePenalty = pressure.penalty;

    // --- CONTACT STATE ---
    this.updateContactState(roi, pressure);
    const motionArtifact = this.motionScore > this.MOTION_THRESH;

    if (this.exportedContactState === 'NO_CONTACT') {
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
          message: `BUSCANDO DEDO C:${(roi.coverageRatio * 100).toFixed(0)}% P:${pressure.state}`,
          hasPulsatility: false,
          pulsatilityValue: 0,
        },
      });
      this.processingTimeMs = performance.now() - t0;
      return;
    }

    // --- Contact detected: update baselines & buffers ---
    this.updateBaselines(roi.rawRed, roi.rawGreen, roi.rawBlue, motionArtifact);
    this.redBuf.push(roi.rawRed);
    this.greenBuf.push(roi.rawGreen);
    this.blueBuf.push(roi.rawBlue);

    if (this.redBuf.length >= 36) {
      this.calculateACDC();
    }

    // --- MULTI-SOURCE EXTRACTION ---
    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;

    const source = this.sourceRanker.update(
      roi.rawRed, roi.rawGreen, roi.rawBlue,
      this.redBaseline, this.greenBaseline, this.blueBaseline,
      redPI, greenPI,
      roi.clipHighRatio, motionArtifact
    );
    this.activeSourceLabel = source.label;
    this.allSourceSQI = source.allSQI;

    // Track source stability
    if (source.label === this.lastSourceLabel) {
      this.sourceStableFrames = Math.min(this.sourceStableFrames + 1, 300);
    } else {
      this.sourceStableFrames = 0;
      this.lastSourceLabel = source.label;
    }
    this.sourceStability = Math.min(1, this.sourceStableFrames / 60);

    // --- FILTERING ---
    this.rawSignalBuf.push(source.value);
    const filtered = this.bandpassFilter.filter(source.value);
    this.filteredBuf.push(filtered);

    // Derivatives for morphology analysis
    if (this.filteredBuf.length >= 3) {
      const n = this.filteredBuf.length;
      this.vpgBuf.push((this.filteredBuf.get(n - 1) - this.filteredBuf.get(n - 3)) / 2);
    }
    if (this.vpgBuf.length >= 3) {
      const n = this.vpgBuf.length;
      this.apgBuf.push((this.vpgBuf.get(n - 1) - this.vpgBuf.get(n - 3)) / 2);
    }

    // --- GLOBAL SQI ---
    const perfusionIndex = this.calculatePerfusionIndex();
    const signalRange = this.getSignalRange();
    const redDominance = this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2;

    // Periodicity from source ranker autocorrelation
    const periodicityScore = this.estimatePeriodicityFromFiltered();

    this.signalQuality = computeGlobalSQI({
      perfusionIndex,
      periodicityScore,
      coverageRatio: this.smoothedCoverage,
      spatialUniformity: this.spatialUniformity,
      pressurePenalty: this.pressurePenalty,
      motionScore: this.motionScore,
      clipHighRatio: roi.clipHighRatio,
      clipLowRatio: roi.clipLowRatio,
      positionDrift: this.positionDrift,
      signalRange,
      redDominance,
      contactState: this.exportedContactState,
      sourceStability: this.sourceStability,
    });

    // Gate: drift penalty
    const driftPenalty = this.positionDrifting ? 0.15 : 1.0;
    const gatedQuality = this.exportedContactState === 'STABLE_CONTACT' && perfusionIndex >= 0.005
      ? this.signalQuality * driftPenalty
      : Math.min(18, this.signalQuality * 0.45);

    // --- LOGGING ---
    const now = performance.now();
    this.processingTimeMs = now - t0;
    if (now - this.lastLogTime >= 3000) {
      this.lastLogTime = now;
      console.log(
        `📷 PPG [${source.label}] Q=${gatedQuality.toFixed(0)} PI=${perfusionIndex.toFixed(3)} ` +
        `${this.exportedContactState} P:${this.pressureState} ` +
        `FPS=${this.realFps.toFixed(0)} Clip:${(roi.clipHighRatio * 100).toFixed(1)}% ` +
        `Cov:${(this.smoothedCoverage * 100).toFixed(0)}% Proc:${this.processingTimeMs.toFixed(1)}ms`
      );
    }

    this.onSignalReady({
      timestamp,
      rawValue: source.value,
      filteredValue: filtered,
      quality: gatedQuality,
      fingerDetected: this.fingerDetected,
      contactState: this.exportedContactState,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed: roi.rawRed,
      rawGreen: roi.rawGreen,
      diagnostics: {
        message:
          `${source.label} PI:${perfusionIndex.toFixed(2)} P:${this.pressureState.charAt(0)} ` +
          `C:${(this.smoothedCoverage * 100).toFixed(0)} ${this.exportedContactState}` +
          `${motionArtifact ? ' MOV' : ''}`,
        hasPulsatility: this.exportedContactState === 'STABLE_CONTACT' && perfusionIndex >= 0.05,
        pulsatilityValue: this.exportedContactState === 'STABLE_CONTACT' ? perfusionIndex : 0,
      },
    });
  }

  // ══════════════════════════════════════════════════════
  //  CONTACT STATE MACHINE V2
  // ══════════════════════════════════════════════════════

  private updateContactState(roi: ROIMaskResult, pressure: PressureEstimate): void {
    const prev = this.contactState;
    const instant = this.detectFingerInstant(roi);

    if (instant) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, 200);
      this.stableContactCount++;

      if (this.fingerConfidenceCount >= this.FINGER_CONFIRM) {
        this.fingerDetected = true;

        // Check for pressure-based state overrides
        if (pressure.state === 'HIGH_PRESSURE' && roi.clipHighRatio > 0.15) {
          this.contactState = 'EXCESSIVE_PRESSURE';
        } else if (roi.clipHighRatio > 0.3) {
          this.contactState = 'SATURATED_CONTACT';
        } else {
          const perfusion = this.calculatePerfusionIndex();
          this.contactState = (this.stableContactCount >= this.STABLE_THRESHOLD && perfusion > 0.003 && pressure.state !== 'HIGH_PRESSURE')
            ? 'STABLE_CONTACT'
            : 'UNSTABLE_CONTACT';
        }
      } else {
        this.contactState = 'ACQUIRING_CONTACT';
      }
    } else {
      this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 0.3);
      this.fingerLostCount++;
      this.stableContactCount = Math.max(0, this.stableContactCount - 0.2);

      if (this.fingerDetected) {
        const softHold =
          this.smoothedCoverage > 0.10 &&
          (this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2) > 5 &&
          this.smoothedFingerScore > 0.12 &&
          (this.smoothedRed / Math.max(1, this.smoothedGreen)) > 1.03;

        if (softHold || this.fingerLostCount < this.FINGER_LOST) {
          this.contactState = 'UNSTABLE_CONTACT';
        } else if (this.fingerLostCount < this.UNSTABLE_GRACE) {
          this.contactState = 'UNSTABLE_CONTACT';
        } else {
          this.contactState = 'NO_CONTACT';
          this.fingerDetected = false;
          this.stableContactCount = 0;
          this.resetSignalBuffers();
          this.resetBaselines();
        }
      } else {
        this.contactState = 'NO_CONTACT';
      }
    }

    // Map extended state → standard ContactState for export
    switch (this.contactState) {
      case 'NO_CONTACT':
        this.exportedContactState = 'NO_CONTACT';
        break;
      case 'ACQUIRING_CONTACT':
      case 'UNSTABLE_CONTACT':
      case 'SATURATED_CONTACT':
      case 'EXCESSIVE_PRESSURE':
        this.exportedContactState = 'UNSTABLE_CONTACT';
        break;
      case 'STABLE_CONTACT':
        this.exportedContactState = 'STABLE_CONTACT';
        break;
    }

    // Reset buffers on transition from NO_CONTACT
    if (prev === 'NO_CONTACT' && this.contactState !== 'NO_CONTACT') {
      this.resetSignalBuffers();
    }

    // Position lock logic
    this.updatePositionLock(roi);
  }

  private detectFingerInstant(roi: ROIMaskResult): boolean {
    // Smooth inputs
    if (this.smoothedRed === 0) {
      this.smoothedRed = roi.rawRed;
      this.smoothedGreen = roi.rawGreen;
      this.smoothedBlue = roi.rawBlue;
      this.smoothedCoverage = roi.coverageRatio;
      this.smoothedFingerScore = roi.fingerScore;
    } else {
      const a = this.RGB_ALPHA;
      const ca = this.COV_ALPHA;
      this.smoothedRed += (roi.rawRed - this.smoothedRed) * a;
      this.smoothedGreen += (roi.rawGreen - this.smoothedGreen) * a;
      this.smoothedBlue += (roi.rawBlue - this.smoothedBlue) * a;
      this.smoothedCoverage += (roi.coverageRatio - this.smoothedCoverage) * ca;
      this.smoothedFingerScore += (roi.fingerScore - this.smoothedFingerScore) * ca;
    }

    const r = this.smoothedRed;
    const g = this.smoothedGreen;
    const b = this.smoothedBlue;
    const redDominance = r - (g + b) / 2;
    const rgRatio = r / Math.max(1, g);
    const totalI = r + g + b;
    const notBlownOut = !(r > 253 && g > 252 && b > 252);

    if (this.fingerDetected) {
      // MAINTAIN — moderately strict
      return r > 50 && rgRatio > 1.08 && redDominance > 10 &&
        this.smoothedCoverage > 0.15 && this.smoothedFingerScore > 0.15 &&
        notBlownOut;
    } else {
      // ACQUIRE — very strict, only optimal placement
      return r > 90 && rgRatio > 1.25 && redDominance > 25 &&
        totalI > 150 && totalI < 720 &&
        this.smoothedCoverage > 0.40 && this.smoothedFingerScore > 0.40 &&
        roi.clipHighRatio < 0.3 &&
        this.motionScore < 1.0 &&
        notBlownOut;
    }
  }

  private updatePositionLock(roi: ROIMaskResult): void {
    const currentRed = roi.rawRed;
    const currentGreen = roi.rawGreen;

    this.positionQualityScore = roi.coverageRatio * 0.35 + roi.spatialUniformity * 0.35 + roi.centerCoverage * 0.3;

    if (this.positionLocked) {
      const redDrift = this.lockedRedBase > 0 ? Math.abs(currentRed - this.lockedRedBase) / this.lockedRedBase : 0;
      const greenDrift = this.lockedGreenBase > 0 ? Math.abs(currentGreen - this.lockedGreenBase) / this.lockedGreenBase : 0;
      const covDrift = this.lockedCoverage > 0 ? Math.abs(roi.coverageRatio - this.lockedCoverage) / this.lockedCoverage : 0;
      this.positionDrift = (redDrift + greenDrift + covDrift) / 3;

      if (this.positionDrift > this.POS_DRIFT_TOL) {
        this.positionDrifting = true;
        this.positionGuidance = '⚠️ DEDO MOVIDO — VUELVA A LA POSICIÓN';
        if (this.positionDrift > this.POS_DRIFT_TOL * 2.5) {
          this.positionLocked = false;
          this.positionStabilityCount = 0;
          this.positionDrifting = false;
          this.positionGuidance = 'REPOSICIONE EL DEDO';
        }
      } else {
        this.positionDrifting = false;
        const adapt = 0.003;
        this.lockedRedBase += (currentRed - this.lockedRedBase) * adapt;
        this.lockedGreenBase += (currentGreen - this.lockedGreenBase) * adapt;
        this.lockedCoverage += (roi.coverageRatio - this.lockedCoverage) * adapt;
        this.positionGuidance = 'POSICIÓN CORRECTA — NO MUEVA EL DEDO';
      }
    } else if (this.fingerDetected) {
      this.positionDrifting = false;
      if (this.positionQualityScore > 0.60 && roi.coverageRatio > 0.45 &&
        roi.spatialUniformity > 0.45 && roi.centerCoverage > 0.30 &&
        this.pressureState !== 'HIGH_PRESSURE') {
        this.positionStabilityCount++;
        if (this.positionStabilityCount >= this.POS_LOCK_FRAMES) {
          this.positionLocked = true;
          this.lockedRedBase = currentRed;
          this.lockedGreenBase = currentGreen;
          this.lockedCoverage = roi.coverageRatio;
          this.positionGuidance = 'POSICIÓN BLOQUEADA — MANTENGA ASÍ';
        } else {
          this.positionGuidance = `ESTABILIZANDO... ${Math.round((this.positionStabilityCount / this.POS_LOCK_FRAMES) * 100)}%`;
        }
      } else {
        this.positionStabilityCount = Math.max(0, this.positionStabilityCount - 3);
        if (this.pressureState === 'HIGH_PRESSURE') {
          this.positionGuidance = 'REDUZCA LA PRESIÓN DEL DEDO';
        } else if (roi.coverageRatio < 0.40) {
          this.positionGuidance = 'CUBRA TODA LA CÁMARA CON SU DEDO';
        } else if (roi.spatialUniformity < 0.40) {
          this.positionGuidance = 'CENTRE EL DEDO SOBRE LA CÁMARA';
        } else {
          this.positionGuidance = 'PRESIONE SUAVEMENTE — FIRME Y SIN MOVER';
        }
      }
    } else {
      this.positionStabilityCount = 0;
      this.positionDrifting = false;
      this.positionGuidance = 'COLOQUE SU DEDO SOBRE LA CÁMARA Y EL FLASH';
    }
  }

  // ══════════════════════════════════════════════════════
  //  SIGNAL PROCESSING
  // ══════════════════════════════════════════════════════

  private updateSampleRate(timestamp: number): void {
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = timestamp;
      return;
    }
    const delta = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;
    if (delta < 8 || delta > 120) return;

    this.frameTimeBuf.push(delta);
    if (this.frameTimeBuf.length < 10) return;

    // Median of last 30 intervals
    const n = Math.min(30, this.frameTimeBuf.length);
    const arr = this.frameTimeBuf.last(n);
    arr.sort();
    const median = arr[Math.floor(n / 2)];
    const fps = Math.max(15, Math.min(60, 1000 / median));
    this.realFps = fps;

    if (Math.abs(fps - this.estimatedSampleRate) > 2) {
      this.estimatedSampleRate = fps;
      this.bandpassFilter.setSampleRate(fps);
    }
  }

  private updateBaselines(r: number, g: number, b: number, motion: boolean): void {
    if (this.redBaseline === 0) {
      this.redBaseline = r; this.greenBaseline = g; this.blueBaseline = b;
      return;
    }
    const alpha = motion ? 0.008 : this.exportedContactState === 'STABLE_CONTACT' ? 0.02 : 0.04;
    this.redBaseline += (r - this.redBaseline) * alpha;
    this.greenBaseline += (g - this.greenBaseline) * alpha;
    this.blueBaseline += (b - this.blueBaseline) * alpha;
  }

  private getBaselineDrift(): number {
    if (this.redBuf.length < 60) return 0;
    const recentMean = this.redBuf.mean(30);
    const olderMean = this.redBuf.mean(60) - recentMean; // approximate
    return Math.abs(olderMean) / (this.redBaseline + 1);
  }

  private calculateACDC(): void {
    const n = Math.min(180, this.redBuf.length);
    if (n < 36) return;

    this.redDC = this.redBuf.mean(n);
    this.greenDC = this.greenBuf.mean(n);
    this.blueDC = this.blueBuf.mean(n);

    if (this.redDC < 5 || this.greenDC < 5) return;

    const computeAC = (buf: RingBuffer, dc: number): number => {
      const p5 = buf.percentile(0.05, n);
      const p95 = buf.percentile(0.95, n);
      const p2p = p95 - p5;
      const v = buf.variance(n);
      const rms = Math.sqrt(v) * Math.sqrt(2);
      return (rms + p2p * 0.5) / 2;
    };

    this.redAC = computeAC(this.redBuf, this.redDC);
    this.greenAC = computeAC(this.greenBuf, this.greenDC);
    this.blueAC = computeAC(this.blueBuf, this.blueDC);

    // Reject if no real pulsatility
    if ((this.redAC / this.redDC) < 0.0001 && (this.greenAC / this.greenDC) < 0.0001) {
      this.redAC = 0; this.greenAC = 0;
    }
  }

  private calculatePerfusionIndex(): number {
    if (this.greenDC > 0) return (this.greenAC / this.greenDC) * 100;
    if (this.redDC > 0) return (this.redAC / this.redDC) * 100;
    return 0;
  }

  private getSignalRange(): number {
    if (this.filteredBuf.length < 30) return 0;
    const mm = this.filteredBuf.minMax(90);
    return mm.max - mm.min;
  }

  private estimatePeriodicityFromFiltered(): number {
    if (this.filteredBuf.length < 60) return 0;
    const n = Math.min(120, this.filteredBuf.length);
    // Search cardiac range lags
    let best = 0;
    for (let lag = 8; lag <= 60; lag++) {
      const ac = this.filteredBuf.autocorrelation(lag, n);
      if (ac > best) best = ac;
    }
    return Math.max(0, Math.min(1, best));
  }

  // ══════════════════════════════════════════════════════
  //  RESET
  // ══════════════════════════════════════════════════════

  private resetBaselines(): void {
    this.redBaseline = 0; this.greenBaseline = 0; this.blueBaseline = 0;
  }

  private resetSignalBuffers(): void {
    this.redBuf.clear(); this.greenBuf.clear(); this.blueBuf.clear();
    this.rawSignalBuf.clear(); this.filteredBuf.clear();
    this.vpgBuf.clear(); this.apgBuf.clear();
    this.redDC = 0; this.redAC = 0;
    this.greenDC = 0; this.greenAC = 0;
    this.blueDC = 0; this.blueAC = 0;
    this.sourceRanker.reset();
    this.bandpassFilter.reset();
  }

  reset(): void {
    this.resetSignalBuffers();
    this.frameTimeBuf.clear();
    this.roiMask.reset();
    this.pressureEstimator.reset();
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.lastFrameTime = 0;
    this.estimatedSampleRate = 30;
    this.realFps = 0;
    this.fingerDetected = false;
    this.contactState = 'NO_CONTACT';
    this.exportedContactState = 'NO_CONTACT';
    this.signalQuality = 0;
    this.fingerConfidenceCount = 0;
    this.fingerLostCount = 0;
    this.stableContactCount = 0;
    this.smoothedRed = 0; this.smoothedGreen = 0; this.smoothedBlue = 0;
    this.smoothedCoverage = 0; this.smoothedFingerScore = 0;
    this.motionScore = 0;
    this.lastAccel = { x: 0, y: 0, z: 0 };
    this.activeSourceLabel = 'RG';
    this.allSourceSQI = {};
    this.sourceStableFrames = 0;
    this.sourceStability = 0;
    this.pressureState = 'LOW_PRESSURE';
    this.pressurePenalty = 1.0;
    this.clipHighRatio = 0; this.clipLowRatio = 0;
    this.resetBaselines();
    this.bandpassFilter.setSampleRate(this.estimatedSampleRate);
    // Position lock
    this.positionLocked = false;
    this.lockedRedBase = 0; this.lockedGreenBase = 0; this.lockedCoverage = 0;
    this.positionStabilityCount = 0;
    this.spatialUniformity = 0; this.centerCoverage = 0;
    this.positionDrift = 0; this.positionDrifting = false;
    this.positionQualityScore = 0;
    this.positionGuidance = 'COLOQUE SU DEDO';
  }

  // ══════════════════════════════════════════════════════
  //  MOTION LISTENER
  // ══════════════════════════════════════════════════════

  private handleMotionEvent = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
    const dx = (acc.x ?? 0) - this.lastAccel.x;
    const dy = (acc.y ?? 0) - this.lastAccel.y;
    const dz = (acc.z ?? 0) - this.lastAccel.z;
    this.lastAccel = { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 };
    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rot = event.rotationRate;
    let gyroRMS = 0;
    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      gyroRMS = Math.sqrt((rot.alpha ?? 0) ** 2 + (rot.beta ?? 0) ** 2 + (rot.gamma ?? 0) ** 2) / 120;
    }
    this.motionScore = this.motionScore * 0.85 + (accelRMS * 0.5 + gyroRMS * 0.3) * 0.15;
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
            }).catch(() => {});
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

  // ══════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════

  getRGBStats() {
    return {
      redAC: this.redAC, redDC: this.redDC,
      greenAC: this.greenAC, greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios: this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0
        ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC) : 0,
    };
  }

  getPositionQuality() {
    return {
      locked: this.positionLocked,
      drifting: this.positionDrifting,
      spatialUniformity: this.spatialUniformity,
      centerCoverage: this.centerCoverage,
      positionDrift: this.positionDrift,
      guidance: this.positionGuidance,
      qualityScore: this.positionQualityScore,
    };
  }

  /** Debug telemetry — call from UI debug panel */
  getDebugInfo() {
    return {
      contactState: this.contactState,
      exportedState: this.exportedContactState,
      pressureState: this.pressureState,
      pressurePenalty: this.pressurePenalty,
      activeSource: this.activeSourceLabel,
      allSourceSQI: this.allSourceSQI,
      realFps: this.realFps,
      processingTimeMs: this.processingTimeMs,
      sqiGlobal: this.signalQuality,
      clipHighRatio: this.clipHighRatio,
      clipLowRatio: this.clipLowRatio,
      perfusionIndex: this.calculatePerfusionIndex(),
      coverageRatio: this.smoothedCoverage,
      positionDrift: this.positionDrift,
      positionLocked: this.positionLocked,
      spatialUniformity: this.spatialUniformity,
      sourceStability: this.sourceStability,
      motionScore: this.motionScore,
      validROIPixels: this.lastROIResult?.validPixelCount ?? 0,
      guidance: this.positionGuidance,
    };
  }
}
