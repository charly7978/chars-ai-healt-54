/**
 * Scheduling de captura desde video: RVFC o rAF, con preferencia por ImageBitmap
 * (readback RGBA en worker) y fallback canvas + pool de buffers.
 */

import { supportsCreateImageBitmap } from './offscreenSupport';

export interface CaptureFrameMetrics {
  inputFps: number;
  captureLatencyMs: number;
  /** Estrategia usada en el último frame */
  strategy: 'bitmap' | 'buffer_pool';
  /** Solo path pool: getImageData en main */
  readbackMs?: number;
}

export type FrameForPipeline = ImageData | ImageBitmap;

export interface FrameCaptureSchedulerOptions {
  targetWidth: number;
  targetHeight: number;
  /** Preferir createImageBitmap → worker (sin getImageData en main) */
  preferBitmapPath: boolean;
}

const POOL_SIZE = 2;

export class FrameCaptureScheduler {
  readonly targetWidth: number;
  readonly targetHeight: number;
  private readonly preferBitmapPath: boolean;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bufferPool: Uint8ClampedArray[] = [];
  private poolIndex = 0;

  private lastInputTs: number[] = [];
  private metrics: CaptureFrameMetrics = {
    inputFps: 0,
    captureLatencyMs: 0,
    strategy: 'buffer_pool',
  };

  constructor(options: FrameCaptureSchedulerOptions) {
    this.targetWidth = options.targetWidth;
    this.targetHeight = options.targetHeight;
    this.preferBitmapPath = options.preferBitmapPath;
    const px = this.targetWidth * this.targetHeight * 4;
    for (let i = 0; i < POOL_SIZE; i++) {
      this.bufferPool.push(new Uint8ClampedArray(px));
    }
  }

  getMetrics(): CaptureFrameMetrics {
    return { ...this.metrics };
  }

  private ensureCanvas(): CanvasRenderingContext2D {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.targetWidth;
      this.canvas.height = this.targetHeight;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    }
    return this.ctx!;
  }

  /**
   * Captura un frame reducido para el pipeline PPG.
   * Devuelve null si el vídeo no está listo.
   */
  async captureFromVideo(video: HTMLVideoElement): Promise<FrameForPipeline | null> {
    const t0 = performance.now();
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    const now = performance.now();
    this.lastInputTs.push(now);
    if (this.lastInputTs.length > 40) this.lastInputTs.shift();
    this.metrics.inputFps = this.estimateFps(this.lastInputTs);

    if (this.preferBitmapPath && supportsCreateImageBitmap()) {
      try {
        const bmp = await createImageBitmap(video, {
          resizeWidth: this.targetWidth,
          resizeHeight: this.targetHeight,
          resizeQuality: 'low',
        });
        this.metrics.captureLatencyMs = performance.now() - t0;
        this.metrics.strategy = 'bitmap';
        return bmp;
      } catch {
        /* fallback */
      }
    }

    const ctx = this.ensureCanvas();
    ctx.drawImage(video, 0, 0, this.targetWidth, this.targetHeight);
    const readT0 = performance.now();
    const snapshot = ctx.getImageData(0, 0, this.targetWidth, this.targetHeight);
    const buf = this.bufferPool[this.poolIndex]!;
    this.poolIndex = (this.poolIndex + 1) % POOL_SIZE;
    buf.set(snapshot.data);
    const imageData = new ImageData(buf, this.targetWidth, this.targetHeight);
    this.metrics.captureLatencyMs = performance.now() - t0;
    this.metrics.readbackMs = performance.now() - readT0;
    this.metrics.strategy = 'buffer_pool';
    return imageData;
  }

  /** Versión síncrona sin ImageBitmap (solo pool + canvas). */
  captureFromVideoSync(video: HTMLVideoElement): ImageData | null {
    const t0 = performance.now();
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    const now = performance.now();
    this.lastInputTs.push(now);
    if (this.lastInputTs.length > 40) this.lastInputTs.shift();
    this.metrics.inputFps = this.estimateFps(this.lastInputTs);

    const ctx = this.ensureCanvas();
    ctx.drawImage(video, 0, 0, this.targetWidth, this.targetHeight);
    const snapshot = ctx.getImageData(0, 0, this.targetWidth, this.targetHeight);
    const buf = this.bufferPool[this.poolIndex]!;
    this.poolIndex = (this.poolIndex + 1) % POOL_SIZE;
    buf.set(snapshot.data);
    this.metrics.captureLatencyMs = performance.now() - t0;
    this.metrics.strategy = 'buffer_pool';
    return new ImageData(buf, this.targetWidth, this.targetHeight);
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