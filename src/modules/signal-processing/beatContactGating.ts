import type { HeartBeatResult } from '../../types/beat';
import type { ContactState, ProcessedSignal } from '../../types/signal';

/**
 * Misma regla en ElitePPGProcessor e Index: latidos solo con señal 100 % atribuible
 * al pipeline cámara+flash (sin atajos que acepten aire / ambiente como "estable").
 *
 * Antes: `perf > 0.024` era incompatible con la escala real de PI (~0–20+) → casi siempre true.
 */
export function stableForBeatsFromSignal(s: ProcessedSignal): boolean {
  if (s.motionArtifact) return false;
  if (!s.fingerDetected) return false;
  if (s.contactState !== 'STABLE_CONTACT') return false;
  if (s.measurementReady !== true) return false;

  const perf = s.perfusionIndex ?? 0;
  if (perf < 2.2) return false;
  if ((s.quality ?? 0) < 24) return false;

  const rr = s.rawRed ?? 0;
  const gg = s.rawGreen ?? 1;
  const bb = s.rawBlue ?? 0;
  if (rr < 62 || gg < 8) return false;
  if (rr / Math.max(gg, 1) < 1.1) return false;
  /** Rechazo objetos neutros (R≈G≈B) — tejido+flash suele R/B > 1 */
  if (bb > 3 && rr / bb < 1.05) return false;

  const ch = s.clipHighRatio ?? 0;
  if (ch > 0.2) return false;

  const cov = s.roiCoverage ?? 0;
  if (cov < 0.22) return false;

  const iou = s.maskIoU ?? 1;
  if (iou < 0.28) return false;

  return true;
}

export function beatContactFromSignal(s: ProcessedSignal): ContactState {
  return stableForBeatsFromSignal(s) ? 'STABLE_CONTACT' : 'NO_CONTACT';
}

/** Resultado neutro cuando aún no hay latido procesado (primer frame). */
export function emptyHeartBeatResult(bpm: number): HeartBeatResult {
  return {
    bpm,
    bpmConfidence: 0,
    isPeak: false,
    filteredValue: 0,
    arrhythmiaCount: 0,
    sqi: 0,
    beatSQI: 0,
    rrData: { intervals: [], lastPeakTime: null },
    hypothesis: null,
    detectorAgreement: 0,
    rejectionReason: '',
    beatFlags: null,
    debug: {
      instantBpm: 0,
      medianRRBpm: 0,
      autocorrBpm: 0,
      spectralBpm: 0,
      lastBeatSQI: 0,
      detectorAgreement: 0,
      expectedRR: 0,
      refractoryState: 'open',
      beatsAccepted: 0,
      beatsRejected: 0,
      lastRejectionReason: '',
      doublePeakCount: 0,
      missedBeatCount: 0,
      suspiciousCount: 0,
      templateCorrelation: 0,
      morphologyScore: 0,
      consecutivePeaks: 0,
    },
  };
}
