import { describe, it, expect } from 'vitest';
import { SpO2ProcessorV3 } from '../SpO2ProcessorV3';
import type { SpO2Calibration } from '../SpO2ProcessorV2';

const makeDeviceCalibration = (): SpO2Calibration => ({
  // SpO2 = 110 − 25*R (textbook approximation, rewritten as quadratic)
  A: 110, B: -25, C: 0,
  validRRange: { min: 0.3, max: 1.5 },
  validSpO2Range: { min: 70, max: 100 },
  deviceModel: 'unit_test',
  calibrationDate: Date.now(),
  sampleCount: 5,
  rmse: 1.2,
  isUserCalibrated: false,
});

const goodInput = (override: Partial<any> = {}) => ({
  redAC: 0.06, redDC: 1.0,
  greenAC: 0.10, greenDC: 1.0,
  blueAC: 0.04, blueDC: 0.8,
  contactStable: true,
  pressureOptimal: true,
  clipHighRatio: 0,
  beatCount: 6,
  avgBeatSQI: 0.7,
  sourceStability: 0.8,
  ...override,
});

describe('SpO2ProcessorV3', () => {
  it('blocks when no calibration is loaded', () => {
    const proc = new SpO2ProcessorV3();
    const out = proc.process(goodInput());
    expect(out.value).toBeNull();
    expect(String(out.status).toLowerCase()).toContain('needs_calibration');
  });

  it('warms up before publishing (needs MIN_VALID_FRAMES)', () => {
    const proc = new SpO2ProcessorV3();
    proc.loadDeviceCalibration(makeDeviceCalibration());
    let last;
    for (let i = 0; i < 3; i++) last = proc.process(goodInput());
    expect(last!.value).toBeNull();
    // After ≥10 valid frames it should publish
    for (let i = 0; i < 12; i++) last = proc.process(goodInput());
    expect(typeof last!.value === 'number' && (last!.value as number) > 0).toBe(true);
  });

  it('rejects R out of calibrated range', () => {
    const proc = new SpO2ProcessorV3();
    proc.loadDeviceCalibration(makeDeviceCalibration());
    const out = proc.process(goodInput({ redAC: 1.0, redDC: 1.0, greenAC: 0.001, greenDC: 1.0 }));
    expect(out.value).toBeNull();
    expect(out.debug?.reason).toContain('R ratio out of calibrated range');
  });

  it('rejects when contact is unstable or SQI too low', () => {
    const proc = new SpO2ProcessorV3();
    proc.loadDeviceCalibration(makeDeviceCalibration());
    expect(proc.process(goodInput({ contactStable: false })).value).toBeNull();
    expect(proc.process(goodInput({ avgBeatSQI: 0.1 })).value).toBeNull();
  });

  it('grid-searches alpha and fits ridge quadratic when blue ratios are present', () => {
    const proc = new SpO2ProcessorV3();
    // Synthesize 5 calibration points where the "true" relationship lives in
    // a 50/50 RG/RB blend.
    const truth = (R: number) => 110 - 25 * R; // textbook
    const points = [
      { ratioRG: 0.45, ratioRB: 0.55 },
      { ratioRG: 0.55, ratioRB: 0.65 },
      { ratioRG: 0.65, ratioRB: 0.75 },
      { ratioRG: 0.80, ratioRB: 0.90 },
      { ratioRG: 0.95, ratioRB: 1.05 },
    ];
    for (const p of points) {
      const Rmix = 0.5 * p.ratioRG + 0.5 * p.ratioRB;
      proc.addUserCalibrationPoint(truth(Rmix), Rmix, p.ratioRG, p.ratioRB);
    }
    // After ≥3 points the calibration must be active and α reasonable.
    const alpha = proc.getBlendAlpha();
    expect(alpha).toBeGreaterThanOrEqual(0.4);
    expect(alpha).toBeLessThanOrEqual(0.85);
  });

  it('publishes a numeric SpO2 close to expected after warmup with R≈0.5', () => {
    const proc = new SpO2ProcessorV3();
    proc.loadDeviceCalibration(makeDeviceCalibration());
    // Choose AC/DC such that Rrg ≈ 0.5: (0.05/1)/(0.10/1)=0.5
    let last;
    for (let i = 0; i < 20; i++) {
      last = proc.process(goodInput({ redAC: 0.05, redDC: 1.0, greenAC: 0.10, greenDC: 1.0 }));
    }
    // SpO2 ≈ 110 − 25*0.5 = 97.5 → blended slightly different (with blue) — accept ±5
    expect(typeof last!.value === 'number' && (last!.value as number) >= 92 && (last!.value as number) <= 100).toBe(true);
  });

  it('reset clears history but keeps calibration', () => {
    const proc = new SpO2ProcessorV3();
    proc.loadDeviceCalibration(makeDeviceCalibration());
    for (let i = 0; i < 12; i++) proc.process(goodInput());
    proc.reset();
    // Right after reset → still needs warmup
    const out = proc.process(goodInput());
    expect(out.value).toBeNull();
  });

  it('fullReset clears calibration', () => {
    const proc = new SpO2ProcessorV3();
    proc.loadDeviceCalibration(makeDeviceCalibration());
    proc.fullReset();
    const out = proc.process(goodInput());
    expect(out.value).toBeNull();
    expect(String(out.status).toLowerCase()).toContain('needs_calibration');
  });
});
