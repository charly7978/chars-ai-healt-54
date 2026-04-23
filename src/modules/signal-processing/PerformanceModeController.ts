/**
 * QUALITY_FIRST | BALANCED | PERFORMANCE_FIRST según carga medida.
 */

export type PerformanceProfile = 'QUALITY_FIRST' | 'BALANCED' | 'PERFORMANCE_FIRST';

export interface PerformanceObservation {
  effectiveFps: number;
  processingTimeMs: number;
  workerQueueDepth: number;
  workerLatencyMs: number;
  droppedEstimate: number;
}

export class PerformanceModeController {
  private profile: PerformanceProfile = 'BALANCED';
  private lowFpsStreak = 0;
  private highProcStreak = 0;
  private healthyStreak = 0;

  getProfile(): PerformanceProfile {
    return this.profile;
  }

  observe(o: PerformanceObservation): void {
    const stressed =
      o.effectiveFps < 22 ||
      o.processingTimeMs > 38 ||
      o.workerQueueDepth > 2 ||
      o.workerLatencyMs > 45 ||
      o.droppedEstimate > 1.2;

    const healthy =
      o.effectiveFps > 26 &&
      o.processingTimeMs < 22 &&
      o.workerQueueDepth < 1 &&
      o.workerLatencyMs < 28 &&
      o.droppedEstimate < 0.45;

    if (stressed) {
      this.lowFpsStreak = Math.min(30, this.lowFpsStreak + 1);
      this.highProcStreak = Math.min(30, this.highProcStreak + 1);
      this.healthyStreak = 0;
    } else if (healthy) {
      this.healthyStreak = Math.min(60, this.healthyStreak + 1);
      this.lowFpsStreak = Math.max(0, this.lowFpsStreak - 1);
      this.highProcStreak = Math.max(0, this.highProcStreak - 1);
    } else {
      this.lowFpsStreak = Math.max(0, this.lowFpsStreak - 1);
      this.highProcStreak = Math.max(0, this.highProcStreak - 1);
    }

    if (this.profile === 'QUALITY_FIRST') {
      if (this.lowFpsStreak >= 12 || this.highProcStreak >= 14) this.profile = 'BALANCED';
    } else if (this.profile === 'BALANCED') {
      if (this.lowFpsStreak >= 10 || this.highProcStreak >= 12) this.profile = 'PERFORMANCE_FIRST';
      else if (this.healthyStreak >= 45) this.profile = 'QUALITY_FIRST';
    } else {
      if (this.healthyStreak >= 35) this.profile = 'BALANCED';
    }
  }

  /** Cada cuántos frames ejecutar refinamiento ROI (1 = cada frame) */
  getRefinementStride(): number {
    if (this.profile === 'QUALITY_FIRST') return 1;
    if (this.profile === 'BALANCED') return 2;
    return 3;
  }

  /** Ventana Welch: segmentos (más = más costo) */
  getWelchSegments(): number {
    if (this.profile === 'QUALITY_FIRST') return 4;
    if (this.profile === 'BALANCED') return 3;
    return 2;
  }

  shouldPreferWorker(): boolean {
    return this.profile !== 'PERFORMANCE_FIRST';
  }
}
