/**
 * @file HumanFingerDetector.ts
 * @description DETECTOR ROBUSTO Y ESTABLE DE DEDO HUMANO
 * 
 * ARQUITECTURA SIMPLIFICADA:
 * 1. COLOR: Rojo dominante (validación rápida)
 * 2. ESTABILIDAD TEMPORAL: Una vez detectado, muy difícil perder
 * 3. PULSATILIDAD: Cálculo robusto con EMA (Exponential Moving Average)
 * 
 * PRINCIPIO CLAVE: Si el color es bueno, CONFIAR.
 * El pulso cardíaco es variable - no basar detección en él.
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
  // ESTADO PRINCIPAL - Máquina de estados simple
  // ═══════════════════════════════════════════════════════════════════════════
  private isConfirmed = false;           // ¿Dedo confirmado?
  private goodFrameCount = 0;            // Frames consecutivos con buen color
  private badFrameCount = 0;             // Frames consecutivos sin dedo
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORIAL DE SEÑAL - Para pulsatilidad
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly HISTORY_SIZE = 60;    // 2 segundos a 30fps
  private redHistory: number[] = [];
  private lastTimestamp = 0;
  
  // EMA de pulsatilidad (suavizado exponencial)
  private pulsatilityEMA = 0;
  private readonly EMA_ALPHA = 0.15;     // Factor de suavizado (0.1-0.2 es estable)
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UMBRALES - MUY PERMISIVOS
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // COLOR
    MIN_RED: 70,                  // Mínimo valor rojo
    MIN_RED_GREEN_DIFF: 15,       // Rojo debe superar verde por esto
    MIN_RED_BLUE_DIFF: 20,        // Rojo debe superar azul por esto
    MIN_RED_PROPORTION: 0.38,     // Rojo mínimo 38% del total
    
    // CONFIRMACIÓN
    FRAMES_TO_CONFIRM: 4,         // 4 frames buenos = confirmado (~130ms)
    FRAMES_TO_LOSE: 120,          // 4 segundos sin señal para perder
    
    // PULSATILIDAD (solo informativo, NO bloquea detección)
    MIN_PULSATILITY: 0.001,       // 0.1% mínimo
    GOOD_PULSATILITY: 0.005,      // 0.5% bueno
    MAX_PULSATILITY: 0.30,        // 30% máximo (mucho movimiento)
    
    // TRANSICIÓN
    TRANSITION_THRESHOLD: 80,     // Cambio de >80 en rojo = posible transición
  };

  constructor() {
    // Silencioso
  }

  /**
   * DETECCIÓN PRINCIPAL - Simple y robusta
   */
  detectFinger(
    redValue: number,
    greenValue: number,
    blueValue: number
  ): FingerDetectionResult {
    const now = Date.now();
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 1: VALIDACIÓN DE COLOR (RÁPIDA)
    // ═══════════════════════════════════════════════════════════════════════
    const colorCheck = this.checkColor(redValue, greenValue, blueValue);
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 2: ACTUALIZAR HISTORIAL (solo si color OK)
    // ═══════════════════════════════════════════════════════════════════════
    if (colorCheck.isValid) {
      this.updateHistory(redValue, now);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 3: CALCULAR PULSATILIDAD (informativo)
    // ═══════════════════════════════════════════════════════════════════════
    const pulsatility = this.calculatePulsatility();
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 4: MÁQUINA DE ESTADOS
    // ═══════════════════════════════════════════════════════════════════════
    if (colorCheck.isValid) {
      this.badFrameCount = 0;
      this.goodFrameCount++;
      
      // Confirmar si suficientes frames buenos
      if (this.goodFrameCount >= this.CONFIG.FRAMES_TO_CONFIRM) {
        this.isConfirmed = true;
      }
    } else {
      this.goodFrameCount = Math.max(0, this.goodFrameCount - 1);
      this.badFrameCount++;
      
      // Perder detección solo después de MUCHOS frames malos
      if (this.badFrameCount >= this.CONFIG.FRAMES_TO_LOSE) {
        this.isConfirmed = false;
        this.softReset();
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 5: GENERAR RESULTADO
    // ═══════════════════════════════════════════════════════════════════════
    const isDetected = this.isConfirmed || this.goodFrameCount >= this.CONFIG.FRAMES_TO_CONFIRM;
    
    const confidence = isDetected ? this.calculateConfidence(redValue, pulsatility) : 0;
    const quality = isDetected ? this.calculateQuality(redValue, pulsatility) : 0;
    
    let message: string;
    if (!colorCheck.isValid) {
      message = colorCheck.message;
    } else if (!isDetected) {
      message = `⏳ Confirmando... (${this.goodFrameCount}/${this.CONFIG.FRAMES_TO_CONFIRM})`;
    } else {
      const pulsMsg = pulsatility > this.CONFIG.MIN_PULSATILITY 
        ? `AC=${(pulsatility * 100).toFixed(2)}%` 
        : 'analizando pulso';
      message = `✅ DEDO DETECTADO (R=${redValue.toFixed(0)}, ${pulsMsg})`;
    }
    
    return {
      isFingerDetected: isDetected,
      confidence,
      quality,
      diagnostics: {
        redValue,
        greenValue,
        blueValue,
        redRatio: greenValue > 0 ? redValue / greenValue : 0,
        isRedDominant: redValue > greenValue && redValue > blueValue,
        isProperlyIlluminated: redValue >= 140,
        hasPulsatility: pulsatility > this.CONFIG.MIN_PULSATILITY,
        pulsatilityValue: pulsatility,
        message
      }
    };
  }

  /**
   * VALIDACIÓN DE COLOR - Simple y directa
   */
  private checkColor(r: number, g: number, b: number): { isValid: boolean; message: string } {
    // 1. Valor rojo mínimo
    if (r < this.CONFIG.MIN_RED) {
      return { isValid: false, message: `⚠️ Rojo=${r.toFixed(0)} bajo - Acerque la YEMA al flash` };
    }
    
    // 2. Rojo debe dominar sobre verde
    if (r - g < this.CONFIG.MIN_RED_GREEN_DIFF) {
      return { isValid: false, message: `⚠️ Diferencia R-G=${(r-g).toFixed(0)} - No es tejido humano` };
    }
    
    // 3. Rojo debe dominar sobre azul
    if (r - b < this.CONFIG.MIN_RED_BLUE_DIFF) {
      return { isValid: false, message: `⚠️ Diferencia R-B=${(r-b).toFixed(0)} - No es tejido humano` };
    }
    
    // 4. Proporción de rojo
    const total = r + g + b;
    const redProp = total > 0 ? r / total : 0;
    if (redProp < this.CONFIG.MIN_RED_PROPORTION) {
      return { isValid: false, message: `⚠️ Rojo ${(redProp*100).toFixed(0)}% - Cubra el flash` };
    }
    
    return { isValid: true, message: 'OK' };
  }

  /**
   * ACTUALIZAR HISTORIAL - Sin limpiezas innecesarias
   */
  private updateHistory(redValue: number, timestamp: number): void {
    // Detectar transición muy grande (dedo puesto/quitado)
    if (this.redHistory.length > 0) {
      const lastRed = this.redHistory[this.redHistory.length - 1];
      const delta = Math.abs(redValue - lastRed);
      
      // Solo limpiar en cambio EXTREMO (transición real)
      if (delta > this.CONFIG.TRANSITION_THRESHOLD && this.redHistory.length > 10) {
        // Verificar si es transición real (no variación de pulso)
        const recentAvg = this.redHistory.slice(-10).reduce((a,b) => a+b, 0) / 10;
        const changeFromAvg = Math.abs(redValue - recentAvg);
        
        if (changeFromAvg > this.CONFIG.TRANSITION_THRESHOLD) {
          // Transición real - limpiar parcialmente (mantener algunos datos)
          this.redHistory = this.redHistory.slice(-15);
        }
      }
    }
    
    // Agregar al historial
    this.redHistory.push(redValue);
    this.lastTimestamp = timestamp;
    
    // Mantener tamaño
    if (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
    }
  }

  /**
   * CALCULAR PULSATILIDAD - EMA robusto
   */
  private calculatePulsatility(): number {
    if (this.redHistory.length < 15) {
      return this.pulsatilityEMA; // Retornar último valor conocido
    }
    
    const samples = this.redHistory.slice(-30);
    
    // DC = promedio
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc < 10) return 0;
    
    // AC = desviación estándar * 2
    const variance = samples.reduce((sum, s) => sum + Math.pow(s - dc, 2), 0) / samples.length;
    const ac = Math.sqrt(variance) * 2;
    
    // Pulsatilidad instantánea
    const instantPulsatility = ac / dc;
    
    // Suavizar con EMA
    this.pulsatilityEMA = this.EMA_ALPHA * instantPulsatility + (1 - this.EMA_ALPHA) * this.pulsatilityEMA;
    
    return this.pulsatilityEMA;
  }

  /**
   * CALCULAR CONFIANZA (0-100)
   */
  private calculateConfidence(redValue: number, pulsatility: number): number {
    let confidence = 50; // Base
    
    // Por valor rojo (hasta +25)
    if (redValue >= 180) confidence += 25;
    else if (redValue >= 140) confidence += 18;
    else if (redValue >= 100) confidence += 10;
    
    // Por pulsatilidad (hasta +25)
    if (pulsatility >= this.CONFIG.GOOD_PULSATILITY) confidence += 25;
    else if (pulsatility >= this.CONFIG.MIN_PULSATILITY) confidence += 15;
    
    return Math.min(100, confidence);
  }

  /**
   * CALCULAR CALIDAD (0-100)
   */
  private calculateQuality(redValue: number, pulsatility: number): number {
    let quality = 40; // Base
    
    // Por valor rojo (hasta +30)
    quality += Math.min(30, (redValue / 200) * 30);
    
    // Por pulsatilidad (hasta +30)
    const pulsScore = Math.min(1, pulsatility / this.CONFIG.GOOD_PULSATILITY);
    quality += pulsScore * 30;
    
    return Math.min(100, Math.max(0, quality));
  }

  /**
   * RESET SUAVE - Mantiene estado de confirmación
   */
  private softReset(): void {
    this.redHistory = [];
    this.pulsatilityEMA = 0;
  }

  /**
   * RESET COMPLETO
   */
  reset(): void {
    this.isConfirmed = false;
    this.goodFrameCount = 0;
    this.badFrameCount = 0;
    this.redHistory = [];
    this.pulsatilityEMA = 0;
    this.lastTimestamp = 0;
  }

  /**
   * GETTERS
   */
  isCurrentlyDetected(): boolean {
    return this.isConfirmed;
  }
  
  getRedHistory(): number[] {
    return [...this.redHistory];
  }
  
  getPulsatility(): number {
    return this.pulsatilityEMA;
  }
}
