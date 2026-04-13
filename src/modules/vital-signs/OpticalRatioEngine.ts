/**
 * Ratios ópticos AC/DC y R para SpO2 — funciones puras reutilizables por SpO2Processor.
 */

export function ratioOfRatios(redAC: number, redDC: number, greenAC: number, greenDC: number): number {
  if (redDC <= 0 || greenDC <= 0 || greenAC <= 0) return NaN;
  const rR = redAC / redDC;
  const rG = greenAC / greenDC;
  return rR / rG;
}

export function trimmedMedian(values: number[], trim = 0.1): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].filter((v) => isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const k = Math.floor(sorted.length * trim);
  const slice = sorted.slice(k, sorted.length - k || undefined);
  const m = slice.length ? slice : sorted;
  return m[Math.floor(m.length / 2)];
}
