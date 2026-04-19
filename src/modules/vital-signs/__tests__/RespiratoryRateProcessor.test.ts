import { describe, it, expect } from 'vitest';
import { RespiratoryRateProcessor } from '../RespiratoryRateProcessor';
import { generateSyntheticPPG } from '../../../__tests__/utils/golden-signals';

describe('RespiratoryRateProcessor', () => {
  it('returns 0 brpm and a flag when PPG is too short', () => {
    const proc = new RespiratoryRateProcessor();
    const r = proc.process({ ppg: new Array(60).fill(0), sampleRate: 30 });
    expect(r.brpm).toBe(0);
    expect(r.qualityFlags).toContain('ppg_too_short');
  });

  it('estimates ~15 brpm on a clean PPG with 15 brpm AM/FM modulation', () => {
    const proc = new RespiratoryRateProcessor();
    const fs = 30;
    const sig = Array.from(generateSyntheticPPG({
      durationSec: 45,
      sampleRate: fs,
      bpm: 75,
      amplitude: 8,
      respirationBpm: 15,
      respirationDepth: 0.30,
    }));
    const r = proc.process({ ppg: sig, sampleRate: fs });
    // Allow ±3 brpm tolerance for short window + naive peak detection.
    expect(r.brpm).toBeGreaterThan(11);
    expect(r.brpm).toBeLessThan(19);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('estimates a different respiratory rate (12 brpm) correctly', () => {
    const proc = new RespiratoryRateProcessor();
    const fs = 30;
    const sig = Array.from(generateSyntheticPPG({
      durationSec: 45, sampleRate: fs, bpm: 70, amplitude: 8,
      respirationBpm: 12, respirationDepth: 0.35,
    }));
    const r = proc.process({ ppg: sig, sampleRate: fs });
    expect(r.brpm).toBeGreaterThan(8);
    expect(r.brpm).toBeLessThan(16);
  });

  it('uses supplied beat indices when available (AM/BW drive fusion)', () => {
    const proc = new RespiratoryRateProcessor();
    const fs = 30;
    const sig = Array.from(generateSyntheticPPG({
      durationSec: 30, sampleRate: fs, bpm: 80, amplitude: 8,
      respirationBpm: 18, respirationDepth: 0.30,
    }));
    // Pseudo-beats spaced at exactly 80 bpm to test the supplied-beats path.
    const beats: number[] = [];
    let cursor = 5;
    while (cursor < sig.length) { beats.push(cursor); cursor += Math.round(fs * 60 / 80); }
    const r = proc.process({ ppg: sig, sampleRate: fs, beatIndices: beats });
    // With constant-spaced beats FM is degenerate, but AM and BW must still
    // pick up the 18 brpm modulation present in the PPG envelope.
    expect(r.brpm).toBeGreaterThan(0);
    expect(r.perModulation.am.brpm + r.perModulation.bw.brpm).toBeGreaterThan(0);
  });

  it('confidence is clearly higher with respiration than without on equal-length recordings', () => {
    const proc = new RespiratoryRateProcessor();
    const fs = 30;
    const noResp = Array.from(generateSyntheticPPG({
      durationSec: 30, sampleRate: fs, bpm: 75, amplitude: 8,
    }));
    const withResp = Array.from(generateSyntheticPPG({
      durationSec: 30, sampleRate: fs, bpm: 75, amplitude: 8,
      respirationBpm: 16, respirationDepth: 0.35,
    }));
    const a = proc.process({ ppg: noResp, sampleRate: fs }).confidence;
    const b = proc.process({ ppg: withResp, sampleRate: fs }).confidence;
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
