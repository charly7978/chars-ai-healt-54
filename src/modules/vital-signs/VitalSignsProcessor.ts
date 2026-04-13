import { ArrhythmiaProcessor } from './arrhythmia-processor';
import { PPGFeatureExtractor } from './PPGFeatureExtractor';
import { BloodPressureProcessor } from './BloodPressureProcessor';
import { RhythmClassifier, type RhythmResult, type RhythmLabel } from './RhythmClassifier';
import { SpO2Processor, type SpO2Result } from './SpO2Processor';
import { GlucoseResearchProcessor, type GlucoseResult } from '../biomarkers/GlucoseResearchProcessor';
import { LipidResearchProcessor, type LipidResult } from '../biomarkers/LipidResearchProcessor';
import { MeasurementGate, type OutputState } from '../core/MeasurementGate';

export interface VitalSignsResult {
  spo2: number;
  glucose: number;
  pressure: {
    systolic: number;
    diastolic: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    featureQuality: number;
  };
  arrhythmiaCount: number;
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
  // ── New V2 fields ──
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

/**
 * VITAL SIGNS PROCESSOR V2
 * 
 * Integrates:
 * - RhythmClassifier (multi-label rhythm analysis)
 * - SpO2Processor (calibrated pipeline)
 * - GlucoseResearchProcessor (research head with personalization)
 * - LipidResearchProcessor (research head)
 * - MeasurementGate (per-output confidence gating)
 * - BloodPressureProcessor (morphology-based BP)
 * 
 * No mocks, no hardcoded values, no simulation.
 */
export class VitalSignsProcessor {
  private arrhythmiaProcessor: ArrhythmiaProcessor;
  private bloodPressureProcessor: BloodPressureProcessor;
  private rhythmClassifier: RhythmClassifier;
  private spo2Processor: SpO2Processor;
  private glucoseProcessor: GlucoseResearchProcessor;
  private lipidProcessor: LipidResearchProcessor;

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
  private readonly HISTORY_SIZE = 90;
  private rgbData: RGBData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
  private validPulseCount = 0;
  private readonly MIN_PULSES_REQUIRED = 2;

  // Upstream context for gating
  private upstreamContext = {
    contactStable: false,
    pressureOptimal: false,
    clipHighRatio: 0,
    sourceStability: 0,
    avgBeatSQI: 0,
    beatCount: 0,
  };

  // Last detailed results
  private lastRhythm: RhythmResult | null = null;
  private lastSpo2: SpO2Result | null = null;
  private lastGlucose: GlucoseResult | null = null;
  private lastLipids: LipidResult | null = null;

  // EMA smoothing
  private readonly EMA_ALPHA_STABLE = 0.20;
  private readonly EMA_ALPHA_DYNAMIC = 0.30;

  constructor() {
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.bloodPressureProcessor = new BloodPressureProcessor();
    this.rhythmClassifier = new RhythmClassifier();
    this.spo2Processor = new SpO2Processor();
    this.glucoseProcessor = new GlucoseResearchProcessor();
    this.lipidProcessor = new LipidResearchProcessor();
  }

  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    this.validPulseCount = 0;
    this.measurements = {
      spo2: 0, glucose: 0, systolicPressure: 0, diastolicPressure: 0,
      arrhythmiaCount: 0, arrhythmiaStatus: "CALIBRANDO...",
      totalCholesterol: 0, triglycerides: 0, lastArrhythmiaData: null, signalQuality: 0,
    };
    this.signalHistory = [];
  }

  forceCalibrationCompletion(): void {
    this.isCalibrating = false;
    this.calibrationSamples = this.CALIBRATION_REQUIRED;
  }

  setRGBData(data: RGBData): void { this.rgbData = data; }

  /**
   * Set upstream context from signal processor for gating decisions
   */
  setUpstreamContext(ctx: {
    contactStable?: boolean;
    pressureOptimal?: boolean;
    clipHighRatio?: number;
    sourceStability?: number;
    avgBeatSQI?: number;
    beatCount?: number;
  }): void {
    if (ctx.contactStable !== undefined) this.upstreamContext.contactStable = ctx.contactStable;
    if (ctx.pressureOptimal !== undefined) this.upstreamContext.pressureOptimal = ctx.pressureOptimal;
    if (ctx.clipHighRatio !== undefined) this.upstreamContext.clipHighRatio = ctx.clipHighRatio;
    if (ctx.sourceStability !== undefined) this.upstreamContext.sourceStability = ctx.sourceStability;
    if (ctx.avgBeatSQI !== undefined) this.upstreamContext.avgBeatSQI = ctx.avgBeatSQI;
    if (ctx.beatCount !== undefined) this.upstreamContext.beatCount = ctx.beatCount;
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
    if (validIntervals.length < 2) { this.validPulseCount = 0; return false; }
    if (rrData.lastPeakTime) {
      const timeSince = Date.now() - rrData.lastPeakTime;
      if (timeSince > 4000) { this.validPulseCount = 0; return false; }
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
    if (sq >= 55 && this.validPulseCount >= 4) return 'HIGH';
    if (sq >= 30 && this.validPulseCount >= 3) return 'MEDIUM';
    if (sq >= 12 && this.validPulseCount >= 2) return 'LOW';
    return 'INVALID';
  }

  private calculateVitalSigns(
    signalValue: number,
    rrData: { intervals: number[], lastPeakTime: number | null },
    beatInputs?: Array<any>
  ): void {
    if (this.measurements.signalQuality < 10) return;

    const validRR = rrData.intervals.filter(i => i >= 270 && i <= 2200);
    const avgRR = validRR.length > 0 ? validRR.reduce((a, b) => a + b, 0) / validRR.length : 0;
    const hr = avgRR > 0 ? 60000 / avgRR : 0;
    const rrVar = PPGFeatureExtractor.extractRRVariability(validRR);

    // ── SpO2 via calibrated processor ──
    const spo2Result = this.spo2Processor.process({
      redAC: this.rgbData.redAC, redDC: this.rgbData.redDC,
      greenAC: this.rgbData.greenAC, greenDC: this.rgbData.greenDC,
      contactStable: this.upstreamContext.contactStable,
      pressureOptimal: this.upstreamContext.pressureOptimal,
      clipHighRatio: this.upstreamContext.clipHighRatio,
      beatCount: this.upstreamContext.beatCount,
      avgBeatSQI: this.upstreamContext.avgBeatSQI,
      sourceStability: this.upstreamContext.sourceStability,
    });
    this.lastSpo2 = spo2Result;
    if (spo2Result.value > 0 && spo2Result.enabledState !== 'WITHHELD_LOW_QUALITY') {
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2Result.value, 'stable');
    }

    // ── Cycle features for downstream ──
    const cycles = PPGFeatureExtractor.detectCardiacCycles(this.signalHistory, 30);
    const validCycleFeatures: import('./PPGFeatureExtractor').CycleFeatures[] = [];
    for (const cycle of cycles) {
      const features = PPGFeatureExtractor.extractCycleFeatures(this.signalHistory, cycle, 30);
      if (features && features.quality >= 0.25) validCycleFeatures.push(features);
    }

    const medianF = validCycleFeatures.length >= 1 ? this.medianCycleFeatures(validCycleFeatures) : null;

    // ── BP ──
    if (validRR.length >= 2) {
      const bpEstimate = this.bloodPressureProcessor.estimate(this.signalHistory, validRR, 30);
      this.lastBPConfidence = bpEstimate.confidence;
      this.lastBPFeatureQuality = bpEstimate.featureQuality;
      if (bpEstimate.systolic > 0 && bpEstimate.confidence !== 'INSUFFICIENT') {
        this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, bpEstimate.systolic, 'stable');
        this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, bpEstimate.diastolic, 'stable');
      }
    }

    // ── Glucose via research processor ──
    const piGreen = this.rgbData.greenDC > 0 ? (this.rgbData.greenAC / this.rgbData.greenDC) * 100 : 0;
    const rgACRatio = this.rgbData.greenAC > 0 ? this.rgbData.redAC / this.rgbData.greenAC : 0;

    if (medianF && hr >= 35 && hr <= 200 && this.measurements.signalQuality >= 12) {
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
        beatCount: this.upstreamContext.beatCount,
      });
      this.lastGlucose = glucoseResult;
      if (glucoseResult.value > 0 && glucoseResult.enabledState !== 'WITHHELD_LOW_QUALITY') {
        this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucoseResult.value, 'dynamic');
      }

      // ── Lipids via research processor ──
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
    }

    // ── Rhythm classifier ──
    if (beatInputs && beatInputs.length >= 5) {
      const rhythmResult = this.rhythmClassifier.classify(
        beatInputs, this.upstreamContext.avgBeatSQI, this.upstreamContext.sourceStability
      );
      this.lastRhythm = rhythmResult;
    }

    // ── Legacy arrhythmia (kept for backward compat) ──
    const arrhythmiaRR = validRR.slice(-10);
    const arrhythmiaInput = (arrhythmiaRR.length >= 5 && this.measurements.signalQuality >= 25 && hr >= 35 && hr <= 180)
      ? { ...rrData, intervals: arrhythmiaRR } : undefined;
    const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(arrhythmiaInput);
    this.measurements.arrhythmiaStatus = arrhythmiaResult.arrhythmiaStatus;
    this.measurements.lastArrhythmiaData = arrhythmiaResult.lastArrhythmiaData;
    const parts = arrhythmiaResult.arrhythmiaStatus.split('|');
    this.measurements.arrhythmiaCount = parts.length > 1 ? (parseInt(parts[1]) || 0) : 0;
  }

  private getFormattedResult(): VitalSignsResult {
    // Build output states
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
      // V2 fields
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
        rhythm: this.lastRhythm ? (this.lastRhythm.rhythmQuality > 50 ? 'ENABLED_MEDIUM_CONFIDENCE' : 'ENABLED_LOW_CONFIDENCE') : 'WITHHELD_LOW_QUALITY',
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
    this.arrhythmiaProcessor.reset();
    this.spo2Processor.reset();
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
    this.arrhythmiaProcessor.reset();
    this.bloodPressureProcessor.fullReset();
    this.spo2Processor.fullReset();
    this.glucoseProcessor.fullReset();
    this.lipidProcessor.fullReset();
    this.rhythmClassifier.reset();
    this.lastRhythm = null;
    this.lastSpo2 = null;
    this.lastGlucose = null;
    this.lastLipids = null;
  }
}
