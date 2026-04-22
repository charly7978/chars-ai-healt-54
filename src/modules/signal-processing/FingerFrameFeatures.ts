/**
 * Agrega métricas por frame para la máquina de estados de contacto.
 * Todas las entradas provienen de medición real sobre píxeles / ROIs.
 */

export interface FingerFrameFeatureInput {
  centerCoverage: number;
  spatialUniformity: number;
  clipHighRatioR: number;
  clipHighRatioG: number;
  clipHighRatioB: number;
  clipLowRatio: number;
  redDominance: number;
  greenUsability: number;
  rgRatio: number;
  temporalStability: number;
  perfusionProxy: number;
  motionScore: number;
  globalBrightness: number;
  roiScoreSpread: number;
}

export interface FingerFrameFeatures extends FingerFrameFeatureInput {
  /** Combinación ponderada [0..1] para umbral de contacto parcial vs ausente */
  contactEvidence: number;
  /** [0..1] homogeneidad sin saturación total */
  uniformityQuality: number;
  /** Penalización por clipping combinada [0..1], mayor es peor */
  clippingStress: number;
}

function clamp01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/**
 * greenUsability: verde usable si no está recortado alto y aporta pulsos relativos al rojo.
 */
export function buildFingerFrameFeatures(input: FingerFrameFeatureInput): FingerFrameFeatures {
  const clipRgb = Math.max(input.clipHighRatioR, input.clipHighRatioG, input.clipHighRatioB);
  const clippingStress = clamp01(clipRgb * 1.4 + input.clipLowRatio * 0.8);

  const satPenalty = input.globalBrightness > 720 ? clamp01((input.globalBrightness - 720) / 200) : 0;
  const uniformityQuality = clamp01(
    input.spatialUniformity * (1 - satPenalty) * (1 - clippingStress * 0.85)
  );

  const chromaFinger =
    clamp01((input.redDominance - 6) / 55) * 0.22 +
    clamp01((input.rgRatio - 1.02) / 0.45) * 0.2 +
    clamp01(input.greenUsability) * 0.12;

  const coveragePart = clamp01((input.centerCoverage - 0.12) / 0.55) * 0.18;
  const stabilityPart = clamp01(input.temporalStability) * 0.14;
  const perfPart = clamp01(input.perfusionProxy / 0.08) * 0.1;
  const motionPenalty = clamp01(input.motionScore / 1.8);

  const contactEvidence = clamp01(
    chromaFinger + coveragePart + stabilityPart + perfPart - motionPenalty * 0.35 - clippingStress * 0.4
  );

  return { ...input, contactEvidence, uniformityQuality, clippingStress };
}
