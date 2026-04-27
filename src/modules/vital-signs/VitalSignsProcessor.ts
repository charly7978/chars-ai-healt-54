import { PPGFeatureExtractor } from './PPGFeatureExtractor';
import { BloodPressureProcessor } from './BloodPressureProcessor';
import { RhythmClassifier, type RhythmResult, type RhythmLabel } from './RhythmClassifier';
import { SpO2Processor, type SpO2Result } from './SpO2Processor';
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

export interface EvidenceContext {
  livePpgPassed: boolean;
  livePpgScore: number;
  evidenceTier: "INVALID" | "WEAK" | "PROBABLE_PPG" | "VALID_LIVE_PPG";
  bpm: number;
  bpmConfidence: number;
  acceptedBeats: number;
  rrIntervals: number[];
  signalQuality: number;
  perfusionIndex: number;
  spectralDominance: number;
  temporalSpectralAgreement: number;
  sourceStability: number;
  negativeControlScore: number;
  rejectionReasons: string[];
}

export class VitalSignsProcessor {
  private bloodPressureProcessor: BloodPressureProcessor;
  private rhythmClassifier: RhythmClassifier;
  private spo2Processor: SpO2Processor;
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
  private readonly HISTORY_SIZE = 90;
  private rgbData: RGBData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
  private validPulseCount = 0;

  private upstreamContext = {
    contactStable: false,
    pressureOptimal: false,
    clipHighRatio: 0,
    clipLowRatio: 0,
    sourceStability: 0,
    avgBeatSQI: 0,
    beatCount: 0,
    sampleRate: 30,
    detectorAgreement: 0,
    rrStability: 0,
  };
  
  private evidenceContext: EvidenceContext = {
    livePpgPassed: false,
    livePpgScore: 0,
    evidenceTier: "INVALID",
    bpm: 0,
    bpmConfidence: 0,
    acceptedBeats: 0,
    rrIntervals: [],
    signalQuality: 0,
    perfusionIndex: 0,
    spectralDominance: 0,
    temporalSpectralAgreement: 0,
    sourceStability: 0,
    negativeControlScore: 0,
    rejectionReasons: [],
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
    this.spo2Processor = new SpO2Processor(this.spo2Calibrator);
    this.deviceCalibrationEngine = new DeviceCalibrationEngine(this.deviceProfiles, profile);
    this.bpCalibrationManager = new BPCalibrationManager();
    this.userBaseline = new UserBaselineEngine();
    this.longitudinal = new LongitudinalDatasetStore();

    this.bloodPressureProcessor = new BloodPressureProcessor();
    this.rhythmClassifier = new RhythmClassifier();
    this.glucoseProcessor = new GlucoseResearchProcessor();
    this.lipidProcessor = new LipidResearchProcessor();
  }

  setHeartRuntime(ctx: { bpm?: number; bpmConfidence?: number; beatCount?: number }): void {
    if (ctx.bpm !== undefined) this.heartRuntime.bpm = ctx.bpm;
    if (ctx.bpmConfidence !== undefined) this.heartRuntime.bpmConfidence = ctx.bpmConfidence;
    if (ctx.beatCount !== undefined) this.heartRuntime.beatCount = ctx.beatCount;
  }
  
  setEvidenceContext(ctx: EvidenceContext): void {
    this.evidenceContext = ctx;
  }

  /** En ventana de pico cardíaco: refuerza SpO2 con ratio alineado a latido */
  ingestBeatOpticalRatio(): void {
    const R = ratioOfRatios(
      this.rgbData.redAC, this.rgbData.redDC,
      this.rgbData.greenAC, this.rgbData.greenDC
    );
    if (isFinite(R)) this.spo2Processor.addBeatRatio(R);
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
  }

  setRGBData(data: RGBData): void { this.rgbData = data; }

  setUpstreamContext(ctx: {
    contactStable?: boolean;
    pressureOptimal?: boolean;
    clipHighRatio?: number;
    clipLowRatio?: number;
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
    if (ctx.clipLowRatio !== undefined) this.upstreamContext.clipLowRatio = ctx.clipLowRatio;
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
    
    // FAIL-CLOSED: Si no hay evidencia PPG viva, devolver INVALID inmediatamente
    if (!this.evidenceContext.livePpgPassed) {
      return this.getInvalidResult();
    }
    
    const hasRealPulse = this.validateRealPulse(rrData);
    if (!hasRealPulse) return this.getInvalidResult();

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

    const spo2Result = this.spo2Processor.process({
      redAC: this.rgbData.redAC, redDC: this.rgbData.redDC,
      greenAC: this.rgbData.greenAC, greenDC: this.rgbData.greenDC,
      contactStable: this.upstreamContext.contactStable,
      pressureOptimal: this.upstreamContext.pressureOptimal,
      clipHighRatio: this.upstreamContext.clipHighRatio,
      beatCount: Math.max(this.upstreamContext.beatCount, beatInputs?.length || 0),
      avgBeatSQI: this.upstreamContext.avgBeatSQI,
      sourceStability: this.upstreamContext.sourceStability,
    });
    this.lastSpo2 = spo2Result;

    if (spo2Result.medianR > 0) {
      this.deviceCalibrationEngine.ingestFrameStats({
        medianR: spo2Result.medianR,
        rVariance: Math.max(0, 1 - (spo2Result.quality / 100)) * 0.05,
        clipHighEma: this.upstreamContext.clipHighRatio,
        frameIntervalMs: 1000 / sampleRate,
        sourceLabel: 'RG',
      });
      this.spo2Calibrator.setOpticalBiasR(this.deviceCalibrationEngine.getOpticalBiasR());
    }

    // FAIL-CLOSED: SpO₂ solo si hay evidencia PPG viva y condiciones óptimas
    if (spo2Result.value > 0 && spo2Result.enabledState !== 'WITHHELD_LOW_QUALITY') {
      // Verificaciones adicionales para SpO₂
      const redACDC = this.rgbData.redDC > 0 ? this.rgbData.redAC / this.rgbData.redDC : 0;
      const greenACDC = this.rgbData.greenDC > 0 ? this.rgbData.greenAC / this.rgbData.greenDC : 0;
      const ratioStable = redACDC > 0.01 && greenACDC > 0.01;
      const clippingAcceptable = this.upstreamContext.clipHighRatio < 0.08 && this.upstreamContext.clipLowRatio < 0.08;
      const piSufficient = this.evidenceContext.perfusionIndex >= 0.35;
      
      if (ratioStable && clippingAcceptable && piSufficient && this.evidenceContext.livePpgPassed) {
        this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2Result.value, 'stable');
      } else {
        this.measurements.spo2 = 0;
      }
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

    if (validRR.length >= 2) {
      const bpEstimate = this.bloodPressureProcessor.estimate(this.signalHistory, validRR, sampleRate, {
        systolicOffset: bpOff.systolic + devBp.systolic,
        diastolicOffset: bpOff.diastolic + devBp.diastolic,
        // Reusar los ciclos ya detectados arriba (evita recomputarlos
        // dentro de BloodPressureProcessor).
        precomputedCycles: cycles,
      });
      this.lastBPConfidence = bpEstimate.confidence;
      this.lastBPFeatureQuality = bpEstimate.featureQuality;
      this.lastBpCycles = bpEstimate.cyclesUsed;
      this.lastBpTrendFirst = !!bpEstimate.trendFirst;
      this.lastBpTrendLabel = bpEstimate.trendLabel;

      // FAIL-CLOSED: Presión arterial solo si hay calibración individual del usuario
    // NO inventar 120/80, NO estimar desde BPM solamente
    if (bpEstimate.systolic > 0 && bpEstimate.confidence !== 'INSUFFICIENT') {
      const hasCalibration = this.bpCalibrationManager.getRecord() !== null;
      if (hasCalibration && this.evidenceContext.livePpgPassed) {
        this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, bpEstimate.systolic, 'stable');
        this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, bpEstimate.diastolic, 'stable');
      } else {
        this.measurements.systolicPressure = 0;
        this.measurements.diastolicPressure = 0;
        this.lastBPConfidence = 'INSUFFICIENT';
      }
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
      // FAIL-CLOSED: Glucosa solo si hay modelo calibrado con datos reales del usuario
      if (glucoseResult.value > 0 && glucoseResult.enabledState !== 'WITHHELD_LOW_QUALITY') {
        const hasCalibration = base.personalizationState === 'CALIBRATED' as any && base.glucoseEma > 0;
        if (hasCalibration && this.evidenceContext.livePpgPassed) {
          this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucoseResult.value, 'dynamic');
          this.userBaseline.updateFromSession({ glucoseEma: this.measurements.glucose });
        } else {
          this.measurements.glucose = 0;
        }
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
      // FAIL-CLOSED: Lípidos solo si hay dataset de calibración real del usuario
      if (lipidResult.totalCholesterol > 0 && lipidResult.enabledState !== 'WITHHELD_LOW_QUALITY') {
        const hasCalibration = base.personalizationState === 'CALIBRATED' as any && 
                           (base.cholesterolEma > 0 || base.triglyceridesEma > 0);
        if (hasCalibration && this.evidenceContext.livePpgPassed) {
          this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol, lipidResult.totalCholesterol, 'dynamic');
          this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides, lipidResult.triglycerides, 'dynamic');
          this.userBaseline.updateFromSession({
            cholesterolEma: this.measurements.totalCholesterol,
            triglyceridesEma: this.measurements.triglycerides,
          });
        } else {
          this.measurements.totalCholesterol = 0;
          this.measurements.triglycerides = 0;
        }
      }
    }

    // FAIL-CLOSED: Arritmia solo si hay RR intervals reales y evidencia PPG viva
    if (beatInputs && beatInputs.length >= 8 && this.evidenceContext.livePpgPassed) {
      const rhythmResult = this.rhythmClassifier.classify(
        beatInputs,
        Math.max(this.upstreamContext.avgBeatSQI, 20),
        Math.max(this.upstreamContext.sourceStability, this.upstreamContext.detectorAgreement)
      );
      this.lastRhythm = rhythmResult;

      const ev = rhythmResult.recentEvents?.length ?? 0;
      this.measurements.arrhythmiaStatus = `${rhythmResult.rhythmLabel}|${ev}`;
      this.measurements.arrhythmiaCount = ev;
      this.measurements.lastArrhythmiaData = {
        timestamp: Date.now(),
        rmssd: rhythmResult.features.rmssd,
        rrVariation: rhythmResult.features.rrCV * 100,
      };
    } else {
      // FAIL-CLOSED: Sin beats reales, arrhythmiaStatus = NO_VALID_PPG
      this.measurements.arrhythmiaStatus = "NO_VALID_PPG|0";
      this.measurements.arrhythmiaCount = 0;
    }
  }

  private getInvalidResult(): VitalSignsResult {
    return {
      spo2: 0,
      glucose: 0,
      pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT', featureQuality: 0 },
      arrhythmiaCount: 0,
      arrhythmiaStatus: "NO_VALID_PPG|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100)),
      lastArrhythmiaData: undefined,
      signalQuality: 0,
      measurementConfidence: 'INVALID'
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
    // FAIL-CLOSED: reset() SIEMPRE devuelve null, nunca valores antiguos
    this.signalHistory = [];
    this.validPulseCount = 0;
    this.spo2Processor.reset();
    this.glucoseProcessor.reset();
    this.lipidProcessor.reset();
    this.rhythmClassifier.reset();
    this.measurements.arrhythmiaCount = 0;
    this.measurements.arrhythmiaStatus = 'NO_VALID_PPG|0';
    this.measurements.lastArrhythmiaData = null;
    this.appendSessionSummary();
    return null;
  }

  hasValidPressureEstimate(): boolean {
    return this.measurements.systolicPressure > 0 && this.measurements.diastolicPressure > 0;
  }

  fullReset(): void {
    this.signalHistory = [];
    this.validPulseCount = 0;
    this.measurements = {
      spo2: 0, glucose: 0, systolicPressure: 0, diastolicPressure: 0,
      arrhythmiaCount: 0, arrhythmiaStatus: 'SINUS_STABLE|0',
      totalCholesterol: 0, triglycerides: 0, lastArrhythmiaData: null, signalQuality: 0,
    };
    this.rgbData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
    this.isCalibrating = false;
    this.calibrationSamples = 0;
    this.bloodPressureProcessor.fullReset();
    this.spo2Processor.fullReset();
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
