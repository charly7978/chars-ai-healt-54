import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../RingBuffer';

describe('RingBuffer', () => {
  it('preserves push order until capacity', () => {
    const rb = new RingBuffer(5);
    [1, 2, 3, 4, 5].forEach(v => rb.push(v));
    expect(rb.length).toBe(5);
    expect(rb.get(0)).toBe(1);
    expect(rb.get(4)).toBe(5);
    expect(rb.latest()).toBe(5);
  });

  it('wraps around when capacity exceeded', () => {
    const rb = new RingBuffer(3);
    [1, 2, 3, 4, 5].forEach(v => rb.push(v));
    expect(rb.length).toBe(3);
    expect(rb.get(0)).toBe(3);
    expect(rb.get(2)).toBe(5);
    expect(rb.latest()).toBe(5);
  });

  it('mean over last N is correct', () => {
    const rb = new RingBuffer(10);
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(v => rb.push(v));
    expect(rb.mean(5)).toBe(8); // mean of 6..10
    expect(rb.mean(10)).toBe(5.5);
  });

  it('variance is non-negative and zero for constants', () => {
    const rb = new RingBuffer(8);
    for (let i = 0; i < 8; i++) rb.push(7);
    expect(rb.variance()).toBe(0);

    const rb2 = new RingBuffer(8);
    [1, 2, 3, 4, 5, 6, 7, 8].forEach(v => rb2.push(v));
    expect(rb2.variance()).toBeCloseTo(5.25, 2);
  });

  it('minMax returns true extremes', () => {
    const rb = new RingBuffer(6);
    [-3, 5, 0, 8, -1, 2].forEach(v => rb.push(v));
    const { min, max } = rb.minMax();
    expect(min).toBe(-3);
    expect(max).toBe(8);
  });

  it('percentile is monotone', () => {
    const rb = new RingBuffer(20);
    for (let i = 1; i <= 20; i++) rb.push(i);
    const p10 = rb.percentile(0.1);
    const p50 = rb.percentile(0.5);
    const p90 = rb.percentile(0.9);
    expect(p10).toBeLessThan(p50);
    expect(p50).toBeLessThan(p90);
  });

  it('autocorrelation peaks near 1 for a perfectly periodic signal', () => {
    const rb = new RingBuffer(120);
    const period = 12;
    for (let i = 0; i < 120; i++) rb.push(Math.sin((2 * Math.PI * i) / period));
    const ac = rb.autocorrelation(period);
    expect(ac).toBeGreaterThan(0.9);
  });

  it('clear resets length to zero', () => {
    const rb = new RingBuffer(4);
    rb.push(1); rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.get(0)).toBe(0);
  });
});
