import React from 'react';

/**
 * Debug overlay for PPG pipeline telemetry.
 * Only rendered when ?ppgDebug query param is present.
 */
interface PPGPipelineDebugOverlayProps {
  signal: Record<string, unknown> | null;
  positionQuality: Record<string, unknown> | null;
  captureMetrics: Record<string, unknown> | null;
  cameraDiag: Record<string, unknown> | null;
  framesProcessed: number;
}

export const PPGPipelineDebugOverlay: React.FC<PPGPipelineDebugOverlayProps> = ({
  signal,
  positionQuality,
  captureMetrics,
  cameraDiag,
  framesProcessed,
}) => {
  if (!signal) return null;

  const pq = positionQuality ?? {};
  const cm = captureMetrics ?? {};
  const cd = cameraDiag ?? {};

  return (
    <div
      className="pointer-events-none fixed left-1 top-[max(3.5rem,env(safe-area-inset-top))] z-[45] max-h-[40vh] max-w-[min(100vw-0.5rem,20rem)] overflow-y-auto rounded-lg border border-slate-700/60 bg-slate-950/90 px-2 py-1.5 font-mono text-[9px] leading-tight text-slate-300 backdrop-blur-sm"
    >
      <div className="mb-0.5 font-bold text-cyan-400">PPG PIPELINE DEBUG</div>
      <div>frames: {framesProcessed}</div>
      <div>Q: {(signal.quality ?? 0).toFixed(0)} | PI: {(signal.perfusionIndex ?? 0).toFixed(2)}</div>
      <div>contact: {signal.contactState} | ext: {signal.extendedContactState}</div>
      <div>source: {signal.activeSource} | stability: {(signal.sourceStability ?? 0).toFixed(2)}</div>
      <div>Fs: {(signal.estimatedSampleRate ?? 0).toFixed(1)} | realFps: {(signal.realFps ?? 0).toFixed(1)}</div>
      <div>clip H/L: {(signal.clipHighRatio ?? 0).toFixed(3)} / {(signal.clipLowRatio ?? 0).toFixed(3)}</div>
      <div>maskIoU: {(signal.maskIoU ?? 0).toFixed(3)} | roiCov: {(signal.roiCoverage ?? 0).toFixed(3)}</div>
      <div>pressure: {signal.pressureState ?? '?'}</div>
      <div className="mt-0.5 text-amber-400">POSITION</div>
      <div>locked: {pq.locked ? 'YES' : 'no'} | drifting: {pq.drifting ? 'YES' : 'no'}</div>
      <div>drift: {(pq.positionDrift ?? 0).toFixed(3)} | pose: {pq.canonicalPoseOk ? 'OK' : pq.canonicalPoseIssue}</div>
      <div>qScore: {(pq.qualityScore ?? 0).toFixed(3)}</div>
      {cm.inputFps != null && (
        <>
          <div className="mt-0.5 text-green-400">CAPTURE</div>
          <div>inFps: {(cm.inputFps ?? 0).toFixed(1)} | strategy: {cm.strategy}</div>
          <div>latency: {(cm.captureLatencyMs ?? 0).toFixed(1)}ms | jitter: {(cm.presentationJitterMs ?? 0).toFixed(1)}ms</div>
          <div>kalmanFs: {(cm.kalmanSampleRateHz ?? 0).toFixed(2)} | conf: {(cm.timingConfidence ?? 0).toFixed(2)}</div>
        </>
      )}
      {cd.deviceLabel && (
        <>
          <div className="mt-0.5 text-purple-400">CAMERA</div>
          <div>{cd.deviceLabel}</div>
          <div>res: {cd.resolution?.width ?? '?'}x{cd.resolution?.height ?? '?'} @ {(cd.realFrameRate ?? 0).toFixed(0)}</div>
          <div>torch: {cd.torchActive ? 'ON' : 'off'} | iso: {cd.isoValue ?? '?'}</div>
        </>
      )}
    </div>
  );
};
