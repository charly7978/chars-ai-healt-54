import { describe, it, expect } from 'vitest';
import { SignalSourceRanker } from '../SignalSourceRanker';

describe('SignalSourceRanker', () => {
  it('initializes with default activeSource RG', () => {
    const r = new SignalSourceRanker();
    expect(r.getActiveSource()).toBe('RG');
  });

  it('produces a value, label and SQI map after enough frames', () => {
    const r = new SignalSourceRanker();
    let last;
    for (let i = 0; i < 100; i++) {
      // Synthetic AC + DC: red oscillates, baseline 200, green 100, blue 80
      const t = i / 30;
      const cardiac = Math.sin(2 * Math.PI * 1.2 * t);
      const rawR = 200 - 2 * cardiac;
      const rawG = 100 - 4 * cardiac;
      const rawB = 80 - 0.5 * cardiac;
      last = r.update(rawR, rawG, rawB, 200, 100, 80, 0.02, 0.04, 0, false, 0, 0);
    }
    expect(last).toBeDefined();
    expect(typeof last!.value === 'number').toBe(true);
    expect(typeof last!.label === 'string').toBe(true);
    expect(Object.keys(last!.allSQI).length).toBeGreaterThan(0);
  });

  it('reset returns active source to RG and clears state', () => {
    const r = new SignalSourceRanker();
    for (let i = 0; i < 60; i++) r.update(200, 100, 80, 200, 100, 80, 0.02, 0.04, 0, false);
    r.reset();
    expect(r.getActiveSource()).toBe('RG');
  });
});
