/**
 * Tipos compartidos del pipeline cPPG (contacto, SQI, fusión, telemetría).
 */

export type FingerMeasurementState =
  | 'NO_CONTACT'
  | 'PARTIAL_CONTACT'
  | 'CONTACT_UNSTABLE'
  | 'CONTACT_STABLE_WARMUP'
  | 'MEASUREMENT_READY'
  | 'MEASUREMENT_DEGRADED';

export type SQICategory = 'poor' | 'usable' | 'good' | 'excellent';

export type SQIGating = 'reject' | 'hold_previous' | 'accept_low_confidence' | 'accept_high_confidence';

export interface WindowSQIMetrics {
  score: number;
  category: SQICategory;
  reasons: string[];
  gating: SQIGating;
}

export interface FusedSignalMeta {
  dominantSources: string[];
  weights: Record<string, number>;
  collapse: boolean;
  ensembleValue: number;
}

export interface ROIQualityRow {
  id: number;
  row: number;
  col: number;
  score: number;
  meanR: number;
  meanG: number;
  meanB: number;
  clipRatio: number;
  acdcProxy: number;
  rejectedReason?: string;
}

export interface PipelineTimingSnapshot {
  frameIntervalMs: number;
  effectiveFps: number;
  extractionMs: number;
  roiScoringMs: number;
  fusionMs: number;
  sqiMs: number;
  droppedFramesEstimate: number;
  backlogMs: number;
}
