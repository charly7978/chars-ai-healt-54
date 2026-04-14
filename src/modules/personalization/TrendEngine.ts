/**
 * Tendencias simples sobre series recientes (sin inventar valores absolutos).
 */

export type TrendLabel = 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN';

export class TrendEngine {
  static fromSeries(values: number[], thresholdRatio = 0.04): TrendLabel {
    if (values.length < 4) return 'UNKNOWN';
    const a = values.slice(0, Math.floor(values.length / 2));
    const b = values.slice(Math.floor(values.length / 2));
    const ma = a.reduce((s, v) => s + v, 0) / a.length;
    const mb = b.reduce((s, v) => s + v, 0) / b.length;
    const mid = Math.max(1e-6, (ma + mb) / 2);
    const rel = (mb - ma) / mid;
    if (Math.abs(rel) < thresholdRatio) return 'STABLE';
    return rel > 0 ? 'RISING' : 'FALLING';
  }
}
