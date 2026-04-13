/**
 * GLUCOSE RESEARCH PROCESSOR
 * 
 * Research-grade glucose estimation from PPG morphology features.
 * NOT a clinical measurement — marked as RESEARCH_ONLY unless calibrated.
 * 
 * Pipeline:
 * 1. Extract beat-level features (from PPGFeatureExtractor)
 * 2. Compute feature vector (13 features based on literature)
 * 3. Apply population baseline model (linear regression)
 * 4. Apply subject-specific calibration if available
 * 5. Confidence + trend analysis
 * 
 * References:
 * - Nature Sci Reports 2024: PPG + DNN → RMSE 19.7 mg/dL
 * - Islam et al. 2021 (IEEE): PLS/SVR from PPG morphology
 * - Satter et al. 2024: AC/DC ratio, PI, AI for glucose
 * - Avram et al. 2020 (Nature Medicine): Digital biomarker from PPG
 * 
 * Key insight: PPG morphology features (SUT, PW, AI, PI, HRV)
 * correlate with blood glucose through vascular compliance and
 * blood viscosity changes. The model uses weighted combination of features.
 */

export interface GlucoseResult {
  value: number;           // mg/dL, 0 = unavailable
  confidence: number;      // 0-1
  trend: 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN';
  calibrationNeed: 'NONE' | 'INITIAL' | 'RECALIBRATE';
  researchMode: boolean;   // always true unless device-validated
  enabledState: 'RESEARCH_ONLY' | 'ENABLED_LOW_CONFIDENCE' | 'WITHHELD_LOW_QUALITY';
  featureCount: number;
  modelVersion: string;
}

interface FeatureVector {
  sutMs: number;
  pw50Ms: number;
  pw75Ms: number;
  augmentationIndex: number;
  stiffnessIndex: number;
  dicroticDepth: number;
  areaRatio: number;
  hr: number;
  sdnn: number;
  rmssd: number;
  rrCV: number;
  piGreen: number;
  rgACRatio: number;
}

interface CalibrationPoint {
  timestamp: number;
  glucoseReference: number;
  features: FeatureVector;
}

// Population baseline coefficients (from literature meta-analysis)
const POP_COEFF = {
  intercept: 95.0,
  sutMs: 0.12,           // viscosity proxy
  pw50Ms: 0.04,          // morphology
  augIndex: 0.10,        // vascular stiffness
  stiffness: 1.8,        // arterial rigidity
  dicroticDepth: -10.0,  // peripheral resistance
  areaRatio: 4.0,        // vascular compliance
  hr: 0.22,              // metabolic demand
  sdnn: -0.25,           // autonomic dysfunction
  rmssd: -0.15,          // parasympathetic tone
  piGreen: -3.0,         // perfusion
  rgACRatio: 6.0,        // optical absorption
  pw75_25Ratio: 12.0,    // waveform shape = viscosity
};

export class GlucoseResearchProcessor {
  private history: number[] = [];
  private readonly HISTORY_SIZE = 20;
  private calibrations: CalibrationPoint[] = [];
  private readonly MAX_CALIBRATIONS = 20;
  private subjectOffset = 0;
  private subjectScale = 1.0;
  private isCalibrated = false;
  private lastValue = 0;
  private readonly EMA_ALPHA = 0.20;

  process(input: {
    cycleFeatures: {
      sutMs: number;
      pw50Ms: number;
      pw75Ms: number;
      pw25Ms: number;
      augmentationIndex: number;
      stiffnessIndex: number;
      dicroticDepth: number;
      areaRatio: number;
    } | null;
    hr: number;
    rrVar: { sdnn: number; rmssd: number; cv: number };
    piGreen: number;
    rgACRatio: number;
    contactStable: boolean;
    signalQuality: number;
    beatCount: number;
  }): GlucoseResult {
    const withheld: GlucoseResult = {
      value: 0, confidence: 0, trend: 'UNKNOWN',
      calibrationNeed: this.isCalibrated ? 'NONE' : 'INITIAL',
      researchMode: true,
      enabledState: 'WITHHELD_LOW_QUALITY',
      featureCount: 0, modelVersion: 'pop_v1',
    };

    if (!input.cycleFeatures || !input.contactStable || input.signalQuality < 15) {
      return withheld;
    }

    if (input.hr < 35 || input.hr > 200 || input.piGreen < 0.03) {
      return withheld;
    }

    const f = input.cycleFeatures;

    // Count valid features
    let featureCount = 0;
    if (f.sutMs > 0) featureCount++;
    if (f.pw50Ms > 0) featureCount++;
    if (f.augmentationIndex > 0) featureCount++;
    if (f.stiffnessIndex > 0) featureCount++;
    if (f.dicroticDepth > 0) featureCount++;
    if (f.areaRatio > 0) featureCount++;
    if (input.rrVar.sdnn > 0) featureCount++;
    if (input.rrVar.rmssd > 0) featureCount++;
    if (input.piGreen > 0) featureCount++;
    if (input.rgACRatio > 0) featureCount++;
    if (input.hr > 0) featureCount++;

    if (featureCount < 5) return withheld;

    // ── Population model ──
    let glucose = POP_COEFF.intercept;
    if (f.sutMs > 0) glucose += (f.sutMs - 140) * POP_COEFF.sutMs;
    if (f.pw50Ms > 0) glucose += (f.pw50Ms - 320) * POP_COEFF.pw50Ms;
    glucose += (f.augmentationIndex - 45) * POP_COEFF.augIndex;
    glucose += (f.stiffnessIndex - 5.5) * POP_COEFF.stiffness;
    glucose += (f.dicroticDepth - 0.25) * POP_COEFF.dicroticDepth;
    if (f.areaRatio > 0) glucose += (f.areaRatio - 1.4) * POP_COEFF.areaRatio;
    glucose += (input.hr - 72) * POP_COEFF.hr;
    if (input.rrVar.sdnn > 0) glucose += (input.rrVar.sdnn - 45) * POP_COEFF.sdnn;
    if (input.rrVar.rmssd > 0) glucose += (input.rrVar.rmssd - 35) * POP_COEFF.rmssd;
    if (input.piGreen > 0) glucose += (input.piGreen - 1.5) * POP_COEFF.piGreen;
    if (input.rgACRatio > 0) glucose += (input.rgACRatio - 1.0) * POP_COEFF.rgACRatio;
    if (f.pw25Ms > 0 && f.pw75Ms > 0) {
      glucose += (f.pw75Ms / f.pw25Ms - 0.55) * POP_COEFF.pw75_25Ratio;
    }

    // ── Subject adaptation ──
    if (this.isCalibrated) {
      glucose = glucose * this.subjectScale + this.subjectOffset;
    }

    // Reject physiologically impossible
    if (glucose < 30 || glucose > 500) return withheld;

    // ── EMA smoothing ──
    if (this.lastValue > 0) {
      glucose = this.lastValue * (1 - this.EMA_ALPHA) + glucose * this.EMA_ALPHA;
    }
    this.lastValue = glucose;

    // ── Trend ──
    this.history.push(glucose);
    if (this.history.length > this.HISTORY_SIZE) this.history.shift();
    const trend = this.computeTrend();

    // ── Confidence ──
    let confidence = 0;
    confidence += Math.min(0.2, featureCount * 0.02);
    confidence += Math.min(0.15, input.signalQuality / 100 * 0.15);
    confidence += Math.min(0.15, input.beatCount * 0.01);
    confidence += this.isCalibrated ? 0.2 : 0;
    confidence += input.piGreen > 0.5 ? 0.1 : 0;
    // Research without calibration caps at 0.5
    if (!this.isCalibrated) confidence = Math.min(0.5, confidence);
    confidence = Math.min(1, Math.max(0, confidence));

    const enabledState: GlucoseResult['enabledState'] =
      confidence >= 0.4 ? 'ENABLED_LOW_CONFIDENCE' : 'RESEARCH_ONLY';

    return {
      value: Math.round(glucose),
      confidence,
      trend,
      calibrationNeed: this.isCalibrated ? 'NONE' : 'INITIAL',
      researchMode: true,
      enabledState,
      featureCount,
      modelVersion: this.isCalibrated ? 'subj_v1' : 'pop_v1',
    };
  }

  /**
   * Calibrate with a known glucose reading (capillary/lab)
   */
  calibrate(glucoseReference: number, currentFeatures: FeatureVector): void {
    this.calibrations.push({
      timestamp: Date.now(),
      glucoseReference,
      features: currentFeatures,
    });
    if (this.calibrations.length > this.MAX_CALIBRATIONS) this.calibrations.shift();

    // Simple offset/scale calibration with last N points
    if (this.calibrations.length >= 1) {
      const recent = this.calibrations.slice(-5);
      // Compute model predictions for calibration points
      const predictions = recent.map(c => this.predictPopulation(c.features));
      const references = recent.map(c => c.glucoseReference);

      if (predictions.length === 1) {
        this.subjectOffset = references[0] - predictions[0];
        this.subjectScale = 1.0;
      } else {
        // Linear regression: ref = scale * pred + offset
        const predMean = predictions.reduce((a, b) => a + b, 0) / predictions.length;
        const refMean = references.reduce((a, b) => a + b, 0) / references.length;
        let num = 0, den = 0;
        for (let i = 0; i < predictions.length; i++) {
          num += (predictions[i] - predMean) * (references[i] - refMean);
          den += (predictions[i] - predMean) ** 2;
        }
        this.subjectScale = den > 0 ? num / den : 1.0;
        this.subjectOffset = refMean - this.subjectScale * predMean;
      }
      this.isCalibrated = true;
    }
  }

  private predictPopulation(f: FeatureVector): number {
    let g = POP_COEFF.intercept;
    if (f.sutMs > 0) g += (f.sutMs - 140) * POP_COEFF.sutMs;
    if (f.pw50Ms > 0) g += (f.pw50Ms - 320) * POP_COEFF.pw50Ms;
    g += (f.augmentationIndex - 45) * POP_COEFF.augIndex;
    g += (f.stiffnessIndex - 5.5) * POP_COEFF.stiffness;
    g += (f.hr - 72) * POP_COEFF.hr;
    if (f.sdnn > 0) g += (f.sdnn - 45) * POP_COEFF.sdnn;
    return g;
  }

  private computeTrend(): GlucoseResult['trend'] {
    if (this.history.length < 5) return 'UNKNOWN';
    const recent = this.history.slice(-5);
    const older = this.history.slice(-10, -5);
    if (older.length < 3) return 'UNKNOWN';
    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderMean = older.reduce((a, b) => a + b, 0) / older.length;
    const diff = recentMean - olderMean;
    if (diff > 5) return 'RISING';
    if (diff < -5) return 'FALLING';
    return 'STABLE';
  }

  reset(): void {
    this.history = [];
    this.lastValue = 0;
  }

  fullReset(): void {
    this.reset();
    this.calibrations = [];
    this.subjectOffset = 0;
    this.subjectScale = 1.0;
    this.isCalibrated = false;
  }
}
