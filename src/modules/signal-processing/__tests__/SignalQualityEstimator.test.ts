import { describe, it, expect } from 'vitest';
import { computeGlobalSQI } from '../SignalQualityEstimator';

const base = {
  perfusionIndex: 0.05,
  periodicityScore: 0.8,
  coverageRatio: 0.7,
  spatialUniformity: 0.7,
  pressurePenalty: 1.0,
  motionScore: 0.0,
  clipHighRatio: 0.0,
  clipLowRatio: 0.0,
  positionDrift: 0.0,
  signalRange: 5,
  redDominance: 30,
  contactState: 'STABLE_CONTACT' as const,
  sourceStability: 0.9,
};

describe('computeGlobalSQI', () => {
  it('returns 0 when contactState is NO_CONTACT', () => {
    expect(computeGlobalSQI({ ...base, contactState: 'NO_CONTACT' as any })).toBe(0);
  });

  it('returns 0 for non-hemoglobin signature (low red dominance)', () => {
    expect(computeGlobalSQI({ ...base, redDominance: 5 })).toBe(0);
  });

  it('caps at low value when perfusion is very low', () => {
    const v = computeGlobalSQI({ ...base, perfusionIndex: 0.001 });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(8);
  });

  it('produces a high SQI for ideal inputs (≥50)', () => {
    expect(computeGlobalSQI(base)).toBeGreaterThan(40);
  });

  it('penalizes motion + clipping monotonically', () => {
    const baseSQI = computeGlobalSQI(base);
    const moved = computeGlobalSQI({ ...base, motionScore: 0.8 });
    const clipped = computeGlobalSQI({ ...base, clipHighRatio: 0.4 });
    expect(moved).toBeLessThan(baseSQI);
    expect(clipped).toBeLessThan(baseSQI);
  });

  it('lowers SQI when pressurePenalty multiplies it down', () => {
    const baseSQI = computeGlobalSQI(base);
    const penalized = computeGlobalSQI({ ...base, pressurePenalty: 0.4 });
    expect(penalized).toBeLessThan(baseSQI);
  });
});
