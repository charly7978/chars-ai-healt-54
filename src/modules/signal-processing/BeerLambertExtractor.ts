/**
 * BEER-LAMBERT EXTRACTOR - Candidatos de señal robustos con absorbancia
 * 
 * Implementa candidatos de señal basados en ley Beer-Lambert y combinaciones inteligentes:
 * - G_abs, R_abs, B_abs (absorbancia pura)
 * - RG_abs_blend (combinación absorbancia)
 * - G_norm, R_norm (normalizados)
 * - tile_coherent_green/red (señales coherentes entre tiles)
 * - pca_tile_pulse (componente principal)
 * - log_ratio_candidate (ratio logarítmico)
 * - ica_cardiac/motion/thermal (FastICA Phase 5)
 * 
 * Fórmulas claras y estables, sin magia estadística opaca.
 */

import { createFastICAExtractor } from './FastICAExtractor';

export interface SignalCandidate {
  id: string;
  name: string;
  signal: Float64Array;
  timestamps: Float64Array;
  
  // Métricas de calidad
  amplitude: number;
  acdcRatio: number;
  signalToNoise: number;
  spectralPower: number;
  bandPowerRatio: number;
  periodicity: number;
  temporalStability: number;
  clippingPenalty: number;
  driftPenalty: number;
  motionPenalty: number;
  
  // Score final
  score: number;
  
  // Metadatos
  sourceType: 'absorbance' | 'normalized' | 'ratio' | 'pca' | 'coherent';
  channels: string[];
  lastUpdate: number;
}

export interface ExtractionConfig {
  minSamples: number;
  eps: number;
  targetFrequency: number;
  sampleRate: number;
}

export class BeerLambertExtractor {
  private config: ExtractionConfig;
  private candidates: Map<string, SignalCandidate> = new Map();
  
  constructor(config: Partial<ExtractionConfig> = {}) {
    this.config = {
      minSamples: 30,
      eps: 1e-6,
      targetFrequency: 1.2, // Hz (72 bpm)
      sampleRate: 30, // Hz
      ...config
    };
  }

  /**
   * Extraer todos los candidatos de señal del banco de trazas
   */
  public extractCandidates(tileTraceBank: any): SignalCandidate[] {
    const candidates: SignalCandidate[] = [];
    
    // 1. Absorbancia pura por canal
    const gAbs = this.extractAbsorbanceSignal(tileTraceBank, 'absorbG');
    if (gAbs) candidates.push(this.createCandidate('G_abs', gAbs, 'absorbance', ['G']));
    
    const rAbs = this.extractAbsorbanceSignal(tileTraceBank, 'absorbR');
    if (rAbs) candidates.push(this.createCandidate('R_abs', rAbs, 'absorbance', ['R']));
    
    const bAbs = this.extractAbsorbanceSignal(tileTraceBank, 'absorbB');
    if (bAbs) candidates.push(this.createCandidate('B_abs', bAbs, 'absorbance', ['B']));
    
    // 2. Combinación de absorbancia RG
    const rgBlend = this.extractRGAbsBlend(tileTraceBank);
    if (rgBlend) candidates.push(this.createCandidate('RG_abs_blend', rgBlend, 'absorbance', ['R', 'G']));
    
    // 3. Señales normalizadas
    const gNorm = this.extractNormalizedSignal(tileTraceBank, 'G');
    if (gNorm) candidates.push(this.createCandidate('G_norm', gNorm, 'normalized', ['G']));
    
    const rNorm = this.extractNormalizedSignal(tileTraceBank, 'R');
    if (rNorm) candidates.push(this.createCandidate('R_norm', rNorm, 'normalized', ['R']));
    
    // 4. Señales coherentes entre tiles
    const coherentG = this.extractCoherentSignal(tileTraceBank, 'absorbG');
    if (coherentG) candidates.push(this.createCandidate('tile_coherent_green', coherentG, 'coherent', ['G']));
    
    const coherentR = this.extractCoherentSignal(tileTraceBank, 'absorbR');
    if (coherentR) candidates.push(this.createCandidate('tile_coherent_red', coherentR, 'coherent', ['R']));
    
    // 5. Componente principal (PCA)
    const pcaPulse = this.extractPCASignal(tileTraceBank);
    if (pcaPulse) candidates.push(this.createCandidate('pca_tile_pulse', pcaPulse, 'pca', ['R', 'G', 'B']));
    
    // 6. Ratio logarítmico
    const logRatio = this.extractLogRatioSignal(tileTraceBank);
    if (logRatio) candidates.push(this.createCandidate('log_ratio_candidate', logRatio, 'ratio', ['R', 'G']));
    
    // 7. FastICA Independent Component Analysis (Phase 5)
    const icaComponents = this.extractFastICAComponents(tileTraceBank);
    for (const comp of icaComponents) {
      const id = `ica_${comp.sourceType}`;
      const candidate = this.createCandidate(id, comp.signal, 'ica', ['R', 'G', 'B']);
      // Boost score for cardiac-type ICA components
      if (comp.sourceType === 'cardiac') {
        candidate.score = Math.min(1, comp.confidence * 1.2); // 20% boost for ICA cardiac
      }
      candidates.push(candidate);
    }
    
    // Calcular métricas de calidad para todos los candidatos
    for (const candidate of candidates) {
      this.calculateQualityMetrics(candidate);
      this.candidates.set(candidate.id, candidate);
    }
    
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Extraer señal de absorbancia pura
   */
  private extractAbsorbanceSignal(tileTraceBank: any, channel: 'R' | 'G' | 'B' | 'absorbR' | 'absorbG' | 'absorbB'): Float64Array | null {
    return tileTraceBank.getWeightedSignal(channel);
  }

  /**
   * Extraer combinación RG absorbancia
   */
  private extractRGAbsBlend(tileTraceBank: any): Float64Array | null {
    const rSignal = tileTraceBank.getWeightedSignal('absorbR');
    const gSignal = tileTraceBank.getWeightedSignal('absorbG');
    
    if (!rSignal || !gSignal || rSignal.length !== gSignal.length) return null;
    
    const blend = new Float64Array(rSignal.length);
    for (let i = 0; i < blend.length; i++) {
      // Combinación optimizada: 0.7*G - 0.3*R (reduce saturación, mejora pulsatilidad)
      blend[i] = 0.7 * gSignal[i] - 0.3 * rSignal[i];
    }
    
    return blend;
  }

  /**
   * Extraer señal normalizada (AC/DC)
   */
  private extractNormalizedSignal(tileTraceBank: any, channel: 'R' | 'G' | 'B'): Float64Array | null {
    const signal = tileTraceBank.getWeightedSignal(channel);
    if (!signal) return null;
    
    // Detrend y normalizar
    const detrended = this.detrend(signal);
    const normalized = this.normalize(detrended);
    
    return normalized;
  }

  /**
   * Extraer señal coherente entre tiles
   */
  private extractCoherentSignal(tileTraceBank: any, channel: string): Float64Array | null {
    const topTiles = tileTraceBank.getTopTiles(4);
    if (topTiles.length < 2) return null;
    
    // Obtener señales de top tiles
    const tileSignals: Float64Array[] = [];
    for (const tile of topTiles) {
      let signal: Float64Array;
      switch (channel) {
        case 'absorbG': signal = tile.absorbG; break;
        case 'absorbR': signal = tile.absorbR; break;
        default: return null;
      }
      
      // Tomar últimas muestras de cada tile
      const usableLength = Math.min(signal.length, tile.count);
      if (usableLength < 10) continue;
      
      const tileSignal = new Float64Array(usableLength);
      const startIdx = tile.writeIndex >= usableLength ? tile.writeIndex - usableLength : 0;
      for (let i = 0; i < usableLength; i++) {
        tileSignal[i] = signal[(startIdx + i) % signal.length];
      }
      
      tileSignals.push(tileSignal);
    }
    
    if (tileSignals.length < 2) return null;
    
    // Calcular señal coherente promediando tiles con alta coherencia
    const minLength = Math.min(...tileSignals.map(s => s.length));
    const coherent = new Float64Array(minLength);
    
    for (let i = 0; i < minLength; i++) {
      let sum = 0;
      let weight = 0;
      
      for (let j = 0; j < tileSignals.length; j++) {
        const tileWeight = topTiles[j].coherence * topTiles[j].sqi;
        sum += tileSignals[j][i] * tileWeight;
        weight += tileWeight;
      }
      
      coherent[i] = weight > 0 ? sum / weight : 0;
    }
    
    return coherent;
  }

  /**
   * Extraer componente principal via PCA simple
   */
  private extractPCASignal(tileTraceBank: any): Float64Array | null {
    const gSignal = tileTraceBank.getWeightedSignal('absorbG');
    const rSignal = tileTraceBank.getWeightedSignal('absorbR');
    const bSignal = tileTraceBank.getWeightedSignal('absorbB');
    
    if (!gSignal || !rSignal || !bSignal) return null;
    const n = gSignal.length;
    
    // Crear matriz de datos (3 x n)
    const data = [
      gSignal.slice(),
      rSignal.slice(), 
      bSignal.slice()
    ];
    
    // Calcular matriz de covarianza
    const cov = this.calculateCovarianceMatrix(data);
    
    // Encontrar eigenvector principal (método de potencia simplificado)
    const eigenvector = this.powerIteration(cov, 50);
    
    // Proyectar datos sobre eigenvector principal
    const pcaSignal = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pcaSignal[i] = eigenvector[0] * gSignal[i] + eigenvector[1] * rSignal[i] + eigenvector[2] * bSignal[i];
    }
    
    return pcaSignal;
  }

  /**
   * Extraer ratio logarítmico R/G
   */
  private extractLogRatioSignal(tileTraceBank: any): Float64Array | null {
    const rSignal = tileTraceBank.getWeightedSignal('normR');
    const gSignal = tileTraceBank.getWeightedSignal('normG');
    
    if (!rSignal || !gSignal || rSignal.length !== gSignal.length) return null;
    
    const logRatio = new Float64Array(rSignal.length);
    for (let i = 0; i < logRatio.length; i++) {
      const ratio = gSignal[i] > this.config.eps ? rSignal[i] / gSignal[i] : 1;
      logRatio[i] = Math.log(ratio);
    }
    
    return logRatio;
  }

  /**
   * Extraer componentes independientes via FastICA (Phase 5)
   */
  private extractFastICAComponents(tileTraceBank: any): any[] {
    const rSignal = tileTraceBank.getWeightedSignal('absorbR');
    const gSignal = tileTraceBank.getWeightedSignal('absorbG');
    const bSignal = tileTraceBank.getWeightedSignal('absorbB');
    
    if (!rSignal || !gSignal || !bSignal) return [];
    if (rSignal.length < 60) return []; // Need minimum samples for ICA
    
    try {
      const ica = createFastICAExtractor({
        nComponents: 3,
        maxIterations: 100,
        nonlinearity: 'pow3',
        symmetric: true
      });
      
      return ica.extractComponents(rSignal, gSignal, bSignal);
    } catch (e) {
      // FastICA can fail on singular matrices - gracefully degrade
      return [];
    }
  }

  /**
   * Calcular métricas de calidad para candidato
   */
  private calculateQualityMetrics(candidate: SignalCandidate): void {
    const signal = candidate.signal;
    const n = signal.length;
    
    if (n < this.config.minSamples) {
      candidate.score = 0;
      return;
    }
    
    // 1. Amplitud
    candidate.bandPowerRatio = this.calculateBandPowerRatio(signal);
    
    // 6. Periodicidad (autocorrelación)
    candidate.periodicity = this.calculatePeriodicity(signal);
    
    // 7. Estabilidad temporal
    candidate.temporalStability = this.calculateTemporalStability(signal);
    
    // 8. Penalizaciones
    candidate.clippingPenalty = this.calculateClippingPenalty(signal);
    candidate.driftPenalty = this.calculateDriftPenalty(signal);
    candidate.motionPenalty = this.calculateMotionPenalty(signal);
    
    // Score final combinado
    candidate.score = this.calculateFinalScore(candidate);
  }

  /**
   * Calcular amplitud de señal
   */
  private calculateAmplitude(signal: Float64Array): number {
    const detrended = this.detrend(signal);
    const min = Math.min(...detrended);
    const max = Math.max(...detrended);
    return (max - min) / 2;
  }

  /**
   * Calcular ratio AC/DC
   */
  private calculateACDCRatio(signal: Float64Array): number {
    const dc = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const ac = this.calculateAmplitude(signal);
    return dc > this.config.eps ? ac / dc : 0;
  }

  /**
   * Calcular SNR
   */
  private calculateSNR(signal: Float64Array): number {
    const detrended = this.detrend(signal);
    const signalPower = detrended.reduce((sum, val) => sum + val * val, 0) / detrended.length;
    const noisePower = this.calculateNoisePower(detrended);
    
    return noisePower > this.config.eps ? signalPower / noisePower : 0;
  }

  /**
   * Calcular potencia espectral
   */
  private calculateSpectralPower(signal: Float64Array): number {
    const psd = this.simplePSD(signal);
    if (!psd) return 0;
    
    return psd.reduce((sum, val) => sum + val, 0) / psd.length;
  }

  /**
   * Calcular band power ratio (banda cardíaca vs total)
   */
  private calculateBandPowerRatio(signal: Float64Array): number {
    const psd = this.simplePSD(signal);
    if (!psd) return 0;
    
    const n = psd.length;
    const cardiacStart = Math.floor(0.8 * n / this.config.sampleRate);
    const cardiacEnd = Math.floor(3.0 * n / this.config.sampleRate);
    
    let totalPower = 0;
    let bandPower = 0;
    
    for (let i = 1; i < n / 2; i++) {
      totalPower += psd[i];
      if (i >= cardiacStart && i <= cardiacEnd) {
        bandPower += psd[i];
      }
    }
    
    return totalPower > 0 ? bandPower / totalPower : 0;
  }

  /**
   * Calcular periodicidad via autocorrelación
   */
  private calculatePeriodicity(signal: Float64Array): number {
    const detrended = this.detrend(signal);
    const autocorr = this.autocorrelation(detrended);
    
    // Encontrar pico en lag esperado (~1/freq)
    const expectedLag = Math.round(this.config.sampleRate / this.config.targetFrequency);
    const searchWindow = 5;
    
    let maxCorr = 0;
    for (let lag = Math.max(1, expectedLag - searchWindow); 
         lag <= Math.min(autocorr.length - 1, expectedLag + searchWindow); lag++) {
      maxCorr = Math.max(maxCorr, Math.abs(autocorr[lag]));
    }
    
    return maxCorr;
  }

  /**
   * Calcular estabilidad temporal
   */
  private calculateTemporalStability(signal: Float64Array): number {
    const windows = 4;
    const windowSize = Math.floor(signal.length / windows);
    
    if (windowSize < 10) return 0;
    
    const windowAmplitudes: number[] = [];
    
    for (let i = 0; i < windows; i++) {
      const start = i * windowSize;
      const end = Math.min(start + windowSize, signal.length);
      const windowSignal = signal.slice(start, end);
      windowAmplitudes.push(this.calculateAmplitude(windowSignal));
    }
    
    const meanAmp = windowAmplitudes.reduce((sum, amp) => sum + amp, 0) / windowAmplitudes.length;
    const variance = windowAmplitudes.reduce((sum, amp) => sum + (amp - meanAmp) ** 2, 0) / windowAmplitudes.length;
    
    return meanAmp > 0 ? 1 - Math.sqrt(variance) / meanAmp : 0;
  }

  /**
   * Calcular penalización por clipping
   */
  private calculateClippingPenalty(signal: Float64Array): number {
    const eps = this.config.eps;
    let clipped = 0;
    
    for (const val of signal) {
      if (val > 0.95 || val < -0.95) clipped++;
    }
    
    return clipped / signal.length;
  }

  /**
   * Calcular penalización por drift
   */
  private calculateDriftPenalty(signal: Float64Array): number {
    const detrended = this.detrend(signal);
    const trend = this.calculateLinearTrend(signal);
    
    return Math.abs(trend);
  }

  /**
   * Calcular penalización por movimiento
   */
  private calculateMotionPenalty(signal: Float64Array): number {
    // Estimar movimiento como alta frecuencia no cardíaca
    const psd = this.simplePSD(signal);
    if (!psd) return 1;
    
    const n = psd.length;
    const cardiacEnd = Math.floor(3.0 * n / this.config.sampleRate);
    const highFreqStart = Math.floor(5.0 * n / this.config.sampleRate);
    
    let highFreqPower = 0;
    for (let i = highFreqStart; i < n / 2; i++) {
      highFreqPower += psd[i];
    }
    
    const totalPower = psd.reduce((sum, val) => sum + val, 0);
    
    return totalPower > 0 ? highFreqPower / totalPower : 0;
  }

  /**
   * Calcular score final
   */
  private calculateFinalScore(candidate: SignalCandidate): number {
    const weights = {
      amplitude: 0.15,
      acdcRatio: 0.15,
      signalToNoise: 0.20,
      bandPowerRatio: 0.20,
      periodicity: 0.15,
      temporalStability: 0.10,
      clippingPenalty: -0.25,
      driftPenalty: -0.15,
      motionPenalty: -0.20
    };
    
    let score = 0;
    score += candidate.amplitude * weights.amplitude;
    score += candidate.acdcRatio * weights.acdcRatio;
    score += Math.min(1, candidate.signalToNoise / 10) * weights.signalToNoise;
    score += candidate.bandPowerRatio * weights.bandPowerRatio;
    score += candidate.periodicity * weights.periodicity;
    score += candidate.temporalStability * weights.temporalStability;
    score += candidate.clippingPenalty * weights.clippingPenalty;
    score += candidate.driftPenalty * weights.driftPenalty;
    score += candidate.motionPenalty * weights.motionPenalty;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Utilidades matemáticas
   */
  private detrend(signal: Float64Array): Float64Array {
    const trend = this.calculateLinearTrend(signal);
    const detrended = new Float64Array(signal.length);
    
    for (let i = 0; i < signal.length; i++) {
      detrended[i] = signal[i] - trend * i;
    }
    
    return detrended;
  }

  private normalize(signal: Float64Array): Float64Array {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const std = Math.sqrt(signal.reduce((sum, val) => sum + (val - mean) ** 2, 0) / signal.length);
    
    if (std < this.config.eps) return signal;
    
    const normalized = new Float64Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      normalized[i] = (signal[i] - mean) / std;
    }
    
    return normalized;
  }

  private calculateLinearTrend(signal: Float64Array): number {
    const n = signal.length;
    const sumX = (n - 1) * n / 2;
    const sumY = signal.reduce((sum, val) => sum + val, 0);
    const sumXY = signal.reduce((sum, val, i) => sum + val * i, 0);
    const sumX2 = (n - 1) * n * (2 * n - 1) / 6;
    
    const denominator = n * sumX2 - sumX * sumX;
    if (Math.abs(denominator) < this.config.eps) return 0;
    
    return (n * sumXY - sumX * sumY) / denominator;
  }

  private calculateNoisePower(signal: Float64Array): number {
    // Estimar ruido como variación en alta frecuencia
    const diff = new Float64Array(signal.length - 1);
    for (let i = 0; i < diff.length; i++) {
      diff[i] = signal[i + 1] - signal[i];
    }
    
    return diff.reduce((sum, val) => sum + val * val, 0) / diff.length;
  }

  private simplePSD(signal: Float64Array): Float64Array | null {
    const n = signal.length;
    if (n < 4) return null;
    
    const psd = new Float64Array(n);
    
    for (let k = 0; k < n; k++) {
      let real = 0, imag = 0;
      
      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        real += signal[i] * Math.cos(angle);
        imag += signal[i] * Math.sin(angle);
      }
      
      psd[k] = (real * real + imag * imag) / (n * n);
    }
    
    return psd;
  }

  private autocorrelation(signal: Float64Array): Float64Array {
    const n = signal.length;
    const autocorr = new Float64Array(n);
    
    for (let lag = 0; lag < n; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) {
        sum += signal[i] * signal[i + lag];
      }
      autocorr[lag] = sum / (n - lag);
    }
    
    return autocorr;
  }

  private calculateCovarianceMatrix(data: Float64Array[]): number[][] {
    const m = data.length; // número de variables
    const n = data[0].length; // número de muestras
    
    // Calcular medias
    const means = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      means[i] = data[i].reduce((sum, val) => sum + val, 0) / n;
    }
    
    // Calcular matriz de covarianza
    const cov: number[][] = Array(m).fill(null).map(() => Array(m).fill(0));
    
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += (data[i][k] - means[i]) * (data[j][k] - means[j]);
        }
        cov[i][j] = sum / (n - 1);
      }
    }
    
    return cov;
  }

  private powerIteration(matrix: number[][], iterations: number): number[] {
    const size = matrix.length;
    let vector = new Array(size).fill(1 / Math.sqrt(size));
    
    for (let iter = 0; iter < iterations; iter++) {
      const newVector = new Array(size).fill(0);
      
      // Multiplicación matriz-vector
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          newVector[i] += matrix[i][j] * vector[j];
        }
      }
      
      // Normalizar
      const norm = Math.sqrt(newVector.reduce((sum, val) => sum + val * val, 0));
      if (norm > this.config.eps) {
        vector = newVector.map(val => val / norm);
      }
    }
    
    return vector;
  }

  private createCandidate(id: string, signal: Float64Array, sourceType: string, channels: string[]): SignalCandidate {
    const timestamps = new Float64Array(signal.length);
    const now = performance.now();
    
    for (let i = 0; i < signal.length; i++) {
      timestamps[i] = now - (signal.length - i) * 1000 / this.config.sampleRate;
    }
    
    return {
      id,
      name: id,
      signal,
      timestamps,
      amplitude: 0,
      acdcRatio: 0,
      signalToNoise: 0,
      spectralPower: 0,
      bandPowerRatio: 0,
      periodicity: 0,
      temporalStability: 0,
      clippingPenalty: 0,
      driftPenalty: 0,
      motionPenalty: 0,
      score: 0,
      sourceType: sourceType as any,
      channels,
      lastUpdate: performance.now()
    };
  }

  /**
   * Obtener mejor candidato
   */
  public getBestCandidate(): SignalCandidate | null {
    const candidates = Array.from(this.candidates.values());
    if (candidates.length === 0) return null;
    
    return candidates.reduce((best, current) => 
      current.score > best.score ? current : best
    );
  }

  /**
   * Obtener todos los candidatos con métricas
   */
  public getAllCandidates(): SignalCandidate[] {
    return Array.from(this.candidates.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Resetear extractor
   */
  public reset(): void {
    this.candidates.clear();
  }
}
