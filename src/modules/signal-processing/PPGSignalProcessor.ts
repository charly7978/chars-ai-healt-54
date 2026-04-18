import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface, ContactState } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { RingBuffer } from './RingBuffer';
import { AdaptiveROIMask, type ROIMaskResult, type TileMetrics } from './AdaptiveROIMask';
import { PressureProxyEstimator, type PressureState, type PressureEstimate } from './PressureProxyEstimator';
import { SignalSourceRanker, type SourceMetrics } from './SignalSourceRanker';
import { computeGlobalSQI } from './SignalQualityEstimator';
import { FingerContactClassifier, type ContactClassification, type ContactFeatures } from './FingerContactClassifier';
import { TileFusionEngine, type FusionResult, type TileSignal } from './TileFusionEngine';
import { FrameQualityGate, type FrameQualityInput, type FrameQualityOutput } from '../core/FrameQualityGate';

// Extended contact states for internal use
type ExtendedContactState = 'NO_CONTACT' | 'ACQUIRING_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' | 'SATURATED_CONTACT' | 'EXCESSIVE_PRESSURE' | 'LOW_PERFUSION_CONTACT' | 'MOTION_CONTAMINATED_CONTACT';

// Calibration profile from calibrate()
interface CalibrationProfile {
  sampleRate: number;
  redDC: number;
  greenDC: number;
  blueDC: number;
  redBaselineAbsorbance: number;
  greenBaselineAbsorbance: number;
  blueBaselineAbsorbance: number;
  noiseFloor: number;
  baselineClipHigh: number;
  baselineClipLow: number;
  baselinePressure: number;
  baselineMotion: number;
  contactThresholdAcquire: number;
  contactThresholdMaintain: number;
  gateThreshold: number;
  timestamp: number;
}

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
  private fingerContactClassifier = new FingerContactClassifier();
  private tileFusionEngine = new TileFusionEngine();
  private frameQualityGate = new FrameQualityGate();

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

  // --- Optical density and normalized channels ---
  private redOD = 0;
  private greenOD = 0;
  private blueOD = 0;
  private redNorm = 0;
  private greenNorm = 0;
  private blueNorm = 0;

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
  
  // Visual motion fallback (frame difference)
  private prevImageData: ImageData | null = null;
  private visualMotionScore = 0;
  private readonly VISUAL_MOTION_WINDOW = 10;
  private visualMotionHistory: number[] = [];

  // --- Debug / telemetry ---
  private debugEnabled = false;
  private lastROIResult: ROIMaskResult | null = null;
  private activeSourceLabel = 'RG';
  private allSourceSQI: Record<string, number> = {};
  private allSourceMetrics: Record<string, SourceMetrics> = {};
  private clipHighRatio = 0;
  private clipLowRatio = 0;
  private processingTimeMs = 0;
  private realFps = 0;
  private sourceStability = 0;
  private lastSourceLabel = 'RG';
  private sourceStableFrames = 0;

  // --- Frame Quality Gate ---
  private lastGateResult: FrameQualityOutput | null = null;
  private gateScore = 0;
  private rejectionReason = '';
  private consecutiveRejections = 0;

  // --- Tile Fusion ---
  private fusionResult: FusionResult | null = null;
  private fusionConfidence = 0;
  private effectiveTileCount = 0;
  private validTileRatio = 0;
  private tileWeightMap: number[] = [];
  private dominantTileIndices: number[] = [];

  // --- Contact Classifier ---
  private contactClassification: ContactClassification | null = null;
  private contactConfidence = 0;
  private pressureProxy = 0;

  // --- Calibration ---
  private calibrationProfile: CalibrationProfile | null = null;
  private isCalibrating = false;
  private calibrationFrameCount = 0;
  private readonly CALIBRATION_FRAMES = 90; // ~3s at 30fps
  private calibrationBuffer: {
    red: number[]; green: number[]; blue: number[];
    clipHigh: number[]; clipLow: number[];
    motion: number[]; pressure: number[];
  } = { red: [], green: [], blue: [], clipHigh: [], clipLow: [], motion: [], pressure: [] };

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

  async calibrate(): Promise<boolean> {
    return new Promise((resolve) => {
      this.isCalibrating = true;
      this.calibrationFrameCount = 0;
      this.calibrationBuffer = { red: [], green: [], blue: [], clipHigh: [], clipLow: [], motion: [], pressure: [] };
      
      const checkCalibration = () => {
        if (!this.isCalibrating) {
          resolve(false);
          return;
        }
        
        if (this.calibrationFrameCount >= this.CALIBRATION_FRAMES && this.contactState === 'STABLE_CONTACT') {
          // Compute calibration profile
          const redDC = this.median(this.calibrationBuffer.red);
          const greenDC = this.median(this.calibrationBuffer.green);
          const blueDC = this.median(this.calibrationBuffer.blue);
          const baselineClipHigh = this.percentile(this.calibrationBuffer.clipHigh, 0.95);
          const baselineClipLow = this.percentile(this.calibrationBuffer.clipLow, 0.95);
          const noiseFloor = this.computeNoiseFloor(this.calibrationBuffer.green);
          const baselinePressure = this.median(this.calibrationBuffer.pressure);
          const baselineMotion = this.median(this.calibrationBuffer.motion);
          
          this.calibrationProfile = {
            sampleRate: this.estimatedSampleRate,
            redDC, greenDC, blueDC,
            redBaselineAbsorbance: -Math.log((redDC + 1e-6) / 255),
            greenBaselineAbsorbance: -Math.log((greenDC + 1e-6) / 255),
            blueBaselineAbsorbance: -Math.log((blueDC + 1e-6) / 255),
            noiseFloor,
            baselineClipHigh,
            baselineClipLow,
            baselinePressure,
            baselineMotion,
            contactThresholdAcquire: 0.45,
            contactThresholdMaintain: 0.35,
            gateThreshold: 0.55,
            timestamp: Date.now(),
          };
          
          this.isCalibrating = false;
          console.log('✅ Calibration complete:', this.calibrationProfile);
          resolve(true);
        } else if (this.calibrationFrameCount > this.CALIBRATION_FRAMES * 3) {
          // Timeout - calibration failed
          this.isCalibrating = false;
          console.warn('❌ Calibration timeout - no stable contact');
          resolve(false);
        } else {
          setTimeout(checkCalibration, 100);
        }
      };
      
      checkCalibration();
    });
  }
  
  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
  }
  
  private computeNoiseFloor(samples: number[]): number {
    if (samples.length < 2) return 0;
    // Compute MAD (Median Absolute Deviation)
    const med = this.median(samples);
    const absDeviations = samples.map(s => Math.abs(s - med));
    const mad = this.median(absDeviations);
    return mad * 1.4826; // Convert to std dev equivalent
  }
  
  isCalibrated(): boolean { return this.calibrationProfile !== null; }
  getCalibrationProfile(): CalibrationProfile | null { return this.calibrationProfile; }

  /** Accept frame timestamp from requestVideoFrameCallback metadata */
  processFrame(imageData: ImageData, frameTimestamp?: number): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    const t0 = performance.now();
    this.frameCount++;
    const timestamp = frameTimestamp ?? performance.now();
    this.updateSampleRate(timestamp);

    // ══════════════════════════════════════════════════════
    //  PHASE 1: ADAPTIVE ROI + TILE METRICS
    // ══════════════════════════════════════════════════════
    const roi = this.roiMask.process(imageData);
    this.lastROIResult = roi;
    this.clipHighRatio = roi.clipHighRatio;
    this.clipLowRatio = roi.clipLowRatio;
    this.spatialUniformity = roi.spatialUniformity;
    this.centerCoverage = roi.centerCoverage;
    this.effectiveTileCount = roi.tileMetrics.filter(t => t.score > 0.3).length;
    this.validTileRatio = this.effectiveTileCount / roi.tileMetrics.length;

    // ══════════════════════════════════════════════════════
    //  PHASE 2: MOTION DETECTION (IMU + Visual)
    // ══════════════════════════════════════════════════════
    const visualMotion = this.computeVisualMotion(imageData);
    if (this.motionListenerActive) {
      this.motionScore = this.motionScore * 0.8 + visualMotion * 0.2;
    } else {
      this.motionScore = this.motionScore * 0.5 + visualMotion * 0.5;
    }
    const motionArtifact = this.motionScore > this.MOTION_THRESH;

    // ══════════════════════════════════════════════════════
    //  PHASE 3: FINGER CONTACT CLASSIFIER (NEW AUTHORITY)
    // ══════════════════════════════════════════════════════
    const contactFeatures = this.extractContactFeatures(roi, imageData);
    this.contactClassification = this.fingerContactClassifier.classify(contactFeatures, this.motionScore);
    this.contactConfidence = this.contactClassification.confidence;
    
    // Map classifier state to extended state machine
    this.updateContactStateFromClassifier(this.contactClassification, roi);

    // ══════════════════════════════════════════════════════
    //  PHASE 4: TILE FUSION ENGINE
    // ══════════════════════════════════════════════════════
    if (this.exportedContactState !== 'NO_CONTACT') {
      const tileSignals = this.convertTileMetricsToSignals(roi.tileMetrics);
      const channelWeights = this.tileFusionEngine.computeChannelWeights(
        this.redDC > 0 ? this.redAC / this.redDC : 0,
        this.greenDC > 0 ? this.greenAC / this.greenDC : 0,
        this.blueDC > 0 ? this.blueAC / this.blueDC : 0,
        roi.clipHighRatio, roi.clipHighRatio, roi.clipLowRatio,
        this.motionScore
      );
      this.fusionResult = this.tileFusionEngine.fuseTileSignals(tileSignals, channelWeights);
      this.fusionConfidence = this.fusionResult.qualityScore;
      this.tileWeightMap = this.fusionResult.weights.tileWeights;
      this.dominantTileIndices = this.fusionResult.bestTileIndex >= 0 ? [this.fusionResult.bestTileIndex] : [];
    }

    // ══════════════════════════════════════════════════════
    //  PHASE 5: CALIBRATION BUFFERING
    // ══════════════════════════════════════════════════════
    if (this.isCalibrating) {
      this.calibrationFrameCount++;
      this.calibrationBuffer.red.push(roi.rawRed);
      this.calibrationBuffer.green.push(roi.rawGreen);
      this.calibrationBuffer.blue.push(roi.rawBlue);
      this.calibrationBuffer.clipHigh.push(roi.clipHighRatio);
      this.calibrationBuffer.clipLow.push(roi.clipLowRatio);
      this.calibrationBuffer.motion.push(this.motionScore);
      this.calibrationBuffer.pressure.push(this.pressureProxy);
    }

    // ══════════════════════════════════════════════════════
    //  PHASE 6: FRAME QUALITY GATE (SOFT GATE - no bloquea, solo afecta calidad)
    // ══════════════════════════════════════════════════════
    const gateInput = this.buildGateInput(roi, motionArtifact);
    this.lastGateResult = this.frameQualityGate.evaluate(gateInput);
    this.gateScore = this.computeGateScore(gateInput);
    
    // EL GATE YA NO BLOQUEA - solo ajusta la calidad y reporta el rechazo
    if (!this.lastGateResult.pass) {
      this.rejectionReason = this.lastGateResult.reason;
      this.consecutiveRejections++;
    } else {
      this.consecutiveRejections = 0;
      this.rejectionReason = '';
    }

    // ══════════════════════════════════════════════════════
    //  PHASE 7: SIGNAL EXTRACTION (from fused tiles or fallback)
    // ══════════════════════════════════════════════════════
    // Use fused signal if available, otherwise fallback to raw ROI
    const fusedRed = this.fusionResult ? roi.rawRed * (1 + this.fusionResult.fusedSignal * 0.001) : roi.rawRed;
    const fusedGreen = this.fusionResult ? roi.rawGreen * (1 + this.fusionResult.fusedSignal * 0.001) : roi.rawGreen;
    const fusedBlue = this.fusionResult ? roi.rawBlue * (1 + this.fusionResult.fusedSignal * 0.001) : roi.rawBlue;

    this.updateBaselines(fusedRed, fusedGreen, fusedBlue, motionArtifact);
    this.redBuf.push(fusedRed);
    this.greenBuf.push(fusedGreen);
    this.blueBuf.push(fusedBlue);

    if (this.redBuf.length >= 36) {
      this.calculateACDC();
    }

    // ══════════════════════════════════════════════════════
    //  PHASE 8: MULTI-SOURCE RANKING
    // ══════════════════════════════════════════════════════
    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;

    const source = this.sourceRanker.update(
      fusedRed, fusedGreen, fusedBlue,
      this.redBaseline, this.greenBaseline, this.blueBaseline,
      redPI, greenPI,
      roi.clipHighRatio, motionArtifact
    );
    this.activeSourceLabel = source.label;
    this.allSourceSQI = source.allSQI;
    this.allSourceMetrics = source.allMetrics ?? {};

    // Track source stability with hysteresis
    if (source.label === this.lastSourceLabel) {
      this.sourceStableFrames = Math.min(this.sourceStableFrames + 1, 300);
    } else {
      // Only switch if new source is significantly better
      const currentSQI = source.allSQI[this.lastSourceLabel] ?? 0;
      const newSQI = source.allSQI[source.label] ?? 0;
      if (newSQI > currentSQI * 1.15 && this.sourceStableFrames > 30) {
        this.sourceStableFrames = 0;
        this.lastSourceLabel = source.label;
      }
    }
    this.sourceStability = Math.min(1, this.sourceStableFrames / 60);

    // ══════════════════════════════════════════════════════
    //  PHASE 9: FILTERING
    // ══════════════════════════════════════════════════════
    this.rawSignalBuf.push(source.value);
    const filterResult = this.bandpassFilter.filter(source.value, timestamp);
    const filtered = filterResult.heartBand;
    this.filteredBuf.push(filtered);

    if (this.filteredBuf.length >= 3) {
      const n = this.filteredBuf.length;
      this.vpgBuf.push((this.filteredBuf.get(n - 1) - this.filteredBuf.get(n - 3)) / 2);
    }
    if (this.vpgBuf.length >= 3) {
      const n = this.vpgBuf.length;
      this.apgBuf.push((this.vpgBuf.get(n - 1) - this.vpgBuf.get(n - 3)) / 2);
    }

    // ══════════════════════════════════════════════════════
    //  PHASE 10: GLOBAL SQI + GATING
    // ══════════════════════════════════════════════════════
    const perfusionIndex = this.calculatePerfusionIndex();
    const signalRange = this.getSignalRange();
    const redDominance = this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2;
    const periodicityScore = this.estimatePeriodicityFromFiltered();

    this.signalQuality = computeGlobalSQI({
      perfusionIndex,
      periodicityScore,
      coverageRatio: this.smoothedCoverage,
      spatialUniformity: this.spatialUniformity,
      pressureState: this.pressureState,
      motionScore: this.motionScore,
      clipHighRatio: roi.clipHighRatio,
      clipLowRatio: roi.clipLowRatio,
      positionDrift: this.positionDrift,
      signalRange,
      redDominance,
      contactState: this.exportedContactState,
      sourceStability: this.sourceStability,
      pressurePenalty: this.pressurePenalty,
    });

    // Apply quality gate score weighting
    const driftPenalty = this.positionDrifting ? 0.15 : 1.0;
    const gatedQuality = this.exportedContactState === 'STABLE_CONTACT' && perfusionIndex >= 0.005
      ? this.signalQuality * driftPenalty * (0.7 + this.gateScore * 0.3)
      : Math.min(18, this.signalQuality * 0.45 * this.gateScore);

    // ══════════════════════════════════════════════════════
    //  PHASE 11: OUTPUT
    // ══════════════════════════════════════════════════════
    const now = performance.now();
    this.processingTimeMs = now - t0;
    if (now - this.lastLogTime >= 3000) {
      this.lastLogTime = now;
      console.log(
        `📷 PPG [${source.label}] Q=${gatedQuality.toFixed(0)} PI=${perfusionIndex.toFixed(3)} ` +
        `${this.contactState} C:${(this.contactConfidence * 100).toFixed(0)}% ` +
        `F:${(this.fusionConfidence * 100).toFixed(0)}% G:${(this.gateScore * 100).toFixed(0)}% ` +
        `FPS=${this.realFps.toFixed(0)} Clip:${(roi.clipHighRatio * 100).toFixed(1)}% ` +
        `Tiles:${this.effectiveTileCount} Rej:${this.consecutiveRejections}`
      );
    }

    // Get current source metrics for propagation
    const currentMetrics = this.allSourceMetrics[this.activeSourceLabel] ?? {};
    
    // FALLBACK: Si el ranker devuelve 0 o muy bajo, usar el canal verde directamente
    // Esto garantiza que SIEMPRE haya una señal visible
    const finalRawValue = Math.abs(source.value) < 0.001 
      ? (this.greenBaseline > 10 ? (this.greenBaseline - fusedGreen) / this.greenBaseline * 3200 : 0)
      : source.value;
    const finalFilteredValue = Math.abs(filtered) < 0.001 && Math.abs(finalRawValue) > 0.001 
      ? finalRawValue 
      : filtered;

    this.onSignalReady({
      timestamp,
      rawValue: finalRawValue,
      filteredValue: finalFilteredValue,
      quality: gatedQuality,
      fingerDetected: this.fingerDetected,
      contactState: this.exportedContactState,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed: fusedRed,
      rawGreen: fusedGreen,
      diagnostics: {
        message: this.buildDiagnosticMessage(source.label, perfusionIndex, motionArtifact),
        hasPulsatility: this.exportedContactState === 'STABLE_CONTACT' && perfusionIndex >= 0.05,
        pulsatilityValue: this.exportedContactState === 'STABLE_CONTACT' ? perfusionIndex : 0,
      },
      // Full metric propagation
      clipHighRatio: this.clipHighRatio,
      clipLowRatio: this.clipLowRatio,
      contactConfidence: this.contactConfidence,
      contactStateExtended: this.contactState,
      fusionConfidence: this.fusionConfidence,
      effectiveTileCount: this.effectiveTileCount,
      validTileRatio: this.validTileRatio,
      tileWeightMap: this.tileWeightMap,
      dominantTileIndices: this.dominantTileIndices,
      sourceQuality: this.allSourceSQI[this.activeSourceLabel] ?? 0,
      sourceName: this.activeSourceLabel,
      spectralSNR: currentMetrics.spectralSNR ?? 0,
      peakProminence: currentMetrics.peakProminence ?? 0,
      harmonicConsistency: currentMetrics.harmonicConsistency ?? 0,
      zeroCrossingRate: currentMetrics.zeroCrossingRate ?? 0,
      temporalStability: this.contactClassification?.features.temporalStability ?? 0,
      motionScore: this.motionScore,
      gateScore: this.gateScore,
      rejectionReason: this.rejectionReason,
      calibrationReady: this.isCalibrated(),
      calibrationConfidence: this.calibrationProfile ? Math.min(1, this.calibrationFrameCount / this.CALIBRATION_FRAMES) : 0,
    });
  }

  // ══════════════════════════════════════════════════════
  //  HELPER METHODS FOR NEW PIPELINE
  // ══════════════════════════════════════════════════════

  private extractContactFeatures(roi: ROIMaskResult, imageData: ImageData): ContactFeatures {
    // Compute temporal stability from history
    let temporalStability = 1.0;
    if (this.smoothedRed > 0) {
      const dr = Math.abs(roi.rawRed - this.smoothedRed) / this.smoothedRed;
      const dg = Math.abs(roi.rawGreen - this.smoothedGreen) / Math.max(1, this.smoothedGreen);
      temporalStability = Math.max(0, 1 - (dr + dg) / 2);
    }

    // Compute pressure proxy
    this.pressureProxy = roi.coverageRatio * (1 + roi.clipHighRatio * 2);

    return {
      meanR: roi.rawRed,
      meanG: roi.rawGreen,
      meanB: roi.rawBlue,
      normalizedR: roi.rawRed / Math.max(1, roi.rawRed + roi.rawGreen + roi.rawBlue),
      normalizedG: roi.rawGreen / Math.max(1, roi.rawRed + roi.rawGreen + roi.rawBlue),
      normalizedB: roi.rawBlue / Math.max(1, roi.rawRed + roi.rawGreen + roi.rawBlue),
      redDominance: roi.rawRed - (roi.rawGreen + roi.rawBlue) / 2,
      rgRatio: roi.rawGreen > 1 ? roi.rawRed / roi.rawGreen : 0,
      hue: 0, // Computed by classifier if needed
      saturation: roi.tileMetrics[0]?.saturation ?? 0,
      value: (roi.rawRed + roi.rawGreen + roi.rawBlue) / 3 / 255,
      saturationHigh: (roi.tileMetrics[0]?.saturation ?? 0) > 0.6,
      saturationLow: (roi.tileMetrics[0]?.saturation ?? 0) < 0.1,
      y: 0.299 * roi.rawRed + 0.587 * roi.rawGreen + 0.114 * roi.rawBlue,
      cb: 128 - 0.168736 * roi.rawRed - 0.331264 * roi.rawGreen + 0.5 * roi.rawBlue,
      cr: 128 + 0.5 * roi.rawRed - 0.418688 * roi.rawGreen - 0.081312 * roi.rawBlue,
      totalCoverage: roi.coverageRatio,
      centerCoverage: roi.centerCoverage,
      circularity: roi.spatialUniformity,
      compactness: roi.spatialUniformity,
      edgePenalty: 1 - roi.spatialUniformity,
      entropy: roi.tileMetrics.reduce((s, t) => s + t.entropy, 0) / roi.tileMetrics.length,
      gradient: roi.tileMetrics.reduce((s, t) => s + t.gradient, 0) / roi.tileMetrics.length,
      spatialUniformity: roi.spatialUniformity,
      hotSpotRatio: roi.clipHighRatio,
      clipHighRatio: roi.clipHighRatio,
      clipLowRatio: roi.clipLowRatio,
      temporalStability,
    };
  }

  private updateContactStateFromClassifier(classification: ContactClassification, roi: ROIMaskResult): void {
    const prev = this.contactState;
    
    // Map classifier state to extended state machine
    const stateMap: Record<string, ExtendedContactState> = {
      'NO_FINGER': 'NO_CONTACT',
      'PARTIAL_CONTACT': 'ACQUIRING_CONTACT',
      'GOOD_CONTACT': 'UNSTABLE_CONTACT',
      'OVERPRESSURE': 'EXCESSIVE_PRESSURE',
      'UNDERILLUMINATED': 'NO_CONTACT',
      'EXCESSIVE_CLIPPING': 'SATURATED_CONTACT',
      'MOTION_CONTAMINATED': 'MOTION_CONTAMINATED_CONTACT',
    };
    
    let newState: ExtendedContactState = stateMap[classification.state] || 'NO_CONTACT';
    
    // Override with perfusion-based stability check
    const perfusion = this.calculatePerfusionIndex();
    if (newState === 'UNSTABLE_CONTACT' && perfusion > 0.015 && classification.confidence > 0.7) {
      this.stableContactCount++;
      if (this.stableContactCount >= this.STABLE_THRESHOLD) {
        newState = 'STABLE_CONTACT';
      }
    } else if (newState === 'STABLE_CONTACT' && (perfusion < 0.005 || classification.confidence < 0.5)) {
      this.stableContactCount = Math.max(0, this.stableContactCount - 2);
      if (this.stableContactCount < this.STABLE_THRESHOLD * 0.5) {
        newState = 'UNSTABLE_CONTACT';
      }
    } else if (newState !== 'STABLE_CONTACT' && newState !== 'UNSTABLE_CONTACT') {
      this.stableContactCount = 0;
    }
    
    // Low perfusion override
    if (perfusion < 0.003 && newState !== 'NO_CONTACT' && newState !== 'MOTION_CONTAMINATED_CONTACT') {
      newState = 'LOW_PERFUSION_CONTACT';
    }
    
    this.contactState = newState;
    this.fingerDetected = newState !== 'NO_CONTACT';
    this.fingerConfidenceCount = this.fingerDetected ? Math.min(this.fingerConfidenceCount + 1, 200) : Math.max(0, this.fingerConfidenceCount - 1);
    
    // Map to exported ContactState
    switch (this.contactState) {
      case 'NO_CONTACT':
        this.exportedContactState = 'NO_CONTACT';
        break;
      case 'ACQUIRING_CONTACT':
      case 'UNSTABLE_CONTACT':
      case 'SATURATED_CONTACT':
      case 'EXCESSIVE_PRESSURE':
      case 'LOW_PERFUSION_CONTACT':
      case 'MOTION_CONTAMINATED_CONTACT':
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
    
    // Position lock
    this.updatePositionLock(roi);
  }

  private convertTileMetricsToSignals(tileMetrics: TileMetrics[]): TileSignal[] {
    return tileMetrics.map((t, i) => ({
      tileIndex: i,
      redNorm: t.meanR / 255,
      greenNorm: t.meanG / 255,
      blueNorm: t.meanB / 255,
      redOD: -Math.log((t.meanR + 1e-6) / 255),
      greenOD: -Math.log((t.meanG + 1e-6) / 255),
      blueOD: -Math.log((t.meanB + 1e-6) / 255),
      perfusionIndex: t.rgRatio > 0 ? (t.redDominance / t.meanG) * 100 : 0,
      clipHighRatio: t.clipHighPct,
      clipLowRatio: t.clipLowPct,
      variance: t.variance,
      temporalStability: t.temporalStability,
      centerDistance: t.centerDistance,
    }));
  }

  private buildGateInput(roi: ROIMaskResult, motionArtifact: boolean): FrameQualityInput {
    const perfusion = this.calculatePerfusionIndex();
    const currentMetrics = this.allSourceMetrics[this.activeSourceLabel] ?? {};
    
    return {
      contactState: this.contactClassification?.state || 'NO_FINGER',
      globalSQI: this.signalQuality,
      clipHighRatio: roi.clipHighRatio,
      clipLowRatio: roi.clipLowRatio,
      motionScore: this.motionScore,
      coverageRatio: roi.coverageRatio,
      perfusionIndex: perfusion,
      spatialUniformity: roi.spatialUniformity,
      brightness: roi.brightness,
      // Extended metrics
      contactConfidence: this.contactConfidence,
      fusionConfidence: this.fusionConfidence,
      sourceQuality: this.allSourceSQI[this.activeSourceLabel] ?? 0,
      spectralSNR: currentMetrics.spectralSNR ?? 0,
      peakProminence: currentMetrics.peakProminence ?? 0,
      harmonicConsistency: currentMetrics.harmonicConsistency ?? 0,
    };
  }

  private computeGateScore(input: FrameQualityInput): number {
    const sourceQuality = input.sourceQuality ?? 0;
    const spectralSNR = input.spectralSNR ?? 0;
    const peakProminence = input.peakProminence ?? 0;
    const harmonicConsistency = input.harmonicConsistency ?? 0;
    
    // Normalize metrics to 0-1
    const snrNorm = Math.min(1, spectralSNR / 3);
    const peakNorm = Math.min(1, peakProminence * 2);
    const harmonicNorm = harmonicConsistency;
    const motionPenalty = Math.min(1, input.motionScore);
    const clippingPenalty = Math.min(1, (input.clipHighRatio + input.clipLowRatio) * 2);
    
    return (
      0.20 * (input.contactConfidence ?? 0) +
      0.15 * (input.fusionConfidence ?? 0) +
      0.15 * (sourceQuality / 100) +
      0.15 * snrNorm +
      0.10 * peakNorm +
      0.10 * harmonicNorm +
      0.10 * (1 - motionPenalty) +
      0.05 * (1 - clippingPenalty)
    );
  }

  private buildDiagnosticMessage(sourceLabel: string, perfusion: number, motionArtifact: boolean): string {
    const parts: string[] = [];
    parts.push(sourceLabel);
    parts.push(`PI:${perfusion.toFixed(2)}`);
    parts.push(`C:${(this.contactConfidence * 100).toFixed(0)}%`);
    parts.push(`F:${(this.fusionConfidence * 100).toFixed(0)}%`);
    parts.push(`G:${(this.gateScore * 100).toFixed(0)}%`);
    if (this.contactState !== this.exportedContactState) {
      parts.push(`${this.contactState}→${this.exportedContactState}`);
    } else {
      parts.push(this.contactState);
    }
    if (motionArtifact) parts.push('MOV');
    if (this.consecutiveRejections > 0) parts.push(`R${this.consecutiveRejections}`);
    return parts.join(' ');
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

    // Calculate optical density: A_c = -log((I_c + eps) / (DC_c + eps))
    const eps = 1e-6;
    const currentR = this.redBuf.get(this.redBuf.length - 1);
    const currentG = this.greenBuf.get(this.greenBuf.length - 1);
    const currentB = this.blueBuf.get(this.blueBuf.length - 1);

    this.redOD = -Math.log((currentR + eps) / (this.redDC + eps));
    this.greenOD = -Math.log((currentG + eps) / (this.greenDC + eps));
    this.blueOD = -Math.log((currentB + eps) / (this.blueDC + eps));

    // Calculate AC/DC normalized channels: Rn = (R - DC_R) / DC_R
    this.redNorm = (currentR - this.redDC) / (this.redDC + eps);
    this.greenNorm = (currentG - this.greenDC) / (this.greenDC + eps);
    this.blueNorm = (currentB - this.blueDC) / (this.blueDC + eps);
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
    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz) / 30;
    let gyroRMS = 0;
    const rot = event.rotationRate;
    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      gyroRMS = Math.sqrt((rot.alpha ?? 0) ** 2 + (rot.beta ?? 0) ** 2 + (rot.gamma ?? 0) ** 2) / 120;
    }
    this.motionScore = this.motionScore * 0.85 + (accelRMS * 0.5 + gyroRMS * 0.3) * 0.15;
  };

  /**
   * Visual motion detection using frame difference (fallback when IMU unavailable)
   */
  private computeVisualMotion(imageData: ImageData): number {
    if (!this.prevImageData) {
      this.prevImageData = imageData;
      return 0;
    }

    const data = imageData.data;
    const prevData = this.prevImageData.data;
    const w = imageData.width;
    const h = imageData.height;

    // Sample central region for performance
    const roiSize = Math.min(w, h) * 0.6;
    const sx = Math.floor((w - roiSize) / 2);
    const sy = Math.floor((h - roiSize) / 2);
    const ex = sx + Math.floor(roiSize);
    const ey = sy + Math.floor(roiSize);

    let totalDiff = 0;
    let sampleCount = 0;
    const step = 4; // Sample every 4th pixel

    for (let y = sy; y < ey; y += step) {
      for (let x = sx; x < ex; x += step) {
        const i = (y * w + x) * 4;
        const rDiff = Math.abs(data[i] - prevData[i]);
        const gDiff = Math.abs(data[i + 1] - prevData[i + 1]);
        const bDiff = Math.abs(data[i + 2] - prevData[i + 2]);
        totalDiff += (rDiff + gDiff + bDiff) / 3;
        sampleCount++;
      }
    }

    this.prevImageData = imageData;

    if (sampleCount === 0) return 0;
    const avgDiff = totalDiff / sampleCount;

    // Normalize to 0-1 range
    const normalizedMotion = Math.min(1, avgDiff / 30);

    // Update visual motion history
    this.visualMotionHistory.push(normalizedMotion);
    if (this.visualMotionHistory.length > this.VISUAL_MOTION_WINDOW) {
      this.visualMotionHistory.shift();
    }

    // EWMA of visual motion
    this.visualMotionScore = this.visualMotionScore * 0.7 + normalizedMotion * 0.3;

    return this.visualMotionScore;
  }

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
      redOD: this.redOD,
      greenOD: this.greenOD,
      blueOD: this.blueOD,
      redNorm: this.redNorm,
      greenNorm: this.greenNorm,
      blueNorm: this.blueNorm,
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
