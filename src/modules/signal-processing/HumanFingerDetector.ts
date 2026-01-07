/**
 * HUMAN FINGER DETECTOR - DETECCIÓN ESTRICTA
 * Solo detecta dedo humano real cubriendo la cámara
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
  private temporalBuffer: Array<{ r: number; g: number; b: number; time: number }> = [];
  private readonly BUFFER_SIZE = 60; // 2 segundos
  
  // Umbrales ESTRICTOS para dedo + flash
  private readonly THRESHOLDS = {
    // Color de piel con sangre (flash encendido)
    MIN_RED: 85,
    MAX_RED: 235,
    MIN_RED_RATIO: 0.43,
    MAX_GREEN_RATIO: 0.34,
    MAX_BLUE_RATIO: 0.28,
    
    // Varianza para señal viva
    MIN_VARIANCE: 0.3,
    MAX_VARIANCE: 40,
    
    // Mínimo de muestras para validar
    MIN_SAMPLES: 10,
    
    // Confianza mínima
    MIN_CONFIDENCE: 0.55
  };

  /**
   * Detecta si hay un dedo humano real sobre la cámara
   */
  public detectHumanFinger(
    red: number,
    green: number,
    blue: number,
    textureScore: number = 0,
    width: number = 320,
    height: number = 240
  ): HumanFingerValidation {
    const timestamp = Date.now();
    
    // Agregar al buffer temporal
    this.temporalBuffer.push({ r: red, g: green, b: blue, time: timestamp });
    if (this.temporalBuffer.length > this.BUFFER_SIZE) {
      this.temporalBuffer.shift();
    }
    
    // Calcular ratios
    const total = red + green + blue + 0.001;
    const rRatio = red / total;
    const gRatio = green / total;
    const bRatio = blue / total;
    
    // === VALIDACIONES ESTRICTAS ===
    
    // 1. Color válido de piel con sangre
    const skinColorValid = this.validateSkinColor(red, rRatio, gRatio, bRatio);
    
    // 2. Señal con pulsación (varianza temporal)
    const perfusionValid = this.validatePulsation();
    
    // 3. Coherencia hemodinámica
    const hemodynamicValid = this.validateHemodynamics();
    
    // 4. Consistencia temporal (no movimientos bruscos)
    const temporalConsistency = this.validateTemporalConsistency();
    
    // 5. Orden de canales correcto (R > G > B típico de piel)
    const spatialConsistency = red > green && green >= blue * 0.9;
    
    // Calcular puntuaciones
    const scores = {
      color: skinColorValid ? 0.30 : 0,
      pulsation: perfusionValid ? 0.25 : 0,
      hemodynamic: hemodynamicValid ? 0.20 : 0,
      temporal: temporalConsistency ? 0.15 : 0,
      spatial: spatialConsistency ? 0.10 : 0
    };
    
    const totalConfidence = scores.color + scores.pulsation + scores.hemodynamic + 
                           scores.temporal + scores.spatial;
    
    // Solo es dedo si pasa los criterios principales
    const isHumanFinger = skinColorValid && 
                          perfusionValid && 
                          totalConfidence >= this.THRESHOLDS.MIN_CONFIDENCE;
    
    return {
      isHumanFinger,
      confidence: totalConfidence,
      biophysicalScore: totalConfidence,
      opticalCoherence: this.calculateOpticalCoherence(rRatio, gRatio),
      bloodFlowIndicator: this.calculateBloodFlow(),
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
   * Valida color de piel con sangre
   */
  private validateSkinColor(red: number, rRatio: number, gRatio: number, bRatio: number): boolean {
    return red >= this.THRESHOLDS.MIN_RED &&
           red <= this.THRESHOLDS.MAX_RED &&
           rRatio >= this.THRESHOLDS.MIN_RED_RATIO &&
           gRatio <= this.THRESHOLDS.MAX_GREEN_RATIO &&
           bRatio <= this.THRESHOLDS.MAX_BLUE_RATIO;
  }

  /**
   * Valida que hay pulsación (varianza en el canal rojo)
   */
  private validatePulsation(): boolean {
    if (this.temporalBuffer.length < this.THRESHOLDS.MIN_SAMPLES) return false;
    
    const redValues = this.temporalBuffer.map(d => d.r);
    const variance = this.calculateVariance(redValues);
    
    return variance >= this.THRESHOLDS.MIN_VARIANCE && 
           variance <= this.THRESHOLDS.MAX_VARIANCE;
  }

  /**
   * Valida coherencia hemodinámica (R y G varían de forma coordinada)
   */
  private validateHemodynamics(): boolean {
    if (this.temporalBuffer.length < 15) return false;
    
    const recent = this.temporalBuffer.slice(-20);
    let coordinated = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const redChange = recent[i].r - recent[i-1].r;
      const greenChange = recent[i].g - recent[i-1].g;
      
      // En tejido vivo, R y G cambian en la misma dirección
      if (Math.sign(redChange) === Math.sign(greenChange) || 
          Math.abs(redChange) < 1 || Math.abs(greenChange) < 1) {
        coordinated++;
      }
    }
    
    return coordinated / (recent.length - 1) > 0.5;
  }

  /**
   * Valida consistencia temporal (sin movimientos bruscos)
   */
  private validateTemporalConsistency(): boolean {
    if (this.temporalBuffer.length < 5) return false;
    
    const recent = this.temporalBuffer.slice(-10);
    let maxJump = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const jump = Math.abs(recent[i].r - recent[i-1].r);
      if (jump > maxJump) maxJump = jump;
    }
    
    // Saltos mayores a 30 indican movimiento o retiro del dedo
    return maxJump < 30;
  }

  /**
   * Calcula coherencia óptica
   */
  private calculateOpticalCoherence(rRatio: number, gRatio: number): number {
    const expectedR = 0.50;
    const expectedG = 0.28;
    const deviation = Math.abs(rRatio - expectedR) + Math.abs(gRatio - expectedG);
    return Math.max(0, 1 - deviation * 2);
  }

  /**
   * Calcula indicador de flujo sanguíneo
   */
  private calculateBloodFlow(): number {
    if (this.temporalBuffer.length < 10) return 0;
    
    const redValues = this.temporalBuffer.slice(-20).map(d => d.r);
    const variance = this.calculateVariance(redValues);
    
    return Math.min(1, variance / 20);
  }

  /**
   * Calcula varianza
   */
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  }

  /**
   * Reset
   */
  public reset(): void {
    this.temporalBuffer = [];
  }
}
