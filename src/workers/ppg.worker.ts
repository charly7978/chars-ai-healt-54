/**
 * PPG SIGNAL PROCESSING WEB WORKER
 * 
 * Offloads all heavy computation (ROI extraction, filtering, WTA, rescue engine,
 * derivatives, AC/DC, signal quality) to a background thread.
 * 
 * Communication protocol:
 *   Main → Worker:
 *     { type: 'init' }
 *     { type: 'start' }
 *     { type: 'stop' }
 *     { type: 'processFrame', data: Uint8ClampedArray, width: number, height: number }
 *     { type: 'reset' }
 *   
 *   Worker → Main:
 *     { type: 'signal', signal: ProcessedSignal }
 *     { type: 'error', error: { code, message, timestamp } }
 *     { type: 'ready' }
 */

import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';
import type { ProcessedSignal, ProcessingError } from '../types/signal';

let processor: PPGSignalProcessor | null = null;

function initProcessor() {
  processor = new PPGSignalProcessor(
    (signal: ProcessedSignal) => {
      if (!processor) return;
      // Un solo mensaje por frame: señal + métricas alineadas (evita polling duplicado en main)
      self.postMessage({
        type: 'signal',
        signal,
        rgbStats: processor.getRGBStats(),
        detectionMetrics: processor.getDetectionMetrics(),
      });
    },
    (error: ProcessingError) => {
      self.postMessage({ type: 'error', error });
    }
  );
  self.postMessage({ type: 'ready' });
}

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init':
      initProcessor();
      break;

    case 'start':
      if (processor) {
        processor.start();
      }
      break;

    case 'stop':
      if (processor) {
        processor.stop();
      }
      break;

    case 'processFrame': {
      if (!processor || !processor.isProcessing) break;
      try {
        const { data, width, height } = msg;
        if (!data || !width || !height) break;
        const clampedArray = new Uint8ClampedArray(data);
        const need = width * height * 4;
        if (clampedArray.byteLength !== need) {
          console.warn('[PPG worker] Buffer RGBA inesperado:', clampedArray.byteLength, '!=', need);
          break;
        }
        const imageData = new ImageData(clampedArray, width, height);
        processor.processFrame(imageData);
      } catch (e) {
        console.error('[PPG worker] processFrame:', e);
      }
      break;
    }

    case 'getRGBStats':
      if (processor) {
        self.postMessage({ type: 'rgbStats', stats: processor.getRGBStats() });
      }
      break;

    case 'getDetectionMetrics':
      if (processor) {
        self.postMessage({ type: 'detectionMetrics', metrics: processor.getDetectionMetrics() });
      }
      break;

    case 'reset':
      if (processor) {
        processor.stop();
        processor = null;
      }
      initProcessor();
      break;
  }
};

// Auto-initialize on load
initProcessor();
