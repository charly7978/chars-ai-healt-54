import { describe, it, expect } from 'vitest';
import { HemoglobinProcessor, type HemoglobinFeatures } from '../HemoglobinProcessor';

const baseF: HemoglobinFeatures = {
  meanRedLin: 180, meanGreenLin: 70, meanBlueLin: 60,
  odR: 0.10, odG: 0.40, odB: 0.50,
  perfusionRed: 0.030, perfusionGreen: 0.040,
  pulseAmplitude: 6, dicroticDepth: 0.3, rgRatio: 2.6, hr: 72,
  gender: 'M',
};

describe('HemoglobinProcessor', () => {
  it('returns RESEARCH_ONLY population prior when no calibration is loaded', () => {
    const proc = new HemoglobinProcessor();
    const r = proc.process(baseF);
    expect(typeof r.value === 'number' && (r.value as number) > 11 && (r.value as number) < 17).toBe(true);
    expect(r.researchMode).toBe(true);
    expect(String(r.status).toLowerCase()).toContain('research');
    expect(r.qualityFlags.some(f => f.flag === 'research_only')).toBe(true);
  });

  it('builds a model after 3 valid calibration points', () => {
    const proc = new HemoglobinProcessor();
    proc.startCalibrationWizard();
    // 3 deterministic points where odR varies and Hb varies
    expect(proc.addCalibrationPoint({ ...baseF, odR: 0.05 }, 11.0).success).toBe(true);
    expect(proc.addCalibrationPoint({ ...baseF, odR: 0.10 }, 13.5).success).toBe(true);
    expect(proc.addCalibrationPoint({ ...baseF, odR: 0.15 }, 16.0).success).toBe(true);
    expect(proc.getCalibrationStatus().modelReady).toBe(true);
  });

  it('rejects out-of-range Hb references', () => {
    const proc = new HemoglobinProcessor();
    proc.startCalibrationWizard();
    expect(proc.addCalibrationPoint(baseF, 1).success).toBe(false);
    expect(proc.addCalibrationPoint(baseF, 30).success).toBe(false);
  });

  it('predicts a calibrated Hb after model is built', () => {
    const proc = new HemoglobinProcessor();
    proc.startCalibrationWizard();
    proc.addCalibrationPoint({ ...baseF, odR: 0.05 }, 11.0);
    proc.addCalibrationPoint({ ...baseF, odR: 0.10 }, 13.5);
    proc.addCalibrationPoint({ ...baseF, odR: 0.15 }, 16.0);
    let r;
    for (let i = 0; i < 5; i++) r = proc.process({ ...baseF, odR: 0.10 });
    expect(r!.researchMode).toBe(false);
    expect(typeof r!.value === 'number' && (r!.value as number) > 8).toBe(true);
    expect(typeof r!.value === 'number' && (r!.value as number) < 20).toBe(true);
  });

  it('flags anemia when value falls below sex-specific threshold', () => {
    const proc = new HemoglobinProcessor();
    proc.startCalibrationWizard();
    proc.addCalibrationPoint({ ...baseF, odR: 0.05 }, 9.0);
    proc.addCalibrationPoint({ ...baseF, odR: 0.05, gender: 'F' }, 8.5);
    proc.addCalibrationPoint({ ...baseF, odR: 0.05 }, 10.0);
    let r;
    for (let i = 0; i < 5; i++) r = proc.process({ ...baseF, odR: 0.05, gender: 'F' });
    expect(typeof r!.anemiaScreening === 'boolean').toBe(true);
  });

  it('serialize / loadSerialized round-trip restores calibration', () => {
    const a = new HemoglobinProcessor();
    a.startCalibrationWizard();
    a.addCalibrationPoint({ ...baseF, odR: 0.05 }, 11.0);
    a.addCalibrationPoint({ ...baseF, odR: 0.10 }, 13.5);
    a.addCalibrationPoint({ ...baseF, odR: 0.15 }, 16.0);
    const payload = a.serializeCalibration();

    const b = new HemoglobinProcessor();
    b.loadSerializedCalibration(payload);
    expect(b.getCalibrationStatus().modelReady).toBe(true);
  });

  it('reset clears history but keeps calibration; fullReset clears everything', () => {
    const proc = new HemoglobinProcessor();
    proc.startCalibrationWizard();
    proc.addCalibrationPoint({ ...baseF, odR: 0.05 }, 11.0);
    proc.addCalibrationPoint({ ...baseF, odR: 0.10 }, 13.5);
    proc.addCalibrationPoint({ ...baseF, odR: 0.15 }, 16.0);
    proc.process(baseF);
    proc.reset();
    expect(proc.getCalibrationStatus().modelReady).toBe(true);
    proc.fullReset();
    expect(proc.getCalibrationStatus().modelReady).toBe(false);
  });
});
