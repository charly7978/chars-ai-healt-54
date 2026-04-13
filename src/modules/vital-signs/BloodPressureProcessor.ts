import { PPGFeatureExtractor, CycleFeatures } from './PPGFeatureExtractor';

export interface BPEstimate {
  systolic: number;
  diastolic: number;
  map: number;
  pulsePressure: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  cyclesUsed: number;
  featureQuality: number;
  /** Cuando la morfología es débil pero hay forma útil: tendencia relativa */
  trendFirst?: boolean;
  trendLabel?: 'UP' | 'DOWN' | 'STABLE';
  modelAgreement?: number;
}

const SBP_COEFF = {
  intercept: 85.0,
  bDivA: -18.0,      // Aging index proxy
  dDivA: 12.0,       // Reflection wave timing
  invSUT: 3200.0,    // High sensitivity to Systolic Upstroke Time (from FIR filter)
  SI: 9.5,           // Stiffness Index (very accurate now with linear phase)
  AIx: 0.35,         // Augmentation Index
  HR: 0.22,
  areaRatio: 6.0,
  AGI: 5.5,
  dicroticDepth: -12.0, // Clearer dicrotic notch depth thanks to FIR
  pw75_pw25: 7.5,
};

const DBP_COEFF = {
  intercept: 45.0,
  PW50: 0.15,        // Pulse width at 50% correlates well with DBP
  DT: 0.045,         // Diastolic Time
  RMSSD: -0.05,
  dicroticDepth: -14.0,
  areaRatio: 4.5,
  SI: 3.5,
  HR: 0.15,
  pw50_sut_ratio: 3.0,
};

export class BloodPressureProcessor {
  private readonly MIN_CYCLES = 1;
  private readonly MAX_CYCLES = 15;
  private lastSBP = 0;
  private lastDBP = 0;
  /** Último valor reportado (tras offsets) para tendencia relativa */
  private lastReportedSbp = 0;
  private readonly EMA_ALPHA = 0.22;

  estimate(
    signalBuffer: number[],
    rrIntervals: number[],
    sampleRate: number = 30,
    opts?: { systolicOffset?: number; diastolicOffset?: number }
  ): BPEstimate {
    const insufficient: BPEstimate = {
      systolic: 0, diastolic: 0, map: 0, pulsePressure: 0,
      confidence: 'INSUFFICIENT', cyclesUsed: 0, featureQuality: 0,
      trendFirst: false,
    };

    if (signalBuffer.length < 30 || rrIntervals.length < 2) return insufficient;
    const cycles = PPGFeatureExtractor.detectCardiacCycles(signalBuffer, sampleRate);
    if (cycles.length < this.MIN_CYCLES) return insufficient;

    const validCycles: CycleFeatures[] = [];
    for (const cycle of cycles) {
      const features = PPGFeatureExtractor.extractCycleFeatures(signalBuffer, cycle, sampleRate);
      if (features && features.quality > 0.15) validCycles.push(features);
    }
    if (validCycles.length < this.MIN_CYCLES) return insufficient;

    const useCycles = validCycles.slice(-this.MAX_CYCLES);
    const mf = this.medianFeatures(useCycles);
    const validRR = rrIntervals.filter(i => i > 220 && i < 2200);
    if (validRR.length < 2) return insufficient;
    const avgRR = validRR.reduce((a, b) => a + b, 0) / validRR.length;
    const hr = 60000 / avgRR;
    const rrVar = PPGFeatureExtractor.extractRRVariability(validRR);

    let sbp = this.estimateSBP(mf, hr);
    let dbp = this.estimateDBP(mf, hr, rrVar.rmssd);

    if (dbp >= sbp) dbp = sbp * 0.62;
    const pp = sbp - dbp;
    if (pp < 15) dbp = sbp - 25;
    if (pp > 100) dbp = sbp - 55;

    if (this.lastSBP > 0) {
      sbp = this.lastSBP * (1 - this.EMA_ALPHA) + sbp * this.EMA_ALPHA;
      dbp = this.lastDBP * (1 - this.EMA_ALPHA) + dbp * this.EMA_ALPHA;
    }
    this.lastSBP = sbp;
    this.lastDBP = dbp;

    sbp = Math.max(85, Math.min(180, sbp));
    dbp = Math.max(50, Math.min(110, dbp));
    const featureQuality = this.assessFeatureQuality(mf, useCycles.length);
    const confidence = this.assessConfidence(featureQuality, useCycles.length);

    const offS = opts?.systolicOffset ?? 0;
    const offD = opts?.diastolicOffset ?? 0;
    sbp = Math.max(70, Math.min(200, sbp + offS));
    dbp = Math.max(45, Math.min(120, dbp + offD));
    const map = dbp + (sbp - dbp) / 3;

    const trendFirst = confidence === 'INSUFFICIENT' && featureQuality >= 22 && useCycles.length >= 2;
    let trendLabel: BPEstimate['trendLabel'] = 'STABLE';
    if (trendFirst && this.lastReportedSbp > 0) {
      const ds = sbp - this.lastReportedSbp;
      if (ds > 4) trendLabel = 'UP';
      else if (ds < -4) trendLabel = 'DOWN';
    }

    if (!trendFirst && sbp > 0) {
      this.lastReportedSbp = sbp;
    }

    return {
      systolic: trendFirst ? 0 : sbp,
      diastolic: trendFirst ? 0 : dbp,
      map: trendFirst ? 0 : map,
      pulsePressure: trendFirst ? 0 : sbp - dbp,
      confidence: trendFirst ? 'INSUFFICIENT' : confidence,
      cyclesUsed: useCycles.length,
      featureQuality,
      trendFirst,
      trendLabel,
      modelAgreement: Math.min(1, featureQuality / 100 * 0.7 + (useCycles.length / 15) * 0.3),
    };
  }

  private estimateSBP(f: MedianFeatures, hr: number): number {
    const c = SBP_COEFF;
    let sbp = c.intercept;
    sbp += c.bDivA * f.bDivA;
    sbp += c.dDivA * f.dDivA;
    if (f.sutMs > 0) sbp += c.invSUT * (1 / f.sutMs);
    sbp += c.SI * f.stiffnessIndex;
    sbp += c.AIx * f.augmentationIndex;
    sbp += c.HR * hr;
    sbp += c.areaRatio * f.areaRatio;
    sbp += c.AGI * f.agi;
    sbp += c.dicroticDepth * f.dicroticDepth;
    if (f.pw25Ms > 0) sbp += c.pw75_pw25 * (f.pw75Ms / f.pw25Ms);
    return sbp;
  }

  private estimateDBP(f: MedianFeatures, hr: number, rmssd: number): number {
    const c = DBP_COEFF;
    let dbp = c.intercept;
    dbp += c.PW50 * f.pw50Ms;
    dbp += c.DT * f.diastolicTimeMs;
    dbp += c.RMSSD * rmssd;
    dbp += c.dicroticDepth * f.dicroticDepth;
    dbp += c.areaRatio * f.areaRatio;
    dbp += c.SI * f.stiffnessIndex;
    dbp += c.HR * hr;
    if (f.sutMs > 0) dbp += c.pw50_sut_ratio * (f.pw50Ms / f.sutMs);
    return dbp;
  }

  private medianFeatures(cycles: CycleFeatures[]): MedianFeatures {
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    return {
      bDivA: median(cycles.map(c => c.apg.bDivA)),
      dDivA: median(cycles.map(c => c.apg.dDivA)),
      agi: median(cycles.map(c => c.apg.agi)),
      sutMs: median(cycles.map(c => c.sutMs)),
      diastolicTimeMs: median(cycles.map(c => c.diastolicTimeMs)),
      stiffnessIndex: median(cycles.map(c => c.stiffnessIndex)),
      augmentationIndex: median(cycles.map(c => c.augmentationIndex)),
      dicroticDepth: median(cycles.map(c => c.dicroticDepth)),
      areaRatio: median(cycles.map(c => c.areaRatio)),
      pw25Ms: median(cycles.map(c => c.pw25Ms)),
      pw50Ms: median(cycles.map(c => c.pw50Ms)),
      pw75Ms: median(cycles.map(c => c.pw75Ms)),
    };
  }

  private assessFeatureQuality(f: MedianFeatures, cycleCount: number): number {
    let score = 0;
    score += Math.min(34, cycleCount * 6);
    if (f.bDivA !== 0) score += 10;
    if (f.dDivA !== 0) score += 10;
    if (f.sutMs > 25 && f.sutMs < 600) score += 10;
    if (f.diastolicTimeMs > 30 && f.diastolicTimeMs < 1200) score += 10;
    if (f.stiffnessIndex > 0) score += 8;
    if (f.areaRatio > 0) score += 9;
    if (f.dicroticDepth > 0) score += 9;
    return Math.min(100, score);
  }

  private assessConfidence(featureQuality: number, cycleCount: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' {
    if (featureQuality >= 70 && cycleCount >= 6) return 'HIGH';
    if (featureQuality >= 42 && cycleCount >= 3) return 'MEDIUM';
    if (featureQuality >= 18 && cycleCount >= 1) return 'LOW';
    return 'INSUFFICIENT';
  }

  reset(): void {
    this.lastSBP = 0;
    this.lastDBP = 0;
    this.lastReportedSbp = 0;
  }

  fullReset(): void {
    this.reset();
  }
}

interface MedianFeatures {
  bDivA: number;
  dDivA: number;
  agi: number;
  sutMs: number;
  diastolicTimeMs: number;
  stiffnessIndex: number;
  augmentationIndex: number;
  dicroticDepth: number;
  areaRatio: number;
  pw25Ms: number;
  pw50Ms: number;
  pw75Ms: number;
}
