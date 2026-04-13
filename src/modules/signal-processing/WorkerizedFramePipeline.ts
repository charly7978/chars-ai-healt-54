/**
 * Pipeline de frames con Worker opcional; fallback síncrono al núcleo FrameAnalysisCore.
 * Minimiza copias: transfer del buffer RGBA del ImageData cuando el worker está activo.
 */

import { FrameAnalysisEngine, type FrameAnalysisResult } from './FrameAnalysisCore';

export interface PipelineStats {
  inputFps: number;
  processedFps: number;
  droppedFrames: number;
  lastFrameLatencyMs: number;
  workerRoundtripMs: number;
  readbackMs: number;
  workerActive: boolean;
}

type WorkerInbound = {
  type: 'frame';
  id: number;
  width: number;
  height: number;
  timestamp: number;
  motion: boolean;
  buffer: ArrayBuffer;
};

type WorkerOutbound = {
  type: 'result';
  id: number;
  payload: FrameAnalysisResult;
  dt: number;
};

export class WorkerizedFramePipeline {
  private worker: Worker | null = null;
  private engine: FrameAnalysisEngine;
  private useWorker: boolean;
  private lastResult: FrameAnalysisResult | null = null;
  private pending = 0;
  private seq = 0;
  private stats: PipelineStats = {
    inputFps: 0,
    processedFps: 0,
    droppedFrames: 0,
    lastFrameLatencyMs: 0,
    workerRoundtripMs: 0,
    readbackMs: 0,
    workerActive: false,
  };
  private lastInputTs: number[] = [];
  private lastProcTs: number[] = [];

  constructor(options?: { preferWorker?: boolean }) {
    this.engine = new FrameAnalysisEngine();
    const prefer = options?.preferWorker ?? true;
    this.useWorker = false;
    if (prefer && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../../workers/frameAnalysis.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
          const m = ev.data;
          if (m.type !== 'result') return;
          this.pending = Math.max(0, this.pending - 1);
          this.stats.workerRoundtripMs = m.dt;
          this.lastResult = m.payload;
          const now = performance.now();
          this.lastProcTs.push(now);
          if (this.lastProcTs.length > 40) this.lastProcTs.shift();
          this.stats.processedFps = this.estimateFps(this.lastProcTs);
        };
        this.useWorker = true;
        this.stats.workerActive = true;
      } catch {
        this.worker = null;
        this.useWorker = false;
        this.stats.workerActive = false;
      }
    }
  }

  getStats(): PipelineStats {
    return { ...this.stats };
  }

  getLastResult(): FrameAnalysisResult | null {
    return this.lastResult;
  }

  /** Procesa frame: con worker transfiere buffer; resultado puede ser N-1. */
  process(imageData: ImageData, timestamp: number, motionArtifact: boolean): FrameAnalysisResult | null {
    const t0 = performance.now();
    this.lastInputTs.push(t0);
    if (this.lastInputTs.length > 40) this.lastInputTs.shift();
    this.stats.inputFps = this.estimateFps(this.lastInputTs);

    if (!this.useWorker || !this.worker) {
      const r = this.engine.processFrame(imageData, timestamp, motionArtifact);
      this.lastResult = r;
      this.stats.lastFrameLatencyMs = performance.now() - t0;
      this.stats.readbackMs = this.stats.lastFrameLatencyMs;
      this.lastProcTs.push(performance.now());
      if (this.lastProcTs.length > 40) this.lastProcTs.shift();
      this.stats.processedFps = this.estimateFps(this.lastProcTs);
      return r;
    }

    const buf = imageData.data.buffer;
    const id = ++this.seq;
    this.pending++;
    if (this.pending > 2) {
      this.stats.droppedFrames++;
    }

    const msg: WorkerInbound = {
      type: 'frame',
      id,
      width: imageData.width,
      height: imageData.height,
      timestamp,
      motion: motionArtifact,
    };

    try {
      const payload: WorkerInbound = { ...msg, buffer: buf };
      this.worker.postMessage(payload, [buf]);
    } catch {
      const copy = new Uint8ClampedArray(imageData.data);
      const idata = new ImageData(copy, imageData.width, imageData.height);
      const r = this.engine.processFrame(idata, timestamp, motionArtifact);
      this.lastResult = r;
      this.stats.lastFrameLatencyMs = performance.now() - t0;
      return r;
    }

    this.stats.lastFrameLatencyMs = performance.now() - t0;
    return this.lastResult;
  }

  reset(): void {
    this.engine.reset();
    this.lastResult = null;
    this.pending = 0;
    this.stats.droppedFrames = 0;
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private estimateFps(ts: number[]): number {
    if (ts.length < 4) return 0;
    const d: number[] = [];
    for (let i = 1; i < ts.length; i++) d.push(ts[i]! - ts[i - 1]!);
    d.sort((a, b) => a - b);
    const med = d[Math.floor(d.length / 2)] ?? 16;
    return med > 1 ? 1000 / med : 0;
  }
}
