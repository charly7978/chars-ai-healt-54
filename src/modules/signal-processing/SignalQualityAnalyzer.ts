/**
 * ANALIZADOR DE CALIDAD DE SEÑAL PPG - VERSIÓN UNIFICADA
 * 
 * Basado en:
 * - Perfusion Index (PI) = AC/DC * 100
 * - Pulsatility Assessment 
 * - Spectral Quality (periodicidad)
 * - Motion Artifact Detection
 * 
 * Referencias:
 * - Elgendi M. (2012) "On the Analysis of Fingertip PPG Signals"
 * - vital-sqi library (GitHub bahp/vital-sqi)
 */

export interface SignalQualityResult {
  /** Índice de calidad global 0-100 */
  quality: number;
  
  /** Perfusion Index (%) - indica fuerza de pulso */
  perfusionIndex: number;
  
  /** Si hay suficiente señal para medir */
  isSignalValid: boolean;
  
  /** Razón de invalidez si aplica */
  invalidReason?: 'NO_SIGNAL' | 'LOW_PULSATILITY' | 'TOO_NOISY' | 'MOTION_ARTIFACT' | 'NO_FINGER';
  
  /** Métricas detalladas */
  metrics: {
    acAmplitude: number;
    dcLevel: number;
    snr: number;
    periodicity: number;
    stability: number;
    fingerConfidence: number;  // NUEVO: confianza de que es un dedo (0-1)
  };
}

export class SignalQualityAnalyzer {
  // Umbrales RELAJADOS para mejor tolerancia
  private readonly THRESHOLDS = {
    // Perfusion Index típico: 0.02% - 20%
    MIN_PERFUSION_INDEX: 0.05,   // Reducido: 0.05% mínimo (era 0.1%)
    GOOD_PERFUSION_INDEX: 0.3,   // Reducido: 0.3% buena señal (era 0.5%)
    
    // Pulsatilidad AC/DC - MÁS TOLERANTE
    MIN_PULSATILITY: 0.0005,    // Reducido: 0.05% (era 0.1%)
    MAX_PULSATILITY: 0.25,      // Aumentado: 25% (era 15%) - más tolerancia a movimiento
    OPTIMAL_PULSATILITY: 0.015, // Reducido (era 2%)
    
    // SNR (Signal-to-Noise Ratio) - MÁS PERMISIVO
    MIN_SNR_DB: 1,              // Reducido de 3 a 1 dB
    GOOD_SNR_DB: 6,             // Reducido de 10 a 6 dB
    
    // Estabilidad (varianza normalizada)
    MAX_BASELINE_DRIFT: 4.0,    // Aumentado: más tolerancia a drift (era 2.0)
    
    // Periodicidad (autocorrelación) - MENOS EXIGENTE
    MIN_PERIODICITY: 0.1,       // Reducido de 0.2 a 0.1
    GOOD_PERIODICITY: 0.3,      // Reducido de 0.5 a 0.3
  };
  
  // Buffers para análisis - REDUCIDOS para respuesta más rápida
  private readonly BUFFER_SIZE = 90; // ~3 segundos a 30fps (era 150)
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private dcBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  
  // NUEVO: Buffers para detección de dedo
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private periodicityHistory: number[] = [];
  
  // Estado
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS PRINCIPAL - Procesa cada frame
   * @param rawValue - Valor crudo (típicamente canal rojo)
   * @param filteredValue - Valor filtrado
   * @param timestamp - Timestamp del frame
   * @param rgbData - Datos RGB opcionales para detección de dedo
   */
  analyze(
    rawValue: number, 
    filteredValue: number, 
    timestamp: number = Date.now(),
    rgbData?: { red: number; green: number; blue: number }
  ): SignalQualityResult {
    this.frameCount++;
    
    // Agregar a buffers
    this.rawBuffer.push(rawValue);
    this.filteredBuffer.push(filteredValue);
    this.timestampBuffer.push(timestamp);
    
    // *** CRÍTICO: Guardar datos RGB para detección de dedo ***
    if (rgbData) {
      this.redBuffer.push(rgbData.red);
      this.greenBuffer.push(rgbData.green);
      if (this.redBuffer.length > 30) this.redBuffer.shift();
      if (this.greenBuffer.length > 30) this.greenBuffer.shift();
    }
    
    // Mantener tamaño de buffer
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
      this.filteredBuffer.shift();
      this.timestampBuffer.shift();
    }
    
    // Calcular DC (línea base) con media móvil
    const dcLevel = this.calculateDC();
    this.dcBuffer.push(dcLevel);
    if (this.dcBuffer.length > 30) this.dcBuffer.shift();
    
    // Verificar si hay suficientes datos
    if (this.rawBuffer.length < 15) {
      return this.createResult(30, 0, true, undefined, {
        acAmplitude: 0, dcLevel, snr: 0, periodicity: 0, stability: 1, fingerConfidence: 0.5
      });
    }
    
    // === MÉTRICAS DE CALIDAD ===
    const acAmplitude = this.calculateAC();
    const perfusionIndex = dcLevel > 0 ? (acAmplitude / dcLevel) * 100 : 0;
    const snr = this.calculateSNR();
    const periodicity = this.calculatePeriodicity();
    const stability = this.calculateStability();
    
    // *** NUEVA DETECCIÓN DE DEDO - FÍSICA REAL ***
    const fingerConfidence = this.calculateFingerConfidenceReal(rgbData, periodicity, acAmplitude, dcLevel);
    
    // Actualizar historial de periodicidad
    this.periodicityHistory.push(periodicity);
    if (this.periodicityHistory.length > 30) this.periodicityHistory.shift();
    
    // === VALIDACIÓN DE SEÑAL - ESTRICTA PARA DEDO ===
    let isValid = true;
    let invalidReason: SignalQualityResult['invalidReason'];
    
    const pulsatility = acAmplitude / Math.max(dcLevel, 1);
    
    // CRÍTICO: Sin características físicas de dedo = INVÁLIDO
    if (fingerConfidence < 0.30 && this.rawBuffer.length > 30) {
      isValid = false;
      invalidReason = 'NO_FINGER';
    } else if (pulsatility < this.THRESHOLDS.MIN_PULSATILITY && perfusionIndex < 0.02) {
      isValid = false;
      invalidReason = 'LOW_PULSATILITY';
    } else if (pulsatility > this.THRESHOLDS.MAX_PULSATILITY && stability < 0.2) {
      isValid = false;
      invalidReason = 'MOTION_ARTIFACT';
    }
    
    // === CÁLCULO DE CALIDAD GLOBAL ===
    const quality = this.calculateGlobalQuality({
      perfusionIndex,
      pulsatility,
      snr,
      periodicity,
      stability,
      fingerConfidence
    });
    
    const result = this.createResult(quality, perfusionIndex, isValid, invalidReason, {
      acAmplitude,
      dcLevel,
      snr,
      periodicity,
      stability,
      fingerConfidence
    });
    
    this.lastQuality = result;
    
    // Log cada 3 segundos con info de dedo
    if (this.frameCount % 90 === 0) {
      const rgInfo = rgbData ? `R=${rgbData.red.toFixed(0)} G=${rgbData.green.toFixed(0)} B=${rgbData.blue.toFixed(0)}` : 'no RGB';
      console.log(`📊 SQI: q=${quality}%, finger=${(fingerConfidence*100).toFixed(0)}%, valid=${isValid}${invalidReason ? ` (${invalidReason})` : ''} | ${rgInfo}`);
    }
    
    return result;
  }
  
  /**
   * Calcula componente DC (línea base)
   */
  private calculateDC(): number {
    if (this.rawBuffer.length === 0) return 0;
    return this.rawBuffer.reduce((a, b) => a + b, 0) / this.rawBuffer.length;
  }
  
  /**
   * Calcula componente AC (amplitud pulsátil)
   * Usa la señal filtrada para mejor precisión
   */
  private calculateAC(): number {
    if (this.filteredBuffer.length < 30) return 0;
    
    const recent = this.filteredBuffer.slice(-30);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    
    // AC = pico-a-pico / 2
    return (max - min) / 2;
  }
  
  /**
   * Calcula SNR (Signal-to-Noise Ratio) en dB
   * SNR = 10 * log10(Potencia_señal / Potencia_ruido)
   */
  private calculateSNR(): number {
    if (this.filteredBuffer.length < 60) return 0;
    
    const recent = this.filteredBuffer.slice(-60);
    
    // Señal: varianza de la señal suavizada
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const signalPower = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    
    // Ruido: diferencias entre muestras consecutivas (alta frecuencia)
    let noisePower = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i] - recent[i-1];
      noisePower += diff * diff;
    }
    noisePower /= (recent.length - 1);
    
    // Evitar división por cero
    if (noisePower < 0.0001) return 20; // Excelente SNR
    if (signalPower < 0.0001) return 0;
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    return Math.max(0, Math.min(30, snr)); // Clamp 0-30 dB
  }
  
  /**
   * Calcula periodicidad usando autocorrelación
   * Busca patrón repetitivo en rango de pulso cardíaco (40-180 BPM)
   */
  private calculatePeriodicity(): number {
    if (this.filteredBuffer.length < 90) return 0;
    
    const signal = this.filteredBuffer.slice(-90);
    const n = signal.length;
    
    // Normalizar señal
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(signal.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n);
    if (std < 0.001) return 0;
    
    const normalized = signal.map(v => (v - mean) / std);
    
    // Autocorrelación en rango de latido (10-50 muestras ≈ 40-180 BPM a 30fps)
    let maxCorr = 0;
    
    for (let lag = 10; lag <= 50; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += normalized[i] * normalized[i + lag];
      }
      corr /= (n - lag);
      maxCorr = Math.max(maxCorr, corr);
    }
    
    return Math.max(0, Math.min(1, maxCorr));
  }
  
  /**
   * Calcula estabilidad de línea base
   * Detecta drift y movimiento brusco
   */
  private calculateStability(): number {
    if (this.dcBuffer.length < 10) return 1;
    
    const recent = this.dcBuffer.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Varianza normalizada
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / Math.max(Math.abs(mean), 1);
    
    // Convertir a estabilidad (0-1, mayor es mejor)
    const stability = Math.max(0, 1 - cv / this.THRESHOLDS.MAX_BASELINE_DRIFT);
    
    return stability;
  }
  
  /**
   * DETECCIÓN DE DEDO REAL - BASADA EN FÍSICA
   * 
   * Características de un DEDO REAL sobre la cámara con flash:
   * 1. Canal ROJO muy alto (>200) - sangre absorbe verde/azul
   * 2. Ratio R/G muy alto (>5) - característica física del dedo con flash
   * 3. Saturación del rojo - el dedo con flash satura el sensor rojo
   * 4. Variación PERIÓDICA del rojo (pulso) - no constante como pared
   * 
   * Una PARED o superficie NO tiene:
   * - Ratio R/G tan alto (generalmente <3)
   * - Saturación específica del rojo
   * - Variación periódica real del color
   */
  private calculateFingerConfidenceReal(
    rgbData: { red: number; green: number; blue: number } | undefined,
    periodicity: number,
    acAmplitude: number,
    dcLevel: number
  ): number {
    // Sin RGB no podemos detectar dedo físicamente
    if (!rgbData || this.redBuffer.length < 15) {
      return 0.3; // Valor neutro
    }
    
    let confidence = 0;
    const { red, green, blue } = rgbData;
    
    // === 1. SATURACIÓN ROJA (35% del peso) ===
    // Dedo con flash: rojo > 220 típicamente (sensor casi saturado)
    // Pared: rojo variable, raramente tan alto
    if (red >= 245) {
      confidence += 0.35; // Rojo muy saturado = muy probable dedo
    } else if (red >= 220) {
      confidence += 0.30;
    } else if (red >= 180) {
      confidence += 0.15;
    } else {
      confidence += 0; // Rojo bajo = probablemente NO es dedo
    }
    
    // === 2. RATIO R/G (30% del peso) ===
    // Dedo con flash: R/G típico > 10 (verde muy bajo porque la sangre lo absorbe)
    // Pared iluminada: R/G típico 1-4
    const rgRatio = green > 1 ? red / green : red;
    
    if (rgRatio >= 20) {
      confidence += 0.30; // Ratio muy alto = definitivamente dedo
    } else if (rgRatio >= 10) {
      confidence += 0.25;
    } else if (rgRatio >= 5) {
      confidence += 0.15;
    } else if (rgRatio >= 2) {
      confidence += 0.05; // Ratio bajo = probablemente NO es dedo
    }
    // rgRatio < 2 = 0 puntos (definitivamente no es dedo)
    
    // === 3. VERDE MUY BAJO (15% del peso) ===
    // Dedo: verde < 30 típicamente (absorbido por hemoglobina)
    // Pared: verde generalmente > 50
    if (green <= 15) {
      confidence += 0.15; // Verde muy bajo = dedo absorbiéndolo
    } else if (green <= 30) {
      confidence += 0.10;
    } else if (green <= 60) {
      confidence += 0.05;
    }
    // green > 60 = 0 puntos (no es dedo)
    
    // === 4. PULSATILIDAD REAL (20% del peso) ===
    // Dedo: tiene pulsatilidad AC/DC > 0.005 (0.5%)
    // Pared: pulsatilidad ~0 (constante)
    const pulsatility = dcLevel > 0 ? acAmplitude / dcLevel : 0;
    
    if (pulsatility >= 0.02) {
      confidence += 0.20; // Buena pulsatilidad = sangre real
    } else if (pulsatility >= 0.008) {
      confidence += 0.15;
    } else if (pulsatility >= 0.003) {
      confidence += 0.08;
    }
    // pulsatility < 0.003 = 0 puntos (sin pulso real)
    
    // === BONUS: Consistencia de saturación roja ===
    // Dedo mantiene rojo alto constantemente
    if (this.redBuffer.length >= 15) {
      const avgRed = this.redBuffer.reduce((a, b) => a + b, 0) / this.redBuffer.length;
      const minRed = Math.min(...this.redBuffer.slice(-15));
      
      // Rojo consistentemente alto
      if (avgRed >= 240 && minRed >= 200) {
        confidence += 0.10;
      }
    }
    
    // Log para debug (cada 3 segundos)
    if (this.frameCount % 90 === 0) {
      console.log(`🖐️ Dedo: R=${red} G=${green} R/G=${rgRatio.toFixed(1)} puls=${(pulsatility*100).toFixed(2)}% → conf=${(confidence*100).toFixed(0)}%`);
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  /**
   * Calcula índice de calidad global (0-100)
   * CRÍTICO: Sin dedo detectado = calidad muy baja
   */
  private calculateGlobalQuality(metrics: {
    perfusionIndex: number;
    pulsatility: number;
    snr: number;
    periodicity: number;
    stability: number;
    fingerConfidence: number;
  }): number {
    const { perfusionIndex, pulsatility, snr, periodicity, stability, fingerConfidence } = metrics;
    
    // *** CRÍTICO: Sin dedo = calidad máxima 20% ***
    if (fingerConfidence < 0.30) {
      // Calidad proporcional a fingerConfidence, máximo 20%
      return Math.round(fingerConfidence * 66); // 0.30 → 20%
    }
    
    // Con dedo detectado, calcular calidad normal
    let quality = 0;
    
    // 1. Perfusion Index (30% del peso)
    const piScore = Math.min(30, (perfusionIndex / this.THRESHOLDS.GOOD_PERFUSION_INDEX) * 30);
    quality += piScore;
    
    // 2. SNR (20% del peso)
    const snrScore = Math.min(20, (snr / this.THRESHOLDS.GOOD_SNR_DB) * 20);
    quality += snrScore;
    
    // 3. Periodicidad (20% del peso)
    const periodScore = Math.min(20, (periodicity / this.THRESHOLDS.GOOD_PERIODICITY) * 20);
    quality += periodScore;
    
    // 4. Estabilidad (15% del peso)
    quality += stability * 15;
    
    // 5. Confianza de dedo (15% del peso)
    quality += fingerConfidence * 15;
    
    // Penalización por movimiento excesivo
    if (pulsatility > this.THRESHOLDS.OPTIMAL_PULSATILITY * 3) {
      quality *= 0.8;
    }
    
    return Math.round(Math.max(0, Math.min(100, quality)));
  }
  
  private createResult(
    quality: number,
    perfusionIndex: number,
    isSignalValid: boolean,
    invalidReason: SignalQualityResult['invalidReason'],
    metrics: SignalQualityResult['metrics']
  ): SignalQualityResult {
    return {
      quality,
      perfusionIndex,
      isSignalValid,
      invalidReason,
      metrics
    };
  }
  
  /**
   * Obtiene el último resultado de calidad
   */
  getLastQuality(): SignalQualityResult | null {
    return this.lastQuality;
  }
  
  /**
   * Reinicia el analizador
   */
  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.dcBuffer = [];
    this.timestampBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.periodicityHistory = [];
    this.lastQuality = null;
    this.frameCount = 0;
  }
}
