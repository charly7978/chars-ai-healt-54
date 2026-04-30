/**
 * SpO2 PROCESSOR — calibración real vía SpO2Calibrator + ratios ópticos.
 */

import { SpO2Calibrator } from './SpO2Calibrator';
import { ratioOfRatios, trimmedMedian } from './OpticalRatioEngine';
import { median } from '@/utils/mathUtils';

export interface SpO2Result {
  value: number;
  confidence: number;
  quality: number;
  calibrationState: 'UNCALIBRATED' | 'SESSION_CALIBRATED' | 'DEVICE_CALIBRATED';
  enabledState: 'ENABLED_HIGH_CONFIDENCE' | 'ENABLED_MEDIUM_CONFIDENCE' | 'ENABLED_LOW_CONFIDENCE' | 'WITHHELD_LOW_QUALITY';
  rawR: number;
  medianR: number;
  piRed: number;
  piGreen: number;
  validBeatRatios: number;
}

export class SpO2Processor {
  private rBuffer: number[] = [];
  private readonly R_BUF_SIZE = 12;
  private beatRatios: number[] = [];
  private readonly BEAT_RATIO_BUF = 8;
  private sessionRatioHistory: number[] = [];
  private readonly SESSION_HISTORY_SIZE = 60;
  private sessionCalibrated = false;

  private consecutiveValidFrames = 0;
  private lastValue = 0;

  constructor(private readonly calibrator: SpO2Calibrator = new SpO2Calibrator()) {}

  private resolveCalibrationState(): SpO2Result['calibrationState'] {
    const c = this.calibrator.getCurve();
    if (c.deviceId !== 'default') return 'DEVICE_CALIBRATED';
    if (this.sessionCalibrated) return 'SESSION_CALIBRATED';
    return 'UNCALIBRATED';
  }

  process(input: {
    redAC: number;
    redDC: number;
    greenAC: number;
    greenDC: number;
    contactStable: boolean;
    pressureOptimal: boolean;
    clipHighRatio: number;
    beatCount: number;
    avgBeatSQI: number;
    sourceStability: number;
  }): SpO2Result {
    const calState = this.resolveCalibrationState();
    const withheld: SpO2Result = {
      value: 0, confidence: 0, quality: 0,
      calibrationState: calState,
      enabledState: 'WITHHELD_LOW_QUALITY',
      rawR: 0, medianR: 0, piRed: 0, piGreen: 0, validBeatRatios: 0,
    };

    const { redAC, redDC, greenAC, greenDC } = input;

    if (redDC < 5 || greenDC < 5) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }
    if (redAC < 0.02 || greenAC < 0.02) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }

    const piRed = (redAC / redDC) * 100;
    const piGreen = (greenAC / greenDC) * 100;

    if (piRed < 0.02 || piGreen < 0.02) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }

    const R = ratioOfRatios(redAC, redDC, greenAC, greenDC);
    if (!isFinite(R) || R <= 0.08 || R > 4.0) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }

    this.rBuffer.push(R);
    if (this.rBuffer.length > this.R_BUF_SIZE) this.rBuffer.shift();

    if (this.rBuffer.length < 3) {
      return { ...withheld, rawR: R, piRed, piGreen, calibrationState: calState };
    }

    let medianR = median(this.rBuffer);

    if (this.beatRatios.length >= 3) {
      const br = trimmedMedian(this.beatRatios, 0.12);
      if (isFinite(br)) medianR = medianR * 0.65 + br * 0.35;
    }

    this.sessionRatioHistory.push(medianR);
    if (this.sessionRatioHistory.length > this.SESSION_HISTORY_SIZE) this.sessionRatioHistory.shift();

    let quality = 0;
    if (input.contactStable) quality += 20;
    if (input.pressureOptimal) quality += 10;
    quality += Math.min(15, piGreen * 5);

    if (this.rBuffer.length >= 4) {
      const rMean = this.rBuffer.reduce((a, b) => a + b, 0) / this.rBuffer.length;
      const rStd = Math.sqrt(this.rBuffer.reduce((s, v) => s + (v - rMean) ** 2, 0) / this.rBuffer.length);
      const rCV = rStd / Math.max(0.01, rMean);
      quality += Math.max(0, Math.min(20, (1 - rCV * 5) * 20));
    }

    quality -= input.clipHighRatio * 28;
    quality += Math.min(15, input.beatCount * 1.5);
    quality += input.sourceStability * 10;
    quality += Math.min(10, input.avgBeatSQI * 0.1);
    quality = Math.max(0, Math.min(100, Math.round(quality)));

    const spo2Raw = this.calibrator.estimateSpO2(medianR);

    if (!isFinite(spo2Raw) || spo2Raw < 50 || spo2Raw > 105) {
      return { ...withheld, rawR: R, medianR, piRed, piGreen, quality, calibrationState: calState };
    }

    if (!input.contactStable) {
      return {
        value: 0, confidence: 0, quality,
        calibrationState: calState,
        enabledState: 'WITHHELD_LOW_QUALITY',
        rawR: R, medianR, piRed, piGreen, validBeatRatios: this.beatRatios.length,
      };
    }

    this.consecutiveValidFrames++;

    const strongContext =
      input.contactStable && input.pressureOptimal && input.beatCount >= 4 && input.avgBeatSQI >= 30;
    const minFrames = strongContext ? 2 : 4;
    const qTh = strongContext ? 15 : 18;

    if (this.consecutiveValidFrames < minFrames || quality < qTh) {
      return {
        value: 0, confidence: 0, quality,
        calibrationState: calState,
        enabledState: 'WITHHELD_LOW_QUALITY',
        rawR: R, medianR, piRed, piGreen, validBeatRatios: this.beatRatios.length,
      };
    }

    let confidence = 0;
    confidence += quality / 100 * 0.42;
    confidence += Math.min(0.2, this.consecutiveValidFrames * 0.01);
    confidence += calState !== 'UNCALIBRATED' ? 0.14 : 0;
    confidence += this.rBuffer.length >= 6 ? 0.1 : 0;
    confidence += input.sourceStability * 0.11;
    confidence += input.avgBeatSQI > 40 ? 0.06 : 0;
    confidence += this.beatRatios.length >= 4 ? 0.07 : 0;
    confidence = Math.min(1, Math.max(0, confidence));

    let value = Math.round(spo2Raw);
    if (this.lastValue > 0) {
      const alpha = confidence > 0.6 ? 0.26 : 0.16;
      value = Math.round(this.lastValue * (1 - alpha) + spo2Raw * alpha);
    }
    this.lastValue = value;

    let enabledState: SpO2Result['enabledState'];
    if (confidence >= 0.55 && quality >= 45) enabledState = 'ENABLED_HIGH_CONFIDENCE';
    else if (confidence >= 0.30 && quality >= 25) enabledState = 'ENABLED_MEDIUM_CONFIDENCE';
    else if (confidence >= 0.12) enabledState = 'ENABLED_LOW_CONFIDENCE';
    else enabledState = 'WITHHELD_LOW_QUALITY';

    return {
      value,
      confidence,
      quality,
      calibrationState: calState,
      enabledState,
      rawR: R,
      medianR,
      piRed,
      piGreen,
      validBeatRatios: this.beatRatios.length,
    };
  }

  addBeatRatio(R: number): void {
    if (!isFinite(R) || R <= 0.1 || R > 3.0) return;
    this.beatRatios.push(R);
    if (this.beatRatios.length > this.BEAT_RATIO_BUF) this.beatRatios.shift();
  }

  setCalibration(A: number, B: number, C: number, deviceId: string): void {
    this.calibrator.setDeviceCurve(A, B, C, deviceId);
    this.sessionCalibrated = false;
  }

  calibrateWithReference(knownSpO2: number): void {
    if (this.sessionRatioHistory.length < 5) return;
    const medR = this.median(this.sessionRatioHistory.slice(-10));
    this.calibrator.applySessionOffsetFromReference(knownSpO2, medR);
    this.sessionCalibrated = true;
  }

  getCalibrator(): SpO2Calibrator {
    return this.calibrator;
  }

  private median(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  reset(): void {
    this.rBuffer = [];
    this.beatRatios = [];
    this.consecutiveValidFrames = 0;
    this.lastValue = 0;
    this.sessionRatioHistory = [];
  }

  fullReset(): void {
    this.reset();
    this.sessionCalibrated = false;
    this.calibrator.setDeviceCurve(104.0, 4.2, -28.5, 'default');
  }
}
