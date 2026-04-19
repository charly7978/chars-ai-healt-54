/**
 * Audit fix regression — BloodPressureProcessor (V1, the active emitter)
 * MUST refuse to publish when the morphology cannot sustain a physiological
 * pair, instead of forcing dbp = sbp - 25 / sbp - 55 (the previous
 * fabrication that gave the same "looks OK" reading regardless of input).
 */
import { describe, it, expect } from 'vitest';
import { BloodPressureProcessor } from '../BloodPressureProcessor';

const flatBuffer = (n: number, value = 0): number[] => Array.from({ length: n }, () => value);

describe('BloodPressureProcessor — gating (audit)', () => {
  it('returns INSUFFICIENT for empty / static input (no fabrication)', () => {
    const bp = new BloodPressureProcessor();
    const out = bp.estimate(flatBuffer(120, 0), [], 30);
    expect(out.confidence).toBe('INSUFFICIENT');
    expect(out.systolic).toBe(0);
    expect(out.diastolic).toBe(0);
  });

  it('returns INSUFFICIENT when only 1 RR interval is provided', () => {
    const bp = new BloodPressureProcessor();
    const out = bp.estimate(flatBuffer(200, 0.5), [800], 30);
    expect(out.confidence).toBe('INSUFFICIENT');
  });

  it('never reports SBP/DBP outside [85..190] / [50..120] when it does emit', () => {
    // Build a synthetic but physiologically-shaped PPG so the feature
    // extractor returns at least one valid cycle. We don't care about the
    // exact value — only that *if* the gate opens, the result respects
    // the physical envelope without invention.
    const fs = 30;
    const buf: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t = i / fs;
      // 1.2 Hz cardiac wave + dicrotic-like decay
      const v = Math.sin(2 * Math.PI * 1.2 * t) * 1.0
              + Math.sin(2 * Math.PI * 2.4 * t) * 0.25;
      buf.push(v);
    }
    const rr = Array.from({ length: 12 }, () => 833); // ~72 bpm
    const out = new BloodPressureProcessor().estimate(buf, rr, fs);
    if (out.confidence !== 'INSUFFICIENT') {
      expect(out.systolic).toBeGreaterThanOrEqual(85);
      expect(out.systolic).toBeLessThanOrEqual(190);
      expect(out.diastolic).toBeGreaterThanOrEqual(50);
      expect(out.diastolic).toBeLessThanOrEqual(120);
      expect(out.systolic - out.diastolic).toBeGreaterThanOrEqual(15);
      expect(out.systolic - out.diastolic).toBeLessThanOrEqual(100);
    }
  });
});
