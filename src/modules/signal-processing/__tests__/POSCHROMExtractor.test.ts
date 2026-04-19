import { describe, it, expect } from 'vitest';
import { POSExtractor } from '../POSExtractor';
import { CHROMExtractor } from '../CHROMExtractor';

/**
 * Helper: synthesize a simple RGB stream with cardiac AC + LED-flicker DC drift.
 */
function syntheticRGB(N: number, fs: number, hr = 1.2, flickerHz = 0): Array<{ r: number; g: number; b: number }> {
  const out: Array<{ r: number; g: number; b: number }> = [];
  for (let i = 0; i < N; i++) {
    const t = i / fs;
    // Cardiac modulation present strongest in green, weakest in blue
    const cardiac = Math.sin(2 * Math.PI * hr * t);
    const flicker = flickerHz > 0 ? Math.sin(2 * Math.PI * flickerHz * t) : 0;
    // DC flicker is COMMON to all three channels — POS/CHROM should suppress it
    const r = 200 + 1.0 * cardiac + 6 * flicker;
    const g = 90 + 4.0 * cardiac + 6 * flicker;
    const b = 70 + 0.5 * cardiac + 6 * flicker;
    out.push({ r, g, b });
  }
  return out;
}

function rms(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
}

describe('POSExtractor', () => {
  it('returns 0 until window is full', () => {
    const pos = new POSExtractor({ sampleRate: 30, windowSec: 1.6 });
    expect(pos.push(180, 100, 80)).toBe(0);
  });

  it('produces a non-trivial output once the window is full', () => {
    const pos = new POSExtractor({ sampleRate: 30, windowSec: 1.6 });
    const samples = syntheticRGB(120, 30, 1.2);
    let last = 0;
    for (const s of samples) last = pos.push(s.r, s.g, s.b);
    expect(Math.abs(last)).toBeGreaterThan(0);
  });

  it('attenuates common-mode (LED flicker) more than cardiac signal', () => {
    const fs = 30;
    const samplesNoFlicker = syntheticRGB(180, fs, 1.2, 0);
    const samplesFlicker = syntheticRGB(180, fs, 1.2, 6);

    const a = new POSExtractor({ sampleRate: fs, windowSec: 1.6 });
    const b = new POSExtractor({ sampleRate: fs, windowSec: 1.6 });
    const outNoF: number[] = [];
    const outF: number[] = [];
    for (const s of samplesNoFlicker) outNoF.push(a.push(s.r, s.g, s.b));
    for (const s of samplesFlicker) outF.push(b.push(s.r, s.g, s.b));

    // Drop initial transient
    const tailNoF = outNoF.slice(60);
    const tailF = outF.slice(60);
    // The two should remain comparable in magnitude (i.e. flicker is suppressed)
    const ratio = rms(tailF) / Math.max(1e-9, rms(tailNoF));
    expect(ratio).toBeLessThan(3); // would be much higher if flicker passed through
  });

  it('reset clears state', () => {
    const pos = new POSExtractor({ sampleRate: 30, windowSec: 1.6 });
    for (const s of syntheticRGB(120, 30, 1.2)) pos.push(s.r, s.g, s.b);
    pos.reset();
    expect(pos.push(180, 100, 80)).toBe(0);
  });
});

describe('CHROMExtractor', () => {
  it('returns 0 until window is full and produces non-zero output afterwards', () => {
    const ch = new CHROMExtractor({ sampleRate: 30, windowSec: 1.6 });
    expect(ch.push(180, 100, 80)).toBe(0);
    let last = 0;
    for (const s of syntheticRGB(120, 30, 1.2)) last = ch.push(s.r, s.g, s.b);
    expect(Math.abs(last)).toBeGreaterThan(0);
  });

  it('reset clears state', () => {
    const ch = new CHROMExtractor({ sampleRate: 30, windowSec: 1.6 });
    for (const s of syntheticRGB(120, 30, 1.2)) ch.push(s.r, s.g, s.b);
    ch.reset();
    expect(ch.push(200, 100, 80)).toBe(0);
  });
});
