
// SG simplificado (estimador de suavizado). Mantenemos ventana impar.
export function savitzkyGolay(values: number[], windowSize = 9): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (windowSize % 2 === 0) windowSize += 1;
  if (windowSize < 3) windowSize = 3;
  const half = Math.floor(windowSize / 2);
  const coeffs = new Array(windowSize).fill(1 / windowSize);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0, w = 0;
    for (let k = -half; k <= half; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= n) continue;
      const c = coeffs[k + half];
      acc += values[idx] * c;
      w += c;
    }
    out[i] = w ? acc / w : values[i];
  }
  return out;
}
