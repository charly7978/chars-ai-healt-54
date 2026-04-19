import { describe, it, expect } from 'vitest';
import { Kalman1D } from '../Kalman1D';

describe('Kalman1D', () => {
  it('initializes from the first measurement', () => {
    const k = new Kalman1D();
    expect(k.isInitialized()).toBe(false);
    k.update(72);
    expect(k.isInitialized()).toBe(true);
    expect(k.state()).toBe(72);
  });

  it('converges to the truth on a series of noiseless measurements', () => {
    const k = new Kalman1D(0.1, 1);
    for (let i = 0; i < 50; i++) k.update(80);
    expect(k.state()).toBeCloseTo(80, 1);
  });

  it('reduces variance when fed with low R (high trust) measurements', () => {
    const k = new Kalman1D(0.5, 4);
    k.update(70);
    const initialVariance = k.variance();
    for (let i = 0; i < 20; i++) k.update(70, 0.5);
    expect(k.variance()).toBeLessThan(initialVariance);
  });

  it('higher R makes the filter trust the prior state more', () => {
    const a = new Kalman1D(0.1, 1);
    const b = new Kalman1D(0.1, 1);
    a.update(70); b.update(70);
    a.update(80, 0.1); // very low R → trust new measurement
    b.update(80, 100); // very high R → ignore new measurement
    expect(Math.abs(a.state() - 80)).toBeLessThan(Math.abs(b.state() - 80));
  });

  it('reset clears state', () => {
    const k = new Kalman1D();
    k.update(70);
    k.reset();
    expect(k.isInitialized()).toBe(false);
    expect(k.state()).toBe(0);
  });
});
