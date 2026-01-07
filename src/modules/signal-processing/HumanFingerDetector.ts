/**
 * @file HumanFingerDetector.ts
 * @description DETECTOR ESTRICTO DE DEDO HUMANO VIVO
 * 
 * REGLA FUNDAMENTAL: Si el COLOR falla en CUALQUIER frame,
 * se invalida TODO inmediatamente. No hay "memoria" de detecciones previas.
 * 
 * REQUISITOS SIMULTÁNEOS (todos deben cumplirse):
 * 1. COLOR: Rojo dominante y alto (tejido iluminado por flash)
 * 2. PULSATILIDAD: Variación rítmica 0.3-15% (flujo sanguíneo real)
 * 3. ESTABILIDAD: Múltiples frames consecutivos válidos
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
  // ESTADO DE DETECCIÓN - SE INVALIDA INMEDIATAMENTE SI COLOR FALLA
  // ═══════════════════════════════════════════════════════════════════════════
  private isConfirmed = false;
  private consecutiveValidFrames = 0;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORIAL PARA PULSATILIDAD - SOLO SE LLENA CON FRAMES DE COLOR VÁLIDO
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly HISTORY_SIZE = 90;
  private redHistory: number[] = [];
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UMBRALES ESTRICTOS - NO NEGOCIABLES
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // === COLOR (OBLIGATORIO cada frame) ===
    MIN_RED: 100,                  // Rojo mínimo absoluto
    GOOD_RED: 150,                 // Rojo ideal
    MIN_RED_GREEN_DIFF: 30,        // R debe superar G por esto
    MIN_RED_BLUE_DIFF: 40,         // R debe superar B por esto
    MIN_RED_PROPORTION: 0.45,      // Rojo mínimo 45% del total RGB
    
    // === PULSATILIDAD (requiere historial de color válido) ===
    MIN_SAMPLES_FOR_PULSATILITY: 30, // ~1 segundo antes de evaluar pulso
    MIN_PULSATILITY: 0.004,        // 0.4% mínimo (pulso real)
    MAX_PULSATILITY: 0.12,         // 12% máximo (evitar movimiento)
    
    // === CONFIRMACIÓN ===
    FRAMES_TO_CONFIRM: 10,         // 10 frames consecutivos (~0.33s)
  };

  constructor() {
    console.log("🔬 HumanFingerDetector: Inicializado (modo estricto)");
  }

  /**
   * DETECCIÓN PRINCIPAL
   * REGLA: Si el color falla, TODO se invalida inmediatamente.
   */
  detectFinger(
    redValue: number,
    greenValue: number,
    blueValue: number
  ): FingerDetectionResult {
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 1: VALIDACIÓN DE COLOR - SI FALLA, INVALIDAR TODO
    // ═══════════════════════════════════════════════════════════════════════
    const colorCheck = this.validateColor(redValue, greenValue, blueValue);
    
    if (!colorCheck.isValid) {
      // *** CRÍTICO: LIMPIAR TODO ***
      this.invalidateCompletely();
      
      return this.createResult(
        false, 0, 0, 
        redValue, greenValue, blueValue,
        false, 0, 
        colorCheck.message
      );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 2: COLOR VÁLIDO - AGREGAR A HISTORIAL
    // ═══════════════════════════════════════════════════════════════════════
    this.addToHistory(redValue);
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 3: VERIFICAR SI HAY SUFICIENTES MUESTRAS PARA EVALUAR PULSO
    // ═══════════════════════════════════════════════════════════════════════
    if (this.redHistory.length < this.CONFIG.MIN_SAMPLES_FOR_PULSATILITY) {
      const progress = Math.round((this.redHistory.length / this.CONFIG.MIN_SAMPLES_FOR_PULSATILITY) * 100);
      return this.createResult(
        false, 0, 0,
        redValue, greenValue, blueValue,
        false, 0,
        `⏳ Color OK - Analizando pulso ${progress}%`
      );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 4: CALCULAR PULSATILIDAD REAL
    // ═══════════════════════════════════════════════════════════════════════
    const pulsatility = this.calculatePulsatility();
    const hasPulsatility = pulsatility >= this.CONFIG.MIN_PULSATILITY && 
                           pulsatility <= this.CONFIG.MAX_PULSATILITY;
    
    if (!hasPulsatility) {
      // Color OK pero sin pulso = objeto inerte, limpiar contadores
      this.consecutiveValidFrames = 0;
      this.isConfirmed = false;
      
      let message: string;
      if (pulsatility < this.CONFIG.MIN_PULSATILITY) {
        message = `❌ Sin pulso (${(pulsatility * 100).toFixed(3)}%) - OBJETO INERTE`;
      } else {
        message = `❌ Movimiento excesivo (${(pulsatility * 100).toFixed(1)}%)`;
      }
      
      return this.createResult(
        false, 0, 0,
        redValue, greenValue, blueValue,
        false, pulsatility,
        message
      );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 5: COLOR + PULSO OK - INCREMENTAR CONTADOR
    // ═══════════════════════════════════════════════════════════════════════
    this.consecutiveValidFrames++;
    
    if (this.consecutiveValidFrames >= this.CONFIG.FRAMES_TO_CONFIRM) {
      this.isConfirmed = true;
    }
    
    const confidence = this.isConfirmed ? this.calculateConfidence(redValue, pulsatility) : 0;
    const quality = this.isConfirmed ? this.calculateQuality(redValue, pulsatility) : 0;
    
    const message = this.isConfirmed
      ? `✅ DEDO VIVO (R=${redValue.toFixed(0)}, Pulso=${(pulsatility * 100).toFixed(2)}%)`
      : `⏳ Confirmando (${this.consecutiveValidFrames}/${this.CONFIG.FRAMES_TO_CONFIRM})`;
    
    return this.createResult(
      this.isConfirmed, confidence, quality,
      redValue, greenValue, blueValue,
      true, pulsatility,
      message
    );
  }

  /**
   * VALIDACIÓN DE COLOR ESTRICTA
   */
  private validateColor(r: number, g: number, b: number): { isValid: boolean; message: string } {
    // 1. Rojo mínimo absoluto
    if (r < this.CONFIG.MIN_RED) {
      return { 
        isValid: false, 
        message: `SIN DEDO: Rojo=${r.toFixed(0)} (mín ${this.CONFIG.MIN_RED})` 
      };
    }
    
    // 2. Rojo debe dominar sobre verde
    const rgDiff = r - g;
    if (rgDiff < this.CONFIG.MIN_RED_GREEN_DIFF) {
      return { 
        isValid: false, 
        message: `NO ES DEDO: R-G=${rgDiff.toFixed(0)} (mín ${this.CONFIG.MIN_RED_GREEN_DIFF})` 
      };
    }
    
    // 3. Rojo debe dominar sobre azul
    const rbDiff = r - b;
    if (rbDiff < this.CONFIG.MIN_RED_BLUE_DIFF) {
      return { 
        isValid: false, 
        message: `NO ES DEDO: R-B=${rbDiff.toFixed(0)} (mín ${this.CONFIG.MIN_RED_BLUE_DIFF})` 
      };
    }
    
    // 4. Proporción de rojo
    const total = r + g + b;
    if (total > 0) {
      const redProp = r / total;
      if (redProp < this.CONFIG.MIN_RED_PROPORTION) {
        return { 
          isValid: false, 
          message: `NO ES DEDO: Rojo=${(redProp*100).toFixed(0)}% (mín ${(this.CONFIG.MIN_RED_PROPORTION*100).toFixed(0)}%)` 
        };
      }
    }
    
    return { isValid: true, message: 'Color válido' };
  }

  /**
   * AGREGAR A HISTORIAL (solo llamado cuando color es válido)
   */
  private addToHistory(redValue: number): void {
    this.redHistory.push(redValue);
    
    // Mantener tamaño máximo
    while (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
    }
  }

  /**
   * CALCULAR PULSATILIDAD
   * Requiere historial de valores de color válido
   */
  private calculatePulsatility(): number {
    if (this.redHistory.length < 20) return 0;
    
    // Usar últimas 60 muestras (~2 segundos)
    const samples = this.redHistory.slice(-60);
    
    // DC = promedio (componente continua)
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc < 50) return 0;
    
    // AC = desviación estándar * 2 (aproxima amplitud pico-pico)
    const variance = samples.reduce((sum, s) => sum + Math.pow(s - dc, 2), 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    const ac = stdDev * 2;
    
    // Pulsatilidad = AC/DC
    return ac / dc;
  }

  /**
   * INVALIDAR COMPLETAMENTE
   * Llamado cuando el color falla - limpia TODO
   */
  private invalidateCompletely(): void {
    this.isConfirmed = false;
    this.consecutiveValidFrames = 0;
    // CRÍTICO: Limpiar historial completo cuando color falla
    this.redHistory = [];
  }

  /**
   * CALCULAR CONFIANZA
   */
  private calculateConfidence(redValue: number, pulsatility: number): number {
    let confidence = 50;
    
    // Por intensidad de rojo (hasta +25)
    if (redValue >= 180) confidence += 25;
    else if (redValue >= this.CONFIG.GOOD_RED) confidence += 15;
    else confidence += 5;
    
    // Por calidad de pulsatilidad (hasta +25)
    if (pulsatility >= 0.008) confidence += 25;
    else if (pulsatility >= 0.005) confidence += 15;
    else confidence += 5;
    
    return Math.min(100, confidence);
  }

  /**
   * CALCULAR CALIDAD
   */
  private calculateQuality(redValue: number, pulsatility: number): number {
    let quality = 40;
    
    // Por rojo (hasta +30)
    quality += Math.min(30, ((redValue - this.CONFIG.MIN_RED) / 100) * 30);
    
    // Por pulsatilidad (hasta +30)
    const pulsScore = Math.min(1, pulsatility / 0.01);
    quality += pulsScore * 30;
    
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
    this.consecutiveValidFrames = 0;
    this.redHistory = [];
  }

  isCurrentlyDetected(): boolean {
    return this.isConfirmed;
  }
  
  getRedHistory(): number[] {
    return [...this.redHistory];
  }
  
  getPulsatility(): number {
    return this.calculatePulsatility();
  }
}
