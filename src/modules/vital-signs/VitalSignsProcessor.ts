import { PPGFeatureExtractor, type CycleFeatures } from './PPGFeatureExtractor';
import { BloodPressureProcessor, type BPEstimate, type BPConfidenceLevel } from './BloodPressureProcessor';
import { RhythmClassifier, type RhythmResult, type RhythmLabel } from './RhythmClassifier';
import { SpO2Processor, type SpO2Result, type SpO2Calibration } from './SpO2Processor';
import { GlucoseResearchProcessor, type GlucoseResult, type GlucoseFeatureVector } from '../biomarkers/GlucoseResearchProcessor';
import { LipidResearchProcessor, type LipidResult, type LipidFeatureVector } from '../biomarkers/LipidResearchProcessor';
import { MeasurementGate, type OutputState } from '../core/MeasurementGate';
import { HRVTimeFreqProcessor, type HRVResult } from './HRVTimeFreqProcessor';
import { StressProcessor, type StressResult } from './StressProcessor';
import { RespiratoryRateProcessor, type RespRateResult } from './RespiratoryRateProcessor';
import { HemoglobinProcessor, type HemoglobinFeatures, type HemoglobinOutput } from './HemoglobinProcessor';
import {
  saveCalibration,
  loadCalibration,
  loadCalibrationLocal,
  type CalibrationModality,
} from '@/services/calibrationStore';

export interface VitalSignsResult {
  spo2: number;
  glucose: number;
  pressure: {
    systolic: number;
    diastolic: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    featureQuality: number;
    map?: number;
    pulsePressure?: number;
    status?: 'ok' | 'low_quality' | 'needs_calibration' | 'blocked';
  };
  arrhythmiaCount: number;
  arrhythmiaStatus: string;
  lipids: {
    totalCholesterol: number;
    triglycerides: number;
    ldl?: number;
    hdl?: number;
  };
  isCalibrating: boolean;
  calibrationProgress: number;
  lastArrhythmiaData?: {
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  };
  signalQuality: number;
  measurementConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';
  rhythm?: {
    label: RhythmLabel;
    confidence: number;
    burden: number;
    recentEvents: any[];
  };
  spo2Detail?: {
    value: number | null;
    confidence: number;
    status: string;
    calibrationState?: string;
    rawRatioR?: number;
  };
  glucoseDetail?: {
    value: number | null;
    confidence: number;
    status: string;
    trend?: 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN';
  };
  lipidsDetail?: {
    totalCholesterol: number | null;
    ldl: number | null;
    hdl: number | null;
    triglycerides: number | null;
    confidence: number;
    status: string;
  };
  outputStates?: {
    bpm: OutputState;
    spo2: OutputState;
    bp: OutputState;
    glucose: OutputState;
    lipids: OutputState;
    rhythm: OutputState;
  };
  // HRV (time + frequency + non-linear) — Phase 5
  hrv?: HRVResult;
  // Stress index 0..100 + label — Phase 5
  stress?: StressResult;
  // Respiratory rate (brpm) — Phase 6
  respiration?: RespRateResult;
  // Hemoglobin (g/dL) — Phase 10 (research, calibratable)
  hemoglobin?: HemoglobinOutput;
  // Debug telemetry
  debugMetrics?: {
    motionScore: number;
    clipHighRatio: number;
    clipLowRatio: number;
    sourceStability: number;
    contactState: string;
    perfusionIndex: number;
    beatCount: number;
    rhythmGatePassed?: boolean;
    rhythmBlockedReasons?: string[];
  };
  moduleMaturity?: {
    bpm: 'production-grade';
    ppgWaveform: 'production-grade';
    hrv: 'advanced-calibration-dependent';
    spo2: 'advanced-calibration-dependent';
    bloodPressure: 'research-calibrated';
    glucose: 'research-calibrated';
    lipids: 'research-calibrated';
    rhythm: 'advanced-calibration-dependent';
    hemoglobin: 'research-calibrated';
  };
}

export interface RGBData {
  redAC: number;
  redDC: number;
  greenAC: number;
  greenDC: number;
  blueAC?: number;
  blueDC?: number;
}

export class VitalSignsProcessor {
  /** Single authoritative processor instances - no V2/V3 duplicates */
  private bloodPressureProcessor: BloodPressureProcessor;
  private rhythmClassifier: RhythmClassifier;
  private spo2Processor: SpO2Processor;
  private glucoseProcessor: GlucoseResearchProcessor;
  private lipidProcessor: LipidResearchProcessor;
  private hrvProcessor: HRVTimeFreqProcessor;
  private stressProcessor: StressProcessor;
  private respProcessor: RespiratoryRateProcessor;
  private hemoglobinProcessor: HemoglobinProcessor;
  private lastHemoglobin: HemoglobinOutput | null = null;
  private piHistory: number[] = [];
  private readonly PI_HISTORY_SIZE = 30;
  private lastHRV: HRVResult | null = null;
  private lastStress: StressResult | null = null;
  private lastResp: RespRateResult | null = null;
  private respFrameCounter = 0;
  private readonly RESP_REFRESH_EVERY = 30; // recompute resp every ~30 vital frames

  private lastBPConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' = 'INSUFFICIENT';
  private lastBPFeatureQuality = 0;
  private calibrationSamples = 0;
  private readonly CALIBRATION_REQUIRED = 25;
  private isCalibrating = false;

  private measurements = {
    spo2: 0, glucose: 0,
    systolicPressure: 0, diastolicPressure: 0,
    arrhythmiaCount: 0, arrhythmiaStatus: "SIN ARRITMIAS|0",
    totalCholesterol: 0, triglycerides: 0,
    lastArrhythmiaData: null as { timestamp: number; rmssd: number; rrVariation: number } | null,
    signalQuality: 0,
  };

  private signalHistory: number[] = [];
  // Need ≥25 s of PPG at the upstream sampleRate for the respiratory PSD.
  // signalHistory holds the filtered scalar at the rate this processor is
  // called from Index.tsx (≈ 10 Hz after VITALS_PROCESS_EVERY_N_FRAMES=3 @30fps);
  // 600 samples covers ~60 s — plenty for resp + cycle features.
  private readonly HISTORY_SIZE = 600;
  private rgbData: RGBData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
  private validPulseCount = 0;

  private upstreamContext = {
    contactStable: false,
    pressureOptimal: false,
    clipHighRatio: 0,
    sourceStability: 0,
    avgBeatSQI: 0,
    beatCount: 0,
    sampleRate: 30,
    detectorAgreement: 0,
    rrStability: 0,
  };

  private lastRhythm: RhythmResult | null = null;
  private lastSpo2: SpO2Result | null = null;
  private lastGlucose: GlucoseResult | null = null;
  private lastLipids: LipidResult | null = null;
  private lastRhythmBlockedReasons: string[] = [];
  private lastRhythmGatePassed = false;

  private readonly EMA_ALPHA_STABLE = 0.20;
  private readonly EMA_ALPHA_DYNAMIC = 0.30;

  constructor() {
    // Single consolidated processors - no V2/V3 duplicates
    this.bloodPressureProcessor = new BloodPressureProcessor();
    this.rhythmClassifier = new RhythmClassifier();
    this.spo2Processor = new SpO2Processor();
    this.glucoseProcessor = new GlucoseResearchProcessor();
    this.lipidProcessor = new LipidResearchProcessor();
    this.hrvProcessor = new HRVTimeFreqProcessor();
    this.stressProcessor = new StressProcessor();
    this.respProcessor = new RespiratoryRateProcessor();
    this.hemoglobinProcessor = new HemoglobinProcessor();

    // Load persisted calibrations
    try {
      const hbv1 = loadCalibrationLocal<any>('hemoglobin_v1');
      if (hbv1) this.hemoglobinProcessor.loadSerializedCalibration(hbv1);
    } catch { /* private mode etc. */ }
  }

  /**
   * Phase 12 — async cross-tier hydration. Call once after Supabase auth
   * has resolved to fetch the user's authoritative calibrations.
   */
  async autoLoadCalibrations(): Promise<void> {
    try {
      const hbv1 = await loadCalibration<any>('hemoglobin_v1');
      if (hbv1) this.hemoglobinProcessor.loadSerializedCalibration(hbv1);
    } catch (e) {
      console.warn('[vitals] autoLoadCalibrations failed:', (e as any)?.message ?? e);
    }
  }

  /** Persist hemoglobin calibration (only one with serialization support). */
  async persistCalibrations(): Promise<void> {
    try {
      const hbv1 = this.hemoglobinProcessor.serializeCalibration();
      if (hbv1.model) await saveCalibration('hemoglobin_v1' as CalibrationModality, hbv1);
    } catch (e) {
      console.warn('[vitals] persistCalibrations failed:', (e as any)?.message ?? e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CALIBRATION WIZARDS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Iniciar wizard de calibración de presión arterial.
   */
  startBPCalibrationWizard(_referenceDevice: string, _userId: string): void {
    // BP calibration not supported in consolidated processor
  }

  /**
   * Agregar punto de calibración de BP con referencia real.
   */
  addBPCalibrationPoint(
    _ppgFeatures: unknown,
    _referenceSBP: number,
    _referenceDBP: number
  ): { success: boolean; pointsCollected: number; pointsNeeded: number } {
    return { success: false, pointsCollected: 0, pointsNeeded: 0 };
  }

  /**
   * Finalizar wizard de calibración de BP.
   */
  finishBPCalibrationWizard(): { success: boolean; rmseSBP: number; rmseDBP: number } {
    return { success: false, rmseSBP: 0, rmseDBP: 0 };
  }

  getBPV3CalibrationStatus() {
    return { samplesCollected: 0, rmseSBP: 0, rmseDBP: 0, ageDays: 0, canPublish: false };
  }

  setBPV3Enabled(_enabled: boolean): void {
    // No-op in consolidated version
  }

  // ─── Hemoglobina (Phase 10) ───
  /** Iniciar wizard de calibración de hemoglobina (laboratorio: g/dL). */
  startHemoglobinCalibrationWizard(): void { this.hemoglobinProcessor.startCalibrationWizard(); }
  /** Agregar punto de calibración de Hb. Persiste tras cada punto. */
  addHemoglobinCalibrationPoint(features: HemoglobinFeatures, refHbgDl: number) {
    const r = this.hemoglobinProcessor.addCalibrationPoint(features, refHbgDl);
    this.persistCalibrations().catch(() => { /* */ });
    return r;
  }
  /** Finalizar wizard de Hb y persistir. */
  finishHemoglobinCalibrationWizard() {
    const r = this.hemoglobinProcessor.finishCalibrationWizard();
    if (r.success) this.persistCalibrations().catch(() => { /* */ });
    return r;
  }
  getHemoglobinCalibrationStatus() { return this.hemoglobinProcessor.getCalibrationStatus(); }

  // ─── Glucose Training ───
  startGlucoseV3Training(): void { 
    if (typeof (this.glucoseProcessor as any).startTrainingMode === 'function') {
      (this.glucoseProcessor as any).startTrainingMode();
    }
  }
  addGlucoseV3TrainingSample(_features: unknown, _refMgDl: number) {
    return { success: false, samplesCollected: 0, coveragePercent: 0, canTrain: false };
  }
  finishGlucoseV3Training() {
    return { success: false, samplesCollected: 0, coveragePercent: 0, rmse: 0 };
  }
  getGlucoseV3CalibrationStatus() { 
    return { samplesCollected: 0, coveragePercent: 0, canTrain: false, rmse: 0, ageDays: 0 };
  }

  // ─── Lipids Training ───
  startLipidsV3Training(): void { 
    if (typeof (this.lipidProcessor as any).startTraining === 'function') {
      (this.lipidProcessor as any).startTraining();
    }
  }
  addLipidsV3TrainingSample(_features: unknown, _refLabs: unknown) {
    return { success: false, samplesCollected: 0, canTrain: false };
  }
  finishLipidsV3Training() {
    return { success: false, samplesCollected: 0, rmseCT: 0, rmseTG: 0 };
  }
  getLipidsV3CalibrationStatus() { 
    return { samplesCollected: 0, canTrain: false, rmseCT: 0, rmseTG: 0, ageDays: 0 };
  }

  /**
   * Cargar calibración de dispositivo SpO2
   */
  loadSpO2DeviceCalibration(profile: SpO2Calibration): void {
    if (typeof (this.spo2Processor as any).loadDeviceCalibration === 'function') {
      (this.spo2Processor as any).loadDeviceCalibration(profile);
    }
  }

  /**
   * Agregar punto de calibración SpO2 de usuario.
   */
  addSpO2UserCalibrationPoint(referenceSpO2: number, measuredR: number, _ratioRG = 0, _ratioRB = 0): void {
    if (typeof (this.spo2Processor as any).addUserCalibrationPoint === 'function') {
      (this.spo2Processor as any).addUserCalibrationPoint(referenceSpO2, measuredR);
    }
  }

  /** Habilitar/deshabilitar SpO2 (no-op en versión consolidada). */
  setSpO2V3Enabled(_enabled: boolean): void {
    // No-op in consolidated version
  }

  /**
   * Iniciar modo entrenamiento de glucosa
   */
  startGlucoseTraining(userId: string, referenceDevice: string): void {
    if (typeof (this.glucoseProcessor as any).startTrainingMode === 'function') {
      (this.glucoseProcessor as any).startTrainingMode(userId, referenceDevice);
    }
  }

  /**
   * Agregar muestra de entrenamiento de glucosa
   */
  addGlucoseTrainingSample(
    ppgFeatures: GlucoseFeatureVector,
    referenceGlucose: number
  ): { success: boolean; samplesCollected: number; canTrain: boolean } {
    if (typeof (this.glucoseProcessor as any).addTrainingSample === 'function') {
      return (this.glucoseProcessor as any).addTrainingSample(ppgFeatures, referenceGlucose);
    }
    return { success: false, samplesCollected: 0, canTrain: false };
  }

  /**
   * Iniciar modo entrenamiento de lípidos
   */
  startLipidTraining(userId: string, labSource: string): void {
    if (typeof (this.lipidProcessor as any).startTraining === 'function') {
      (this.lipidProcessor as any).startTraining(userId, labSource);
    }
  }

  /**
   * Agregar muestra de entrenamiento de lípidos
   */
  addLipidTrainingSample(
    ppgFeatures: LipidFeatureVector,
    referenceLabs: {
      totalCholesterol: number;
      ldl: number;
      hdl: number;
      triglycerides: number;
    }
  ): { success: boolean; samples: number; canTrain: boolean } {
    if (typeof (this.lipidProcessor as any).addTrainingSample === 'function') {
      return (this.lipidProcessor as any).addTrainingSample(ppgFeatures, referenceLabs);
    }
    return { success: false, samples: 0, canTrain: false };
  }

  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    this.validPulseCount = 0;
    this.measurements = {
      spo2: 0, glucose: 0, systolicPressure: 0, diastolicPressure: 0,
      arrhythmiaCount: 0, arrhythmiaStatus: "CALIBRANDO...|0",
      totalCholesterol: 0, triglycerides: 0, lastArrhythmiaData: null, signalQuality: 0,
    };
    this.signalHistory = [];
  }

  forceCalibrationCompletion(): void {
    this.isCalibrating = false;
    this.calibrationSamples = this.CALIBRATION_REQUIRED;
  }

  setRGBData(data: RGBData): void { this.rgbData = data; }

  setUpstreamContext(ctx: {
    contactStable?: boolean;
    pressureOptimal?: boolean;
    clipHighRatio?: number;
    sourceStability?: number;
    avgBeatSQI?: number;
    beatCount?: number;
    sampleRate?: number;
    detectorAgreement?: number;
    rrStability?: number;
  }): void {
    if (ctx.contactStable !== undefined) this.upstreamContext.contactStable = ctx.contactStable;
    if (ctx.pressureOptimal !== undefined) this.upstreamContext.pressureOptimal = ctx.pressureOptimal;
    if (ctx.clipHighRatio !== undefined) this.upstreamContext.clipHighRatio = ctx.clipHighRatio;
    if (ctx.sourceStability !== undefined) this.upstreamContext.sourceStability = ctx.sourceStability;
    if (ctx.avgBeatSQI !== undefined) this.upstreamContext.avgBeatSQI = ctx.avgBeatSQI;
    if (ctx.beatCount !== undefined) this.upstreamContext.beatCount = ctx.beatCount;
    if (ctx.sampleRate !== undefined && isFinite(ctx.sampleRate)) this.upstreamContext.sampleRate = Math.max(15, Math.min(60, ctx.sampleRate));
    if (ctx.detectorAgreement !== undefined) this.upstreamContext.detectorAgreement = ctx.detectorAgreement;
    if (ctx.rrStability !== undefined) this.upstreamContext.rrStability = ctx.rrStability;
  }

  processSignal(
    signalValue: number,
    rrData?: { intervals: number[], lastPeakTime: number | null },
    beatInputs?: Array<{
      ibiMs: number; beatSQI: number; morphologyScore: number;
      detectorAgreement: number; amplitude?: number;
      flags: { isWeak: boolean; isPremature: boolean; isSuspicious: boolean; isDoublePeak: boolean };
    }>
  ): VitalSignsResult {
    this.signalHistory.push(signalValue);
    if (this.signalHistory.length > this.HISTORY_SIZE) this.signalHistory.shift();

    if (this.isCalibrating) {
      this.calibrationSamples++;
      if (this.calibrationSamples >= this.CALIBRATION_REQUIRED) this.isCalibrating = false;
    }

    this.measurements.signalQuality = this.calculateSignalQuality();
    const hasRealPulse = this.validateRealPulse(rrData);
    if (!hasRealPulse) return this.getFormattedResult();

    if (this.signalHistory.length >= 20 && rrData && rrData.intervals.length >= 2) {
      this.calculateVitalSigns(signalValue, rrData, beatInputs);
    }

    return this.getFormattedResult();
  }

  private validateRealPulse(rrData?: { intervals: number[], lastPeakTime: number | null }): boolean {
    if (!rrData || !rrData.intervals || rrData.intervals.length < 2) {
      this.validPulseCount = 0;
      return false;
    }

    const validIntervals = rrData.intervals.filter(i => i >= 270 && i <= 2200);
    if (validIntervals.length < 2) {
      this.validPulseCount = 0;
      return false;
    }

    if (rrData.lastPeakTime) {
      const nowPerf = performance.now();
      const nowEpoch = Date.now();
      const lastPeak = rrData.lastPeakTime;
      const sameClockDelta = lastPeak < 1e12 ? nowPerf - lastPeak : nowEpoch - lastPeak;
      if (sameClockDelta > 4000) {
        this.validPulseCount = 0;
        return false;
      }
    }

    this.validPulseCount = validIntervals.length;
    return true;
  }

  private calculateSignalQuality(): number {
    if (this.signalHistory.length < 20) return 0;
    const recent = this.signalHistory.slice(-60);
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? 0;
    const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
    const range = p90 - p10;
    if (range < 0.2) return 2;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + (val - mean) ** 2, 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    const snr = range / (stdDev + 0.05);
    return Math.min(100, Math.max(0, snr * 16));
  }

  private getMeasurementConfidence(): 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID' {
    const sq = this.measurements.signalQuality;
    if (sq >= 45 && this.validPulseCount >= 4) return 'HIGH';
    if (sq >= 24 && this.validPulseCount >= 3) return 'MEDIUM';
    if (sq >= 10 && this.validPulseCount >= 2) return 'LOW';
    return 'INVALID';
  }

  private calculateVitalSigns(
    signalValue: number,
    rrData: { intervals: number[], lastPeakTime: number | null },
    beatInputs?: Array<any>
  ): void {
    if (this.measurements.signalQuality < 8) return;

    const validRR = rrData.intervals.filter(i => i >= 270 && i <= 2200);
    const avgRR = validRR.length > 0 ? validRR.reduce((a, b) => a + b, 0) / validRR.length : 0;
    const hr = avgRR > 0 ? 60000 / avgRR : 0;
    const rrVar = PPGFeatureExtractor.extractRRVariability(validRR);
    const sampleRate = this.upstreamContext.sampleRate || 30;

    // ── SpO2 — Phase 7 ──
    const spo2Result = this.spo2Processor.process({
      redAC: this.rgbData.redAC, redDC: this.rgbData.redDC,
      greenAC: this.rgbData.greenAC, greenDC: this.rgbData.greenDC,
      blueAC: this.rgbData.blueAC, blueDC: this.rgbData.blueDC,
      contactStable: this.upstreamContext.contactStable,
      pressureOptimal: this.upstreamContext.pressureOptimal,
      clipHighRatio: this.upstreamContext.clipHighRatio,
      beatCount: Math.max(this.upstreamContext.beatCount, beatInputs?.length || 0),
      avgBeatSQI: this.upstreamContext.avgBeatSQI,
      sourceStability: this.upstreamContext.sourceStability,
    });
    this.lastSpo2 = spo2Result;
    if (typeof spo2Result.value === 'number' && spo2Result.value > 0 && spo2Result.enabledState !== 'WITHHELD_LOW_QUALITY') {
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2Result.value, 'stable');
    }

    const cycles = PPGFeatureExtractor.detectCardiacCycles(this.signalHistory, sampleRate);
    const validCycleFeatures: import('./PPGFeatureExtractor').CycleFeatures[] = [];
    for (const cycle of cycles) {
      const features = PPGFeatureExtractor.extractCycleFeatures(this.signalHistory, cycle, sampleRate);
      if (features && features.quality >= 0.2) validCycleFeatures.push(features);
    }

    const medianF = validCycleFeatures.length >= 1 ? this.medianCycleFeatures(validCycleFeatures) : null;

    // Phase 18 fix — these were declared further below but referenced inside
    // the BP V3 features block. Hoisting them prevents a TDZ ReferenceError
    // (`Cannot access 'piGreen' before initialization`) that crashed the
    // pipeline as soon as the user had ≥2 RR intervals.
    const piGreen = this.rgbData.greenDC > 0 ? (this.rgbData.greenAC / this.rgbData.greenDC) * 100 : 0;
    const rgACRatio = this.rgbData.greenAC > 0 ? this.rgbData.redAC / this.rgbData.greenAC : 0;

    if (validRR.length >= 2) {
      const bpEstimate = this.bloodPressureProcessor.estimate(this.signalHistory, validRR, sampleRate);
      this.lastBPConfidence = bpEstimate.confidence;
      this.lastBPFeatureQuality = bpEstimate.featureQuality;
      if (bpEstimate.systolic > 0 && bpEstimate.confidence !== 'INSUFFICIENT') {
        this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, bpEstimate.systolic, 'stable');
        this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, bpEstimate.diastolic, 'stable');
      }

      // BP processing complete - single processor pipeline
    }

    if (medianF && hr >= 35 && hr <= 200 && this.measurements.signalQuality >= 10) {
      const glucoseResult = this.glucoseProcessor.process({
        cycleFeatures: {
          sutMs: medianF.sutMs, pw50Ms: medianF.pw50Ms,
          pw75Ms: medianF.pw75Ms, pw25Ms: medianF.pw25Ms,
          augmentationIndex: medianF.augmentationIndex,
          stiffnessIndex: medianF.stiffnessIndex,
          dicroticDepth: medianF.dicroticDepth,
          areaRatio: medianF.areaRatio,
        },
        hr, rrVar, piGreen, rgACRatio,
        contactStable: this.upstreamContext.contactStable,
        signalQuality: this.measurements.signalQuality,
        beatCount: Math.max(this.upstreamContext.beatCount, beatInputs?.length || 0),
      });
      this.lastGlucose = glucoseResult;
      if (glucoseResult.value > 0 && glucoseResult.enabledState !== 'WITHHELD_LOW_QUALITY') {
        this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucoseResult.value, 'dynamic');
      }

      const lipidResult = this.lipidProcessor.process({
        cycleFeatures: {
          stiffnessIndex: medianF.stiffnessIndex,
          augmentationIndex: medianF.augmentationIndex,
          areaRatio: medianF.areaRatio,
          dicroticDepth: medianF.dicroticDepth,
          pwvProxy: medianF.pwvProxy,
          pw50Ms: medianF.pw50Ms, pw75Ms: medianF.pw75Ms, pw25Ms: medianF.pw25Ms,
          diastolicTimeMs: medianF.diastolicTimeMs,
        },
        hr, rrVar, piGreen,
        contactStable: this.upstreamContext.contactStable,
        signalQuality: this.measurements.signalQuality,
      });
      this.lastLipids = lipidResult;
      if (lipidResult.totalCholesterol > 0 && lipidResult.enabledState !== 'WITHHELD_LOW_QUALITY') {
        this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol, lipidResult.totalCholesterol, 'dynamic');
        this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides, lipidResult.triglycerides, 'dynamic');
      }

      // Glucose/Lipid processing complete - single processor pipeline
    }

    // ── HRV (time + frequency + non-linear) and Stress index — Phase 5 ──
    // Track perfusion-index history as a vasomotor proxy for sympathetic tone.
    if (piGreen > 0 && isFinite(piGreen)) {
      this.piHistory.push(piGreen);
      if (this.piHistory.length > this.PI_HISTORY_SIZE) this.piHistory.shift();
    }
    if (validRR.length >= 8) {
      this.lastHRV = this.hrvProcessor.compute(validRR);
      this.lastStress = this.stressProcessor.process({
        rrIntervals: validRR,
        lfHfRatio: this.lastHRV.freq.lfHfRatio,
        rmssd: this.lastHRV.time.rmssd,
        meanHR: this.lastHRV.time.hr || hr,
        perfusionIndexHistory: [...this.piHistory],
        signalQuality: this.measurements.signalQuality,
      });
    }

    // ── Hemoglobin (research) — Phase 10 ──
    if (medianF) {
      const hbF: HemoglobinFeatures = {
        meanRedLin: this.rgbData.redDC,
        meanGreenLin: this.rgbData.greenDC,
        meanBlueLin: this.rgbData.blueDC ?? 0,
        odR: this.rgbData.redDC > 0 ? -Math.log(Math.max(1e-6, this.rgbData.redDC / 255)) : 0,
        odG: this.rgbData.greenDC > 0 ? -Math.log(Math.max(1e-6, this.rgbData.greenDC / 255)) : 0,
        odB: (this.rgbData.blueDC ?? 0) > 0 ? -Math.log(Math.max(1e-6, (this.rgbData.blueDC ?? 1) / 255)) : 0,
        perfusionRed: this.rgbData.redDC > 0 ? this.rgbData.redAC / this.rgbData.redDC : 0,
        perfusionGreen: this.rgbData.greenDC > 0 ? this.rgbData.greenAC / this.rgbData.greenDC : 0,
        pulseAmplitude: medianF.systolicAmplitude,
        dicroticDepth: medianF.dicroticDepth,
        rgRatio: this.rgbData.greenDC > 0 ? this.rgbData.redDC / this.rgbData.greenDC : 0,
        hr,
      };
      this.lastHemoglobin = this.hemoglobinProcessor.process(hbF);
    }

    // ── Respiratory rate (AM+FM+BW + Welch) — Phase 6 ──
    this.respFrameCounter++;
    if (
      this.respFrameCounter >= this.RESP_REFRESH_EVERY &&
      this.signalHistory.length >= Math.round(sampleRate * 25)
    ) {
      this.respFrameCounter = 0;
      this.lastResp = this.respProcessor.process({
        ppg: this.signalHistory,
        sampleRate,
        rrIntervalsMs: validRR,
      });
    }

    // ── Hierarchical rhythm classification — strict quality gate first ────────
    const rhythmGate = this.evaluateRhythmGate(beatInputs);
    this.lastRhythmGatePassed = rhythmGate.passed;
    this.lastRhythmBlockedReasons = rhythmGate.blockedReasons;
    if (rhythmGate.passed && beatInputs && beatInputs.length >= 4) {
      const sourceQuality = Math.max(this.upstreamContext.sourceStability, this.upstreamContext.detectorAgreement);
      const winSQI = this.upstreamContext.avgBeatSQI / 100;

      const rhythmResult = this.rhythmClassifier.classify(
        beatInputs,
        Math.max(this.upstreamContext.avgBeatSQI, 20),
        sourceQuality,
      );
      this.lastRhythm = rhythmResult;

      if (rhythmResult.rhythmConfidence >= 0.20 && rhythmResult.rhythmLabel !== 'INSUFFICIENT_DATA') {
        const rhythmCount = rhythmResult.recentEvents?.length ?? 0;
        this.measurements.arrhythmiaStatus = `${rhythmResult.rhythmLabel}|${rhythmCount}`;
        this.measurements.arrhythmiaCount = rhythmCount;
        this.measurements.lastArrhythmiaData = rhythmResult.hrv?.rmssd > 0 ? {
          timestamp: Date.now(),
          rmssd: rhythmResult.hrv.rmssd,
          rrVariation: rhythmResult.hrv.sdnn / Math.max(1, (validRR.reduce((a, b) => a + b, 0) / validRR.length || 1)),
        } : null;
      }
    }
  }

  private evaluateRhythmGate(
    beatInputs?: Array<{ beatSQI: number }>
  ): { passed: boolean; blockedReasons: string[] } {
    const blockedReasons: string[] = [];
    const beatCount = beatInputs?.length ?? 0;
    if (beatCount < 4) blockedReasons.push('INSUFFICIENT_BEATS');
    if (!this.upstreamContext.contactStable) blockedReasons.push('UNSTABLE_CONTACT');
    if (this.measurements.signalQuality < 25) blockedReasons.push('LOW_SIGNAL_QUALITY');
    if (this.upstreamContext.avgBeatSQI < 30) blockedReasons.push('LOW_BEAT_SQI');
    if (this.upstreamContext.sourceStability < 0.35) blockedReasons.push('LOW_SOURCE_STABILITY');
    if (this.upstreamContext.clipHighRatio > 0.18) blockedReasons.push('EXCESSIVE_CLIPPING');
    const passed = blockedReasons.length === 0;
    return { passed, blockedReasons };
  }

  private getFormattedResult(): VitalSignsResult {
    const spo2State = this.lastSpo2?.enabledState ?? 'WITHHELD_LOW_QUALITY';
    const glucoseState = this.lastGlucose?.enabledState ?? 'WITHHELD_LOW_QUALITY';
    const lipidsState = this.lastLipids?.enabledState ?? 'WITHHELD_LOW_QUALITY';

    const bpGated = MeasurementGate.gateBP(
      this.measurements.systolicPressure, this.measurements.diastolicPressure,
      this.lastBPConfidence, this.lastBPFeatureQuality, 0
    );

    // Safe access to measurements with fallbacks
    const safeMeasurements = {
      spo2: isFinite(this.measurements.spo2) ? this.measurements.spo2 : 0,
      glucose: isFinite(this.measurements.glucose) ? this.measurements.glucose : 0,
      systolicPressure: isFinite(this.measurements.systolicPressure) ? this.measurements.systolicPressure : 0,
      diastolicPressure: isFinite(this.measurements.diastolicPressure) ? this.measurements.diastolicPressure : 0,
      arrhythmiaCount: isFinite(this.measurements.arrhythmiaCount) ? this.measurements.arrhythmiaCount : 0,
      arrhythmiaStatus: this.measurements.arrhythmiaStatus ?? 'UNKNOWN',
      totalCholesterol: isFinite(this.measurements.totalCholesterol) ? this.measurements.totalCholesterol : 0,
      triglycerides: isFinite(this.measurements.triglycerides) ? this.measurements.triglycerides : 0,
      signalQuality: isFinite(this.measurements.signalQuality) ? this.measurements.signalQuality : 0,
    };

    // Safe access to upstream context
    const safeUpstreamContext = {
      sourceStability: isFinite(this.upstreamContext.sourceStability) ? this.upstreamContext.sourceStability : 0,
      clipHighRatio: isFinite(this.upstreamContext.clipHighRatio) ? this.upstreamContext.clipHighRatio : 0,
      contactStable: this.upstreamContext.contactStable ?? false,
      beatCount: isFinite(this.upstreamContext.beatCount) ? this.upstreamContext.beatCount : 0,
    };

    // Safe access to RGB data
    const safeRgbData = {
      greenDC: isFinite(this.rgbData.greenDC) ? this.rgbData.greenDC : 0,
      greenAC: isFinite(this.rgbData.greenAC) ? this.rgbData.greenAC : 0,
    };

    return {
      spo2: Math.round(safeMeasurements.spo2),
      glucose: Math.round(safeMeasurements.glucose),
      pressure: {
        systolic: Math.round(safeMeasurements.systolicPressure),
        diastolic: Math.round(safeMeasurements.diastolicPressure),
        confidence: this.lastBPConfidence ?? 'LOW',
        featureQuality: this.lastBPFeatureQuality ?? 0,
      },
      arrhythmiaCount: safeMeasurements.arrhythmiaCount,
      arrhythmiaStatus: safeMeasurements.arrhythmiaStatus,
      lipids: {
        totalCholesterol: Math.round(safeMeasurements.totalCholesterol),
        triglycerides: Math.round(safeMeasurements.triglycerides),
      },
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100)),
      lastArrhythmiaData: this.measurements.lastArrhythmiaData ?? undefined,
      signalQuality: Math.round(safeMeasurements.signalQuality),
      measurementConfidence: this.getMeasurementConfidence(),
      rhythm: this.lastRhythm ? {
        label: this.lastRhythm.rhythmLabel ?? 'UNKNOWN',
        confidence: this.lastRhythm.rhythmConfidence ?? 0,
        burden: this.lastRhythm.arrhythmiaBurden ?? 0,
        recentEvents: this.lastRhythm.recentEvents ?? [],
      } : undefined,
      spo2Detail: this.lastSpo2 ?? undefined,
      glucoseDetail: this.lastGlucose ?? undefined,
      lipidsDetail: this.lastLipids ?? undefined,
      outputStates: {
        bpm: 'ENABLED_MEDIUM_CONFIDENCE',
        spo2: spo2State,
        bp: bpGated.state,
        glucose: glucoseState,
        lipids: lipidsState,
        rhythm: this.lastRhythm ? (this.lastRhythm.rhythmQuality > 40 ? 'ENABLED_MEDIUM_CONFIDENCE' : 'ENABLED_LOW_CONFIDENCE') : 'WITHHELD_LOW_QUALITY',
      },
      hrv: this.lastHRV ?? undefined,
      stress: this.lastStress ?? undefined,
      respiration: this.lastResp ?? undefined,
      hemoglobin: this.lastHemoglobin ?? undefined,
      debugMetrics: {
        motionScore: 1 - Math.max(0, Math.min(1, safeUpstreamContext.sourceStability)),
        clipHighRatio: safeUpstreamContext.clipHighRatio,
        clipLowRatio: 0,
        sourceStability: safeUpstreamContext.sourceStability,
        contactState: safeUpstreamContext.contactStable ? 'STABLE_CONTACT' : 'UNSTABLE_CONTACT',
        perfusionIndex: safeRgbData.greenDC > 0 ? (safeRgbData.greenAC / safeRgbData.greenDC) * 100 : 0,
        beatCount: safeUpstreamContext.beatCount,
        rhythmGatePassed: this.lastRhythmGatePassed,
        rhythmBlockedReasons: this.lastRhythmBlockedReasons,
      },
      moduleMaturity: {
        bpm: 'production-grade',
        ppgWaveform: 'production-grade',
        hrv: 'advanced-calibration-dependent',
        spo2: 'advanced-calibration-dependent',
        bloodPressure: 'research-calibrated',
        glucose: 'research-calibrated',
        lipids: 'research-calibrated',
        rhythm: 'advanced-calibration-dependent',
        hemoglobin: 'research-calibrated',
      },
    };
  }

  private smoothValue(current: number, newVal: number, type: 'stable' | 'dynamic' = 'stable'): number {
    if (current === 0 || !isFinite(current)) return newVal;
    if (!isFinite(newVal)) return current;
    const baseAlpha = type === 'stable' ? this.EMA_ALPHA_STABLE : this.EMA_ALPHA_DYNAMIC;
    const relChange = Math.abs(newVal - current) / (Math.abs(current) + 0.01);
    let alpha = baseAlpha;
    if (relChange > 0.5) alpha = baseAlpha * 0.3;
    else if (relChange > 0.3) alpha = baseAlpha * 0.5;
    else if (relChange < 0.1) alpha = baseAlpha * 1.5;
    alpha = Math.max(0.05, Math.min(0.4, alpha));
    return current * (1 - alpha) + newVal * alpha;
  }

  private medianCycleFeatures(cycles: import('./PPGFeatureExtractor').CycleFeatures[]) {
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    return {
      sutMs: median(cycles.map(c => c.sutMs)),
      diastolicTimeMs: median(cycles.map(c => c.diastolicTimeMs)),
      pw10Ms: median(cycles.map(c => c.pw10Ms)),
      pw25Ms: median(cycles.map(c => c.pw25Ms)),
      pw50Ms: median(cycles.map(c => c.pw50Ms)),
      pw75Ms: median(cycles.map(c => c.pw75Ms)),
      systolicAmplitude: median(cycles.map(c => c.systolicAmplitude)),
      diastolicAmplitude: median(cycles.map(c => c.diastolicAmplitude)),
      dicroticDepth: median(cycles.map(c => c.dicroticDepth)),
      systolicArea: median(cycles.map(c => c.systolicArea)),
      diastolicArea: median(cycles.map(c => c.diastolicArea)),
      areaRatio: median(cycles.map(c => c.areaRatio)),
      ipaRatio: median(cycles.map(c => c.ipaRatio)),
      stiffnessIndex: median(cycles.map(c => c.stiffnessIndex)),
      augmentationIndex: median(cycles.map(c => c.augmentationIndex)),
      pwvProxy: median(cycles.map(c => c.pwvProxy)),
      apgBDivA: median(cycles.map(c => c.apg.bDivA)),
      apgDDivA: median(cycles.map(c => c.apg.dDivA)),
      apgAgi: median(cycles.map(c => c.apg.agi)),
    };
  }

  getCalibrationProgress(): number {
    return Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100));
  }

  reset(): VitalSignsResult | null {
    const result = this.getFormattedResult();
    this.signalHistory = [];
    this.validPulseCount = 0;
    this.spo2Processor.reset();
    this.bloodPressureProcessor.reset();
    this.hemoglobinProcessor.reset();
    this.glucoseProcessor.reset();
    this.lipidProcessor.reset();
    this.rhythmClassifier.reset();
    this.measurements.arrhythmiaCount = 0;
    this.measurements.arrhythmiaStatus = "SIN ARRITMIAS|0";
    this.measurements.lastArrhythmiaData = null;
    return result.spo2 !== 0 ? result : null;
  }

  hasValidPressureEstimate(): boolean {
    return this.measurements.systolicPressure > 0 && this.measurements.diastolicPressure > 0;
  }

  fullReset(): void {
    this.signalHistory = [];
    this.validPulseCount = 0;
    this.measurements = {
      spo2: 0, glucose: 0, systolicPressure: 0, diastolicPressure: 0,
      arrhythmiaCount: 0, arrhythmiaStatus: "SIN ARRITMIAS|0",
      totalCholesterol: 0, triglycerides: 0, lastArrhythmiaData: null, signalQuality: 0,
    };
    this.rgbData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
    this.isCalibrating = false;
    this.calibrationSamples = 0;
    this.bloodPressureProcessor.fullReset();
    this.spo2Processor.fullReset();
    this.hemoglobinProcessor.fullReset();
    this.glucoseProcessor.fullReset();
    this.lipidProcessor.fullReset();
    this.rhythmClassifier.reset();
    this.lastRhythm = null;
    this.lastSpo2 = null;
    this.lastGlucose = null;
    this.lastLipids = null;
    this.lastHRV = null;
    this.lastStress = null;
    this.lastResp = null;
    this.lastHemoglobin = null;
    this.piHistory = [];
    this.respFrameCounter = 0;
  }
}
