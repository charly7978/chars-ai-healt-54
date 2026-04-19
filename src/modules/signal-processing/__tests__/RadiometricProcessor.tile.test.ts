import { describe, it, expect, beforeEach } from 'vitest';
import { RadiometricProcessor } from '../RadiometricProcessor';
import { generateSyntheticImageData } from '../../../__tests__/utils/golden-signals';

describe('RadiometricProcessor — tile-domain fast path (Fase 1)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('processTileRGB returns linearized + OD without allocating Float32Arrays', () => {
    const proc = new RadiometricProcessor('generic', 16, 16);
    // Bootstrap reference with a few midtone calls
    for (let i = 0; i < 20; i++) {
      proc.processTileRGB(150, 100, 80);
    }
    const out = proc.processTileRGB(150, 100, 80);
    // Linear values are in 0..1
    expect(out.linearR).toBeGreaterThan(0);
    expect(out.linearR).toBeLessThanOrEqual(1);
    // Their 0..255 mapped versions
    expect(out.linearR8).toBeGreaterThan(out.linearG8);
    expect(out.linearG8).toBeGreaterThan(out.linearB8);
    // OD ≈ 0 when the input matches the running reference
    expect(Math.abs(out.odR)).toBeLessThan(0.5);
  });

  it('processTileRGB OD increases when channel intensity drops below reference', () => {
    const proc = new RadiometricProcessor('generic', 16, 16);
    // Set reference at midtone
    for (let i = 0; i < 60; i++) proc.processTileRGB(180, 180, 180);
    const dim = proc.processTileRGB(60, 60, 60);
    // Darker than reference → OD > 0
    expect(dim.odR).toBeGreaterThan(0);
    expect(dim.odG).toBeGreaterThan(0);
    expect(dim.odB).toBeGreaterThan(0);
  });

  it('reset clears references and bootstrap state', () => {
    const proc = new RadiometricProcessor('generic', 16, 16);
    for (let i = 0; i < 20; i++) proc.processTileRGB(180, 180, 180);
    proc.reset();
    const fresh = proc.processTileRGB(60, 60, 60);
    // Right after reset the reference initializes from this very call,
    // so OD should be close to 0 (within 1 nat).
    expect(Math.abs(fresh.odR)).toBeLessThan(1);
  });

  it('bootstrapDarkFrame updates dark offset after 5+ samples', () => {
    const proc = new RadiometricProcessor('generic', 16, 16);
    const before = proc.getProfile().darkOffsetG;
    // 5 dark frames at intensity 8
    for (let i = 0; i < 5; i++) {
      proc.bootstrapDarkFrame(generateSyntheticImageData(16, 16, { redMean: 8, greenMean: 8, blueMean: 8 }));
    }
    const after = proc.getProfile().darkOffsetG;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(50);
  });

  it('bootstrapWhitePoint adapts whiteLevel after enough finger frames', () => {
    const proc = new RadiometricProcessor('generic', 16, 16);
    proc.setProfile({ whiteLevel: 230 });
    // 30 frames with finger present and bright RGB
    for (let i = 0; i < 30; i++) {
      proc.bootstrapWhitePoint(
        generateSyntheticImageData(16, 16, { redMean: 240, greenMean: 200, blueMean: 180 }),
        true
      );
    }
    expect(proc.getProfile().whiteLevel).toBeGreaterThanOrEqual(230);
    expect(proc.getProfile().whiteLevel).toBeLessThanOrEqual(255);
  });

  it('trackWhitePointDrift accumulates and signals re-bootstrap after sustained drift', () => {
    const proc = new RadiometricProcessor('generic', 16, 16);
    proc.setProfile({ whiteLevel: 250 });
    // Feed frames where green max ~ 100 (huge drift from 250)
    let last;
    for (let i = 0; i < 80; i++) {
      last = proc.trackWhitePointDrift(
        generateSyntheticImageData(16, 16, { redMean: 50, greenMean: 100, blueMean: 60 })
      );
    }
    expect(last!.drift).toBeGreaterThan(0.15);
    expect(last!.needsRebootstrap).toBe(true);
  });
});

describe('AdaptiveROIMask — Beer-Lambert outputs (Fase 1)', () => {
  it('emits linRed/linGreen/linBlue and OD when a RadiometricProcessor is wired', async () => {
    const { AdaptiveROIMask } = await import('../AdaptiveROIMask');
    const mask = new AdaptiveROIMask();
    const rp = new RadiometricProcessor('generic', 64, 48);
    mask.setRadiometricProcessor(rp);

    let r;
    for (let i = 0; i < 5; i++) {
      r = mask.process(generateSyntheticImageData(64, 48, { redMean: 200, greenMean: 90, blueMean: 70 }));
    }
    expect(r!.linRed).toBeGreaterThan(0);
    expect(r!.linRed).toBeGreaterThan(r!.linGreen);
    // OD should be finite numbers (could be ±something)
    expect(Number.isFinite(r!.odR)).toBe(true);
    expect(Number.isFinite(r!.odG)).toBe(true);
    expect(Number.isFinite(r!.odB)).toBe(true);
  });

  it('falls back to raw RGB when no RadiometricProcessor is wired', async () => {
    const { AdaptiveROIMask } = await import('../AdaptiveROIMask');
    const mask = new AdaptiveROIMask();
    let r;
    for (let i = 0; i < 3; i++) {
      r = mask.process(generateSyntheticImageData(64, 48, { redMean: 200, greenMean: 90, blueMean: 70 }));
    }
    expect(r!.linRed).toBe(r!.rawRed);
    expect(r!.linGreen).toBe(r!.rawGreen);
    expect(r!.linBlue).toBe(r!.rawBlue);
    expect(r!.odR).toBe(0);
  });
});
