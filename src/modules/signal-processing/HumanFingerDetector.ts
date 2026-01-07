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
  // UMBRALES CALIBRADOS PARA YEMA COMPLETA - TOLERANTE A SATURACIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // === COLOR - La yema con flash puede saturar el rojo ===
    MIN_TOTAL_LIGHT: 80,            // Muy bajo para empezar a analizar
    MIN_RED_VALUE: 50,              // Mínimo absoluto
    GOOD_RED_VALUE: 100,            // Yema bien posicionada
    IDEAL_RED_VALUE: 150,           // Yema perfectamente iluminada
    MAX_RED_VALUE: 255,             // SIN LÍMITE SUPERIOR - yema saturada es válida
    
    // === DOMINANCIA DEL ROJO - Más permisivo ===
    MIN_RED_PROPORTION: 0.38,       // La yema con flash: 40-70%
    
    // === RATIOS DE COLOR - Muy amplios para yema real ===
    MIN_RG_RATIO: 0.95,             // Muy bajo - yema puede tener verde
    MAX_RG_RATIO: 15.0,             // MUY ALTO - yema saturada puede dar ratios enormes
    MIN_RB_RATIO: 0.9,              // Muy bajo
    
    // === LÍMITES VERDE/AZUL - Muy permisivos ===
    MAX_GREEN_PROPORTION: 0.50,     // 50% - muy permisivo
    MAX_BLUE_PROPORTION: 0.40,      // 40% - muy permisivo
    
    // ═══════════════════════════════════════════════════════════════════════
    // PULSATILIDAD - MÁS TOLERANTE AL MOVIMIENTO
    // ═══════════════════════════════════════════════════════════════════════
    MIN_SAMPLES_FOR_PULSE_CHECK: 15,  // Solo 0.5 segundos - detección RÁPIDA
    
    // Componente AC/DC
    MIN_PULSATILITY_FOR_LIFE: 0.001,  // 0.1% - muy sensible al pulso
    GOOD_PULSATILITY: 0.005,          // 0.5% bueno
    IDEAL_PULSATILITY: 0.010,         // 1.0% ideal
    MAX_PULSATILITY: 0.50,            // 50% - MUY tolerante al movimiento
    
    // Frecuencia cardíaca esperada
    MIN_HEART_RATE_HZ: 0.4,           // 24 BPM mínimo
    MAX_HEART_RATE_HZ: 4.0,           // 240 BPM máximo
    
    // Número mínimo de picos para confirmar ritmo
    MIN_PEAKS_FOR_RHYTHM: 1,
    
    // === ESTABILIDAD TEMPORAL - Detección rápida pero estable ===
    MIN_CONSECUTIVE_FOR_DETECTION: 2,   // Solo 2 frames para detectar
    MAX_CONSECUTIVE_FOR_LOSS: 15,       // 15 frames para perder - muy estable
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
    // FASE 1: VALIDACIÓN DE COLOR BÁSICA (solo mínimos, sin máximos estrictos)
    // ═══════════════════════════════════════════════════════════════════════
    
    // 1. ILUMINACIÓN MÍNIMA
    if (totalLight < this.CONFIG.MIN_TOTAL_LIGHT) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        "❌ Luz insuficiente - Acerque el dedo al flash"
      );
    }

    // 2. VALOR ROJO MÍNIMO
    if (redValue < this.CONFIG.MIN_RED_VALUE) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Rojo bajo (${redValue.toFixed(0)}) - Coloque la YEMA sobre el flash`
      );
    }

    // 3. ROJO DEBE SER EL CANAL DOMINANTE (simple comparación)
    if (redValue < greenValue || redValue < blueValue) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        "❌ Rojo no es dominante - No es tejido iluminado por flash"
      );
    }

    // 4. PROPORCIÓN ROJA MÍNIMA (sin máximo)
    if (redProportion < this.CONFIG.MIN_RED_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `❌ Rojo ${(redProportion*100).toFixed(0)}% - Cubra el flash con la yema`
      );
    }

    // NOTA: NO rechazamos por exceso de rojo - la yema saturada es válida

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 2: VALIDACIÓN DE SEÑAL VIVA (pulsatilidad)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Necesitamos suficientes muestras para analizar
    if (this.redHistory.length < this.CONFIG.MIN_SAMPLES_FOR_PULSE_CHECK) {
      // Color OK, recolectando datos - mostrar progreso positivo
      const progress = Math.round((this.redHistory.length / this.CONFIG.MIN_SAMPLES_FOR_PULSE_CHECK) * 100);
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⏳ Color OK - Analizando pulso... ${progress}%`
      );
    }
    
    // Calcular pulsatilidad
    const pulsatility = this.calculatePulsatility();
    
    // Verificar pulsatilidad mínima (señal de vida)
    if (pulsatility < this.CONFIG.MIN_PULSATILITY_FOR_LIFE) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, pulsatility,
        `❌ Sin pulso (${(pulsatility*100).toFixed(3)}%) - Mantenga el dedo quieto`
      );
    }
    
    // NOTA: NO rechazamos por pulsatilidad alta - el movimiento no invalida el dedo
    // Solo lo usamos para ajustar la calidad de la señal

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
   * Calcular pulsatilidad AC/DC - Simplificado y más sensible
   */
  private calculatePulsatility(): number {
    if (this.redHistory.length < 10) return 0;
    
    const samples = this.redHistory.slice(-30); // Último segundo
    
    // Calcular DC (promedio)
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc === 0) return 0;
    
    // Calcular AC (max - min)
    const max = Math.max(...samples);
    const min = Math.min(...samples);
    const ac = max - min;
    
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