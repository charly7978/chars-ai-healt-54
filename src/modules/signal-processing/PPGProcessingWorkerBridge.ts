/**
 * Bridge opcional al worker DSP. Fallback silencioso al main thread.
 */

import type { ProcessedSignal } from '../../types/signal';
import type { ProcessingError } from '../../types/signal';
import { MotionTracker } from './MotionTracker';

export type WorkerBridgeStatus =
  | { mode: 'WORKER_ACTIVE'; fallbackReason: null }
  | { mode: 'MAIN_THREAD'; fallbackReason: string };

export class PPGProcessingWorkerBridge {
  private worker: Worker | null = null;
  private ready = false;
  private seq = 0;
  private lastEnqueue = 0;
  private latencyEwma = 0;
  private queueDepth = 0;
  private status: WorkerBridgeStatus = { mode: 'MAIN_THREAD', fallbackReason: 'not_started' };

  constructor(
    private readonly motion: MotionTracker,
    private readonly onSignal: (s: ProcessedSignal) => void,
    private readonly onError?: (e: ProcessingError) => void
  ) {}

  getStatus(): WorkerBridgeStatus {
    return this.status;
  }

  getQueueDepth(): number {
    return this.queueDepth;
  }

  getLatencyEwmaMs(): number {
    return this.latencyEwma;
  }

  async init(): Promise<boolean> {
    if (typeof Worker === 'undefined') {
      this.status = { mode: 'MAIN_THREAD', fallbackReason: 'Worker_API_missing' };
      return false;
    }
    try {
      this.worker = new Worker(new URL('../../workers/ppgProcessor.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (e) {
      this.status = { mode: 'MAIN_THREAD', fallbackReason: `worker_ctor:${String(e)}` };
      return false;
    }

    const w = this.worker;
    const readyPromise = new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('worker_ready_timeout')), 4000);
      const onReady = (ev: MessageEvent) => {
        if (ev.data?.type === 'ready') {
          clearTimeout(to);
          w.removeEventListener('message', onReady);
          resolve();
        }
      };
      w.addEventListener('message', onReady);
    });

    w.onmessage = (ev: MessageEvent) => {
      const t = ev.data;
      if (t?.type === 'ready') {
        this.ready = true;
        this.status = { mode: 'WORKER_ACTIVE', fallbackReason: null };
        return;
      }
      if (t?.type === 'signal') {
        this.queueDepth = Math.max(0, this.queueDepth - 1);
        const dt = performance.now() - this.lastEnqueue;
        this.latencyEwma = this.latencyEwma * 0.82 + dt * 0.18;
        this.onSignal(t.sig as ProcessedSignal);
        return;
      }
      if (t?.type === 'error' && this.onError) {
        this.onError(t.err as ProcessingError);
      }
    };

    w.onerror = () => {
      this.status = { mode: 'MAIN_THREAD', fallbackReason: 'worker_onerror' };
      this.destroy();
    };

    w.postMessage({ type: 'init' });

    try {
      await readyPromise;
    } catch {
      this.status = { mode: 'MAIN_THREAD', fallbackReason: 'ready_timeout' };
      this.destroy();
      return false;
    }

    return true;
  }

  enqueueFrame(
    det: ImageData,
    ext: ImageData,
    ts: number
  ): void {
    if (!this.worker || !this.ready) return;
    this.seq++;
    this.queueDepth++;
    this.lastEnqueue = performance.now();

    const dCopy = new Uint8ClampedArray(det.data);
    const eCopy = new Uint8ClampedArray(ext.data);
    try {
      this.worker.postMessage(
        {
          type: 'process',
          det: dCopy.buffer,
          detW: det.width,
          detH: det.height,
          ext: eCopy.buffer,
          extW: ext.width,
          extH: ext.height,
          ts,
          motion: this.motion.getScore(),
        },
        [dCopy.buffer, eCopy.buffer]
      );
    } catch {
      this.queueDepth = Math.max(0, this.queueDepth - 1);
    }
  }

  destroy(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'destroy' });
      } catch {
        /* */
      }
      this.worker.terminate();
    }
    this.worker = null;
    this.ready = false;
  }
}
