/**
 * SIGNAL QUALITY ESTIMATOR V2
 * Comprehensive SQI from multiple dimensions.
 * No simulation — pure signal analysis.
 */
import type { PressureState } from './PressureProxyEstimator';

export interface SQIReport {
  sqiGlobal: number;           // 0-100
  sqiSpectral: number;         // 0-100
  sqiMorphology: number;       // 0-100
  sqiMotion: number;           // 0-100 (higher = less motion contamination)
  sqiChannelAgreement: number; // 0-100
  perfusionIndex: number;
  periodicityScore: number;
  bandPowerRatio: number;
  roiValidRatio: number;
  spatialUniformity: number;
  pressureState: PressureState;
  motionScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  positionDrift: number;
  activeSource: string;
  sourceStability: number;
  guidance: string;
  usableForBPM: boolean;
  usableForSpO2: boolean;
  usableForRhythm: boolean;
  usableForBP: boolean;
  usableForBiomarkers: boolean;
}

export function computeGlobalSQI(params: {
  perfusionIndex: number;
  periodicityScore: number;
  coverageRatio: number;
  spatialUniformity: number;
  pressurePenalty: number;
  motionScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  positionDrift: number;
  signalRange: number;
  redDominance: number;
  contactState: string;
  sourceStability: number;
}): number {
  const {
    perfusionIndex, periodicityScore, coverageRatio,
    spatialUniformity, pressurePenalty, motionScore,
    clipHighRatio, clipLowRatio, positionDrift,
    signalRange, redDominance, contactState, sourceStability
  } = params;

  if (contactState === 'NO_CONTACT') return 0;

  // Gate: no hemoglobin signature = no real finger
  if (redDominance < 12) return 0;

  // Gate: no perfusion = no signal
  if (perfusionIndex < 0.003) return Math.min(8, coverageRatio * 15);

  // --- Component scores ---
  const perfScore = Math.min(22, perfusionIndex * 10);
  const periodicScore = Math.min(20, periodicityScore * 25);
  const coverageScore = Math.min(12, coverageRatio * 18);
  const uniformityScore = Math.min(8, spatialUniformity * 10);
  const rangeScore = Math.min(10, (signalRange / 5) * 10);
  const stabilityScore = Math.min(8, sourceStability * 10);

  // --- Penalties ---
  const motionPenalty = Math.min(20, motionScore * 16);
  const clipPenalty = Math.min(25, (clipHighRatio + clipLowRatio) * 40);
  const driftPenalty = Math.min(15, positionDrift * 50);

  // Pressure multiplier (0.3-1.0)
  const base = perfScore + periodicScore + coverageScore +
    uniformityScore + rangeScore + stabilityScore -
    motionPenalty - clipPenalty - driftPenalty;

  // Stable contact bonus
  const stableBonus = contactState === 'STABLE_CONTACT' ? 5 : 0;

  return Math.max(0, Math.min(100, (base + stableBonus) * pressurePenalty));
}

export function computeModalSQI(params: {
  sqiGlobal: number;
  periodicityScore: number;
  motionScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  sourceStability: number;
  spatialUniformity: number;
  perfusionIndex: number;
  contactState: string;
  pressureState?: PressureState;
  activeSource?: string;
  positionDrift?: number;
}): SQIReport {
  const sqiSpectral = Math.max(0, Math.min(100, params.periodicityScore * 100));
  const sqiMorphology = Math.max(
    0,
    Math.min(
      100,
      params.spatialUniformity * 35 +
      params.sourceStability * 35 +
      Math.min(30, params.perfusionIndex * 12)
    ),
  );
  const sqiMotion = Math.max(0, Math.min(100, (1 - Math.min(1, params.motionScore)) * 100));
  const clipPenalty = Math.min(1, params.clipHighRatio + params.clipLowRatio);
  const sqiChannelAgreement = Math.max(
    0,
    Math.min(100, params.sourceStability * 70 + (1 - clipPenalty) * 30),
  );

  const stableContact = params.contactState === 'STABLE_CONTACT';
  const usableForBPM = stableContact && params.sqiGlobal >= 25 && sqiSpectral >= 20;
  const usableForSpO2 = stableContact && params.sqiGlobal >= 35 && sqiChannelAgreement >= 35 && params.clipHighRatio < 0.15;
  const usableForRhythm = stableContact && params.sqiGlobal >= 40 && sqiMorphology >= 30 && sqiMotion >= 50;
  const usableForBP = stableContact && params.sqiGlobal >= 45 && sqiMorphology >= 35 && params.perfusionIndex >= 0.008;
  const usableForBiomarkers = stableContact && params.sqiGlobal >= 50 && sqiChannelAgreement >= 45 && params.perfusionIndex >= 0.01;

  return {
    sqiGlobal: params.sqiGlobal,
    sqiSpectral,
    sqiMorphology,
    sqiMotion,
    sqiChannelAgreement,
    perfusionIndex: params.perfusionIndex,
    periodicityScore: params.periodicityScore,
    bandPowerRatio: params.periodicityScore,
    roiValidRatio: params.spatialUniformity,
    spatialUniformity: params.spatialUniformity,
    pressureState: params.pressureState ?? 'OPTIMAL_PRESSURE',
    motionScore: params.motionScore,
    clipHighRatio: params.clipHighRatio,
    clipLowRatio: params.clipLowRatio,
    positionDrift: params.positionDrift ?? 0,
    activeSource: params.activeSource ?? '',
    sourceStability: params.sourceStability,
    guidance: usableForBPM ? 'signal_usable' : 'signal_limited',
    usableForBPM,
    usableForSpO2,
    usableForRhythm,
    usableForBP,
    usableForBiomarkers,
  };
}
