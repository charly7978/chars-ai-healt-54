import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface, ContactState } from '../../types/signal';
import { RingBuffer } from './RingBuffer';
import { AdaptiveROIMask, type ROIMaskResult } from './AdaptiveROIMask';
import { PressureProxyEstimator, type PressureState, type PressureEstimate } from './PressureProxyEstimator';
import { computeGlobalSQI } from './SignalQualityEstimator';
import { MultiROIExtractor, type ROICellMetrics } from './MultiROIExtractor';
import { ROIScorer } from './ROIScorer';
import { GreenChannelTriad } from './GreenChannelTriad';
import { SignalQualityEngine } from './SignalQualityEngine';
import { FingerMeasurementStateMachine, shouldGateBpmOutput } from './FingerMeasurementStateMachine';
import { buildFingerFrameFeatures, type FingerFrameFeatures } from './FingerFrameFeatures';
import { FrameTimingTracker } from './FrameTimingTracker';
import { ProcessingProfiler } from './ProcessingProfiler';
import type {
  FingerMeasurementState,
  ROIQualityRow,
  WindowSQIMetrics,
} from './pipeline-types';
import { ROIReputationModel } from './ROIReputationModel';
import { PerformanceModeController } from './PerformanceModeController';

/**
 * Motor cPPG: doble canvas, multi-ROI, fusión ponderada, SQI ventana, FSM de contacto,
 * timestamps reales y telemetría por etapa.
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing = false;

  private greenTriad: GreenChannelTriad;
  private roiMaskDet = new AdaptiveROIMask();
  private pressureEstimator = new PressureProxyEstimator();
  // innerFraction 0.95: cuando el dedo cubre la cámara, cubre TODO el
  // frame. ROI casi completo + sampleStep=1 maximizan los píxeles
  // efectivos. Mejora SNR como sqrt(N) porque el ruido del sensor es
  // independiente entre píxeles mientras la señal cardíaca es coherente.
  private multiRoi = new MultiROIExtractor({ gridRows: 5, gridCols: 5, innerFraction: 0.95, sampleStep: 1 });
  private roiScorer = new ROIScorer();
  private fingerMachine = new FingerMeasurementStateMachine();
  private windowSqiEngine = new SignalQualityEngine(480);
  private frameTiming = new FrameTimingTracker();
  private profiler = new ProcessingProfiler();

  private readonly BUF_SIZE = 360;
  private redBuf = new RingBuffer(this.BUF_SIZE);
  private greenBuf = new RingBuffer(this.BUF_SIZE);
  private blueBuf = new RingBuffer(this.BUF_SIZE);
  private filteredBuf = new RingBuffer(this.BUF_SIZE);
  private frameTimeBuf = new RingBuffer(120);

  private redDC = 0;
  private redAC = 0;
  private greenDC = 0;
  private greenAC = 0;
  private blueDC = 0;
  private blueAC = 0;

  private redBaseline = 0;
  private greenBaseline = 0;
  private blueBaseline = 0;
  private estimatedSampleRate = 30;
  private lastFrameTime = 0;

  /** Movimiento inyectado por frame (sensor en hook principal o worker relay) */
  private motionScore = 0;
  private readonly MOTION_THRESH = 0.6;
  private perfModeController = new PerformanceModeController();
  private roiReputation = new ROIReputationModel(25);
  private spectralGateForFinger = 0.45;
  private refinementFrame = 0;
  private lastRefinementStage: 'coarse' | 'fine' = 'coarse';
  private fineBoostEwma = 0;
  private captureContext: {
    detectionWidth: number;
    detectionHeight: number;
    extractionWidth: number;
    extractionHeight: number;
    cropSource: { sx: number; sy: number; sw: number; sh: number };
    extractionTierId: string;
    upscaleFromDetection: number;
    extractionMode: string;
  } = {
    detectionWidth: 160,
    detectionHeight: 120,
    extractionWidth: 320,
    extractionHeight: 240,
    cropSource: { sx: 0, sy: 0, sw: 1, sh: 1 },
    extractionTierId: 'M',
    upscaleFromDetection: 1,
    extractionMode: 'BALANCED',
  };

  private luminanceRing = new RingBuffer(36);
  private lastAutocorrPeak = 0;
  private lastPulseCorr = 0;
  // Estado de la triada de canales verdes (G1/G2/G3) y selección.
  private lastSelectedGreenId: 'G1' | 'G2' | 'G3' = 'G2';
  private lastTriadSqi = { g1: 0, g2: 0, g3: 0 };

  private fingerMeasurementState: FingerMeasurementState = 'NO_CONTACT';
  private exportedContactState: ContactState = 'NO_CONTACT';
  private fingerDetected = false;
  private signalQuality = 0;
  private realFps = 0;
  private processingTimeMs = 0;
  private clipHighRatio = 0;
  private clipLowRatio = 0;
  private pressureState: PressureState = 'LOW_PRESSURE';
  private pressurePenalty = 1.0;

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
  private smoothedCoverage = 0;
  private smoothedRed = 0;
  private smoothedGreen = 0;
  private smoothedBlue = 0;
  private readonly RGB_ALPHA = 0.05;
  private readonly COV_ALPHA = 0.06;

  private lastRoiDet: ROIMaskResult | null = null;
  private lastTopRois: ROIQualityRow[] = [];
  private lastWindowSqi: WindowSQIMetrics | null = null;
  private lastFingerFeatures: FingerFrameFeatures | null = null;
  private lastTiming = { intervalMs: 0, effectiveFps: 0, droppedEstimate: 0 };
  private lastRoiCells: ROICellMetrics[] = [];
  private lastRoiScores: Float64Array<ArrayBufferLike> = new Float64Array(25);

  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.greenTriad = new GreenChannelTriad(this.estimatedSampleRate);
  }

  async initialize(): Promise<void> {
    this.reset();
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.reset();
  }

  stop(): void {
    this.isProcessing = false;
  }

  /** Contexto de captura (resoluciones / crop) — lo rellena Index vía hook antes de cada frame */
  applyCaptureContext(ctx: Partial<typeof this.captureContext>): void {
    this.captureContext = { ...this.captureContext, ...ctx };
  }

  getAcquisitionProfile(): Readonly<typeof this.captureContext> {
    return this.captureContext;
  }

  processFrameDual(
    detectionImageData: ImageData,
    extractionImageData: ImageData,
    frameTimestamp?: number,
    motionScoreInput?: number
  ): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    const tAll = performance.now();
    const timestamp = frameTimestamp ?? performance.now();
    this.motionScore =
      typeof motionScoreInput === 'number' && isFinite(motionScoreInput) ? motionScoreInput : 0;

    this.updateSampleRate(timestamp);

    this.lastTiming = this.frameTiming.recordFrame(timestamp);

    const tDet = performance.now();
    const roiDet = this.roiMaskDet.process(detectionImageData);
    this.profiler.mark('extraction', performance.now() - tDet);
    this.lastRoiDet = roiDet;

    const tRoi = performance.now();
    const multi = this.multiRoi.process(extractionImageData);
    const motionLocal = this.motionScore / (this.MOTION_THRESH + 0.01);
    const specConc =
      this.lastWindowSqi?.spectral?.spectralDominanceScore ??
      this.lastAutocorrPeak * 0.55 + this.lastPulseCorr * 0.45;
    const preScored = this.roiScorer.scoreFrame(
      multi.cells,
      motionLocal,
      specConc,
      this.lastPulseCorr,
      undefined
    );
    const repMult = this.roiReputation.update(multi.cells, preScored.scores, specConc, timestamp);
    const scored = this.roiScorer.scoreFrame(
      multi.cells,
      motionLocal,
      specConc,
      this.lastPulseCorr,
      repMult
    );
    this.lastRoiCells = multi.cells;
    this.lastRoiScores = scored.scores;

    this.refinementFrame++;
    const stride = this.perfModeController.getRefinementStride();
    if (this.refinementFrame % stride === 0 && scored.topIndices.length > 0) {
      const topId = scored.topIndices[0];
      const cell = multi.cells[topId];
      const r = this.multiRoi.refineCellQuality(extractionImageData, multi.innerRect, cell.row, cell.col, 5, 5);
      this.fineBoostEwma = this.fineBoostEwma * 0.82 + r.boostCenter * 0.18;
      this.lastRefinementStage = 'fine';
    } else {
      this.lastRefinementStage = 'coarse';
    }
    const fusedRgb = MultiROIExtractor.fuseWeightedRGB(multi.cells, scored.weights);
    this.profiler.mark('roiScore', performance.now() - tRoi);

    this.clipHighRatio = Math.max(roiDet.clipHighRatio, multi.globalClipHigh);
    this.clipLowRatio = Math.max(roiDet.clipLowRatio, multi.globalClipLow);

    if (this.smoothedRed === 0) {
      this.smoothedRed = fusedRgb.r;
      this.smoothedGreen = fusedRgb.g;
      this.smoothedBlue = fusedRgb.b;
      this.smoothedCoverage = scored.topIndices.length / 25;
    } else {
      this.smoothedRed += (fusedRgb.r - this.smoothedRed) * this.RGB_ALPHA;
      this.smoothedGreen += (fusedRgb.g - this.smoothedGreen) * this.RGB_ALPHA;
      this.smoothedBlue += (fusedRgb.b - this.smoothedBlue) * this.RGB_ALPHA;
      const covEst = scored.topIndices.length / 25;
      this.smoothedCoverage += (covEst - this.smoothedCoverage) * this.COV_ALPHA;
    }

    const lum = 0.299 * fusedRgb.r + 0.587 * fusedRgb.g + 0.114 * fusedRgb.b;
    this.luminanceRing.push(lum);
    let temporalStability = 0;
    if (this.luminanceRing.length >= 12) {
      const m = this.luminanceRing.mean(24);
      const v = this.luminanceRing.variance(24);
      const cv = Math.sqrt(v) / (Math.abs(m) + 1);
      temporalStability = Math.max(0, Math.min(1, 1 - cv * 8));
    }

    const centerCells = multi.cells.filter((c) => c.row >= 1 && c.row <= 3 && c.col >= 1 && c.col <= 3);
    const centerCov =
      centerCells.length > 0
        ? centerCells.reduce((a, c) => a + (c.validFraction > 0.2 && c.meanR > 30 ? 1 : 0), 0) / centerCells.length
        : 0;
    this.centerCoverage = centerCov;

    const scoresArr = Array.from(scored.scores);
    const meanS = scoresArr.reduce((a, b) => a + b, 0) / Math.max(1, scoresArr.length);
    const varS = scoresArr.reduce((a, b) => a + (b - meanS) ** 2, 0) / Math.max(1, scoresArr.length);
    const cvS = meanS > 1e-6 ? Math.sqrt(varS) / meanS : 1;
    this.spatialUniformity = Math.max(0, Math.min(1, 1 - cvS));

    const redDom = fusedRgb.r - (fusedRgb.g + fusedRgb.b) / 2;
    const rgRat = fusedRgb.g > 1e-3 ? fusedRgb.r / fusedRgb.g : 0;
    const greenUse = fusedRgb.g / (fusedRgb.r + fusedRgb.g + fusedRgb.b + 1);

    this.updateBaselines(fusedRgb.r, fusedRgb.g, fusedRgb.b, this.motionScore > this.MOTION_THRESH);
    this.redBuf.push(fusedRgb.r);
    this.greenBuf.push(fusedRgb.g);
    this.blueBuf.push(fusedRgb.b);
    if (this.redBuf.length >= 40) this.calculateACDC();

    const perfusionProxy = this.greenDC > 0 ? this.greenAC / this.greenDC : this.redDC > 0 ? this.redAC / this.redDC : 0;

    const feats = buildFingerFrameFeatures({
      centerCoverage: this.centerCoverage,
      spatialUniformity: this.spatialUniformity,
      clipHighRatioR: roiDet.tileMetrics.length
        ? Math.max(...roiDet.tileMetrics.map((t) => t.clipHighPct))
        : this.clipHighRatio,
      clipHighRatioG: this.clipHighRatio,
      clipHighRatioB: this.clipHighRatio,
      clipLowRatio: this.clipLowRatio,
      redDominance: redDom,
      greenUsability: greenUse,
      rgRatio: rgRat,
      temporalStability,
      perfusionProxy,
      motionScore: this.motionScore,
      globalBrightness: fusedRgb.r + fusedRgb.g + fusedRgb.b,
      roiScoreSpread: cvS,
    });
    this.lastFingerFeatures = feats;

    const pressure = this.pressureEstimator.estimate({
      coverageRatio: this.smoothedCoverage,
      clipHighRatio: this.clipHighRatio,
      clipLowRatio: this.clipLowRatio,
      perfusionIndex: this.calculatePerfusionIndex(),
      spatialUniformity: this.spatialUniformity,
      brightness: roiDet.brightness,
      brightnessVariance: roiDet.brightnessVariance,
      baselineDrift: this.getBaselineDrift(),
    });
    this.pressureState = pressure.state;
    this.pressurePenalty = pressure.penalty;

    const preSqi = this.windowSqiEngine.getLastScore();
    const fingerSqiIn = Math.min(preSqi, this.spectralGateForFinger);
    const fingerOut = this.fingerMachine.process(feats, timestamp, fingerSqiIn);
    this.fingerMeasurementState = fingerOut.state;
    this.exportedContactState = fingerOut.exportedContact;
    this.fingerDetected = this.fingerMeasurementState !== 'NO_CONTACT';

    this.updatePositionLockFromRoi(roiDet, fusedRgb.r, fusedRgb.g);

    const topRows = scored.rows
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    this.lastTopRois = topRows;

    const motionArtifact = this.motionScore > this.MOTION_THRESH;

    if (this.exportedContactState === 'NO_CONTACT' && this.fingerMeasurementState === 'NO_CONTACT') {
      this.signalQuality = 0;
      this.emitSignal({
        timestamp,
        rawValue: 0,
        filteredValue: 0,
        quality: 0,
        fingerDetected: false,
        contactState: 'NO_CONTACT',
        extendedContactState: this.fingerMeasurementState,
        motionArtifact,
        roi: { x: 0, y: 0, width: extractionImageData.width, height: extractionImageData.height },
        perfusionIndex: 0,
        rawRed: fusedRgb.r,
        rawGreen: fusedRgb.g,
        clipHighRatio: this.clipHighRatio,
        clipLowRatio: this.clipLowRatio,
        roiCoverage: this.smoothedCoverage,
        pressureState: pressure.state,
        activeSource: 'FUSION',
        sourceStability: 0,
        sqiBySource: {},
        estimatedSampleRate: this.estimatedSampleRate,
        realFps: this.lastTiming.effectiveFps || this.realFps,
        processingDurationMs: performance.now() - tAll,
        diagnostics: {
          message: `SIN DEDO | C:${(this.centerCoverage * 100).toFixed(0)}% | ${fingerOut.reason}`,
          hasPulsatility: false,
          pulsatilityValue: 0,
        },
      });
      this.profiler.mark('total', performance.now() - tAll);
      return;
    }

    const tFus = performance.now();
    const redPI = this.redDC > 0 ? this.redAC / this.redDC : 0;
    const greenPI = this.greenDC > 0 ? this.greenAC / this.greenDC : 0;
    const spectralQ01 =
      this.lastWindowSqi?.spectral != null
        ? Math.max(
            0,
            Math.min(
              1,
              this.lastWindowSqi.spectral.spectralDominanceScore * 0.38 +
                this.lastWindowSqi.spectral.harmonicityScore * 0.22 +
                this.lastWindowSqi.spectral.detectorAgreementScore * 0.4
            )
          )
        : undefined;

    // ============================================================
    // GreenChannelTriad: G1, G2, G3 ortogonales + bandpass por canal +
    // selector por SQI con histéresis. Reemplaza al SignalFusionEngine
    // (9 streams + softmax) por una triada canónica auditable.
    // ============================================================
    this.greenTriad.setSampleRate(this.estimatedSampleRate);
    const triad = this.greenTriad.process({
      meanR: fusedRgb.r,
      meanG: fusedRgb.g,
      dcR: this.redDC,
      dcG: this.greenDC,
    });
    this.lastSelectedGreenId = triad.selectedId;
    this.lastTriadSqi = triad.sqi;
    this.profiler.mark('fusion', performance.now() - tFus);
    void redPI;
    void greenPI;
    void cvS;
    void spectralQ01;

    const filtered = triad.selectedFiltered;
    const fusedValue = triad.selectedFiltered;
    this.filteredBuf.push(filtered);

    this.lastAutocorrPeak = this.estimatePeriodicityFromFiltered();
    this.lastPulseCorr = this.shortSelfCorr();

    const tSqi = performance.now();
    this.windowSqiEngine.push(filtered, timestamp);
    this.windowSqiEngine.setWelchSegments(this.perfModeController.getWelchSegments());
    this.lastWindowSqi = this.windowSqiEngine.computeWindowSQI(this.estimatedSampleRate);
    this.profiler.mark('sqi', performance.now() - tSqi);
    if (this.lastWindowSqi.spectral) {
      this.spectralGateForFinger =
        0.28 +
        0.72 *
          Math.max(
            0,
            Math.min(
              1,
              this.lastWindowSqi.spectral.spectralDominanceScore * 0.5 +
                this.lastWindowSqi.spectral.detectorAgreementScore * 0.5
            )
          );
    }

    const perfusionIndex = this.calculatePerfusionIndex();
    const signalRange = this.getSignalRange();
    const redDominance = this.smoothedRed - (this.smoothedGreen + this.smoothedBlue) / 2;
    const periodicityScore = this.lastAutocorrPeak;

    const contactForSqi: ContactState = this.exportedContactState;

    this.signalQuality = computeGlobalSQI({
      perfusionIndex,
      periodicityScore,
      coverageRatio: this.smoothedCoverage,
      spatialUniformity: this.spatialUniformity,
      pressurePenalty: this.pressurePenalty,
      motionScore: this.motionScore,
      clipHighRatio: this.clipHighRatio,
      clipLowRatio: this.clipLowRatio,
      positionDrift: this.positionDrift,
      signalRange,
      redDominance,
      contactState: contactForSqi,
      // sourceStability real basado en SQI máximo de la triada (0-1).
      sourceStability: Math.max(this.lastTriadSqi.g1, this.lastTriadSqi.g2, this.lastTriadSqi.g3),
    });

    const windowFactor = this.lastWindowSqi ? this.lastWindowSqi.score : 0.35;
    const fingerGate = shouldGateBpmOutput(this.fingerMeasurementState) ? 1 : 0.4;
    const phaseQ = 0.55;
    const specAgg =
      this.lastWindowSqi?.spectral != null
        ? Math.max(
            0,
            Math.min(
              1,
              this.lastWindowSqi.spectral.spectralDominanceScore * 0.35 +
                this.lastWindowSqi.spectral.detectorAgreementScore * 0.35 +
                this.lastWindowSqi.spectral.dominantFrequencyStability * 0.3
            )
          )
        : 0.4;
    // Calidad gateada simple: SQI base * factor de ventana. Sin atenuaciones
    // multiplicativas que pueden enmascarar la señal real (las anteriores
    // 4 multiplicaciones reducían la calidad incluso con buena onda).
    let outQuality = this.signalQuality * (0.55 + 0.45 * windowFactor) * fingerGate;
    if (specAgg > 0.4) outQuality *= 1 + Math.min(0.15, this.fineBoostEwma);
    outQuality = Math.min(100, Math.max(0, outQuality));

    // SIN degradedHold: la onda publicada es siempre la del frame actual.
    const outRaw = fusedValue;
    const outFiltered = filtered;

    this.perfModeController.observe({
      effectiveFps: this.lastTiming.effectiveFps || this.realFps,
      processingTimeMs: performance.now() - tAll,
      workerQueueDepth: 0,
      workerLatencyMs: 0,
      droppedEstimate: this.lastTiming.droppedEstimate,
    });

    this.emitSignal({
      timestamp,
      rawValue: outRaw,
      filteredValue: outFiltered,
      quality: Math.min(100, outQuality),
      fingerDetected: this.fingerDetected,
      contactState: this.exportedContactState,
      extendedContactState: this.fingerMeasurementState,
      motionArtifact,
      roi: { x: multi.innerRect.sx, y: multi.innerRect.sy, width: multi.innerRect.w, height: multi.innerRect.h },
      perfusionIndex,
      rawRed: fusedRgb.r,
      rawGreen: fusedRgb.g,
      clipHighRatio: this.clipHighRatio,
      clipLowRatio: this.clipLowRatio,
      roiCoverage: this.smoothedCoverage,
      pressureState: this.pressureState,
      activeSource: this.lastSelectedGreenId,
      sourceStability: Math.max(this.lastTriadSqi.g1, this.lastTriadSqi.g2, this.lastTriadSqi.g3),
      sqiBySource: {
        G1: this.lastTriadSqi.g1,
        G2: this.lastTriadSqi.g2,
        G3: this.lastTriadSqi.g3,
      },
      estimatedSampleRate: this.estimatedSampleRate,
      realFps: this.lastTiming.effectiveFps || this.realFps,
      processingDurationMs: performance.now() - tAll,
      diagnostics: {
        message:
          `${this.fingerMeasurementState} | W:${(windowFactor * 100).toFixed(0)}% | ` +
          `${this.lastSelectedGreenId} | P:${this.pressureState.charAt(0)}`,
        hasPulsatility: perfusionIndex > 0.05 && windowFactor > 0.4,
        pulsatilityValue: perfusionIndex,
      },
    });
    this.profiler.mark('total', performance.now() - tAll);
    this.processingTimeMs = performance.now() - tAll;
  }

  private emitSignal(partial: ProcessedSignal): void {
    if (!this.onSignalReady) return;
    const ff = this.lastFingerFeatures;
    const pipelineDebug = {
      fingerMeasurementState: this.fingerMeasurementState,
      topRois: this.lastTopRois,
      // FusionWeights → SQI por canal de la triada (compat con tipo).
      fusionWeights: {
        G1: this.lastTriadSqi.g1,
        G2: this.lastTriadSqi.g2,
        G3: this.lastTriadSqi.g3,
      },
      fusionCollapse: false,
      fusionMeta: {
        dominantSource: this.lastSelectedGreenId,
        sourceAgreement: Math.min(this.lastTriadSqi.g1, this.lastTriadSqi.g2, this.lastTriadSqi.g3),
      },
      windowSQI: this.lastWindowSqi
        ? {
            score: this.lastWindowSqi.score,
            category: this.lastWindowSqi.category,
            reasons: this.lastWindowSqi.reasons,
            gating: this.lastWindowSqi.gating,
            spectral: this.lastWindowSqi.spectral,
          }
        : undefined,
      acquisition: { ...this.captureContext },
      performanceProfile: this.perfModeController.getProfile(),
      roiReputation: this.roiReputation.getDebug(this.lastRoiCells, this.lastRoiScores, this.lastRefinementStage),
      frameTiming: this.lastTiming,
      profiler: this.profiler.snapshot(),
      fingerFeatures: ff
        ? {
            contactEvidence: ff.contactEvidence,
            centerCoverage: ff.centerCoverage,
            spatialUniformity: ff.spatialUniformity,
            clippingStress: ff.clippingStress,
            motionScore: ff.motionScore,
            perfusionProxy: ff.perfusionProxy,
            temporalStability: ff.temporalStability,
          }
        : undefined,
      // Autocorrelación periodicity calculada por el procesador en cada frame
      // (no requiere latidos aceptados). Útil para gates que necesitan evidencia
      // temprana de pulso real.
      autocorrPeak: this.lastAutocorrPeak,
      pulseSelfCorr: this.lastPulseCorr,
    };
    this.onSignalReady({
      ...partial,
      acStats: this.getRGBStats(),
      positionQuality: this.getPositionQuality(),
      pipelineDebug,
    } as ProcessedSignal);
  }

  private updatePositionLockFromRoi(roi: ROIMaskResult, curR: number, curG: number): void {
    this.positionQualityScore = roi.coverageRatio * 0.35 + roi.spatialUniformity * 0.35 + roi.centerCoverage * 0.3;
    if (this.positionLocked) {
      const redDrift = this.lockedRedBase > 0 ? Math.abs(curR - this.lockedRedBase) / this.lockedRedBase : 0;
      const greenDrift = this.lockedGreenBase > 0 ? Math.abs(curG - this.lockedGreenBase) / this.lockedGreenBase : 0;
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
        this.lockedRedBase += (curR - this.lockedRedBase) * adapt;
        this.lockedGreenBase += (curG - this.lockedGreenBase) * adapt;
        this.lockedCoverage += (roi.coverageRatio - this.lockedCoverage) * adapt;
        this.positionGuidance = 'POSICIÓN CORRECTA — NO MUEVA EL DEDO';
      }
    } else if (this.fingerDetected) {
      this.positionDrifting = false;
      if (this.positionQualityScore > 0.55 && roi.coverageRatio > 0.35 && roi.spatialUniformity > 0.35 && this.pressureState !== 'HIGH_PRESSURE') {
        this.positionStabilityCount++;
        if (this.positionStabilityCount >= this.POS_LOCK_FRAMES) {
          this.positionLocked = true;
          this.lockedRedBase = curR;
          this.lockedGreenBase = curG;
          this.lockedCoverage = roi.coverageRatio;
          this.positionGuidance = 'POSICIÓN BLOQUEADA — MANTENGA ASÍ';
        } else {
          this.positionGuidance = `ESTABILIZANDO... ${Math.round((this.positionStabilityCount / this.POS_LOCK_FRAMES) * 100)}%`;
        }
      } else {
        this.positionStabilityCount = Math.max(0, this.positionStabilityCount - 3);
        this.positionGuidance =
          this.pressureState === 'HIGH_PRESSURE'
            ? 'REDUZCA LA PRESIÓN DEL DEDO'
            : roi.coverageRatio < 0.35
              ? 'CUBRA TODA LA CÁMARA CON SU DEDO'
              : 'CENTRE EL DEDO SOBRE LA CÁMARA';
      }
    } else {
      this.positionStabilityCount = 0;
      this.positionDrifting = false;
      this.positionGuidance = 'COLOQUE SU DEDO SOBRE LA CÁMARA Y EL FLASH';
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
    if (this.frameTimeBuf.length < 10) return;
    const n = Math.min(30, this.frameTimeBuf.length);
    const arr = this.frameTimeBuf.last(n);
    arr.sort();
    const median = arr[Math.floor(n / 2)];
    const fps = Math.max(15, Math.min(60, 1000 / median));
    this.realFps = fps;
    if (Math.abs(fps - this.estimatedSampleRate) > 2) {
      this.estimatedSampleRate = fps;
      this.greenTriad.setSampleRate(fps);
    }
  }

  private updateBaselines(r: number, g: number, b: number, motion: boolean): void {
    if (this.redBaseline === 0) {
      this.redBaseline = r;
      this.greenBaseline = g;
      this.blueBaseline = b;
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
    const olderMean = this.redBuf.mean(60);
    return Math.abs(olderMean - recentMean) / (this.redBaseline + 1);
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
    if (this.redAC / this.redDC < 0.0001 && this.greenAC / this.greenDC < 0.0001) {
      this.redAC = 0;
      this.greenAC = 0;
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
    let best = 0;
    for (let lag = 8; lag <= 60; lag++) {
      const ac = this.filteredBuf.autocorrelation(lag, n);
      if (ac > best) best = ac;
    }
    return Math.max(0, Math.min(1, best));
  }

  private shortSelfCorr(): number {
    if (this.filteredBuf.length < 50) return 0;
    const lag = 12;
    const n = Math.min(80, this.filteredBuf.length);
    const m = this.filteredBuf.mean(n);
    let c = 0,
      a = 0,
      b = 0;
    for (let i = lag; i < n; i++) {
      const x = this.filteredBuf.get(this.filteredBuf.length - n + i) - m;
      const y = this.filteredBuf.get(this.filteredBuf.length - n + i - lag) - m;
      c += x * y;
      a += x * x;
      b += y * y;
    }
    const d = Math.sqrt(a * b);
    return d > 1e-9 ? c / d : 0;
  }

  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios:
        this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0 ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC) : 0,
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

  getDebugInfo() {
    return {
      fingerState: this.fingerMeasurementState,
      exportedState: this.exportedContactState,
      pressureState: this.pressureState,
      activeSource: [this.lastSelectedGreenId],
      realFps: this.lastTiming.effectiveFps,
      processingTimeMs: this.processingTimeMs,
      sqiGlobal: this.signalQuality,
      windowSQI: this.lastWindowSqi,
      clipHighRatio: this.clipHighRatio,
      perfusionIndex: this.calculatePerfusionIndex(),
      motionScore: this.motionScore,
      topRois: this.lastTopRois,
      profiler: this.profiler.snapshot(),
    };
  }

  reset(): void {
    this.redBuf.clear();
    this.greenBuf.clear();
    this.blueBuf.clear();
    this.filteredBuf.clear();
    this.frameTimeBuf.clear();
    this.luminanceRing.clear();
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.blueDC = 0;
    this.blueAC = 0;
    this.redBaseline = 0;
    this.greenBaseline = 0;
    this.blueBaseline = 0;
    this.estimatedSampleRate = 30;
    this.lastFrameTime = 0;
    this.motionScore = 0;
    this.roiReputation.reset();
    this.perfModeController = new PerformanceModeController();
    this.refinementFrame = 0;
    this.fineBoostEwma = 0;
    this.spectralGateForFinger = 0.45;
    this.lastRoiCells = [];
    this.lastRoiScores = new Float64Array(25);
    this.fingerMachine.reset();
    this.greenTriad.reset();
    this.roiScorer.reset();
    this.windowSqiEngine.reset();
    this.frameTiming.reset();
    this.profiler.reset();
    this.roiMaskDet.reset();
    this.pressureEstimator.reset();
    this.fingerMeasurementState = 'NO_CONTACT';
    this.exportedContactState = 'NO_CONTACT';
    this.fingerDetected = false;
    this.signalQuality = 0;
    this.lastSelectedGreenId = 'G2';
    this.lastTriadSqi = { g1: 0, g2: 0, g3: 0 };
    this.lastAutocorrPeak = 0;
    this.lastPulseCorr = 0;
  }
}
