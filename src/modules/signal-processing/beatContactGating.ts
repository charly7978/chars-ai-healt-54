import type { HeartBeatResult } from '../../types/beat';
import type { ContactState, ProcessedSignal } from '../../types/signal';

/**
 * Misma regla en ElitePPGProcessor e Index: latidos solo con contacto estable real
 * (measurementReady o STABLE_CONTACT + calidad + perfusión).
 */
export function stableForBeatsFromSignal(s: ProcessedSignal): boolean {
  const perf = s.perfusionIndex ?? 0;
  return (
    s.measurementReady === true ||
    (s.contactState === 'STABLE_CONTACT' &&
      s.fingerDetected &&
      !s.motionArtifact &&
      (s.quality ?? 0) >= 14 &&
      perf > 0.024)
  );
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
