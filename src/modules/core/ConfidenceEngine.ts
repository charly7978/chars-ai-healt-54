import type { OutputState } from './MeasurementGate';

export interface ModalitySignals {
  contactStable: boolean;
  pressureOk: boolean;
  clipBurden: number;
  sourceStability: number;
  avgBeatSQI: number;
  beatCount: number;
  calibrationRecency: number; // 0-1
  personalizationStrength: number; // 0-1
}

/**
 * Combina señales en un score 0-1 por modalidad (sin números mágicos en la UI).
 */
export class ConfidenceEngine {
  static spo2(mod: ModalitySignals, quality01: number): number {
    let c = quality01 * 0.45;
    if (mod.contactStable) c += 0.12;
    if (mod.pressureOk) c += 0.08;
    c += mod.sourceStability * 0.1;
    c += Math.min(0.12, mod.beatCount * 0.004);
    c += Math.min(0.08, mod.avgBeatSQI / 100 * 0.08);
    c -= mod.clipBurden * 0.18;
    c += mod.calibrationRecency * 0.07;
    return Math.max(0, Math.min(1, c));
  }

  static bp(mod: ModalitySignals, featureQuality01: number): number {
    let c = featureQuality01 * 0.5;
    c += mod.personalizationStrength * 0.15;
    c += mod.calibrationRecency * 0.2;
    c -= mod.clipBurden * 0.1;
    return Math.max(0, Math.min(1, c));
  }

  static biomarker(mod: ModalitySignals, featureQuality01: number): number {
    let c = featureQuality01 * 0.55;
    c += mod.personalizationStrength * 0.25;
    c += mod.calibrationRecency * 0.12;
    c -= mod.clipBurden * 0.08;
    return Math.max(0, Math.min(1, c));
  }

  static toOutputState(confidence: number, quality: number, research: boolean): OutputState {
    if (research) return 'RESEARCH_ONLY';
    if (quality < 18 || confidence < 0.12) return 'WITHHELD_LOW_QUALITY';
    if (confidence >= 0.62 && quality >= 55) return 'ENABLED_HIGH_CONFIDENCE';
    if (confidence >= 0.38 && quality >= 32) return 'ENABLED_MEDIUM_CONFIDENCE';
    return 'ENABLED_LOW_CONFIDENCE';
  }
}
