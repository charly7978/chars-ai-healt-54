/**
 * VALIDADOR MULTI-SQI (Signal Quality Index)
 * 
 * 8 índices de calidad basados en PMC5597264 y Nature 2024:
 * 
 * 1. PSQI (Perfusion): AC/DC * 100 - GOLD STANDARD
 * 2. kSQI (Skewness): Asimetría de distribución
 * 3. KurtSQI: Forma de distribución (detecta artefactos)
 * 4. eSQI (Entropy): Complejidad de señal (Shannon)
 * 5. SNR_SQI: Ratio señal/ruido
 * 6. pSQI (Periodicity): Autocorrelación máxima
 * 7. zcSQI (Zero Crossing): Cruces por cero
 * 8. sSQI (Stability): Consistencia de amplitud
 * 
 * DECISIÓN FINAL:
 * - SQI global > 70%: HIGH confidence
 * - SQI global 50-70%: MEDIUM confidence
 * - SQI global 30-50%: LOW confidence
 * - SQI global < 30%: INVALID - descartar segmento
 */

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';

export interface SQIResult {
  // Índices individuales (0-100)
  perfusionSQI: number;
  skewnessSQI: number;
  kurtosisSQI: number;
  entropySQI: number;
  snrSQI: number;
  periodicitySQI: number;
  zeroCrossingSQI: number;
  stabilitySQI: number;
  
  // Resultado global
  globalSQI: number;
  confidence: ConfidenceLevel;
  isValid: boolean;
  
  // Métricas crudas para debug
  raw: {
    perfusionIndex: number;
    skewness: number;
    kurtosis: number;
    entropy: number;
    snr: number;
    periodicity: number;
    zeroCrossingRate: number;
    stability: number;
  };
}

// Pesos para cada SQI según importancia clínica
const SQI_WEIGHTS = {
  perfusion: 0.25,    // Gold standard
  snr: 0.15,          // Importante para ruido
  periodicity: 0.15,  // Detecta ritmo regular
  entropy: 0.12,      // Complejidad
  skewness: 0.10,     // Morfología
  kurtosis: 0.10,     // Detecta artefactos
  zeroCrossing: 0.08, // Frecuencia básica
  stability: 0.05     // Consistencia
};

export class MultiSQIValidator {
  private sampleRate: number;
  
  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
  }
  
  /**
   * VALIDACIÓN COMPLETA DE CALIDAD DE SEÑAL
   */
  validate(
    signal: number[],
    acValue: number = 0,
    dcValue: number = 1
  ): SQIResult {
    // Valores por defecto para señal vacía
    if (signal.length < 30) {
      return this.createInvalidResult();
    }
    
    // Calcular todos los índices
    const perfusionIndex = dcValue > 0 ? (acValue / dcValue) * 100 : 0;
    const skewness = this.calculateSkewness(signal);
    const kurtosis = this.calculateKurtosis(signal);
    const entropy = this.calculateShannonEntropy(signal);
    const snr = this.calculateSNR(signal);
    const periodicity = this.calculatePeriodicity(signal);
    const zeroCrossingRate = this.calculateZeroCrossingRate(signal);
    const stability = this.calculateStability(signal);
    
    // Convertir a scores 0-100
    const perfusionSQI = this.scorePerfusion(perfusionIndex);
    const skewnessSQI = this.scoreSkewness(skewness);
    const kurtosisSQI = this.scoreKurtosis(kurtosis);
    const entropySQI = this.scoreEntropy(entropy);
    const snrSQI = this.scoreSNR(snr);
    const periodicitySQI = this.scorePeriodicity(periodicity);
    const zeroCrossingSQI = this.scoreZeroCrossing(zeroCrossingRate);
    const stabilitySQI = this.scoreStability(stability);
    
    // Calcular SQI global ponderado
    const globalSQI = 
      perfusionSQI * SQI_WEIGHTS.perfusion +
      skewnessSQI * SQI_WEIGHTS.skewness +
      kurtosisSQI * SQI_WEIGHTS.kurtosis +
      entropySQI * SQI_WEIGHTS.entropy +
      snrSQI * SQI_WEIGHTS.snr +
      periodicitySQI * SQI_WEIGHTS.periodicity +
      zeroCrossingSQI * SQI_WEIGHTS.zeroCrossing +
      stabilitySQI * SQI_WEIGHTS.stability;
    
    // Determinar nivel de confianza
    const confidence = this.determineConfidence(globalSQI);
    const isValid = globalSQI >= 30;
    
    return {
      perfusionSQI,
      skewnessSQI,
      kurtosisSQI,
      entropySQI,
      snrSQI,
      periodicitySQI,
      zeroCrossingSQI,
      stabilitySQI,
      globalSQI,
      confidence,
      isValid,
      raw: {
        perfusionIndex,
        skewness,
        kurtosis,
        entropy,
        snr,
        periodicity,
        zeroCrossingRate,
        stability
      }
    };
  }
  
  /**
   * 1. PERFUSION INDEX: AC/DC * 100
   * Gold standard para calidad PPG
   */
  private scorePerfusion(pi: number): number {
    // PI típico: 0.1% - 20%
    // PI < 0.3%: muy débil
    // PI 0.3-2%: normal
    // PI > 5%: excelente contacto
    if (pi < 0.1) return 0;
    if (pi < 0.3) return 20;
    if (pi < 0.5) return 40;
    if (pi < 1.0) return 60;
    if (pi < 3.0) return 80;
    if (pi < 10) return 100;
    return 90; // Muy alto puede indicar saturación
  }
  
  /**
   * 2. SKEWNESS (kSQI)
   * Mide asimetría de la distribución
   * PPG normal: ligeramente positivo (~0.3-0.8)
   */
  private calculateSkewness(signal: number[]): number {
    const n = signal.length;
    if (n < 3) return 0;
    
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const variance = signal.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    
    if (std === 0) return 0;
    
    const skewness = signal.reduce((acc, v) => acc + ((v - mean) / std) ** 3, 0) / n;
    return skewness;
  }
  
  private scoreSkewness(skewness: number): number {
    // Skewness ideal para PPG: 0 a 1
    const absSkew = Math.abs(skewness);
    if (absSkew < 0.5) return 100;
    if (absSkew < 1.0) return 80;
    if (absSkew < 1.5) return 60;
    if (absSkew < 2.0) return 40;
    return 20; // Muy asimétrico = artefacto
  }
  
  /**
   * 3. KURTOSIS
   * Detecta picos anómalos (artefactos de movimiento)
   * PPG normal: kurtosis ~ 3 (mesocúrtica)
   */
  private calculateKurtosis(signal: number[]): number {
    const n = signal.length;
    if (n < 4) return 0;
    
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const variance = signal.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    
    if (std === 0) return 0;
    
    const kurtosis = signal.reduce((acc, v) => acc + ((v - mean) / std) ** 4, 0) / n;
    return kurtosis - 3; // Exceso de kurtosis (0 para normal)
  }
  
  private scoreKurtosis(kurtosis: number): number {
    // Kurtosis ideal: cerca de 0 (exceso)
    const absKurt = Math.abs(kurtosis);
    if (absKurt < 1) return 100;
    if (absKurt < 2) return 80;
    if (absKurt < 3) return 60;
    if (absKurt < 5) return 40;
    return 20; // Muy leptocúrtica/platicúrtica
  }
  
  /**
   * 4. SHANNON ENTROPY
   * Mide complejidad de la señal
   * Señal periódica = baja entropía = buena
   */
  private calculateShannonEntropy(signal: number[]): number {
    const n = signal.length;
    if (n < 10) return 0;
    
    // Discretizar señal en bins
    const min = Math.min(...signal);
    const max = Math.max(...signal);
    const range = max - min;
    
    if (range === 0) return 0;
    
    const numBins = Math.min(20, Math.floor(n / 5));
    const binSize = range / numBins;
    const bins: number[] = new Array(numBins).fill(0);
    
    for (const value of signal) {
      const binIndex = Math.min(numBins - 1, Math.floor((value - min) / binSize));
      bins[binIndex]++;
    }
    
    // Calcular entropía
    let entropy = 0;
    for (const count of bins) {
      if (count > 0) {
        const p = count / n;
        entropy -= p * Math.log2(p);
      }
    }
    
    // Normalizar por entropía máxima
    const maxEntropy = Math.log2(numBins);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }
  
  private scoreEntropy(entropy: number): number {
    // Entropía normalizada: 0-1
    // Baja entropía = más periódica = mejor para PPG
    if (entropy < 0.3) return 100; // Muy periódica
    if (entropy < 0.5) return 80;
    if (entropy < 0.7) return 60;
    if (entropy < 0.85) return 40;
    return 20; // Muy caótica = ruido
  }
  
  /**
   * 5. SNR (Signal-to-Noise Ratio)
   */
  private calculateSNR(signal: number[]): number {
    if (signal.length < 10) return 0;
    
    const max = Math.max(...signal);
    const min = Math.min(...signal);
    const range = max - min;
    
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((acc, v) => acc + (v - mean) ** 2, 0) / signal.length;
    const std = Math.sqrt(variance);
    
    if (std === 0) return 0;
    
    return range / std;
  }
  
  private scoreSNR(snr: number): number {
    // SNR típico PPG: 3-10
    if (snr < 1) return 10;
    if (snr < 2) return 30;
    if (snr < 3) return 50;
    if (snr < 5) return 70;
    if (snr < 8) return 85;
    if (snr < 15) return 100;
    return 90; // Muy alto puede ser sospechoso
  }
  
  /**
   * 6. PERIODICITY via Autocorrelation
   * Detecta ritmo cardíaco regular
   */
  private calculatePeriodicity(signal: number[]): number {
    const n = signal.length;
    if (n < 60) return 0;
    
    // Normalizar señal
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const normalized = signal.map(v => v - mean);
    
    // Calcular autocorrelación para lags de 10-45 samples (40-180 BPM @ 30fps)
    const minLag = Math.floor(this.sampleRate * 60 / 180); // 180 BPM
    const maxLag = Math.floor(this.sampleRate * 60 / 40);  // 40 BPM
    
    let maxCorr = 0;
    const variance = normalized.reduce((acc, v) => acc + v * v, 0);
    
    if (variance === 0) return 0;
    
    for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) {
      let correlation = 0;
      for (let i = 0; i < n - lag; i++) {
        correlation += normalized[i] * normalized[i + lag];
      }
      correlation /= variance;
      
      if (correlation > maxCorr) {
        maxCorr = correlation;
      }
    }
    
    return maxCorr;
  }
  
  private scorePeriodicity(periodicity: number): number {
    // Periodicidad: 0-1 (autocorrelación normalizada)
    if (periodicity < 0.1) return 10;
    if (periodicity < 0.3) return 30;
    if (periodicity < 0.5) return 50;
    if (periodicity < 0.7) return 70;
    if (periodicity < 0.85) return 85;
    return 100;
  }
  
  /**
   * 7. ZERO CROSSING RATE
   * Número de cruces por cero por segundo
   */
  private calculateZeroCrossingRate(signal: number[]): number {
    const n = signal.length;
    if (n < 2) return 0;
    
    // Centrar señal
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const centered = signal.map(v => v - mean);
    
    // Contar cruces
    let crossings = 0;
    for (let i = 1; i < n; i++) {
      if ((centered[i] >= 0 && centered[i - 1] < 0) ||
          (centered[i] < 0 && centered[i - 1] >= 0)) {
        crossings++;
      }
    }
    
    // Cruces por segundo
    const duration = n / this.sampleRate;
    return crossings / duration;
  }
  
  private scoreZeroCrossing(zcr: number): number {
    // ZCR ideal para HR 40-180 BPM: ~1.3-6 cruces/segundo
    if (zcr < 0.5) return 10;  // Muy bajo = sin pulso
    if (zcr < 1.0) return 40;
    if (zcr < 2.0) return 70;
    if (zcr < 4.0) return 100; // Ideal
    if (zcr < 6.0) return 80;
    if (zcr < 10) return 50;
    return 20; // Muy alto = ruido
  }
  
  /**
   * 8. STABILITY
   * Consistencia de amplitud entre segmentos
   */
  private calculateStability(signal: number[]): number {
    const n = signal.length;
    if (n < 30) return 0;
    
    // Dividir en segmentos de 1 segundo
    const segmentSize = this.sampleRate;
    const numSegments = Math.floor(n / segmentSize);
    
    if (numSegments < 2) return 1;
    
    // Calcular amplitud de cada segmento
    const amplitudes: number[] = [];
    for (let i = 0; i < numSegments; i++) {
      const start = i * segmentSize;
      const end = start + segmentSize;
      const segment = signal.slice(start, end);
      const amp = Math.max(...segment) - Math.min(...segment);
      amplitudes.push(amp);
    }
    
    // Coeficiente de variación
    const mean = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
    const variance = amplitudes.reduce((acc, v) => acc + (v - mean) ** 2, 0) / amplitudes.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    
    // Estabilidad = 1 - CV (menor CV = más estable)
    return Math.max(0, 1 - cv);
  }
  
  private scoreStability(stability: number): number {
    // Stability: 0-1 (1 = perfectamente estable)
    return Math.round(stability * 100);
  }
  
  /**
   * Determinar nivel de confianza
   */
  private determineConfidence(globalSQI: number): ConfidenceLevel {
    if (globalSQI >= 70) return 'HIGH';
    if (globalSQI >= 50) return 'MEDIUM';
    if (globalSQI >= 30) return 'LOW';
    return 'INVALID';
  }
  
  /**
   * Resultado inválido por defecto
   */
  private createInvalidResult(): SQIResult {
    return {
      perfusionSQI: 0,
      skewnessSQI: 0,
      kurtosisSQI: 0,
      entropySQI: 0,
      snrSQI: 0,
      periodicitySQI: 0,
      zeroCrossingSQI: 0,
      stabilitySQI: 0,
      globalSQI: 0,
      confidence: 'INVALID',
      isValid: false,
      raw: {
        perfusionIndex: 0,
        skewness: 0,
        kurtosis: 0,
        entropy: 0,
        snr: 0,
        periodicity: 0,
        zeroCrossingRate: 0,
        stability: 0
      }
    };
  }
  
  /**
   * Actualizar sample rate
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }
}
