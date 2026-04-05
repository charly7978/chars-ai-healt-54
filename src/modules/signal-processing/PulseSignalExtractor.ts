/**
 * Extracción de pulso rPPG con POS + CHROM (normalización temporal).
 *
 * POS (Wang et al., 2017): tras normalizar por media temporal, (G̃ − B̃) refuerza la componente pulsátil.
 * CHROM (De Haan & Jeanne, 2013): Xs = 3R̃ − 2G̃.
 *
 * Referencias: Wang et al. IEEE TBME 2017; De Haan & Jeanne IEEE TBME 2013.
 */

const EPS = 1e-4;

export interface PulseBlendResult {
  rawPulse: number;
  posWeight: number;
}

export function computeTemporalNormalizedPulse(
  r: number,
  g: number,
  b: number,
  rWindow: number[],
  gWindow: number[],
  bWindow: number[],
  windowLen: number = 90
): PulseBlendResult | null {
  const n = rWindow.length;
  const minSamples = 28;
  if (n < minSamples) return null;

  const win = Math.min(windowLen, n);
  const rs = rWindow.slice(-win);
  const gs = gWindow.slice(-win);
  const bs = bWindow.slice(-win);

  const mean = (arr: number[]) => arr.reduce((a, v) => a + v, 0) / arr.length;
  const mr = mean(rs) + EPS;
  const mg = mean(gs) + EPS;
  const mb = mean(bs) + EPS;

  const Rn = r / mr;
  const Gn = g / mg;
  const Bn = b / mb;

  const pos = Gn - Bn;
  const chromX = 3 * Rn - 2 * Gn;
  const chromY = 1.5 * Rn + Gn - 1.5 * Bn;

  const posWeight = 0.58;
  const rawPulse = posWeight * pos + (1 - posWeight) * chromX + 0.1 * chromY;

  return { rawPulse, posWeight };
}
