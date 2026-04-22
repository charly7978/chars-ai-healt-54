/**
 * Intervalos reales entre frames y FPS efectiva.
 */

export class FrameTimingTracker {
  private lastTs = 0;
  private intervals: number[] = [];
  private readonly maxIntervals = 48;
  private droppedStreak = 0;

  reset(): void {
    this.lastTs = 0;
    this.intervals = [];
    this.droppedStreak = 0;
  }

  recordFrame(timestampMs: number): { intervalMs: number; effectiveFps: number; droppedEstimate: number } {
    if (this.lastTs <= 0 || !isFinite(timestampMs)) {
      this.lastTs = timestampMs;
      return { intervalMs: 0, effectiveFps: 0, droppedEstimate: 0 };
    }
    const dt = timestampMs - this.lastTs;
    this.lastTs = timestampMs;
    if (dt >= 8 && dt < 500) {
      this.intervals.push(dt);
      if (this.intervals.length > this.maxIntervals) this.intervals.shift();
    }
    let dropped = 0;
    if (dt > 55) {
      this.droppedStreak += Math.min(8, Math.floor(dt / 45) - 1);
      dropped = this.droppedStreak;
    } else {
      this.droppedStreak = Math.max(0, this.droppedStreak - 1);
    }

    if (this.intervals.length < 6) {
      return { intervalMs: dt, effectiveFps: dt > 0 ? 1000 / dt : 0, droppedEstimate: dropped };
    }
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const fps = med > 0 ? Math.min(75, Math.max(8, 1000 / med)) : 0;
    return { intervalMs: med, effectiveFps: fps, droppedEstimate: dropped };
  }
}
