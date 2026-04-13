export interface FrameTimingSnapshot {
  mediaTime?: number;
  expectedDisplayTime?: number;
  presentedFrames?: number;
  processingDuration?: number;
  effectiveSampleRate: number;
  frameDrops: number;
}

/**
 * Estima FPS efectivo y drops a partir de timestamps de rVFC.
 */
export class FrameTimingEstimator {
  private intervals: number[] = [];
  private readonly maxIntervals = 48;
  private lastTs = 0;
  private drops = 0;

  pushFrameTimestamp(ts: number): FrameTimingSnapshot {
    if (this.lastTs > 0) {
      const dt = ts - this.lastTs;
      if (dt >= 8 && dt <= 200) {
        this.intervals.push(dt);
        if (this.intervals.length > this.maxIntervals) this.intervals.shift();
        if (dt > 1000 / 18) this.drops++;
      }
    }
    this.lastTs = ts;

    const sorted = [...this.intervals].sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1000 / 30;
    const fps = 1000 / Math.max(8, med);

    return {
      effectiveSampleRate: Math.max(15, Math.min(60, fps)),
      frameDrops: this.drops,
      processingDuration: 0,
    };
  }

  reset(): void {
    this.intervals = [];
    this.lastTs = 0;
    this.drops = 0;
  }
}
