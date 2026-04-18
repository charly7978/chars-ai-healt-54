/**
 * WORKERS MODULE
 * 
 * Web Workers for offloading heavy PPG processing from main thread.
 */

export { WorkerManager } from './WorkerManager';
export type { WorkerStatus, WorkerManagerCallbacks } from './WorkerManager';

export type {
  WorkerMessage,
  WorkerResult,
  ProcessFrameMessage,
  IMUUpdateMessage,
  ResetMessage,
  ConfigMessage,
  FrameProcessedResult,
  IMUProcessedResult,
  ResetCompleteResult,
  ConfigAppliedResult,
  ErrorResult,
  WorkerConfig,
} from './PPGProcessingWorker';
