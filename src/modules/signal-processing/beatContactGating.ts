import type { HeartBeatResult } from '../../types/beat';
import type { ContactState, ProcessedSignal } from '../../types/signal';

/**
 * Histéresis compartida (ElitePPGProcessor + UI): evita que un frame malo corte
 * la cadena de latidos; requiere varios frames buenos para enganchar y varios
 * malos consecutivos para soltar (Schmitt con retención).
 */
export class BeatMeasurementGate {
  private onStreak = 0;
  private offStreak = 0;
  private latched = false;

  constructor(
    private readonly onFrames = 2,
    private readonly offFrames = 22
  ) {}

  reset(): void {
    this.onStreak = 0;
    this.offStreak = 0;
    this.latched = false;
  }

  /** true = medición de latidos activa (incluye ventana de retención tras glitches). */
  update(rawOk: boolean): boolean {
    if (rawOk) {
      this.offStreak = 0;
      this.onStreak = Math.min(255, this.onStreak + 1);
      if (!this.latched && this.onStreak >= this.onFrames) {
        this.latched = true;
      }
    } else {
      this.onStreak = 0;
      if (this.latched) {
        this.offStreak = Math.min(255, this.offStreak + 1);
        if (this.offStreak >= this.offFrames) {
          this.latched = false;
          this.offStreak = 0;
        }
      }
    }
    if (!this.latched) return false;
    return rawOk || this.offStreak < this.offFrames;
  }
}

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
  /**
   * No repetir `canonicalPoseOk` aquí: entra en conflicto con el latch de
   * `measurementReady` (histéresis ON/OFF) — un frame puede tener pose OK en el
   * criterio de medición latchado y `canonicalPoseOk` instantáneo false.
   * La pose ya se exige dentro de `computeMeasurementReadyRaw` antes del latch.
   */
  if (s.measurementReady !== true) return false;

  // V2: Umbrales relajados para compatibilidad con SignalExtractionEngine V4
  const perf = s.perfusionIndex ?? 0;
  if (perf < 1.4) return false;
  if ((s.quality ?? 0) < 14) return false;

  const rr = s.rawRed ?? 0;
  const gg = s.rawGreen ?? 1;
  const bb = s.rawBlue ?? 0;
  if (rr < 42 || gg < 5) return false;
  if (rr / Math.max(gg, 1) < 1.04) return false;
  /** Rechazo objetos neutros (R≈G≈B) — tejido+flash suele R/B > 1 */
  if (bb > 3 && rr / bb < 1.02) return false;

  const ch = s.clipHighRatio ?? 0;
  if (ch > 0.25) return false;

  const cov = s.roiCoverage ?? 0;
  if (cov < 0.16) return false;

  const iou = s.maskIoU ?? 1;
  if (iou < 0.18) return false;

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
