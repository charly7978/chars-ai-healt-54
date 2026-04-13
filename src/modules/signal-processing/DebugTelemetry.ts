/**
 * Telemetría unificada para modo debug (PPG etapa 1).
 */

import type { ContactMachineState } from './ContactStateMachine';

export interface PipelineTimingStats {
  inputFps: number;
  processedFps: number;
  droppedFrames: number;
  lastFrameLatencyMs: number;
  workerRoundtripMs: number;
  readbackMs: number;
}

export interface DebugTelemetry {
  contactState: ContactMachineState;
  coverage: number;
  clipHigh: number;
  clipLow: number;
  pressureProxy: number;
  pressureState: string;
  roiBBox: { sx: number; sy: number; ex: number; ey: number };
  activeTileCount: number;
  discardedTileCount: number;
  /** Subconjunto de índices de tiles activos (debug) */
  activeTileSample?: number[];
  activeSource: string;
  sqiBySource: Record<string, number>;
  readinessReason: string;
  timing: PipelineTimingStats;
  globalScore: number;
  spatialStability: number;
  /** Resultado de análisis puede corresponder a frame previo (cola worker) */
  stalePipeline?: boolean;
  roiValidPixelRatio?: number;
  maskIoU?: number;
}

export function emptyTiming(): PipelineTimingStats {
  return {
    inputFps: 0,
    processedFps: 0,
    droppedFrames: 0,
    lastFrameLatencyMs: 0,
    workerRoundtripMs: 0,
    readbackMs: 0,
  };
}
