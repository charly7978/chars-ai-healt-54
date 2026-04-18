import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface, ContactState } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { RingBuffer } from './RingBuffer';
import { AdaptiveROIMask, type ROIMaskResult } from './AdaptiveROIMask';
import { PressureProxyEstimator, type PressureState, type PressureEstimate } from './PressureProxyEstimator';
import { SignalSourceRanker } from './SignalSourceRanker';
import { computeGlobalSQI } from './SignalQualityEstimator';
import { FingerContactClassifier, type ContactClassification } from './FingerContactClassifier';
import { TileFusionEngine, type TileSignal, type FusionResult } from './TileFusionEngine';
import { FrameQualityGate, type FrameQualityInput } from '../core/FrameQualityGate';

// Worker types for PPG metrics offloading
type WorkerMessage = {
  type: 'computeTileMetrics' | 'computeOpticalDensity' | 'computeVisualMotion' | 'computeClippingMap';
  imageData: ImageData;
  params?: Record<string, unknown>;
};

type WorkerResponse = {
  type: 'tileMetrics' | 'opticalDensity' | 'visualMotion' | 'clippingMap';
  result: unknown;
};

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
  private contactClassifier = new FingerContactClassifier();
  private fusionEngine = new TileFusionEngine();
  private qualityGate = new FrameQualityGate();

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
  
  // --- Calibration baselines ---
  private noiseFloor = 0;
  private minPerfusionThreshold = 0.002;
  private contactStabilityThreshold = 0.3;
  
  // --- Fusion and gate state ---
  private fusionResult: FusionResult | null = null;
  private gateResult: { pass: boolean; reason: string; confidence: number } | null = null;
  private lastContactClassification: ContactClassification | null = null;

  // --- Worker for offloading heavy computations ---
  private worker: Worker | null = null;
  private workerAvailable = false;
  private pendingWorkerRequests = new Map<number, (result: unknown) => void>();
  private workerRequestId = 0;

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
    this.initializeWorker();
  }

  stop(): void {
    this.isProcessing = false;
    this.stopMotionListener();
    this.terminateWorker();
  }

  private initializeWorker(): void {
    try {
      this.worker = new Worker(new URL('../../workers/ppg.worker.ts', import.meta.url), {
        type: 'module'
      });

      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const { type, result } = e.data;
        const callback = this.pendingWorkerRequests.get(this.workerRequestId);
        if (callback) {
          callback(result);
          this.pendingWorkerRequests.delete(this.workerRequestId);
        }
      };

      this.worker.onerror = () => {
        console.warn('⚠️ PPG worker failed, falling back to synchronous computation');
        this.workerAvailable = false;
        this.terminateWorker();
      };

      this.workerAvailable = true;
      console.log('✅ PPG worker initialized successfully');
    } catch (error) {
      console.warn('⚠️ Failed to initialize PPG worker, using synchronous fallback:', error);
      this.workerAvailable = false;
    }
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerAvailable = false;
    this.pendingWorkerRequests.clear();
  }

  private async offloadToWorker<T>(type: WorkerMessage['type'], imageData: ImageData, params?: Record<string, unknown>): Promise<T | null> {
    if (!this.workerAvailable || !this.worker) {
      return null;
    }

    return new Promise((resolve) => {
      const requestId = ++this.workerRequestId;
      this.pendingWorkerRequests.set(requestId, resolve);

      const message: WorkerMessage = { type, imageData, params };
      this.worker.postMessage(message);

      setTimeout(() => {
        if (this.pendingWorkerRequests.has(requestId)) {
          this.pendingWorkerRequests.delete(requestId);
          resolve(null);
        }
      }, 100);
    });
  }

  async calibrate(): Promise<boolean> {
    const calibrationFrames = 90;
    const calibrationBuffer: { r: number; g: number; b: number; coverage: number }[] = [];
    
    let collected = 0;
    const startTime = performance.now();
    
    return new Promise((resolve) => {
      const calibrationHandler = (signal: ProcessedSignal) => {
        if (signal.fingerDetected && signal.rawRed && signal.rawGreen && signal.rawBlue) {
          calibrationBuffer.push({
            r: signal.rawRed,
            g: signal.rawGreen,
            b: signal.rawBlue,
            coverage: signal.coverageRatio || 0
          });
          collected++;
          
          if (collected >= calibrationFrames) {
            if (calibrationBuffer.length > 0) {
              const avgR = calibrationBuffer.reduce((s, x) => s + x.r, 0) / calibrationBuffer.length;
              const avgG = calibrationBuffer.reduce((s, x) => s + x.g, 0) / calibrationBuffer.length;
              const avgB = calibrationBuffer.reduce((s, x) => s + x.b, 0) / calibrationBuffer.length;
              
              this.redBaseline = avgR;
              this.greenBaseline = avgG;
              this.blueBaseline = avgB;
              
              const varR = calibrationBuffer.reduce((s, x) => s + (x.r - avgR) ** 2, 0) / calibrationBuffer.length;
              const varG = calibrationBuffer.reduce((s, x) => s + (x.g - avgG) ** 2, 0) / calibrationBuffer.length;
              const varB = calibrationBuffer.reduce((s, x) => s + (x.b - avgB) ** 2, 0) / calibrationBuffer.length;
              this.noiseFloor = Math.sqrt((varR + varG + varB) / 3);
              
              this.minPerfusionThreshold = Math.max(0.002, this.noiseFloor / avgG * 0.5);
              
              const avgCoverage = calibrationBuffer.reduce((s, x) => s + x.coverage, 0) / calibrationBuffer.length;
              this.contactStabilityThreshold = avgCoverage > 0.4 ? 0.35 : 0.25;
              
              console.log(`✅ Calibration complete: R=${avgR.toFixed(0)} G=${avgG.toFixed(0)} B=${avgB.toFixed(0)} Noise=${this.noiseFloor.toFixed(2)}`);
            }
            
            this.onSignalReady = originalHandler;
            resolve(true);
          }
        }
      };
      
      const originalHandler = this.onSignalReady;
      this.onSignalReady = calibrationHandler;
      
      setTimeout(() => {
        if (collected < calibrationFrames) {
          console.warn(`⚠️ Calibration timeout after ${(performance.now() - startTime).toFixed(0)}ms, collected ${collected}/${calibrationFrames} frames`);
          this.onSignalReady = originalHandler;
          resolve(collected > 20);
        }
      }, 5000);
    });
  }

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

    // --- MOTION DETECTION (IMU + Visual Fallback) ---
    const visualMotion = this.computeVisualMotion(imageData);
    // Combine IMU and visual motion (prefer IMU if available, use visual as fallback)
    if (this.motionListenerActive) {
      // IMU is active, use it primarily with visual as supplementary
      this.motionScore = this.motionScore * 0.8 + visualMotion * 0.2;
    } else {
      // No IMU, rely on visual motion
      this.motionScore = this.motionScore * 0.5 + visualMotion * 0.5;
    }
    const motionArtifact = this.motionScore > this.MOTION_THRESH;

    // --- CONTACT CLASSIFICATION (replaces heuristic) ---
    // Build features from ROI data instead of extracting from full image
    const features = {
      meanR: roi.rawRed,
      meanG: roi.rawGreen,
      meanB: roi.rawBlue,
      normalizedR: roi.rawRed / (roi.rawRed + roi.rawGreen + roi.rawBlue + 1),
      normalizedG: roi.rawGreen / (roi.rawRed + roi.rawGreen + roi.rawBlue + 1),
      normalizedB: roi.rawBlue / (roi.rawRed + roi.rawGreen + roi.rawBlue + 1),
      redDominance: roi.rawRed - (roi.rawGreen + roi.rawBlue) / 2,
      rgRatio: roi.rawGreen > 1 ? roi.rawRed / roi.rawGreen : 0,
      hue: 0, // Calculated from RGB
      saturation: 0, // Calculated from RGB
      value: 0, // Calculated from RGB
      saturationHigh: false,
      saturationLow: false,
      y: 0.299 * roi.rawRed + 0.587 * roi.rawGreen + 0.114 * roi.rawBlue,
      cb: 128 - 0.168736 * roi.rawRed - 0.331264 * roi.rawGreen + 0.5 * roi.rawBlue,
      cr: 128 + 0.5 * roi.rawRed - 0.418688 * roi.rawGreen - 0.081312 * roi.rawBlue,
      totalCoverage: roi.coverageRatio,
      centerCoverage: roi.centerCoverage,
      circularity: roi.coverageRatio > 0.5 ? 1.0 : roi.coverageRatio * 2,
      compactness: roi.spatialUniformity,
      edgePenalty: 0, // Not available from ROI
      entropy: 0, // Not available from ROI
      gradient: 0, // Not available from ROI
      spatialUniformity: roi.spatialUniformity,
      hotSpotRatio: 0, // Not available from ROI
      clipHighRatio: roi.clipHighRatio,
      clipLowRatio: roi.clipLowRatio,
      temporalStability: 1.0, // Will be updated by classifier
    };
    
    // Calculate HSV from mean RGB
    const rn = roi.rawRed / 255;
    const gn = roi.rawGreen / 255;
    const bn = roi.rawBlue / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    let h = 0;
    let s = 0;
    const v = max;
    if (delta !== 0) {
      s = delta / max;
      if (max === rn) {
        h = ((gn - bn) / delta) % 6;
      } else if (max === gn) {
        h = (bn - rn) / delta + 2;
      } else {
        h = (rn - gn) / delta + 4;
      }
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }
    features.hue = h;
    features.saturation = s;
    features.value = v;
    features.saturationHigh = s > 0.6;
    features.saturationLow = s < 0.1;

    const contactClassification = this.contactClassifier.classify(features, this.motionScore);
    this.lastContactClassification = contactClassification;
    
    // Map classifier state to extended contact state
    const classifierToExtended = (state: string): ExtendedContactState => {
      switch (state) {
        case 'NO_FINGER': return 'NO_CONTACT';
        case 'PARTIAL_CONTACT': return 'ACQUIRING_CONTACT';
        case 'GOOD_CONTACT': return 'STABLE_CONTACT';
        case 'OVERPRESSURE': return 'EXCESSIVE_PRESSURE';
        case 'UNDERILLUMINATED': return 'UNSTABLE_CONTACT';
        case 'EXCESSIVE_CLIPPING': return 'SATURATED_CONTACT';
        case 'MOTION_CONTAMINATED': return 'UNSTABLE_CONTACT';
        default: return 'NO_CONTACT';
      }
    };
    
    this.contactState = classifierToExtended(contactClassification.state);
    this.fingerDetected = contactClassification.state !== 'NO_FINGER';
    this.fingerConfidenceCount = contactClassification.confidence > 0.7 ? Math.min(this.fingerConfidenceCount + 1, 200) : Math.max(0, this.fingerConfidenceCount - 0.3);
    
    // Update smoothed metrics from classifier features
    if (contactClassification.features) {
      const f = contactClassification.features;
      this.smoothedRed += (f.meanR - this.smoothedRed) * this.RGB_ALPHA;
      this.smoothedGreen += (f.meanG - this.smoothedGreen) * this.RGB_ALPHA;
      this.smoothedBlue += (f.meanB - this.smoothedBlue) * this.RGB_ALPHA;
      this.smoothedCoverage += (f.totalCoverage - this.smoothedCoverage) * this.COV_ALPHA;
    }

    // Map extended state to standard ContactState for export
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

    // --- Contact detected: apply quality gate before buffering ---
    // Map standard ContactState to FrameQualityGate's ContactState
    const mapToGateContactState = (state: ContactState): import('./core/FrameQualityGate').ContactState => {
      switch (state) {
        case 'NO_CONTACT': return 'NO_CONTACT';
        case 'UNSTABLE_CONTACT': return 'PARTIAL_CONTACT';
        case 'STABLE_CONTACT': return 'GOOD_CONTACT';
        default: return 'NO_CONTACT';
      }
    };
    
    const gateInput: FrameQualityInput = {
      contactState: mapToGateContactState(this.exportedContactState),
      globalSQI: this.signalQuality,
      motionScore: this.motionScore,
      clipHighRatio: roi.clipHighRatio,
      clipLowRatio: roi.clipLowRatio,
      brightness: roi.brightness,
      coverageRatio: roi.coverageRatio,
      spatialUniformity: roi.spatialUniformity,
      perfusionIndex: this.calculatePerfusionIndex(),
    };
    this.gateResult = this.qualityGate.evaluate(gateInput);
    
    if (!this.gateResult.pass) {
      this.onSignalReady({
        timestamp,
        rawValue: roi.rawRed + roi.rawGreen,
        filteredValue: this.filteredBuf.length > 0 ? this.filteredBuf.get(this.filteredBuf.length - 1) : 0,
        quality: this.signalQuality,
        fingerDetected: this.fingerDetected,
        contactState: this.exportedContactState,
        motionArtifact,
        roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
        perfusionIndex: this.calculatePerfusionIndex(),
        rawRed: roi.rawRed,
        rawGreen: roi.rawGreen,
        rawBlue: roi.rawBlue,
        // New metrics
        fusionConfidence: 0,
        effectiveTileCount: 0,
        gateScore: this.gateResult.confidence,
        frameAccepted: false,
        rejectionReason: this.gateResult.reason,
        motionScore: this.motionScore,
        clipHighRatio: roi.clipHighRatio,
        clipLowRatio: roi.clipLowRatio,
        spectralSNR: 0,
        peakProminence: 0,
        harmonicConsistency: 0,
        zeroCrossingRate: 0,
        temporalStability: 0,
        spatialUniformity: roi.spatialUniformity,
        centerCoverage: roi.centerCoverage,
        coverageRatio: roi.coverageRatio,
        pressureState: this.pressureState,
        sampleRate: this.estimatedSampleRate,
      });
      this.processingTimeMs = performance.now() - t0;
      return;
    }

    // --- Gate passed: process signal ---
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
    const enhancedMetrics = source.enhancedMetrics;

    // Track source stability
    if (source.label === this.lastSourceLabel) {
      this.sourceStableFrames = Math.min(this.sourceStableFrames + 1, 300);
    } else {
      this.sourceStableFrames = 0;
      this.lastSourceLabel = source.label;
    }
    this.sourceStability = Math.min(1, this.sourceStableFrames / 60);

    // --- TILE FUSION (real signal fusion) ---
    const tileSignals: TileSignal[] = roi.tileMetrics.map((tm, idx) => {
      const tileR = tm.trimmedMeanR || tm.meanR;
      const tileG = tm.trimmedMeanG || tm.meanG;
      const tileB = tm.trimmedMeanB || tm.meanB;
      const tileDC = this.redBaseline > 0 ? this.redBaseline : tileR;
      const tileGC = this.greenBaseline > 0 ? this.greenBaseline : tileG;
      const tileBC = this.blueBaseline > 0 ? this.blueBaseline : tileB;
      const eps = 1e-6;
      
      return {
        tileIndex: idx,
        redNorm: tileDC > 10 ? (tileDC - tileR) / tileDC : 0,
        greenNorm: tileGC > 10 ? (tileGC - tileG) / tileGC : 0,
        blueNorm: tileBC > 10 ? (tileBC - tileB) / tileBC : 0,
        redOD: tileDC > 10 ? -Math.log((tileR + eps) / tileDC) : 0,
        greenOD: tileGC > 10 ? -Math.log((tileG + eps) / tileGC) : 0,
        blueOD: tileBC > 10 ? -Math.log((tileB + eps) / tileBC) : 0,
        perfusionIndex: tileGC > 0 ? (tm.variance / tileGC) * 100 : 0,
        clipHighRatio: tm.clipHighPct,
        clipLowRatio: tm.clipLowPct,
        variance: tm.variance,
        temporalStability: tm.temporalStability,
        centerDistance: tm.centerDistance,
      };
    }).filter(t => t.perfusionIndex > 0.1);
    
    const fusionRedPI = this.redDC > 0 ? (this.redAC / this.redDC) * 100 : 0;
    const fusionGreenPI = this.greenDC > 0 ? (this.greenAC / this.greenDC) * 100 : 0;
    const fusionBluePI = this.blueDC > 0 ? (this.blueAC / this.blueDC) * 100 : 0;
    
    const channelWeights = this.fusionEngine.computeChannelWeights(
      fusionRedPI, fusionGreenPI, fusionBluePI,
      roi.clipHighRatio, roi.clipHighRatio, roi.clipHighRatio,
      this.motionScore
    );
    
    this.fusionResult = this.fusionEngine.fuseTileSignals(tileSignals, channelWeights);
    
    // Use fused signal as primary signal input
    const fusedSignal = this.fusionResult?.fusedSignal ?? (roi.rawRed + roi.rawGreen) / 2;
    const fusionConfidence = this.fusionResult?.qualityScore ?? 0;
    const effectiveTileCount = this.fusionResult?.weights.tileWeights.filter(w => w > 0.01).length ?? 0;

    // --- FILTERING (Dual-band) ---
    // Use fused signal instead of source.value
    this.rawSignalBuf.push(fusedSignal);
    const filterResult = this.bandpassFilter.filter(fusedSignal, timestamp);
    const filtered = filterResult.heartBand; // Use heart band for main signal
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
      rawValue: fusedSignal,
      filteredValue: filtered,
      quality: gatedQuality,
      fingerDetected: this.fingerDetected,
      contactState: this.exportedContactState,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed: roi.rawRed,
      rawGreen: roi.rawGreen,
      rawBlue: roi.rawBlue,
      diagnostics: {
        message:
          `${source.label} PI:${perfusionIndex.toFixed(2)} P:${this.pressureState.charAt(0)} ` +
          `C:${(this.smoothedCoverage * 100).toFixed(0)} ${this.exportedContactState}` +
          `${motionArtifact ? ' MOV' : ''}`,
        hasPulsatility: this.exportedContactState === 'STABLE_CONTACT' && perfusionIndex >= 0.05,
        pulsatilityValue: this.exportedContactState === 'STABLE_CONTACT' ? perfusionIndex : 0,
      },
      // Enhanced metrics
      clipHighRatio: this.clipHighRatio,
      clipLowRatio: this.clipLowRatio,
      // New metrics from integration
      fusionConfidence,
      effectiveTileCount,
      gateScore: this.gateResult?.confidence ?? 1,
      frameAccepted: true,
      rejectionReason: undefined,
      motionScore: this.motionScore,
      spectralSNR: enhancedMetrics.spectralSNR,
      peakProminence: enhancedMetrics.peakProminence,
      harmonicConsistency: enhancedMetrics.harmonicConsistency,
      zeroCrossingRate: enhancedMetrics.zeroCrossingRate,
      temporalStability: roi.tileMetrics.length > 0 ? roi.tileMetrics.reduce((s, t) => s + t.temporalStability, 0) / roi.tileMetrics.length : 0,
      sourceStability: this.sourceStability,
      spatialUniformity: roi.spatialUniformity,
      centerCoverage: roi.centerCoverage,
      coverageRatio: roi.coverageRatio,
      pressureState: this.pressureState,
      sampleRate: this.estimatedSampleRate,
    });
  }

  // ══════════════════════════════════════════════════════
  //  SIGNAL PROCESSING HELPERS
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
    this.contactClassifier.reset();
    this.fusionEngine.reset();
    this.qualityGate.resetStats();
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
    // Calibration baselines
    this.noiseFloor = 0;
    this.minPerfusionThreshold = 0.002;
    this.contactStabilityThreshold = 0.3;
    // Fusion and gate
    this.fusionResult = null;
    this.gateResult = null;
    this.lastContactClassification = null;
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
            })
            .catch(() => {
              // Permission denied - visual motion fallback will be used
            });
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
