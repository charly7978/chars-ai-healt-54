import { describe, it, expect } from 'vitest';
import { BloodPressureProcessorV3, type BPV3Features } from '../BloodPressureProcessorV3';

const baseFeatures: BPV3Features = {
  stiffnessIndex: 12, augmentationIndex: 25, sutMs: 180,
  pw50Ms: 280, pw75Ms: 220, pw25Ms: 360, crestTimeMs: 120,
  dicroticDepth: 0.45, areaRatio: 1.4, pwvProxy: 7.5, hr: 72,
  rrSDNN: 35, rrRMSSD: 28,
  apgBDivA: -0.65, apgDDivA: -0.20, apgAGI: -0.30,
  perfusionIndex: 3.5, contactQuality: 0.9,
};

function pertb(f: BPV3Features, k: keyof BPV3Features, delta: number): BPV3Features {
  return { ...f, [k]: (f[k] as number) + delta };
}

describe('BloodPressureProcessorV3', () => {
  it('returns blocked when no model is calibrated', () => {
    const proc = new BloodPressureProcessorV3();
    const r = proc.process(baseFeatures, 0.8, 8, 30000);
    expect(r.value).toBeNull();
    expect(String(r.status).toLowerCase()).toContain('needs_calibration');
  });

  it('rejects out-of-range or inverted reference points', () => {
    const proc = new BloodPressureProcessorV3();
    proc.startCalibrationWizard();
    expect(proc.addCalibrationPoint(baseFeatures, 50, 90).success).toBe(false); // SBP too low
    expect(proc.addCalibrationPoint(baseFeatures, 250, 80).success).toBe(false); // SBP too high
    expect(proc.addCalibrationPoint(baseFeatures, 120, 130).success).toBe(false); // SBP < DBP
  });

  it('builds a working model after 5 valid calibration points', () => {
    const proc = new BloodPressureProcessorV3();
    proc.startCalibrationWizard();
    // 5 deterministic synthetic points where SBP responds linearly to stiffnessIndex
    const samples = [
      { f: pertb(baseFeatures, 'stiffnessIndex', -2), sbp: 110, dbp: 70 },
      { f: pertb(baseFeatures, 'stiffnessIndex', -1), sbp: 118, dbp: 75 },
      { f: pertb(baseFeatures, 'stiffnessIndex', 0),  sbp: 126, dbp: 80 },
      { f: pertb(baseFeatures, 'stiffnessIndex', 1),  sbp: 134, dbp: 85 },
      { f: pertb(baseFeatures, 'stiffnessIndex', 2),  sbp: 142, dbp: 90 },
    ];
    for (const s of samples) {
      const r = proc.addCalibrationPoint(s.f, s.sbp, s.dbp);
      expect(r.success).toBe(true);
    }
    const status = proc.getCalibrationStatus();
    expect(status.modelReady).toBe(true);
    expect(status.nPoints).toBe(5);
    // For our linear toy, LOO-RMSE should be sub-15 mmHg
    expect(status.rmseSBP).toBeLessThan(20);
  });

  it('predicts in-range BP after warmup with smoothed features', () => {
    const proc = new BloodPressureProcessorV3();
    proc.startCalibrationWizard();
    const samples = [
      { f: pertb(baseFeatures, 'stiffnessIndex', -2), sbp: 110, dbp: 70 },
      { f: pertb(baseFeatures, 'stiffnessIndex', -1), sbp: 118, dbp: 75 },
      { f: pertb(baseFeatures, 'stiffnessIndex', 0),  sbp: 126, dbp: 80 },
      { f: pertb(baseFeatures, 'stiffnessIndex', 1),  sbp: 134, dbp: 85 },
      { f: pertb(baseFeatures, 'stiffnessIndex', 2),  sbp: 142, dbp: 90 },
    ];
    for (const s of samples) proc.addCalibrationPoint(s.f, s.sbp, s.dbp);

    let last;
    for (let i = 0; i < 10; i++) {
      last = proc.process(baseFeatures, 0.8, 8, 30000);
    }
    expect(last!.value).not.toBeNull();
    if (last!.value && typeof last!.value === 'object') {
      const v = last!.value;
      expect(v.systolic).toBeGreaterThanOrEqual(70);
      expect(v.systolic).toBeLessThanOrEqual(220);
      expect(v.diastolic).toBeGreaterThanOrEqual(40);
      expect(v.diastolic).toBeLessThanOrEqual(130);
      expect(v.systolic).toBeGreaterThan(v.diastolic + 20);
      expect(v.map).toBeGreaterThan(v.diastolic);
      expect(v.map).toBeLessThan(v.systolic);
    }
  });

  it('rejects samples below the minimum SQI gate', () => {
    const proc = new BloodPressureProcessorV3();
    proc.startCalibrationWizard();
    for (let i = 0; i < 5; i++) proc.addCalibrationPoint(baseFeatures, 120, 80);
    const r = proc.process(baseFeatures, 0.1, 5, 10000);
    expect(r.value).toBeNull();
    expect(r.debug?.reason).toBe('Low SQI');
  });

  it('fullReset clears model and points', () => {
    const proc = new BloodPressureProcessorV3();
    proc.startCalibrationWizard();
    for (let i = 0; i < 5; i++) proc.addCalibrationPoint(baseFeatures, 120 + i, 80 + i);
    proc.fullReset();
    expect(proc.getCalibrationStatus().modelReady).toBe(false);
    const r = proc.process(baseFeatures, 0.9, 8, 30000);
    expect(r.value).toBeNull();
  });
});
