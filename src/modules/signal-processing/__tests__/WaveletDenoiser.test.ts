import { describe, it, expect } from 'vitest';
import { waveletDenoise } from '../WaveletDenoiser';
import { rms } from '../../../utils/mathUtils';

describe('waveletDenoise (db4)', () => {
  it('returns an array of the same length', () => {
    const x = Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.1));
    const y = waveletDenoise(x, 4);
    expect(y.length).toBe(x.length);
  });

  it('preserves a clean low-frequency signal (no over-thresholding)', () => {
    const N = 256;
    const clean: number[] = new Array(N);
    for (let i = 0; i < N; i++) clean[i] = Math.sin(i * 0.1);
    const denoised = waveletDenoise(clean, 4);
    // Should preserve the slow component well — RMSE ≤ 30% of signal RMS
    const errRMS = rms(denoised.map((v, i) => v - clean[i]));
    const sigRMS = rms(clean);
    expect(errRMS / sigRMS).toBeLessThan(0.3);
  });

  it('shrinks high-frequency noise added on top of zero baseline', () => {
    const N = 256;
    // Pure deterministic broadband-like noise; no slow component.
    const noiseFreqs = [1.7, 2.31, 2.93, 1.13, 2.57, 1.93, 2.79];
    const noise: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      let n = 0;
      for (const f of noiseFreqs) n += Math.sin(i * f + f);
      noise[i] = 0.4 * n / noiseFreqs.length;
    }
    const denoised = waveletDenoise(noise, 4);
    const before = rms(noise);
    const after = rms(denoised);
    expect(after).toBeLessThanOrEqual(before);
  });

  it('handles short signals via zero-padding without crashing', () => {
    const out = waveletDenoise([1, 2, 3, 4, 5], 4);
    expect(out.length).toBe(5);
    expect(out.every(v => isFinite(v))).toBe(true);
  });

  it('returns empty array on empty input', () => {
    expect(waveletDenoise([])).toEqual([]);
  });
});
