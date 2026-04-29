/**
 * ChromaticGate - Validación cromática de tejido perfundido
 * 
 * Basado en literatura:
 * - Lovisotto 2020 "Seeing Red" CVPRW
 * - Coppetti 2017 fingertip PPG validation
 * - Pereira 2020 npj Digital Medicine
 * 
 * Los umbrales detectan tejido vivo perfundido vs objetos inanimados.
 * Usa histéresis (attack/release) para tolerar valles fisiológicos.
 */

import {
  CHROMA_ATK_MEAN_R,
  CHROMA_ATK_R_OVER_MAX,
  CHROMA_ATK_R_MINUS_MAX,
  CHROMA_ATK_DC_RED,
  CHROMA_REL_MEAN_R,
  CHROMA_REL_R_OVER_MAX,
  CHROMA_REL_R_MINUS_MAX,
  CHROMA_REL_DC_RED,
  CHROMA_EMA_ALPHA,
  DC_RED_MIN_FOR_VALIDATION,
} from "@/constants/physics";

export interface ChromaEmaState {
  meanR: number;
  rOverMax: number;
  rMinusMax: number;
  dcRed: number;
  initialized: boolean;
}

export interface ChromaInput {
  meanR: number;
  meanG: number;
  redDC: number;
}

export interface ChromaResult {
  ok: boolean;
  engaged: boolean;
  ema: ChromaEmaState;
  metrics: {
    rOverMax: number;
    rMinusMax: number;
  };
}

/**
 * Inicializa el estado EMA cromático
 */
export const createChromaEma = (): ChromaEmaState => ({
  meanR: 0,
  rOverMax: 0,
  rMinusMax: 0,
  dcRed: 0,
  initialized: false,
});

/**
 * Calcula métricas cromáticas del frame actual
 */
export const computeChromaMetrics = (input: ChromaInput) => {
  const maxNonRed = Math.max(input.meanG, 1);
  return {
    rOverMax: input.meanR / maxNonRed,
    rMinusMax: input.meanR - maxNonRed,
    dcRed: input.redDC > DC_RED_MIN_FOR_VALIDATION ? input.redDC : input.meanR,
  };
};

/**
 * Actualiza EMA cromático con nuevos valores
 */
export const updateChromaEma = (
  ema: ChromaEmaState,
  input: ChromaInput,
  metrics: ReturnType<typeof computeChromaMetrics>
): ChromaEmaState => {
  const a = CHROMA_EMA_ALPHA;
  
  if (!ema.initialized) {
    return {
      meanR: input.meanR,
      rOverMax: metrics.rOverMax,
      rMinusMax: metrics.rMinusMax,
      dcRed: metrics.dcRed,
      initialized: true,
    };
  }

  return {
    meanR: ema.meanR * (1 - a) + input.meanR * a,
    rOverMax: ema.rOverMax * (1 - a) + metrics.rOverMax * a,
    rMinusMax: ema.rMinusMax * (1 - a) + metrics.rMinusMax * a,
    dcRed: ema.dcRed * (1 - a) + metrics.dcRed * a,
    initialized: true,
  };
};

/**
 * Evalúa umbrales cromáticos con histéresis
 */
export const evaluateChromaticThresholds = (
  ema: ChromaEmaState,
  engaged: boolean
): { attack: boolean; release: boolean } => {
  const attackOk =
    ema.meanR >= CHROMA_ATK_MEAN_R &&
    ema.rOverMax >= CHROMA_ATK_R_OVER_MAX &&
    ema.rMinusMax >= CHROMA_ATK_R_MINUS_MAX &&
    ema.dcRed >= CHROMA_ATK_DC_RED;

  const releaseOk =
    ema.meanR >= CHROMA_REL_MEAN_R &&
    ema.rOverMax >= CHROMA_REL_R_OVER_MAX &&
    ema.rMinusMax >= CHROMA_REL_R_MINUS_MAX &&
    ema.dcRed >= CHROMA_REL_DC_RED;

  return { attack: attackOk, release: releaseOk };
};

/**
 * Procesa un frame y determina validez cromática
 * Implementa máquina de estados con histéresis
 */
export const processChromaticFrame = (
  ema: ChromaEmaState,
  engaged: boolean,
  input: ChromaInput
): ChromaResult => {
  const metrics = computeChromaMetrics(input);
  const newEma = updateChromaEma(ema, input, metrics);
  const thresholds = evaluateChromaticThresholds(newEma, engaged);

  // Máquina de estados con histéresis
  let newEngaged = engaged;
  let ok: boolean;

  if (engaged) {
    ok = thresholds.release;
    if (!thresholds.release) newEngaged = false;
  } else {
    ok = thresholds.attack;
    if (thresholds.attack) newEngaged = true;
  }

  return {
    ok,
    engaged: newEngaged,
    ema: newEma,
    metrics,
  };
};
