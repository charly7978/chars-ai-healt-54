/**
 * Máquina de estados de medición por contacto dedo+lente+flash.
 * Histéresis, warmup temporal real (ms), degradación a MEASUREMENT_DEGRADED ante SQI/movimiento.
 */

import type { FingerMeasurementState } from './pipeline-types';
import type { FingerFrameFeatures } from './FingerFrameFeatures';

export interface FingerStateMachineOutput {
  state: FingerMeasurementState;
  confidence: number;
  exportedContact: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';
  measurementReady: boolean;
  warmupProgress01: number;
  persistenceMs: number;
  reason: string;
}

// Tiempos / umbrales relajados para que el contacto sea robusto en uso real:
// el operador suele tener el dedo correctamente sobre lente+flash pero con
// pequeñas variaciones de posición y presión. Antes el FSM tardaba >3s en
// entrar a MEASUREMENT_READY y se caía constantemente.
const WARMUP_MIN_MS = 1200;
const DEGRADED_RECOVER_SQI = 0.30;
const DEGRADED_ENTER_WINDOW_SQI = 0.18;
const MOTION_DEGRADED = 1.20;
const MOTION_UNSTABLE = 0.85;

function clamp01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

export class FingerMeasurementStateMachine {
  private state: FingerMeasurementState = 'NO_CONTACT';
  private stateSinceMs = 0;
  private warmupStartMs = 0;
  private confidenceEwma = 0;

  reset(): void {
    this.state = 'NO_CONTACT';
    this.stateSinceMs = 0;
    this.warmupStartMs = 0;
    this.confidenceEwma = 0;
  }

  /**
   * @param windowSQI score [0..1] desde SignalQualityEngine (ventana previa)
   */
  process(f: FingerFrameFeatures, nowMs: number, windowSQI: number): FingerStateMachineOutput {
    const prev = this.state;
    if (this.stateSinceMs === 0) this.stateSinceMs = nowMs;

    this.confidenceEwma = this.confidenceEwma * 0.88 + f.contactEvidence * 0.12;

    const strongChroma =
      f.redDominance > 12 &&
      f.rgRatio > 1.06 &&
      f.centerCoverage > 0.16 &&
      f.clippingStress < 0.70;
    const partialChroma =
      f.redDominance > 4 &&
      f.rgRatio > 1.01 &&
      f.centerCoverage > 0.06 &&
      f.clippingStress < 0.85;

    const stableGeometry =
      f.spatialUniformity > 0.25 &&
      f.centerCoverage > 0.18 &&
      f.uniformityQuality > 0.22 &&
      f.motionScore < MOTION_UNSTABLE;

    const readyGeometry =
      stableGeometry &&
      f.clippingStress < 0.55 &&
      f.motionScore < 0.70 &&
      f.perfusionProxy > 0.0015 &&
      f.temporalStability > 0.30;

    const enterPartial =
      this.confidenceEwma > 0.12 &&
      partialChroma &&
      f.motionScore < 1.4;

    const enterUnstableFromPartial =
      this.confidenceEwma > 0.22 &&
      strongChroma &&
      f.centerCoverage > 0.12 &&
      f.motionScore < MOTION_UNSTABLE + 0.30;

    // Pérdida de contacto: solo cuando la cámara claramente no ve el dedo.
    // Antes era demasiado sensible: cualquier cambio leve de posición ya
    // mataba el contacto y reiniciaba todo el warmup.
    const loseContact =
      this.confidenceEwma < 0.06 &&
      f.centerCoverage < 0.04 &&
      f.redDominance < 2;

    let next = prev;
    let reason = '';

    switch (prev) {
      case 'NO_CONTACT':
        if (enterPartial) {
          next = 'PARTIAL_CONTACT';
          reason = 'evidencia cromática/espacial parcial';
        }
        break;
      case 'PARTIAL_CONTACT':
        if (loseContact) {
          next = 'NO_CONTACT';
          reason = 'pérdida de evidencia';
        } else if (enterUnstableFromPartial) {
          next = 'CONTACT_UNSTABLE';
          reason = 'contacto detectado, geometría aún inestable';
        }
        break;
      case 'CONTACT_UNSTABLE':
        if (loseContact && f.motionScore < 0.4) {
          next = 'NO_CONTACT';
          reason = 'contacto perdido';
        } else if (stableGeometry) {
          next = 'CONTACT_STABLE_WARMUP';
          reason = 'geometría estable, iniciando warmup';
        } else if (!strongChroma || f.clippingStress > 0.65) {
          next = 'PARTIAL_CONTACT';
          reason = 'retroceso a parcial (clip o cromática)';
        }
        break;
      case 'CONTACT_STABLE_WARMUP': {
        const elapsedWarm = this.warmupStartMs > 0 ? nowMs - this.warmupStartMs : 0;
        if (loseContact) {
          next = 'NO_CONTACT';
          reason = 'perdido en warmup';
        } else if (!stableGeometry) {
          next = 'CONTACT_UNSTABLE';
          reason = 'inestabilidad en warmup';
        } else if (f.motionScore > MOTION_DEGRADED || windowSQI < DEGRADED_ENTER_WINDOW_SQI) {
          next = 'MEASUREMENT_DEGRADED';
          reason = 'movimiento o SQI bajo durante warmup';
        } else if (elapsedWarm >= WARMUP_MIN_MS && readyGeometry && windowSQI >= 0.20) {
          next = 'MEASUREMENT_READY';
          reason = 'warmup OK + SQI mínimo';
        }
        void elapsedWarm;
        break;
      }
      case 'MEASUREMENT_READY':
        if (loseContact) {
          next = 'NO_CONTACT';
          reason = 'contacto perdido';
        } else if (f.motionScore > MOTION_DEGRADED || windowSQI < DEGRADED_ENTER_WINDOW_SQI) {
          next = 'MEASUREMENT_DEGRADED';
          reason = 'SQI ventana o movimiento';
        } else if (!readyGeometry) {
          next = 'CONTACT_UNSTABLE';
          reason = 'geometría ya no lista';
        }
        break;
      case 'MEASUREMENT_DEGRADED':
        if (loseContact) {
          next = 'NO_CONTACT';
          reason = 'sin contacto';
        } else if (readyGeometry && windowSQI >= DEGRADED_RECOVER_SQI && f.motionScore < 0.5) {
          next = 'MEASUREMENT_READY';
          reason = 'recuperación SQI y geometría';
        } else if (!stableGeometry && f.motionScore < 0.55) {
          next = 'CONTACT_UNSTABLE';
          reason = 'degradación estructural';
        }
        break;
    }

    if (next !== prev) {
      this.state = next;
      this.stateSinceMs = nowMs;
      if (next === 'CONTACT_STABLE_WARMUP' && prev !== 'CONTACT_STABLE_WARMUP') {
        this.warmupStartMs = nowMs;
      }
      if (next === 'NO_CONTACT' || next === 'PARTIAL_CONTACT') {
        this.warmupStartMs = 0;
      }
      if (next === 'CONTACT_UNSTABLE' && prev === 'CONTACT_STABLE_WARMUP') {
        this.warmupStartMs = 0;
      }
    }

    const persistenceMs =
      this.warmupStartMs > 0 && (this.state === 'CONTACT_STABLE_WARMUP' || this.state === 'MEASUREMENT_READY')
        ? Math.max(0, nowMs - this.warmupStartMs)
        : 0;

    const warmupProgress01 =
      this.state === 'CONTACT_STABLE_WARMUP' || this.state === 'MEASUREMENT_READY'
        ? clamp01(persistenceMs / WARMUP_MIN_MS)
        : 0;

    const exported: 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT' =
      this.state === 'NO_CONTACT'
        ? 'NO_CONTACT'
        : this.state === 'MEASUREMENT_READY'
          ? 'STABLE_CONTACT'
          : 'UNSTABLE_CONTACT';

    const measurementReady = this.state === 'MEASUREMENT_READY';

    return {
      state: this.state,
      confidence: this.confidenceEwma,
      exportedContact: exported,
      measurementReady,
      warmupProgress01,
      persistenceMs,
      reason: reason || stableReason(this.state),
    };
  }

  getState(): FingerMeasurementState {
    return this.state;
  }
}

function stableReason(s: FingerMeasurementState): string {
  switch (s) {
    case 'NO_CONTACT':
      return 'sin contacto';
    case 'PARTIAL_CONTACT':
      return 'contacto parcial';
    case 'CONTACT_UNSTABLE':
      return 'inestable';
    case 'CONTACT_STABLE_WARMUP':
      return 'warmup';
    case 'MEASUREMENT_READY':
      return 'listo';
    case 'MEASUREMENT_DEGRADED':
      return 'degradado';
    default:
      return '';
  }
}

/** BPM estable solo en MEASUREMENT_READY */
export function shouldGateBpmOutput(state: FingerMeasurementState): boolean {
  return state === 'MEASUREMENT_READY';
}
