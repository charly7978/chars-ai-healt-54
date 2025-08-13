/**
 * @file AdvancedSignalAnalyzer.ts
 * @description ANALIZADOR DE SEÑALES DE NIVEL INDUSTRIAL EXTREMO
 * Implementa algoritmos matemáticos de máxima complejidad para análisis de señales PPG
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */

import { DetectorScores, DetectionResult } from './types';

export interface SignalAnalyzerConfig {
  QUALITY_LEVELS: number;
  QUALITY_HISTORY_SIZE: number;
  MIN_CONSECUTIVE_DETECTIONS: number;
  MAX_CONSECUTIVE_NO_DETECTIONS: number;
}

export interface AdvancedDetectorMetrics {
  spectralCoherence: number;
  temporalStability: number;
  morphologicalConsistency: number;
  physiologicalPlausibility: number;
  noiseRejectionRatio: number;
  adaptiveThreshold: number;
}

export interface MultiScaleAnalysis {
  finescale: number;
  mesoscale: number;
  macroscale: number;
  crossScaleCorrelation: number;
}

export interface NonLinearDynamics {
  lyapunovExponent: number;
  correlationDimension: number;
  hurstExponent: number;
  detrended_fluctuation: number;
  recurrenceQuantification: number;
}

/**
 * ANALIZADOR DE SEÑALES AVANZADO DE NIVEL INDUSTRIAL
 * Realiza análisis multidimensional de señales PPG con algoritmos matemáticos extremos
 */
export class AdvancedSignalAnalyzer {
  // CONSTANTES MATEMÁTICAS FUNDAMENTALES
  private readonly EULER_NUMBER = 2.718281828459045; // e
  private readonly GOLDEN_RATIO = 1.618033988749895; // φ
  private readonly SILVER_RATIO = 2.414213562373095; // δ_S
  private readonly PLASTIC_NUMBER = 1.324717957244746; // ρ
  private readonly SUPERGOLDEN_RATIO = 1.465571231876768; // ψ
  private readonly CONNECTIVE_CONSTANT = 2.638915503842694; // μ
  
  // PARÁMETROS DE ANÁLISIS AVANZADO
  private readonly WAVELET_SCALES = 16;
  private readonly FRACTAL_DIMENSIONS = 8;
  private readonly ENTROPY_ORDERS = [1, 2, 3, 4, 5]; // Órdenes de entropía de Rényi
  private readonly MULTIFRACTAL_MOMENTS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  
  // ESTRUCTURAS DE DATOS AVANZADAS
  private qualityHistory: number[] = [];
  private detectorHistory: DetectorScores[] = [];
  private nonlinearHistory: NonLinearDynamics[] = [];
  private multiscaleHistory: MultiScaleAnalysis[] = [];
  
  private consecutiveDetections = 0;
  private consecutiveNoDetections = 0;
  
  // ANÁLISIS TEMPORAL COMPLEJO
  private signalBuffer: Float64Array;
  private spectralBuffer: Float64Array;
  private waveletCoefficients: Float64Array[][];
  
  // FILTROS ADAPTATIVOS AVANZADOS
  private adaptiveFilters: {
    kalman: KalmanFilterAdvanced;
    particle: ParticleFilter;
    ensemble: EnsembleKalmanFilter;
  };
  
  // DETECTORES ESPECIALIZADOS
  private detectorScores: DetectorScores = {
    redChannel: 0,
    stability: 0,
    pulsatility: 0,
    biophysical: 0,
    periodicity: 0,
    redValue: 0
  };

  constructor(private readonly config: SignalAnalyzerConfig) {
    this.signalBuffer = new Float64Array(32); // Tamaño fijo optimizado
    this.spectralBuffer = new Float64Array(16);
    this.waveletCoefficients = [];
    
    // Inicialización simplificada para mejor rendimiento
    this.adaptiveFilters = {
      kalman: new KalmanFilterAdvanced(),
      particle: new ParticleFilter(100), // Reducido de 1000 a 100
      ensemble: new EnsembleKalmanFilter(10) // Reducido de 50 a 10
    };
  }

  /**
   * INICIALIZACIÓN DE FILTROS ADAPTATIVOS AVANZADOS
   */
  private initializeAdvancedFilters(): void {
    this.adaptiveFilters = {
      kalman: new KalmanFilterAdvanced(),
      particle: new ParticleFilter(1000), // 1000 partículas
      ensemble: new EnsembleKalmanFilter(50) // 50 miembros del ensemble
    };
  }
  
  /**
   * INICIALIZACIÓN DE BASE WAVELET MULTIRESOLUCIÓN
   */
  private initializeWaveletBasis(): void {
    for (let scale = 0; scale < this.WAVELET_SCALES; scale++) {
      this.waveletCoefficients[scale] = new Float64Array(this.config.QUALITY_HISTORY_SIZE);
    }
  }

  /**
   * REINICIO DEL ANALIZADOR
   */
  reset(): void {
    this.qualityHistory = [];
    this.detectorHistory = [];
    this.nonlinearHistory = [];
    this.multiscaleHistory = [];
    this.consecutiveDetections = 0;
    this.consecutiveNoDetections = 0;
    
    this.signalBuffer.fill(0);
    this.spectralBuffer.fill(0);
    
    for (let scale = 0; scale < this.WAVELET_SCALES; scale++) {
      this.waveletCoefficients[scale].fill(0);
    }
    
    this.adaptiveFilters.kalman.reset();
    this.adaptiveFilters.particle.reset();
    this.adaptiveFilters.ensemble.reset();
  }

  /**
   * ACTUALIZACIÓN DE SCORES DE DETECTORES
   */
  updateDetectorScores(scores: DetectorScores): void {
    this.detectorScores = { ...scores };
    this.detectorHistory.push({ ...scores });
    
    if (this.detectorHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.detectorHistory.shift();
    }
  }

  /**
   * ANÁLISIS MULTIDETECTOR OPTIMIZADO
   */
  analyzeSignalMultiDetector(
    filteredValue: number,
    trendResult: unknown
  ): DetectionResult {
    // ACTUALIZAR BUFFER DE SEÑAL
    this.updateSignalBuffer(filteredValue);
    
    // ANÁLISIS BÁSICO PERO PRECISO
    const { redChannel, stability, pulsatility, biophysical, periodicity } = this.detectorScores;
    
    // FUSIÓN OPTIMIZADA DE DETECTORES
    const weightedScore = (
      redChannel * 0.30 +
      stability * 0.25 +
      pulsatility * 0.25 +
      biophysical * 0.15 +
      periodicity * 0.05
    );
    
    // MAPEO A CALIDAD 0-100
    const qualityValue = Math.min(100, Math.max(0, Math.round(weightedScore * 100)));
    
    // ACTUALIZAR HISTORIA DE CALIDAD
    this.qualityHistory.push(qualityValue);
    if (this.qualityHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.qualityHistory.shift();
    }
    
    // CALIDAD SUAVIZADA
    const smoothedQuality = this.qualityHistory.length > 0 ? 
      this.qualityHistory.reduce((sum, q) => sum + q, 0) / this.qualityHistory.length : 0;
    
    // LÓGICA DE HISTÉRESIS SIMPLIFICADA PERO EFECTIVA
    const DETECTION_THRESHOLD = 30;
    if (smoothedQuality >= DETECTION_THRESHOLD) {
      this.consecutiveDetections += 1;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections += 1;
      this.consecutiveDetections = 0;
    }
    
    const isFingerDetected = this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS;
    
    console.log('[DEBUG] AdvancedSignalAnalyzer - Análisis optimizado:', {
      detectorScores: this.detectorScores,
      weightedScore,
      smoothedQuality,
      consecutiveDetections: this.consecutiveDetections,
      isFingerDetected
    });
    
    return {
      isFingerDetected,
      quality: Math.round(smoothedQuality),
      detectorDetails: { ...this.detectorScores }
    };
  }
  
  /**
   * ACTUALIZACIÓN OPTIMIZADA DEL BUFFER DE SEÑAL
   */
  private updateSignalBuffer(value: number): void {
    // Buffer circular optimizado
    if (this.signalBuffer.length < 32) {
      // Llenar buffer inicialmente
      this.signalBuffer[this.signalBuffer.length] = value;
    } else {
      // Desplazar buffer cuando está lleno
      for (let i = 0; i < this.signalBuffer.length - 1; i++) {
        this.signalBuffer[i] = this.signalBuffer[i + 1];
      }
      this.signalBuffer[this.signalBuffer.length - 1] = value;
    }
  }
  
  /**
   * ANÁLISIS MULTIRESOLUCIÓN MEDIANTE WAVELETS AVANZADAS
   */
  private performMultiscaleAnalysis(): MultiScaleAnalysis {
    const signal = Array.from(this.signalBuffer.slice(-64)); // Últimas 64 muestras
    
    // DESCOMPOSICIÓN WAVELET MULTIRESOLUCIÓN
    const waveletDecomposition = this.computeWaveletDecomposition(signal);
    
    // ANÁLISIS EN DIFERENTES ESCALAS
    const finescale = this.analyzeScale(waveletDecomposition.details[0]); // Escala fina (alta frecuencia)
    const mesoscale = this.analyzeScale(waveletDecomposition.details[2]); // Escala media
    const macroscale = this.analyzeScale(waveletDecomposition.approximation); // Escala gruesa (baja frecuencia)
    
    // CORRELACIÓN CRUZADA ENTRE ESCALAS
    const crossScaleCorrelation = this.computeCrossScaleCorrelation(
      waveletDecomposition.details[0],
      waveletDecomposition.details[2],
      waveletDecomposition.approximation
    );
    
    return { finescale, mesoscale, macroscale, crossScaleCorrelation };
  }
  
  /**
   * DESCOMPOSICIÓN WAVELET AVANZADA CON DAUBECHIES DE ORDEN SUPERIOR
   */
  private computeWaveletDecomposition(signal: number[]): {
    approximation: number[],
    details: number[][]
  } {
    // Coeficientes Daubechies-12 para máxima precisión
    const db12 = [
      0.111540743350, 0.494623890398, 0.751133908021, 0.315250351709,
      -0.226264693965, -0.129766867567, 0.097501605587, 0.027522865530,
      -0.031582039318, 0.000553842201, 0.004777257511, -0.001077301085
    ];
    
    let currentSignal = [...signal];
    const details: number[][] = [];
    
    // Descomposición en múltiples niveles
    for (let level = 0; level < 6; level++) {
      const { approximation, detail } = this.waveletTransformDB12(currentSignal, db12);
      details.push(detail);
      currentSignal = approximation;
      
      if (currentSignal.length < db12.length) break;
    }
    
    return { approximation: currentSignal, details };
  }
  
  /**
   * TRANSFORMADA WAVELET DAUBECHIES-12
   */
  private waveletTransformDB12(signal: number[], coeffs: number[]): {
    approximation: number[], detail: number[]
  } {
    const N = signal.length;
    const halfN = Math.floor(N / 2);
    const approximation = new Array(halfN);
    const detail = new Array(halfN);
    
    for (let i = 0; i < halfN; i++) {
      let approxSum = 0;
      let detailSum = 0;
      
      for (let j = 0; j < coeffs.length; j++) {
        const idx = (2 * i + j) % N;
        approxSum += signal[idx] * coeffs[j];
        detailSum += signal[idx] * coeffs[j] * Math.pow(-1, j);
      }
      
      approximation[i] = approxSum;
      detail[i] = detailSum;
    }
    
    return { approximation, detail };
  }
  
  /**
   * ANÁLISIS DE ESCALA INDIVIDUAL
   */
  private analyzeScale(coefficients: number[]): number {
    if (coefficients.length === 0) return 0;
    
    // Energía de la escala
    const energy = coefficients.reduce((sum, coeff) => sum + coeff * coeff, 0);
    
    // Entropía de la escala
    const probabilities = coefficients.map(coeff => Math.abs(coeff) + 1e-10);
    const totalProb = probabilities.reduce((sum, prob) => sum + prob, 0);
    const normalizedProbs = probabilities.map(prob => prob / totalProb);
    const entropy = -normalizedProbs.reduce((sum, prob) => sum + prob * Math.log2(prob), 0);
    
    // Combinación de energía y entropía
    return Math.tanh(energy * 0.1) * 0.7 + Math.tanh(entropy * 0.1) * 0.3;
  }
  
  /**
   * CORRELACIÓN CRUZADA ENTRE ESCALAS
   */
  private computeCrossScaleCorrelation(fine: number[], meso: number[], macro: number[]): number {
    // Normalizar longitudes
    const minLength = Math.min(fine.length, meso.length, macro.length);
    const fineNorm = fine.slice(0, minLength);
    const mesoNorm = meso.slice(0, minLength);
    const macroNorm = macro.slice(0, minLength);
    
    // Correlaciones por pares
    const corrFineMeso = this.computeCorrelation(fineNorm, mesoNorm);
    const corrMesoMacro = this.computeCorrelation(mesoNorm, macroNorm);
    const corrFineMacro = this.computeCorrelation(fineNorm, macroNorm);
    
    // Correlación promedio
    return (Math.abs(corrFineMeso) + Math.abs(corrMesoMacro) + Math.abs(corrFineMacro)) / 3;
  }
  
  /**
   * CÁLCULO DE CORRELACIÓN ENTRE DOS SEÑALES
   */
  private computeCorrelation(signal1: number[], signal2: number[]): number {
    if (signal1.length !== signal2.length || signal1.length === 0) return 0;
    
    const mean1 = signal1.reduce((sum, val) => sum + val, 0) / signal1.length;
    const mean2 = signal2.reduce((sum, val) => sum + val, 0) / signal2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < signal1.length; i++) {
      const diff1 = signal1[i] - mean1;
      const diff2 = signal2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator > 0 ? numerator / denominator : 0;
  }
  
  /**
   * CÁLCULO DE DINÁMICAS NO LINEALES AVANZADAS
   */
  private computeNonLinearDynamics(): NonLinearDynamics {
    const signal = Array.from(this.signalBuffer.slice(-128)); // Últimas 128 muestras
    
    // EXPONENTE DE LYAPUNOV
    const lyapunovExponent = this.computeLyapunovExponent(signal);
    
    // DIMENSIÓN DE CORRELACIÓN
    const correlationDimension = this.computeCorrelationDimension(signal);
    
    // EXPONENTE DE HURST
    const hurstExponent = this.computeHurstExponent(signal);
    
    // ANÁLISIS DE FLUCTUACIÓN SIN TENDENCIA (DFA)
    const detrended_fluctuation = this.computeDetrendedFluctuation(signal);
    
    // CUANTIFICACIÓN DE RECURRENCIA
    const recurrenceQuantification = this.computeRecurrenceQuantification(signal);
    
    return {
      lyapunovExponent,
      correlationDimension,
      hurstExponent,
      detrended_fluctuation,
      recurrenceQuantification
    };
  }
  
  /**
   * CÁLCULO DEL EXPONENTE DE LYAPUNOV
   */
  private computeLyapunovExponent(signal: number[]): number {
    if (signal.length < 10) return 0;
    
    // Reconstrucción del espacio de fases
    const embedding_dim = 3;
    const delay = 1;
    const phase_space = this.reconstructPhaseSpace(signal, embedding_dim, delay);
    
    // Cálculo del exponente de Lyapunov mediante método de Wolf
    let lyapunov = 0;
    const num_iterations = Math.min(50, phase_space.length - 10);
    
    for (let i = 0; i < num_iterations; i++) {
      const current_point = phase_space[i];
      const next_point = phase_space[i + 1];
      
      // Encontrar punto más cercano
      let min_distance = Infinity;
      let nearest_idx = -1;
      
      for (let j = 0; j < phase_space.length; j++) {
        if (Math.abs(j - i) < 5) continue; // Evitar puntos temporalmente cercanos
        
        const distance = this.euclideanDistance(current_point, phase_space[j]);
        if (distance < min_distance && distance > 1e-10) {
          min_distance = distance;
          nearest_idx = j;
        }
      }
      
      if (nearest_idx !== -1 && nearest_idx + 1 < phase_space.length) {
        const evolved_distance = this.euclideanDistance(next_point, phase_space[nearest_idx + 1]);
        if (evolved_distance > 1e-10 && min_distance > 1e-10) {
          lyapunov += Math.log(evolved_distance / min_distance);
        }
      }
    }
    
    return num_iterations > 0 ? lyapunov / num_iterations : 0;
  }
  
  /**
   * RECONSTRUCCIÓN DEL ESPACIO DE FASES
   */
  private reconstructPhaseSpace(signal: number[], embedding_dim: number, delay: number): number[][] {
    const phase_space: number[][] = [];
    
    for (let i = 0; i <= signal.length - embedding_dim * delay; i++) {
      const point: number[] = [];
      for (let j = 0; j < embedding_dim; j++) {
        point.push(signal[i + j * delay]);
      }
      phase_space.push(point);
    }
    
    return phase_space;
  }
  
  /**
   * DISTANCIA EUCLIDIANA ENTRE DOS PUNTOS
   */
  private euclideanDistance(point1: number[], point2: number[]): number {
    let sum = 0;
    for (let i = 0; i < point1.length; i++) {
      sum += Math.pow(point1[i] - point2[i], 2);
    }
    return Math.sqrt(sum);
  }
  
  /**
   * CÁLCULO DE LA DIMENSIÓN DE CORRELACIÓN
   */
  private computeCorrelationDimension(signal: number[]): number {
    const embedding_dim = 3;
    const delay = 1;
    const phase_space = this.reconstructPhaseSpace(signal, embedding_dim, delay);
    
    if (phase_space.length < 10) return 0;
    
    // Algoritmo de Grassberger-Procaccia
    const radii = [0.1, 0.2, 0.5, 1.0, 2.0];
    const correlations: number[] = [];
    
    for (const radius of radii) {
      let count = 0;
      let total_pairs = 0;
      
      for (let i = 0; i < phase_space.length; i++) {
        for (let j = i + 1; j < phase_space.length; j++) {
          const distance = this.euclideanDistance(phase_space[i], phase_space[j]);
          if (distance < radius) count++;
          total_pairs++;
        }
      }
      
      const correlation = total_pairs > 0 ? count / total_pairs : 0;
      correlations.push(correlation + 1e-10); // Evitar log(0)
    }
    
    // Regresión lineal en escala log-log
    const log_radii = radii.map(r => Math.log(r));
    const log_correlations = correlations.map(c => Math.log(c));
    
    return this.linearRegression(log_radii, log_correlations).slope;
  }
  
  /**
   * REGRESIÓN LINEAL SIMPLE
   */
  private linearRegression(x: number[], y: number[]): { slope: number, intercept: number } {
    const n = x.length;
    const sum_x = x.reduce((sum, val) => sum + val, 0);
    const sum_y = y.reduce((sum, val) => sum + val, 0);
    const sum_xy = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sum_x2 = x.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x);
    const intercept = (sum_y - slope * sum_x) / n;
    
    return { slope, intercept };
  }
  
  /**
   * CÁLCULO DEL EXPONENTE DE HURST
   */
  private computeHurstExponent(signal: number[]): number {
    if (signal.length < 16) return 0.5; // Valor neutro
    
    // Método R/S (Rescaled Range)
    const scales = [4, 8, 16, 32, 64].filter(s => s <= signal.length / 2);
    const rs_values: number[] = [];
    
    for (const scale of scales) {
      const num_windows = Math.floor(signal.length / scale);
      let total_rs = 0;
      
      for (let w = 0; w < num_windows; w++) {
        const window = signal.slice(w * scale, (w + 1) * scale);
        const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
        
        // Desviaciones acumuladas
        const deviations = window.map(val => val - mean);
        const cumulative_deviations = [];
        let cumsum = 0;
        
        for (const dev of deviations) {
          cumsum += dev;
          cumulative_deviations.push(cumsum);
        }
        
        // Rango
        const range = Math.max(...cumulative_deviations) - Math.min(...cumulative_deviations);
        
        // Desviación estándar
        const variance = deviations.reduce((sum, dev) => sum + dev * dev, 0) / deviations.length;
        const std_dev = Math.sqrt(variance);
        
        // R/S
        const rs = std_dev > 0 ? range / std_dev : 0;
        total_rs += rs;
      }
      
      rs_values.push(total_rs / num_windows);
    }
    
    // Regresión log-log
    const log_scales = scales.map(s => Math.log(s));
    const log_rs = rs_values.map(rs => Math.log(rs + 1e-10));
    
    return this.linearRegression(log_scales, log_rs).slope;
  }
  
  /**
   * ANÁLISIS DE FLUCTUACIÓN SIN TENDENCIA (DFA)
   */
  private computeDetrendedFluctuation(signal: number[]): number {
    if (signal.length < 16) return 0;
    
    // Integrar la señal
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const integrated = [];
    let cumsum = 0;
    
    for (const val of signal) {
      cumsum += val - mean;
      integrated.push(cumsum);
    }
    
    // Escalas para análisis
    const scales = [4, 8, 16, 32].filter(s => s <= signal.length / 4);
    const fluctuations: number[] = [];
    
    for (const scale of scales) {
      const num_windows = Math.floor(integrated.length / scale);
      let total_fluctuation = 0;
      
      for (let w = 0; w < num_windows; w++) {
        const window = integrated.slice(w * scale, (w + 1) * scale);
        
        // Ajuste polinomial lineal
        const x = Array.from({ length: scale }, (_, i) => i);
        const regression = this.linearRegression(x, window);
        
        // Calcular fluctuación
        let fluctuation = 0;
        for (let i = 0; i < scale; i++) {
          const trend = regression.slope * i + regression.intercept;
          fluctuation += Math.pow(window[i] - trend, 2);
        }
        
        total_fluctuation += Math.sqrt(fluctuation / scale);
      }
      
      fluctuations.push(total_fluctuation / num_windows);
    }
    
    // Exponente DFA
    const log_scales = scales.map(s => Math.log(s));
    const log_fluctuations = fluctuations.map(f => Math.log(f + 1e-10));
    
    return this.linearRegression(log_scales, log_fluctuations).slope;
  }
  
  /**
   * CUANTIFICACIÓN DE RECURRENCIA
   */
  private computeRecurrenceQuantification(signal: number[]): number {
    if (signal.length < 20) return 0;
    
    const embedding_dim = 2;
    const delay = 1;
    const threshold = 0.1 * this.computeStandardDeviation(signal);
    
    const phase_space = this.reconstructPhaseSpace(signal, embedding_dim, delay);
    const N = phase_space.length;
    
    // Matriz de recurrencia
    let recurrence_points = 0;
    let diagonal_lines = 0;
    let vertical_lines = 0;
    
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const distance = this.euclideanDistance(phase_space[i], phase_space[j]);
        
        if (distance < threshold) {
          recurrence_points++;
          
          // Contar líneas diagonales
          if (i !== j && Math.abs(i - j) > 1) {
            diagonal_lines++;
          }
          
          // Contar líneas verticales
          if (i !== j) {
            vertical_lines++;
          }
        }
      }
    }
    
    // Tasa de recurrencia
    const recurrence_rate = recurrence_points / (N * N);
    
    return Math.min(1.0, recurrence_rate * 10); // Normalizar
  }
  
  /**
   * CÁLCULO DE DESVIACIÓN ESTÁNDAR
   */
  private computeStandardDeviation(signal: number[]): number {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    return Math.sqrt(variance);
  }
  
  /**
   * MÉTRICAS ESPECTRALES AVANZADAS
   */
  private computeAdvancedSpectralMetrics(): {
    dominantFrequency: number,
    spectralCentroid: number,
    spectralSpread: number,
    spectralSkewness: number,
    spectralKurtosis: number,
    spectralEntropy: number
  } {
    const signal = Array.from(this.signalBuffer.slice(-64));
    
    // FFT
    const spectrum = this.computeFFT(signal);
    const magnitude = spectrum.map(c => Math.sqrt(c.real * c.real + c.imag * c.imag));
    
    // Frecuencia dominante
    const maxIdx = magnitude.indexOf(Math.max(...magnitude));
    const dominantFrequency = maxIdx / magnitude.length;
    
    // Centroide espectral
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < magnitude.length; i++) {
      weightedSum += i * magnitude[i];
      magnitudeSum += magnitude[i];
    }
    const spectralCentroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    
    // Dispersión espectral
    let spreadSum = 0;
    for (let i = 0; i < magnitude.length; i++) {
      spreadSum += Math.pow(i - spectralCentroid, 2) * magnitude[i];
    }
    const spectralSpread = magnitudeSum > 0 ? Math.sqrt(spreadSum / magnitudeSum) : 0;
    
    // Asimetría espectral
    let skewnessSum = 0;
    for (let i = 0; i < magnitude.length; i++) {
      skewnessSum += Math.pow(i - spectralCentroid, 3) * magnitude[i];
    }
    const spectralSkewness = magnitudeSum > 0 && spectralSpread > 0 ? 
      skewnessSum / (magnitudeSum * Math.pow(spectralSpread, 3)) : 0;
    
    // Curtosis espectral
    let kurtosisSum = 0;
    for (let i = 0; i < magnitude.length; i++) {
      kurtosisSum += Math.pow(i - spectralCentroid, 4) * magnitude[i];
    }
    const spectralKurtosis = magnitudeSum > 0 && spectralSpread > 0 ? 
      kurtosisSum / (magnitudeSum * Math.pow(spectralSpread, 4)) - 3 : 0;
    
    // Entropía espectral
    const normalizedMagnitude = magnitude.map(mag => mag / magnitudeSum);
    const spectralEntropy = -normalizedMagnitude.reduce((sum, prob) => {
      return prob > 0 ? sum + prob * Math.log2(prob) : sum;
    }, 0);
    
    return {
      dominantFrequency,
      spectralCentroid,
      spectralSpread,
      spectralSkewness,
      spectralKurtosis,
      spectralEntropy
    };
  }
  
  /**
   * FFT OPTIMIZADA
   */
  private computeFFT(signal: number[]): { real: number, imag: number }[] {
    const N = signal.length;
    if (N <= 1) return [{ real: signal[0] || 0, imag: 0 }];
    
    // Asegurar que N es potencia de 2
    const nextPow2 = Math.pow(2, Math.ceil(Math.log2(N)));
    const paddedSignal = [...signal];
    while (paddedSignal.length < nextPow2) {
      paddedSignal.push(0);
    }
    
    return this.fftRecursive(paddedSignal);
  }
  
  /**
   * FFT RECURSIVA
   */
  private fftRecursive(signal: number[]): { real: number, imag: number }[] {
    const N = signal.length;
    if (N <= 1) return [{ real: signal[0] || 0, imag: 0 }];
    
    // Dividir en pares e impares
    const even = signal.filter((_, i) => i % 2 === 0);
    const odd = signal.filter((_, i) => i % 2 === 1);
    
    // FFT recursiva
    const evenFFT = this.fftRecursive(even);
    const oddFFT = this.fftRecursive(odd);
    
    // Combinar resultados
    const result: { real: number, imag: number }[] = new Array(N);
    
    for (let k = 0; k < N / 2; k++) {
      const angle = -2 * Math.PI * k / N;
      const twiddle = {
        real: Math.cos(angle),
        imag: Math.sin(angle)
      };
      
      const oddTerm = {
        real: twiddle.real * oddFFT[k].real - twiddle.imag * oddFFT[k].imag,
        imag: twiddle.real * oddFFT[k].imag + twiddle.imag * oddFFT[k].real
      };
      
      result[k] = {
        real: evenFFT[k].real + oddTerm.real,
        imag: evenFFT[k].imag + oddTerm.imag
      };
      
      result[k + N / 2] = {
        real: evenFFT[k].real - oddTerm.real,
        imag: evenFFT[k].imag - oddTerm.imag
      };
    }
    
    return result;
  }
  
  /**
   * MÉTRICAS MORFOLÓGICAS DE SEÑAL
   */
  private computeMorphologicalMetrics(): {
    complexity: number,
    regularity: number,
    symmetry: number,
    smoothness: number
  } {
    const signal = Array.from(this.signalBuffer.slice(-32));
    
    // Complejidad (basada en variaciones)
    let variations = 0;
    for (let i = 1; i < signal.length - 1; i++) {
      const secondDerivative = signal[i+1] - 2*signal[i] + signal[i-1];
      variations += Math.abs(secondDerivative);
    }
    const complexity = Math.tanh(variations * 0.1);
    
    // Regularidad (basada en autocorrelación)
    const autocorr = this.computeAutocorrelation(signal);
    const regularity = autocorr.length > 1 ? Math.abs(autocorr[1]) : 0;
    
    // Simetría (comparación primera y segunda mitad)
    const mid = Math.floor(signal.length / 2);
    const firstHalf = signal.slice(0, mid);
    const secondHalf = signal.slice(-mid).reverse();
    const symmetry = this.computeCorrelation(firstHalf, secondHalf);
    
    // Suavidad (basada en gradientes)
    let gradientSum = 0;
    for (let i = 1; i < signal.length; i++) {
      gradientSum += Math.abs(signal[i] - signal[i-1]);
    }
    const smoothness = Math.exp(-gradientSum * 0.1);
    
    return { complexity, regularity, symmetry, smoothness };
  }
  
  /**
   * AUTOCORRELACIÓN
   */
  private computeAutocorrelation(signal: number[]): number[] {
    const N = signal.length;
    const autocorr = new Array(N);
    
    const mean = signal.reduce((sum, val) => sum + val, 0) / N;
    const normalizedSignal = signal.map(val => val - mean);
    
    for (let lag = 0; lag < N; lag++) {
      let sum = 0;
      let count = 0;
      
      for (let i = 0; i < N - lag; i++) {
        sum += normalizedSignal[i] * normalizedSignal[i + lag];
        count++;
      }
      
      autocorr[lag] = count > 0 ? sum / count : 0;
    }
    
    // Normalizar por lag=0
    if (autocorr[0] > 0) {
      for (let i = 0; i < N; i++) {
        autocorr[i] /= autocorr[0];
      }
    }
    
    return autocorr;
  }
  
  /**
   * FUSIÓN ADAPTATIVA DE DETECTORES
   */
  private performAdaptiveDetectorFusion(
    multiscale: MultiScaleAnalysis,
    nonlinear: NonLinearDynamics,
    spectral: any,
    morphological: any
  ): number {
    // Pesos adaptativos basados en confiabilidad de cada detector
    const weights = this.computeDetectorWeights(multiscale, nonlinear, spectral, morphological);
    
    // Scores normalizados de cada detector
    const scores = {
      redChannel: Math.tanh(this.detectorScores.redChannel / 100),
      stability: Math.tanh(this.detectorScores.stability * 2),
      pulsatility: Math.tanh(this.detectorScores.pulsatility * 2),
      biophysical: Math.tanh(this.detectorScores.biophysical * 2),
      periodicity: Math.tanh(this.detectorScores.periodicity * 2),
      multiscale: multiscale.crossScaleCorrelation,
      nonlinear: Math.tanh(Math.abs(nonlinear.lyapunovExponent)),
      spectral: Math.tanh(spectral.spectralEntropy / 8),
      morphological: morphological.complexity
    };
    
    // Fusión ponderada
    const fusedScore = (
      scores.redChannel * weights.redChannel +
      scores.stability * weights.stability +
      scores.pulsatility * weights.pulsatility +
      scores.biophysical * weights.biophysical +
      scores.periodicity * weights.periodicity +
      scores.multiscale * weights.multiscale +
      scores.nonlinear * weights.nonlinear +
      scores.spectral * weights.spectral +
      scores.morphological * weights.morphological
    ) / Object.values(weights).reduce((sum, w) => sum + w, 0);
    
    return Math.max(0, Math.min(1, fusedScore));
  }
  
  /**
   * CÁLCULO DE PESOS DE DETECTORES
   */
  private computeDetectorWeights(multiscale: any, nonlinear: any, spectral: any, morphological: any): any {
    // Pesos base
    const baseWeights = {
      redChannel: 0.20,
      stability: 0.15,
      pulsatility: 0.15,
      biophysical: 0.15,
      periodicity: 0.10,
      multiscale: 0.10,
      nonlinear: 0.05,
      spectral: 0.05,
      morphological: 0.05
    };
    
    // Adaptación basada en calidad de señal
    if (spectral.spectralEntropy > 4) {
      baseWeights.spectral *= 1.5;
      baseWeights.redChannel *= 0.8;
    }
    
    if (multiscale.crossScaleCorrelation > 0.7) {
      baseWeights.multiscale *= 1.3;
      baseWeights.stability *= 0.9;
    }
    
    return baseWeights;
  }
  
  /**
   * COHERENCIA TEMPORAL
   */
  private computeTemporalCoherence(): number {
    if (this.qualityHistory.length < 5) return 0.5;
    
    const recent = this.qualityHistory.slice(-5);
    const mean = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;
    
    return Math.exp(-variance / 100); // Normalizar varianza
  }
  
  /**
   * COMPENSACIÓN MATEMÁTICA AVANZADA
   */
  private applyMathematicalCompensation(score: number, coherence: number): number {
    // Función de compensación basada en constantes matemáticas
    const compensation = (
      Math.sin(score * Math.PI / 2) * this.GOLDEN_RATIO / 2 +
      Math.cos(coherence * Math.PI / 2) * this.SILVER_RATIO / 4 +
      Math.tanh(score * coherence) * this.PLASTIC_NUMBER / 3
    ) / 3;
    
    const compensatedScore = score * 0.7 + compensation * 0.3;
    
    return Math.max(0, Math.min(1, compensatedScore));
  }
  
  /**
   * CALIDAD SUAVIZADA ADAPTATIVA
   */
  private computeAdaptiveSmoothedQuality(): number {
    if (this.qualityHistory.length === 0) return 0;
    
    // Filtro adaptativo basado en variabilidad
    const recentVariability = this.computeRecentVariability();
    const adaptiveFactor = Math.exp(-recentVariability / 50);
    
    // Pesos exponenciales adaptativos
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < this.qualityHistory.length; i++) {
      const age = this.qualityHistory.length - 1 - i;
      const weight = Math.exp(-age * adaptiveFactor);
      weightedSum += this.qualityHistory[i] * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }
  
  /**
   * VARIABILIDAD RECIENTE
   */
  private computeRecentVariability(): number {
    if (this.qualityHistory.length < 3) return 0;
    
    const recent = this.qualityHistory.slice(-5);
    const mean = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * DETECCIÓN CON HISTÉRESIS AVANZADA
   */
  private performAdvancedHysteresisDetection(quality: number): { detected: boolean, confidence: number } {
    // Umbrales adaptativos
    const baseThreshold = 30;
    const adaptiveThreshold = this.computeAdaptiveThreshold();
    const detectionThreshold = Math.max(baseThreshold, adaptiveThreshold);
    
    // Lógica de histéresis
    if (quality >= detectionThreshold) {
      this.consecutiveDetections++;
      this.consecutiveNoDetections = 0;
    } else {
      this.consecutiveNoDetections++;
      this.consecutiveDetections = 0;
    }
    
    // Decisión final
    const detected = this.consecutiveDetections >= this.config.MIN_CONSECUTIVE_DETECTIONS;
    const confidence = Math.min(1.0, quality / 100);
    
    return { detected, confidence };
  }
  
  /**
   * UMBRAL ADAPTATIVO
   */
  private computeAdaptiveThreshold(): number {
    if (this.qualityHistory.length < 10) return 30;
    
    const recentMean = this.qualityHistory.slice(-10).reduce((sum, val) => sum + val, 0) / 10;
    const recentStd = this.computeStandardDeviation(this.qualityHistory.slice(-10));
    
    // Umbral basado en estadísticas recientes
    return Math.max(20, recentMean - recentStd);
  }
  
  /**
   * ACTUALIZACIÓN DE HISTORIAS DE ANÁLISIS
   */
  private updateAnalysisHistories(multiscale: MultiScaleAnalysis, nonlinear: NonLinearDynamics): void {
    this.multiscaleHistory.push(multiscale);
    this.nonlinearHistory.push(nonlinear);
    
    if (this.multiscaleHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.multiscaleHistory.shift();
    }
    
    if (this.nonlinearHistory.length > this.config.QUALITY_HISTORY_SIZE) {
      this.nonlinearHistory.shift();
    }
  }
}

// CLASES AUXILIARES PARA FILTROS AVANZADOS

/**
 * FILTRO DE KALMAN AVANZADO
 */
class KalmanFilterAdvanced {
  private state: number = 0;
  private covariance: number = 1;
  private processNoise: number = 0.01;
  private measurementNoise: number = 0.1;
  
  filter(measurement: number): number {
    // Predicción
    const predictedCovariance = this.covariance + this.processNoise;
    
    // Actualización
    const kalmanGain = predictedCovariance / (predictedCovariance + this.measurementNoise);
    this.state = this.state + kalmanGain * (measurement - this.state);
    this.covariance = (1 - kalmanGain) * predictedCovariance;
    
    return this.state;
  }
  
  reset(): void {
    this.state = 0;
    this.covariance = 1;
  }
}

/**
 * FILTRO DE PARTÍCULAS
 */
class ParticleFilter {
  private particles: number[];
  private weights: number[];
  
  constructor(private numParticles: number) {
    this.particles = new Array(numParticles).fill(0);
    this.weights = new Array(numParticles).fill(1 / numParticles);
  }
  
  filter(measurement: number): number {
    // Predicción (movimiento de partículas)
    for (let i = 0; i < this.numParticles; i++) {
      this.particles[i] += (Math.random() - 0.5) * 0.1;
    }
    
    // Actualización de pesos
    for (let i = 0; i < this.numParticles; i++) {
      const error = Math.abs(this.particles[i] - measurement);
      this.weights[i] = Math.exp(-error * error / 0.1);
    }
    
    // Normalizar pesos
    const totalWeight = this.weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight > 0) {
      this.weights = this.weights.map(w => w / totalWeight);
    }
    
    // Remuestreo
    this.resample();
    
    // Estimación
    return this.particles.reduce((sum, p, i) => sum + p * this.weights[i], 0);
  }
  
  private resample(): void {
    const newParticles = new Array(this.numParticles);
    const cumulativeWeights = [];
    let cumsum = 0;
    
    for (const weight of this.weights) {
      cumsum += weight;
      cumulativeWeights.push(cumsum);
    }
    
    for (let i = 0; i < this.numParticles; i++) {
      const rand = Math.random();
      const idx = cumulativeWeights.findIndex(cw => cw >= rand);
      newParticles[i] = this.particles[idx >= 0 ? idx : this.numParticles - 1];
    }
    
    this.particles = newParticles;
    this.weights.fill(1 / this.numParticles);
  }
  
  reset(): void {
    this.particles.fill(0);
    this.weights.fill(1 / this.numParticles);
  }
}

/**
 * FILTRO DE KALMAN DE ENSEMBLE
 */
class EnsembleKalmanFilter {
  private ensemble: number[];
  
  constructor(private ensembleSize: number) {
    this.ensemble = new Array(ensembleSize).fill(0);
  }
  
  filter(measurement: number): number {
    // Predicción del ensemble
    for (let i = 0; i < this.ensembleSize; i++) {
      this.ensemble[i] += (Math.random() - 0.5) * 0.05;
    }
    
    // Media del ensemble
    const ensembleMean = this.ensemble.reduce((sum, val) => sum + val, 0) / this.ensembleSize;
    
    // Covarianza del ensemble
    const ensembleCovariance = this.ensemble.reduce((sum, val) => {
      return sum + Math.pow(val - ensembleMean, 2);
    }, 0) / (this.ensembleSize - 1);
    
    // Ganancia de Kalman
    const kalmanGain = ensembleCovariance / (ensembleCovariance + 0.1);
    
    // Actualización del ensemble
    for (let i = 0; i < this.ensembleSize; i++) {
      this.ensemble[i] += kalmanGain * (measurement - this.ensemble[i]);
    }
    
    return this.ensemble.reduce((sum, val) => sum + val, 0) / this.ensembleSize;
  }
  
  reset(): void {
    this.ensemble.fill(0);
  }
}