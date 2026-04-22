/**
 * Web Worker for Parallel PPG Signal Processing
 * 
 * Offloads computationally intensive signal processing to a separate thread
 * to prevent UI blocking and ensure smooth real-time performance.
 * 
 * Tasks handled by worker:
 * 1. CHROM chrominance-based signal extraction
 * 2. Wavelet transform filtering
 * 3. LMS adaptive filtering for motion artifacts
 * 4. Bandpass filtering
 * 5. Signal quality estimation
 * 
 * Benefits:
 * - Non-blocking UI (60 FPS maintained)
 * - Parallel processing of multiple signal sources
 * - Better hardware utilization (multi-core CPUs)
 * - Reduced main thread load
 */

import { CHROMProcessor } from './CHROMProcessor';
import { WaveletFilter } from './WaveletFilter';
import { LMSAdaptiveFilter } from './LMSAdaptiveFilter';

export interface WorkerMessage {
  type: 'init' | 'processFrame' | 'processBatch' | 'reset';
  data?: any;
}

export interface ProcessFrameData {
  r: number;
  g: number;
  b: number;
  timestamp: number;
  enableCHROM?: boolean;
  enableWavelet?: boolean;
  enableLMS?: boolean;
  referenceInput?: number;  // For LMS (accelerometer)
}

export interface ProcessBatchData {
  frames: Array<{ r: number; g: number; b: number; timestamp: number }>;
  enableCHROM?: boolean;
  enableWavelet?: boolean;
  enableLMS?: boolean;
  referenceInputs?: number[];  // For LMS
}

export interface WorkerResponse {
  type: 'result' | 'error';
  data: any;
}

// Worker state
let chromProcessor: CHROMProcessor | null = null;
let waveletFilter: WaveletFilter | null = null;
let lmsFilter: LMSAdaptiveFilter | null = null;

// Signal buffers for batch processing
const SIGNAL_BUFFER_SIZE = 300;
let signalBuffer: { r: number; g: number; b: number; timestamp: number }[] = [];
let chromSignal: Float64Array | null = null;

/**
 * Initialize worker with configuration
 */
function initWorker(config: {
  bufferSize?: number;
  filterOrder?: number;
  lmsStepSize?: number;
}): void {
  const bufferSize = config.bufferSize || SIGNAL_BUFFER_SIZE;
  
  chromProcessor = new CHROMProcessor(bufferSize);
  waveletFilter = new WaveletFilter(30, 6);  // 30 Hz, 6 levels
  lmsFilter = new LMSAdaptiveFilter(config.filterOrder || 32, config.lmsStepSize || 0.01, true);
  
  signalBuffer = [];
  chromSignal = new Float64Array(bufferSize);
}

/**
 * Process a single frame with all enabled algorithms
 */
function processFrame(data: ProcessFrameData): WorkerResponse {
  try {
    const results: any = {
      timestamp: data.timestamp,
      rgb: { r: data.r, g: data.g, b: data.b }
    };

    // CHROM processing
    if (data.enableCHROM && chromProcessor) {
      const chromOutput = chromProcessor.processFrame(data.r, data.g, data.b);
      results.chrom = chromOutput;
      results.chromQuality = chromProcessor.getQualityMetrics();
    }

    // Wavelet filtering (applied to RGB or CHROM output)
    if (data.enableWavelet && waveletFilter) {
      const inputSignal = results.chrom !== undefined ? 
        new Float64Array([results.chrom || 0]) :
        new Float64Array([data.r, data.g, data.b]);
      
      // For single frame, we need a buffer - use accumulated signal
      signalBuffer.push({ r: data.r, g: data.g, b: data.b, timestamp: data.timestamp });
      if (signalBuffer.length > SIGNAL_BUFFER_SIZE) {
        signalBuffer.shift();
      }

      if (signalBuffer.length >= 30) {  // Need minimum buffer
        const bufferSignal = new Float64Array(signalBuffer.length);
        for (let i = 0; i < signalBuffer.length; i++) {
          bufferSignal[i] = signalBuffer[i].r;  // Use red channel
        }
        
        const denoised = waveletFilter.denoise(bufferSignal, 0.15);
        results.waveletDenoised = denoised[denoised.length - 1];
      }
    }

    // LMS adaptive filtering
    if (data.enableLMS && lmsFilter && data.referenceInput !== undefined) {
      const primaryInput = results.chrom !== undefined ? results.chrom : data.r;
      const lmsResult = lmsFilter.process(primaryInput, data.referenceInput);
      results.lmsOutput = lmsResult.output;
      results.lmsConvergence = lmsFilter.getConvergenceMetrics();
    }

    return {
      type: 'result',
      data: results
    };
  } catch (error) {
    return {
      type: 'error',
      data: { error: (error as Error).message }
    };
  }
}

/**
 * Process a batch of frames (more efficient for wavelet operations)
 */
function processBatch(data: ProcessBatchData): WorkerResponse {
  try {
    const results: any = {
      frameCount: data.frames.length,
      timestamps: data.frames.map(f => f.timestamp)
    };

    // Extract signals
    const rSignal = new Float64Array(data.frames.length);
    const gSignal = new Float64Array(data.frames.length);
    const bSignal = new Float64Array(data.frames.length);

    for (let i = 0; i < data.frames.length; i++) {
      rSignal[i] = data.frames[i].r;
      gSignal[i] = data.frames[i].g;
      bSignal[i] = data.frames[i].b;
    }

    // CHROM batch processing
    if (data.enableCHROM && chromProcessor) {
      const chromOutputs: number[] = [];
      for (let i = 0; i < data.frames.length; i++) {
        const output = chromProcessor.processFrame(
          data.frames[i].r,
          data.frames[i].g,
          data.frames[i].b
        );
        chromOutputs.push(output || 0);
      }
      results.chromSignal = Float64Array.from(chromOutputs);
      results.chromQuality = chromProcessor.getQualityMetrics();
    }

    // Wavelet batch processing
    if (data.enableWavelet && waveletFilter) {
      const signalToFilter = results.chromSignal || rSignal;
      const denoised = waveletFilter.denoise(signalToFilter, 0.15);
      results.waveletDenoised = denoised;
      
      // Baseline wander removal
      const baselineRemoved = waveletFilter.removeBaselineWander(signalToFilter);
      results.baselineRemoved = baselineRemoved;
      
      // Motion artifact removal
      const motionRemoved = waveletFilter.removeMotionArtifacts(signalToFilter);
      results.motionRemoved = motionRemoved;
    }

    // LMS batch processing
    if (data.enableLMS && lmsFilter && data.referenceInputs) {
      const signalToFilter = results.chromSignal || rSignal;
      const referenceFloat64 = Float64Array.from(data.referenceInputs);
      const lmsResult = lmsFilter.processBatch(signalToFilter, referenceFloat64);
      results.lmsOutput = lmsResult.output;
      results.lmsError = lmsResult.error;
      results.lmsConvergence = lmsFilter.getConvergenceMetrics();
    }

    return {
      type: 'result',
      data: results
    };
  } catch (error) {
    return {
      type: 'error',
      data: { error: (error as Error).message }
    };
  }
}

/**
 * Reset all processors
 */
function resetProcessors(): WorkerResponse {
  chromProcessor?.reset();
  waveletFilter?.reset();
  lmsFilter?.reset();
  signalBuffer = [];
  chromSignal = new Float64Array(SIGNAL_BUFFER_SIZE);

  return {
    type: 'result',
    data: { reset: true }
  };
}

/**
 * Main message handler
 */
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      initWorker(message.data || {});
      self.postMessage({ type: 'result', data: { initialized: true } });
      break;

    case 'processFrame':
      const frameResult = processFrame(message.data as ProcessFrameData);
      self.postMessage(frameResult);
      break;

    case 'processBatch':
      const batchResult = processBatch(message.data as ProcessBatchData);
      self.postMessage(batchResult);
      break;

    case 'reset':
      const resetResult = resetProcessors();
      self.postMessage(resetResult);
      break;

    default:
      self.postMessage({
        type: 'error',
        data: { error: 'Unknown message type' }
      });
  }
};
