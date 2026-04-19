import { describe, it, expect } from 'vitest';
import { GlucoseResearchProcessorV3, type GlucoseV3Features } from '../GlucoseResearchProcessorV3';
import { LipidResearchProcessorV3, type LipidV3Features } from '../LipidResearchProcessorV3';

const baseG: GlucoseV3Features = {
  sutMs: 180, pw50Ms: 280, pw75Ms: 220, pw25Ms: 360,
  augmentationIndex: 25, stiffnessIndex: 12,
  dicroticDepth: 0.4, areaRatio: 1.4,
  hr: 72, rrSDNN: 30, perfusionGreen: 0.04, rgRatio: 2.5,
  odR: 0.10, odG: 0.40, odB: 0.50,
};

const baseL: LipidV3Features = {
  stiffnessIndex: 12, augmentationIndex: 25, pwvProxy: 7,
  pulseAmplitude: 6, pw50Ms: 280, pw75Ms: 220, pw25Ms: 360,
  diastolicTimeMs: 500, areaRatio: 1.4, dicroticDepth: 0.4,
  hr: 72, rrSDNN: 30, perfusionGreen: 0.04,
};

describe('GlucoseResearchProcessorV3', () => {
  it('blocks (NEEDS_CALIBRATION) without training', () => {
    const proc = new GlucoseResearchProcessorV3();
    const r = proc.process(baseG, 0.7);
    expect(r.value).toBeNull();
    expect(String(r.status).toLowerCase()).toContain('needs_calibration');
    expect(r.researchMode).toBe(true);
  });

  it('refuses to train with insufficient coverage even at MIN_SAMPLES', () => {
    const proc = new GlucoseResearchProcessorV3();
    proc.startTrainingMode();
    // 20 samples but ALL same glucose (zero coverage)
    for (let i = 0; i < 20; i++) {
      proc.addTrainingSample({ ...baseG, sutMs: 180 + i }, 100);
    }
    const status = proc.getCalibrationStatus();
    expect(status.modelReady).toBe(false);
    expect(status.coverageMgDl).toBe(0);
  });

  it('builds a model with 20 samples spanning ≥30 mg/dL', () => {
    const proc = new GlucoseResearchProcessorV3();
    proc.startTrainingMode();
    for (let i = 0; i < 20; i++) {
      const g = 80 + i * 3; // 80..137 mg/dL → 57 mg/dL coverage
      proc.addTrainingSample({ ...baseG, sutMs: 180 + i, augmentationIndex: 25 + i }, g);
    }
    expect(proc.getCalibrationStatus().modelReady).toBe(true);
  });

  it('publishes a research-only value after model is built', () => {
    const proc = new GlucoseResearchProcessorV3();
    proc.startTrainingMode();
    for (let i = 0; i < 22; i++) {
      const g = 80 + i * 3;
      proc.addTrainingSample({ ...baseG, sutMs: 180 + i }, g);
    }
    let r;
    for (let i = 0; i < 5; i++) r = proc.process(baseG, 0.6);
    expect(typeof r!.value === 'number' && (r!.value as number) >= 40 && (r!.value as number) <= 400).toBe(true);
    expect(r!.researchMode).toBe(true);
    expect(String(r!.status).toLowerCase()).toContain('research');
  });

  it('serialization round-trip restores model', () => {
    const a = new GlucoseResearchProcessorV3();
    a.startTrainingMode();
    for (let i = 0; i < 22; i++) a.addTrainingSample({ ...baseG, sutMs: 180 + i }, 80 + i * 3);
    const payload = a.serializeCalibration();
    const b = new GlucoseResearchProcessorV3();
    b.loadSerializedCalibration(payload);
    expect(b.getCalibrationStatus().modelReady).toBe(true);
  });
});

describe('LipidResearchProcessorV3', () => {
  it('blocks (NEEDS_CALIBRATION) without training', () => {
    const proc = new LipidResearchProcessorV3();
    const r = proc.process(baseL, 0.7);
    expect(r.value).toBeNull();
    expect(String(r.status).toLowerCase()).toContain('needs_calibration');
  });

  it('builds 4 models after 10 samples', () => {
    const proc = new LipidResearchProcessorV3();
    proc.startTraining();
    for (let i = 0; i < 12; i++) {
      proc.addTrainingSample(
        { ...baseL, stiffnessIndex: 10 + i },
        { totalCholesterol: 180 + i * 4, ldl: 100 + i * 3, hdl: 55 + i, triglycerides: 120 + i * 5 },
      );
    }
    expect(proc.getCalibrationStatus().modelReady).toBe(true);
  });

  it('publishes a 4-tuple value after training', () => {
    const proc = new LipidResearchProcessorV3();
    proc.startTraining();
    for (let i = 0; i < 12; i++) {
      proc.addTrainingSample(
        { ...baseL, stiffnessIndex: 10 + i },
        { totalCholesterol: 180 + i * 4, ldl: 100 + i * 3, hdl: 55 + i, triglycerides: 120 + i * 5 },
      );
    }
    const r = proc.process(baseL, 0.6);
    expect(r.value).not.toBeNull();
    if (r.value && typeof r.value === 'object') {
      expect(r.value.totalCholesterol).toBeGreaterThan(0);
      expect(r.value.triglycerides).toBeGreaterThan(0);
      expect((r.value as any).hdl).toBeGreaterThan(0);
      expect((r.value as any).ldl).toBeGreaterThan(0);
    }
    expect(String(r.status).toLowerCase()).toContain('research');
  });

  it('serialization round-trip restores models', () => {
    const a = new LipidResearchProcessorV3();
    a.startTraining();
    for (let i = 0; i < 12; i++) {
      a.addTrainingSample(
        { ...baseL, stiffnessIndex: 10 + i },
        { totalCholesterol: 180 + i * 4, ldl: 100 + i * 3, hdl: 55 + i, triglycerides: 120 + i * 5 },
      );
    }
    const payload = a.serializeCalibration();
    const b = new LipidResearchProcessorV3();
    b.loadSerializedCalibration(payload);
    expect(b.getCalibrationStatus().modelReady).toBe(true);
  });
});
