/**
 * MEASUREMENT STATE MACHINE — Orquesta el flujo completo de medición.
 *
 * IDLE → PLACING_FINGER → STABILIZING_CONTACT → CAPTURING_SIGNAL →
 * VALIDATING_BEATS → READING_RELIABLE / READING_INVALID
 */
import { PPG_CONFIG } from '../config/ppgConfig';
import type {
  MeasurementPhase,
  MeasurementState,
  FingerContactState,
  QualityLevel,
  InvalidReason,
} from '../types/ppg-types';

const PUB = PPG_CONFIG.publication;
const FINGER = PPG_CONFIG.finger;

export class MeasurementStateMachine {
  private phase: MeasurementPhase = 'IDLE';
  private startTime = 0;
  private stableContactStart = 0;
  private lastBPM = 0;
  private lastBPMConfidence = 0;
  private bpmStale = false;

  start(): void {
    this.phase = 'PLACING_FINGER';
    this.startTime = Date.now();
    this.stableContactStart = 0;
    this.lastBPM = 0;
    this.lastBPMConfidence = 0;
    this.bpmStale = false;
  }

  stop(): void {
    this.phase = 'IDLE';
  }

  update(
    contactState: FingerContactState,
    qualityLevel: QualityLevel,
    qualityScore: number,
    bpm: number,
    bpmConfidence: number,
    bpmIsStale: boolean,
    consecutiveBeats: number,
    invalidReasons: InvalidReason[],
    warmupProgress: number,
  ): MeasurementState {
    if (this.phase === 'IDLE') {
      return this.buildState(invalidReasons, warmupProgress, bpmIsStale);
    }

    const now = Date.now();
    const elapsed = now - this.startTime;

    // Phase transitions
    switch (this.phase) {
      case 'PLACING_FINGER':
        if (contactState === 'CONTACT_OK_WARMING_UP' || contactState === 'MEASURING_VALID') {
          this.phase = 'STABILIZING_CONTACT';
          this.stableContactStart = now;
        } else if (contactState === 'UNSTABLE_CONTACT' || contactState === 'PARTIAL_CONTACT') {
          // Stay in placing
        }
        break;

      case 'STABILIZING_CONTACT':
        if (contactState === 'SEARCHING_FINGER' || contactState === 'NO_CAMERA') {
          this.phase = 'PLACING_FINGER';
          this.stableContactStart = 0;
        } else if (contactState === 'MEASURING_VALID' || contactState === 'CONTACT_OK_WARMING_UP') {
          const stableMs = now - this.stableContactStart;
          if (stableMs >= FINGER.warmupStableMs) {
            this.phase = 'CAPTURING_SIGNAL';
          }
        } else {
          // Unstable — restart timer
          this.stableContactStart = now;
        }
        break;

      case 'CAPTURING_SIGNAL':
        if (contactState === 'SEARCHING_FINGER' || contactState === 'NO_CAMERA') {
          this.phase = 'PLACING_FINGER';
        } else if (consecutiveBeats >= 3 && qualityScore >= PPG_CONFIG.quality.poorThreshold) {
          this.phase = 'VALIDATING_BEATS';
        }
        break;

      case 'VALIDATING_BEATS':
        if (contactState === 'SEARCHING_FINGER' || contactState === 'NO_CAMERA') {
          this.phase = 'PLACING_FINGER';
        } else if (bpm > 0 && bpmConfidence > PUB.detectorAgreementMin
          && consecutiveBeats >= PUB.minBeatsForFirstBPM
          && qualityLevel !== 'UNUSABLE') {
          this.phase = 'READING_RELIABLE';
          this.lastBPM = bpm;
          this.lastBPMConfidence = bpmConfidence;
        } else if (qualityLevel === 'UNUSABLE' || qualityLevel === 'POOR') {
          this.phase = 'READING_INVALID';
        }
        break;

      case 'READING_RELIABLE':
        if (contactState === 'SEARCHING_FINGER' || contactState === 'NO_CAMERA') {
          this.phase = 'PLACING_FINGER';
          this.lastBPM = 0;
        } else if (qualityLevel === 'UNUSABLE') {
          this.phase = 'READING_INVALID';
        } else {
          if (bpm > 0) {
            this.lastBPM = bpm;
            this.lastBPMConfidence = bpmConfidence;
          }
        }
        break;

      case 'READING_INVALID':
        if (contactState === 'SEARCHING_FINGER' || contactState === 'NO_CAMERA') {
          this.phase = 'PLACING_FINGER';
        } else if (qualityLevel === 'GOOD' || qualityLevel === 'MODERATE') {
          this.phase = 'VALIDATING_BEATS';
        }
        break;
    }

    this.bpmStale = bpmIsStale;

    return this.buildState(invalidReasons, warmupProgress, bpmIsStale);
  }

  private buildState(invalidReasons: InvalidReason[], warmupProgress: number, bpmIsStale: boolean): MeasurementState {
    const now = Date.now();
    const elapsed = this.startTime > 0 ? now - this.startTime : 0;
    const stableMs = this.stableContactStart > 0 ? now - this.stableContactStart : 0;

    let semaphore: 'red' | 'yellow' | 'green';
    let instruction: string;

    switch (this.phase) {
      case 'IDLE':
        semaphore = 'red'; instruction = 'Presiona INICIAR'; break;
      case 'PLACING_FINGER':
        semaphore = 'red'; instruction = 'Colocando dedo...'; break;
      case 'STABILIZING_CONTACT':
        semaphore = 'yellow'; instruction = 'Estabilizando contacto...'; break;
      case 'CAPTURING_SIGNAL':
        semaphore = 'yellow'; instruction = 'Captando señal PPG...'; break;
      case 'VALIDATING_BEATS':
        semaphore = 'yellow'; instruction = 'Validando latidos...'; break;
      case 'READING_RELIABLE':
        semaphore = 'green'; instruction = 'Lectura confiable'; break;
      case 'READING_INVALID':
        semaphore = 'red';
        instruction = invalidReasons.length > 0
          ? `Sin lectura: ${this.translateReason(invalidReasons[0])}`
          : 'Señal no confiable';
        break;
      default:
        semaphore = 'red'; instruction = '';
    }

    return {
      phase: this.phase,
      contactState: 'SEARCHING_FINGER', // Will be overridden by caller
      qualityLevel: 'UNUSABLE',          // Will be overridden
      bpm: this.lastBPM,
      bpmConfidence: this.lastBPMConfidence,
      bpmIsStale,
      warmupProgress,
      stableContactMs: stableMs,
      elapsedMs: elapsed,
      invalidReasons,
      instruction,
      semaphore,
    };
  }

  private translateReason(reason: InvalidReason): string {
    const map: Record<InvalidReason, string> = {
      'excessive_motion': 'movimiento excesivo',
      'poor_contact': 'mal contacto del dedo',
      'low_perfusion': 'perfusión baja',
      'clipping': 'saturación de señal',
      'unstable_fps': 'cámara inestable',
      'insufficient_beats': 'pocos latidos detectados',
      'inconsistent_peak_sets': 'latidos inconsistentes',
      'ambient_light_contamination': 'luz ambiente',
      'warmup_not_completed': 'calentamiento pendiente',
      'flatline': 'señal plana',
      'detector_disagreement': 'detectores no coinciden',
      'signal_too_weak': 'señal muy débil',
      'overpressure': 'presión excesiva',
    };
    return map[reason] || reason;
  }

  getPhase(): MeasurementPhase { return this.phase; }

  reset(): void {
    this.phase = 'IDLE';
    this.startTime = 0;
    this.stableContactStart = 0;
    this.lastBPM = 0;
    this.lastBPMConfidence = 0;
    this.bpmStale = false;
  }
}
