import { describe, it, expect } from 'vitest';
import { RadiometricProcessor } from '../RadiometricProcessor';
import { generateSyntheticImageData } from '../../../__tests__/utils/golden-signals';

describe('RadiometricProcessor', () => {
  it('linearizes sRGB monotonically (gamma > 1 darkens midtones)', () => {
    const proc = new RadiometricProcessor('generic', 32, 32);
    const img = generateSyntheticImageData(32, 32, { redMean: 128, greenMean: 128, blueMean: 128 });
    const linear = proc.process(img);
    // Mid sRGB 128/255 ≈ 0.5; with gamma 2.2 → 0.5^2.2 ≈ 0.218
    const sample = linear.linearG[16 * 32 + 16];
    expect(sample).toBeGreaterThan(0.15);
    expect(sample).toBeLessThan(0.30);
  });

  it('reports clipping ratios consistently', () => {
    const proc = new RadiometricProcessor('generic', 32, 32);
    const sat = generateSyntheticImageData(32, 32, { redMean: 254, greenMean: 254, blueMean: 254 });
    const out = proc.process(sat);
    expect(out.qualityMetrics.clipHighRatio).toBeGreaterThan(0.5);
  });

  it('OD goes positive for darker-than-reference signal', () => {
    const proc = new RadiometricProcessor('generic', 32, 32);
    // Run with bright frame to set reference
    for (let i = 0; i < 65; i++) {
      proc.process(generateSyntheticImageData(32, 32, { redMean: 180, greenMean: 180, blueMean: 180 }));
    }
    // Now darker frame
    const out = proc.process(generateSyntheticImageData(32, 32, { redMean: 60, greenMean: 60, blueMean: 60 }));
    const sampleOD = out.odG[16 * 32 + 16];
    expect(sampleOD).toBeGreaterThan(0); // log(I/Iref) where I < Iref
  });

  it('histogram returns ordered percentiles', () => {
    const proc = new RadiometricProcessor('generic', 32, 32);
    const img = generateSyntheticImageData(32, 32, { redMean: 128, greenMean: 128, blueMean: 128, jitter: 30 });
    const out = proc.process(img);
    const h = out.histStatsRaw;
    expect(h.p1).toBeLessThanOrEqual(h.p25);
    expect(h.p25).toBeLessThanOrEqual(h.p50);
    expect(h.p50).toBeLessThanOrEqual(h.p75);
    expect(h.p75).toBeLessThanOrEqual(h.p99);
  });

  it('setProfile mutates active profile', () => {
    const proc = new RadiometricProcessor('generic', 16, 16);
    proc.setProfile({ gamma: 2.4 });
    expect(proc.getProfile().gamma).toBe(2.4);
  });
});
