import { describe, it, expect } from 'vitest';
import { HeartBeatProcessor } from '../HeartBeatProcessor';
import { BandpassFilter } from '../signal-processing/BandpassFilter';
import { generateSyntheticPPG } from '../../__tests__/utils/golden-signals';

describe('HeartBeatProcessor', () => {
  it('estimates BPM within ±5 of a 72 BPM golden signal', () => {
    const fs = 30;
    const proc = new HeartBeatProcessor();
    const filt = new BandpassFilter(fs);
    const sig = generateSyntheticPPG({
      durationSec: 16,
      sampleRate: fs,
      bpm: 72,
      amplitude: 8,
      dicroticDepth: 0.4,
      baseline: 100,
    });

    let lastBpm = 0;
    for (let i = 0; i < sig.length; i++) {
      const filtered = filt.filter(sig[i]);
      const ts = (i / fs) * 1000;
      const r = proc.processSignal(filtered, ts, {
        contactState: 'STABLE_CONTACT',
        quality: 80,
        clipHigh: 0,
        clipLow: 0,
      });
      if (r.bpm > 0) lastBpm = r.bpm;
    }
    expect(lastBpm).toBeGreaterThan(60);
    expect(lastBpm).toBeLessThan(85);
  });

  it('reports low confidence when signal is flat', () => {
    const proc = new HeartBeatProcessor();
    let lastResult;
    for (let i = 0; i < 200; i++) {
      lastResult = proc.processSignal(0, i * 33, { contactState: 'STABLE_CONTACT', quality: 0 });
    }
    expect(lastResult!.bpmConfidence).toBe(0);
    expect(lastResult!.isPeak).toBe(false);
  });

  it('produces non-empty rrIntervals after several real beats', () => {
    const fs = 30;
    const proc = new HeartBeatProcessor();
    const filt = new BandpassFilter(fs);
    const sig = generateSyntheticPPG({ durationSec: 12, sampleRate: fs, bpm: 80, amplitude: 8 });
    for (let i = 0; i < sig.length; i++) {
      const filtered = filt.filter(sig[i]);
      proc.processSignal(filtered, (i / fs) * 1000, { contactState: 'STABLE_CONTACT', quality: 80 });
    }
    const intervals = proc.getRRIntervals();
    expect(intervals.length).toBeGreaterThan(3);
    intervals.forEach(rr => {
      expect(rr).toBeGreaterThan(300);
      expect(rr).toBeLessThan(1500);
    });
  });

  it('reset clears state', () => {
    const proc = new HeartBeatProcessor();
    proc.processSignal(10, 0, { contactState: 'STABLE_CONTACT' });
    proc.processSignal(20, 33, { contactState: 'STABLE_CONTACT' });
    proc.reset();
    expect(proc.getRRIntervals()).toEqual([]);
    expect(proc.getLastPeakTime()).toBe(0);
  });
});
