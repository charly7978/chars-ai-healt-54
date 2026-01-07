/**
 * @file HumanFingerDetector.ts
 * @description DETECTOR ESTRICTO DE DEDO HUMANO VIVO
 * 
 * REQUISITOS OBLIGATORIOS PARA DETECCIÓN:
 * 1. COLOR: Rojo dominante (tejido con flash LED)
 * 2. PULSATILIDAD REAL: Variación rítmica del 0.3-15% (flujo sanguíneo)
 * 3. ESTABILIDAD: Múltiples frames consecutivos cumpliendo ambos criterios
 * 
 * SIN DEDO REAL CON PULSO DETECTABLE = NO HAY DETECCIÓN
 * Esto NO es una simulación - requiere señal fisiológica real.
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
    hasPulsatility: boolean;
    pulsatilityValue: number;
    message: string;
  };
}

export class HumanFingerDetector {
  // ═══════════════════════════════════════════════════════════════════════════
  // ESTADO DE DETECCIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  private isConfirmed = false;
  private validFrameCount = 0;           // Frames con COLOR + PULSATILIDAD válidos
  private invalidFrameCount = 0;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORIAL PARA ANÁLISIS DE PULSATILIDAD
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly HISTORY_SIZE = 90;    // 3 segundos a 30fps
  private redHistory: number[] = [];
  private timestampHistory: number[] = [];
  
  // Buffer de pulsatilidad para suavizado
  private pulsatilityBuffer: number[] = [];
  private readonly PULSATILITY_BUFFER_SIZE = 10;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UMBRALES ESTRICTOS
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // === COLOR (primer filtro) ===
    MIN_RED: 100,                  // Rojo mínimo alto
    GOOD_RED: 150,                 // Rojo bueno
    MIN_RED_GREEN_DIFF: 25,        // R - G mínimo
    MIN_RED_BLUE_DIFF: 35,         // R - B mínimo
    MIN_RED_PROPORTION: 0.42,      // Rojo mínimo 42% del total
    MAX_GREEN_PROPORTION: 0.38,    // Verde máximo 38%
    MAX_BLUE_PROPORTION: 0.25,     // Azul máximo 25%
    
    // === PULSATILIDAD (OBLIGATORIO - sin esto NO hay dedo) ===
    MIN_SAMPLES_FOR_PULSATILITY: 25, // ~0.8s de datos antes de evaluar
    MIN_PULSATILITY: 0.003,        // 0.3% MÍNIMO (pulso real detectable)
    GOOD_PULSATILITY: 0.008,       // 0.8% bueno
    MAX_PULSATILITY: 0.15,         // 15% máximo (evitar movimiento excesivo)
    
    // === CONFIRMACIÓN ===
    FRAMES_TO_CONFIRM: 8,          // 8 frames válidos (~0.27s)
    FRAMES_TO_LOSE: 60,            // 2 segundos sin señal válida para perder
    
    // === TRANSICIONES ===
    TRANSITION_THRESHOLD: 100,     // Cambio brusco = limpiar historial
  };

  constructor() {
    console.log("🔬 HumanFingerDetector: Inicializado (modo estricto)");
  }

  /**
   * DETECCIÓN PRINCIPAL
   * Requiere: COLOR válido + PULSATILIDAD REAL
   */
  detectFinger(
    redValue: number,
    greenValue: number,
    blueValue: number
  ): FingerDetectionResult {
    const now = Date.now();
    
    // ═══════════════════════════════════════════════════════════════════════
    // FASE 1: VALIDACIÓN DE COLOR
    // ═══════════════════════════════════════════════════════════════════════
    const colorCheck = this.validateColor(redValue, greenValue, blueValue);
    
    if (!colorCheck.isValid) {
      this.handleInvalidFrame();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, 
        false, 0, colorCheck.message);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FASE 2: ACTUALIZAR HISTORIAL
    // ═══════════════════════════════════════════════════════════════════════
    this.updateHistory(redValue, now);
    
    // ═══════════════════════════════════════════════════════════════════════
    // FASE 3: VALIDACIÓN DE PULSATILIDAD (OBLIGATORIO)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Esperar suficientes muestras
    if (this.redHistory.length < this.CONFIG.MIN_SAMPLES_FOR_PULSATILITY) {
      const progress = Math.round((this.redHistory.length / this.CONFIG.MIN_SAMPLES_FOR_PULSATILITY) * 100);
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue,
        false, 0, `⏳ Color OK - Analizando pulso ${progress}%`);
    }
    
    // Calcular pulsatilidad
    const pulsatility = this.calculatePulsatility();
    const hasPulsatility = pulsatility >= this.CONFIG.MIN_PULSATILITY && 
                           pulsatility <= this.CONFIG.MAX_PULSATILITY;
    
    // SIN PULSATILIDAD = NO ES DEDO VIVO
    if (!hasPulsatility) {
      this.handleInvalidFrame();
      
      let message: string;
      if (pulsatility < this.CONFIG.MIN_PULSATILITY) {
        message = `❌ Sin pulso detectable (${(pulsatility * 100).toFixed(3)}% < ${(this.CONFIG.MIN_PULSATILITY * 100).toFixed(1)}%) - OBJETO INERTE`;
      } else {
        message = `❌ Movimiento excesivo (${(pulsatility * 100).toFixed(1)}%) - Mantenga quieto`;
      }
      
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue,
        false, pulsatility, message);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FASE 4: CONFIRMAR DETECCIÓN
    // ═══════════════════════════════════════════════════════════════════════
    this.handleValidFrame();
    
    const isDetected = this.isConfirmed;
    const confidence = isDetected ? this.calculateConfidence(redValue, pulsatility) : 0;
    const quality = isDetected ? this.calculateQuality(redValue, pulsatility) : 0;
    
    const message = isDetected
      ? `✅ DEDO VIVO (R=${redValue.toFixed(0)}, AC=${(pulsatility * 100).toFixed(2)}%)`
      : `⏳ Confirmando pulso (${this.validFrameCount}/${this.CONFIG.FRAMES_TO_CONFIRM})`;
    
    return this.createResult(isDetected, confidence, quality, 
      redValue, greenValue, blueValue, true, pulsatility, message);
  }

  /**
   * VALIDACIÓN DE COLOR
   */
  private validateColor(r: number, g: number, b: number): { isValid: boolean; message: string } {
    // 1. Valor rojo mínimo
    if (r < this.CONFIG.MIN_RED) {
      return { isValid: false, message: `⚠️ Rojo=${r.toFixed(0)} (mín ${this.CONFIG.MIN_RED}) - Acerque YEMA al flash` };
    }
    
    // 2. Rojo debe dominar
    if (r - g < this.CONFIG.MIN_RED_GREEN_DIFF) {
      return { isValid: false, message: `⚠️ R-G=${(r-g).toFixed(0)} bajo - No es tejido humano` };
    }
    
    if (r - b < this.CONFIG.MIN_RED_BLUE_DIFF) {
      return { isValid: false, message: `⚠️ R-B=${(r-b).toFixed(0)} bajo - No es tejido humano` };
    }
    
    // 3. Proporciones de color
    const total = r + g + b;
    if (total > 0) {
      const redProp = r / total;
      const greenProp = g / total;
      const blueProp = b / total;
      
      if (redProp < this.CONFIG.MIN_RED_PROPORTION) {
        return { isValid: false, message: `⚠️ Rojo ${(redProp*100).toFixed(0)}% - Cubra flash completamente` };
      }
      
      if (greenProp > this.CONFIG.MAX_GREEN_PROPORTION) {
        return { isValid: false, message: `⚠️ Verde ${(greenProp*100).toFixed(0)}% alto - No es piel` };
      }
      
      if (blueProp > this.CONFIG.MAX_BLUE_PROPORTION) {
        return { isValid: false, message: `⚠️ Azul ${(blueProp*100).toFixed(0)}% alto - Luz ambiental` };
      }
    }
    
    return { isValid: true, message: 'Color OK' };
  }

  /**
   * CALCULAR PULSATILIDAD REAL
   * Usa desviación estándar robusta para detectar variación cardíaca
   */
  private calculatePulsatility(): number {
    if (this.redHistory.length < 20) return 0;
    
    // Usar últimas muestras
    const samples = this.redHistory.slice(-60);
    
    // DC = componente continua (promedio)
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc < 20) return 0;
    
    // AC = componente alterna (desviación estándar * 2)
    const variance = samples.reduce((sum, s) => sum + Math.pow(s - dc, 2), 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    const ac = stdDev * 2;
    
    // Pulsatilidad instantánea
    const instantPulsatility = ac / dc;
    
    // Suavizar con buffer
    this.pulsatilityBuffer.push(instantPulsatility);
    if (this.pulsatilityBuffer.length > this.PULSATILITY_BUFFER_SIZE) {
      this.pulsatilityBuffer.shift();
    }
    
    // Retornar mediana (más robusta que promedio)
    const sorted = [...this.pulsatilityBuffer].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /**
   * ACTUALIZAR HISTORIAL
   */
  private updateHistory(redValue: number, timestamp: number): void {
    // Detectar transición brusca (dedo puesto/quitado)
    if (this.redHistory.length > 0) {
      const lastRed = this.redHistory[this.redHistory.length - 1];
      const delta = Math.abs(redValue - lastRed);
      
      if (delta > this.CONFIG.TRANSITION_THRESHOLD) {
        // Limpiar historial en transición
        this.redHistory = [];
        this.timestampHistory = [];
        this.pulsatilityBuffer = [];
      }
    }
    
    // Agregar muestra
    this.redHistory.push(redValue);
    this.timestampHistory.push(timestamp);
    
    // Mantener tamaño
    while (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
      this.timestampHistory.shift();
    }
  }

  /**
   * MANEJAR FRAME VÁLIDO (color + pulso OK)
   */
  private handleValidFrame(): void {
    this.invalidFrameCount = 0;
    this.validFrameCount++;
    
    if (this.validFrameCount >= this.CONFIG.FRAMES_TO_CONFIRM) {
      this.isConfirmed = true;
    }
  }

  /**
   * MANEJAR FRAME INVÁLIDO
   */
  private handleInvalidFrame(): void {
    this.invalidFrameCount++;
    
    // Decrementar validFrameCount gradualmente
    if (this.validFrameCount > 0 && this.invalidFrameCount % 3 === 0) {
      this.validFrameCount--;
    }
    
    // Perder detección después de muchos frames inválidos
    if (this.invalidFrameCount >= this.CONFIG.FRAMES_TO_LOSE) {
      this.isConfirmed = false;
      this.validFrameCount = 0;
    }
  }

  /**
   * CALCULAR CONFIANZA
   */
  private calculateConfidence(redValue: number, pulsatility: number): number {
    let confidence = 40;
    
    // Por rojo (hasta +30)
    if (redValue >= 180) confidence += 30;
    else if (redValue >= this.CONFIG.GOOD_RED) confidence += 20;
    else confidence += 10;
    
    // Por pulsatilidad (hasta +30)
    if (pulsatility >= this.CONFIG.GOOD_PULSATILITY) confidence += 30;
    else confidence += 15;
    
    return Math.min(100, confidence);
  }

  /**
   * CALCULAR CALIDAD
   */
  private calculateQuality(redValue: number, pulsatility: number): number {
    let quality = 30;
    
    // Por rojo (hasta +35)
    quality += Math.min(35, (redValue / 200) * 35);
    
    // Por pulsatilidad (hasta +35)
    const pulsScore = Math.min(1, pulsatility / this.CONFIG.GOOD_PULSATILITY);
    quality += pulsScore * 35;
    
    return Math.min(100, Math.max(0, quality));
  }

  /**
   * CREAR RESULTADO
   */
  private createResult(
    detected: boolean, confidence: number, quality: number,
    r: number, g: number, b: number,
    hasPulsatility: boolean, pulsatility: number, message: string
  ): FingerDetectionResult {
    return {
      isFingerDetected: detected,
      confidence,
      quality,
      diagnostics: {
        redValue: r,
        greenValue: g,
        blueValue: b,
        redRatio: g > 0 ? r / g : 0,
        isRedDominant: r > g && r > b,
        isProperlyIlluminated: r >= this.CONFIG.GOOD_RED,
        hasPulsatility,
        pulsatilityValue: pulsatility,
        message
      }
    };
  }

  /**
   * RESET COMPLETO
   */
  reset(): void {
    this.isConfirmed = false;
    this.validFrameCount = 0;
    this.invalidFrameCount = 0;
    this.redHistory = [];
    this.timestampHistory = [];
    this.pulsatilityBuffer = [];
  }

  isCurrentlyDetected(): boolean {
    return this.isConfirmed;
  }
  
  getRedHistory(): number[] {
    return [...this.redHistory];
  }
  
  getPulsatility(): number {
    if (this.pulsatilityBuffer.length === 0) return 0;
    const sorted = [...this.pulsatilityBuffer].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}
