/// <reference lib="webworker" />

import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';
import type { ProcessedSignal } from '../types/signal';
import type { ProcessingError } from '../types/signal';

type WorkerIn =
  | { type: 'init' }
  | {
      type: 'process';
      det: ArrayBuffer;
      detW: number;
      detH: number;
      ext: ArrayBuffer;
      extW: number;
      extH: number;
      ts: number;
      motion: number;
    }
  | { type: 'context'; ctx: Record<string, unknown> }
  | { type: 'destroy' };

let proc: PPGSignalProcessor | null = null;

function postSig(sig: ProcessedSignal) {
  (self as DedicatedWorkerGlobalScope).postMessage({ type: 'signal', sig });
}

(self as DedicatedWorkerGlobalScope).onmessage = (ev: MessageEvent<WorkerIn>) => {
  const d = ev.data;
  if (d.type === 'init') {
    if (proc) proc.stop();
    proc = new PPGSignalProcessor(
      (sig) => postSig(sig),
      (err: ProcessingError) => (self as DedicatedWorkerGlobalScope).postMessage({ type: 'error', err })
    );
    void proc.initialize();
    proc.start();
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'ready' });
    return;
  }
  if (d.type === 'destroy') {
    if (proc) {
      proc.stop();
      proc = null;
    }
    return;
  }
  if (d.type === 'context' && proc) {
    proc.applyCaptureContext(d.ctx as Parameters<typeof proc.applyCaptureContext>[0]);
    return;
  }
  if (d.type === 'process' && proc) {
    const det = new ImageData(new Uint8ClampedArray(d.det), d.detW, d.detH);
    const ext = new ImageData(new Uint8ClampedArray(d.ext), d.extW, d.extH);
    proc.processFrameDual(det, ext, d.ts, d.motion);
  }
};
