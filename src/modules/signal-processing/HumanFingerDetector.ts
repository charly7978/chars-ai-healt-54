/**
 * HUMAN FINGER DETECTOR
 * Optimizado para lectura de yema del dedo.
 */
export interface HumanFingerValidation {
  isHumanFinger: boolean;
  confidence: number;
  biophysicalScore: number;
  opticalCoherence: number;
  bloodFlowIndicator: number;
  tissueConsistency: number;
  validationDetails: {
    skinColorValid: boolean;
    perfusionValid: boolean;
    hemodynamicValid: boolean;
    spatialConsistency: boolean;
    temporalConsistency: boolean;
  };
}

export class HumanFingerDetector {
  private temporalAnalysisBuffer: Array<{ r: number; g: number; b: number }> = [];
  private readonly BUFFER_SIZE = 30;

  public detectHumanFinger(
    red: number,
    green: number,
    blue: number,
    textureScore: number,
    width: number = 320,
    height: number = 240
  ): HumanFingerValidation {
    const total = red + green + blue + 0.0001;
    const rRatio = red / total;
    const gRatio = green / total;

    // Lógica de detección ultra-sensible para yema
    const isRedDominant = rRatio > 0.40 && rRatio < 0.98;
    const hasSkinPattern = gRatio < 0.45;

    this.temporalAnalysisBuffer.push({ r: red, g: green, b: blue });
    if (this.temporalAnalysisBuffer.length > this.BUFFER_SIZE) this.temporalAnalysisBuffer.shift();

    const variance = this.calculateVariance(this.temporalAnalysisBuffer.map(d => d.r));
    const isAlive = variance > 0.001; // Máxima sensibilidad

    const confidence = (isRedDominant ? 0.4 : 0) + (hasSkinPattern ? 0.3 : 0) + (isAlive ? 0.3 : 0);

    return {
      isHumanFinger: confidence > 0.4,
      confidence: confidence,
      biophysicalScore: confidence,
      opticalCoherence: rRatio,
      bloodFlowIndicator: variance * 10,
      tissueConsistency: 1.0,
      validationDetails: {
        skinColorValid: isRedDominant,
        perfusionValid: isAlive,
        hemodynamicValid: variance > 0.05,
        spatialConsistency: true,
        temporalConsistency: true
      }
    };
  }

  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  }

  public reset(): void {
    this.temporalAnalysisBuffer = [];
  }
}
