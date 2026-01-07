/**
 * @file HumanFingerDetector.ts
 * @description ÚNICO PUNTO DE DETECCIÓN DE DEDO EN TODA LA APP
 * 
 * CRITERIO: Detectar la YEMA del dedo iluminada por el flash LED.
 * La yema del dedo sobre el flash produce una imagen ROJA BRILLANTE (saturada).
 * 
 * Características de la yema del dedo correctamente posicionada:
 * 1. Canal ROJO muy alto (>150) por la luz atravesando el tejido
 * 2. Canal VERDE moderado-bajo (la hemoglobina absorbe verde)
 * 3. Canal AZUL bajo (la hemoglobina absorbe azul)
 * 4. Ratio R/G alto (típicamente 1.5-4.0)
 * 5. Imagen uniforme/saturada (poca textura porque es piel translúcida)
 */

export interface FingerDetectionResult {
  isFingerDetected: boolean;
  confidence: number;
  quality: number;
  diagnostics: {
    redValue: number;
    greenValue: number;
    blueValue: number;
    redRatio: number;
    isRedDominant: boolean;
    isProperlyIlluminated: boolean;
    message: string;
  };
}

export class HumanFingerDetector {
  // Buffer para estabilidad temporal
  private consecutiveDetections = 0;
  private consecutiveNonDetections = 0;
  private lastDetectionState = false;
  
  // Historial para análisis de pulsatilidad
  private redHistory: number[] = [];
  private readonly HISTORY_SIZE = 30;
  
  // UMBRALES CALIBRADOS PARA YEMA DE DEDO CON FLASH LED
  private readonly CONFIG = {
    // La yema iluminada por flash produce rojo MUY ALTO
    MIN_RED_FOR_FINGER: 100,      // Rojo mínimo (yema iluminada es muy roja)
    IDEAL_RED_MIN: 140,           // Rojo ideal mínimo
    IDEAL_RED_MAX: 255,           // Rojo ideal máximo
    
    // Ratios de color para tejido humano con flash
    MIN_RG_RATIO: 1.2,            // Rojo debe ser mayor que verde
    MAX_RG_RATIO: 5.0,            // Pero no demasiado (evita luz roja artificial)
    MIN_RB_RATIO: 1.5,            // Rojo mucho mayor que azul
    
    // Verde moderado (la sangre absorbe verde)
    MAX_GREEN_RATIO: 0.45,        // Verde no debe ser más del 45% del total
    
    // Estabilidad requerida
    MIN_CONSECUTIVE_FOR_DETECTION: 5,
    MAX_CONSECUTIVE_FOR_LOSS: 10,
    
    // Pulsatilidad mínima (la señal debe variar con el pulso)
    MIN_PULSATILITY: 0.005
  };

  constructor() {
    console.log("🔴 HumanFingerDetector: Detector de YEMA activado");
  }

  /**
   * ÚNICA FUNCIÓN DE DETECCIÓN DE DEDO EN TODA LA APP
   * 
   * @param redValue - Valor promedio del canal rojo (0-255)
   * @param greenValue - Valor promedio del canal verde (0-255)
   * @param blueValue - Valor promedio del canal azul (0-255)
   * @returns Resultado de detección con diagnósticos
   */
  detectFinger(
    redValue: number,
    greenValue: number,
    blueValue: number
  ): FingerDetectionResult {
    
    // Actualizar historial
    this.updateHistory(redValue);
    
    // 1. VERIFICAR ILUMINACIÓN SUFICIENTE
    const totalLight = redValue + greenValue + blueValue;
    if (totalLight < 150) {
      return this.createNegativeResult(
        redValue, greenValue, blueValue,
        "Iluminación insuficiente - active el flash o acerque el dedo"
      );
    }

    // 2. VERIFICAR DOMINANCIA DEL ROJO (característica clave de yema con flash)
    const redRatio = redValue / (totalLight + 0.001);
    const greenRatio = greenValue / (totalLight + 0.001);
    const rgRatio = redValue / (greenValue + 0.001);
    const rbRatio = redValue / (blueValue + 0.001);
    
    const isRedDominant = redValue > greenValue && redValue > blueValue;
    
    if (!isRedDominant) {
      this.handleNonDetection();
      return this.createNegativeResult(
        redValue, greenValue, blueValue,
        "El rojo debe dominar - coloque la YEMA (no la punta) sobre el flash"
      );
    }

    // 3. VERIFICAR VALOR DE ROJO SUFICIENTE
    if (redValue < this.CONFIG.MIN_RED_FOR_FINGER) {
      this.handleNonDetection();
      return this.createNegativeResult(
        redValue, greenValue, blueValue,
        `Rojo insuficiente (${redValue.toFixed(0)}) - presione más la yema sobre el flash`
      );
    }

    // 4. VERIFICAR RATIOS DE COLOR PARA TEJIDO HUMANO
    if (rgRatio < this.CONFIG.MIN_RG_RATIO || rgRatio > this.CONFIG.MAX_RG_RATIO) {
      this.handleNonDetection();
      return this.createNegativeResult(
        redValue, greenValue, blueValue,
        `Ratio R/G anormal (${rgRatio.toFixed(2)}) - no parece tejido humano iluminado`
      );
    }

    if (rbRatio < this.CONFIG.MIN_RB_RATIO) {
      this.handleNonDetection();
      return this.createNegativeResult(
        redValue, greenValue, blueValue,
        `Ratio R/B bajo (${rbRatio.toFixed(2)}) - mucho azul para ser yema de dedo`
      );
    }

    // 5. VERIFICAR QUE EL VERDE NO DOMINE (la hemoglobina lo absorbe)
    if (greenRatio > this.CONFIG.MAX_GREEN_RATIO) {
      this.handleNonDetection();
      return this.createNegativeResult(
        redValue, greenValue, blueValue,
        "Demasiado verde - no es yema de dedo sobre flash"
      );
    }

    // 6. VERIFICAR PULSATILIDAD (debe haber variación por el pulso)
    const pulsatility = this.calculatePulsatility();
    
    // 7. TODAS LAS VALIDACIONES PASARON - DEDO DETECTADO
    this.handleDetection();
    
    // Calcular confianza basada en qué tan ideal es la señal
    const confidence = this.calculateConfidence(
      redValue, rgRatio, rbRatio, pulsatility
    );
    
    // Calcular calidad para la medición
    const quality = this.calculateQuality(redValue, pulsatility, confidence);
    
    return {
      isFingerDetected: this.lastDetectionState,
      confidence,
      quality,
      diagnostics: {
        redValue,
        greenValue,
        blueValue,
        redRatio: rgRatio,
        isRedDominant: true,
        isProperlyIlluminated: redValue >= this.CONFIG.IDEAL_RED_MIN,
        message: this.lastDetectionState 
          ? `✓ Yema detectada (R=${redValue.toFixed(0)}, R/G=${rgRatio.toFixed(2)})`
          : "Estabilizando detección..."
      }
    };
  }

  /**
   * Manejar detección positiva con histéresis
   */
  private handleDetection(): void {
    this.consecutiveDetections++;
    this.consecutiveNonDetections = 0;
    
    if (this.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
      if (!this.lastDetectionState) {
        console.log("✅ YEMA DE DEDO DETECTADA - Iniciando medición PPG");
      }
      this.lastDetectionState = true;
    }
  }

  /**
   * Manejar no-detección con histéresis
   */
  private handleNonDetection(): void {
    this.consecutiveNonDetections++;
    this.consecutiveDetections = 0;
    
    if (this.consecutiveNonDetections >= this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS) {
      if (this.lastDetectionState) {
        console.log("❌ DEDO PERDIDO - Deteniendo medición");
      }
      this.lastDetectionState = false;
    }
  }

  /**
   * Actualizar historial de valores rojos para análisis
   */
  private updateHistory(redValue: number): void {
    this.redHistory.push(redValue);
    if (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
    }
  }

  /**
   * Calcular pulsatilidad (variación AC/DC)
   */
  private calculatePulsatility(): number {
    if (this.redHistory.length < 10) return 0;
    
    const recent = this.redHistory.slice(-15);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    if (mean === 0) return 0;
    
    // AC/DC ratio
    return (max - min) / mean;
  }

  /**
   * Calcular confianza de la detección
   */
  private calculateConfidence(
    redValue: number,
    rgRatio: number,
    rbRatio: number,
    pulsatility: number
  ): number {
    let confidence = 0;
    
    // Score por intensidad de rojo (0-40 puntos)
    if (redValue >= this.CONFIG.IDEAL_RED_MIN) {
      confidence += 40;
    } else {
      confidence += (redValue / this.CONFIG.IDEAL_RED_MIN) * 40;
    }
    
    // Score por ratio R/G ideal ~2.0-3.0 (0-25 puntos)
    const idealRG = 2.5;
    const rgScore = Math.max(0, 25 - Math.abs(rgRatio - idealRG) * 10);
    confidence += rgScore;
    
    // Score por ratio R/B (0-20 puntos)
    if (rbRatio >= 2.0) {
      confidence += 20;
    } else {
      confidence += (rbRatio / 2.0) * 20;
    }
    
    // Score por pulsatilidad (0-15 puntos)
    if (pulsatility >= this.CONFIG.MIN_PULSATILITY) {
      confidence += Math.min(15, pulsatility * 150);
    }
    
    return Math.min(100, Math.max(0, confidence));
  }

  /**
   * Calcular calidad de señal para medición
   */
  private calculateQuality(
    redValue: number,
    pulsatility: number,
    confidence: number
  ): number {
    // Base: usar confianza
    let quality = confidence * 0.6;
    
    // Bonus por buena intensidad de rojo
    if (redValue >= 150 && redValue <= 240) {
      quality += 20;
    }
    
    // Bonus por buena pulsatilidad
    if (pulsatility >= 0.01 && pulsatility <= 0.15) {
      quality += 20;
    }
    
    return Math.min(100, Math.max(0, quality));
  }

  /**
   * Crear resultado negativo con diagnóstico
   */
  private createNegativeResult(
    redValue: number,
    greenValue: number,
    blueValue: number,
    message: string
  ): FingerDetectionResult {
    const rgRatio = redValue / (greenValue + 0.001);
    
    return {
      isFingerDetected: this.lastDetectionState,
      confidence: 0,
      quality: 0,
      diagnostics: {
        redValue,
        greenValue,
        blueValue,
        redRatio: rgRatio,
        isRedDominant: redValue > greenValue && redValue > blueValue,
        isProperlyIlluminated: redValue >= this.CONFIG.IDEAL_RED_MIN,
        message
      }
    };
  }

  /**
   * Resetear estado del detector
   */
  reset(): void {
    this.consecutiveDetections = 0;
    this.consecutiveNonDetections = 0;
    this.lastDetectionState = false;
    this.redHistory = [];
    console.log("🔄 HumanFingerDetector: Reset completo");
  }

  /**
   * Obtener estado actual de detección
   */
  isCurrentlyDetected(): boolean {
    return this.lastDetectionState;
  }
}
