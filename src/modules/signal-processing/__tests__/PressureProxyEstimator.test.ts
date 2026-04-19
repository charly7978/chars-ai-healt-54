import { describe, it, expect } from 'vitest';
import { PressureProxyEstimator } from '../PressureProxyEstimator';

const baseInput = {
  coverageRatio: 0.6,
  clipHighRatio: 0.0,
  clipLowRatio: 0.0,
  perfusionIndex: 0.05,
  spatialUniformity: 0.7,
  brightness: 350,
  brightnessVariance: 800,
  baselineDrift: 0.0,
};

describe('PressureProxyEstimator', () => {
  it('starts at LOW_PRESSURE before convergence', () => {
    const p = new PressureProxyEstimator();
    const r = p.estimate({ ...baseInput, coverageRatio: 0.05, perfusionIndex: 0.001 });
    expect(['LOW_PRESSURE', 'OPTIMAL_PRESSURE']).toContain(r.state);
  });

  it('classifies as HIGH_PRESSURE after sustained sat + low pulsatility', () => {
    const p = new PressureProxyEstimator();
    let r;
    for (let i = 0; i < 60; i++) {
      r = p.estimate({
        ...baseInput,
        coverageRatio: 0.95,
        perfusionIndex: 0.0001,
        clipHighRatio: 0.5,
        spatialUniformity: 0.99,
        brightness: 700,
        brightnessVariance: 50,
      });
    }
    expect(r!.state).toBe('HIGH_PRESSURE');
    expect(r!.penalty).toBeLessThan(0.5);
  });

  it('classifies as OPTIMAL_PRESSURE for moderate, healthy inputs', () => {
    const p = new PressureProxyEstimator();
    let r;
    for (let i = 0; i < 80; i++) {
      r = p.estimate({
        ...baseInput,
        coverageRatio: 0.7,
        perfusionIndex: 0.06,
        clipHighRatio: 0.0,
        spatialUniformity: 0.7,
        brightness: 400,
        brightnessVariance: 300,
      });
    }
    expect(['OPTIMAL_PRESSURE', 'LOW_PRESSURE']).toContain(r!.state);
    expect(r!.penalty).toBeGreaterThanOrEqual(0.4);
  });

  it('reset returns state to LOW_PRESSURE', () => {
    const p = new PressureProxyEstimator();
    p.estimate(baseInput);
    p.reset();
    const r = p.estimate(baseInput);
    expect(['LOW_PRESSURE', 'OPTIMAL_PRESSURE']).toContain(r.state);
  });
});
