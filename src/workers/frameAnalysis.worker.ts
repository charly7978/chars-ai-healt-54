/// <reference lib="webworker" />

import { FrameAnalysisEngine } from '../modules/signal-processing/FrameAnalysisCore';

const engine = new FrameAnalysisEngine();

type Inbound = {
  type: 'frame';
  id: number;
  width: number;
  height: number;
  timestamp: number;
  motion: boolean;
  buffer: ArrayBuffer;
};

self.onmessage = (ev: MessageEvent<Inbound>) => {
  const m = ev.data;
  if (m.type !== 'frame') return;
  const data = new Uint8ClampedArray(m.buffer);
  const imageData = new ImageData(data, m.width, m.height);
  const t0 = performance.now();
  const payload = engine.processFrame(imageData, m.timestamp, m.motion);
  const dt = performance.now() - t0;
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({
    type: 'result',
    id: m.id,
    payload,
    dt,
  });
};
