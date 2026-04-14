/// <reference lib="webworker" />

import { FrameAnalysisEngine } from '../modules/signal-processing/FrameAnalysisCore';

const engine = new FrameAnalysisEngine();

let offscreen: OffscreenCanvas | null = null;
let offCtx: OffscreenCanvasRenderingContext2D | null = null;
let lastW = 0;
let lastH = 0;

function ensureCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!offscreen || w !== lastW || h !== lastH) {
    lastW = w;
    lastH = h;
    offscreen = new OffscreenCanvas(w, h);
    offCtx = offscreen.getContext('2d', { willReadFrequently: true, alpha: false });
  }
  if (!offCtx) {
    offCtx = offscreen!.getContext('2d', { willReadFrequently: true, alpha: false });
  }
  return offCtx!;
}

type InboundFrame = {
  type: 'frame';
  id: number;
  width: number;
  height: number;
  timestamp: number;
  motion: boolean;
  buffer: ArrayBuffer;
  sampleRateHz: number;
};

type InboundBitmap = {
  type: 'bitmap';
  id: number;
  timestamp: number;
  motion: boolean;
  bitmap: ImageBitmap;
  sampleRateHz: number;
};

type Inbound = InboundFrame | InboundBitmap;

self.onmessage = (ev: MessageEvent<Inbound>) => {
  const m = ev.data;
  if (m.type === 'bitmap') {
    const bmp = m.bitmap;
    const w = bmp.width;
    const h = bmp.height;
    const ctx = ensureCanvas(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    try {
      bmp.close();
    } catch {
      /* noop */
    }
    const readT0 = performance.now();
    const imageData = ctx.getImageData(0, 0, w, h);
    const readbackMs = performance.now() - readT0;
    const t0 = performance.now();
    const sr = typeof m.sampleRateHz === 'number' && isFinite(m.sampleRateHz) ? m.sampleRateHz : 30;
    engine.setSampleRate(sr);
    const payload = engine.processFrame(imageData, m.timestamp, m.motion);
    const dt = performance.now() - t0;
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      type: 'result',
      id: m.id,
      payload,
      dt,
      readbackMs,
    });
    return;
  }

  if (m.type !== 'frame') return;
  const data = new Uint8ClampedArray(m.buffer);
  const imageData = new ImageData(data, m.width, m.height);
  const t0 = performance.now();
  const sr = typeof m.sampleRateHz === 'number' && isFinite(m.sampleRateHz) ? m.sampleRateHz : 30;
  engine.setSampleRate(sr);
  const payload = engine.processFrame(imageData, m.timestamp, m.motion);
  const dt = performance.now() - t0;
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({
    type: 'result',
    id: m.id,
    payload,
    dt,
    readbackMs: dt,
  });
};
