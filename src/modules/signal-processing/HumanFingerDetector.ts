/**
 * @file HumanFingerDetector.ts
 * @description DETECTOR ULTRA-ESTRICTO DE DEDO HUMANO VIVO
 * 
 * ANTI-FALSOS POSITIVOS: Detecta SOLO señales de sangre humana real
 * El ambiente, paredes, objetos NO deben pasar estos filtros
 * 
 * CRITERIOS CIENTÍFICOS (basados en literatura PPG):
 * 1. COLOR: Tejido con sangre bajo flash LED tiene R >> G >> B
 * 2. PULSATILIDAD: Variación rítmica 0.5-8% (sangre latiendo)
 * 3. PERIODICIDAD: La señal debe ser cuasi-periódica (30-180 BPM)
 * 4. RATIO AC/DC: Típico 0.5%-5% para PPG real
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
    hasPeriodicSignal: boolean;
    acDcRatio: number;
    message: string;
  };
}

export class HumanFingerDetector {
  // ═══════════════════════════════════════════════════════════════════════════
  // ESTADO DE DETECCIÓN - ESTRICTO
  // ═══════════════════════════════════════════════════════════════════════════
  private isConfirmed = false;
  private consecutiveValidFrames = 0;
  private consecutiveInvalidFrames = 0;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORIAL - Para análisis de periodicidad
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly HISTORY_SIZE = 180;  // 6 segundos a 30fps
  private redHistory: number[] = [];
  private timestampHistory: number[] = [];
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UMBRALES CIENTÍFICOS ESTRICTOS - ANTI FALSOS POSITIVOS
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly CONFIG = {
    // === COLOR ESTRICTO (tejido iluminado por flash) ===
    MIN_RED: 100,                  // Más alto: dedo real bajo flash es MUY rojo
    GOOD_RED: 160,                 // Óptimo
    MIN_RED_GREEN_DIFF: 25,        // Rojo debe dominar claramente
    MIN_RED_BLUE_DIFF: 35,         // Sangre absorbe azul fuertemente  
    MIN_RED_PROPORTION: 0.42,      // Mínimo 42% del total debe ser rojo
    MAX_SATURATION: 250,           // Evitar oversaturation
    
    // === PULSATILIDAD ESTRICTA (sangre real) ===
    MIN_SAMPLES_FOR_PULSATILITY: 45, // ~1.5 segundos (más muestras)
    MIN_PULSATILITY: 0.004,        // 0.4% mínimo (señal real tiene variación)
    MAX_PULSATILITY: 0.12,         // 12% máximo (muy alto = movimiento)
    
    // === AC/DC RATIO (clave para PPG real) ===
    MIN_AC_DC_RATIO: 0.003,        // 0.3% mínimo
    MAX_AC_DC_RATIO: 0.08,         // 8% máximo
    
    // === PERIODICIDAD (señal debe ser cuasi-periódica) ===
    MIN_PERIODICITY_SCORE: 0.25,   // Mínimo 25% de autocorrelación
    MIN_PERIOD_MS: 333,            // 180 BPM máximo
    MAX_PERIOD_MS: 2000,           // 30 BPM mínimo
    
    // === CONFIRMACIÓN ===
    FRAMES_TO_CONFIRM: 15,         // ~0.5 segundos de señal válida
    MAX_INVALID_FRAMES: 8,         // Menos tolerancia a frames malos
    DEGRADATION_RATE: 0.5,
  };

  constructor() {
    console.log("🔬 HumanFingerDetector: Inicializado (modo ANTI-FALSOS POSITIVOS)");
  }

  /**
   * DETECCIÓN PRINCIPAL - ULTRA ESTRICTA
   */
  detectFinger(
    redValue: number,
    greenValue: number,
    blueValue: number
  ): FingerDetectionResult {
    const now = Date.now();
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 1: VALIDACIÓN DE COLOR ESTRICTA
    // ═══════════════════════════════════════════════════════════════════════
    const colorCheck = this.validateColor(redValue, greenValue, blueValue);
    
    if (!colorCheck.isValid) {
      this.consecutiveInvalidFrames++;
      
      // Menos tolerancia que antes
      if (this.isConfirmed && this.consecutiveInvalidFrames < this.CONFIG.MAX_INVALID_FRAMES) {
        this.consecutiveValidFrames = Math.max(0, this.consecutiveValidFrames - this.CONFIG.DEGRADATION_RATE);
        return this.createResult(
          true, 
          Math.max(30, 100 - this.consecutiveInvalidFrames * 8),
          Math.max(20, 70 - this.consecutiveInvalidFrames * 5),
          redValue, greenValue, blueValue,
          false, 0, false, 0,
          `⚠️ Señal débil (${this.consecutiveInvalidFrames}/${this.CONFIG.MAX_INVALID_FRAMES})`
        );
      }
      
      if (this.consecutiveInvalidFrames >= this.CONFIG.MAX_INVALID_FRAMES) {
        this.invalidate();
      }
      
      return this.createResult(
        false, 0, 0, 
        redValue, greenValue, blueValue,
        false, 0, false, 0,
        colorCheck.message
      );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 2: AGREGAR A HISTORIAL
    // ═══════════════════════════════════════════════════════════════════════
    this.consecutiveInvalidFrames = 0;
    this.addToHistory(redValue, now);
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 3: ¿SUFICIENTES MUESTRAS?
    // ═══════════════════════════════════════════════════════════════════════
    if (this.redHistory.length < this.CONFIG.MIN_SAMPLES_FOR_PULSATILITY) {
      const progress = Math.round((this.redHistory.length / this.CONFIG.MIN_SAMPLES_FOR_PULSATILITY) * 100);
      return this.createResult(
        false, 0, 0,
        redValue, greenValue, blueValue,
        false, 0, false, 0,
        `⏳ Analizando señal ${progress}%`
      );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 4: CALCULAR MÉTRICAS DE SEÑAL REAL
    // ═══════════════════════════════════════════════════════════════════════
    const metrics = this.calculateSignalMetrics();
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 5: VALIDAR PULSATILIDAD (AC/DC)
    // ═══════════════════════════════════════════════════════════════════════
    const hasPulsatility = metrics.pulsatility >= this.CONFIG.MIN_PULSATILITY && 
                           metrics.pulsatility <= this.CONFIG.MAX_PULSATILITY;
    
    const hasValidAcDc = metrics.acDcRatio >= this.CONFIG.MIN_AC_DC_RATIO &&
                         metrics.acDcRatio <= this.CONFIG.MAX_AC_DC_RATIO;
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 6: VALIDAR PERIODICIDAD (señal cuasi-periódica)
    // ═══════════════════════════════════════════════════════════════════════
    const hasPeriodicity = metrics.periodicityScore >= this.CONFIG.MIN_PERIODICITY_SCORE;
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 7: DECISIÓN FINAL - DEBE CUMPLIR TODO
    // ═══════════════════════════════════════════════════════════════════════
    const isValidSignal = hasPulsatility && hasValidAcDc && hasPeriodicity;
    
    if (!isValidSignal) {
      // Señal no válida - puede ser ruido, pared, ambiente
      let message = "❌ ";
      if (!hasPulsatility) {
        message += `Sin pulso (${(metrics.pulsatility * 100).toFixed(2)}%)`;
      } else if (!hasValidAcDc) {
        message += `AC/DC fuera de rango (${(metrics.acDcRatio * 100).toFixed(2)}%)`;
      } else if (!hasPeriodicity) {
        message += `Sin ritmo cardíaco (${(metrics.periodicityScore * 100).toFixed(0)}%)`;
      }
      
      // Si ya estaba confirmado, degradar
      if (this.isConfirmed) {
        this.consecutiveValidFrames -= 1;
        if (this.consecutiveValidFrames < this.CONFIG.FRAMES_TO_CONFIRM / 2) {
          this.invalidate();
        }
        return this.createResult(
          true, 50, 30,
          redValue, greenValue, blueValue,
          hasPulsatility, metrics.pulsatility, hasPeriodicity, metrics.acDcRatio,
          `⏳ Verificando...`
        );
      }
      
      return this.createResult(
        false, 0, 0,
        redValue, greenValue, blueValue,
        hasPulsatility, metrics.pulsatility, hasPeriodicity, metrics.acDcRatio,
        message
      );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PASO 8: SEÑAL VÁLIDA - INCREMENTAR CONTADOR
    // ═══════════════════════════════════════════════════════════════════════
    this.consecutiveValidFrames++;
    
    if (this.consecutiveValidFrames >= this.CONFIG.FRAMES_TO_CONFIRM) {
      this.isConfirmed = true;
    }
    
    const confidence = this.isConfirmed ? this.calculateConfidence(redValue, metrics) : 0;
    const quality = this.isConfirmed ? this.calculateQuality(redValue, metrics) : 0;
    
    const message = this.isConfirmed
      ? `✅ DEDO VIVO (Pulso=${(metrics.pulsatility * 100).toFixed(1)}%, Ritmo=${(metrics.periodicityScore * 100).toFixed(0)}%)`
      : `⏳ Confirmando (${this.consecutiveValidFrames}/${this.CONFIG.FRAMES_TO_CONFIRM})`;
    
    return this.createResult(
      this.isConfirmed, confidence, quality,
      redValue, greenValue, blueValue,
      true, metrics.pulsatility, true, metrics.acDcRatio,
      message
    );
  }

  /**
   * VALIDACIÓN DE COLOR ESTRICTA
   */
  private validateColor(r: number, g: number, b: number): { isValid: boolean; message: string } {
    // 1. Rojo mínimo (flash + sangre = mucho rojo)
    if (r < this.CONFIG.MIN_RED) {
      return { isValid: false, message: `SIN DEDO: Rojo=${r.toFixed(0)} (mín ${this.CONFIG.MIN_RED})` };
    }
    
    // 2. No oversaturado
    if (r > this.CONFIG.MAX_SATURATION && g > this.CONFIG.MAX_SATURATION) {
      return { isValid: false, message: `SATURADO: Acercar dedo` };
    }
    
    // 3. Rojo debe dominar sobre verde
    const rgDiff = r - g;
    if (rgDiff < this.CONFIG.MIN_RED_GREEN_DIFF) {
      return { isValid: false, message: `NO ES DEDO: R-G=${rgDiff.toFixed(0)} (mín ${this.CONFIG.MIN_RED_GREEN_DIFF})` };
    }
    
    // 4. Rojo debe dominar sobre azul (sangre absorbe azul)
    const rbDiff = r - b;
    if (rbDiff < this.CONFIG.MIN_RED_BLUE_DIFF) {
      return { isValid: false, message: `NO ES DEDO: R-B=${rbDiff.toFixed(0)} (mín ${this.CONFIG.MIN_RED_BLUE_DIFF})` };
    }
    
    // 5. Proporción de rojo en el total
    const total = r + g + b;
    if (total > 0) {
      const redProp = r / total;
      if (redProp < this.CONFIG.MIN_RED_PROPORTION) {
        return { isValid: false, message: `NO ES DEDO: Rojo=${(redProp*100).toFixed(0)}% (mín ${(this.CONFIG.MIN_RED_PROPORTION*100).toFixed(0)}%)` };
      }
    }
    
    return { isValid: true, message: 'Color válido' };
  }

  /**
   * AGREGAR A HISTORIAL
   */
  private addToHistory(redValue: number, timestamp: number): void {
    this.redHistory.push(redValue);
    this.timestampHistory.push(timestamp);
    
    while (this.redHistory.length > this.HISTORY_SIZE) {
      this.redHistory.shift();
      this.timestampHistory.shift();
    }
  }

  /**
   * CALCULAR MÉTRICAS DE SEÑAL - CLAVE ANTI FALSOS POSITIVOS
   */
  private calculateSignalMetrics(): { 
    pulsatility: number; 
    acDcRatio: number; 
    periodicityScore: number;
  } {
    if (this.redHistory.length < 45) {
      return { pulsatility: 0, acDcRatio: 0, periodicityScore: 0 };
    }
    
    const samples = this.redHistory.slice(-90);
    const n = samples.length;
    
    // === DC (componente continua = promedio) ===
    const dc = samples.reduce((a, b) => a + b, 0) / n;
    if (dc < 50) return { pulsatility: 0, acDcRatio: 0, periodicityScore: 0 };
    
    // === AC (componente pulsátil) ===
    const variance = samples.reduce((sum, s) => sum + Math.pow(s - dc, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const ac = stdDev * 2; // Aproxima amplitud pico-pico
    
    // === PULSATILIDAD = AC/DC ===
    const pulsatility = ac / dc;
    
    // === AC/DC RATIO (más preciso con min/max) ===
    const maxVal = Math.max(...samples);
    const minVal = Math.min(...samples);
    const acDcRatio = (maxVal - minVal) / (2 * dc);
    
    // === PERIODICIDAD (autocorrelación) ===
    const periodicityScore = this.calculatePeriodicity(samples, dc);
    
    return { pulsatility, acDcRatio, periodicityScore };
  }

  /**
   * CALCULAR PERIODICIDAD - DETECTA SI HAY RITMO CARDÍACO REAL
   * 
   * Ruido ambiental NO tiene periodicidad en rango 30-180 BPM
   * Señal cardíaca SÍ tiene autocorrelación fuerte en ese rango
   */
  private calculatePeriodicity(samples: number[], mean: number): number {
    const n = samples.length;
    if (n < 60) return 0;
    
    // Normalizar señal (restar media)
    const normalized = samples.map(s => s - mean);
    
    // Buscar pico de autocorrelación en rango de frecuencia cardíaca
    // 30 BPM = 2000ms, 180 BPM = 333ms
    // A 30fps: lag 10-60 frames (333-2000ms)
    const minLag = 10;  // ~333ms
    const maxLag = 60;  // ~2000ms
    
    let maxCorrelation = 0;
    let bestLag = 0;
    
    // Calcular energía de la señal
    const energy = normalized.reduce((sum, v) => sum + v * v, 0);
    if (energy < 0.001) return 0;
    
    for (let lag = minLag; lag <= maxLag && lag < n / 2; lag++) {
      let correlation = 0;
      let count = 0;
      
      for (let i = 0; i < n - lag; i++) {
        correlation += normalized[i] * normalized[i + lag];
        count++;
      }
      
      // Normalizar correlación
      const normalizedCorr = count > 0 ? correlation / (energy * 0.5) : 0;
      
      if (normalizedCorr > maxCorrelation) {
        maxCorrelation = normalizedCorr;
        bestLag = lag;
      }
    }
    
    // La autocorrelación de señal cardíaca real debe ser > 0.3
    // Ruido aleatorio tiene autocorrelación cercana a 0
    return Math.max(0, Math.min(1, maxCorrelation));
  }

  /**
   * INVALIDAR DETECCIÓN
   */
  private invalidate(): void {
    this.isConfirmed = false;
    this.consecutiveValidFrames = 0;
    this.consecutiveInvalidFrames = 0;
    // Limpiar historial para evitar datos contaminados
    this.redHistory = [];
    this.timestampHistory = [];
  }

  /**
   * CALCULAR CONFIANZA
   */
  private calculateConfidence(
    redValue: number, 
    metrics: { pulsatility: number; acDcRatio: number; periodicityScore: number }
  ): number {
    let confidence = 40;
    
    // Por intensidad de rojo (hasta +20)
    if (redValue >= 180) confidence += 20;
    else if (redValue >= this.CONFIG.GOOD_RED) confidence += 12;
    else confidence += 5;
    
    // Por pulsatilidad (hasta +20)
    if (metrics.pulsatility >= 0.01) confidence += 20;
    else if (metrics.pulsatility >= 0.006) confidence += 12;
    else confidence += 5;
    
    // Por periodicidad (hasta +20)
    if (metrics.periodicityScore >= 0.5) confidence += 20;
    else if (metrics.periodicityScore >= 0.35) confidence += 12;
    else confidence += 5;
    
    return Math.min(100, confidence);
  }

  /**
   * CALCULAR CALIDAD
   */
  private calculateQuality(
    redValue: number,
    metrics: { pulsatility: number; acDcRatio: number; periodicityScore: number }
  ): number {
    let quality = 30;
    
    // Por rojo (hasta +25)
    quality += Math.min(25, ((redValue - this.CONFIG.MIN_RED) / 100) * 25);
    
    // Por pulsatilidad (hasta +25)
    quality += Math.min(25, (metrics.pulsatility / 0.02) * 25);
    
    // Por periodicidad (hasta +20)
    quality += metrics.periodicityScore * 20;
    
    return Math.min(100, Math.max(0, quality));
  }

  /**
   * CREAR RESULTADO
   */
  private createResult(
    detected: boolean, confidence: number, quality: number,
    r: number, g: number, b: number,
    hasPulsatility: boolean, pulsatility: number,
    hasPeriodicSignal: boolean, acDcRatio: number,
    message: string
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
        hasPeriodicSignal,
        acDcRatio,
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
    this.consecutiveInvalidFrames = 0;
    this.redHistory = [];
    this.timestampHistory = [];
  }

  isCurrentlyDetected(): boolean {
    return this.isConfirmed;
  }
  
  getRedHistory(): number[] {
    return [...this.redHistory];
  }
  
  getPulsatility(): number {
    const metrics = this.calculateSignalMetrics();
    return metrics.pulsatility;
  }
}
