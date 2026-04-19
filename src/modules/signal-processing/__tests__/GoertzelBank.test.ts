import { describe, it, expect } from 'vitest';
import { GoertzelBank } from '../GoertzelBank';

describe('GoertzelBank', () => {
  it('finds the dominant frequency of a clean sinusoid', () => {
    const fs = 30;
    const targetHz = 1.5;
    const bank = GoertzelBank.cardiac(fs, 256);
    let completed = false;
    for (let i = 0; i < 256; i++) {
      const x = Math.sin(2 * Math.PI * targetHz * (i / fs));
      if (bank.push(x)) completed = true;
    }
    expect(completed).toBe(true);
    const best = bank.bestBin();
    expect(Math.abs(best.freqHz - targetHz)).toBeLessThan(0.1);
    expect(best.power).toBeGreaterThan(0);
  });

  it('bestBpmInRange respects the requested bpm range', () => {
    const fs = 30;
    const bank = GoertzelBank.cardiac(fs, 256);
    // Inject 1.0 Hz (60 bpm) signal
    for (let i = 0; i < 256; i++) bank.push(Math.sin(2 * Math.PI * 1.0 * (i / fs)));
    const inBand = bank.bestBpmInRange(40, 200);
    expect(inBand.bpm).toBeGreaterThan(50);
    expect(inBand.bpm).toBeLessThan(72);
    const empty = bank.bestBpmInRange(180, 200);
    // Above 3.0 Hz fundamental is far enough that no harmonic appears in the
    // bank for a 1.0 Hz pure tone in our default cardiac grid.
    expect(empty.power).toBeLessThan(inBand.power);
  });

  it('reset clears internal state', () => {
    const bank = GoertzelBank.cardiac(30, 64);
    for (let i = 0; i < 64; i++) bank.push(Math.sin(i * 0.5));
    bank.reset();
    const ok = bank.push(0);
    expect(ok).toBe(false); // window restarted, won't complete on first sample
    expect(bank.bestBin().power).toBe(0);
  });

  it('setSampleRate recomputes coefficients', () => {
    const bank = new GoertzelBank(30, [1, 2, 3], 16);
    bank.setSampleRate(45);
    // Push enough samples for a window
    for (let i = 0; i < 16; i++) bank.push(Math.sin(2 * Math.PI * 2 * (i / 45)));
    const best = bank.bestBin();
    expect(best.power).toBeGreaterThan(0);
  });
});
