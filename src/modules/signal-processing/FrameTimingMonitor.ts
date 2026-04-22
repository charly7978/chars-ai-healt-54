/**
 * FRAME TIMING MONITOR
 * 
 * Monitorea timing real de frames, jitter, gaps y performance.
 */

export interface TimingMetrics {
  avgDeltaMs: number;
  maxDeltaMs: number;
  minDeltaMs: number;
  jitterMs: number;
  droppedGaps: number;
  effectiveFps: number;
  frameProcessingTimeMs: number;
  budgetUsage: number;
  stageTimes: Record<string, number>;
}

export class FrameTimingMonitor {
  private deltaHistory: number[] = [];
  private processingTimes: number[] = [];
  private stageTimes: Map<string, number[]> = new Map();
  private lastTimestamp = 0;
  private maxHistory = 120;
  private targetFps = 30;
  private frameBudgetMs = 1000 / 30; // ~33ms para 30fps

  constructor(targetFps: number = 30) {
    this.targetFps = targetFps;
    this.frameBudgetMs = 1000 / targetFps;
  }

  /**
   * Registra un frame con timestamp
   */
  recordFrame(timestamp: number): void {
    if (this.lastTimestamp === 0) {
      this.lastTimestamp = timestamp;
      return;
    }

    const delta = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    // Solo deltas razonables (8-120ms)
    if (delta >= 8 && delta <= 120) {
      this.deltaHistory.push(delta);
      if (this.deltaHistory.length > this.maxHistory) {
        this.deltaHistory.shift();
      }
    }
  }

  /**
   * Registra tiempo de procesamiento de frame
   */
  recordProcessingTime(timeMs: number): void {
    this.processingTimes.push(timeMs);
    if (this.processingTimes.length > this.maxHistory) {
      this.processingTimes.shift();
    }
  }

  /**
   * Registra tiempo de una etapa específica
   */
  recordStageTime(stage: string, timeMs: number): void {
    if (!this.stageTimes.has(stage)) {
      this.stageTimes.set(stage, []);
    }
    const times = this.stageTimes.get(stage)!;
    times.push(timeMs);
    if (times.length > 60) {
      times.shift();
    }
  }

  /**
   * Obtiene métricas actuales
   */
  getMetrics(): TimingMetrics {
    if (this.deltaHistory.length < 2) {
      return {
        avgDeltaMs: 0,
        maxDeltaMs: 0,
        minDeltaMs: 0,
        jitterMs: 0,
        droppedGaps: 0,
        effectiveFps: this.targetFps,
        frameProcessingTimeMs: 0,
        budgetUsage: 0,
        stageTimes: {}
      };
    }

    const deltas = this.deltaHistory;
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const maxDelta = Math.max(...deltas);
    const minDelta = Math.min(...deltas);
    
    // Jitter: desviación estándar de deltas
    const variance = deltas.reduce((sum, d) => sum + (d - avgDelta) ** 2, 0) / deltas.length;
    const jitter = Math.sqrt(variance);

    // Gaps grandes (> 2x target interval)
    const targetInterval = 1000 / this.targetFps;
    const droppedGaps = deltas.filter(d => d > targetInterval * 2).length;

    const effectiveFps = 1000 / avgDelta;

    // Tiempo de procesamiento promedio
    const avgProcTime = this.processingTimes.length > 0
      ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
      : 0;

    // Budget usage
    const budgetUsage = avgProcTime / this.frameBudgetMs;

    // Tiempos por etapa
    const stageTimes: Record<string, number> = {};
    for (const [stage, times] of this.stageTimes.entries()) {
      if (times.length > 0) {
        stageTimes[stage] = times.reduce((a, b) => a + b, 0) / times.length;
      }
    }

    return {
      avgDeltaMs: avgDelta,
      maxDeltaMs: maxDelta,
      minDeltaMs: minDelta,
      jitterMs: jitter,
      droppedGaps,
      effectiveFps,
      frameProcessingTimeMs: avgProcTime,
      budgetUsage,
      stageTimes
    };
  }

  /**
   * Detecta si el sistema está sobrecargado
   */
  isOverloaded(): boolean {
    const metrics = this.getMetrics();
    return metrics.budgetUsage > 0.85 || metrics.effectiveFps < this.targetFps * 0.7;
  }

  /**
   * Detecta si hay muchos gaps
   */
  hasExcessiveGaps(): boolean {
    const metrics = this.getMetrics();
    return metrics.droppedGaps > metrics.avgDeltaMs * 0.1;
  }

  /**
   * Obtiene percentiles de tiempo de procesamiento
   */
  getProcessingTimePercentiles(): { p50: number; p90: number; p95: number; p99: number } {
    if (this.processingTimes.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.processingTimes].sort((a, b) => a - b);
    const n = sorted.length;

    return {
      p50: sorted[Math.floor(n * 0.5)],
      p90: sorted[Math.floor(n * 0.9)],
      p95: sorted[Math.floor(n * 0.95)],
      p99: sorted[Math.floor(n * 0.99)]
    };
  }

  /**
   * Resetea el monitor
   */
  reset(): void {
    this.deltaHistory = [];
    this.processingTimes = [];
    this.stageTimes.clear();
    this.lastTimestamp = 0;
  }

  /**
   * Cambia FPS objetivo
   */
  setTargetFps(fps: number): void {
    this.targetFps = fps;
    this.frameBudgetMs = 1000 / fps;
  }
}
