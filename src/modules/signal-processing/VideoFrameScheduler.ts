/**
 * requestVideoFrameCallback con fallback RAF + métricas de intervalo/jitter.
 */

import { EWMA_DECAY_FAST, EWMA_DECAY_MEDIUM } from '@/constants/processing';

export type VideoSchedulerMode = 'RVFC' | 'RAF_FALLBACK';

export interface VideoFrameSchedulerMetrics {
  mode: VideoSchedulerMode;
  lastIntervalMs: number;
  effectiveFps: number;
  jitterMsEstimate: number;
  droppedOrSkippedEstimate: number;
  lastMediaTimeMs: number | null;
  lastExpectedDisplayTimeMs: number | null;
}

type RVFCMetadata = {
  mediaTime?: number;
  expectedDisplayTime?: number;
  presentedFrames?: number;
};

export class VideoFrameScheduler {
  private video: HTMLVideoElement | null = null;
  private running = false;
  private rafId: number | null = null;
  private rvfcHandle = 0;
  private mode: VideoSchedulerMode = 'RAF_FALLBACK';
  private lastTs = 0;
  private intervalEwma = 33.3;
  private jitterEwma = 0;
  private droppedEwma = 0;
  private lastMediaTime: number | null = null;
  private lastExpectedDisplayTime: number | null = null;
  private presentedFramesPrev: number | undefined;

  private onFrame: (timestampMs: number, meta: RVFCMetadata | null) => void = () => {};

  start(video: HTMLVideoElement, onFrame: (timestampMs: number, meta: RVFCMetadata | null) => void): void {
    this.stop();
    this.video = video;
    this.onFrame = onFrame;
    this.running = true;
    this.lastTs = 0;
    this.presentedFramesPrev = undefined;

    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: RVFCMetadata) => void) => number;
      cancelVideoFrameCallback?: (h: number) => void;
    };

    if (typeof v.requestVideoFrameCallback === 'function' && typeof v.cancelVideoFrameCallback === 'function') {
      this.mode = 'RVFC';
      const tick = (now: number, meta: RVFCMetadata) => {
        if (!this.running || this.video !== video) return;
        this.record(now, meta);
        this.onFrame(this.pickTimestamp(now, meta), meta);
        this.rvfcHandle = v.requestVideoFrameCallback!(tick);
      };
      this.rvfcHandle = v.requestVideoFrameCallback!(tick);
    } else {
      this.mode = 'RAF_FALLBACK';
      const rafTick = () => {
        if (!this.running || this.video !== video) return;
        const now = performance.now();
        this.record(now, null);
        this.onFrame(now, null);
        this.rafId = requestAnimationFrame(rafTick);
      };
      this.rafId = requestAnimationFrame(rafTick);
    }
  }

  stop(): void {
    this.running = false;
    const video = this.video as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | null;
    if (video && typeof video.cancelVideoFrameCallback === 'function' && this.rvfcHandle) {
      try {
        video.cancelVideoFrameCallback(this.rvfcHandle);
      } catch {
        /* noop */
      }
    }
    this.rvfcHandle = 0;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.video = null;
  }

  getMetrics(): VideoFrameSchedulerMetrics {
    const fps = this.intervalEwma > 0 ? 1000 / this.intervalEwma : 0;
    return {
      mode: this.mode,
      lastIntervalMs: this.intervalEwma,
      effectiveFps: Math.max(0, Math.min(72, fps)),
      jitterMsEstimate: this.jitterEwma,
      droppedOrSkippedEstimate: this.droppedEwma,
      lastMediaTimeMs: this.lastMediaTime,
      lastExpectedDisplayTimeMs: this.lastExpectedDisplayTime,
    };
  }

  private pickTimestamp(now: number, meta: RVFCMetadata | null): number {
    if (meta && typeof meta.expectedDisplayTime === 'number' && isFinite(meta.expectedDisplayTime)) {
      return meta.expectedDisplayTime;
    }
    return now;
  }

  private record(now: number, meta: RVFCMetadata | null): void {
    if (meta) {
      if (typeof meta.mediaTime === 'number' && isFinite(meta.mediaTime)) this.lastMediaTime = meta.mediaTime * 1000;
      if (typeof meta.expectedDisplayTime === 'number' && isFinite(meta.expectedDisplayTime)) {
        this.lastExpectedDisplayTime = meta.expectedDisplayTime;
      }
      if (typeof meta.presentedFrames === 'number' && this.presentedFramesPrev !== undefined) {
        const skipped = meta.presentedFrames - this.presentedFramesPrev - 1;
        if (skipped > 0) {
          this.droppedEwma = this.droppedEwma * EWMA_DECAY_FAST + Math.min(6, skipped) * (1 - EWMA_DECAY_FAST);
        }
      }
      if (typeof meta.presentedFrames === 'number') this.presentedFramesPrev = meta.presentedFrames;
    }

    if (this.lastTs > 0) {
      const dt = now - this.lastTs;
      if (dt >= 5 && dt < 200) {
        const prev = this.intervalEwma;
        this.intervalEwma = prev * 0.88 + dt * 0.12;
        this.jitterEwma = this.jitterEwma * EWMA_DECAY_MEDIUM + Math.abs(dt - prev) * (1 - EWMA_DECAY_MEDIUM);
        if (dt > this.intervalEwma * 1.75) {
          this.droppedEwma = Math.min(8, this.droppedEwma + 0.35);
        }
      }
    }
    this.lastTs = now;
  }
}
