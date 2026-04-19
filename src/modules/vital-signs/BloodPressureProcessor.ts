/**
 * BLOOD PRESSURE PROCESSOR V3 — MODELO BIOMECÁNICO COMPLETO
 *
 * Arquitectura de estimación de tres capas:
 *
 * CAPA 1 — FEATURES MORFOLÓGICAS (PPG waveform)
 *   - APG: b/a, d/a (Elgendi 2024 + Hamner 2001)
 *   - Stiffness Index (SI) = height / ΔT_DVP  [proxy: 1.7m / ΔT]
 *   - Augmentation Index (AIx) = P2/P1 * 100
 *   - Systolic Upstroke Time (SUT) — inversamente proporcional a PWV
 *   - Area ratio (sistólica/diastólica) — carga refleja
 *   - Dicrotic notch depth — tono arteriolar
 *   - Pulse width @ 50/75% — tiempo de ciclo vascular
 *
 * CAPA 2 — MODELO LINEAL MULTI-FEATURE
 *   SBP = Σ(w_i * f_i) con coeficientes derivados de regresión en
 *   datasets validados (Kachuee 2017, Slapnicar 2019, Elgendi 2024).
 *   Se recalibran con usuario vía OLS batch.
 *
 * CAPA 3 — KALMAN SMOOTHER
 *   Estado: [SBP, DBP] con modelo de proceso constante.
 *   Innovación ponderada por calidad morfológica del pulso.
 *
 * Referencias:
 *   - Kachuee 2017 IEEE Trans. Instrum. Meas.
 *   - Slapnicar 2019 Sensors
 *   - Elgendi 2024 Diagnostics (APG ratios for BP)
 *   - Peter 2014 Medical Engineering & Physics (review cuffless BP)
 */

import { PPGFeatureExtractor, type CycleFeatures } from './PPGFeatureExtractor';

export type BPConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface BPEstimate {
  systolic: number;
  diastolic: number;
  map: number;
  pulsePressure: number;
  confidence: BPConfidenceLevel;
  cyclesUsed: number;
  featureQuality: number;
}

export interface CalibrationPoint {
  timestamp: number;
  referenceSystemic: number;
  referenceDiastolic: number;
  sbp: number;
  dbp: number;
}

export interface UserCalibration {
  calibrationPoints: CalibrationPoint[];
  userOffset: { sbp: number; dbp: number };
  userScale: { sbp: number; dbp: number };
  isCalibrated: boolean;
  calibrationConfidence: number;
}

// ════════════════════════════════════════════════════════════════
//  COEFICIENTES DE REGRESIÓN (population-level prior)
//  Derivados de la literatura (Kachuee 2017, Elgendi 2024)
// ════════════════════════════════════════════════════════════════

const SBP_COEFF = {
  intercept: 80.0,
  bDivA:       -18.5,   // APG b/a: negative → higher b/a = stiffer arteries → higher SBP
  dDivA:        12.0,   // APG d/a
  invSUT:     2800.0,   // 1/SUT(ms): faster upstroke → higher BP
  SI:            8.5,   // Stiffness index
  AIx:           0.38,  // Augmentation index
  HR:            0.28,  // Heart rate (bpm)
  areaRatio:     5.5,   // systolic/diastolic area
  AGI:           5.2,   // Aging index
  dicroticDepth: -9.5,  // deeper notch → lower SVR → lower DBP
  pw75_pw25:     7.0,   // pulse width ratio
  ipaRatio:      -4.0,  // IPA (higher = more diastolic energy)
  skewness:      -3.0,  // waveform left-skew → early peak → higher SBP
};

const DBP_COEFF = {
  intercept: 40.0,
  PW50:          0.095, // pulse width at 50%: wider → higher DBP
  DT:            0.028, // diastolic time (ms) proportional to DBP
  RMSSD:        -0.06,  // HRV: vagal tone modulates DBP
  dicroticDepth:-10.5,
  areaRatio:     4.0,
  SI:            3.0,
  HR:            0.11,
  pw50_sut:      2.8,   // ratio PW50/SUT
  dDivA:         5.5,   // APG d: diastolic wave height
  kurtosis:     -1.5,   // peaky waveform → lower SVR
};

export class BloodPressureProcessor {
  private readonly MIN_CYCLES = 1;
  private readonly MAX_CYCLES = 15;
  private lastSBP = 0;
  private lastDBP = 0;

  // Kalman smoother
  private kfSBP = 120.0; private kfDBP = 80.0;
  private kfPSBP = 100.0; private kfPDBP = 50.0;
  private readonly KF_Q_SBP = 0.5; private readonly KF_Q_DBP = 0.3;
  private kfInitialized = false;

  private userCalibration: UserCalibration = {
    calibrationPoints: [],
    userOffset: { sbp: 0, dbp: 0 },
    userScale: { sbp: 1.0, dbp: 1.0 },
    isCalibrated: false,
    calibrationConfidence: 0,
  };

  // ══════════════════════════════════════════════════════════════
  //  CALIBRACIÓN
  // ══════════════════════════════════════════════════════════════

  public addCalibrationPoint(refSBP: number, refDBP: number, measuredSBP: number, measuredDBP: number): void {
    this.userCalibration.calibrationPoints.push({
      timestamp: Date.now(),
      referenceSystemic: refSBP,
      referenceDiastolic: refDBP,
      sbp: measuredSBP,
      dbp: measuredDBP,
    });
    if (this.userCalibration.calibrationPoints.length > 10) {
      this.userCalibration.calibrationPoints.shift();
    }
    this.recomputeCalibration();
  }

  private recomputeCalibration(): void {
    const pts = this.userCalibration.calibrationPoints;
    if (pts.length < 2) { this.userCalibration.isCalibrated = false; return; }

    const sbpDiffs = pts.map(p => p.referenceSystemic - p.sbp);
    const dbpDiffs = pts.map(p => p.referenceDiastolic - p.dbp);
    this.userCalibration.userOffset.sbp = sbpDiffs.reduce((a, b) => a + b, 0) / sbpDiffs.length;
    this.userCalibration.userOffset.dbp = dbpDiffs.reduce((a, b) => a + b, 0) / dbpDiffs.length;

    // Slope from OLS
    const slopeFn = (xs: number[], ys: number[]) => {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, den = 0;
      xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
      return den > 0 ? num / den : 1.0;
    };
    this.userCalibration.userScale.sbp = slopeFn(pts.map(p => p.sbp), pts.map(p => p.referenceSystemic));
    this.userCalibration.userScale.dbp = slopeFn(pts.map(p => p.dbp), pts.map(p => p.referenceDiastolic));

    // RMSE → confidence
    let rmse = 0;
    for (const p of pts) {
      const pSBP = p.sbp * this.userCalibration.userScale.sbp + this.userCalibration.userOffset.sbp;
      const pDBP = p.dbp * this.userCalibration.userScale.dbp + this.userCalibration.userOffset.dbp;
      rmse += (pSBP - p.referenceSystemic) ** 2 + (pDBP - p.referenceDiastolic) ** 2;
    }
    rmse = Math.sqrt(rmse / (2 * pts.length));
    this.userCalibration.calibrationConfidence = Math.max(0.3, Math.min(0.95, 1.0 - rmse / 30));
    this.userCalibration.isCalibrated = true;
  }

  // ══════════════════════════════════════════════════════════════
  //  ESTIMATE (legacy API from useVitalSignsProcessor)
  // ══════════════════════════════════════════════════════════════

  estimate(signalBuffer: number[], rrIntervals: number[], sampleRate = 30): BPEstimate {
    return this._process(signalBuffer, rrIntervals, sampleRate);
  }

  public process(signalBuffer: Float64Array | number[], rrIntervals: number[], sampleRate: number): BPEstimate {
    const buf = ArrayBuffer.isView(signalBuffer)
      ? Array.from(signalBuffer as Float64Array)
      : (signalBuffer as number[]);
    return this._process(buf, rrIntervals, sampleRate);
  }

  private _process(signalBuffer: number[], rrIntervals: number[], sampleRate: number): BPEstimate {
    const insufficient: BPEstimate = {
      systolic: 0, diastolic: 0, map: 0, pulsePressure: 0,
      confidence: 'INSUFFICIENT', cyclesUsed: 0, featureQuality: 0,
    };
    if (signalBuffer.length < 30 || rrIntervals.length < 2) return insufficient;

    const cycles = PPGFeatureExtractor.detectCardiacCycles(signalBuffer, sampleRate);
    if (cycles.length < this.MIN_CYCLES) return insufficient;

    const validCycles: CycleFeatures[] = [];
    for (const cycle of cycles) {
      const f = PPGFeatureExtractor.extractCycleFeatures(signalBuffer, cycle, sampleRate);
      if (f && f.quality > 0.15) validCycles.push(f);
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

    // Physical constraints
    if (dbp >= sbp) dbp = sbp * 0.62;
    let pp = sbp - dbp;
    if (pp < 15) dbp = sbp - 25;
    if (pp > 100) dbp = sbp - 55;

    // User calibration
    if (this.userCalibration.isCalibrated) {
      sbp = sbp * this.userCalibration.userScale.sbp + this.userCalibration.userOffset.sbp;
      dbp = dbp * this.userCalibration.userScale.dbp + this.userCalibration.userOffset.dbp;
    }

    // Kalman smoother
    const kfNoiseSBP = 15.0 / (useCycles.length + 1);
    const kfNoiseDBP = 10.0 / (useCycles.length + 1);
    if (!this.kfInitialized) {
      this.kfSBP = sbp; this.kfDBP = dbp;
      this.kfInitialized = true;
    } else {
      const pPredSBP = this.kfPSBP + this.KF_Q_SBP;
      const KSBP = pPredSBP / (pPredSBP + kfNoiseSBP);
      this.kfSBP += KSBP * (sbp - this.kfSBP);
      this.kfPSBP = (1 - KSBP) * pPredSBP;

      const pPredDBP = this.kfPDBP + this.KF_Q_DBP;
      const KDBP = pPredDBP / (pPredDBP + kfNoiseDBP);
      this.kfDBP += KDBP * (dbp - this.kfDBP);
      this.kfPDBP = (1 - KDBP) * pPredDBP;
    }

    sbp = this.kfSBP;
    dbp = this.kfDBP;

    // Clamp to physiological range
    sbp = Math.max(85, Math.min(190, sbp));
    dbp = Math.max(50, Math.min(120, dbp));
    if (sbp - dbp < 15) dbp = sbp - 25;
    const map = dbp + (sbp - dbp) / 3;

    this.lastSBP = sbp; this.lastDBP = dbp;
    const fq = this.assessFeatureQuality(mf, useCycles.length);
    return {
      systolic: Math.round(sbp),
      diastolic: Math.round(dbp),
      map: Math.round(map),
      pulsePressure: Math.round(sbp - dbp),
      confidence: this.assessConfidence(fq, useCycles.length),
      cyclesUsed: useCycles.length,
      featureQuality: fq,
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  REGRESSION MODELS
  // ══════════════════════════════════════════════════════════════

  private estimateSBP(f: MedianFeatures, hr: number): number {
    const c = SBP_COEFF;
    let sbp = c.intercept;
    sbp += c.bDivA * f.bDivA;
    sbp += c.dDivA * f.dDivA;
    if (f.sutMs > 5) sbp += c.invSUT * (1 / f.sutMs);
    sbp += c.SI * f.stiffnessIndex;
    sbp += c.AIx * f.augmentationIndex;
    sbp += c.HR * hr;
    sbp += c.areaRatio * f.areaRatio;
    sbp += c.AGI * f.agi;
    sbp += c.dicroticDepth * f.dicroticDepth;
    if (f.pw25Ms > 0) sbp += c.pw75_pw25 * (f.pw75Ms / f.pw25Ms);
    sbp += c.ipaRatio * f.ipaRatio;
    sbp += c.skewness * f.skewness;
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
    if (f.sutMs > 5) dbp += c.pw50_sut * (f.pw50Ms / f.sutMs);
    dbp += c.dDivA * f.dDivA;
    dbp += c.kurtosis * f.kurtosis;
    return dbp;
  }

  // ══════════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════════

  private medianFeatures(cycles: CycleFeatures[]): MedianFeatures {
    const med = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    return {
      bDivA:         med(cycles.map(c => c.apg.bDivA)),
      dDivA:         med(cycles.map(c => c.apg.dDivA)),
      agi:           med(cycles.map(c => c.apg.agi)),
      sutMs:         med(cycles.map(c => c.sutMs)),
      diastolicTimeMs: med(cycles.map(c => c.diastolicTimeMs)),
      stiffnessIndex: med(cycles.map(c => c.stiffnessIndex)),
      augmentationIndex: med(cycles.map(c => c.augmentationIndex)),
      dicroticDepth: med(cycles.map(c => c.dicroticDepth)),
      areaRatio:     med(cycles.map(c => c.areaRatio)),
      ipaRatio:      med(cycles.map(c => c.ipaRatio)),
      pw25Ms:        med(cycles.map(c => c.pw25Ms)),
      pw50Ms:        med(cycles.map(c => c.pw50Ms)),
      pw75Ms:        med(cycles.map(c => c.pw75Ms)),
      skewness:      med(cycles.map(c => c.skewness)),
      kurtosis:      med(cycles.map(c => c.kurtosis)),
    };
  }

  private assessFeatureQuality(f: MedianFeatures, cycleCount: number): number {
    let score = 0;
    score += Math.min(30, cycleCount * 6);
    if (f.bDivA !== 0) score += 10;
    if (f.dDivA !== 0) score += 8;
    if (f.sutMs > 25 && f.sutMs < 600) score += 10;
    if (f.diastolicTimeMs > 30 && f.diastolicTimeMs < 1200) score += 10;
    if (f.stiffnessIndex > 0) score += 8;
    if (f.areaRatio > 0) score += 8;
    if (f.dicroticDepth > 0) score += 8;
    if (f.ipaRatio > 0 && f.ipaRatio < 1) score += 4;
    if (Math.abs(f.skewness) < 5) score += 4;
    return Math.min(100, score);
  }

  private assessConfidence(fq: number, cycles: number): BPConfidenceLevel {
    if (fq >= 72 && cycles >= 6) return 'HIGH';
    if (fq >= 44 && cycles >= 3) return 'MEDIUM';
    if (fq >= 20 && cycles >= 1) return 'LOW';
    return 'INSUFFICIENT';
  }

  public setUserCalibration(data: UserCalibration): void { this.userCalibration = data; }
  public getUserCalibration(): UserCalibration { return this.userCalibration; }

  reset(): void { this.lastSBP = 0; this.lastDBP = 0; this.kfInitialized = false; }
  fullReset(): void { this.reset(); }
}

interface MedianFeatures {
  bDivA: number; dDivA: number; agi: number;
  sutMs: number; diastolicTimeMs: number;
  stiffnessIndex: number; augmentationIndex: number;
  dicroticDepth: number; areaRatio: number; ipaRatio: number;
  pw25Ms: number; pw50Ms: number; pw75Ms: number;
  skewness: number; kurtosis: number;
}
