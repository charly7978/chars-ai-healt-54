/**
 * PPG PROCESSING WEB WORKER
 * 
 * Offloads heavy pixel processing from main thread:
 * - Radiometric preprocessing (sRGB → Linear → OD)
 * - Tile metrics computation
 * - Visual motion estimation
 * - Feature extraction
 * 
 * Communication via structured clone (ImageData, ArrayBuffers)
 */

import { RadiometricProcessor } from '../signal-processing/RadiometricProcessor';
import { MotionEstimator } from '../signal-processing/MotionEstimator';
import type { RadiometricResult, RadiometricTileMetrics } from '../signal-processing/RadiometricProcessor';
import type { MotionEstimate, MotionState, IMUData } from '../signal-processing/MotionEstimator';

// ═══════════════════════════════════════════════════════════════════
//  MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════

export type WorkerMessage = 
  | ProcessFrameMessage
  | IMUUpdateMessage
  | ResetMessage
  | ConfigMessage;

export interface ProcessFrameMessage {
  type: 'PROCESS_FRAME';
  imageData: ImageData;
  timestamp: number;
  frameNumber: number;
}

export interface IMUUpdateMessage {
  type: 'IMU_UPDATE';
  imuData: IMUData;
}

export interface ResetMessage {
  type: 'RESET';
}

export interface ConfigMessage {
  type: 'CONFIG';
  config: WorkerConfig;
}

export interface WorkerConfig {
  gridSize: number;
  enableMultiResolutionMotion: boolean;
  radiometricConfig: {
    sRGBGamma: number;
    clipHighThreshold: number;
    clipLowThreshold: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
//  RESULT TYPES
// ═══════════════════════════════════════════════════════════════════

export type WorkerResult =
  | FrameProcessedResult
  | IMUProcessedResult
  | ResetCompleteResult
  | ConfigAppliedResult
  | ErrorResult;

export interface FrameProcessedResult {
  type: 'FRAME_PROCESSED';
  frameNumber: number;
  timestamp: number;
  processingTimeMs: number;
  radiometricResult: RadiometricResult;
  motionEstimate: MotionEstimate;
  // Transferable buffers for efficiency
  transferables?: Transferable[];
}

export interface IMUProcessedResult {
  type: 'IMU_PROCESSED';
  motionEstimate: MotionEstimate;
}

export interface ResetCompleteResult {
  type: 'RESET_COMPLETE';
}

export interface ConfigAppliedResult {
  type: 'CONFIG_APPLIED';
}

export interface ErrorResult {
  type: 'ERROR';
  error: string;
  frameNumber?: number;
}

// ═══════════════════════════════════════════════════════════════════
//  WORKER STATE
// ═══════════════════════════════════════════════════════════════════

class PPGProcessingWorker {
  private radiometricProcessor: RadiometricProcessor;
  private motionEstimator: MotionEstimator;
  private config: WorkerConfig = {
    gridSize: 5,
    enableMultiResolutionMotion: true,
    radiometricConfig: {
      sRGBGamma: 2.2,
      clipHighThreshold: 250,
      clipLowThreshold: 5,
    },
  };
  private frameCount = 0;
  private lastFrameTime = 0;

  constructor() {
    this.radiometricProcessor = new RadiometricProcessor();
    this.motionEstimator = new MotionEstimator();
  }

  /**
   * Process a video frame
   */
  processFrame(message: ProcessFrameMessage): FrameProcessedResult {
    const startTime = performance.now();
    const { imageData, timestamp, frameNumber } = message;

    try {
      // Phase 1: Radiometric preprocessing
      const radiometricResult = this.radiometricProcessor.processFrame(
        imageData, 
        this.config.gridSize
      );

      // Phase 2: Visual motion estimation
      this.motionEstimator.updateVisual(imageData);
      const motionEstimate = this.motionEstimator.getEstimate();

      const processingTimeMs = performance.now() - startTime;
      this.frameCount++;
      this.lastFrameTime = timestamp;

      return {
        type: 'FRAME_PROCESSED',
        frameNumber,
        timestamp,
        processingTimeMs,
        radiometricResult: this.serializeRadiometricResult(radiometricResult),
        motionEstimate,
      };
    } catch (error) {
      return {
        type: 'FRAME_PROCESSED',
        frameNumber,
        timestamp,
        processingTimeMs: performance.now() - startTime,
        radiometricResult: this.getDefaultRadiometricResult(),
        motionEstimate: this.getDefaultMotionEstimate(),
      };
    }
  }

  /**
   * Update IMU data
   */
  updateIMU(message: IMUUpdateMessage): IMUProcessedResult {
    this.motionEstimator.updateIMU(message.imuData);
    return {
      type: 'IMU_PROCESSED',
      motionEstimate: this.motionEstimator.getEstimate(),
    };
  }

  /**
   * Reset all processors
   */
  reset(): ResetCompleteResult {
    // Reset radiometric processor state (if method exists)
    if ('reset' in this.radiometricProcessor && typeof (this.radiometricProcessor as any).reset === 'function') {
      (this.radiometricProcessor as any).reset();
    }
    this.motionEstimator.reset();
    this.frameCount = 0;
    return { type: 'RESET_COMPLETE' };
  }

  /**
   * Apply new configuration
   */
  configure(message: ConfigMessage): ConfigAppliedResult {
    this.config = { ...this.config, ...message.config };
    return { type: 'CONFIG_APPLIED' };
  }

  // ═════════════════════════════════════════════════════════════════
  //  SERIALIZATION HELPERS
  // ═════════════════════════════════════════════════════════════════

  private serializeRadiometricResult(result: RadiometricResult): RadiometricResult {
    // Return a clean copy without circular references
    return {
      tileMetrics: result.tileMetrics.map(t => ({ ...t })),
      global: { ...result.global },
      validTileCount: result.validTileCount,
      totalTileCount: result.totalTileCount,
      validTileRatio: result.validTileRatio,
      globalQualityScore: result.globalQualityScore,
      isFrameValid: result.isFrameValid,
      frameRejectionReason: result.frameRejectionReason,
      config: result.config,
      timestamp: result.timestamp,
    };
  }

  private getDefaultRadiometricResult(): RadiometricResult {
    const gridSize = this.config.gridSize;
    const totalTiles = gridSize * gridSize;
    
    return {
      tileMetrics: Array(totalTiles).fill(null).map((_, i) => ({
        tileIndex: i,
        linearR: 0, linearG: 0, linearB: 0, linearIntensity: 0,
        odR: 0, odG: 0, odB: 0, odMean: 0,
        variance: 0, stdDev: 0,
        clipHighCount: 0, clipLowCount: 0,
        clipHighRatio: 0, clipLowRatio: 0,
        validPixelCount: 0, totalPixelCount: 0, validPixelRatio: 0,
        entropy: 0, edgeMagnitude: 0,
        redDominance: 0, rgRatio: 0, redGreenDiff: 0,
        qualityScore: 0,
        isValid: false,
      })),
      global: {
        linearR: 0, linearG: 0, linearB: 0,
        odR: 0, odG: 0, odB: 0, odMean: 0,
        intensity: 0, variance: 0,
        clipHighRatio: 0, clipLowRatio: 0,
        entropy: 0, redDominance: 0, rgRatio: 0,
      },
      validTileCount: 0,
      totalTileCount: totalTiles,
      validTileRatio: 0,
      globalQualityScore: 0,
      isFrameValid: false,
      config: {
        gamma: 2.2,
        gammaInverse: 1 / 2.2,
        clipHigh: 250,
        clipLow: 5,
        eps: 1e-6,
        minValidPixelsRatio: 0.5,
      },
      timestamp: Date.now(),
    };
  }

  private getDefaultMotionEstimate(): MotionEstimate {
    return {
      score: 0,
      state: 'STATIONARY',
      imuScore: 0,
      visualScore: 0,
      confidence: 0,
      isReliable: false,
      imuAvailable: false,
      visualAvailable: false,
    };
  }

  // Additional helper methods can be added here
}

// ═══════════════════════════════════════════════════════════════════
//  WORKER ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

const worker = new PPGProcessingWorker();

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  let result: WorkerResult;

  switch (message.type) {
    case 'PROCESS_FRAME':
      result = worker.processFrame(message);
      break;
    case 'IMU_UPDATE':
      result = worker.updateIMU(message);
      break;
    case 'RESET':
      result = worker.reset();
      break;
    case 'CONFIG':
      result = worker.configure(message);
      break;
    default:
      result = {
        type: 'ERROR',
        error: `Unknown message type: ${(message as any).type}`,
      };
  }

  // Send result back to main thread
  self.postMessage(result);
};

// Export types for main thread
export type { RadiometricResult, RadiometricTileMetrics };
export type { MotionEstimate, MotionState, IMUData };
