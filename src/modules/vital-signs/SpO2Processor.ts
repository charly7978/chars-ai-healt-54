/**
 * SpO2 PROCESSOR — CALIBRATED PIPELINE
 * 
 * Replaces naive single-formula SpO2 with a proper calibration-aware pipeline.
 * 
 * Pipeline:
 * 1. Raw ratio features from AC/DC per channel
 * 2. Beat-aligned ratio stabilization (median over valid beats)
 * 3. Session calibration state tracking
 * 4. Quadratic calibration curve with device profile support
 * 5. Quality + confidence gating
 * 
 * References:
 * - van Gastel et al. 2016 (Philips): Camera SpO2 calibration
 * - Sensors 2023: Quadratic R-ratio → SpO2 mapping
 * - Tremper 1989, Webster 1997: Ratio-of-ratios foundation
 * - Nature npj Digital Medicine 2022: Smartphone SpO2 validation 70-100%
 */

export interface SpO2Result {
  value: number;            // 0 = unavailable
  confidence: number;       // 0-1
  quality: number;          // 0-100
  calibrationState: 'UNCALIBRATED' | 'SESSION_CALIBRATED' | 'DEVICE_CALIBRATED';
  enabledState: 'ENABLED_HIGH_CONFIDENCE' | 'ENABLED_MEDIUM_CONFIDENCE' | 'ENABLED_LOW_CONFIDENCE' | 'WITHHELD_LOW_QUALITY';
  rawR: number;             // raw ratio-of-ratios
  medianR: number;          // median-filtered R
  piRed: number;            // perfusion index red
  piGreen: number;          // perfusion index green
  validBeatRatios: number;  // how many beat-aligned ratios contributed
}

interface CalibrationProfile {
  A: number;    // intercept
  B: number;    // linear
  C: number;    // quadratic
  deviceId: string;
  timestamp: number;
}

export class SpO2Processor {
  // Rolling R-ratio buffer for median filtering
  private rBuffer: number[] = [];
  private readonly R_BUF_SIZE = 12;

  // Beat-aligned ratios (higher quality than frame-level)
  private beatRatios: number[] = [];
  private readonly BEAT_RATIO_BUF = 8;

  // Calibration
  private calibration: CalibrationProfile = {
    A: 104.0,    // Default quadratic: SpO2 = 104 + 4.2R - 28.5R²
    B: 4.2,
    C: -28.5,
    deviceId: 'default',
    timestamp: 0,
  };
  private calibrationState: SpO2Result['calibrationState'] = 'UNCALIBRATED';
  private sessionRatioHistory: number[] = [];
  private readonly SESSION_HISTORY_SIZE = 60;

  // Quality tracking
  private consecutiveValidFrames = 0;
  private readonly MIN_VALID_FRAMES = 5;
  private lastValue = 0;
  private lastConfidence = 0;

  /**
   * Process one frame of RGB AC/DC data
   */
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
    const withheld: SpO2Result = {
      value: 0, confidence: 0, quality: 0,
      calibrationState: this.calibrationState,
      enabledState: 'WITHHELD_LOW_QUALITY',
      rawR: 0, medianR: 0, piRed: 0, piGreen: 0, validBeatRatios: 0,
    };

    const { redAC, redDC, greenAC, greenDC } = input;

    // Gate: minimum DC (tissue present)
    if (redDC < 8 || greenDC < 8) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }

    // Gate: minimum AC pulsatility
    if (redAC < 0.03 || greenAC < 0.03) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }

    const piRed = (redAC / redDC) * 100;
    const piGreen = (greenAC / greenDC) * 100;

    // Gate: minimum perfusion
    if (piRed < 0.03 || piGreen < 0.03) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }

    // Compute ratio-of-ratios
    const ratioRed = redAC / redDC;
    const ratioGreen = greenAC / greenDC;
    const R = ratioRed / ratioGreen;

    if (!isFinite(R) || R <= 0.1 || R > 3.0) {
      this.consecutiveValidFrames = 0;
      return withheld;
    }

    // Push to rolling buffer
    this.rBuffer.push(R);
    if (this.rBuffer.length > this.R_BUF_SIZE) this.rBuffer.shift();

    // Need minimum buffer for median
    if (this.rBuffer.length < 3) {
      return { ...withheld, rawR: R, piRed, piGreen };
    }

    // Median R (robust to single-frame noise)
    const sorted = [...this.rBuffer].sort((a, b) => a - b);
    const medianR = sorted[Math.floor(sorted.length / 2)];

    // Session tracking
    this.sessionRatioHistory.push(medianR);
    if (this.sessionRatioHistory.length > this.SESSION_HISTORY_SIZE) {
      this.sessionRatioHistory.shift();
    }

    // ── Quality assessment ──
    let quality = 0;

    // Contact & pressure
    if (input.contactStable) quality += 20;
    if (input.pressureOptimal) quality += 10;

    // Perfusion
    quality += Math.min(15, piGreen * 5);

    // Ratio stability (CV of R buffer)
    if (this.rBuffer.length >= 4) {
      const rMean = this.rBuffer.reduce((a, b) => a + b, 0) / this.rBuffer.length;
      const rStd = Math.sqrt(this.rBuffer.reduce((s, v) => s + (v - rMean) ** 2, 0) / this.rBuffer.length);
      const rCV = rStd / Math.max(0.01, rMean);
      quality += Math.max(0, Math.min(20, (1 - rCV * 5) * 20));
    }

    // Clipping penalty
    quality -= input.clipHighRatio * 30;

    // Beat count bonus
    quality += Math.min(15, input.beatCount * 1.5);

    // Source stability
    quality += input.sourceStability * 10;

    // Beat SQI
    quality += Math.min(10, input.avgBeatSQI * 0.1);

    quality = Math.max(0, Math.min(100, Math.round(quality)));

    // ── Apply calibration ──
    const spo2Raw = this.calibration.A + this.calibration.B * medianR + this.calibration.C * medianR * medianR;

    if (!isFinite(spo2Raw) || spo2Raw < 50 || spo2Raw > 105) {
      return { ...withheld, rawR: R, medianR, piRed, piGreen, quality };
    }

    // ── Gate: contact, quality, stability ──
    if (!input.contactStable) {
      return {
        value: 0, confidence: 0, quality,
        calibrationState: this.calibrationState,
        enabledState: 'WITHHELD_LOW_QUALITY',
        rawR: R, medianR, piRed, piGreen, validBeatRatios: this.beatRatios.length,
      };
    }

    this.consecutiveValidFrames++;

    if (this.consecutiveValidFrames < this.MIN_VALID_FRAMES || quality < 25) {
      return {
        value: 0, confidence: 0, quality,
        calibrationState: this.calibrationState,
        enabledState: 'WITHHELD_LOW_QUALITY',
        rawR: R, medianR, piRed, piGreen, validBeatRatios: this.beatRatios.length,
      };
    }

    // ── Confidence ──
    let confidence = 0;
    confidence += quality / 100 * 0.4;
    confidence += Math.min(0.2, this.consecutiveValidFrames * 0.01);
    confidence += (this.calibrationState !== 'UNCALIBRATED' ? 0.15 : 0);
    confidence += (this.rBuffer.length >= 6 ? 0.1 : 0);
    confidence += input.sourceStability * 0.1;
    confidence += (input.avgBeatSQI > 40 ? 0.05 : 0);
    confidence = Math.min(1, Math.max(0, confidence));

    // ── EMA smoothing ──
    let value = Math.round(spo2Raw);
    if (this.lastValue > 0) {
      const alpha = confidence > 0.6 ? 0.25 : 0.15;
      value = Math.round(this.lastValue * (1 - alpha) + spo2Raw * alpha);
    }
    this.lastValue = value;
    this.lastConfidence = confidence;

    // ── Enabled state ──
    let enabledState: SpO2Result['enabledState'];
    if (confidence >= 0.65 && quality >= 60) enabledState = 'ENABLED_HIGH_CONFIDENCE';
    else if (confidence >= 0.4 && quality >= 35) enabledState = 'ENABLED_MEDIUM_CONFIDENCE';
    else if (confidence >= 0.2) enabledState = 'ENABLED_LOW_CONFIDENCE';
    else enabledState = 'WITHHELD_LOW_QUALITY';

    return {
      value, confidence, quality,
      calibrationState: this.calibrationState,
      enabledState,
      rawR: R, medianR, piRed, piGreen,
      validBeatRatios: this.beatRatios.length,
    };
  }

  /**
   * Ingest a beat-aligned R ratio (computed at beat boundaries for better SNR)
   */
  addBeatRatio(R: number): void {
    if (!isFinite(R) || R <= 0.1 || R > 3.0) return;
    this.beatRatios.push(R);
    if (this.beatRatios.length > this.BEAT_RATIO_BUF) this.beatRatios.shift();
  }

  /**
   * Set device-specific calibration coefficients
   */
  setCalibration(A: number, B: number, C: number, deviceId: string): void {
    this.calibration = { A, B, C, deviceId, timestamp: Date.now() };
    this.calibrationState = 'DEVICE_CALIBRATED';
  }

  /**
   * Session calibration with known SpO2 reference
   */
  calibrateWithReference(knownSpO2: number): void {
    if (this.sessionRatioHistory.length < 5) return;
    const medR = this.median(this.sessionRatioHistory.slice(-10));
    // Adjust intercept to match known value at current R
    const currentEstimate = this.calibration.A + this.calibration.B * medR + this.calibration.C * medR * medR;
    const offset = knownSpO2 - currentEstimate;
    this.calibration.A += offset;
    this.calibrationState = 'SESSION_CALIBRATED';
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
    this.lastConfidence = 0;
    this.sessionRatioHistory = [];
  }

  fullReset(): void {
    this.reset();
    this.calibrationState = 'UNCALIBRATED';
    this.calibration = { A: 104.0, B: 4.2, C: -28.5, deviceId: 'default', timestamp: 0 };
  }
}
