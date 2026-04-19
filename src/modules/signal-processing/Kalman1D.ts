/**
 * SCALAR KALMAN FILTER for slowly-varying physiological values
 * (e.g. heart rate, respiratory rate, SpO2).
 *
 * Model:
 *   x_k = x_{k-1} + w_k     (random walk, w ~ N(0, Q))
 *   z_k = x_k + v_k         (measurement, v ~ N(0, R))
 *
 * Q (process variance) and R (measurement variance) can be adapted from
 * upstream signal quality. When SQI is high, R is small → trust new
 * measurements; when SQI is low, R is large → trust the prior state.
 */
export class Kalman1D {
  private x = 0;
  private p = 1; // posterior variance
  private initialized = false;
  private q: number;
  private rDefault: number;

  constructor(processVariance = 0.5, measurementVariance = 4) {
    this.q = processVariance;
    this.rDefault = measurementVariance;
  }

  /**
   * Update the state with a new measurement `z`. Optional `r` overrides the
   * default measurement variance (use higher r for noisier samples).
   */
  update(z: number, r?: number): number {
    if (!isFinite(z)) return this.x;
    if (!this.initialized) {
      this.x = z;
      this.p = 1;
      this.initialized = true;
      return this.x;
    }
    // Prediction
    const pPredicted = this.p + this.q;
    // Kalman gain
    const R = r !== undefined ? Math.max(1e-3, r) : this.rDefault;
    const k = pPredicted / (pPredicted + R);
    // Update
    this.x = this.x + k * (z - this.x);
    this.p = (1 - k) * pPredicted;
    return this.x;
  }

  state(): number { return this.x; }
  variance(): number { return this.p; }
  isInitialized(): boolean { return this.initialized; }

  setProcessVariance(q: number): void { this.q = Math.max(1e-6, q); }
  setMeasurementVariance(r: number): void { this.rDefault = Math.max(1e-3, r); }

  reset(): void { this.x = 0; this.p = 1; this.initialized = false; }
}
