import type {
  ProcessedSignal,
  ProcessingError,
  SignalProcessor as SignalProcessorInterface,
  ContactState,
  ExtendedContactState,
} from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { RingBuffer } from './RingBuffer';
import { WorkerizedFramePipeline } from './WorkerizedFramePipeline';
import type { FrameAnalysisResult } from './FrameAnalysisCore';
import type { ContactMachineState } from './ContactStateMachine';
import { computeGlobalSQI } from './SignalQualityEstimator';
import type { CameraControlEngine } from './CameraControlEngine';
import type { DebugTelemetry } from './DebugTelemetry';
import { emptyTiming } from './DebugTelemetry';
import {
  evaluateCanonicalPose,
  canonicalPoseGuidance,
  type CanonicalPoseResult,
} from './CanonicalFingerPose';
import type { CaptureTimingContext } from '../camera/CaptureMetrology';

export type ProcessFrameOptions = {
  /** Metrología RVFC (Etapa A); si confianza suficiente, gobierna Fs y filtro */
  captureTiming?: CaptureTimingContext;
};

/**
 * PPG etapa 1: delega ROI/contacto/extracción/SQI a FrameAnalysisCore (main o Worker),
 * aplica filtrado, gating de medición y telemetría. Sin lógica duplicada de tiles en hot path local.
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing = false;

  private readonly pipeline: WorkerizedFramePipeline;
  private bandpassFilter: BandpassFilter;
  private readonly filteredBuf = new RingBuffer(300);
  private readonly rawSignalBuf = new RingBuffer(300);
  /** Mediana móvil sobre bruto: suprime saltos por ROI/fuente (11 samples, median of 7) */
  private readonly rawPrefilterBuf = new RingBuffer(11);
  private readonly frameTimeBuf = new RingBuffer(120);

  private cameraControl: CameraControlEngine | null = null;

  private estimatedSampleRate = 30;
  private lastFrameTime = 0;
  private realFps = 0;
  private frameCount = 0;

  private exportedContactState: ContactState = 'NO_CONTACT';
  private extendedState: ExtendedContactState = 'NO_CONTACT';

  private fingerDetected = false;
  private signalQuality = 0;
  private measurementReadyLatched = false;
  private measurementReadyHoldFrames = 0;
  private measurementReadyLostFrames = 0;
  private readonly MEASUREMENT_READY_ON_FRAMES = 12;
  private readonly MEASUREMENT_READY_OFF_FRAMES = 14;

  private positionLocked = false;
  private lockedRedBase = 0;
  private lockedGreenBase = 0;
  private lockedCoverage = 0;
  private positionStabilityCount = 0;
  private readonly POS_LOCK_FRAMES = 28;
  private readonly POS_DRIFT_TOL = 0.13;
  /** Pose óptima bloqueada (centroide + gradientes R) — un solo ángulo de medición */
  private lockedPoseNx = 0.5;
  private lockedPoseNy = 0.5;
  private lockedPoseGy = 0;
  private lockedPoseGx = 0;
  /** Desviación respecto a la pose bloqueada (0 ≈ mismo ángulo yema/base) */
  private poseAngleDrift = 0;
  private readonly POSE_DRIFT_MEASURE_MAX = 0.076;
  private readonly POSE_DRIFT_SOFT = 0.09;
  private readonly POSE_DRIFT_UNLOCK = 0.2;
  private positionDrifting = false;
  private positionDrift = 0;
  private positionGuidance = 'COLOQUE SU DEDO SOBRE LA CÁMARA Y EL FLASH';
  private positionQualityScore = 0;

  private motionScore = 0;
  /** EMA del movimiento: evita cortar medición por picos breves del acelerómetro */
  private motionScoreSmoothed = 0;
  private motionListenerActive = false;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private readonly MOTION_THRESH = 0.62;

  private activeSourceLabel = 'RG';
  private allSourceSQI: Record<string, number> = {};
  private sourceStability = 0;
  private sourceStableFrames = 0;
  private lastSourceLabel = 'RG';

  private lastAnalysis: FrameAnalysisResult | null = null;
  private lastCanonicalPose: CanonicalPoseResult = { ok: false, issue: 'PRESSURE_LOW' };
  private lastCaptureTiming: CaptureTimingContext | null = null;
  private debugMode = false;

  private lastLogTime = 0;
  private processingTimeMs = 0;

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.pipeline = new WorkerizedFramePipeline({ preferWorker: true });
    this.bandpassFilter = new BandpassFilter(this.estimatedSampleRate);
  }

  setCameraControl(engine: CameraControlEngine | null): void {
    this.cameraControl = engine;
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  getLastFrameAnalysis(): FrameAnalysisResult | null {
    return this.lastAnalysis;
  }

  async initialize(): Promise<void> {
    this.reset();
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    void this.initialize();
    this.startMotionListener();
  }

  stop(): void {
    this.isProcessing = false;
    this.stopMotionListener();
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  processFrame(frame: ImageData | ImageBitmap, frameTimestamp?: number, opts?: ProcessFrameOptions): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    const t0 = performance.now();
    this.frameCount++;
    const timestamp = frameTimestamp ?? performance.now();
    const ct = opts?.captureTiming;
    if (
      ct &&
      ct.timingConfidence >= 0.22 &&
      ct.kalmanSampleRateHz >= 15 &&
      ct.kalmanSampleRateHz <= 60 &&
      isFinite(ct.kalmanSampleRateHz)
    ) {
      // Usar Kalman filter para estimación más suave y robusta
      this.estimatedSampleRate = ct.kalmanSampleRateHz;
      this.realFps = ct.sampleRateHz;
      this.bandpassFilter.setSampleRate(ct.kalmanSampleRateHz);
      this.lastFrameTime = timestamp;
      this.lastCaptureTiming = ct;
      
      // Log de métricas extendidas para debugging
      if (ct.jitterStdMs > 0) {
        // Jitter estándar disponible
      }
      if (ct.sampleRateDriftHzPerSec !== 0) {
        // Drift detectado
      }
    } else {
      this.updateSampleRate(timestamp);
      this.lastCaptureTiming = null;
    }

    this.pipeline.setFrameSampleRate(this.estimatedSampleRate);

    this.motionScoreSmoothed = this.motionScoreSmoothed * 0.82 + this.motionScore * 0.18;
    const motionArtifact = this.motionScoreSmoothed > this.MOTION_THRESH;
    const isBm = typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap;
    const analysis = isBm
      ? this.pipeline.processBitmap(frame, timestamp, motionArtifact)
      : this.pipeline.process(frame as ImageData, timestamp, motionArtifact);

    const dims = isBm ? { width: frame.width, height: frame.height } : { width: (frame as ImageData).width, height: (frame as ImageData).height };

    if (!analysis) {
      this.emitEmpty(timestamp, dims.width, dims.height, motionArtifact, t0);
      return;
    }

    this.lastAnalysis = analysis;
    this.applyContactMapping(analysis.contactRaw);

    this.cameraControl?.feedbackFrame(
      analysis.clipHighRatio,
      analysis.clipLowRatio,
      analysis.perfusionIndex < 2.8,
      analysis.contactRaw === 'CONTACT_UNSTABLE' || analysis.contactRaw === 'ACQUIRING'
    );

    const roi = analysis.roi;
    const pressureState = analysis.pressureState;
    const pressurePenalty = analysis.pressurePenalty;

    this.updatePositionLock(analysis);

    const periodicityScore = this.estimatePeriodicityFromFiltered();

    const active = analysis.activeSource;
    if (active === this.lastSourceLabel) {
      this.sourceStableFrames = Math.min(this.sourceStableFrames + 1, 400);
    } else {
      this.sourceStableFrames = 0;
      this.lastSourceLabel = active;
    }
    this.sourceStability = Math.min(1, this.sourceStableFrames / 72);
    this.activeSourceLabel = active;
    this.allSourceSQI = { ...analysis.allSQI };

    this.rawPrefilterBuf.push(analysis.sourceValue);
    const rawDenoised =
      this.rawPrefilterBuf.length >= 5
        ? this.rawPrefilterBuf.medianLast(Math.min(7, this.rawPrefilterBuf.length))
        : analysis.sourceValue;
    this.rawSignalBuf.push(rawDenoised);
    const filtered = this.bandpassFilter.filter(rawDenoised);
    this.filteredBuf.push(filtered);

    const perfusionIndex = analysis.perfusionIndex;
    const signalRange = this.getSignalRange();
    const redDominance = analysis.rawRed - (analysis.rawGreen + analysis.rawBlue) / 2;
    const rbRatio =
      analysis.rawBlue > 0.75 ? analysis.rawRed / analysis.rawBlue : 0;

    this.signalQuality = computeGlobalSQI({
      perfusionIndex: perfusionIndex / 100,
      periodicityScore,
      coverageRatio: analysis.coverageRatio,
      spatialUniformity: analysis.spatialUniformity,
      pressurePenalty,
      motionScore: this.motionScore,
      clipHighRatio: analysis.clipHighRatio,
      clipLowRatio: analysis.clipLowRatio,
      positionDrift: this.positionDrift,
      signalRange,
      redDominance,
      contactState: this.exportedContactState,
      sourceStability: this.sourceStability,
      roiValidRatio: analysis.roiValidPixelRatio,
      maskIoU: analysis.maskIoU,
      rbRatio,
    });

    const driftPenalty = this.positionDrifting ? 0.14 : 1.0;
    const gatedQuality =
      this.exportedContactState === 'STABLE_CONTACT' && perfusionIndex >= 1.2
        ? this.signalQuality * driftPenalty
        : Math.min(18, this.signalQuality * 0.45);

    const measurementReadyRaw = this.computeMeasurementReadyRaw(
      perfusionIndex / 100,
      gatedQuality,
      periodicityScore,
      motionArtifact,
      analysis.clipHighRatio,
      analysis.spatialUniformity
    );
    const measurementReady = this.updateMeasurementReadyLatch(measurementReadyRaw);

    this.processingTimeMs = performance.now() - t0;

    const pipeStats = this.pipeline.getStats();
    const debug: DebugTelemetry | undefined = this.debugMode
      ? {
          contactState: analysis.contactRaw,
          coverage: analysis.coverageRatio,
          clipHigh: analysis.clipHighRatio,
          clipLow: analysis.clipLowRatio,
          pressureProxy: analysis.pressureScore,
          pressureState,
          roiBBox: analysis.roiBBox,
          activeTileCount: analysis.activeTileCount,
          discardedTileCount: analysis.discardedTileCount,
          activeTileSample: analysis.activeTileSample,
          activeSource: this.activeSourceLabel,
          sqiBySource: this.allSourceSQI,
          readinessReason: analysis.readinessReason,
          timing: {
            ...emptyTiming(),
            inputFps: pipeStats.inputFps,
            processedFps: pipeStats.processedFps,
            droppedFrames: pipeStats.droppedFrames,
            lastFrameLatencyMs: pipeStats.lastFrameLatencyMs,
            workerRoundtripMs: pipeStats.workerRoundtripMs,
            readbackMs: pipeStats.readbackMs,
          },
          globalScore: analysis.fingerScore,
          spatialStability: analysis.spatialStabilityROI,
          stalePipeline: pipeStats.staleResult,
          roiValidPixelRatio: analysis.roiValidPixelRatio,
          maskIoU: analysis.maskIoU,
        }
      : undefined;

    if (performance.now() - this.lastLogTime > 4000) {
      this.lastLogTime = performance.now();
      const lct = this.lastCaptureTiming;
      console.log(
        `📷 PPG [${this.activeSourceLabel}] Q=${gatedQuality.toFixed(0)} PI=${perfusionIndex.toFixed(2)} ` +
          `${this.exportedContactState} worker=${pipeStats.workerActive ? 'on' : 'off'} ` +
          `Fs=${lct ? lct.kalmanSampleRateHz.toFixed(1) : this.estimatedSampleRate.toFixed(1)}` +
          `(raw=${lct ? lct.sampleRateHz.toFixed(1) : this.realFps.toFixed(1)}) ` +
          `jitter=${lct ? lct.jitterMadMs.toFixed(1) : '?'}(std=${lct ? lct.jitterStdMs.toFixed(1) : '?'}) ` +
          `drift=${lct ? lct.sampleRateDriftHzPerSec.toFixed(3) : '?'} ` +
          `skew=${lct ? lct.deltaSkew.toFixed(3) : '?'} ` +
          `conf=${lct ? lct.timingConfidence.toFixed(2) : '0'} ` +
          `drops=${lct ? lct.frameDropCount : 0} ` +
          `win=${lct ? lct.windowSize : 0} ` +
          `dropped=${pipeStats.droppedFrames}`
      );
    }

    this.onSignalReady({
      timestamp,
      rawValue: rawDenoised,
      filteredValue: filtered,
      quality: gatedQuality,
      fingerDetected: this.fingerDetected,
      measurementReady,
      contactState: this.exportedContactState,
      extendedContactState: this.extendedState,
      motionArtifact,
      roi: this.roiRectFromAnalysisBBox(analysis.roiBBox, dims.width, dims.height),
      perfusionIndex,
      rawRed: analysis.rawRed,
      rawGreen: analysis.rawGreen,
      rawBlue: analysis.rawBlue,
      clipHighRatio: analysis.clipHighRatio,
      clipLowRatio: analysis.clipLowRatio,
      roiCoverage: analysis.coverageRatio,
      pressureState,
      activeSource: this.activeSourceLabel,
      sourceStability: this.sourceStability,
      sqiBySource: this.allSourceSQI,
      estimatedSampleRate: this.estimatedSampleRate,
      realFps: this.realFps,
      captureTimingConfidence: this.lastCaptureTiming?.timingConfidence,
      presentationJitterMs: this.lastCaptureTiming?.jitterMadMs,
      processingDurationMs: this.processingTimeMs,
      diagnostics: {
        message: `${this.activeSourceLabel} PI:${perfusionIndex.toFixed(2)} ${this.exportedContactState} ${analysis.readinessReason}`,
        hasPulsatility: measurementReady,
        pulsatilityValue: measurementReady ? perfusionIndex / 100 : 0,
      },
      canonicalPoseOk: this.lastCanonicalPose.ok,
      canonicalPoseIssue: this.lastCanonicalPose.issue,
      pipelineDebug: debug,
      inputFps: pipeStats.inputFps,
      processedFps: pipeStats.processedFps,
      droppedFrames: pipeStats.droppedFrames,
      frameLatencyMs: pipeStats.lastFrameLatencyMs,
      roiValidPixelRatio: analysis.roiValidPixelRatio,
      maskIoU: analysis.maskIoU,
    });
  }

  /**
   * ROI en píxeles según el bbox del `AdaptiveROIAssembler` (meta-ROI), acotado al frame.
   * Antes se exportaba el rectángulo completo y desalineaba telemetría/visualización.
   */
  private roiRectFromAnalysisBBox(
    bbox: { sx: number; sy: number; ex: number; ey: number },
    frameW: number,
    frameH: number
  ): { x: number; y: number; width: number; height: number } {
    const fw = Math.max(1, frameW);
    const fh = Math.max(1, frameH);
    let x0 = Math.floor(bbox.sx);
    let y0 = Math.floor(bbox.sy);
    let x1 = Math.ceil(bbox.ex);
    let y1 = Math.ceil(bbox.ey);
    if (x1 <= x0 || y1 <= y0) {
      return { x: 0, y: 0, width: fw, height: fh };
    }
    x0 = Math.max(0, Math.min(fw - 1, x0));
    y0 = Math.max(0, Math.min(fh - 1, y0));
    x1 = Math.max(x0 + 1, Math.min(fw, x1));
    y1 = Math.max(y0 + 1, Math.min(fh, y1));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  private emitEmpty(
    timestamp: number,
    width: number,
    height: number,
    motionArtifact: boolean,
    t0: number
  ): void {
    this.processingTimeMs = performance.now() - t0;
    this.onSignalReady?.({
      timestamp,
      rawValue: 0,
      filteredValue: 0,
      quality: 0,
      fingerDetected: false,
      measurementReady: false,
      contactState: 'NO_CONTACT',
      extendedContactState: 'NO_CONTACT',
      motionArtifact,
      roi: { x: 0, y: 0, width, height },
      perfusionIndex: 0,
      rawRed: 0,
      rawGreen: 0,
      rawBlue: 0,
      clipHighRatio: 0,
      clipLowRatio: 0,
      roiCoverage: 0,
      pressureState: 'LOW_PRESSURE',
      activeSource: this.activeSourceLabel,
      sourceStability: 0,
      sqiBySource: {},
      estimatedSampleRate: this.estimatedSampleRate,
      realFps: this.realFps,
      captureTimingConfidence: this.lastCaptureTiming?.timingConfidence,
      presentationJitterMs: this.lastCaptureTiming?.jitterMadMs,
      processingDurationMs: this.processingTimeMs,
      diagnostics: {
        message: 'NO_FRAME_ANALYSIS',
        hasPulsatility: false,
        pulsatilityValue: 0,
      },
      canonicalPoseOk: false,
      canonicalPoseIssue: 'PRESSURE_LOW',
    });
  }

  private applyContactMapping(raw: ContactMachineState): void {
    switch (raw) {
      case 'NO_FINGER':
        this.exportedContactState = 'NO_CONTACT';
        this.extendedState = 'NO_CONTACT';
        this.fingerDetected = false;
        break;
      case 'ACQUIRING':
        this.exportedContactState = 'UNSTABLE_CONTACT';
        this.extendedState = 'ACQUIRING_CONTACT';
        this.fingerDetected = false;
        break;
      case 'CONTACT_UNSTABLE':
        this.exportedContactState = 'UNSTABLE_CONTACT';
        this.extendedState = 'UNSTABLE_CONTACT';
        this.fingerDetected = false;
        break;
      case 'CONTACT_STABLE':
        this.exportedContactState = 'STABLE_CONTACT';
        this.extendedState = 'STABLE_CONTACT';
        this.fingerDetected = true;
        break;
      case 'SATURATED':
        this.exportedContactState = 'UNSTABLE_CONTACT';
        this.extendedState = 'SATURATED_CONTACT';
        this.fingerDetected = false;
        break;
      case 'LOW_PERFUSION':
        this.exportedContactState = 'UNSTABLE_CONTACT';
        this.extendedState = 'UNSTABLE_CONTACT';
        this.fingerDetected = false;
        break;
      case 'EXCESS_PRESSURE':
        this.exportedContactState = 'UNSTABLE_CONTACT';
        this.extendedState = 'EXCESSIVE_PRESSURE';
        this.fingerDetected = false;
        break;
      default:
        this.exportedContactState = 'NO_CONTACT';
        this.extendedState = 'NO_CONTACT';
        this.fingerDetected = false;
    }

    if (this.exportedContactState === 'NO_CONTACT') {
      this.measurementReadyHoldFrames = 0;
      this.measurementReadyLostFrames = 0;
      this.measurementReadyLatched = false;
    }
  }

  private computeMeasurementReadyRaw(
    perfusionIndexNorm: number,
    gatedQuality: number,
    periodicityScore: number,
    motionArtifact: boolean,
    clipHighRatio: number,
    spatialUniformity: number
  ): boolean {
    if (motionArtifact) return false;
    if (this.motionScoreSmoothed > 0.44) return false;
    if (this.exportedContactState !== 'STABLE_CONTACT') return false;
    if (!this.fingerDetected) return false;
    if (!this.positionLocked || this.positionDrifting) return false;
    if (this.poseAngleDrift > this.POSE_DRIFT_MEASURE_MAX) return false;
    if (this.lastAnalysis?.pressureState === 'HIGH_PRESSURE') return false;
    if (clipHighRatio > 0.22) return false;
    if (!this.lastCanonicalPose.ok) return false;
    if (perfusionIndexNorm < 0.034) return false;
    if (gatedQuality < 19) return false;
    if (periodicityScore < 0.13) return false;
    if ((this.lastAnalysis?.coverageRatio ?? 0) < 0.2) return false;
    if (this.sourceStability < 0.2) return false;
    if (spatialUniformity < 0.22) return false;

    const a = this.lastAnalysis;
    if (a) {
      const rr = a.rawRed;
      const gg = a.rawGreen;
      if (rr < 48 || gg < 7 || rr / Math.max(gg, 1) < 1.04) return false;
      if (a.fingerScore < 0.14) return false;
      const sq = Object.values(a.allSQI);
      // SQI por fuente está en 0..1 (SignalQualityScorer)
      if (sq.length === 0 || Math.max(...sq) < 0.14) return false;
      if (a.readinessReason !== 'ok') return false;
      const tb = a.rawBlue ?? 0;
      if (tb > 2 && a.rawRed / tb < 1.03) return false;
      if ((a.maskIoU ?? 0) < 0.22) return false;
    }
    return true;
  }

  private updateMeasurementReadyLatch(raw: boolean): boolean {
    if (this.exportedContactState === 'NO_CONTACT') {
      this.measurementReadyHoldFrames = 0;
      this.measurementReadyLostFrames = 0;
      this.measurementReadyLatched = false;
      return false;
    }
    if (raw) {
      this.measurementReadyHoldFrames++;
      this.measurementReadyLostFrames = 0;
      if (this.measurementReadyHoldFrames >= this.MEASUREMENT_READY_ON_FRAMES) {
        this.measurementReadyLatched = true;
      }
    } else {
      this.measurementReadyLostFrames++;
      this.measurementReadyHoldFrames = 0;
      if (this.measurementReadyLostFrames >= this.MEASUREMENT_READY_OFF_FRAMES) {
        this.measurementReadyLatched = false;
      }
    }
    return this.measurementReadyLatched;
  }

  private updatePositionLock(a: FrameAnalysisResult): void {
    const canon = evaluateCanonicalPose(a);
    this.lastCanonicalPose = canon;

    if (!this.positionLocked) {
      this.poseAngleDrift = 0;
    }

    const roi = a.roi;
    const currentRed = roi.rawRed;
    const currentGreen = roi.rawGreen;

    this.positionQualityScore =
      roi.coverageRatio * 0.34 + roi.spatialUniformity * 0.36 + roi.centerCoverage * 0.3;

    if (this.positionLocked) {
      const redDrift = this.lockedRedBase > 0 ? Math.abs(currentRed - this.lockedRedBase) / this.lockedRedBase : 0;
      const greenDrift =
        this.lockedGreenBase > 0 ? Math.abs(currentGreen - this.lockedGreenBase) / this.lockedGreenBase : 0;
      const covDrift =
        this.lockedCoverage > 0 ? Math.abs(roi.coverageRatio - this.lockedCoverage) / this.lockedCoverage : 0;
      const colorDrift = (redDrift + greenDrift + covDrift) / 3;

      const pc = a.poseCentroidNorm;
      const dCent = Math.hypot(pc.x - this.lockedPoseNx, pc.y - this.lockedPoseNy);
      const dGrad =
        Math.abs(a.poseRedGradientY - this.lockedPoseGy) * 0.5 + Math.abs(a.poseRedGradientX - this.lockedPoseGx) * 0.45;
      this.poseAngleDrift = dCent * 0.78 + dGrad;

      const poseNorm = Math.min(1, this.poseAngleDrift / 0.11);
      this.positionDrift = colorDrift * 0.42 + poseNorm * 0.58;

      const angleBad = this.poseAngleDrift > this.POSE_DRIFT_SOFT;
      const colorBad = colorDrift > this.POS_DRIFT_TOL;

      if (colorBad || angleBad) {
        this.positionDrifting = true;
        if (canon.ok) {
          if (angleBad && !colorBad) {
            this.positionGuidance = 'NO GIRE EL DEDO — MANTENGA LA YEMA CENTRADA (POSE DE MEDICIÓN)';
          } else {
            this.positionGuidance = '⚠️ DEDO MOVIDO — VUELVA A LA YEMA CENTRADA SOBRE LENTE Y FLASH';
          }
        }
        const unlock =
          this.poseAngleDrift > this.POSE_DRIFT_UNLOCK || colorDrift > this.POS_DRIFT_TOL * 2.35;
        if (unlock) {
          this.positionLocked = false;
          this.positionStabilityCount = 0;
          this.positionDrifting = false;
          this.poseAngleDrift = 0;
          this.positionGuidance = 'REPOSICIONE EL DEDO COMO AL INICIO';
        }
      } else {
        this.positionDrifting = false;
        const adapt = 0.003;
        this.lockedRedBase += (currentRed - this.lockedRedBase) * adapt;
        this.lockedGreenBase += (currentGreen - this.lockedGreenBase) * adapt;
        this.lockedCoverage += (roi.coverageRatio - this.lockedCoverage) * adapt;
        this.lockedPoseNx += (pc.x - this.lockedPoseNx) * 0.008;
        this.lockedPoseNy += (pc.y - this.lockedPoseNy) * 0.008;
        this.lockedPoseGy += (a.poseRedGradientY - this.lockedPoseGy) * 0.012;
        this.lockedPoseGx += (a.poseRedGradientX - this.lockedPoseGx) * 0.012;
        this.positionGuidance = canon.ok
          ? 'POSE DE MEDICIÓN — YEMA CENTRADA, PRESIÓN MODERADA; NO MUEVA'
          : canonicalPoseGuidance(canon.issue);
      }
    } else if (this.exportedContactState !== 'NO_CONTACT') {
      this.positionDrifting = false;
      const canStabilize =
        a.contactRaw === 'CONTACT_STABLE' || a.contactRaw === 'CONTACT_UNSTABLE';
      if (!canon.ok) {
        this.positionStabilityCount = Math.max(0, this.positionStabilityCount - 4);
        this.positionGuidance = canonicalPoseGuidance(canon.issue);
      } else if (
        canStabilize &&
        this.positionQualityScore > 0.46 &&
        roi.coverageRatio > 0.26 &&
        roi.fingerScore > 0.14 &&
        roi.centerCoverage > 0.14 &&
        a.pressureState !== 'HIGH_PRESSURE'
      ) {
        this.positionStabilityCount++;
        if (this.positionStabilityCount >= this.POS_LOCK_FRAMES) {
          this.positionLocked = true;
          this.lockedRedBase = currentRed;
          this.lockedGreenBase = currentGreen;
          this.lockedCoverage = roi.coverageRatio;
          this.lockedPoseNx = a.poseCentroidNorm.x;
          this.lockedPoseNy = a.poseCentroidNorm.y;
          this.lockedPoseGy = a.poseRedGradientY;
          this.lockedPoseGx = a.poseRedGradientX;
          this.poseAngleDrift = 0;
          this.positionGuidance =
            'POSE BLOQUEADA — YEMA CENTRADA SOBRE LENTE Y FLASH; NO GIRE NI CAMBIE A PUNTA O APLASTAMIENTO';
        } else {
          this.positionGuidance = `AJUSTE A LA POSE ÚNICA… ${Math.round((this.positionStabilityCount / this.POS_LOCK_FRAMES) * 100)}%`;
        }
      } else {
        this.positionStabilityCount = Math.max(0, this.positionStabilityCount - 3);
        if (a.pressureState === 'HIGH_PRESSURE') {
          this.positionGuidance = 'REDUZCA LA PRESIÓN — YEMA SUAVE, NO APLASTADA';
        } else if (roi.coverageRatio < 0.28) {
          this.positionGuidance = 'CUBRA LENTE Y FLASH CON LA YEMA (NO SOLO EL BORDE)';
        } else {
          this.positionGuidance = 'PRESIÓN MODERADA Y UNIFORME — NI PUNTA NI DEDO APLASTADO';
        }
      }
    } else {
      this.positionStabilityCount = 0;
      this.positionDrifting = false;
      this.positionGuidance = 'COLOQUE LA YEMA SOBRE LA CÁMARA Y EL FLASH — PRESIÓN MODERADA';
    }
  }

  private updateSampleRate(timestamp: number): void {
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = timestamp;
      return;
    }
    const delta = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;
    if (delta < 8 || delta > 120) return;
    this.frameTimeBuf.push(delta);
    if (this.frameTimeBuf.length < 8) return;
    const n = Math.min(30, this.frameTimeBuf.length);
    const arr = this.frameTimeBuf.last(n);
    arr.sort();
    const median = arr[Math.floor(n / 2)]!;
    const fps = Math.max(15, Math.min(60, 1000 / median));
    this.realFps = fps;
    const base = Math.max(this.estimatedSampleRate, 1e-6);
    if (Math.abs(fps - this.estimatedSampleRate) / base > 0.07) {
      this.estimatedSampleRate = fps;
      this.bandpassFilter.setSampleRate(fps);
    }
  }

  private getSignalRange(): number {
    if (this.filteredBuf.length < 28) return 0;
    const mm = this.filteredBuf.minMax(90);
    return mm.max - mm.min;
  }

  private estimatePeriodicityFromFiltered(): number {
    if (this.filteredBuf.length < 50) return 0;
    const n = Math.min(120, this.filteredBuf.length);
    let best = 0;
    for (let lag = 8; lag <= 60; lag++) {
      const ac = this.filteredBuf.autocorrelation(lag, n);
      if (ac > best) best = ac;
    }
    return Math.max(0, Math.min(1, best));
  }

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
    this.motionScore = this.motionScore * 0.86 + (accelRMS * 0.48 + gyroRMS * 0.28) * 0.14;
  };

  private startMotionListener(): void {
    if (this.motionListenerActive) return;
    try {
      if (typeof DeviceMotionEvent !== 'undefined') {
        if (typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
          (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> })
            .requestPermission()
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
    } catch {
      /* noop */
    }
  }

  private stopMotionListener(): void {
    if (!this.motionListenerActive) return;
    window.removeEventListener('devicemotion', this.handleMotionEvent);
    this.motionListenerActive = false;
    this.motionScore = 0;
  }

  getRGBStats() {
    const a = this.lastAnalysis;
    return {
      redAC: a?.redAC ?? 0,
      redDC: a?.redDC ?? 0,
      greenAC: a?.greenAC ?? 0,
      greenDC: a?.greenDC ?? 0,
      rgRatio: a && a.greenDC > 0 ? a.redDC / a.greenDC : 0,
      ratioOfRatios:
        a && a.greenDC > 0 && a.greenAC > 0 && a.redDC > 0
          ? (a.redAC / a.redDC) / (a.greenAC / a.greenDC)
          : 0,
    };
  }

  getPositionQuality() {
    const a = this.lastAnalysis;
    return {
      locked: this.positionLocked,
      drifting: this.positionDrifting,
      spatialUniformity: a?.spatialUniformity ?? 0,
      centerCoverage: a?.roi.centerCoverage ?? 0,
      positionDrift: this.positionDrift,
      guidance: this.positionGuidance,
      qualityScore: this.positionQualityScore,
      poseAngleDrift: this.poseAngleDrift,
      poseOptimal:
        this.positionLocked &&
        !this.positionDrifting &&
        this.poseAngleDrift <= this.POSE_DRIFT_MEASURE_MAX &&
        this.lastCanonicalPose.ok,
      canonicalPoseOk: this.lastCanonicalPose.ok,
      canonicalPoseIssue: this.lastCanonicalPose.issue,
    };
  }

  getEstimatedSampleRate(): number {
    return this.estimatedSampleRate;
  }

  getDebugInfo() {
    const a = this.lastAnalysis;
    const ps = this.pipeline.getStats();
    return {
      contactState: a?.contactRaw ?? 'NO_FINGER',
      exportedState: this.exportedContactState,
      pressureState: a?.pressureState ?? 'LOW_PRESSURE',
      pressurePenalty: a?.pressurePenalty ?? 1,
      activeSource: this.activeSourceLabel,
      allSourceSQI: this.allSourceSQI,
      realFps: this.realFps,
      processingTimeMs: this.processingTimeMs,
      sqiGlobal: this.signalQuality,
      clipHighRatio: a?.clipHighRatio ?? 0,
      clipLowRatio: a?.clipLowRatio ?? 0,
      perfusionIndex: a?.perfusionIndex ?? 0,
      coverageRatio: a?.coverageRatio ?? 0,
      positionDrift: this.positionDrift,
      positionLocked: this.positionLocked,
      spatialUniformity: a?.spatialUniformity ?? 0,
      sourceStability: this.sourceStability,
      motionScore: this.motionScore,
      validROIPixels: a?.roi.validPixelCount ?? 0,
      guidance: this.positionGuidance,
      worker: ps.workerActive,
      inputFps: ps.inputFps,
      processedFps: ps.processedFps,
      droppedFrames: ps.droppedFrames,
      latencyMs: ps.lastFrameLatencyMs,
      activeTileCount: a?.activeTileCount,
      discardedTileCount: a?.discardedTileCount,
      stalePipeline: ps.staleResult,
      sampleRateHint: a?.sampleRateHint,
    };
  }

  reset(): void {
    this.pipeline.reset();
    this.filteredBuf.clear();
    this.rawSignalBuf.clear();
    this.rawPrefilterBuf.clear();
    this.frameTimeBuf.clear();
    this.bandpassFilter.reset();
    this.bandpassFilter.setSampleRate(30);
    this.estimatedSampleRate = 30;
    this.lastCaptureTiming = null;
    this.realFps = 0;
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.exportedContactState = 'NO_CONTACT';
    this.extendedState = 'NO_CONTACT';
    this.fingerDetected = false;
    this.signalQuality = 0;
    this.measurementReadyLatched = false;
    this.measurementReadyHoldFrames = 0;
    this.measurementReadyLostFrames = 0;
    this.positionLocked = false;
    this.lockedRedBase = 0;
    this.lockedGreenBase = 0;
    this.lockedCoverage = 0;
    this.positionStabilityCount = 0;
    this.positionDrifting = false;
    this.positionDrift = 0;
    this.poseAngleDrift = 0;
    this.lockedPoseNx = 0.5;
    this.lockedPoseNy = 0.5;
    this.lockedPoseGy = 0;
    this.lockedPoseGx = 0;
    this.positionQualityScore = 0;
    this.positionGuidance = 'COLOQUE SU DEDO';
    this.motionScore = 0;
    this.motionScoreSmoothed = 0;
    this.lastAccel = { x: 0, y: 0, z: 0 };
    this.activeSourceLabel = 'RG';
    this.allSourceSQI = {};
    this.sourceStability = 0;
    this.sourceStableFrames = 0;
    this.lastSourceLabel = 'RG';
    this.lastAnalysis = null;
    this.lastCanonicalPose = { ok: false, issue: 'PRESSURE_LOW' };
    this.lastLogTime = 0;
    this.processingTimeMs = 0;
  }
}
