/**
 * SIGNAL QUALITY ESTIMATOR V3
 * 
 * Global SQI from comprehensive metrics:
 * - Perfusion index
 * - Periodicity (autocorrelation)
 * - Coverage ratio
 * - Motion penalty
 * - Clipping penalty
 * - Position drift penalty
 * - Spatial uniformity
 * - Pressure penalty
 * - Source stability
 * - Spectral SNR
 * - Peak prominence
 * - Harmonic consistency
 * - Zero-crossing rate
 * - Temporal stability
 */

export type PressureState = 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE';

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
  spectralSNR?: number;
  peakProminence?: number;
  harmonicConsistency?: number;
  zeroCrossingRate?: number;
  temporalStability?: number;
}

export interface SQIInput {
  perfusionIndex: number;
  periodicityScore: number;
  coverageRatio: number;
  spatialUniformity: number;
  pressureState: PressureState;
  motionScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  positionDrift: number;
  signalRange: number;
  redDominance: number;
  contactState: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';
  sourceStability: number;
  pressurePenalty: number;
  // Enhanced metrics
  spectralSNR?: number;
  peakProminence?: number;
  harmonicConsistency?: number;
  zeroCrossingRate?: number;
  temporalStability?: number;
}

export interface SQIOutput {
  globalSQI: number;
  perfusionScore: number;
  periodicityScore: number;
  coverageScore: number;
  uniformityScore: number;
  rangeScore: number;
  stabilityScore: number;
  motionPenalty: number;
  clipPenalty: number;
  driftPenalty: number;
  // Enhanced scores
  spectralScore: number;
  peakScore: number;
  harmonicScore: number;
  zcScore: number;
  temporalScore: number;
}

export function computeGlobalSQI(params: SQIInput): number {
  const {
    perfusionIndex, periodicityScore, coverageRatio,
    spatialUniformity, motionScore,
    clipHighRatio, clipLowRatio, positionDrift,
    signalRange, redDominance, contactState, sourceStability,
    spectralSNR = 0,
    peakProminence = 0,
    harmonicConsistency = 0,
    zeroCrossingRate = 0,
    temporalStability = 1,
  } = params;

  // --- Rewards ---
  const perfScore = Math.min(10, perfusionIndex * 100);
  const periodicScore = periodicityScore * 35;
  const coverageScore = Math.min(8, coverageRatio * 15);
  const uniformityScore = spatialUniformity * 8;
  const rangeScore = Math.min(5, signalRange * 2);
  const stabilityScore = Math.min(8, sourceStability * 10);

  // --- Enhanced Rewards ---
  const spectralScore = Math.min(10, spectralSNR * 5);
  const peakScore = Math.min(8, peakProminence * 8);
  const harmonicScore = Math.min(6, harmonicConsistency * 6);
  const zcScore = Math.min(4, (1 - Math.abs(zeroCrossingRate - 0.5)) * 4);
  const temporalScore = Math.min(5, temporalStability * 5);

  // --- Penalties ---
  const motionPenalty = Math.min(20, motionScore * 16);
  const clipPenalty = Math.min(25, (clipHighRatio + clipLowRatio) * 40);
  const driftPenalty = Math.min(15, positionDrift * 50);

  // Pressure multiplier (0.3-1.0)
  const base = perfScore + periodicScore + coverageScore +
    uniformityScore + rangeScore + stabilityScore +
    spectralScore + peakScore + harmonicScore + zcScore + temporalScore -
    motionPenalty - clipPenalty - driftPenalty;

  // Stable contact bonus
  const stableBonus = contactState === 'STABLE_CONTACT' ? 5 : 0;

  // Clamp 0-100
  return Math.max(0, Math.min(100, base + stableBonus));
}

export function computeDetailedSQI(params: SQIInput): SQIOutput {
  const {
    perfusionIndex, periodicityScore, coverageRatio,
    spatialUniformity, motionScore,
    clipHighRatio, clipLowRatio, positionDrift,
    signalRange, redDominance, contactState, sourceStability,
    spectralSNR = 0,
    peakProminence = 0,
    harmonicConsistency = 0,
    zeroCrossingRate = 0,
    temporalStability = 1,
  } = params;

  // --- Rewards ---
  const perfScore = Math.min(10, perfusionIndex * 100);
  const periodicScore = periodicityScore * 35;
  const coverageScore = Math.min(8, coverageRatio * 15);
  const uniformityScore = spatialUniformity * 8;
  const rangeScore = Math.min(5, signalRange * 2);
  const stabilityScore = Math.min(8, sourceStability * 10);

  // --- Enhanced Rewards ---
  const spectralScore = Math.min(10, spectralSNR * 5);
  const peakScore = Math.min(8, peakProminence * 8);
  const harmonicScore = Math.min(6, harmonicConsistency * 6);
  const zcScore = Math.min(4, (1 - Math.abs(zeroCrossingRate - 0.5)) * 4);
  const temporalScore = Math.min(5, temporalStability * 5);

  // --- Penalties ---
  const motionPenalty = Math.min(20, motionScore * 16);
  const clipPenalty = Math.min(25, (clipHighRatio + clipLowRatio) * 40);
  const driftPenalty = Math.min(15, positionDrift * 50);

  // Pressure multiplier (0.3-1.0)
  const base = perfScore + periodicScore + coverageScore +
    uniformityScore + rangeScore + stabilityScore +
    spectralScore + peakScore + harmonicScore + zcScore + temporalScore -
    motionPenalty - clipPenalty - driftPenalty;

  // Stable contact bonus
  const stableBonus = contactState === 'STABLE_CONTACT' ? 5 : 0;

  // Clamp 0-100
  const globalSQI = Math.max(0, Math.min(100, base + stableBonus));

  return {
    globalSQI,
    perfusionScore: perfScore,
    periodicityScore: periodicScore,
    coverageScore: coverageScore,
    uniformityScore: uniformityScore,
    rangeScore: rangeScore,
    stabilityScore: stabilityScore,
    motionPenalty: motionPenalty,
    clipPenalty: clipPenalty,
    driftPenalty: driftPenalty,
    spectralScore: spectralScore,
    peakScore: peakScore,
    harmonicScore: harmonicScore,
    zcScore: zcScore,
    temporalScore: temporalScore,
  };
}
