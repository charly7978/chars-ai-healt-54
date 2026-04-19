import { describe, it, expect } from 'vitest';
import { FingerContactClassifier } from '../FingerContactClassifier';
import { ContactState } from '../../../types/measurement';

const mkInput = (override: Partial<{
  meanR: number; meanG: number; meanB: number;
  clipHighRatio: number; clipLowRatio: number;
  roiCoverage: number; acSignal: number; dcSignal: number;
}> = {}) => {
  const meanR = override.meanR ?? 180;
  const meanG = override.meanG ?? 110;
  const meanB = override.meanB ?? 90;
  return {
    colorStatsRaw: {
      meanR, meanG, meanB,
      stdR: 6, stdG: 5, stdB: 5,
    },
    saturationStats: {
      clipHighRatio: override.clipHighRatio ?? 0.01,
      clipLowRatio: override.clipLowRatio ?? 0.02,
    },
    roiCoverage: override.roiCoverage ?? 0.7,
    imageWidth: 64,
    imageHeight: 48,
    data: new Uint8ClampedArray(64 * 48 * 4).fill(120),
    acSignal: override.acSignal ?? 2.0,
    dcSignal: override.dcSignal ?? 100,
  };
};

describe('FingerContactClassifier', () => {
  it('converges to STABLE on sustained high-quality contact', () => {
    const cls = new FingerContactClassifier();
    let state: ContactState = ContactState.NO_CONTACT;
    for (let i = 0; i < 8; i++) {
      state = cls.classify(mkInput()).state;
    }
    expect([ContactState.STABLE, ContactState.EXCESSIVE_PRESSURE]).toContain(state);
  });

  it('converges to NO_CONTACT when chroma/coverage are poor', () => {
    const cls = new FingerContactClassifier();
    let state: ContactState = ContactState.STABLE;
    for (let i = 0; i < 8; i++) {
      state = cls.classify(mkInput({
        meanR: 70, meanG: 85, meanB: 95, roiCoverage: 0.1, acSignal: 0.01, dcSignal: 80,
      })).state;
    }
    expect(state).toBe(ContactState.NO_CONTACT);
  });

  it('drops stability score when temporal drift rises', () => {
    const cls = new FingerContactClassifier();
    cls.classify(mkInput({ meanR: 180, meanG: 110, meanB: 90, roiCoverage: 0.7 }));
    const r2 = cls.classify(mkInput({ meanR: 90, meanG: 130, meanB: 120, roiCoverage: 0.25 }));
    expect(r2.evidence.stabilityScore).toBeLessThan(0.8);
  });

  it('marks pressureExcessive when DC is too high', () => {
    const cls = new FingerContactClassifier();
    const r = cls.classify(mkInput({ meanR: 250, meanG: 245, meanB: 240 }));
    expect(r.pressureExcessive).toBe(true);
  });
});

