import { PPGFeatureExtractor } from './PPGFeatureExtractor';
import { BloodPressureProcessorV2, type BPFeatureVector } from './BloodPressureProcessorV2';
import { BloodPressureProcessorV3, type BPV3Features } from './BloodPressureProcessorV3';
import { RhythmClassifierV2, type RhythmLabelV2, type RhythmEvidence } from './RhythmClassifierV2';
import { RhythmClassifier, type RhythmResult as RhythmResultV3 } from './RhythmClassifier';
import { SpO2ProcessorV2, type SpO2Calibration } from './SpO2ProcessorV2';
import { SpO2ProcessorV3 } from './SpO2ProcessorV3';
import { GlucoseResearchProcessorV2, type GlucoseFeatureVector } from '../biomarkers/GlucoseResearchProcessorV2';
import { LipidResearchProcessorV2, type LipidFeatureVector } from '../biomarkers/LipidResearchProcessorV2';
import { GlucoseResearchProcessorV3, type GlucoseV3Features } from '../biomarkers/GlucoseResearchProcessorV3';
import { LipidResearchProcessorV3, type LipidV3Features } from '../biomarkers/LipidResearchProcessorV3';
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
    label: RhythmLabelV2;
    confidence: number;
    burden: number;
    recentEvents: any[];
    evidence?: RhythmEvidence;
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
  private bloodPressureProcessor: BloodPressureProcessorV2;
  private bloodPressureProcessorV3: BloodPressureProcessorV3;
  /** Phase 8 opt-in: V3 ridge regressor with LOO-RMSE; V2 stays as fallback. */
  private useBPV3 = true;
  private rhythmClassifier: RhythmClassifierV2;
  private rhythmClassifierV3: RhythmClassifier;
  private spo2Processor: SpO2ProcessorV2;
  private spo2ProcessorV3: SpO2ProcessorV3;
  /** Phase 7 opt-in: when true, V3 runs in parallel and its result is published
   *  if (and only if) it has a calibration loaded — otherwise V2 is used. */
  private useSpO2V3 = true;
  private glucoseProcessor: GlucoseResearchProcessorV2;
  private glucoseProcessorV3: GlucoseResearchProcessorV3;
  private lipidProcessor: LipidResearchProcessorV2;
  private lipidProcessorV3: LipidResearchProcessorV3;
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

  private readonly EMA_ALPHA_STABLE = 0.20;
  private readonly EMA_ALPHA_DYNAMIC = 0.30;

  constructor() {
    this.bloodPressureProcessor = new BloodPressureProcessorV2();
    this.bloodPressureProcessorV3 = new BloodPressureProcessorV3();
    this.rhythmClassifier = new RhythmClassifierV2();
    this.rhythmClassifierV3 = new RhythmClassifier();
    this.spo2Processor = new SpO2ProcessorV2();
    this.spo2ProcessorV3 = new SpO2ProcessorV3();
    this.glucoseProcessor = new GlucoseResearchProcessorV2();
    this.glucoseProcessorV3 = new GlucoseResearchProcessorV3();
    this.lipidProcessor = new LipidResearchProcessorV2();
    this.lipidProcessorV3 = new LipidResearchProcessorV3();
    this.hrvProcessor = new HRVTimeFreqProcessor();
    this.stressProcessor = new StressProcessor();
    this.respProcessor = new RespiratoryRateProcessor();
    this.hemoglobinProcessor = new HemoglobinProcessor();

    // Phase 12 — local-storage hydration (fast path, no network).
    // Calibrations stored from previous sessions become immediately available.
    try {
      const spo2v3 = loadCalibrationLocal<any>('spo2_v3');
      if (spo2v3) this.spo2ProcessorV3.loadSerializedCalibration(spo2v3);
      const bpv3 = loadCalibrationLocal<any>('bp_v3');
      if (bpv3) this.bloodPressureProcessorV3.loadSerializedCalibration(bpv3);
      const hbv1 = loadCalibrationLocal<any>('hemoglobin_v1');
      if (hbv1) this.hemoglobinProcessor.loadSerializedCalibration(hbv1);
      const glucoseV3 = loadCalibrationLocal<any>('glucose_v3');
      if (glucoseV3) this.glucoseProcessorV3.loadSerializedCalibration(glucoseV3);
      const lipidsV3 = loadCalibrationLocal<any>('lipids_v3');
      if (lipidsV3) this.lipidProcessorV3.loadSerializedCalibration(lipidsV3);
    } catch { /* private mode etc. */ }
  }

  /**
   * Phase 12 — async cross-tier hydration. Call once after Supabase auth
   * has resolved to fetch the user's authoritative calibrations.
   */
  async autoLoadCalibrations(): Promise<void> {
    try {
      const spo2v3 = await loadCalibration<any>('spo2_v3');
      if (spo2v3) this.spo2ProcessorV3.loadSerializedCalibration(spo2v3);
      const bpv3 = await loadCalibration<any>('bp_v3');
      if (bpv3) this.bloodPressureProcessorV3.loadSerializedCalibration(bpv3);
      const hbv1 = await loadCalibration<any>('hemoglobin_v1');
      if (hbv1) this.hemoglobinProcessor.loadSerializedCalibration(hbv1);
      const glucoseV3 = await loadCalibration<any>('glucose_v3');
      if (glucoseV3) this.glucoseProcessorV3.loadSerializedCalibration(glucoseV3);
      const lipidsV3 = await loadCalibration<any>('lipids_v3');
      if (lipidsV3) this.lipidProcessorV3.loadSerializedCalibration(lipidsV3);
    } catch (e) {
      console.warn('[vitals] autoLoadCalibrations failed:', (e as any)?.message ?? e);
    }
  }

  /** Phase 12 — persist all current V3 calibrations (best-effort). */
  async persistCalibrations(): Promise<void> {
    try {
      const spo2v3 = this.spo2ProcessorV3.serializeCalibration();
      if (spo2v3.calibration) await saveCalibration('spo2_v3' as CalibrationModality, spo2v3);
      const bpv3 = this.bloodPressureProcessorV3.serializeCalibration();
      if (bpv3.model) await saveCalibration('bp_v3' as CalibrationModality, bpv3);
      const hbv1 = this.hemoglobinProcessor.serializeCalibration();
      if (hbv1.model) await saveCalibration('hemoglobin_v1' as CalibrationModality, hbv1);
      const glucoseV3 = this.glucoseProcessorV3.serializeCalibration();
      if (glucoseV3.model) await saveCalibration('glucose_v3' as CalibrationModality, glucoseV3);
      const lipidsV3 = this.lipidProcessorV3.serializeCalibration();
      if (lipidsV3.models) await saveCalibration('lipids_v3' as CalibrationModality, lipidsV3);
    } catch (e) {
      console.warn('[vitals] persistCalibrations failed:', (e as any)?.message ?? e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CALIBRATION WIZARDS (V2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Iniciar wizard de calibración de presión arterial (V2 + V3 en paralelo).
   * V3 (ridge LOO) requiere ≥5 puntos; V2 (legacy) acepta ≥3.
   */
  startBPCalibrationWizard(referenceDevice: string, userId: string): void {
    this.bloodPressureProcessor.startCalibrationWizard(referenceDevice, userId);
    this.bloodPressureProcessorV3.startCalibrationWizard();
  }

  /**
   * Agregar punto de calibración de BP con referencia real.
   * `v3Features` opcional — si se omite, la calibración sólo entrena V2.
   */
  addBPCalibrationPoint(
    ppgFeatures: BPFeatureVector,
    referenceSBP: number,
    referenceDBP: number,
    v3Features?: BPV3Features
  ): { success: boolean; pointsCollected: number; pointsNeeded: number } {
    const v2Res = this.bloodPressureProcessor.addCalibrationPoint(ppgFeatures, referenceSBP, referenceDBP);
    if (v3Features) {
      this.bloodPressureProcessorV3.addCalibrationPoint(v3Features, referenceSBP, referenceDBP);
    }
    return v2Res;
  }

  /**
   * Finalizar wizard de calibración de BP. Devuelve métricas combinadas
   * (V3 LOO-RMSE si está disponible, sino V2). Persiste la calibración V3.
   */
  finishBPCalibrationWizard(): { success: boolean; rmseSBP: number; rmseDBP: number } {
    const v2 = this.bloodPressureProcessor.finishCalibrationWizard();
    const v3 = this.bloodPressureProcessorV3.finishCalibrationWizard();
    if (v3.success) {
      // fire-and-forget persistence
      this.persistCalibrations().catch(() => { /* */ });
      return { success: true, rmseSBP: v3.rmseSBP, rmseDBP: v3.rmseDBP };
    }
    return v2;
  }

  /** Estado V3 (puntos, RMSE, antigüedad) para el wizard UI. */
  getBPV3CalibrationStatus() {
    return this.bloodPressureProcessorV3.getCalibrationStatus();
  }

  /** Habilitar/deshabilitar BP V3 (default: true). */
  setBPV3Enabled(enabled: boolean): void {
    this.useBPV3 = enabled;
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

  // ─── Glucose V3 (Phase 9) ───
  startGlucoseV3Training(): void { this.glucoseProcessorV3.startTrainingMode(); }
  addGlucoseV3TrainingSample(features: GlucoseV3Features, refMgDl: number) {
    const r = this.glucoseProcessorV3.addTrainingSample(features, refMgDl);
    this.persistCalibrations().catch(() => { /* */ });
    return r;
  }
  finishGlucoseV3Training() {
    const r = this.glucoseProcessorV3.finishTraining();
    if (r.success) this.persistCalibrations().catch(() => { /* */ });
    return r;
  }
  getGlucoseV3CalibrationStatus() { return this.glucoseProcessorV3.getCalibrationStatus(); }

  // ─── Lipids V3 (Phase 9) ───
  startLipidsV3Training(): void { this.lipidProcessorV3.startTraining(); }
  addLipidsV3TrainingSample(features: LipidV3Features, refLabs: { totalCholesterol: number; ldl: number; hdl: number; triglycerides: number }) {
    const r = this.lipidProcessorV3.addTrainingSample(features, refLabs);
    this.persistCalibrations().catch(() => { /* */ });
    return r;
  }
  finishLipidsV3Training() {
    const r = this.lipidProcessorV3.finishTraining();
    if (r.success) this.persistCalibrations().catch(() => { /* */ });
    return r;
  }
  getLipidsV3CalibrationStatus() { return this.lipidProcessorV3.getCalibrationStatus(); }

  /**
   * Cargar calibración de dispositivo SpO2 (aplicada a V2 y V3)
   */
  loadSpO2DeviceCalibration(profile: SpO2Calibration): void {
    this.spo2Processor.loadDeviceCalibration(profile);
    this.spo2ProcessorV3.loadDeviceCalibration(profile);
  }

  /**
   * Agregar punto de calibración SpO2 de usuario.
   * `ratioRG` y `ratioRB` son opcionales; si se proveen, V3 puede ajustar α
   * (blend R/G vs R/B) y mejorar exactitud en este device.
   * Persiste tras cada punto cuando V3 ya tiene un modelo activo.
   */
  addSpO2UserCalibrationPoint(referenceSpO2: number, measuredR: number, ratioRG = 0, ratioRB = 0): void {
    this.spo2Processor.addUserCalibrationPoint(referenceSpO2, measuredR);
    this.spo2ProcessorV3.addUserCalibrationPoint(referenceSpO2, measuredR, ratioRG, ratioRB);
    // Try to persist after each point. The V3 fit only happens once we have
    // ≥3 user points, so this only writes when there's a real model to save.
    this.persistCalibrations().catch(() => { /* */ });
  }

  /** Habilitar/deshabilitar SpO2 V3 (default: true). */
  setSpO2V3Enabled(enabled: boolean): void {
    this.useSpO2V3 = enabled;
  }

  /**
   * Iniciar modo entrenamiento de glucosa
   */
  startGlucoseTraining(userId: string, referenceDevice: string): void {
    this.glucoseProcessor.startTrainingMode(userId, referenceDevice);
  }

  /**
   * Agregar muestra de entrenamiento de glucosa
   */
  addGlucoseTrainingSample(
    ppgFeatures: GlucoseFeatureVector,
    referenceGlucose: number
  ): { success: boolean; samplesCollected: number; canTrain: boolean } {
    return this.glucoseProcessor.addTrainingSample(ppgFeatures, referenceGlucose);
  }

  /**
   * Iniciar modo entrenamiento de lípidos
   */
  startLipidTraining(userId: string, labSource: string): void {
    this.lipidProcessor.startTraining(userId, labSource);
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
    return this.lipidProcessor.addTrainingSample(ppgFeatures, referenceLabs);
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

    // ── SpO2 (V3 multi-channel preferred, V2 fallback) — Phase 7 ──
    const v2Result = this.spo2Processor.process({
      redAC: this.rgbData.redAC, redDC: this.rgbData.redDC,
      greenAC: this.rgbData.greenAC, greenDC: this.rgbData.greenDC,
      contactStable: this.upstreamContext.contactStable,
      pressureOptimal: this.upstreamContext.pressureOptimal,
      clipHighRatio: this.upstreamContext.clipHighRatio,
      beatCount: Math.max(this.upstreamContext.beatCount, beatInputs?.length || 0),
      avgBeatSQI: this.upstreamContext.avgBeatSQI,
      sourceStability: this.upstreamContext.sourceStability,
    });
    let spo2Result = v2Result;
    if (this.useSpO2V3) {
      const v3Result = this.spo2ProcessorV3.process({
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
      // Use V3 only when it actually published a value with usable confidence
      if (v3Result.value !== null && v3Result.confidence > Math.max(0.3, v2Result.confidence)) {
        spo2Result = v3Result;
      }
    }
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

    if (validRR.length >= 2) {
      const bpEstimate = this.bloodPressureProcessor.estimate(this.signalHistory, validRR, sampleRate);
      this.lastBPConfidence = bpEstimate.confidence;
      this.lastBPFeatureQuality = bpEstimate.featureQuality;
      if (bpEstimate.systolic > 0 && bpEstimate.confidence !== 'INSUFFICIENT') {
        this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, bpEstimate.systolic, 'stable');
        this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, bpEstimate.diastolic, 'stable');
      }

      // ── V3 ridge predictor (Phase 8). Runs only when a calibrated model
      // exists AND we have median cycle features to feed the regressor. ──
      if (this.useBPV3 && medianF) {
        const v3Features: BPV3Features = {
          stiffnessIndex: medianF.stiffnessIndex,
          augmentationIndex: medianF.augmentationIndex,
          sutMs: medianF.sutMs,
          pw50Ms: medianF.pw50Ms,
          pw75Ms: medianF.pw75Ms,
          pw25Ms: medianF.pw25Ms,
          crestTimeMs: medianF.sutMs, // crest ≈ SUT for monomodal pulses
          dicroticDepth: medianF.dicroticDepth,
          areaRatio: medianF.areaRatio,
          pwvProxy: medianF.pwvProxy,
          hr,
          rrSDNN: rrVar.sdnn,
          rrRMSSD: rrVar.rmssd,
          apgBDivA: medianF.apgBDivA,
          apgDDivA: medianF.apgDDivA,
          apgAGI: medianF.apgAgi,
          perfusionIndex: piGreen,
          contactQuality: this.upstreamContext.contactStable ? 0.9 : 0.4,
        };
        const v3Out = this.bloodPressureProcessorV3.process(
          v3Features,
          Math.max(0, this.measurements.signalQuality / 100),
          this.upstreamContext.beatCount,
          this.signalHistory.length / Math.max(1, sampleRate) * 1000
        );
        // Use V3 only when calibrated and confident; V2 stays the default.
        if (
          v3Out.value &&
          typeof v3Out.value === 'object' &&
          v3Out.confidence > 0.5
        ) {
          const sys = (v3Out.value as any).systolic;
          const dia = (v3Out.value as any).diastolic;
          if (sys > 0 && dia > 0) {
            this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, sys, 'stable');
            this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, dia, 'stable');
            // Map V3's confidence into the legacy enum so the gate keeps working.
            this.lastBPConfidence = v3Out.confidence > 0.75 ? 'HIGH'
              : v3Out.confidence > 0.55 ? 'MEDIUM'
              : 'LOW';
            this.lastBPFeatureQuality = Math.max(this.lastBPFeatureQuality, Math.round(v3Out.confidence * 100));
          }
        }
      }
    }

    const piGreen = this.rgbData.greenDC > 0 ? (this.rgbData.greenAC / this.rgbData.greenDC) * 100 : 0;
    const rgACRatio = this.rgbData.greenAC > 0 ? this.rgbData.redAC / this.rgbData.greenAC : 0;

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

      // Phase 9 — V3 ridge regressors run in parallel; values overwrite V2
      // when the V3 model is calibrated AND publishes (researchMode flag stays).
      const odR = this.rgbData.redDC > 0 ? -Math.log(Math.max(1e-6, this.rgbData.redDC / 255)) : 0;
      const odG = this.rgbData.greenDC > 0 ? -Math.log(Math.max(1e-6, this.rgbData.greenDC / 255)) : 0;
      const odB = (this.rgbData.blueDC ?? 0) > 0 ? -Math.log(Math.max(1e-6, (this.rgbData.blueDC ?? 1) / 255)) : 0;

      const gV3Features: GlucoseV3Features = {
        sutMs: medianF.sutMs, pw50Ms: medianF.pw50Ms, pw75Ms: medianF.pw75Ms, pw25Ms: medianF.pw25Ms,
        augmentationIndex: medianF.augmentationIndex, stiffnessIndex: medianF.stiffnessIndex,
        dicroticDepth: medianF.dicroticDepth, areaRatio: medianF.areaRatio,
        hr, rrSDNN: rrVar.sdnn,
        perfusionGreen: this.rgbData.greenDC > 0 ? this.rgbData.greenAC / this.rgbData.greenDC : 0,
        rgRatio: this.rgbData.greenDC > 0 ? this.rgbData.redDC / this.rgbData.greenDC : 0,
        odR, odG, odB,
      };
      const glucoseV3Result = this.glucoseProcessorV3.process(gV3Features, Math.max(0, this.measurements.signalQuality / 100));
      if (glucoseV3Result.value !== null && glucoseV3Result.confidence > 0.3) {
        this.lastGlucose = glucoseV3Result as any;
        this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucoseV3Result.value as number, 'dynamic');
      }

      const lV3Features: LipidV3Features = {
        stiffnessIndex: medianF.stiffnessIndex, augmentationIndex: medianF.augmentationIndex,
        pwvProxy: medianF.pwvProxy, pulseAmplitude: medianF.systolicAmplitude,
        pw50Ms: medianF.pw50Ms, pw75Ms: medianF.pw75Ms, pw25Ms: medianF.pw25Ms,
        diastolicTimeMs: medianF.diastolicTimeMs, areaRatio: medianF.areaRatio,
        dicroticDepth: medianF.dicroticDepth,
        hr, rrSDNN: rrVar.sdnn,
        perfusionGreen: this.rgbData.greenDC > 0 ? this.rgbData.greenAC / this.rgbData.greenDC : 0,
      };
      const lipidsV3Result = this.lipidProcessorV3.process(lV3Features, Math.max(0, this.measurements.signalQuality / 100));
      if (lipidsV3Result.value && typeof lipidsV3Result.value === 'object' && lipidsV3Result.confidence > 0.25) {
        this.lastLipids = lipidsV3Result as any;
        const v = lipidsV3Result.value as any;
        if (v.totalCholesterol > 0) this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol, v.totalCholesterol, 'dynamic');
        if (v.triglycerides > 0) this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides, v.triglycerides, 'dynamic');
      }
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

    // ── Hierarchical rhythm classification — V3 + V2 fallback ────────
    if (beatInputs && beatInputs.length >= 4) {
      const sourceQuality = Math.max(this.upstreamContext.sourceStability, this.upstreamContext.detectorAgreement);
      const winSQI = Math.max(this.upstreamContext.avgBeatSQI, 20) / 100;

      // V3 classifier has DFA α1, SampEn, bigeminy/trigeminy patterns
      const rhythmV3 = this.rhythmClassifierV3.classify(beatInputs, winSQI, sourceQuality);
      const rhythmResult = this.rhythmClassifier.classify(
        beatInputs,
        Math.max(this.upstreamContext.avgBeatSQI, 20),
        sourceQuality
      );
      this.lastRhythm = rhythmResult;

      // Use V3 label when it has higher confidence
      const bestLabel = rhythmV3.rhythmConfidence >= 0.25
        ? rhythmV3.rhythmLabel
        : rhythmResult.rhythmLabel ?? 'INSUFFICIENT_DATA';
      const bestConfidence = Math.max(rhythmV3.rhythmConfidence, rhythmResult.rhythmConfidence ?? 0);

      if (bestConfidence >= 0.20 && bestLabel !== 'INSUFFICIENT_DATA') {
        const rhythmCount = rhythmV3.recentEvents?.length ?? 0;
        this.measurements.arrhythmiaStatus = `${bestLabel}|${rhythmCount}`;
        this.measurements.arrhythmiaCount = rhythmCount;
        this.measurements.lastArrhythmiaData = rhythmV3.hrv.rmssd > 0 ? {
          timestamp: Date.now(),
          rmssd: rhythmV3.hrv.rmssd,
          rrVariation: rhythmV3.hrv.sdnn / Math.max(1, (validRR.reduce((a, b) => a + b, 0) / validRR.length || 1)),
        } : null;
      }
    }
  }

  private getFormattedResult(): VitalSignsResult {
    const spo2State = this.lastSpo2?.enabledState ?? 'WITHHELD_LOW_QUALITY';
    const glucoseState = this.lastGlucose?.enabledState ?? 'WITHHELD_LOW_QUALITY';
    const lipidsState = this.lastLipids?.enabledState ?? 'WITHHELD_LOW_QUALITY';

    const bpGated = MeasurementGate.gateBP(
      this.measurements.systolicPressure, this.measurements.diastolicPressure,
      this.lastBPConfidence, this.lastBPFeatureQuality, 0
    );

    return {
      spo2: Math.round(this.measurements.spo2),
      glucose: Math.round(this.measurements.glucose),
      pressure: {
        systolic: Math.round(this.measurements.systolicPressure),
        diastolic: Math.round(this.measurements.diastolicPressure),
        confidence: this.lastBPConfidence,
        featureQuality: this.lastBPFeatureQuality,
      },
      arrhythmiaCount: this.measurements.arrhythmiaCount,
      arrhythmiaStatus: this.measurements.arrhythmiaStatus,
      lipids: {
        totalCholesterol: Math.round(this.measurements.totalCholesterol),
        triglycerides: Math.round(this.measurements.triglycerides),
      },
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100)),
      lastArrhythmiaData: this.measurements.lastArrhythmiaData ?? undefined,
      signalQuality: Math.round(this.measurements.signalQuality),
      measurementConfidence: this.getMeasurementConfidence(),
      rhythm: this.lastRhythm ? {
        label: this.lastRhythm.rhythmLabel,
        confidence: this.lastRhythm.rhythmConfidence,
        burden: this.lastRhythm.arrhythmiaBurden,
        recentEvents: this.lastRhythm.recentEvents,
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
    this.spo2ProcessorV3.reset();
    this.bloodPressureProcessorV3.reset();
    this.hemoglobinProcessor.reset();
    this.glucoseProcessor.reset();
    this.glucoseProcessorV3.reset();
    this.lipidProcessor.reset();
    this.lipidProcessorV3.reset();
    this.rhythmClassifier.reset();
    this.rhythmClassifierV3.reset();
    this.spo2ProcessorV3.reset();
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
    this.bloodPressureProcessorV3.fullReset();
    this.spo2Processor.fullReset();
    this.spo2ProcessorV3.fullReset();
    this.hemoglobinProcessor.fullReset();
    this.glucoseProcessor.fullReset();
    this.glucoseProcessorV3.fullReset();
    this.lipidProcessorV3.fullReset();
    this.lipidProcessor.fullReset();
    this.rhythmClassifier.reset();
    this.rhythmClassifierV3.reset();
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
