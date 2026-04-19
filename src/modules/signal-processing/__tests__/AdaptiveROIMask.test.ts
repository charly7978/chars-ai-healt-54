import { describe, it, expect } from 'vitest';
import { AdaptiveROIMask } from '../AdaptiveROIMask';
import { generateSyntheticImageData } from '../../../__tests__/utils/golden-signals';

describe('AdaptiveROIMask', () => {
  it('detects a red-dominant fingertip frame as covered', () => {
    const mask = new AdaptiveROIMask();
    let result;
    // Run several frames so temporal smoothing converges.
    for (let i = 0; i < 4; i++) {
      const img = generateSyntheticImageData(64, 48, {
        redMean: 200, greenMean: 90, blueMean: 70,
      });
      result = mask.process(img);
    }
    expect(result!.coverageRatio).toBeGreaterThan(0.4);
    expect(result!.fingerScore).toBeGreaterThan(0.3);
    expect(result!.rawRed).toBeGreaterThan(result!.rawGreen);
    expect(result!.rawRed).toBeGreaterThan(result!.rawBlue);
  });

  it('rejects a uniform dark frame as no contact', () => {
    const mask = new AdaptiveROIMask();
    let result;
    for (let i = 0; i < 4; i++) {
      const img = generateSyntheticImageData(64, 48, {
        redMean: 1, greenMean: 1, blueMean: 1,
      });
      result = mask.process(img);
    }
    expect(result!.coverageRatio).toBeLessThan(0.2);
    expect(result!.clipLowRatio).toBeGreaterThan(0.3);
  });

  it('flags saturation when frame is overexposed', () => {
    const mask = new AdaptiveROIMask();
    const img = generateSyntheticImageData(64, 48, {
      redMean: 254, greenMean: 254, blueMean: 254,
    });
    const result = mask.process(img);
    expect(result.clipHighRatio).toBeGreaterThan(0.5);
  });

  it('produces 49 tiles always', () => {
    const mask = new AdaptiveROIMask();
    const img = generateSyntheticImageData(56, 56);
    const result = mask.process(img);
    expect(result.tileScores.length).toBe(49);
    expect(result.tileData.length).toBe(49);
  });

  it('reset clears temporal state', () => {
    const mask = new AdaptiveROIMask();
    for (let i = 0; i < 5; i++) {
      mask.process(generateSyntheticImageData(56, 56, { redMean: 200 }));
    }
    mask.reset();
    const r = mask.process(generateSyntheticImageData(56, 56, { redMean: 5, greenMean: 5, blueMean: 5 }));
    expect(r.coverageRatio).toBeLessThan(0.5);
  });
});
