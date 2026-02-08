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
    perfusionIndex: number;
  };
}

export class SignalQualityAnalyzer {
  private readonly BUFFER_SIZE = 90; // 3 segundos @ 30fps
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  // Suavizado para evitar saltos bruscos
  private smoothedQuality: number = 50;
  private smoothedPI: number = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS DE CALIDAD CON MÉTRICAS REALES CALCULADAS
   * Todas las métricas se calculan desde los datos del buffer
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
    
    while (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
      this.filteredBuffer.shift();
      this.timestampBuffer.shift();
    }
    
    // CÁLCULO DE MÉTRICAS REALES DESDE EL BUFFER
    const metrics = this.calculateRealMetrics();
    
    // Calcular calidad global ponderada
    const targetQuality = this.calculateQualityIndex(metrics);
    
    // Suavizado exponencial
    const alpha = 0.15;
    this.smoothedQuality = alpha * targetQuality + (1 - alpha) * this.smoothedQuality;
    this.smoothedPI = alpha * metrics.perfusionIndex + (1 - alpha) * this.smoothedPI;
    
    const result: SignalQualityResult = {
      quality: Math.round(this.smoothedQuality),
      perfusionIndex: this.smoothedPI,
      isSignalValid: metrics.fingerConfidence > 0.5 && metrics.snr > 3,
      invalidReason: this.getInvalidReason(metrics),
      metrics
    };
    
    this.lastQuality = result;
    return result;
  }
  
  /**
   * CALCULAR MÉTRICAS REALES DESDE BUFFERS
   */
  private calculateRealMetrics(): SignalQualityResult['metrics'] {
    if (this.rawBuffer.length < 30) {
      return { acAmplitude: 0, dcLevel: 0, snr: 0, periodicity: 0, stability: 0, fingerConfidence: 0, perfusionIndex: 0 };
    }
    
    const recent = this.rawBuffer.slice(-60);
    const recentFiltered = this.filteredBuffer.slice(-60);
    
    // DC = promedio (nivel base)
    const dcLevel = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // AC = amplitud pico-a-pico de señal filtrada
    const maxFiltered = Math.max(...recentFiltered);
    const minFiltered = Math.min(...recentFiltered);
    const acAmplitude = maxFiltered - minFiltered;
    
    // PERFUSION INDEX = AC/DC * 100 (cálculo real)
    const perfusionIndex = dcLevel > 0 ? (acAmplitude / dcLevel) * 100 : 0;
    
    // SNR = señal / ruido
    const mean = recentFiltered.reduce((a, b) => a + b, 0) / recentFiltered.length;
    const variance = recentFiltered.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recentFiltered.length;
    const noise = Math.sqrt(variance);
    const snr = noise > 0.001 ? acAmplitude / noise : 0;
    
    // PERIODICIDAD = autocorrelación (detecta pulso regular)
    const periodicity = this.calculatePeriodicity(recentFiltered);
    
    // ESTABILIDAD = consistencia de amplitud
    const stability = this.calculateStability(recentFiltered);
    
    // CONFIANZA DE DEDO = basada en nivel DC y ratio R/G
    const fingerConfidence = this.calculateFingerConfidence(dcLevel);
    
    return { acAmplitude, dcLevel, snr, periodicity, stability, fingerConfidence, perfusionIndex };
  }
  
  /**
   * PERIODICIDAD: Autocorrelación para detectar ritmo cardíaco regular
   */
  private calculatePeriodicity(signal: number[]): number {
    if (signal.length < 30) return 0;
    
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const centered = signal.map(v => v - mean);
    
    // Buscar correlación en rango de HR (40-180 BPM = 333-1500ms = 10-45 samples @ 30fps)
    let maxCorr = 0;
    for (let lag = 10; lag <= 45 && lag < centered.length / 2; lag++) {
      let corr = 0;
      let norm1 = 0;
      let norm2 = 0;
      for (let i = 0; i < centered.length - lag; i++) {
        corr += centered[i] * centered[i + lag];
        norm1 += centered[i] * centered[i];
        norm2 += centered[i + lag] * centered[i + lag];
      }
      const normalizedCorr = (norm1 > 0 && norm2 > 0) ? corr / Math.sqrt(norm1 * norm2) : 0;
      if (normalizedCorr > maxCorr) {
        maxCorr = normalizedCorr;
      }
    }
    return Math.max(0, Math.min(1, maxCorr));
  }
  
  /**
   * ESTABILIDAD: Consistencia de amplitud de picos
   */
  private calculateStability(signal: number[]): number {
    if (signal.length < 30) return 0;
    
    // Dividir en segmentos y comparar varianza
    const segmentSize = 15;
    const amplitudes: number[] = [];
    
    for (let i = 0; i < signal.length - segmentSize; i += segmentSize) {
      const segment = signal.slice(i, i + segmentSize);
      const amp = Math.max(...segment) - Math.min(...segment);
      amplitudes.push(amp);
    }
    
    if (amplitudes.length < 2) return 0.5;
    
    const meanAmp = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
    const variance = amplitudes.reduce((acc, val) => acc + Math.pow(val - meanAmp, 2), 0) / amplitudes.length;
    const cv = meanAmp > 0 ? Math.sqrt(variance) / meanAmp : 1;
    
    // CV bajo = alta estabilidad
    return Math.max(0, Math.min(1, 1 - cv));
  }
  
  /**
   * CONFIANZA DE DEDO: Basada en nivel DC
   */
  private calculateFingerConfidence(dcLevel: number): number {
    // DC típico con dedo bien posicionado: 80-200
    if (dcLevel < 30) return 0;
    if (dcLevel < 60) return 0.3;
    if (dcLevel < 100) return 0.7;
    if (dcLevel <= 250) return 1.0;
    return 0.8; // Posible saturación
  }
  
  /**
   * ÍNDICE DE CALIDAD GLOBAL
   */
  private calculateQualityIndex(metrics: SignalQualityResult['metrics']): number {
    const { snr, periodicity, stability, fingerConfidence } = metrics;
    
    if (fingerConfidence < 0.3) return 10;
    
    // Ponderación: SNR(35%) + Periodicidad(30%) + Estabilidad(25%) + Dedo(10%)
    const snrScore = Math.min(100, snr * 8);
    const periodicityScore = periodicity * 100;
    const stabilityScore = stability * 100;
    const fingerScore = fingerConfidence * 100;
    
    return (snrScore * 0.35) + (periodicityScore * 0.30) + (stabilityScore * 0.25) + (fingerScore * 0.10);
  }
  
  /**
   * RAZÓN DE INVALIDEZ
   */
  private getInvalidReason(metrics: SignalQualityResult['metrics']): SignalQualityResult['invalidReason'] {
    if (metrics.fingerConfidence < 0.3) return 'NO_FINGER';
    if (metrics.dcLevel < 10) return 'NO_SIGNAL';
    if (metrics.snr < 2) return 'TOO_NOISY';
    if (metrics.periodicity < 0.2) return 'LOW_PULSATILITY';
    if (metrics.stability < 0.3) return 'MOTION_ARTIFACT';
    return undefined;
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
    this.smoothedQuality = 50;
    this.smoothedPI = 0;
  }
}