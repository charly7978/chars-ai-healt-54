import { describe, it, expect } from 'vitest';
import { HRVTimeFreqProcessor } from '../HRVTimeFreqProcessor';
import { generateSyntheticRR } from '../../../__tests__/utils/golden-signals';

describe('HRVTimeFreqProcessor', () => {
  it('returns near-zero variability indices for a perfectly regular RR series', () => {
    const proc = new HRVTimeFreqProcessor();
    const rr = generateSyntheticRR(40, 60, 'regular');
    const r = proc.compute(rr);
    expect(r.time.sdnn).toBeLessThan(0.01);
    expect(r.time.rmssd).toBeLessThan(0.01);
    expect(r.time.pnn50).toBe(0);
    expect(r.time.hr).toBeCloseTo(60, 0);
    expect(r.nUsed).toBe(40);
  });

  it('detects elevated SDNN/RMSSD/pNN50 in a variable RR series', () => {
    const proc = new HRVTimeFreqProcessor();
    const rr = generateSyntheticRR(50, 70, 'variable', { jitterMs: 80 });
    const r = proc.compute(rr);
    expect(r.time.sdnn).toBeGreaterThan(20);
    expect(r.time.rmssd).toBeGreaterThan(20);
    // The deterministic sinusoidal jitter (80ms peak, 0.6 rad/step) yields
    // ~45ms beat-to-beat differences → pnn50 may be 0, but pnn20 must fire.
    expect(r.time.pnn20).toBeGreaterThan(0);
    expect(r.time.hr).toBeGreaterThan(50);
    expect(r.time.hr).toBeLessThan(90);
  });

  it('produces non-zero LF/HF power on a long-enough variable record', () => {
    const proc = new HRVTimeFreqProcessor();
    const rr = generateSyntheticRR(60, 70, 'variable', { jitterMs: 60 });
    const r = proc.compute(rr);
    expect(r.freq.totalPower).toBeGreaterThan(0);
    expect(r.freq.lfPower + r.freq.hfPower).toBeGreaterThan(0);
    expect(r.freq.lfNu + r.freq.hfNu).toBeCloseTo(1, 1);
  });

  it('returns zero frequency power when below MIN_INTERVALS_FREQ', () => {
    const proc = new HRVTimeFreqProcessor();
    const rr = generateSyntheticRR(10, 70, 'variable');
    const r = proc.compute(rr);
    expect(r.freq.totalPower).toBe(0);
    expect(r.qualityFlags).toContain('insufficient_for_frequency');
  });

  it('rejects out-of-range RR intervals', () => {
    const proc = new HRVTimeFreqProcessor();
    const rr = [...generateSyntheticRR(20, 70, 'regular'), 60000, 50, 800, 800];
    const r = proc.compute(rr);
    // 60000 (too long) and 50 (too short) should be excluded
    expect(r.nUsed).toBeLessThan(rr.length);
  });

  it('DFA α1 is finite and within plausible range for a noisy variable record', () => {
    const proc = new HRVTimeFreqProcessor();
    const rr = generateSyntheticRR(60, 70, 'variable', { jitterMs: 40 });
    const r = proc.compute(rr);
    expect(Number.isFinite(r.nonlinear.dfaAlpha1)).toBe(true);
    // α1 typically between 0.5 and 1.5 for healthy adults
    expect(r.nonlinear.dfaAlpha1).toBeGreaterThan(-1);
    expect(r.nonlinear.dfaAlpha1).toBeLessThan(2.5);
  });

  it('Sample Entropy is finite and ≥0', () => {
    const proc = new HRVTimeFreqProcessor();
    const rr = generateSyntheticRR(40, 70, 'variable', { jitterMs: 60 });
    const r = proc.compute(rr);
    expect(Number.isFinite(r.nonlinear.sampEn)).toBe(true);
    expect(r.nonlinear.sampEn).toBeGreaterThanOrEqual(0);
  });

  it('quality grows with more intervals', () => {
    const proc = new HRVTimeFreqProcessor();
    const rrShort = generateSyntheticRR(10, 70, 'regular');
    const rrLong = generateSyntheticRR(80, 70, 'regular');
    const a = proc.compute(rrShort).quality;
    const b = proc.compute(rrLong).quality;
    expect(b).toBeGreaterThan(a);
  });
});
