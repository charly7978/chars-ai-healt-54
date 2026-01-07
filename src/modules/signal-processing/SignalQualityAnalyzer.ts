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
  // Buffer reducido para respuesta rápida
  private readonly BUFFER_SIZE = 60; // 2 segundos a 30fps
  
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS PRINCIPAL - SIMPLIFICADO
   * La CLAVE: sin variación pulsátil = señal MALA (no buena)
   */
  analyze(
    rawValue: number, 
    filteredValue: number, 
    timestamp: number = Date.now(),
    _rgbData?: { red: number; green: number; blue: number }
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
    
    // Necesitamos mínimo 30 frames (~1 segundo)
    if (this.rawBuffer.length < 30) {
      return this.createResult(30, 0, true, undefined, {
        acAmplitude: 0, dcLevel: 0, snr: 0, periodicity: 0, stability: 1, fingerConfidence: 0.5
      });
    }
    
    // === MÉTRICAS CLAVE ===
    const dcLevel = this.calculateDC();
    const acAmplitude = this.calculateAC();
    const perfusionIndex = dcLevel > 0 ? (acAmplitude / dcLevel) * 100 : 0;
    const periodicity = this.calculatePeriodicity();
    const variationStrength = this.calculateVariationStrength();
    
    // === LÓGICA INVERTIDA: SIN PULSO = MALO ===
    // Una pared tiene casi CERO variación periódica
    // Un dedo tiene variación periódica REAL
    
    let isValid = true;
    let invalidReason: SignalQualityResult['invalidReason'];
    
    // CRÍTICO: Si no hay variación pulsátil suficiente, NO ES DEDO
    // variationStrength mide si hay "movimiento" periódico real
    if (variationStrength < 0.3 && this.rawBuffer.length >= 45) {
      // Poca variación = probablemente pared o superficie estática
      isValid = false;
      invalidReason = 'LOW_PULSATILITY';
    } else if (periodicity < 0.08 && this.rawBuffer.length >= 45) {
      // Sin periodicidad en rango cardíaco = no es pulso
      isValid = false;
      invalidReason = 'NO_SIGNAL';
    }
    
    // Calcular calidad basada en PERIODICIDAD (lo más importante)
    const quality = this.calculateQuality(periodicity, variationStrength, perfusionIndex);
    
    const result = this.createResult(quality, perfusionIndex, isValid, invalidReason, {
      acAmplitude,
      dcLevel,
      snr: periodicity * 10, // Aproximación
      periodicity,
      stability: 1 - variationStrength, // Invertido para compatibilidad
      fingerConfidence: variationStrength
    });
    
    this.lastQuality = result;
    
    // Log cada 2 segundos
    if (this.frameCount % 60 === 0) {
      console.log(`📊 SQI: q=${quality}%, prd=${(periodicity*100).toFixed(0)}%, var=${(variationStrength*100).toFixed(0)}%, valid=${isValid}${invalidReason ? ` (${invalidReason})` : ''}`);
    }
    
    return result;
  }
  
  /**
   * Componente DC (nivel base)
   */
  private calculateDC(): number {
    if (this.rawBuffer.length === 0) return 0;
    return this.rawBuffer.reduce((a, b) => a + b, 0) / this.rawBuffer.length;
  }
  
  /**
   * Componente AC (amplitud pico a pico)
   */
  private calculateAC(): number {
    if (this.filteredBuffer.length < 30) return 0;
    const recent = this.filteredBuffer.slice(-30);
    return (Math.max(...recent) - Math.min(...recent)) / 2;
  }
  
  /**
   * PERIODICIDAD - Busca patrón repetitivo en rango cardíaco
   * Esto es lo que diferencia dedo de pared
   */
  private calculatePeriodicity(): number {
    if (this.filteredBuffer.length < 60) return 0;
    
    const signal = this.filteredBuffer.slice(-60);
    const n = signal.length;
    
    // Normalizar
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(signal.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n);
    if (std < 0.01) return 0; // Sin variación = 0 periodicidad
    
    const normalized = signal.map(v => (v - mean) / std);
    
    // Autocorrelación en rango cardíaco (10-45 samples ≈ 40-180 BPM a 30fps)
    let maxCorr = 0;
    for (let lag = 10; lag <= 45; lag++) {
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
   * VARIACIÓN PULSÁTIL - Mide si hay "movimiento" en la señal
   * Pared = casi cero, Dedo = variación significativa
   */
  private calculateVariationStrength(): number {
    if (this.filteredBuffer.length < 30) return 0;
    
    const recent = this.filteredBuffer.slice(-30);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Calcular varianza
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const std = Math.sqrt(variance);
    
    // Coeficiente de variación (normalizado)
    const cv = std / Math.max(Math.abs(mean), 1);
    
    // Escalar: CV > 0.05 indica variación real (dedo)
    // CV < 0.01 indica señal estática (pared)
    const strength = Math.min(1, cv / 0.05);
    
    return strength;
  }
  
  /**
   * Calidad basada principalmente en PERIODICIDAD
   */
  private calculateQuality(periodicity: number, variationStrength: number, perfusionIndex: number): number {
    // Periodicidad es el factor MÁS importante (60%)
    let quality = periodicity * 60;
    
    // Variación pulsátil (30%)
    quality += variationStrength * 30;
    
    // Perfusion index (10%)
    quality += Math.min(10, perfusionIndex * 5);
    
    // Si no hay variación real, penalizar fuertemente
    if (variationStrength < 0.2) {
      quality *= 0.3;
    }
    
    // Si no hay periodicidad, penalizar
    if (periodicity < 0.1) {
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
  
  getLastQuality(): SignalQualityResult | null {
    return this.lastQuality;
  }
  
  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.timestampBuffer = [];
    this.lastQuality = null;
    this.frameCount = 0;
  }
}
