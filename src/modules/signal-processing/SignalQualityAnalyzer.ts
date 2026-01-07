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
    
    // Verificar si hay suficientes datos - REDUCIDO
    if (this.rawBuffer.length < 15) { // Era 30
      return this.createResult(30, 0, true, undefined, { // Asumir válido por defecto
        acAmplitude: 0, dcLevel, snr: 0, periodicity: 0, stability: 1, fingerConfidence: 0.5
      });
    }
    
    // === MÉTRICAS DE CALIDAD ===
    
    // 1. Componente AC (pulsátil)
    const acAmplitude = this.calculateAC();
    
    // 2. Perfusion Index = (AC/DC) * 100
    const perfusionIndex = dcLevel > 0 ? (acAmplitude / dcLevel) * 100 : 0;
    
    // 3. SNR (Signal-to-Noise Ratio)
    const snr = this.calculateSNR();
    
    // 4. Periodicidad (autocorrelación en rango de pulso cardíaco)
    const periodicity = this.calculatePeriodicity();
    
    // 5. Estabilidad de línea base
    const stability = this.calculateStability();
    
    // 6. NUEVO: Confianza de dedo basada en características físicas
    const fingerConfidence = this.calculateFingerConfidence(periodicity);
    
    // Actualizar historial de periodicidad
    this.periodicityHistory.push(periodicity);
    if (this.periodicityHistory.length > 30) this.periodicityHistory.shift();
    
    // === VALIDACIÓN DE SEÑAL - CON DETECCIÓN DE DEDO ===
    let isValid = true;
    let invalidReason: SignalQualityResult['invalidReason'];
    
    // Verificar pulsatilidad
    const pulsatility = acAmplitude / Math.max(dcLevel, 1);
    
    // NUEVO: Si NO es un dedo (fingerConfidence < 0.3), invalidar
    if (fingerConfidence < 0.25 && this.rawBuffer.length > 45) {
      isValid = false;
      invalidReason = 'NO_FINGER';
    } else if (pulsatility < this.THRESHOLDS.MIN_PULSATILITY && perfusionIndex < 0.02) {
      isValid = false;
      invalidReason = 'LOW_PULSATILITY';
    } else if (pulsatility > this.THRESHOLDS.MAX_PULSATILITY && stability < 0.2) {
      // Solo marcar artefacto si también hay inestabilidad extrema
      isValid = false;
      invalidReason = 'MOTION_ARTIFACT';
    } else if (snr < this.THRESHOLDS.MIN_SNR_DB && periodicity < 0.05) {
      // Solo invalidar si AMBOS son muy bajos
      isValid = false;
      invalidReason = 'TOO_NOISY';
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
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`📊 SQI: quality=${quality}%, PI=${perfusionIndex.toFixed(2)}%, finger=${(fingerConfidence*100).toFixed(0)}%, valid=${isValid}${invalidReason ? ` (${invalidReason})` : ''}`);
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
   * NUEVO: Calcula confianza de que la señal proviene de un dedo
   * Basado en:
   * 1. Periodicidad CONSISTENTE en rango cardíaco (40-180 BPM)
   * 2. Ratio R/G característico de dedo con flash (>1.3)
   * 3. Variabilidad temporal de la periodicidad (dedo = consistente)
   */
  private calculateFingerConfidence(currentPeriodicity: number): number {
    let confidence = 0;
    
    // 1. PERIODICIDAD ACTUAL (40% del peso)
    // Un dedo tiene periodicidad real, la pared no
    if (currentPeriodicity > 0.15) {
      confidence += Math.min(0.4, currentPeriodicity * 0.8);
    }
    
    // 2. CONSISTENCIA DE PERIODICIDAD EN EL TIEMPO (30% del peso)
    // La pared puede tener periodicidad espuria momentánea, pero no consistente
    if (this.periodicityHistory.length >= 10) {
      const recentPeriodicity = this.periodicityHistory.slice(-10);
      const avgPeriodicity = recentPeriodicity.reduce((a, b) => a + b, 0) / recentPeriodicity.length;
      const variance = recentPeriodicity.reduce((sum, v) => sum + Math.pow(v - avgPeriodicity, 2), 0) / recentPeriodicity.length;
      const cv = Math.sqrt(variance) / Math.max(avgPeriodicity, 0.01);
      
      // Baja varianza = periodicidad consistente = dedo
      if (avgPeriodicity > 0.1 && cv < 0.5) {
        confidence += 0.3 * (1 - cv);
      }
    }
    
    // 3. RATIO R/G (30% del peso)
    // Dedo con flash: R/G > 1.3 típicamente
    if (this.redBuffer.length >= 10 && this.greenBuffer.length >= 10) {
      const recentRed = this.redBuffer.slice(-10);
      const recentGreen = this.greenBuffer.slice(-10);
      const avgRed = recentRed.reduce((a, b) => a + b, 0) / recentRed.length;
      const avgGreen = recentGreen.reduce((a, b) => a + b, 0) / recentGreen.length;
      
      if (avgGreen > 10) {
        const rgRatio = avgRed / avgGreen;
        // Dedo típico: R/G entre 1.2 y 2.5
        if (rgRatio >= 1.2 && rgRatio <= 2.5) {
          confidence += 0.3 * Math.min(1, (rgRatio - 1.0) / 0.5);
        } else if (rgRatio > 2.5) {
          // Muy rojo pero podría ser dedo
          confidence += 0.15;
        }
      }
    } else {
      // Sin datos RGB, dar beneficio de la duda basado en periodicidad
      if (currentPeriodicity > 0.2) {
        confidence += 0.15;
      }
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  /**
   * Calcula índice de calidad global (0-100)
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
    
    // Componentes de calidad con pesos
    let quality = 0;
    
    // 1. Perfusion Index (25% del peso)
    const piScore = Math.min(100, (perfusionIndex / this.THRESHOLDS.GOOD_PERFUSION_INDEX) * 25);
    quality += piScore;
    
    // 2. SNR (20% del peso)
    const snrScore = Math.min(20, (snr / this.THRESHOLDS.GOOD_SNR_DB) * 20);
    quality += snrScore;
    
    // 3. Periodicidad (20% del peso)
    const periodScore = (periodicity / this.THRESHOLDS.GOOD_PERIODICITY) * 20;
    quality += Math.min(20, periodScore);
    
    // 4. Estabilidad (15% del peso)
    quality += stability * 15;
    
    // 5. NUEVO: Confianza de dedo (20% del peso)
    quality += fingerConfidence * 20;
    
    // Penalización por pulsatilidad fuera de rango óptimo
    if (pulsatility > this.THRESHOLDS.OPTIMAL_PULSATILITY * 3) {
      quality *= 0.7; // Penalizar movimiento
    }
    
    // Penalización si no parece dedo
    if (fingerConfidence < 0.3) {
      quality *= 0.5;
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
