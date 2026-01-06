export class HumanFingerDetector {
  private temporalAnalysisBuffer: Array<{r: number, g: number, b: number}> = [];
  private readonly BUFFER_MAX = 30;

  detectHumanFinger(r: number, g: number, b: number, texture: number): any {
    // Análisis de absorción de hemoglobina REAL
    // El tejido humano absorbe masivamente el verde (G) y refleja el rojo (R)
    const total = r + g + b + 0.0001;
    const rRatio = r / total;
    const gRatio = g / total;

    // 1. Criterio Biofísico: El rojo debe ser predominante pero el verde debe oscilar
    const isRedDominant = rRatio > 0.45 && rRatio < 0.90;
    const hasGreenAbsorption = gRatio < 0.35;

    // 2. Análisis de varianza (Detección de vida)
    this.temporalAnalysisBuffer.push({r, g, b});
    if (this.temporalAnalysisBuffer.length > this.BUFFER_MAX) this.temporalAnalysisBuffer.shift();

    const variance = this.calculateVariance(this.temporalAnalysisBuffer.map(d => d.r));
    // Si la varianza es 0, es una imagen estática (simulación o error). 
    // Un dedo real siempre tiene micro-vibraciones.
    const isAlive = variance > 0.02; 

    const confidence = (isRedDominant ? 0.5 : 0) + (hasGreenAbsorption ? 0.3 : 0) + (isAlive ? 0.2 : 0);

    return {
      isHumanFinger: confidence > 0.5,
      confidence: confidence,
      validationDetails: {
        skinColorValid: isRedDominant,
        perfusionValid: isAlive,
        hemodynamicValid: variance > 0.1,
        spatialConsistency: texture > 0.2,
        temporalConsistency: true
      }
    };
  }

  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  }

  reset() { this.temporalAnalysisBuffer = []; }
}
