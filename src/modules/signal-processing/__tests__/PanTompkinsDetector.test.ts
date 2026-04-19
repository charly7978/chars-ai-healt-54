import { describe, it, expect } from 'vitest';
import { PanTompkinsDetector } from '../PanTompkinsDetector';
import { generateSyntheticPPG } from '../../../__tests__/utils/golden-signals';
import { BandpassFilter } from '../BandpassFilter';

describe('PanTompkinsDetector', () => {
  it('detects ~10 beats over a 10s 60bpm golden PPG', () => {
    const fs = 30;
    const det = new PanTompkinsDetector({ sampleRate: fs });
    const filt = new BandpassFilter(fs);
    const sig = generateSyntheticPPG({ durationSec: 10, sampleRate: fs, bpm: 60, amplitude: 8 });
    let beats = 0;
    for (let i = 0; i < sig.length; i++) {
      const tick = det.push(filt.filter(sig[i]));
      if (tick.isPeak) beats++;
    }
    expect(beats).toBeGreaterThanOrEqual(7);
    expect(beats).toBeLessThanOrEqual(13);
  });

  it('refractory blocks back-to-back peaks within 280 ms', () => {
    const fs = 30;
    const det = new PanTompkinsDetector({ sampleRate: fs, refractoryMs: 280 });
    let lastPeakIdx = -Infinity;
    for (let i = 0; i < 600; i++) {
      // Inject a series of identical large impulses every 5 samples (~167 ms).
      const x = i % 5 === 0 ? 100 : 0;
      const tick = det.push(x);
      if (tick.isPeak) {
        const dt = (i - lastPeakIdx) * 1000 / fs;
        if (lastPeakIdx > -Infinity) expect(dt).toBeGreaterThanOrEqual(279);
        lastPeakIdx = i;
      }
    }
  });

  it('reset clears state', () => {
    const det = new PanTompkinsDetector({ sampleRate: 30 });
    for (let i = 0; i < 100; i++) det.push(Math.sin(i * 0.5));
    det.reset();
    const t = det.push(0);
    expect(t.isPeak).toBe(false);
    expect(t.signalThreshold).toBe(0);
  });
});
