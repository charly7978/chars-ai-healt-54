/**
 * HUMAN FINGER DETECTOR - DETECCIÓN REAL DE DEDO
 * Algoritmo mejorado para detectar yema del dedo sobre la cámara
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
  private temporalBuffer: Array<{ r: number; g: number; b: number; luminance: number }> = [];
  private readonly BUFFER_SIZE = 45; // 1.5 segundos a 30fps
  private readonly MIN_SAMPLES_FOR_DETECTION = 10;
  
  // Umbrales calibrados para yema del dedo cubriendo flash
  private readonly FINGER_RED_MIN = 0.38;
  private readonly FINGER_RED_MAX = 0.85;
  private readonly FINGER_GREEN_MAX = 0.40;
  private readonly MIN_LUMINANCE = 60;
  private readonly MAX_LUMINANCE = 250;
  private readonly MIN_VARIANCE = 0.0005; // Señal viva mínima

  /**
   * Detecta si hay un dedo humano sobre la cámara
   */
  public detectHumanFinger(
    red: number,
    green: number,
    blue: number,
    textureScore: number = 0,
    width: number = 320,
    height: number = 240
  ): HumanFingerValidation {
    // Calcular proporciones de color
    const total = red + green + blue + 0.0001;
    const rRatio = red / total;
    const gRatio = green / total;
    const bRatio = blue / total;
    
    // Calcular luminancia
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    
    // Agregar al buffer temporal
    this.temporalBuffer.push({ r: red, g: green, b: blue, luminance });
    if (this.temporalBuffer.length > this.BUFFER_SIZE) {
      this.temporalBuffer.shift();
    }

    // Validaciones individuales
    
    // 1. Color de piel con sangre (flash encendido = rojo dominante)
    const isRedDominant = rRatio >= this.FINGER_RED_MIN && rRatio <= this.FINGER_RED_MAX;
    const hasLowGreen = gRatio <= this.FINGER_GREEN_MAX;
    const skinColorValid = isRedDominant && hasLowGreen;
    
    // 2. Luminancia en rango esperado (ni muy oscuro ni saturado)
    const luminanceValid = luminance >= this.MIN_LUMINANCE && luminance <= this.MAX_LUMINANCE;
    
    // 3. Variabilidad temporal (señal viva - pulso real)
    const perfusionValid = this.checkTemporalVariability();
    
    // 4. Coherencia hemodinámica (variaciones coordinadas en R y G)
    const hemodynamicValid = this.checkHemodynamicCoherence();
    
    // 5. Consistencia espacial (asumimos que la imagen es uniforme si es un dedo)
    const spatialConsistency = this.checkSpatialConsistency(rRatio, gRatio, bRatio);
    
    // 6. Consistencia temporal (valores estables en el tiempo)
    const temporalConsistency = this.checkTemporalConsistency();

    // Calcular puntuaciones
    const colorScore = skinColorValid ? 0.25 : 0;
    const luminanceScore = luminanceValid ? 0.15 : 0;
    const perfusionScore = perfusionValid ? 0.25 : 0;
    const hemodynamicScore = hemodynamicValid ? 0.15 : 0;
    const spatialScore = spatialConsistency ? 0.10 : 0;
    const temporalScore = temporalConsistency ? 0.10 : 0;
    
    const totalConfidence = colorScore + luminanceScore + perfusionScore + 
                           hemodynamicScore + spatialScore + temporalScore;
    
    // Calcular indicadores adicionales
    const bloodFlowIndicator = this.calculateBloodFlowIndicator();
    const opticalCoherence = this.calculateOpticalCoherence(rRatio, gRatio);

    return {
      isHumanFinger: totalConfidence >= 0.45 && skinColorValid && luminanceValid,
      confidence: totalConfidence,
      biophysicalScore: totalConfidence,
      opticalCoherence,
      bloodFlowIndicator,
      tissueConsistency: spatialConsistency && temporalConsistency ? 1.0 : 0.5,
      validationDetails: {
        skinColorValid,
        perfusionValid,
        hemodynamicValid,
        spatialConsistency,
        temporalConsistency
      }
    };
  }

  /**
   * Verifica variabilidad temporal de la señal (indica pulso real)
   */
  private checkTemporalVariability(): boolean {
    if (this.temporalBuffer.length < this.MIN_SAMPLES_FOR_DETECTION) return false;
    
    const redValues = this.temporalBuffer.map(d => d.r);
    const variance = this.calculateVariance(redValues);
    
    // Debe haber variación mínima (señal viva) pero no excesiva (ruido)
    return variance > this.MIN_VARIANCE && variance < 0.1;
  }

  /**
   * Verifica coherencia hemodinámica (R y G varían de forma coordinada)
   */
  private checkHemodynamicCoherence(): boolean {
    if (this.temporalBuffer.length < this.MIN_SAMPLES_FOR_DETECTION) return false;
    
    const recent = this.temporalBuffer.slice(-15);
    const redChanges: number[] = [];
    const greenChanges: number[] = [];
    
    for (let i = 1; i < recent.length; i++) {
      redChanges.push(recent[i].r - recent[i-1].r);
      greenChanges.push(recent[i].g - recent[i-1].g);
    }
    
    // Calcular correlación simplificada
    let correlation = 0;
    for (let i = 0; i < redChanges.length; i++) {
      correlation += Math.sign(redChanges[i]) === Math.sign(greenChanges[i]) ? 1 : 0;
    }
    
    return correlation / redChanges.length > 0.5;
  }

  /**
   * Verifica consistencia espacial del color
   */
  private checkSpatialConsistency(rRatio: number, gRatio: number, bRatio: number): boolean {
    // Si los ratios están dentro de rangos esperados, asumimos consistencia
    return rRatio > 0.3 && rRatio < 0.9 && gRatio < 0.5 && bRatio < 0.4;
  }

  /**
   * Verifica consistencia temporal (valores no cambian bruscamente)
   */
  private checkTemporalConsistency(): boolean {
    if (this.temporalBuffer.length < 5) return false;
    
    const recent = this.temporalBuffer.slice(-5);
    const luminances = recent.map(d => d.luminance);
    
    // Calcular cambios consecutivos
    let maxChange = 0;
    for (let i = 1; i < luminances.length; i++) {
      const change = Math.abs(luminances[i] - luminances[i-1]);
      if (change > maxChange) maxChange = change;
    }
    
    // Cambios bruscos (>30%) indican movimiento o retiro del dedo
    const avgLuminance = luminances.reduce((a, b) => a + b, 0) / luminances.length;
    return maxChange < avgLuminance * 0.3;
  }

  /**
   * Calcula indicador de flujo sanguíneo
   */
  private calculateBloodFlowIndicator(): number {
    if (this.temporalBuffer.length < this.MIN_SAMPLES_FOR_DETECTION) return 0;
    
    const redValues = this.temporalBuffer.map(d => d.r);
    const variance = this.calculateVariance(redValues);
    
    // Normalizar a 0-1
    return Math.min(1, variance * 100);
  }

  /**
   * Calcula coherencia óptica
   */
  private calculateOpticalCoherence(rRatio: number, gRatio: number): number {
    // Proporción esperada para dedo iluminado
    const expectedRRatio = 0.55;
    const expectedGRatio = 0.25;
    
    const rDiff = Math.abs(rRatio - expectedRRatio);
    const gDiff = Math.abs(gRatio - expectedGRatio);
    
    return Math.max(0, 1 - (rDiff + gDiff) * 2);
  }

  /**
   * Calcula varianza de un array
   */
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  }

  /**
   * Reinicia el detector
   */
  public reset(): void {
    this.temporalBuffer = [];
  }
}
