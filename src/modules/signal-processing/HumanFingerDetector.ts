/**
 * HUMAN FINGER DETECTOR - OPTIMIZADO PARA YEMA DEL DEDO
 * Ajustado para alta sensibilidad con flash activo (luz roja intensa).
 */
export interface HumanFingerValidation {
  isHumanFinger: boolean;
  confidence: number;
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
  private lastValidTime = 0;

  /**
   * Detecta si hay un dedo humano presente analizando la absorción de luz en la yema.
   */
  public detectHumanFinger(
    r: number,
    g: number,
    b: number,
    textureScore: number
  ): HumanFingerValidation {
    // 1. NORMALIZACIÓN Y RATIOS
    const total = r + g + b + 0.0001;
    const rRatio = r / total;
    const gRatio = g / total;

    // 2. CRITERIOS DE COLOR DE PIEL (YEMA CON FLASH)
    // El flash hace que el rojo domine masivamente (rRatio alto).
    // Relajamos el límite superior para permitir saturación de la cámara.
    const isRedDominant = rRatio > 0.40 && rRatio < 0.98;
    
    // La yema absorbe verde, pero con flash fuerte, el sensor capta algo de verde/amarillo.
    const hasSkinSpectralPattern = gRatio < 0.45 && r > g;

    // 3. ANÁLISIS DE VIDA (PERFUSIÓN)
    this.updateBuffer(r, g, b);
    const variance = this.calculateVariance(this.temporalAnalysisBuffer.map(d => d.r));
    
    // Un dedo real siempre tiene micro-oscilaciones (ruido térmico + pulso).
    // Bajamos el umbral para detectar pulsos débiles en la yema.
    const hasPerfusion = variance > 0.005; 

    // 4. CÁLCULO DE CONFIANZA
    let confidence = 0;
    if (isRedDominant) confidence += 0.4;
    if (hasSkinSpectralPattern) confidence += 0.3;
    if (hasPerfusion) confidence += 0.3;

    // 5. LÓGICA DE DECISIÓN
    const isDetected = confidence > 0.45; // Umbral de entrada más bajo

    if (isDetected) {
      this.lastValidTime = Date.now();
    }

    return {
      isHumanFinger: isDetected,
      confidence: confidence,
      validationDetails: {
        skinColorValid: isRedDominant && hasSkinSpectralPattern,
        perfusionValid: hasPerfusion,
        hemodynamicValid: variance > 0.05,
        spatialConsistency: textureScore > 0.15, // Umbral de textura reducido
        temporalConsistency: true
      }
    };
  }

  private updateBuffer(r: number, g: number, b: number) {
    this.temporalAnalysisBuffer.push({ r, g, b });
    if (this.temporalAnalysisBuffer.length > this.BUFFER_SIZE) {
      this.temporalAnalysisBuffer.shift();
    }
  }

  private calculateVariance(values: number[]): number {
    if (values.length < 5) return 0.1; // Valor por defecto durante carga
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  }

  public reset(): void {
    this.temporalAnalysisBuffer = [];
    this.lastValidTime = 0;
  }
}
