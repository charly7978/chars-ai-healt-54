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
  invalidReason?: 'NO_SIGNAL' | 'LOW_PULSATILITY' | 'TOO_NOISY' | 'MOTION_ARTIFACT';
  
  /** Métricas detalladas */
  metrics: {
    acAmplitude: number;
    dcLevel: number;
    snr: number;
    periodicity: number;
    stability: number;
  };
}

export class SignalQualityAnalyzer {
  // Umbrales basados en literatura médica
  private readonly THRESHOLDS = {
    // Perfusion Index típico: 0.02% - 20%
    MIN_PERFUSION_INDEX: 0.1,    // 0.1% mínimo para señal válida
    GOOD_PERFUSION_INDEX: 0.5,  // 0.5% buena señal
    
    // Pulsatilidad AC/DC
    MIN_PULSATILITY: 0.001,     // 0.1%
    MAX_PULSATILITY: 0.15,      // 15% (más allá = artefacto)
    OPTIMAL_PULSATILITY: 0.02,  // 2% típico
    
    // SNR (Signal-to-Noise Ratio)
    MIN_SNR_DB: 3,              // Mínimo para detectar pulso
    GOOD_SNR_DB: 10,            // Buena calidad
    
    // Estabilidad (varianza normalizada)
    MAX_BASELINE_DRIFT: 2.0,    // Máxima variación de línea base
    
    // Periodicidad (autocorrelación)
    MIN_PERIODICITY: 0.2,       // Correlación mínima con patrón periódico
    GOOD_PERIODICITY: 0.5,
  };
  
  // Buffers para análisis
  private readonly BUFFER_SIZE = 150; // ~5 segundos a 30fps
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private dcBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  
  // Estado
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS PRINCIPAL - Procesa cada frame
   */
  analyze(rawValue: number, filteredValue: number, timestamp: number = Date.now()): SignalQualityResult {
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
    
    // Verificar si hay suficientes datos
    if (this.rawBuffer.length < 30) {
      return this.createResult(0, 0, false, 'NO_SIGNAL', {
        acAmplitude: 0, dcLevel, snr: 0, periodicity: 0, stability: 0
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
    
    // === VALIDACIÓN DE SEÑAL ===
    let isValid = true;
    let invalidReason: SignalQualityResult['invalidReason'];
    
    // Verificar pulsatilidad
    const pulsatility = acAmplitude / Math.max(dcLevel, 1);
    
    if (pulsatility < this.THRESHOLDS.MIN_PULSATILITY) {
      isValid = false;
      invalidReason = 'LOW_PULSATILITY';
    } else if (pulsatility > this.THRESHOLDS.MAX_PULSATILITY) {
      isValid = false;
      invalidReason = 'MOTION_ARTIFACT';
    } else if (snr < this.THRESHOLDS.MIN_SNR_DB) {
      isValid = false;
      invalidReason = 'TOO_NOISY';
    } else if (stability < 0.3) {
      isValid = false;
      invalidReason = 'MOTION_ARTIFACT';
    }
    
    // === CÁLCULO DE CALIDAD GLOBAL ===
    const quality = this.calculateGlobalQuality({
      perfusionIndex,
      pulsatility,
      snr,
      periodicity,
      stability
    });
    
    const result = this.createResult(quality, perfusionIndex, isValid, invalidReason, {
      acAmplitude,
      dcLevel,
      snr,
      periodicity,
      stability
    });
    
    this.lastQuality = result;
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`📊 SQI: quality=${quality}%, PI=${perfusionIndex.toFixed(2)}%, SNR=${snr.toFixed(1)}dB, valid=${isValid}`);
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
   * Calcula índice de calidad global (0-100)
   */
  private calculateGlobalQuality(metrics: {
    perfusionIndex: number;
    pulsatility: number;
    snr: number;
    periodicity: number;
    stability: number;
  }): number {
    const { perfusionIndex, pulsatility, snr, periodicity, stability } = metrics;
    
    // Componentes de calidad con pesos
    let quality = 0;
    
    // 1. Perfusion Index (30% del peso)
    const piScore = Math.min(100, (perfusionIndex / this.THRESHOLDS.GOOD_PERFUSION_INDEX) * 30);
    quality += piScore;
    
    // 2. SNR (25% del peso)
    const snrScore = Math.min(25, (snr / this.THRESHOLDS.GOOD_SNR_DB) * 25);
    quality += snrScore;
    
    // 3. Periodicidad (25% del peso)
    const periodScore = (periodicity / this.THRESHOLDS.GOOD_PERIODICITY) * 25;
    quality += Math.min(25, periodScore);
    
    // 4. Estabilidad (20% del peso)
    quality += stability * 20;
    
    // Penalización por pulsatilidad fuera de rango óptimo
    if (pulsatility > this.THRESHOLDS.OPTIMAL_PULSATILITY * 3) {
      quality *= 0.7; // Penalizar movimiento
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
    this.lastQuality = null;
    this.frameCount = 0;
  }
}
