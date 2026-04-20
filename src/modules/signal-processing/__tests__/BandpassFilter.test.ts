import { describe, it, expect } from 'vitest';
import { BandpassFilter } from '../BandpassFilter';
import { rms } from '../../../utils/mathUtils';

describe('BandpassFilter', () => {
  it('passes a 1 Hz sinusoid (in band) with significant energy', () => {
    const fs = 30;
    const filt = new BandpassFilter(fs);
    const N = fs * 12;
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      const x = Math.sin(2 * Math.PI * 1.0 * (i / fs));
      out.push(filt.filter(x));
    }
    // Discard initial transient; expect non-trivial RMS.
    const tail = out.slice(out.length - 120);
    expect(rms(tail)).toBeGreaterThan(0.2);
  });

  it('attenuates a slow drift (0.05 Hz) far below 1 Hz energy', () => {
    const fs = 30;
    const filtSlow = new BandpassFilter(fs);
    const filtFast = new BandpassFilter(fs);
    const N = fs * 30;
    const slow: number[] = [], fast: number[] = [];
    for (let i = 0; i < N; i++) {
      slow.push(filtSlow.filter(Math.sin(2 * Math.PI * 0.05 * (i / fs))));
      fast.push(filtFast.filter(Math.sin(2 * Math.PI * 1.0 * (i / fs))));
    }
    const tailSlow = slow.slice(-120);
    const tailFast = fast.slice(-120);
    expect(rms(tailSlow)).toBeLessThan(rms(tailFast) * 0.3);
  });

  it('attenuates a high-frequency tone (10 Hz) below cardiac band', () => {
    const fs = 30;
    const filtHigh = new BandpassFilter(fs);
    const filtMid = new BandpassFilter(fs);
    const N = fs * 10;
    const high: number[] = [], mid: number[] = [];
    for (let i = 0; i < N; i++) {
      high.push(filtHigh.filter(Math.sin(2 * Math.PI * 10.0 * (i / fs))));
      mid.push(filtMid.filter(Math.sin(2 * Math.PI * 1.5 * (i / fs))));
    }
    expect(rms(high.slice(-120))).toBeLessThan(rms(mid.slice(-120)) * 0.7);
  });

  it('reset clears state', () => {
    const fs = 30;
    const f = new BandpassFilter(fs);
    for (let i = 0; i < 100; i++) f.filter(Math.sin(i * 0.5));
    f.reset();
    // After reset, first sample should be 0 (detrend baseline reinit).
    const v = f.filter(0.5);
    expect(v).toBeCloseTo(0, 5);
  });

  it('detrend removes constant DC', () => {
    const f = new BandpassFilter(30);
    for (let i = 0; i < 200; i++) f.detrend(100);
    // After convergence detrend(100) should be ~0
    const v = f.detrend(100);
    expect(Math.abs(v)).toBeLessThan(0.01);
  });
});
