/**
 * Estadísticas incrementales en O(1) — Welford online variance.
 * Sin asignaciones en update(); TypedArrays opcionales para buffers fijos.
 */
export class RunningStats {
  private n = 0;
  private mean = 0;
  private m2 = 0;

  reset(): void {
    this.n = 0;
    this.mean = 0;
    this.m2 = 0;
  }

  push(x: number): void {
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    const d2 = x - this.mean;
    this.m2 += d * d2;
  }

  get count(): number {
    return this.n;
  }

  getMean(): number {
    return this.mean;
  }

  getVariance(): number {
    return this.n > 1 ? this.m2 / (this.n - 1) : 0;
  }

  getStd(): number {
    return Math.sqrt(this.getVariance());
  }
}

/** Media móvil exponencial escalar sin alloc */
export function emaUpdate(prev: number, x: number, alpha: number): number {
  return prev + (x - prev) * alpha;
}
