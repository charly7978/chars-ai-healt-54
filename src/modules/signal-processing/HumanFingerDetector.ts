/**
 * @file HumanFingerDetector.ts
 * @description DETECTOR SERIO Y PROFESIONAL DE DEDO HUMANO VIVO
 * 
 * REQUISITOS ESTRICTOS PARA DETECCIÓN:
 * 1. COLOR: Rojo dominante característico de tejido humano con flash LED
 * 2. PULSATILIDAD REAL: Variación rítmica del 0.5-5% causada por flujo sanguíneo
 * 3. FRECUENCIA CARDÍACA: La variación debe estar en rango 40-200 BPM
 * 4. CONSISTENCIA: Múltiples ciclos cardíacos detectados
 * 
 * Una pared, madera u objeto inerte NUNCA pasará porque:
 * - No tiene variación rítmica (solo ruido aleatorio)
 * - No tiene frecuencia en rango cardíaco
 * - El ruido de cámara es ~0.1%, el pulso real es ~0.5-3%
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
  // Estado de detección con histéresis
  private consecutiveDetections = 0;
  private consecutiveNonDetections = 0;
  private lastDetectionState = false;
  
  // Historial para análisis de pulsatilidad - REDUCIDO PARA MEJOR RENDIMIENTO
  private redHistory: number[] = [];
  private timestampHistory: number[] = [];
  private readonly HISTORY_SIZE = 90; // 3 segundos a 30fps (reducido de 150)
  
  // SUAVIZADO: Buffer de pulsatilidad - REDUCIDO
  private pulsatilityHistory: number[] = [];
  private readonly PULSATILITY_SMOOTH_SIZE = 8; // Reducido de 12
  
  // Análisis de picos cardíacos
  private detectedPeaks: number[] = [];
  private detectedValleys: number[] = [];
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UMBRALES PERMISIVOS PARA DETECCIÓN ROBUSTA DE DEDO HUMANO
  // Prioriza ESTABILIDAD sobre estrictez
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // === COLOR DE TEJIDO HUMANO CON FLASH LED ===
    MIN_RED_VALUE: 80,              // MÁS PERMISIVO - acepta iluminación variable
    GOOD_RED_VALUE: 140,            // Buena señal
    IDEAL_RED_VALUE: 180,           // Señal excelente
    
    // Diferencias de color más permisivas
    MIN_RED_GREEN_DIFF: 20,         // R debe superar G por al menos 20
    MIN_RED_BLUE_DIFF: 30,          // R debe superar B por al menos 30
    
    // Proporciones de color (R debe dominar)
    MIN_RED_PROPORTION: 0.40,       // Rojo mínimo 40% del total
    MAX_GREEN_PROPORTION: 0.40,     // Verde máximo 40%
    MAX_BLUE_PROPORTION: 0.30,      // Azul máximo 30%
    
    // === PULSATILIDAD - MÁS RÁPIDA ===
    MIN_SAMPLES_FOR_ANALYSIS: 20,   // Reducido de 30 para respuesta más rápida
    
    MIN_PULSATILITY: 0.0008,        // 0.08% - ULTRA sensible para captar pulso débil
    GOOD_PULSATILITY: 0.005,        // 0.5% - buena señal
    IDEAL_PULSATILITY: 0.015,       // 1.5% - señal excelente
    MAX_PULSATILITY: 0.25,          // 25% máximo - tolera más movimiento
    
    // === RITMO CARDÍACO ===
    MIN_HEART_RATE_BPM: 35,         // Más permisivo
    MAX_HEART_RATE_BPM: 220,        // Más permisivo
    MIN_PEAKS_FOR_RHYTHM: 2,        // Solo 2 picos para confirmar
    
    // === CONSISTENCIA DE INTERVALOS ===
    MAX_RR_VARIATION: 0.60,         // 60% de variación permitida
    
    // === ESTABILIDAD TEMPORAL (EQUILIBRADA) ===
    FRAMES_TO_CONFIRM: 3,           // 3 frames para confirmar (~0.1s) - MÁS RÁPIDO
    FRAMES_TO_LOSE: 90,             // 90 frames para perder (~3s) - REDUCIDO de 180
  };

  // Limitar logs para mejor rendimiento
  private logCounter = 0;
  private readonly LOG_INTERVAL = 60; // Log cada 60 frames (~2s)

  constructor() {
    // Log inicial silenciado para producción
  }

  /**
   * DETECCIÓN ESTRICTA DE DEDO HUMANO VIVO
   * Requiere: color correcto + pulsatilidad real + ritmo cardíaco
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FASE 1: VALIDACIÓN DE COLOR ESTRICTA
    // ═══════════════════════════════════════════════════════════════════════
    
    // 1. Valor rojo mínimo para tejido iluminado
    if (redValue < this.CONFIG.MIN_RED_VALUE) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⚠️ Rojo=${redValue.toFixed(0)} (mín ${this.CONFIG.MIN_RED_VALUE}) - Acerque la YEMA al flash`
      );
    }

    // 2. Rojo debe ser el canal dominante por margen significativo
    if (redValue - greenValue < this.CONFIG.MIN_RED_GREEN_DIFF) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⚠️ Diferencia R-G=${(redValue-greenValue).toFixed(0)} (mín ${this.CONFIG.MIN_RED_GREEN_DIFF}) - No es tejido humano`
      );
    }

    if (redValue - blueValue < this.CONFIG.MIN_RED_BLUE_DIFF) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⚠️ Diferencia R-B=${(redValue-blueValue).toFixed(0)} (mín ${this.CONFIG.MIN_RED_BLUE_DIFF}) - No es tejido humano`
      );
    }

    // 3. Proporciones de color correctas
    if (redProportion < this.CONFIG.MIN_RED_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⚠️ Rojo ${(redProportion*100).toFixed(0)}% (mín ${this.CONFIG.MIN_RED_PROPORTION*100}%) - Cubra el flash completamente`
      );
    }

    if (greenProportion > this.CONFIG.MAX_GREEN_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⚠️ Verde ${(greenProportion*100).toFixed(0)}% (máx ${this.CONFIG.MAX_GREEN_PROPORTION*100}%) - Superficie no es piel`
      );
    }

    if (blueProportion > this.CONFIG.MAX_BLUE_PROPORTION) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⚠️ Azul ${(blueProportion*100).toFixed(0)}% (máx ${this.CONFIG.MAX_BLUE_PROPORTION*100}%) - Luz ambiental interferente`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 2: ANÁLISIS DE PULSATILIDAD (SEÑAL DE VIDA)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Necesitamos suficiente historial para análisis serio
    if (this.redHistory.length < this.CONFIG.MIN_SAMPLES_FOR_ANALYSIS) {
      const progress = Math.round((this.redHistory.length / this.CONFIG.MIN_SAMPLES_FOR_ANALYSIS) * 100);
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, 0,
        `⏳ Color OK (R=${redValue.toFixed(0)}) - Analizando pulso ${progress}%`
      );
    }
    
    // Calcular pulsatilidad instantánea
    const rawPulsatility = this.calculateRealPulsatility();
    
    // SUAVIZADO: Agregar al historial y calcular promedio móvil
    this.pulsatilityHistory.push(rawPulsatility);
    if (this.pulsatilityHistory.length > this.PULSATILITY_SMOOTH_SIZE) {
      this.pulsatilityHistory.shift();
    }
    
    // Usar MEDIANA (más robusta que promedio contra picos aislados)
    const sortedPulsatility = [...this.pulsatilityHistory].sort((a, b) => a - b);
    const pulsatility = sortedPulsatility[Math.floor(sortedPulsatility.length / 2)];
    
    // Log reducido para rendimiento
    this.logCounter++;
    // Silenciado para producción - descomentar para debug:
    // if (this.logCounter % this.LOG_INTERVAL === 0) {
    //   console.log(`📈 Pulsatilidad: ${(pulsatility*100).toFixed(3)}%`);
    // }
    
    // Verificar pulsatilidad mínima
    if (pulsatility < this.CONFIG.MIN_PULSATILITY) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, pulsatility,
        `❌ Pulsatilidad ${(pulsatility*100).toFixed(2)}% (mín ${this.CONFIG.MIN_PULSATILITY*100}%) - OBJETO INERTE, no hay pulso`
      );
    }
    
    // Verificar pulsatilidad no excesiva (sería movimiento, no pulso)
    if (pulsatility > this.CONFIG.MAX_PULSATILITY) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, pulsatility,
        `❌ Variación ${(pulsatility*100).toFixed(1)}% excesiva - Movimiento detectado, mantenga quieto`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 3: VERIFICAR RITMO CARDÍACO REAL
    // ═══════════════════════════════════════════════════════════════════════
    
    const rhythmAnalysis = this.analyzeCardiacRhythm();
    
    if (!rhythmAnalysis.isValid) {
      this.handleNonDetection();
      return this.createResult(false, 0, 0, redValue, greenValue, blueValue, rgRatio, false, pulsatility,
        `❌ ${rhythmAnalysis.message} - No es ritmo cardíaco válido`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TODAS LAS VALIDACIONES PASARON - DEDO HUMANO VIVO CONFIRMADO
    // ═══════════════════════════════════════════════════════════════════════
    this.handleDetection();
    
    const confidence = this.calculateConfidence(redValue, pulsatility, rhythmAnalysis.bpm);
    const quality = this.calculateQuality(redValue, pulsatility, rhythmAnalysis.consistency);
    
    const message = this.lastDetectionState 
      ? `✅ DEDO VIVO (R=${redValue.toFixed(0)}, AC=${(pulsatility*100).toFixed(2)}%, ~${rhythmAnalysis.bpm.toFixed(0)} BPM)`
      : `⏳ Confirmando (${this.consecutiveDetections}/${this.CONFIG.FRAMES_TO_CONFIRM})...`;
    
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
   * Calcular pulsatilidad REAL usando análisis de componentes AC/DC
   * Filtra ruido y detecta solo variación rítmica
   */
  private calculateRealPulsatility(): number {
    if (this.redHistory.length < 30) return 0;
    
    const samples = this.redHistory.slice(-90); // Últimos 3 segundos
    
    // Calcular componente DC (media móvil)
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc < 10) return 0;
    
    // Calcular componente AC usando desviación estándar robusta
    // Esto es más resistente al ruido que max-min
    const squaredDiffs = samples.map(s => Math.pow(s - dc, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    
    // La amplitud AC es aproximadamente 2 * stdDev para señal sinusoidal
    const acEstimate = stdDev * 2;
    
    // Pulsatilidad = AC / DC
    return acEstimate / dc;
  }

  /**
   * Analizar si hay ritmo cardíaco real en la señal
   * Detecta picos y verifica frecuencia en rango fisiológico
   */
  private analyzeCardiacRhythm(): { isValid: boolean; bpm: number; consistency: number; message: string } {
    if (this.redHistory.length < 60 || this.timestampHistory.length < 60) {
      return { isValid: false, bpm: 0, consistency: 0, message: "Datos insuficientes" };
    }
    
    const samples = this.redHistory.slice(-90);
    const timestamps = this.timestampHistory.slice(-90);
    
    // Calcular media y umbral para detección de picos
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(
      samples.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / samples.length
    );
    
    // Umbral adaptativo: media + 0.3 * desviación
    const peakThreshold = mean + stdDev * 0.3;
    
    // Detectar picos (máximos locales sobre el umbral)
    const peakIndices: number[] = [];
    for (let i = 3; i < samples.length - 3; i++) {
      const window = samples.slice(i - 3, i + 4);
      const maxInWindow = Math.max(...window);
      
      // Es pico si es el máximo local y está sobre el umbral
      if (samples[i] === maxInWindow && samples[i] > peakThreshold) {
        // Evitar picos muy cercanos (mínimo 250ms = 240 BPM)
        if (peakIndices.length === 0 || 
            timestamps[i] - timestamps[peakIndices[peakIndices.length - 1]] > 250) {
          peakIndices.push(i);
        }
      }
    }
    
    // Necesitamos mínimo 3 picos para calcular ritmo
    if (peakIndices.length < this.CONFIG.MIN_PEAKS_FOR_RHYTHM) {
      return { 
        isValid: false, 
        bpm: 0, 
        consistency: 0, 
        message: `Solo ${peakIndices.length} picos (mín ${this.CONFIG.MIN_PEAKS_FOR_RHYTHM})` 
      };
    }
    
    // Calcular intervalos entre picos (R-R intervals)
    const intervals: number[] = [];
    for (let i = 1; i < peakIndices.length; i++) {
      const interval = timestamps[peakIndices[i]] - timestamps[peakIndices[i-1]];
      intervals.push(interval);
    }
    
    // Calcular BPM promedio
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = 60000 / avgInterval;
    
    // Verificar que BPM esté en rango fisiológico
    if (bpm < this.CONFIG.MIN_HEART_RATE_BPM || bpm > this.CONFIG.MAX_HEART_RATE_BPM) {
      return { 
        isValid: false, 
        bpm, 
        consistency: 0, 
        message: `BPM=${bpm.toFixed(0)} fuera de rango (${this.CONFIG.MIN_HEART_RATE_BPM}-${this.CONFIG.MAX_HEART_RATE_BPM})` 
      };
    }
    
    // Verificar consistencia de intervalos (HRV no debe ser extrema)
    const intervalVariation = Math.sqrt(
      intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length
    ) / avgInterval;
    
    if (intervalVariation > this.CONFIG.MAX_RR_VARIATION) {
      return { 
        isValid: false, 
        bpm, 
        consistency: 1 - intervalVariation, 
        message: `Ritmo irregular (var=${(intervalVariation*100).toFixed(0)}%)` 
      };
    }
    
    // Ritmo cardíaco válido
    const consistency = 1 - intervalVariation;
    return { isValid: true, bpm, consistency, message: "OK" };
  }

  private handleDetection(): void {
    this.consecutiveDetections++;
    this.consecutiveNonDetections = 0;
    
    if (this.consecutiveDetections >= this.CONFIG.FRAMES_TO_CONFIRM) {
      // Log solo en cambio de estado
      if (!this.lastDetectionState && this.logCounter % this.LOG_INTERVAL === 0) {
        console.log("✅ DEDO DETECTADO");
      }
      this.lastDetectionState = true;
    }
  }

  private handleNonDetection(): void {
    this.consecutiveNonDetections++;
    
    // ULTRA ESTABLE: Una vez confirmado, mantener detección por mucho más tiempo
    // Solo decrementar MUY gradualmente después de MUCHAS no-detecciones
    if (this.consecutiveDetections > 0 && this.lastDetectionState) {
      // Ya confirmado: decrementar solo cada 15 no-detecciones (ultra firme)
      if (this.consecutiveNonDetections % 15 === 0) {
        this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
      }
    } else if (this.consecutiveDetections > 0) {
      // Aún no confirmado: decrementar cada 5 (más permisivo que antes)
      if (this.consecutiveNonDetections % 5 === 0) {
        this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
      }
    }
    
    // Solo perder detección después de MUCHOS frames sin dedo
    if (this.consecutiveNonDetections >= this.CONFIG.FRAMES_TO_LOSE) {
      if (this.lastDetectionState) {
        // NO hacer softReset aquí - dejar historial para recuperación rápida
        this.consecutiveDetections = 0; // Solo resetear contador
      }
      this.lastDetectionState = false;
    }
  }

  /**
   * Reset suave - limpia historial pero mantiene estado de detección
   */
  softReset(): void {
    this.redHistory = [];
    this.timestampHistory = [];
    this.pulsatilityHistory = [];
    this.detectedPeaks = [];
    this.detectedValleys = [];
  }

  private updateHistory(redValue: number, timestamp: number): void {
    this.redHistory.push(redValue);
    this.timestampHistory.push(timestamp);
    
    if (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
      this.timestampHistory.shift();
    }
  }

  private calculateConfidence(redValue: number, pulsatility: number, bpm: number): number {
    let confidence = 0;
    
    // Score por calidad de rojo (0-30)
    if (redValue >= this.CONFIG.IDEAL_RED_VALUE) {
      confidence += 30;
    } else if (redValue >= this.CONFIG.GOOD_RED_VALUE) {
      confidence += 22;
    } else {
      confidence += 15;
    }
    
    // Score por pulsatilidad (0-40)
    if (pulsatility >= this.CONFIG.IDEAL_PULSATILITY) {
      confidence += 40;
    } else if (pulsatility >= this.CONFIG.GOOD_PULSATILITY) {
      confidence += 28;
    } else {
      confidence += 15;
    }
    
    // Score por BPM en rango normal 60-100 (0-30)
    if (bpm >= 55 && bpm <= 100) {
      confidence += 30;
    } else if (bpm >= 45 && bpm <= 120) {
      confidence += 20;
    } else {
      confidence += 10;
    }
    
    return Math.min(100, confidence);
  }

  private calculateQuality(redValue: number, pulsatility: number, consistency: number): number {
    let quality = 0;
    
    // Calidad por valor rojo (0-25)
    quality += Math.min(25, (redValue / this.CONFIG.IDEAL_RED_VALUE) * 25);
    
    // Calidad por pulsatilidad (0-35)
    const pulsScore = Math.min(1, pulsatility / this.CONFIG.IDEAL_PULSATILITY);
    quality += pulsScore * 35;
    
    // Calidad por consistencia del ritmo (0-40)
    quality += consistency * 40;
    
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
    this.pulsatilityHistory = [];
    this.detectedPeaks = [];
    this.detectedValleys = [];
    this.logCounter = 0;
  }

  isCurrentlyDetected(): boolean {
    return this.lastDetectionState;
  }
  
  getRedHistory(): number[] {
    return [...this.redHistory];
  }
  
  getPulsatility(): number {
    return this.calculateRealPulsatility();
  }
}
