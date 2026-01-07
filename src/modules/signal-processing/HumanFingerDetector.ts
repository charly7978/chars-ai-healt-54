/**
 * @file HumanFingerDetector.ts
 * @description ÚNICO PUNTO DE DETECCIÓN DE DEDO EN TODA LA APP
 * 
 * CRITERIO ESTRICTO: Detectar YEMA DE DEDO HUMANO con SEÑAL VIVA
 * 
 * VALIDACIONES OBLIGATORIAS:
 * 1. Color rojo dominante (tejido iluminado por flash)
 * 2. Ratios de color correctos para hemoglobina
 * 3. PULSATILIDAD OBLIGATORIA - sin pulso NO hay dedo
 * 4. Frecuencia de variación en rango cardíaco (0.5-3 Hz = 30-180 BPM)
 * 
 * Una madera marrón puede tener color similar pero NUNCA tendrá:
 * - Pulsatilidad rítmica
 * - Variación AC por flujo sanguíneo
 * - Frecuencia en rango cardíaco
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
  // Estado temporal con histéresis estricta
  private consecutiveDetections = 0;
  private consecutiveNonDetections = 0;
  private lastDetectionState = false;
  
  // Historial para análisis de pulsatilidad (CRÍTICO)
  private redHistory: number[] = [];
  private timestampHistory: number[] = [];
  private readonly HISTORY_SIZE = 90; // 3 segundos a 30fps
  
  // Análisis de frecuencia
  private peakTimes: number[] = [];
  private lastPeakValue = 0;
  private lastValleyValue = Infinity;
  private trendUp = false;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UMBRALES CALIBRADOS PARA YEMA DE DEDO REAL CON FLASH LED
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // === COLOR - Valores reales de yema iluminada por flash ===
    // La yema con flash produce: R~160-220, G~60-120, B~40-80
    MIN_TOTAL_LIGHT: 120,           // Reducido - yema puede tener menos luz total
    MIN_RED_VALUE: 70,              // Reducido - yema oscura o distante
    GOOD_RED_VALUE: 120,            // Yema bien posicionada
    IDEAL_RED_VALUE: 160,           // Yema perfectamente iluminada
    
    // === DOMINANCIA DEL ROJO ===
    MIN_RED_PROPORTION: 0.42,       // Reducido - yema real: ~45-55%
    
    // === RATIOS DE COLOR - Calibrados para yema real ===
    MIN_RG_RATIO: 1.05,             // Reducido significativamente - yema real: 1.1-2.5
    MAX_RG_RATIO: 6.0,              // Ampliado - flash intenso puede dar ratios altos
    MIN_RB_RATIO: 1.1,              // Reducido - yema real tiene más azul que esperado
    
    // === LÍMITES VERDE/AZUL - Más permisivos ===
    MAX_GREEN_PROPORTION: 0.42,     // Aumentado - yema con flash: 25-38%
    MAX_BLUE_PROPORTION: 0.30,      // Aumentado - yema real: 15-25%
    
    // ═══════════════════════════════════════════════════════════════════════
    // PULSATILIDAD - OBLIGATORIA PARA CONFIRMAR TEJIDO VIVO
    // ═══════════════════════════════════════════════════════════════════════
    MIN_SAMPLES_FOR_PULSE_CHECK: 30,  // Reducido a 1 segundo para respuesta rápida
    
    // Componente AC/DC - variación por pulso sanguíneo
    MIN_PULSATILITY_FOR_LIFE: 0.003,  // 0.3% mínimo - más sensible a pulso débil
    GOOD_PULSATILITY: 0.008,          // 0.8% bueno
    IDEAL_PULSATILITY: 0.015,         // 1.5% ideal
    MAX_PULSATILITY: 0.20,            // 20% máximo - más tolerante a movimiento leve
    
    // Frecuencia cardíaca esperada
    MIN_HEART_RATE_HZ: 0.5,           // 30 BPM mínimo
    MAX_HEART_RATE_HZ: 3.5,           // 210 BPM máximo
    
    // Número mínimo de picos para confirmar ritmo
    MIN_PEAKS_FOR_RHYTHM: 2,
    
    // === ESTABILIDAD TEMPORAL ===
    MIN_CONSECUTIVE_FOR_DETECTION: 3,   // Reducido para respuesta más rápida
    MAX_CONSECUTIVE_FOR_LOSS: 8,        // Aumentado para evitar pérdida intermitente
  };

  constructor() {
    console.log("🔴 HumanFingerDetector: Detector ESTRICTO de tejido vivo");
    console.log("   ⚠️ PULSATILIDAD OBLIGATORIA - Sin pulso = Sin detección");
  }

  /**
   * DETECCIÓN ESTRICTA DE DEDO HUMANO
   * Requiere color correcto Y señal viva (pulsatilidad)
   */
  detectFinger(
    redValue: number,
    greenValue: number,
    blueValue: number
  ): FingerDetectionResult {
    const now = Date.now();
    
    // Actualizar historial
    this.updateHistory(redValue, now);
    
    // Calcular métricas de color
    const totalLight = redValue + greenValue + blueValue;
    const redProportion = totalLight > 0 ? redValue / totalLight : 0;
    const greenProportion = totalLight > 0 ? greenValue / totalLight : 0;
    const blueProportion = totalLight > 0 ? blueValue / totalLight : 0;
    const rgRatio = greenValue > 0 ? redValue / greenValue : 0;
    const rbRatio = blueValue > 0 ? redValue / blueValue : 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // FASE 1: VALIDACIÓN DE COLOR (necesaria pero NO suficiente)
    // ═══════════════════════════════════════════════════════════════════════
    
    // 1. ILUMINACIÓN SUFICIENTE
    if (totalLight < this.CONFIG.MIN_TOTAL_LIGHT) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        "❌ Luz insuficiente - Acerque la yema al flash"
      );
    }

    // 2. VALOR ROJO MÍNIMO
    if (redValue < this.CONFIG.MIN_RED_VALUE) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Rojo insuficiente (${redValue.toFixed(0)}) - Use la YEMA del dedo`
      );
    }

    // 3. DOMINANCIA ROJA
    if (redProportion < this.CONFIG.MIN_RED_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Rojo no dominante (${(redProportion*100).toFixed(0)}%) - Cubra el flash completamente`
      );
    }

    // 4. RATIO R/G
    if (rgRatio < this.CONFIG.MIN_RG_RATIO || rgRatio > this.CONFIG.MAX_RG_RATIO) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Ratio R/G fuera de rango (${rgRatio.toFixed(2)}) - No es tejido humano`
      );
    }

    // 5. RATIO R/B
    if (rbRatio < this.CONFIG.MIN_RB_RATIO) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Demasiado azul - No es piel humana iluminada`
      );
    }

    // 6. VERDE NO EXCESIVO
    if (greenProportion > this.CONFIG.MAX_GREEN_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Verde excesivo (${(greenProportion*100).toFixed(0)}%) - Objeto no es tejido humano`
      );
    }

    // 7. AZUL NO EXCESIVO
    if (blueProportion > this.CONFIG.MAX_BLUE_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Azul excesivo - Luz ambiental o superficie no orgánica`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 2: VALIDACIÓN DE SEÑAL VIVA (OBLIGATORIA)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Necesitamos suficientes muestras para analizar pulsatilidad
    if (this.redHistory.length < this.CONFIG.MIN_SAMPLES_FOR_PULSE_CHECK) {
      // Aún recolectando datos - NO confirmar detección todavía
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⏳ Analizando señal... (${this.redHistory.length}/${this.CONFIG.MIN_SAMPLES_FOR_PULSE_CHECK} muestras)`
      );
    }
    
    // Calcular pulsatilidad (componente AC/DC)
    const pulsatility = this.calculatePulsatility();
    
    // VERIFICACIÓN CRÍTICA: ¿Hay pulsatilidad de tejido vivo?
    if (pulsatility < this.CONFIG.MIN_PULSATILITY_FOR_LIFE) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, pulsatility,
        `❌ SIN PULSO DETECTADO (AC=${(pulsatility*100).toFixed(2)}%) - Objeto inerte, no es dedo humano`
      );
    }
    
    // Verificar que pulsatilidad no sea excesiva (movimiento, no pulso)
    if (pulsatility > this.CONFIG.MAX_PULSATILITY) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, pulsatility,
        `❌ Variación excesiva (${(pulsatility*100).toFixed(1)}%) - Mantenga el dedo quieto`
      );
    }
    
    // Verificar ritmo cardíaco (frecuencia de variación)
    const rhythmValid = this.checkCardiacRhythm();
    if (!rhythmValid) {
      // Tenemos variación pero no en frecuencia cardíaca
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, pulsatility,
        `❌ Variación no cardíaca - Ritmo fuera de rango fisiológico`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TODAS LAS VALIDACIONES PASARON - TEJIDO VIVO CONFIRMADO
    // ═══════════════════════════════════════════════════════════════════════
    this.handleDetection();
    
    const confidence = this.calculateConfidence(redValue, redProportion, rgRatio, pulsatility);
    const quality = this.calculateQuality(redValue, pulsatility, confidence);
    
    const message = this.lastDetectionState 
      ? `✓ DEDO VIVO detectado (R=${redValue.toFixed(0)}, AC=${(pulsatility*100).toFixed(2)}%)`
      : "⏳ Confirmando señal viva...";
    
    return this.createResult(
      this.lastDetectionState, 
      confidence, 
      quality, 
      redValue, greenValue, blueValue, rgRatio, 
      true, pulsatility,
      message
    );
  }

  /**
   * Calcular pulsatilidad AC/DC
   * El pulso cardíaco produce variación de ~0.5-3% en la señal
   */
  private calculatePulsatility(): number {
    if (this.redHistory.length < 30) return 0;
    
    const samples = this.redHistory.slice(-60); // Últimos 2 segundos
    
    // Calcular DC (componente continua - promedio)
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc === 0) return 0;
    
    // Calcular AC (componente alterna - variación pico a pico)
    // Usar percentiles para robustez contra outliers
    const sorted = [...samples].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const ac = p95 - p5;
    
    // Pulsatilidad = AC / DC
    return ac / dc;
  }
  
  /**
   * Verificar que la variación tenga ritmo cardíaco
   * SIMPLIFICADO: solo verificar que hay variación en frecuencia razonable
   */
  private checkCardiacRhythm(): boolean {
    if (this.redHistory.length < 30) return false;
    
    const samples = this.redHistory.slice(-45);
    const timestamps = this.timestampHistory.slice(-45);
    
    if (samples.length !== timestamps.length || samples.length < 20) return false;
    
    // Calcular la media y desviación estándar
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (mean === 0) return false;
    
    // Contar cruces por la media (indica oscilación)
    let crosses = 0;
    let lastAbove = samples[0] > mean;
    
    for (let i = 1; i < samples.length; i++) {
      const currentAbove = samples[i] > mean;
      if (currentAbove !== lastAbove) {
        crosses++;
        lastAbove = currentAbove;
      }
    }
    
    // Tiempo total de la ventana
    const totalTime = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000; // segundos
    if (totalTime <= 0) return false;
    
    // Frecuencia de cruces (cada ciclo tiene 2 cruces)
    const cyclesPerSecond = (crosses / 2) / totalTime;
    
    // Verificar que esté en rango cardíaco (0.5-3.5 Hz = 30-210 BPM)
    const isValidFrequency = cyclesPerSecond >= 0.4 && cyclesPerSecond <= 4.0;
    
    // Si hay al menos algunos cruces y la frecuencia es razonable, aceptar
    return crosses >= 3 && isValidFrequency;
  }

  private handleDetection(): void {
    this.consecutiveDetections++;
    this.consecutiveNonDetections = 0;
    
    if (this.consecutiveDetections >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
      if (!this.lastDetectionState) {
        console.log("✅ DEDO HUMANO VIVO CONFIRMADO - Señal cardíaca detectada");
      }
      this.lastDetectionState = true;
    }
  }

  private handleNonDetection(): void {
    this.consecutiveNonDetections++;
    this.consecutiveDetections = 0;
    
    if (this.consecutiveNonDetections >= this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS) {
      if (this.lastDetectionState) {
        console.log("❌ SEÑAL PERDIDA - No hay pulso cardíaco");
      }
      this.lastDetectionState = false;
    }
  }

  private updateHistory(redValue: number, timestamp: number): void {
    this.redHistory.push(redValue);
    this.timestampHistory.push(timestamp);
    
    if (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
      this.timestampHistory.shift();
    }
  }

  private calculateConfidence(
    redValue: number,
    redProportion: number,
    rgRatio: number,
    pulsatility: number
  ): number {
    let confidence = 0;
    
    // Score por rojo (0-25)
    if (redValue >= this.CONFIG.IDEAL_RED_VALUE) {
      confidence += 25;
    } else if (redValue >= this.CONFIG.GOOD_RED_VALUE) {
      confidence += 18;
    } else {
      confidence += (redValue / this.CONFIG.GOOD_RED_VALUE) * 15;
    }
    
    // Score por proporción roja (0-20)
    confidence += Math.min(20, redProportion * 35);
    
    // Score por ratio R/G ideal ~2.0 (0-15)
    const idealRG = 2.0;
    const rgDeviation = Math.abs(rgRatio - idealRG);
    confidence += Math.max(0, 15 - rgDeviation * 5);
    
    // Score por pulsatilidad (0-40) - MUY IMPORTANTE
    if (pulsatility >= this.CONFIG.IDEAL_PULSATILITY) {
      confidence += 40;
    } else if (pulsatility >= this.CONFIG.GOOD_PULSATILITY) {
      confidence += 30;
    } else if (pulsatility >= this.CONFIG.MIN_PULSATILITY_FOR_LIFE) {
      confidence += 20;
    }
    
    return Math.min(100, Math.max(0, confidence));
  }

  private calculateQuality(
    redValue: number,
    pulsatility: number,
    confidence: number
  ): number {
    let quality = confidence * 0.4;
    
    // Bonus por rojo ideal (0-20)
    if (redValue >= this.CONFIG.IDEAL_RED_VALUE) {
      quality += 20;
    } else if (redValue >= this.CONFIG.GOOD_RED_VALUE) {
      quality += 12;
    }
    
    // Bonus por pulsatilidad (0-40) - CRÍTICO para calidad
    if (pulsatility >= this.CONFIG.IDEAL_PULSATILITY) {
      quality += 40;
    } else if (pulsatility >= this.CONFIG.GOOD_PULSATILITY) {
      quality += 28;
    } else if (pulsatility >= this.CONFIG.MIN_PULSATILITY_FOR_LIFE) {
      quality += 15;
    }
    
    return Math.min(100, Math.max(0, quality));
  }

  private createResult(
    detected: boolean,
    confidence: number,
    quality: number,
    redValue: number,
    greenValue: number,
    blueValue: number,
    rgRatio: number,
    hasPulsatility: boolean,
    pulsatilityValue: number,
    message: string
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
        hasPulsatility,
        pulsatilityValue,
        message
      }
    };
  }

  reset(): void {
    this.consecutiveDetections = 0;
    this.consecutiveNonDetections = 0;
    this.lastDetectionState = false;
    this.redHistory = [];
    this.timestampHistory = [];
    this.peakTimes = [];
    console.log("🔄 HumanFingerDetector: Reset completo");
  }

  isCurrentlyDetected(): boolean {
    return this.lastDetectionState;
  }
  
  getRedHistory(): number[] {
    return [...this.redHistory];
  }
  
  getPulsatility(): number {
    return this.calculatePulsatility();
  }
}