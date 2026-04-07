/**
 * Extracción de pulso rPPG con POS + CHROM (normalización temporal).
 *
 * POS (Wang et al., 2017): tras normalizar por media temporal, (G̃ − B̃) refuerza la componente pulsátil.
 * CHROM (De Haan & Jeanne, 2013): Xs = 3R̃ − 2G̃.
 *
 * CORRECCIÓN CRÍTICA: la salida se escala a un rango comparable con el de los canales crudos (~0-255)
 * para que el filtro pasabanda y el detector de picos trabajen correctamente.
 *
 * Referencias: Wang et al. IEEE TBME 2017; De Haan & Jeanne IEEE TBME 2013.
 */

const EPS = 1e-6;

/** Factor de escala para llevar la señal normalizada (~0.001) al rango del pipeline (~1-50) */
const PULSE_SCALE = 2500;

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
  const mr = mean(rs);
  const mg = mean(gs);
  const mb = mean(bs);

  // ─── DC FLOOR GUARD ───
  // For contact PPG (finger + flash): Red is always bright, Green moderate,
  // Blue is strongly absorbed by hemoglobin and often < 80.
  // Only gate on R and G which are the channels POS/CHROM actually use.
  if (mr < 50 || mg < 30) return null;

  // ─── AC/DC CHECK ───
  // At least R or G must show pulsatile activity (AC/DC > 0.04%)
  const acdc = (arr: number[], dc: number) => {
    const max = Math.max(...arr);
    const min = Math.min(...arr);
    return dc > 0 ? ((max - min) / dc) * 100 : 0;
  };
  const acdcR = acdc(rs, mr);
  const acdcG = acdc(gs, mg);
  if (Math.max(acdcR, acdcG) < 0.04) return null;

  const Rn = r / (mr + EPS);
  const Gn = g / (mg + EPS);
  const Bn = b / (mb + EPS);

  // POS: project onto plane orthogonal to illumination
  const S1 = Gn - Bn;
  const S2 = Gn + Bn - 2 * Rn;

  // CHROM simplified
  const chromX = 3 * Rn - 2 * Gn;

  // Adaptive fusion: POS dominates, CHROM complements
  const rawPulse = (S1 * 0.65 + chromX * 0.25 + S2 * 0.10) * PULSE_SCALE;

  return { rawPulse, posWeight: 0.65 };
}
