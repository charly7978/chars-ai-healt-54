import { describe, it, expect } from 'vitest';
import { TileFusionEngine } from '../TileFusionEngine';

const tile = (r: number, g: number, b: number, q = 0.7, c = 0.8, t = 0.9, idx = 0) =>
  ({ r, g, b, quality: q, coverage: c, temporalConfidence: t, tileIndex: idx });

describe('TileFusionEngine', () => {
  it('returns the empty result for an empty tile array', () => {
    const fe = new TileFusionEngine();
    const r = fe.fuse([]);
    expect(r.fusedQuality).toBe(0);
    expect(r.fusedR).toBe(128);
    expect(r.spatialUniformity).toBe(0);
  });

  it('fuses a uniform set with high quality and outputs near the mean', () => {
    const fe = new TileFusionEngine();
    const tiles = Array.from({ length: 10 }, (_, i) => tile(180, 90, 70, 0.8, 0.9, 0.9, i));
    let r;
    // Run enough times so the temporal EMA (alpha=0.15) settles around the mean
    for (let k = 0; k < 60; k++) r = fe.fuse(tiles);
    expect(Math.abs(r!.fusedR - 180)).toBeLessThan(15);
    expect(Math.abs(r!.fusedG - 90)).toBeLessThan(15);
    expect(r!.fusedQuality).toBeGreaterThan(0.4);
    expect(r!.spatialUniformity).toBeGreaterThan(0.5);
  });

  it('downweights an outlier tile via Huber + trimmed mean', () => {
    const fe = new TileFusionEngine();
    const tiles = [
      tile(180, 90, 70, 0.8), tile(182, 92, 71, 0.8), tile(178, 88, 69, 0.8),
      tile(181, 91, 72, 0.8), tile(179, 89, 70, 0.8),
      tile(20, 250, 250, 0.05), // garbage outlier with very low quality
    ];
    let r;
    for (let k = 0; k < 60; k++) r = fe.fuse(tiles);
    // The outlier should be heavily downweighted → fused R close to 180
    expect(r!.fusedR).toBeGreaterThan(150);
    expect(r!.fusedR).toBeLessThan(210);
  });

  it('returns top-K tiles ordered by quality', () => {
    const fe = new TileFusionEngine();
    const tiles = [
      tile(100, 50, 40, 0.2, 0.5, 0.5, 0),
      tile(180, 90, 70, 0.95, 0.9, 0.9, 1),
      tile(160, 80, 60, 0.7, 0.8, 0.8, 2),
      tile(120, 60, 50, 0.4, 0.6, 0.6, 3),
    ];
    const r = fe.fuse(tiles);
    expect(r.topTiles.length).toBeLessThanOrEqual(3);
    if (r.topTiles.length >= 2) {
      expect(r.topTiles[0].quality).toBeGreaterThanOrEqual(r.topTiles[1].quality);
    }
  });
});
