import { PPGFeatureExtractor } from './PPGFeatureExtractor';
import { BloodPressureProcessorElite } from './BloodPressureProcessorElite';
import { RhythmClassifier, type RhythmResult, type RhythmLabel } from './RhythmClassifier';

type BeatInputRow = {
  ibiMs: number;
  beatSQI: number;
  morphologyScore: number;
  detectorAgreement: number;
  amplitude?: number;
  flags: { isWeak: boolean; isPremature: boolean; isSuspicious: boolean; isDoublePeak: boolean };
};
import type { SpO2Result } from './SpO2Processor';
import { SpO2ProcessorElite } from './SpO2ProcessorElite';
import { mapEliteSpO2ToDetail } from './spo2EliteAdapter';
import { SpO2Calibrator } from './SpO2Calibrator';
import { ratioOfRatios } from './OpticalRatioEngine';
import { GlucoseResearchProcessor, type GlucoseResult } from '../biomarkers/GlucoseResearchProcessor';
import { LipidResearchProcessor, type LipidResult } from '../biomarkers/LipidResearchProcessor';
import type { OutputState } from '../core/MeasurementGate';
import { UncertaintyRouter } from '../core/UncertaintyRouter';
import { DeviceProfileManager, deviceFingerprint } from '../calibration/DeviceProfileManager';
import { DeviceCalibrationEngine } from '../calibration/DeviceCalibrationEngine';
import { BPCalibrationManager } from './BPCalibrationManager';
import { UserBaselineEngine } from '../personalization/UserBaselineEngine';
import { LongitudinalDatasetStore } from '../personalization/LongitudinalDatasetStore';
import { clampUserHeightM } from '../personalization/userPhysiology';

export interface VitalSignsResult {
  spo2: number;
  glucose: number;
  pressure: {
    systolic: number;
    diastolic: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    featureQuality: number;
    trendFirst?: boolean;
    trendLabel?: 'UP' | 'DOWN' | 'STABLE';
  };
  arrhythmiaCount: number;
  /** Primario: etiqueta RhythmClassifier + conteo de eventos recientes */
  arrhythmiaStatus: string;
  lipids: {
    totalCholesterol: number;
    triglycerides: number;
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
  spo2Detail?: SpO2Result;
  glucoseDetail?: GlucoseResult;
  lipidsDetail?: LipidResult;
  outputStates?: {
    bpm: OutputState;
    spo2: OutputState;
    bp: OutputState;
    glucose: OutputState;
    lipids: OutputState;
    rhythm: OutputState;
  };
}

export interface RGBData {
  redAC: number;
  redDC: number;
  greenAC: number;
  greenDC: number;
}

export class VitalSignsProcessor {
  private bloodPressureProcessor: BloodPressureProcessorElite;
  private rhythmClassifier: RhythmClassifier;
  private spo2Processor: SpO2ProcessorElite;
  private spo2Calibrator: SpO2Calibrator;
  private glucoseProcessor: GlucoseResearchProcessor;
  private lipidProcessor: LipidResearchProcessor;
  private deviceProfiles: DeviceProfileManager;
  private deviceCalibrationEngine: DeviceCalibrationEngine;
  private bpCalibrationManager: BPCalibrationManager;
  private userBaseline: UserBaselineEngine;
  private longitudinal: LongitudinalDatasetStore;

  private lastBPConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' = 'INSUFFICIENT';
  private lastBPFeatureQuality = 0;
  private lastBpCycles = 0;
  private lastBpTrendFirst = false;
  private lastBpTrendLabel: 'UP' | 'DOWN' | 'STABLE' | undefined;
  private calibrationSamples = 0;
  private readonly CALIBRATION_REQUIRED = 25;
  private isCalibrating = false;

  private measurements = {
    spo2: 0, glucose: 0,
    systolicPressure: 0, diastolicPressure: 0,
    arrhythmiaCount: 0, arrhythmiaStatus: 'SINUS_STABLE|0',
    totalCholesterol: 0, triglycerides: 0,
    lastArrhythmiaData: null as { timestamp: number; rmssd: number; rrVariation: number } | null,
    signalQuality: 0,
  };

  private signalHistory: number[] = [];
  private timestampHistory: number[] = [];
  private readonly HISTORY_SIZE = 90;
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

  private heartRuntime = { bpm: 0, bpmConfidence: 0, beatCount: 0 };

  private lastRhythm: RhythmResult | null = null;
  private lastSpo2: SpO2Result | null = null;
  private lastGlucose: GlucoseResult | null = null;
  private lastLipids: LipidResult | null = null;

  private readonly EMA_ALPHA_STABLE = 0.20;
  private readonly EMA_ALPHA_DYNAMIC = 0.30;

  constructor() {
    const fp = deviceFingerprint();
    this.deviceProfiles = new DeviceProfileManager(fp);
    this.deviceProfiles.bumpSession();
    const profile = this.deviceProfiles.get();
    this.spo2Calibrator = new SpO2Calibrator({
      ...profile.spo2Curve,
      deviceId: profile.deviceProfileId,
    });
    this.spo2Calibrator.setOpticalBiasR(profile.opticalBiasR);
    this.spo2Processor = new SpO2ProcessorElite();
    this.deviceCalibrationEngine = new DeviceCalibrationEngine(this.deviceProfiles, profile);
    this.bpCalibrationManager = new BPCalibrationManager();
    this.userBaseline = new UserBaselineEngine();
    this.longitudinal = new LongitudinalDatasetStore();

    this.bloodPressureProcessor = new BloodPressureProcessorElite();
    this.rhythmClassifier = new RhythmClassifier();
    this.glucoseProcessor = new GlucoseResearchProcessor();
    this.lipidProcessor = new LipidResearchProcessor();
  }

  setHeartRuntime(ctx: { bpm?: number; bpmConfidence?: number; beatCount?: number }): void {
    if (ctx.bpm !== undefined) this.heartRuntime.bpm = ctx.bpm;
    if (ctx.bpmConfidence !== undefined) this.heartRuntime.bpmConfidence = ctx.bpmConfidence;
    if (ctx.beatCount !== undefined) this.heartRuntime.beatCount = ctx.beatCount;
  }

  /** Persiste altura (m) para el modelo PWV en BloodPressureProcessorElite */
  setUserHeightM(meters: number): void {
    this.deviceProfiles.save({ userHeightM: clampUserHeightM(meters) });
  }

  getUserHeightM(): number | undefined {
    return this.deviceProfiles.get().userHeightM;
  }

  /** En ventana de pico cardíaco: refuerza SpO2 con ratio alineado a latido */
  ingestBeatOpticalRatio(): void {
    const R = ratioOfRatios(
      this.rgbData.redAC, this.rgbData.redDC,
      this.rgbData.greenAC, this.rgbData.greenDC
    );
    if (isFinite(R)) this.spo2Processor.ingestBeatRatio(R);
  }

  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    this.validPulseCount = 0;
    this.measurements = {
      spo2: 0, glucose: 0, systolicPressure: 0, diastolicPressure: 0,
      arrhythmiaCount: 0, arrhythmiaStatus: 'CALIBRANDO|0',
      totalCholesterol: 0, triglycerides: 0, lastArrhythmiaData: null, signalQuality: 0,
    };
    this.signalHistory = [];
    this.timestampHistory = [];
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
    }>,
    frameTimestamp?: number
  ): VitalSignsResult {
    const ts = frameTimestamp ?? performance.now();
    this.signalHistory.push(signalValue);
    this.timestampHistory.push(ts);
    if (this.signalHistory.length > this.HISTORY_SIZE) {
      this.signalHistory.shift();
      this.timestampHistory.shift();
    }

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

  private resolveSpo2CalState(): SpO2Result['calibrationState'] {
    const c = this.spo2Calibrator.getCurve();
    if (c.deviceId !== 'default') return 'DEVICE_CALIBRATED';
    return 'UNCALIBRATED';
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

    const contactQ = Math.max(this.measurements.signalQuality, this.upstreamContext.avgBeatSQI);
    const spo2Elite = this.spo2Processor.process({
      redAC: this.rgbData.redAC,
      redDC: this.rgbData.redDC,
      greenAC: this.rgbData.greenAC,
      greenDC: this.rgbData.greenDC,
      contactQuality: contactQ,
      beatSQI: this.upstreamContext.avgBeatSQI,
      pressureOptimal: this.upstreamContext.pressureOptimal,
      clipHighRatio: this.upstreamContext.clipHighRatio,
      clipLowRatio: 0,
    });

    const calState = this.resolveSpo2CalState();
    let spo2Detail = mapEliteSpO2ToDetail(spo2Elite, calState);

    if (spo2Elite.opticalMetrics.ratioR > 0) {
      const calSpo2 = this.spo2Calibrator.estimateSpO2(spo2Elite.opticalMetrics.ratioR);
      if (isFinite(calSpo2) && calSpo2 >= 70 && calSpo2 <= 100) {
        const w = calState === 'DEVICE_CALIBRATED' ? 0.42 : 0.18;
        spo2Detail = {
          ...spo2Detail,
          value: Math.round(spo2Elite.value * (1 - w) + calSpo2 * w),
          confidence: Math.min(1, spo2Detail.confidence + (calState === 'DEVICE_CALIBRATED' ? 0.06 : 0.02)),
        };
      }
      this.deviceCalibrationEngine.ingestFrameStats({
        medianR: spo2Elite.opticalMetrics.ratioR,
        rVariance: Math.max(0, 1 - spo2Elite.quality / 100) * 0.05,
        clipHighEma: this.upstreamContext.clipHighRatio,
        frameIntervalMs: 1000 / sampleRate,
        sourceLabel: 'RG',
      });
      this.spo2Calibrator.setOpticalBiasR(this.deviceCalibrationEngine.getOpticalBiasR());
    }

    this.lastSpo2 = spo2Detail;

    if (spo2Detail.value > 0 && spo2Detail.enabledState !== 'WITHHELD_LOW_QUALITY') {
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2Detail.value, 'stable');
    }

    const cycles = PPGFeatureExtractor.detectCardiacCycles(this.signalHistory, sampleRate);
    const validCycleFeatures: import('./PPGFeatureExtractor').CycleFeatures[] = [];
    for (const cycle of cycles) {
      const features = PPGFeatureExtractor.extractCycleFeatures(this.signalHistory, cycle, sampleRate);
      if (features && features.quality >= 0.2) validCycleFeatures.push(features);
    }

    const medianF = validCycleFeatures.length >= 1 ? this.medianCycleFeatures(validCycleFeatures) : null;

    const bpOff = this.bpCalibrationManager.getOffsets();
    const devBp = this.deviceCalibrationEngine.getBpOffset();

    if (validRR.length >= 2 && this.signalHistory.length >= 60) {
      const bpElite = this.bloodPressureProcessor.process(
        [...this.signalHistory],
        validRR,
        [...this.timestampHistory],
        sampleRate,
        this.deviceProfiles.get().userHeightM
      );
      this.lastBPConfidence = bpElite.confidenceLevel;
      this.lastBPFeatureQuality = bpElite.featureQuality;
      this.lastBpCycles = bpElite.cyclesValid;

      const trendFirst =
        bpElite.confidenceLevel === 'INSUFFICIENT' &&
        bpElite.featureQuality >= 22 &&
        bpElite.cyclesValid >= 2;
      this.lastBpTrendFirst = trendFirst;
      if (!trendFirst) {
        this.lastBpTrendLabel = 'STABLE';
      }

      if (bpElite.confidenceLevel !== 'INSUFFICIENT') {
        let sbp = bpElite.systolic + bpOff.systolic + devBp.systolic;
        let dbp = bpElite.diastolic + bpOff.diastolic + devBp.diastolic;
        sbp = Math.max(70, Math.min(200, sbp));
        dbp = Math.max(45, Math.min(120, dbp));
        this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, sbp, 'stable');
        this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, dbp, 'stable');
      }
    }

    const piGreen = this.rgbData.greenDC > 0 ? (this.rgbData.greenAC / this.rgbData.greenDC) * 100 : 0;
    const rgACRatio = this.rgbData.greenAC > 0 ? this.rgbData.redAC / this.rgbData.greenAC : 0;

    const base = this.userBaseline.get();

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
        longitudinalBaseline: base.glucoseEma > 0 ? base.glucoseEma : undefined,
        personalizationState: base.personalizationState,
      });
      this.lastGlucose = glucoseResult;
      if (glucoseResult.value > 0 && glucoseResult.enabledState !== 'WITHHELD_LOW_QUALITY') {
        this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucoseResult.value, 'dynamic');
        this.userBaseline.updateFromSession({ glucoseEma: this.measurements.glucose });
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
        longitudinalChol: base.cholesterolEma > 0 ? base.cholesterolEma : undefined,
        longitudinalTrig: base.triglyceridesEma > 0 ? base.triglyceridesEma : undefined,
        personalizationState: base.personalizationState,
      });
      this.lastLipids = lipidResult;
      if (lipidResult.totalCholesterol > 0 && lipidResult.enabledState !== 'WITHHELD_LOW_QUALITY') {
        this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol, lipidResult.totalCholesterol, 'dynamic');
        this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides, lipidResult.triglycerides, 'dynamic');
        this.userBaseline.updateFromSession({
          cholesterolEma: this.measurements.totalCholesterol,
          triglyceridesEma: this.measurements.triglycerides,
        });
      }
    }

    this.updateRhythmMeasurements(beatInputs, validRR);
  }

  /**
   * Ritmo siempre actualizado: ruta completa (>=8 beats) o fallback RR cuando hay menos entidades.
   */
  private updateRhythmMeasurements(beatInputs: BeatInputRow[] | undefined, validRR: number[]): void {
    if (validRR.length < 2) return;

    const beatN = beatInputs?.length ?? 0;
    const avgSQI = Math.max(this.upstreamContext.avgBeatSQI, 15);
    const stab = Math.max(this.upstreamContext.sourceStability, this.upstreamContext.detectorAgreement);

    let rhythmResult: RhythmResult;
    if (beatInputs && beatN >= 8) {
      rhythmResult = this.rhythmClassifier.classify(beatInputs, Math.max(avgSQI, 20), stab);
    } else {
      rhythmResult = this.rhythmClassifier.classifyFromRRIntervals(validRR, avgSQI, stab, beatN);
    }

    this.lastRhythm = rhythmResult;
    const ev = rhythmResult.recentEvents?.length ?? 0;
    this.measurements.arrhythmiaStatus = `${rhythmResult.rhythmLabel}|${ev}`;
    this.measurements.arrhythmiaCount = ev;
    this.measurements.lastArrhythmiaData = {
      timestamp: Date.now(),
      rmssd: rhythmResult.features.rmssd,
      rrVariation: rhythmResult.features.rrCV * 100,
    };
  }

  private getFormattedResult(): VitalSignsResult {
    const routed = UncertaintyRouter.route({
      spo2Detail: this.lastSpo2,
      glucoseDetail: this.lastGlucose,
      lipidsDetail: this.lastLipids,
      rhythm: this.lastRhythm,
      bpSystolic: this.measurements.systolicPressure,
      bpDiastolic: this.measurements.diastolicPressure,
      bpConfidence: this.lastBPConfidence,
      bpFeatureQuality: this.lastBPFeatureQuality,
      bpCycles: this.lastBpCycles,
      bpm: this.heartRuntime.bpm,
      bpmConfidence: this.heartRuntime.bpmConfidence,
      beatCount: this.heartRuntime.beatCount || this.upstreamContext.beatCount,
      signalQuality: this.measurements.signalQuality,
      bpTrendOnly: this.lastBpTrendFirst,
    });

    return {
      spo2: Math.round(this.measurements.spo2),
      glucose: Math.round(this.measurements.glucose),
      pressure: {
        systolic: Math.round(this.measurements.systolicPressure),
        diastolic: Math.round(this.measurements.diastolicPressure),
        confidence: this.lastBPConfidence,
        featureQuality: this.lastBPFeatureQuality,
        trendFirst: this.lastBpTrendFirst,
        trendLabel: this.lastBpTrendLabel,
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
      outputStates: routed,
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

  appendSessionSummary(): void {
    this.longitudinal.append({
      ts: Date.now(),
      signalQuality: this.measurements.signalQuality,
      rhythmLabel: this.lastRhythm?.rhythmLabel,
      spo2: this.measurements.spo2 || undefined,
      bp: this.measurements.systolicPressure > 0
        ? { sys: this.measurements.systolicPressure, dia: this.measurements.diastolicPressure }
        : undefined,
      glucose: this.measurements.glucose || undefined,
      lipids: this.measurements.totalCholesterol > 0
        ? { tc: this.measurements.totalCholesterol, tg: this.measurements.triglycerides }
        : undefined,
    });
  }

  getCalibrationProgress(): number {
    return Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100));
  }

  reset(): VitalSignsResult | null {
    const result = this.getFormattedResult();
    this.signalHistory = [];
    this.timestampHistory = [];
    this.validPulseCount = 0;
    this.spo2Processor.reset();
    this.glucoseProcessor.reset();
    this.lipidProcessor.reset();
    this.rhythmClassifier.reset();
    this.measurements.arrhythmiaCount = 0;
    this.measurements.arrhythmiaStatus = 'SINUS_STABLE|0';
    this.measurements.lastArrhythmiaData = null;
    this.appendSessionSummary();
    return result.spo2 !== 0 ? result : null;
  }

  hasValidPressureEstimate(): boolean {
    return this.measurements.systolicPressure > 0 && this.measurements.diastolicPressure > 0;
  }

  fullReset(): void {
    this.signalHistory = [];
    this.timestampHistory = [];
    this.validPulseCount = 0;
    this.measurements = {
      spo2: 0, glucose: 0, systolicPressure: 0, diastolicPressure: 0,
      arrhythmiaCount: 0, arrhythmiaStatus: 'SINUS_STABLE|0',
      totalCholesterol: 0, triglycerides: 0, lastArrhythmiaData: null, signalQuality: 0,
    };
    this.rgbData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
    this.isCalibrating = false;
    this.calibrationSamples = 0;
    this.bloodPressureProcessor.reset();
    this.spo2Processor.reset();
    const p = this.deviceProfiles.get();
    this.spo2Calibrator.setDeviceCurve(p.spo2Curve.A, p.spo2Curve.B, p.spo2Curve.C, p.deviceProfileId);
    this.spo2Calibrator.setOpticalBiasR(p.opticalBiasR);
    this.glucoseProcessor.fullReset();
    this.lipidProcessor.fullReset();
    this.rhythmClassifier.reset();
    this.lastRhythm = null;
    this.lastSpo2 = null;
    this.lastGlucose = null;
    this.lastLipids = null;
  }
}
