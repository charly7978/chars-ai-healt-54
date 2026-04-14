/**
 * Máquina de estados de contacto dedo/cámara con histéresis temporal y puntuación agregada.
 * Objetivo: evitar transiciones violentas frame-a-frame.
 */

export type ContactMachineState =
  | 'NO_FINGER'
  | 'ACQUIRING'
  | 'CONTACT_UNSTABLE'
  | 'CONTACT_STABLE'
  | 'SATURATED'
  | 'LOW_PERFUSION'
  | 'EXCESS_PRESSURE';

export interface ContactScoreInput {
  /** Cobertura ROI efectiva 0..1 */
  coverage: number;
  /** Dominancia roja normalizada */
  redDominance: number;
  /** Ratio R/G */
  rgRatio: number;
  /**
   * Ratio R/B — con flash+tejido la hemoglobina atenúa más el azul que objetos neutros/planos.
   * Ref.: patrones típicos rPPG / eliminación de errores de toque en vídeo de yema.
   */
  rbRatio: number;
  clipHigh: number;
  clipLow: number;
  /** Estabilidad espacial de máscara/ROI 0..1 */
  spatialStability: number;
  /** Estabilidad temporal de brillo/cobertura 0..1 */
  temporalStability: number;
  /** Proxy pulsatilidad AC/DC o PI 0..1 scale */
  pulsatilityQuality: number;
  /** Penalización por deriva DC de señal 0..1 */
  dcDriftPenalty: number;
  /** Proxy presión 0..1 (mayor = más compresión) */
  pressureProxy: number;
  /** Detección instantánea tejido vs fondo 0..1 */
  tissueInstant: number;
  /** Clasificador explícito: bloquea STABLE si hay aplastamiento hemodinámico */
  highPressure: boolean;
}

export interface ContactStateOutput {
  state: ContactMachineState;
  /** Confianza agregada 0..1 para telemetría */
  aggregateScore: number;
  /** Frames en el estado actual */
  dwellFrames: number;
}

const HOLD: Record<ContactMachineState, number> = {
  NO_FINGER: 4,
  ACQUIRING: 7,
  CONTACT_UNSTABLE: 11,
  /** Más frames para confirmar dedo real vs falso positivo (superficies rojizas) */
  CONTACT_STABLE: 17,
  SATURATED: 8,
  LOW_PERFUSION: 10,
  EXCESS_PRESSURE: 8,
};

export class ContactStateMachine {
  private state: ContactMachineState = 'NO_FINGER';
  private pending: ContactMachineState | null = null;
  private pendingFrames = 0;
  private dwell = 0;
  private emaScore = 0;

  reset(): void {
    this.state = 'NO_FINGER';
    this.pending = null;
    this.pendingFrames = 0;
    this.dwell = 0;
    this.emaScore = 0;
  }

  getState(): ContactMachineState {
    return this.state;
  }

  private computeAggregate(i: ContactScoreInput): number {
    const clipPen = Math.min(1, (i.clipHigh * 2.2 + i.clipLow * 1.4));
    const rb = i.rbRatio > 0.5 ? i.rbRatio : 0;
    const rbTerm =
      rb > 1.03 ? Math.max(0, Math.min(1, (rb - 1.03) / 0.55)) * 0.1 : 0;
    const base =
      i.coverage * 0.2 +
      Math.max(0, Math.min(1, (i.redDominance - 0.045) / 0.3)) * 0.15 +
      Math.max(0, Math.min(1, (i.rgRatio - 1.06) / 0.3)) * 0.13 +
      i.spatialStability * 0.12 +
      i.temporalStability * 0.11 +
      i.pulsatilityQuality * 0.17 +
      i.tissueInstant * 0.14 +
      rbTerm -
      clipPen * 0.4 -
      i.dcDriftPenalty * 0.12;

    const pressure = i.pressureProxy;
    let pressureAdj = 0;
    if (pressure > 0.72) pressureAdj -= (pressure - 0.72) * 0.8;
    else if (pressure < 0.22) pressureAdj -= (0.22 - pressure) * 0.5;

    return Math.max(0, Math.min(1, base + pressureAdj));
  }

  private desiredState(i: ContactScoreInput, agg: number): ContactMachineState {
    if (i.highPressure) {
      if (i.clipHigh > 0.1 || i.pressureProxy > 0.62) return 'EXCESS_PRESSURE';
      return 'CONTACT_UNSTABLE';
    }
    if (i.clipHigh > 0.38 || (i.clipHigh > 0.28 && i.redDominance < 0.08)) return 'SATURATED';
    if (i.pressureProxy > 0.78 && i.clipHigh > 0.12) return 'EXCESS_PRESSURE';
    if (i.pulsatilityQuality < 0.06 && i.coverage > 0.14 && i.tissueInstant > 0.35) return 'LOW_PERFUSION';

    const rb = i.rbRatio > 0.5 ? i.rbRatio : 0;

    /** Fondo / plano sin firma sangre: R≈G≈B */
    if (rb > 0.5 && rb < 1.02 && i.rgRatio < 1.14 && i.coverage > 0.1) return 'NO_FINGER';
    /** Aire / ambiente: poca firma R>G */
    if (i.rgRatio < 1.07 && i.redDominance < 0.1) return 'NO_FINGER';
    if (i.redDominance < 0.038 && i.coverage < 0.16) return 'NO_FINGER';
    if (i.tissueInstant < 0.2 && i.coverage < 0.13) return 'NO_FINGER';
    /** Tejido dudoso: coherencia “instantánea” alta pero color no cardíaco */
    if (i.tissueInstant < 0.24 && i.rgRatio < 1.12) return 'NO_FINGER';

    if (agg < 0.35) return 'NO_FINGER';
    if (agg < 0.48) return 'ACQUIRING';
    if (i.temporalStability < 0.41 || i.spatialStability < 0.35) return 'CONTACT_UNSTABLE';
    /**
     * Contacto estable: exige firma cromática + pulsatilidad + tejido (menos FP que superficies rojizas).
     */
    const rbOk = rb < 0.5 || rb >= 1.035;
    if (
      agg >= 0.64 &&
      i.pulsatilityQuality >= 0.14 &&
      i.tissueInstant >= 0.28 &&
      i.rgRatio >= 1.12 &&
      rbOk &&
      i.spatialStability >= 0.36 &&
      i.temporalStability >= 0.41
    ) {
      return 'CONTACT_STABLE';
    }
    return 'CONTACT_UNSTABLE';
  }

  update(input: ContactScoreInput): ContactStateOutput {
    const aggRaw = this.computeAggregate(input);
    this.emaScore = this.emaScore === 0 ? aggRaw : this.emaScore * 0.82 + aggRaw * 0.18;
    const agg = this.emaScore;

    const want = this.desiredState(input, agg);

    if (want === this.state) {
      this.pending = null;
      this.pendingFrames = 0;
      this.dwell++;
      return { state: this.state, aggregateScore: agg, dwellFrames: this.dwell };
    }

    if (this.pending !== want) {
      this.pending = want;
      this.pendingFrames = 1;
    } else {
      this.pendingFrames++;
    }

    const need = HOLD[want] ?? 8;
    if (this.pending === want && this.pendingFrames >= need) {
      this.state = want;
      this.pending = null;
      this.pendingFrames = 0;
      this.dwell = 1;
    }

    return { state: this.state, aggregateScore: agg, dwellFrames: this.dwell };
  }
}
