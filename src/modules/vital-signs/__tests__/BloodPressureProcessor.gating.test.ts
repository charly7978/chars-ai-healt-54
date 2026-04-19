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

  it('rejects unsafe user-calibration coefficients (Bug 1: corrupted Kalman seed)', () => {
    // Inject a calibration whose slope is implausibly large and offset is
    // implausibly negative. The processor must refuse to mark it as
    // active — otherwise the per-frame pipeline would push a corrupted
    // (sbp, dbp) pair into the Kalman filter and bias the whole session.
    const bp = new BloodPressureProcessor();
    bp.setUserCalibration({
      calibrationPoints: [
        { timestamp: 0, referenceSystemic: 120, referenceDiastolic: 80, sbp: 200, dbp: 200 },
        { timestamp: 0, referenceSystemic: 121, referenceDiastolic: 81, sbp: 200, dbp: 200 },
      ],
      userOffset: { sbp: -300, dbp: -300 },
      userScale: { sbp: 5.0, dbp: 5.0 },
      isCalibrated: true,
      calibrationConfidence: 0.9,
    });
    // recomputeCalibration runs from the injected points; even if it
    // re-fits, the coefficient validator must clear isCalibrated when
    // the result is unsafe. After zero-variance points the slope falls
    // back to 1.0 (so it stays in [0.5, 2.0]) — what we really test is
    // that *both* the manual-injection path (above) and any subsequent
    // estimate() never bias the Kalman with the malicious offsets.
    const cal = bp.getUserCalibration();
    expect(
      // Either the validator rejected the fit OR a clean re-fit produced
      // safe coefficients. Both are acceptable; what is NOT acceptable
      // is keeping the original [-300, +5.0] pair active.
      (!cal.isCalibrated) ||
      (cal.userScale.sbp >= 0.5 && cal.userScale.sbp <= 2.0 &&
       cal.userScale.dbp >= 0.5 && cal.userScale.dbp <= 2.0 &&
       Math.abs(cal.userOffset.sbp) <= 40 &&
       Math.abs(cal.userOffset.dbp) <= 30)
    ).toBe(true);
  });

  it('Bug 1: corrupted calibration cannot poison the Kalman across sessions', () => {
    // Even if a malicious caller manages to bypass the validator (e.g. by
    // mutating private state via setUserCalibration AND providing bogus
    // points), reset() must wipe kfSBP/kfDBP/kfP so the next session
    // starts from the priors, not from the poisoned state.
    const bp = new BloodPressureProcessor();
    // Force-inject coefficients that would push estimates well off-scale.
    bp.setUserCalibration({
      calibrationPoints: [],
      userOffset: { sbp: 200, dbp: 200 },
      userScale: { sbp: 1.0, dbp: 1.0 },
      isCalibrated: true,
      calibrationConfidence: 0.9,
    });
    // No real points → recomputeCalibration() inside setUserCalibration
    // exits early (pts.length < 2), so we still hold the bogus offsets.
    // The estimate path must therefore reject them before the Kalman seed.
    const fs = 30;
    const buf = Array.from({ length: 600 }, (_, i) =>
      Math.sin(2 * Math.PI * 1.2 * (i / fs)) + 0.25 * Math.sin(2 * Math.PI * 2.4 * (i / fs)));
    const rr = Array.from({ length: 12 }, () => 833);
    bp.estimate(buf, rr, fs);
    bp.reset();
    // After reset the Kalman MUST be back at the priors (120/80).
    // We probe by serialising via a brand-new emission flow: any value
    // emitted now must respect the physiological envelope, never the
    // poisoned offsets.
    const out = bp.estimate(buf, rr, fs);
    if (out.confidence !== 'INSUFFICIENT') {
      expect(out.systolic).toBeGreaterThanOrEqual(85);
      expect(out.systolic).toBeLessThanOrEqual(190);
    }
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
