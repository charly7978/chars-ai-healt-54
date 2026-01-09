/**
 * ANALIZADOR DE CALIDAD DE SEÑAL PPG - SIN DETECCIÓN DE DEDO
 * 
 * Basado en:
 * - Perfusion Index (PI) = AC/DC * 100
 * - Pulsatility Assessment 
 * - Spectral Quality (periodicidad)
 * 
 * SIN validación de dedo - procesa todo
 */

export interface SignalQualityResult {
  /** Índice de calidad global 0-100 */
  quality: number;
  
  /** Perfusion Index (%) - indica fuerza de pulso */
  perfusionIndex: number;
  
  /** Siempre true - sin detección de dedo */
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
    fingerConfidence: number;
  };
}

export class SignalQualityAnalyzer {
  private readonly THRESHOLDS = {
    MIN_PERFUSION_INDEX: 0.02,
    GOOD_PERFUSION_INDEX: 0.3,
    MIN_PULSATILITY: 0.0003,
    MAX_PULSATILITY: 0.30,
    OPTIMAL_PULSATILITY: 0.01,
    MIN_SNR_DB: 1,
    GOOD_SNR_DB: 6,
    MAX_BASELINE_DRIFT: 4.0,
    MIN_PERIODICITY: 0.05,
    GOOD_PERIODICITY: 0.25,
  };
  
  private readonly BUFFER_SIZE = 60;
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private dcBuffer: number[] = [];
  
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS PRINCIPAL - SIN DETECCIÓN DE DEDO
   * Procesa todo, siempre retorna isSignalValid=true
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
    
    while (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
      this.filteredBuffer.shift();
    }
    
    // Calcular DC
    const dcLevel = this.calculateDC();
    this.dcBuffer.push(dcLevel);
    if (this.dcBuffer.length > 30) this.dcBuffer.shift();
    
    // Si no hay suficientes datos
    if (this.rawBuffer.length < 15) {
      return this.createResult(10, 0, true, undefined, {
        acAmplitude: 0, dcLevel, snr: 0, periodicity: 0, stability: 1, fingerConfidence: 1
      });
    }
    
    // === MÉTRICAS DE CALIDAD ===
    const acAmplitude = this.calculateAC();
    const perfusionIndex = dcLevel > 0 ? (acAmplitude / dcLevel) * 100 : 0;
    const snr = this.calculateSNR();
    const periodicity = this.calculatePeriodicity();
    const stability = this.calculateStability();
    
    // === CÁLCULO DE CALIDAD GLOBAL ===
    const quality = this.calculateGlobalQuality({
      perfusionIndex,
      pulsatility: acAmplitude / Math.max(dcLevel, 1),
      snr,
      periodicity,
      stability
    });
    
    const result = this.createResult(quality, perfusionIndex, true, undefined, {
      acAmplitude,
      dcLevel,
      snr,
      periodicity,
      stability,
      fingerConfidence: 1 // Siempre 1 - sin detección de dedo
    });
    
    this.lastQuality = result;
    
    // Log cada 30 segundos
    if (this.frameCount % 900 === 0) {
      console.log(`📊 SQI: q=${quality}%, PI=${perfusionIndex.toFixed(2)}%`);
    }
    
    return result;
  }
  
  private calculateDC(): number {
    if (this.rawBuffer.length === 0) return 0;
    return this.rawBuffer.reduce((a, b) => a + b, 0) / this.rawBuffer.length;
  }
  
  private calculateAC(): number {
    if (this.filteredBuffer.length < 30) return 0;
    
    const recent = this.filteredBuffer.slice(-30);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    
    return (max - min) / 2;
  }
  
  private calculateSNR(): number {
    if (this.filteredBuffer.length < 60) return 0;
    
    const recent = this.filteredBuffer.slice(-60);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const signalPower = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    
    let noisePower = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i] - recent[i-1];
      noisePower += diff * diff;
    }
    noisePower /= (recent.length - 1);
    
    if (noisePower < 0.0001) return 20;
    if (signalPower < 0.0001) return 0;
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    return Math.max(0, Math.min(30, snr));
  }
  
  private calculatePeriodicity(): number {
    if (this.filteredBuffer.length < 45) return 0;
    
    const signal = this.filteredBuffer.slice(-45);
    const n = signal.length;
    
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(signal.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n);
    if (std < 0.001) return 0;
    
    const normalized = signal.map(v => (v - mean) / std);
    
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
  
  private calculateStability(): number {
    if (this.dcBuffer.length < 10) return 1;
    
    const recent = this.dcBuffer.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / Math.max(Math.abs(mean), 1);
    
    return Math.max(0, 1 - cv / this.THRESHOLDS.MAX_BASELINE_DRIFT);
  }
  
  private calculateGlobalQuality(metrics: {
    perfusionIndex: number;
    pulsatility: number;
    snr: number;
    periodicity: number;
    stability: number;
  }): number {
    const { perfusionIndex, pulsatility, snr, periodicity, stability } = metrics;
    
    let quality = 0;
    
    // Perfusion Index (30%)
    const piNorm = Math.min(1, perfusionIndex / this.THRESHOLDS.GOOD_PERFUSION_INDEX);
    quality += piNorm * 30;
    
    // SNR (25%)
    const snrNorm = Math.min(1, Math.max(0, snr) / this.THRESHOLDS.GOOD_SNR_DB);
    quality += snrNorm * 25;
    
    // Periodicidad (25%)
    const periodNorm = Math.min(1, periodicity / this.THRESHOLDS.GOOD_PERIODICITY);
    quality += periodNorm * 25;
    
    // Estabilidad (20%)
    quality += Math.min(1, stability) * 20;
    
    // Penalización por movimiento excesivo
    if (pulsatility > this.THRESHOLDS.OPTIMAL_PULSATILITY * 2) {
      const movementPenalty = Math.min(0.3, (pulsatility / this.THRESHOLDS.MAX_PULSATILITY) * 0.3);
      quality *= (1 - movementPenalty);
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
    this.dcBuffer = [];
    this.lastQuality = null;
    this.frameCount = 0;
  }
}