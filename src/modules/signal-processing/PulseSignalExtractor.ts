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
  const mr = mean(rs) + EPS;
  const mg = mean(gs) + EPS;
  const mb = mean(bs) + EPS;

  const Rn = r / mr;
  const Gn = g / mg;
  const Bn = b / mb;

  // POS: proyecto la señal en el plano ortogonal a la componente de iluminación
  // S1 = Gn - Bn (componente pulsátil dominante)
  // S2 = Gn + Bn - 2*Rn (eje ortogonal)
  const S1 = Gn - Bn;
  const S2 = Gn + Bn - 2 * Rn;

  // CHROM simplificado
  const chromX = 3 * Rn - 2 * Gn;

  // Fusión adaptativa: POS domina, CHROM complementa
  // La señal POS es más robusta bajo iluminación variable
  const rawPulse = (S1 * 0.65 + chromX * 0.25 + S2 * 0.10) * PULSE_SCALE;

  return { rawPulse, posWeight: 0.65 };
}
