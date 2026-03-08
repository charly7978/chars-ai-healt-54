/**
 * PROCESADOR DE PRESIÓN ARTERIAL AVANZADO
 * 
 * Basado en literatura científica 2024-2025:
 * - Elgendi 2024 (Diagnostics): ratios APG b/a y d/a como predictores de SBP
 * - Mukkamala 2022: modelo cuffless BP desde morfología PPG
 * - pyPPG (PMC 2024): estandarización de 632 features por ciclo cardíaco
 * - Frontiers Digital Health 2025: PPG verde reflectivo para BP
 * - Nature Scientific Reports 2025: PWV desde PPG
 * 
 * DISCLAIMER: Estimación sin calibración individual. NO es diagnóstico médico.
 */

import { PPGFeatureExtractor, FiducialPoints, CycleFeatures } from './PPGFeatureExtractor';

export interface BPEstimate {
  systolic: number;
  diastolic: number;
  map: number; // Mean Arterial Pressure
  pulsePressure: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  cyclesUsed: number;
  featureQuality: number; // 0-100
}

interface CalibrationData {
  systolicRef: number;
  diastolicRef: number;
  timestamp: number;
  systolicOffset: number;
  diastolicOffset: number;
}

/**
 * Coeficientes de regresión ridge basados en literatura publicada
 * 
 * SBP model (Elgendi 2024, Mukkamala 2022):
 *   SBP = β0 + β1*(b/a) + β2*(d/a) + β3*(1/SUT_ms) + β4*SI + β5*AIx 
 *         + β6*HR + β7*PWV + β8*IPA
 * 
 * DBP model:
 *   DBP = γ0 + γ1*PW50 + γ2*DT_ms + γ3*RMSSD + γ4*dicrotic_depth + γ5*area_ratio
 */
const SBP_COEFFICIENTS = {
  intercept: 85.0,       // β0: baseline intercept
  bDivA: -18.5,          // β1: b/a ratio (negative = higher b/a → lower SBP, per Elgendi 2024)
  dDivA: 12.3,           // β2: d/a ratio (positive = higher d/a → higher SBP)
  invSUT: 2800.0,        // β3: 1/SUT_ms (shorter upstroke → higher SBP)
  SI: 8.5,               // β4: Stiffness Index (higher SI → higher SBP)
  AIx: 0.35,             // β5: Augmentation Index (higher AIx → higher SBP)
  HR: 0.28,              // β6: Heart Rate contribution
  PWV: 3.2,              // β7: Pulse Wave Velocity proxy
  IPA: -6.0,             // β8: Inflection Point Area ratio (higher → more elastic → lower SBP)
  AGI: 5.5,              // Additional: Aging Index from APG
};

const DBP_COEFFICIENTS = {
  intercept: 45.0,       // γ0: baseline intercept
  PW50: 0.12,            // γ1: Pulse Width at 50% amplitude (ms)
  DT: 0.035,             // γ2: Diastolic Time (ms)
  RMSSD: -0.08,          // γ3: RMSSD (higher HRV → lower DBP, parasympathetic)
  dicroticDepth: -12.0,  // γ4: Dicrotic notch depth (deeper → more elastic → lower DBP)
  areaRatio: 4.5,        // γ5: Systolic/Diastolic area ratio
  SI: 3.2,               // Additional: Stiffness Index
  HR: 0.15,              // Additional: HR contribution
};

export class BloodPressureProcessor {
  private cycleBuffer: CycleFeatures[] = [];
  private readonly MIN_CYCLES = 5;
  private readonly MAX_CYCLES = 15;
  private calibration: CalibrationData | null = null;
  
  // EMA para estabilización
  private lastSBP: number = 0;
  private lastDBP: number = 0;
  private readonly EMA_ALPHA = 0.2;

  /**
   * Procesa un buffer PPG y retorna estimación de BP
   * Requiere mínimo 5 ciclos cardíacos limpios
   */
  estimate(
    signalBuffer: number[],
    rrIntervals: number[],
    sampleRate: number = 30
  ): BPEstimate {
    const insufficient: BPEstimate = {
      systolic: 0, diastolic: 0, map: 0, pulsePressure: 0,
      confidence: 'INSUFFICIENT', cyclesUsed: 0, featureQuality: 0
    };

    if (signalBuffer.length < 60 || rrIntervals.length < 3) {
      return insufficient;
    }

    // 1. Detectar fiducial points por ciclo
    const cycles = PPGFeatureExtractor.detectCardiacCycles(signalBuffer, sampleRate);
    
    if (cycles.length < this.MIN_CYCLES) {
      return insufficient;
    }

    // 2. Extraer features por ciclo y filtrar por calidad
    const validCycles: CycleFeatures[] = [];
    
    for (const cycle of cycles) {
      const features = PPGFeatureExtractor.extractCycleFeatures(
        signalBuffer, cycle, sampleRate
      );
      if (features && features.quality > 0.4) {
        validCycles.push(features);
      }
    }

    if (validCycles.length < this.MIN_CYCLES) {
      return insufficient;
    }

    // Keep last MAX_CYCLES
    const useCycles = validCycles.slice(-this.MAX_CYCLES);

    // 3. Promediar features across cycles (median for robustness)
    const avgFeatures = this.medianFeatures(useCycles);

    // 4. Compute HR from RR intervals
    const validRR = rrIntervals.filter(i => i > 200 && i < 2000);
    const avgRR = validRR.reduce((a, b) => a + b, 0) / validRR.length;
    const hr = 60000 / avgRR;

    // 5. HRV metrics
    const rrVar = PPGFeatureExtractor.extractRRVariability(validRR);

    // 6. Apply regression models
    let sbp = this.estimateSBP(avgFeatures, hr);
    let dbp = this.estimateDBP(avgFeatures, hr, rrVar.rmssd);

    // 7. Physiological consistency: MAP = DBP + (SBP-DBP)/3
    // Ensure DBP < SBP and pulse pressure is reasonable
    if (dbp >= sbp) {
      dbp = sbp * 0.62; // typical ratio
    }
    const pulsePressure = sbp - dbp;
    if (pulsePressure < 15) {
      // Too narrow - adjust
      dbp = sbp - 25;
    }
    if (pulsePressure > 100) {
      // Too wide - adjust
      dbp = sbp - 55;
    }

    const map = dbp + pulsePressure / 3;

    // 8. Apply calibration offset if available
    if (this.calibration) {
      sbp += this.calibration.systolicOffset;
      dbp += this.calibration.diastolicOffset;
    }

    // 9. EMA smoothing
    if (this.lastSBP > 0) {
      sbp = this.lastSBP * (1 - this.EMA_ALPHA) + sbp * this.EMA_ALPHA;
      dbp = this.lastDBP * (1 - this.EMA_ALPHA) + dbp * this.EMA_ALPHA;
    }
    this.lastSBP = sbp;
    this.lastDBP = dbp;

    // 10. Confidence assessment
    const featureQuality = this.assessFeatureQuality(avgFeatures, useCycles.length);
    const confidence = this.assessConfidence(featureQuality, useCycles.length);

    return {
      systolic: sbp,
      diastolic: dbp,
      map,
      pulsePressure: sbp - dbp,
      confidence,
      cyclesUsed: useCycles.length,
      featureQuality
    };
  }

  /**
   * SBP estimation using multivariate regression
   * SBP = β0 + β1*(b/a) + β2*(d/a) + β3*(1/SUT) + β4*SI + β5*AIx + β6*HR + β7*PWV + β8*IPA + β9*AGI
   */
  private estimateSBP(f: MedianFeatures, hr: number): number {
    const c = SBP_COEFFICIENTS;
    
    let sbp = c.intercept;
    
    // APG ratios (Elgendi 2024 - strongest predictors)
    sbp += c.bDivA * f.bDivA;
    sbp += c.dDivA * f.dDivA;
    
    // Temporal: inverse of systolic upstroke time (shorter → higher BP)
    if (f.sutMs > 0) {
      sbp += c.invSUT * (1 / f.sutMs);
    }
    
    // Stiffness Index
    sbp += c.SI * f.stiffnessIndex;
    
    // Augmentation Index
    sbp += c.AIx * f.augmentationIndex;
    
    // Heart Rate
    sbp += c.HR * hr;
    
    // PWV proxy
    sbp += c.PWV * f.pwvProxy;
    
    // Inflection Point Area ratio (elastic arteries → lower)
    sbp += c.IPA * f.ipaRatio;
    
    // Aging Index
    sbp += c.AGI * f.agi;
    
    return sbp;
  }

  /**
   * DBP estimation using multivariate regression
   * DBP = γ0 + γ1*PW50 + γ2*DT + γ3*RMSSD + γ4*dicrotic + γ5*areaRatio + γ6*SI + γ7*HR
   */
  private estimateDBP(f: MedianFeatures, hr: number, rmssd: number): number {
    const c = DBP_COEFFICIENTS;
    
    let dbp = c.intercept;
    
    // Pulse width at 50% amplitude
    dbp += c.PW50 * f.pw50Ms;
    
    // Diastolic time
    dbp += c.DT * f.diastolicTimeMs;
    
    // RMSSD (parasympathetic → lower DBP)
    dbp += c.RMSSD * rmssd;
    
    // Dicrotic notch depth (deeper → more elastic → lower DBP)
    dbp += c.dicroticDepth * f.dicroticDepth;
    
    // Area ratio
    dbp += c.areaRatio * f.areaRatio;
    
    // Stiffness
    dbp += c.SI * f.stiffnessIndex;
    
    // HR
    dbp += c.HR * hr;
    
    return dbp;
  }

  /**
   * Calibrate with a reference cuff measurement
   */
  calibrate(systolicRef: number, diastolicRef: number): void {
    // Calculate current uncalibrated estimate offset
    this.calibration = {
      systolicRef,
      diastolicRef,
      timestamp: Date.now(),
      systolicOffset: systolicRef - this.lastSBP,
      diastolicOffset: diastolicRef - this.lastDBP
    };
  }

  /**
   * Compute median of features across cycles for robustness
   */
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
      pwvProxy: median(cycles.map(c => c.pwvProxy)),
      ipaRatio: median(cycles.map(c => c.ipaRatio)),
      dicroticDepth: median(cycles.map(c => c.dicroticDepth)),
      areaRatio: median(cycles.map(c => c.areaRatio)),
      pw50Ms: median(cycles.map(c => c.pw50Ms)),
      pw25Ms: median(cycles.map(c => c.pw25Ms)),
      pw75Ms: median(cycles.map(c => c.pw75Ms)),
    };
  }

  private assessFeatureQuality(f: MedianFeatures, cycleCount: number): number {
    let score = 0;
    const max = 100;
    
    // Cycle count contribution (max 30)
    score += Math.min(30, cycleCount * 3);
    
    // Valid APG features (max 25)
    if (f.bDivA !== 0) score += 12;
    if (f.dDivA !== 0) score += 13;
    
    // Valid temporal features (max 20)
    if (f.sutMs > 30 && f.sutMs < 500) score += 10;
    if (f.diastolicTimeMs > 50 && f.diastolicTimeMs < 1000) score += 10;
    
    // Valid morphological features (max 25)
    if (f.stiffnessIndex > 0) score += 8;
    if (f.ipaRatio > 0) score += 9;
    if (f.dicroticDepth > 0) score += 8;
    
    return Math.min(max, score);
  }

  private assessConfidence(featureQuality: number, cycleCount: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' {
    if (featureQuality >= 75 && cycleCount >= 8) return 'HIGH';
    if (featureQuality >= 50 && cycleCount >= 5) return 'MEDIUM';
    if (featureQuality >= 30 && cycleCount >= 5) return 'LOW';
    return 'INSUFFICIENT';
  }

  reset(): void {
    this.cycleBuffer = [];
    this.lastSBP = 0;
    this.lastDBP = 0;
    // Keep calibration across resets
  }

  fullReset(): void {
    this.reset();
    this.calibration = null;
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
  pwvProxy: number;
  ipaRatio: number;
  dicroticDepth: number;
  areaRatio: number;
  pw50Ms: number;
  pw25Ms: number;
  pw75Ms: number;
}
