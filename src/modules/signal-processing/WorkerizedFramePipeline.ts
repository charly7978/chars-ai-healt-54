/**
 * Pipeline de frames con Worker opcional; fallback síncrono al núcleo FrameAnalysisCore.
 * Soporta buffer RGBA transferido o ImageBitmap (readback principalmente en worker).
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
  /** Resultado del frame anterior (latencia N−1) cuando la cola worker > 0 */
  staleResult: boolean;
}

type WorkerInboundFrame = {
  type: 'frame';
  id: number;
  width: number;
  height: number;
  timestamp: number;
  motion: boolean;
  buffer: ArrayBuffer;
  /** Fs nominal alineado con PPG / metrología RVFC (Etapa A) */
  sampleRateHz: number;
};

type WorkerInboundBitmap = {
  type: 'bitmap';
  id: number;
  timestamp: number;
  motion: boolean;
  bitmap: ImageBitmap;
  sampleRateHz: number;
};

type WorkerInbound = WorkerInboundFrame | WorkerInboundBitmap;

type WorkerOutbound = {
  type: 'result';
  id: number;
  payload: FrameAnalysisResult;
  dt: number;
  readbackMs: number;
};

function isImageBitmap(x: unknown): x is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap;
}

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
    staleResult: false,
  };
  private lastInputTs: number[] = [];
  private lastProcTs: number[] = [];

  /** Canvas oculto para convertir ImageBitmap → ImageData en main (solo sin worker). */
  private bitmapCanvas: HTMLCanvasElement | null = null;
  private bitmapCtx: CanvasRenderingContext2D | null = null;

  /** Fs nominal [15,60] — debe coincidir con PPGSignalProcessor.estimatedSampleRate */
  private engineFrameSr = 30;

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
          this.stats.readbackMs = m.readbackMs ?? m.dt;
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

  /** Llamar desde PPG antes de process por frame; sincroniza núcleo main y worker. */
  setFrameSampleRate(sr: number): void {
    if (!isFinite(sr)) return;
    this.engineFrameSr = Math.max(15, Math.min(60, sr));
  }

  private applyEngineSampleRate(): void {
    this.engine.setSampleRate(this.engineFrameSr);
  }

  /** Procesa frame RGBA: con worker transfiere buffer; resultado puede ser N−1. */
  process(imageData: ImageData, timestamp: number, motionArtifact: boolean): FrameAnalysisResult | null {
    const t0 = performance.now();
    this.lastInputTs.push(t0);
    if (this.lastInputTs.length > 40) this.lastInputTs.shift();
    this.stats.inputFps = this.estimateFps(this.lastInputTs);

    this.applyEngineSampleRate();

    if (!this.useWorker || !this.worker) {
      const r = this.engine.processFrame(imageData, timestamp, motionArtifact);
      this.lastResult = r;
      this.stats.lastFrameLatencyMs = performance.now() - t0;
      this.stats.readbackMs = this.stats.lastFrameLatencyMs;
      this.stats.staleResult = false;
      this.lastProcTs.push(performance.now());
      if (this.lastProcTs.length > 40) this.lastProcTs.shift();
      this.stats.processedFps = this.estimateFps(this.lastProcTs);
      return r;
    }

    const buf = imageData.data.buffer;
    const id = ++this.seq;
    this.pending++;
    this.stats.staleResult = this.pending > 1;
    if (this.pending > 2) {
      this.stats.droppedFrames++;
    }

    const msg: WorkerInboundFrame = {
      type: 'frame',
      id,
      width: imageData.width,
      height: imageData.height,
      timestamp,
      motion: motionArtifact,
      buffer: buf,
      sampleRateHz: this.engineFrameSr,
    };

    try {
      this.worker.postMessage(msg, [buf]);
    } catch {
      const copy = new Uint8ClampedArray(imageData.data);
      const idata = new ImageData(copy, imageData.width, imageData.height);
      this.applyEngineSampleRate();
      const r = this.engine.processFrame(idata, timestamp, motionArtifact);
      this.lastResult = r;
      this.stats.lastFrameLatencyMs = performance.now() - t0;
      this.stats.staleResult = false;
      return r;
    }

    this.stats.lastFrameLatencyMs = performance.now() - t0;
    return this.lastResult;
  }

  /**
   * Procesa ImageBitmap (p. ej. desde video): en worker hace draw + getImageData allí.
   * Transfiere el bitmap al worker; el hilo principal no hace readback RGBA.
   */
  processBitmap(bitmap: ImageBitmap, timestamp: number, motionArtifact: boolean): FrameAnalysisResult | null {
    if (!isImageBitmap(bitmap)) {
      return null;
    }

    const t0 = performance.now();
    this.lastInputTs.push(t0);
    if (this.lastInputTs.length > 40) this.lastInputTs.shift();
    this.stats.inputFps = this.estimateFps(this.lastInputTs);

    this.applyEngineSampleRate();

    if (!this.useWorker || !this.worker) {
      const w = bitmap.width;
      const h = bitmap.height;
      if (!this.bitmapCanvas || this.bitmapCanvas.width !== w || this.bitmapCanvas.height !== h) {
        this.bitmapCanvas = document.createElement('canvas');
        this.bitmapCanvas.width = w;
        this.bitmapCanvas.height = h;
        this.bitmapCtx = this.bitmapCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
      }
      const ctx = this.bitmapCtx!;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const rb0 = performance.now();
      const imageData = ctx.getImageData(0, 0, w, h);
      this.stats.readbackMs = performance.now() - rb0;
      try {
        bitmap.close();
      } catch {
        /* noop */
      }
      const r = this.engine.processFrame(imageData, timestamp, motionArtifact);
      this.lastResult = r;
      this.stats.lastFrameLatencyMs = performance.now() - t0;
      this.stats.staleResult = false;
      this.lastProcTs.push(performance.now());
      if (this.lastProcTs.length > 40) this.lastProcTs.shift();
      this.stats.processedFps = this.estimateFps(this.lastProcTs);
      return r;
    }

    const id = ++this.seq;
    this.pending++;
    this.stats.staleResult = this.pending > 1;
    if (this.pending > 2) {
      this.stats.droppedFrames++;
    }

    const msg: WorkerInboundBitmap = {
      type: 'bitmap',
      id,
      timestamp,
      motion: motionArtifact,
      bitmap,
      sampleRateHz: this.engineFrameSr,
    };

    try {
      this.worker.postMessage(msg, [bitmap]);
    } catch {
      try {
        bitmap.close();
      } catch {
        /* noop */
      }
      return null;
    }

    this.stats.lastFrameLatencyMs = performance.now() - t0;
    return this.lastResult;
  }

  reset(): void {
    this.engine.reset();
    this.engineFrameSr = 30;
    this.lastResult = null;
    this.pending = 0;
    this.stats.droppedFrames = 0;
    this.stats.staleResult = false;
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
