import { describe, it, expect } from 'vitest';
import { StressProcessor } from '../StressProcessor';
import { HRVTimeFreqProcessor } from '../HRVTimeFreqProcessor';
import { generateSyntheticRR } from '../../../__tests__/utils/golden-signals';

describe('StressProcessor', () => {
  it('returns empty result when not enough RR samples', () => {
    const sp = new StressProcessor();
    const r = sp.process({
      rrIntervals: [800, 810],
      lfHfRatio: 1.5,
      rmssd: 30,
      meanHR: 70,
    });
    expect(r.confidence).toBe(0);
    expect(r.qualityFlags).toContain('insufficient_rr');
  });

  it('classifies a relaxed regular RR series as REPOSO/NORMAL', () => {
    const sp = new StressProcessor();
    const hrv = new HRVTimeFreqProcessor();
    const rr = generateSyntheticRR(50, 60, 'variable', { jitterMs: 50 });
    const h = hrv.compute(rr);
    const r = sp.process({
      rrIntervals: rr,
      lfHfRatio: h.freq.lfHfRatio,
      rmssd: h.time.rmssd,
      meanHR: h.time.hr,
      restingHR: 60,
      perfusionIndexHistory: [3, 3.1, 3, 2.9, 3.05, 2.95, 3.0, 3.0],
      signalQuality: 80,
    });
    expect(['REPOSO', 'NORMAL']).toContain(r.label);
    expect(r.index).toBeLessThan(60);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('classifies elevated HR + low HRV + high LF/HF as ALERTA or ESTRES_ALTO', () => {
    const sp = new StressProcessor();
    const rr = generateSyntheticRR(40, 110, 'regular'); // high HR, very low variability
    const r = sp.process({
      rrIntervals: rr,
      lfHfRatio: 6,            // very sympathetic
      rmssd: 8,                // collapsed parasympathetic
      meanHR: 110,
      restingHR: 65,
      perfusionIndexHistory: [3, 4, 2, 5, 1.5, 4.5, 2.2, 3.8], // high CV
      signalQuality: 80,
    });
    expect(['ALERTA', 'ESTRES_ALTO']).toContain(r.label);
    expect(r.index).toBeGreaterThan(55);
  });

  it('Baevsky SI is non-negative and finite', () => {
    const sp = new StressProcessor();
    const rr = generateSyntheticRR(40, 75, 'regular');
    const r = sp.process({
      rrIntervals: rr, lfHfRatio: 1.5, rmssd: 25, meanHR: 75,
    });
    expect(Number.isFinite(r.components.baevsky)).toBe(true);
    expect(r.components.baevsky).toBeGreaterThanOrEqual(0);
  });

  it('confidence scales with number of intervals', () => {
    const sp = new StressProcessor();
    const small = sp.process({
      rrIntervals: generateSyntheticRR(15, 70, 'variable'),
      lfHfRatio: 1.5, rmssd: 25, meanHR: 70, signalQuality: 70,
    }).confidence;
    const big = sp.process({
      rrIntervals: generateSyntheticRR(80, 70, 'variable'),
      lfHfRatio: 1.5, rmssd: 25, meanHR: 70, signalQuality: 70,
      perfusionIndexHistory: [3, 3.1, 2.9, 3.0, 2.95, 3.02, 3.08, 2.92],
    }).confidence;
    expect(big).toBeGreaterThan(small);
  });
});
