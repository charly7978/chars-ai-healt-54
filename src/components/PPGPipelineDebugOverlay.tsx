/**
 * Panel técnico mínimo: telemetría PPG + cámara (activar con ?ppgDebug).
 */
import React, { useMemo } from 'react';
import type { CameraDiagnostics } from '@/components/CameraView';
import type { ProcessedSignal } from '@/types/signal';
import type { CaptureFrameMetrics } from '@/modules/camera/FrameCaptureScheduler';

type PQ = {
  locked: boolean;
  drifting: boolean;
  qualityScore: number;
  positionDrift: number;
  guidance: string;
  poseAngleDrift?: number;
  poseOptimal?: boolean;
  canonicalPoseOk?: boolean;
  canonicalPoseIssue?: string;
};

type Dbg = NonNullable<ProcessedSignal['pipelineDebug']>;

export interface PPGPipelineDebugOverlayProps {
  signal: ProcessedSignal | null;
  positionQuality: PQ;
  captureMetrics: CaptureFrameMetrics | null;
  cameraDiag: CameraDiagnostics | null;
  framesProcessed: number;
}

export const PPGPipelineDebugOverlay: React.FC<PPGPipelineDebugOverlayProps> = ({
  signal,
  positionQuality,
  captureMetrics,
  cameraDiag,
  framesProcessed,
}) => {
  const dbg: Dbg | null = signal?.pipelineDebug ?? null;
  const lines = useMemo(() => {
    const s = signal;
    const d = dbg;
    const cap = captureMetrics;
    const cam = cameraDiag;
    const fs =
      s?.estimatedSampleRate && s.estimatedSampleRate > 0
        ? s.estimatedSampleRate.toFixed(1)
        : '—';
    const capHz =
      cap && cap.presentationMedianDeltaMs > 0
        ? (1000 / cap.presentationMedianDeltaMs).toFixed(1)
        : '—';
    return [
      `contact(ext): ${s?.contactState ?? '—'} / ${s?.extendedContactState ?? '—'}`,
      `pressure: ${s?.pressureState ?? '—'}`,
      `source: ${s?.activeSource ?? '—'}  stab ${((s?.sourceStability ?? 0) * 100).toFixed(0)}%`,
      `FPS proc ${fs} Hz  cap Δ ${cap?.presentationMedianDeltaMs?.toFixed(1) ?? '—'}ms (~${capHz} Hz) jitter ${cap?.presentationJitterMs?.toFixed(2) ?? '—'}ms`,
      `capture ${cap?.strategy ?? '—'} lat ${cap?.captureLatencyMs?.toFixed(1) ?? '—'}ms read ${cap?.readbackMs?.toFixed(1) ?? '—'}ms`,
      `SQI ${s?.quality?.toFixed(0) ?? '—'}  PI ${s?.perfusionIndex?.toFixed(2) ?? '—'}`,
      `clip H/L ${((s?.clipHighRatio ?? 0) * 100).toFixed(0)} / ${((s?.clipLowRatio ?? 0) * 100).toFixed(0)}%`,
      `ROI valid ${((s?.roiValidPixelRatio ?? 0) * 100).toFixed(0)}%  maskIoU ${((s?.maskIoU ?? 0) * 100).toFixed(0)}%`,
      `pose canon ${positionQuality.canonicalPoseOk ? 'ok' : 'no'} ${positionQuality.canonicalPoseIssue ?? '—'} | pos Q ${(positionQuality.qualityScore * 100).toFixed(0)}% drift ${positionQuality.positionDrift.toFixed(3)} poseΔ ${(positionQuality.poseAngleDrift ?? 0).toFixed(3)} ok ${positionQuality.poseOptimal ? 'y' : 'n'} ${positionQuality.guidance}`,
      `worker: ${d ? `${d.timing.processedFps.toFixed(0)} fps drop ${d.timing.droppedFrames} stale ${d.stalePipeline ? 'y' : 'n'}` : '—'}`,
      `frames ${framesProcessed} proc ${s?.processingDurationMs?.toFixed(1) ?? '—'}ms`,
      `cam ${cam?.resolution.width ?? 0}x${cam?.resolution.height ?? 0} @${cam?.realFrameRate ?? '—'} torch ${cam?.torchActive ? 'on' : 'off'}`,
      `phases: ${(cam?.phasesApplied ?? []).join(', ') || '—'}`,
    ];
  }, [signal, dbg, captureMetrics, cameraDiag, positionQuality, framesProcessed]);

  return (
    <div
      className="pointer-events-none fixed bottom-2 left-2 z-[200] max-w-[min(100vw-16px,380px)] rounded-md border border-emerald-500/40 bg-black/75 px-2 py-1.5 font-mono text-[10px] leading-snug text-emerald-100 shadow-lg"
      aria-hidden
    >
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
};
