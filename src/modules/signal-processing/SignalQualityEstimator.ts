/**
 * SIGNAL QUALITY ESTIMATOR V2
 * Comprehensive SQI from multiple dimensions.
 * No simulation — pure signal analysis.
 */
import type { PressureState } from './PressureProxyEstimator';

export interface SQIReport {
  sqiGlobal: number;           // 0-100
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
