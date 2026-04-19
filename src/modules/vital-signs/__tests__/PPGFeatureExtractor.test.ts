import { describe, it, expect } from 'vitest';
import { PPGFeatureExtractor } from '../PPGFeatureExtractor';
import { generateSyntheticPPG } from '../../../__tests__/utils/golden-signals';

describe('PPGFeatureExtractor', () => {
  it('detects cardiac cycles on a clean 60 BPM golden signal (sr=30)', () => {
    const sig = Array.from(
      generateSyntheticPPG({ durationSec: 8, sampleRate: 30, bpm: 60, amplitude: 8, dicroticDepth: 0.4 })
    );
    const cycles = PPGFeatureExtractor.detectCardiacCycles(sig, 30);
    // Expect ≥5 valid cycles in 8s at 60bpm. Upper bound is loose
    // because the dicrotic notch can occasionally be flagged as a valley
    // (it is rejected by cycle-length validation when too short).
    expect(cycles.length).toBeGreaterThanOrEqual(5);
    expect(cycles.length).toBeLessThanOrEqual(16);
  });

  it('extracts plausible cycle features (sutMs in physiological range)', () => {
    const sig = Array.from(
      generateSyntheticPPG({ durationSec: 8, sampleRate: 30, bpm: 72, amplitude: 6, dicroticDepth: 0.35 })
    );
    const cycles = PPGFeatureExtractor.detectCardiacCycles(sig, 30);
    expect(cycles.length).toBeGreaterThan(2);
    const features = PPGFeatureExtractor.extractCycleFeatures(sig, cycles[Math.floor(cycles.length / 2)], 30);
    expect(features).not.toBeNull();
    expect(features!.sutMs).toBeGreaterThan(40);
    expect(features!.sutMs).toBeLessThan(500);
    expect(features!.systolicAmplitude).toBeGreaterThan(0);
    expect(features!.areaRatio).toBeGreaterThanOrEqual(0);
  });

  it('extractRRVariability computes SDNN and RMSSD correctly on known input', () => {
    const rr = [800, 820, 790, 810, 800, 805, 795];
    const stats = PPGFeatureExtractor.extractRRVariability(rr);
    expect(stats.sdnn).toBeGreaterThan(0);
    expect(stats.sdnn).toBeLessThan(20);
    expect(stats.rmssd).toBeGreaterThan(0);
    expect(stats.cv).toBeGreaterThan(0);
  });

  it('extractRRVariability rejects out-of-range intervals', () => {
    const rr = [100, 60000, 800, 820];
    const stats = PPGFeatureExtractor.extractRRVariability(rr);
    // Only 800, 820 are valid → SDNN = std([800,820]) = 10
    expect(stats.sdnn).toBeGreaterThan(0);
    expect(stats.sdnn).toBeLessThan(20);
  });

  it('extractACDCRatio has DC > 0 for a baseline-offset signal', () => {
    const sig = Array.from(
      generateSyntheticPPG({ durationSec: 4, sampleRate: 30, bpm: 60, amplitude: 5, baseline: 100 })
    );
    const r = PPGFeatureExtractor.extractACDCRatio(sig);
    expect(r.dc).toBeGreaterThan(50);
    expect(r.ac).toBeGreaterThan(0);
    expect(r.ratio).toBeGreaterThan(0);
  });
});
