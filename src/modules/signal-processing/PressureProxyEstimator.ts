/**
 * PRESSURE PROXY ESTIMATOR
 * Classifies finger pressure from PPG signal characteristics.
 * Estimador proxy de presión basado en análisis de señal PPG.
 * Combina múltiples características de la onda para inferir estado de presión.
 * NO simulation — pure signal analysis.
 */

import type { PressureState } from '../../types/signal';

export interface PressureEstimate {
  state: PressureState;
  score: number;        // 0-1, where 0.3-0.7 is optimal
  guidance: string;
  penalty: number;      // SQI penalty multiplier (1.0 = no penalty)
}

export class PressureProxyEstimator {
  private scoreEWMA = 0.5;
  private readonly ALPHA = 0.06;
  private stateHoldFrames = 0;
  private currentState: PressureState = 'LOW_PRESSURE';
  private readonly HOLD_MIN = 15; // ~0.5s hysteresis

  estimate(params: {
    coverageRatio: number;
    clipHighRatio: number;
    clipLowRatio: number;
    perfusionIndex: number;
    spatialUniformity: number;
    brightness: number;         // mean total intensity (R+G+B)
    brightnessVariance: number; // variance of brightness across tiles
    baselineDrift: number;      // rate of baseline change
  }): PressureEstimate {
    const {
      coverageRatio, clipHighRatio, clipLowRatio,
      perfusionIndex, spatialUniformity,
      brightness, brightnessVariance, baselineDrift
    } = params;

    // --- Score components (higher = more pressure) ---

    // High brightness + high coverage = strong pressure
    const brightnessFactor = clamp((brightness - 300) / 400, 0, 1) * 0.15;

    // High clipping = over-pressing (sensor saturation)
    const clipFactor = clamp(clipHighRatio * 3, 0, 1) * 0.25;

    // Very high uniformity = blanching (capillary compression)
    const uniformityFactor = clamp((spatialUniformity - 0.85) / 0.15, 0, 1) * 0.15;

    // Low pulsatility = over-compression (AC component crushed)
    const pulsatilityCollapse = clamp(1 - perfusionIndex * 5, 0, 1) * 0.2;

    // Low brightness variance across tiles = flat field = over-pressure
    const flatFieldFactor = clamp(1 - brightnessVariance / 500, 0, 1) * 0.1;

    // Low coverage = not enough pressure
    const lowCoverageFactor = clamp(1 - coverageRatio * 2, 0, 1) * 0.15;

    // Fast baseline drift = pressure changing
    const driftFactor = clamp(baselineDrift * 10, 0, 1) * 0.05;

    // Combine: high values = high pressure
    const rawScore = brightnessFactor + clipFactor + uniformityFactor +
      pulsatilityCollapse + flatFieldFactor - lowCoverageFactor + driftFactor;

    const score = clamp(rawScore, 0, 1);
    this.scoreEWMA = this.scoreEWMA * (1 - this.ALPHA) + score * this.ALPHA;

    // Classify with hysteresis
    let newState: PressureState;
    if (this.scoreEWMA < 0.25) {
      newState = 'LOW_PRESSURE';
    } else if (this.scoreEWMA > 0.65) {
      newState = 'HIGH_PRESSURE';
    } else {
      newState = 'OPTIMAL_PRESSURE';
    }

    // Hysteresis: hold current state for minimum frames
    if (newState !== this.currentState) {
      this.stateHoldFrames++;
      if (this.stateHoldFrames >= this.HOLD_MIN) {
        this.currentState = newState;
        this.stateHoldFrames = 0;
      }
    } else {
      this.stateHoldFrames = 0;
    }

    const guidance = this.currentState === 'LOW_PRESSURE'
      ? 'PRESIONE MÁS FIRME SOBRE LA CÁMARA'
      : this.currentState === 'HIGH_PRESSURE'
        ? 'REDUZCA LA PRESIÓN — DEMASIADO FUERTE'
        : 'PRESIÓN CORRECTA — MANTENGA ASÍ';

    // Penalty optimizado: menos agresivo para LOW_PRESSURE
    // LOW_PRESSURE: 0.7 (antes 0.5) - permite calidad aceptable con presión leve
    // OPTIMAL_PRESSURE: 1.0 - sin penalización
    // HIGH_PRESSURE: 0.4 (antes 0.3) - penalización moderada por sobre-presión
    const penalty = this.currentState === 'OPTIMAL_PRESSURE' ? 1.0
      : this.currentState === 'LOW_PRESSURE' ? 0.7
        : 0.4;

    return {
      state: this.currentState,
      score: this.scoreEWMA,
      guidance,
      penalty,
    };
  }

  reset(): void {
    this.scoreEWMA = 0.5;
    this.currentState = 'LOW_PRESSURE';
    this.stateHoldFrames = 0;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
