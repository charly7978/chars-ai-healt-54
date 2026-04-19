import { describe, it, expect } from 'vitest';
import { RhythmClassifierV2 } from '../RhythmClassifierV2';
import { generateSyntheticRR } from '../../../__tests__/utils/golden-signals';

function buildBeats(rrMs: number[], beatSQI = 0.7): any[] {
  return rrMs.map((rr, i) => ({
    ibiMs: rr,
    beatSQI,
    morphologyScore: 0.7,
    detectorAgreement: 0.7,
    amplitude: 1.0,
    flags: { isWeak: false, isPremature: false, isSuspicious: false, isDoublePeak: false },
  }));
}

describe('RhythmClassifierV2 — Phase 14 morphology + Poincaré 3D', () => {
  it('does not break when morphology arrays are absent (back-compat)', () => {
    const cls = new RhythmClassifierV2();
    const rr = generateSyntheticRR(12, 70, 'regular');
    const beats = buildBeats(rr);
    const r = cls.classify(beats, 0.6, 0.6);
    expect(r.rhythmLabel).toBeDefined();
  });

  it('amplifies AF evidence when amplitude CV + Poincaré 3D dispersion are large', () => {
    const cls = new RhythmClassifierV2();
    // Highly variable RR (AF-like)
    const rr = generateSyntheticRR(40, 80, 'variable', { jitterMs: 200 });
    const beats = buildBeats(rr);
    // Inject highly variable amplitudes (CV ≈ 0.45) and widths (CV ≈ 0.20)
    const amps = Array.from({ length: 10 }, (_, i) => 1 + (i % 3) * 0.6);
    const widths = Array.from({ length: 10 }, (_, i) => 200 + (i % 4) * 60);
    const notches = Array.from({ length: 10 }, (_, i) => 0.2 + (i % 3) * 0.18);
    const r = cls.classify(beats, 0.7, 0.7, amps, widths, notches);
    // afEvidence (Phase 14 boost) should be > 0.4 with such input
    expect(r.evidence.afEvidence).toBeGreaterThan(0.4);
  });

  it('keeps regular sinus → low AF evidence with stable morphology', () => {
    const cls = new RhythmClassifierV2();
    const rr = generateSyntheticRR(20, 70, 'regular');
    const beats = buildBeats(rr);
    const stableAmps = new Array(15).fill(1.0);
    const stableWidths = new Array(15).fill(280);
    const stableNotches = new Array(15).fill(0.4);
    const r = cls.classify(beats, 0.8, 0.8, stableAmps, stableWidths, stableNotches);
    expect(r.evidence.afEvidence).toBeLessThan(0.5);
    expect(['sinus_regular', 'sinus_variable', 'irregular_undetermined']).toContain(r.rhythmLabel);
  });

  it('Poincaré 3D dispersion grows with RR variability', () => {
    // Internal helper indirectly: use evidence on different inputs
    const cls = new RhythmClassifierV2();
    const stableBeats = buildBeats(generateSyntheticRR(24, 70, 'regular'));
    const wildBeats = buildBeats(generateSyntheticRR(24, 70, 'variable', { jitterMs: 250 }));
    const stable = cls.classify(stableBeats, 0.8, 0.8).evidence.afEvidence;
    const wild = cls.classify(wildBeats, 0.8, 0.8).evidence.afEvidence;
    expect(wild).toBeGreaterThanOrEqual(stable);
  });
});
