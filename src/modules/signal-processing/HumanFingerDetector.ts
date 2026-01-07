/**
 * @file HumanFingerDetector.ts
 * @description ÚNICO PUNTO DE DETECCIÓN DE DEDO EN TODA LA APP
 * 
 * CRITERIO: Detectar la YEMA del dedo (no la punta) iluminada por el flash LED.
 * 
 * La YEMA del dedo sobre el flash produce:
 * - Imagen MUY ROJA y BRILLANTE (el flash atraviesa el tejido)
 * - Canal ROJO dominante (>50% del total)
 * - Canal VERDE bajo (hemoglobina absorbe verde)
 * - Canal AZUL muy bajo (hemoglobina absorbe azul fuertemente)
 * - Uniformidad alta (piel translúcida, sin bordes duros)
 * 
 * La PUNTA del dedo produce:
 * - Menor área de contacto con el sensor
 * - Menos luz roja (más bordes, menos penetración)
 * - Más variabilidad (menor estabilidad)
 * 
 * UMBRALES CALIBRADOS EMPÍRICAMENTE para yema de dedo adulto
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
  // Estabilidad temporal con histéresis
  private consecutiveDetections = 0;
  private consecutiveNonDetections = 0;
  private lastDetectionState = false;
  
  // Historial para análisis de pulsatilidad (componente AC)
  private redHistory: number[] = [];
  private readonly HISTORY_SIZE = 45; // ~1.5 segundos a 30fps
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UMBRALES RECALIBRADOS PARA YEMA DE DEDO (NO PUNTA)
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // === ILUMINACIÓN MÍNIMA ===
    MIN_TOTAL_LIGHT: 120,           // Mínimo absoluto
    GOOD_TOTAL_LIGHT: 200,          // Buena iluminación
    
    // === CANAL ROJO ===
    MIN_RED_VALUE: 80,              // Mínimo para considerar
    GOOD_RED_VALUE: 120,            // Rojo bueno
    IDEAL_RED_VALUE: 160,           // Rojo ideal
    MAX_RED_VALUE: 255,             // Saturación
    
    // === DOMINANCIA DEL ROJO ===
    MIN_RED_PROPORTION: 0.45,       // Rojo mínimo como proporción
    IDEAL_RED_PROPORTION: 0.55,     // Rojo ideal
    
    // === RATIOS DE COLOR ===
    MIN_RG_RATIO: 1.15,             // Permisivo
    MAX_RG_RATIO: 6.0,              // Alto para flash fuerte
    IDEAL_RG_RATIO: 2.0,            // Valor ideal
    MIN_RB_RATIO: 1.2,              // Permisivo
    
    // === LÍMITES VERDE/AZUL ===
    MAX_GREEN_PROPORTION: 0.40,     // Verde no más del 40%
    MAX_BLUE_PROPORTION: 0.30,      // Azul no más del 30%
    
    // === ESTABILIDAD TEMPORAL ===
    MIN_CONSECUTIVE_FOR_DETECTION: 3,
    MAX_CONSECUTIVE_FOR_LOSS: 8,
    
    // === PULSATILIDAD ===
    MIN_PULSATILITY: 0.003,
    GOOD_PULSATILITY: 0.01,
    IDEAL_PULSATILITY: 0.03
  };

  constructor() {
    console.log("🔴 HumanFingerDetector: Detector de YEMA inicializado");
    console.log(`   📋 Umbrales: R>${this.CONFIG.MIN_RED_VALUE}, R/G>${this.CONFIG.MIN_RG_RATIO}, R%>${this.CONFIG.MIN_RED_PROPORTION * 100}%`);
  }

  /**
   * DETECCIÓN DE YEMA DE DEDO
   */
  detectFinger(
    redValue: number,
    greenValue: number,
    blueValue: number
  ): FingerDetectionResult {
    
    // Actualizar historial
    this.updateHistory(redValue);
    
    // Calcular métricas
    const totalLight = redValue + greenValue + blueValue;
    const redProportion = totalLight > 0 ? redValue / totalLight : 0;
    const greenProportion = totalLight > 0 ? greenValue / totalLight : 0;
    const blueProportion = totalLight > 0 ? blueValue / totalLight : 0;
    const rgRatio = greenValue > 0 ? redValue / greenValue : 0;
    const rbRatio = blueValue > 0 ? redValue / blueValue : 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // VALIDACIÓN PASO A PASO
    // ═══════════════════════════════════════════════════════════════════════
    
    // 1. ILUMINACIÓN SUFICIENTE
    if (totalLight < this.CONFIG.MIN_TOTAL_LIGHT) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        "❌ Poca luz - Acerque la yema al flash"
      );
    }

    // 2. VALOR ABSOLUTO DE ROJO
    if (redValue < this.CONFIG.MIN_RED_VALUE) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        `❌ Rojo bajo (${redValue.toFixed(0)}) - Coloque la YEMA sobre el flash`
      );
    }

    // 3. DOMINANCIA DEL ROJO
    if (redProportion < this.CONFIG.MIN_RED_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        `❌ Rojo no dominante (${(redProportion*100).toFixed(0)}%) - Cubra el flash con la yema`
      );
    }

    // 4. RATIO R/G
    if (rgRatio < this.CONFIG.MIN_RG_RATIO) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        `❌ Ratio R/G bajo (${rgRatio.toFixed(2)}) - Presione más la yema`
      );
    }
    
    if (rgRatio > this.CONFIG.MAX_RG_RATIO) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        `❌ Ratio R/G muy alto (${rgRatio.toFixed(2)}) - Posible luz roja externa`
      );
    }

    // 5. RATIO R/B
    if (rbRatio < this.CONFIG.MIN_RB_RATIO) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        `❌ Mucho azul (R/B=${rbRatio.toFixed(2)}) - No es tejido humano`
      );
    }

    // 6. VERDE NO EXCESIVO
    if (greenProportion > this.CONFIG.MAX_GREEN_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        `❌ Verde excesivo (${(greenProportion*100).toFixed(0)}%) - Cubra mejor el flash`
      );
    }

    // 7. AZUL NO EXCESIVO
    if (blueProportion > this.CONFIG.MAX_BLUE_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, redValue, greenValue, blueValue, rgRatio,
        `❌ Azul excesivo (${(blueProportion*100).toFixed(0)}%) - Luz ambiental interfiriendo`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TODAS LAS VALIDACIONES PASARON - DEDO DETECTADO
    // ═══════════════════════════════════════════════════════════════════════
    this.handleDetection();
    
    const pulsatility = this.calculatePulsatility();
    const confidence = this.calculateConfidence(redValue, redProportion, rgRatio, rbRatio, pulsatility);
    const quality = this.calculateQuality(redValue, pulsatility, confidence);
    
    const message = this.lastDetectionState 
      ? `✓ YEMA detectada (R=${redValue.toFixed(0)}, R/G=${rgRatio.toFixed(2)}, AC=${(pulsatility*100).toFixed(1)}%)`
      : "⏳ Estabilizando detección...";
    
    return this.createResult(this.lastDetectionState, confidence, redValue, greenValue, blueValue, rgRatio, message, quality);
  }

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

  private updateHistory(redValue: number): void {
    this.redHistory.push(redValue);
    if (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
    }
  }

  private calculatePulsatility(): number {
    if (this.redHistory.length < 10) return 0;
    
    const recent = this.redHistory.slice(-20);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    if (mean === 0) return 0;
    return (max - min) / mean;
  }

  private calculateConfidence(
    redValue: number,
    redProportion: number,
    rgRatio: number,
    rbRatio: number,
    pulsatility: number
  ): number {
    let confidence = 0;
    
    // Score por intensidad de rojo (0-35 puntos)
    if (redValue >= this.CONFIG.IDEAL_RED_VALUE) {
      confidence += 35;
    } else if (redValue >= this.CONFIG.GOOD_RED_VALUE) {
      confidence += 25;
    } else {
      confidence += (redValue / this.CONFIG.GOOD_RED_VALUE) * 20;
    }
    
    // Score por proporción de rojo (0-25 puntos)
    if (redProportion >= this.CONFIG.IDEAL_RED_PROPORTION) {
      confidence += 25;
    } else {
      confidence += (redProportion / this.CONFIG.IDEAL_RED_PROPORTION) * 25;
    }
    
    // Score por ratio R/G (0-20 puntos)
    const idealRG = this.CONFIG.IDEAL_RG_RATIO;
    if (rgRatio >= idealRG && rgRatio <= 3.5) {
      confidence += 20;
    } else {
      const deviation = Math.abs(rgRatio - idealRG);
      confidence += Math.max(0, 20 - deviation * 5);
    }
    
    // Score por pulsatilidad (0-20 puntos)
    if (pulsatility >= this.CONFIG.IDEAL_PULSATILITY) {
      confidence += 20;
    } else if (pulsatility >= this.CONFIG.GOOD_PULSATILITY) {
      confidence += 15;
    } else if (pulsatility >= this.CONFIG.MIN_PULSATILITY) {
      confidence += 10;
    }
    
    return Math.min(100, Math.max(0, confidence));
  }

  private calculateQuality(
    redValue: number,
    pulsatility: number,
    confidence: number
  ): number {
    let quality = confidence * 0.5;
    
    if (redValue >= this.CONFIG.IDEAL_RED_VALUE) {
      quality += 25;
    } else if (redValue >= this.CONFIG.GOOD_RED_VALUE) {
      quality += 15;
    }
    
    if (pulsatility >= this.CONFIG.IDEAL_PULSATILITY) {
      quality += 25;
    } else if (pulsatility >= this.CONFIG.GOOD_PULSATILITY) {
      quality += 15;
    } else if (pulsatility >= this.CONFIG.MIN_PULSATILITY) {
      quality += 5;
    }
    
    return Math.min(100, Math.max(0, quality));
  }

  private createResult(
    detected: boolean,
    confidence: number,
    redValue: number,
    greenValue: number,
    blueValue: number,
    rgRatio: number,
    message: string,
    quality: number = 0
  ): FingerDetectionResult {
    return {
      isFingerDetected: detected,
      confidence,
      quality,
      diagnostics: {
        redValue,
        greenValue,
        blueValue,
        redRatio: rgRatio,
        isRedDominant: redValue > greenValue && redValue > blueValue,
        isProperlyIlluminated: redValue >= this.CONFIG.GOOD_RED_VALUE,
        message
      }
    };
  }

  reset(): void {
    this.consecutiveDetections = 0;
    this.consecutiveNonDetections = 0;
    this.lastDetectionState = false;
    this.redHistory = [];
    console.log("🔄 HumanFingerDetector: Reset completo");
  }

  isCurrentlyDetected(): boolean {
    return this.lastDetectionState;
  }
  
  getRedHistory(): number[] {
    return [...this.redHistory];
  }
}