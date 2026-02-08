/**
 * ANALIZADOR DE CALIDAD DE SEÑAL PPG - MULTI-SQI PROFESIONAL
 * 
 * Basado en literatura científica:
 * - Nature Digital Biology 2024: Signal Quality Index óptimo para rPPG
 * - PMC 2017: 8 SQIs evaluados, Perfusion Index es gold standard
 * - Biosignal UConn: Motion artifact detection con 94.4% precisión
 * 
 * ÍNDICES IMPLEMENTADOS:
 * 1. Perfusion Index (PI) = AC/DC * 100 - Gold standard
 * 2. SNR (Signal-to-Noise Ratio) - Calidad de señal
 * 3. Skewness SQI (kSQI) - Detecta artefactos de movimiento
 * 4. Kurtosis SQI - Forma de distribución
 * 5. Zero Crossing SQI - Detecta ruido
 * 6. Entropy SQI - Complejidad de señal
 * 7. Periodicity SQI - Autocorrelación
 * 8. Stability SQI - Consistencia de amplitud
 */

export interface SignalQualityResult {
  /** Índice de calidad global 0-100 */
  quality: number;
  
  /** Perfusion Index (%) - indica fuerza de pulso */
  perfusionIndex: number;
  
  /** Validez basada en múltiples SQIs */
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
    skewness: number;
    kurtosis: number;
    zeroCrossingRate: number;
    entropy: number;
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
   * CALCULAR MÉTRICAS REALES DESDE BUFFERS - MULTI-SQI
   */
  private calculateRealMetrics(): SignalQualityResult['metrics'] {
    if (this.rawBuffer.length < 30) {
      return { 
        acAmplitude: 0, dcLevel: 0, snr: 0, periodicity: 0, stability: 0, 
        fingerConfidence: 0, perfusionIndex: 0, skewness: 0, kurtosis: 0, 
        zeroCrossingRate: 0, entropy: 0 
      };
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
    
    // PERIODICIDAD = autocorrelación
    const periodicity = this.calculatePeriodicity(recentFiltered);
    
    // ESTABILIDAD = consistencia de amplitud
    const stability = this.calculateStability(recentFiltered);
    
    // CONFIANZA DE DEDO
    const fingerConfidence = this.calculateFingerConfidence(dcLevel);
    
    // === NUEVOS SQIs ===
    
    // SKEWNESS SQI - asimetría de distribución
    const skewness = this.calculateSkewness(recentFiltered);
    
    // KURTOSIS SQI - forma de distribución (picos)
    const kurtosis = this.calculateKurtosis(recentFiltered);
    
    // ZERO CROSSING RATE - cruces por cero por segundo
    const zeroCrossingRate = this.calculateZeroCrossingRate(recentFiltered);
    
    // ENTROPY SQI - complejidad de señal
    const entropy = this.calculateEntropy(recentFiltered);
    
    return { 
      acAmplitude, dcLevel, snr, periodicity, stability, 
      fingerConfidence, perfusionIndex, skewness, kurtosis, 
      zeroCrossingRate, entropy 
    };
  }
  
  /**
   * SKEWNESS - Asimetría de la distribución
   * Valores normales: -0.5 a 0.5
   * Fuera de rango puede indicar artefactos de movimiento
   */
  private calculateSkewness(signal: number[]): number {
    if (signal.length < 10) return 0;
    
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / signal.length;
    const std = Math.sqrt(variance);
    
    if (std < 0.001) return 0;
    
    const skewness = signal.reduce((acc, val) => 
      acc + Math.pow((val - mean) / std, 3), 0
    ) / signal.length;
    
    return skewness;
  }
  
  /**
   * KURTOSIS - Forma de la distribución
   * Kurtosis alta puede indicar picos extremos (artefactos)
   */
  private calculateKurtosis(signal: number[]): number {
    if (signal.length < 10) return 0;
    
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / signal.length;
    const std = Math.sqrt(variance);
    
    if (std < 0.001) return 0;
    
    const kurtosis = signal.reduce((acc, val) => 
      acc + Math.pow((val - mean) / std, 4), 0
    ) / signal.length - 3; // Exceso de kurtosis
    
    return kurtosis;
  }
  
  /**
   * ZERO CROSSING RATE - Cruces por cero por segundo
   * Muy bajo = sin pulso, muy alto = ruido
   */
  private calculateZeroCrossingRate(signal: number[]): number {
    if (signal.length < 10) return 0;
    
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const centered = signal.map(v => v - mean);
    
    let crossings = 0;
    for (let i = 1; i < centered.length; i++) {
      if ((centered[i - 1] >= 0 && centered[i] < 0) || 
          (centered[i - 1] < 0 && centered[i] >= 0)) {
        crossings++;
      }
    }
    
    // Normalizar a cruces por segundo (asumiendo 30fps)
    const duration = signal.length / 30;
    return crossings / duration;
  }
  
  /**
   * ENTROPY SQI - Complejidad de señal
   * Señal periódica = baja entropía (bueno)
   * Señal caótica = alta entropía (malo)
   */
  private calculateEntropy(signal: number[]): number {
    if (signal.length < 20) return 0;
    
    // Histogram-based entropy
    const bins: { [key: number]: number } = {};
    const min = Math.min(...signal);
    const max = Math.max(...signal);
    const range = max - min;
    
    if (range < 0.001) return 0;
    
    const numBins = 10;
    const binWidth = range / numBins;
    
    for (const val of signal) {
      const binIdx = Math.min(numBins - 1, Math.floor((val - min) / binWidth));
      bins[binIdx] = (bins[binIdx] || 0) + 1;
    }
    
    let entropy = 0;
    for (const count of Object.values(bins)) {
      const p = count / signal.length;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    
    return entropy;
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
   * ÍNDICE DE CALIDAD GLOBAL - MULTI-SQI PONDERADO
   * 
   * Ponderación basada en literatura:
   * - SNR: 25% (fundamental)
   * - Periodicidad: 20% (ritmo cardíaco)
   * - Estabilidad: 15% (consistencia)
   * - PI/Dedo: 10% (contacto)
   * - Skewness: 10% (artefactos)
   * - Kurtosis: 10% (picos)
   * - ZCR: 5% (ruido)
   * - Entropy: 5% (complejidad)
   */
  private calculateQualityIndex(metrics: SignalQualityResult['metrics']): number {
    const { snr, periodicity, stability, fingerConfidence, skewness, kurtosis, zeroCrossingRate, entropy } = metrics;
    
    if (fingerConfidence < 0.3) return 10;
    
    // SNR Score (25%)
    const snrScore = Math.min(100, snr * 8) * 0.25;
    
    // Periodicity Score (20%)
    const periodicityScore = periodicity * 100 * 0.20;
    
    // Stability Score (15%)
    const stabilityScore = stability * 100 * 0.15;
    
    // Finger Score (10%)
    const fingerScore = fingerConfidence * 100 * 0.10;
    
    // Skewness Score (10%) - Penalizar valores fuera de rango [-0.5, 0.5]
    let skewnessScore = 100;
    if (Math.abs(skewness) > 0.5) {
      skewnessScore = Math.max(0, 100 - (Math.abs(skewness) - 0.5) * 50);
    }
    skewnessScore *= 0.10;
    
    // Kurtosis Score (10%) - Penalizar kurtosis muy alta
    let kurtosisScore = 100;
    if (kurtosis > 3) {
      kurtosisScore = Math.max(0, 100 - (kurtosis - 3) * 20);
    } else if (kurtosis < -1) {
      kurtosisScore = Math.max(0, 100 + (kurtosis + 1) * 20);
    }
    kurtosisScore *= 0.10;
    
    // ZCR Score (5%) - Ideal: 1-3 Hz (60-180 BPM)
    let zcrScore = 100;
    if (zeroCrossingRate < 1 || zeroCrossingRate > 6) {
      zcrScore = 50;
    }
    zcrScore *= 0.05;
    
    // Entropy Score (5%) - Baja entropía es mejor
    let entropyScore = 100;
    if (entropy > 3) {
      entropyScore = Math.max(0, 100 - (entropy - 3) * 30);
    }
    entropyScore *= 0.05;
    
    return snrScore + periodicityScore + stabilityScore + fingerScore + 
           skewnessScore + kurtosisScore + zcrScore + entropyScore;
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