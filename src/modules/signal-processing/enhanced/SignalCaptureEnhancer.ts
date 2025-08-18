import { PeakDetectionResult } from '../SignalAnalyzer';

/**
 * SignalCaptureEnhancer - Sistema avanzado de captación y procesamiento de señal PPG
 * Implementa algoritmos médicos para mejorar la calidad de señal y detección de latidos
 */
export class SignalCaptureEnhancer {
  private signalBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private qualityBuffer: number[] = [];
  private peakHistory: PeakDetectionResult[] = [];
  
  private readonly BUFFER_SIZE = 300; // 10 segundos a 30fps
  private readonly FILTER_WINDOW = 15;
  private readonly QUALITY_WINDOW = 30;
  private readonly PEAK_HISTORY_SIZE = 20;
  
  // Parámetros de filtrado optimizados
  private readonly BANDPASS_LOW = 0.7; // Hz (42 BPM)
  private readonly BANDPASS_HIGH = 4.0; // Hz (240 BPM)
  private readonly SAMPLING_RATE = 30; // fps
  
  // Umbrales de calidad
  private readonly MIN_SIGNAL_QUALITY = 0.6;
  private readonly MIN_PEAK_CONFIDENCE = 0.7;
  private readonly MAX_NOISE_RATIO = 0.3;
  
  // Parámetros adaptativos
  private adaptiveThreshold: number = 0.5;
  private baselineSignal: number = 0;
  private noiseFloor: number = 0;

  reset(): void {
    this.signalBuffer = [];
    this.filteredBuffer = [];
    this.qualityBuffer = [];
    this.peakHistory = [];
    this.adaptiveThreshold = 0.5;
    this.baselineSignal = 0;
    this.noiseFloor = 0;
  }

  /**
   * Procesa una nueva muestra de señal y retorna la señal mejorada con métricas de calidad
   */
  processSignal(
    rawSignal: number,
    timestamp: number = Date.now()
  ): {
    enhancedSignal: number;
    quality: number;
    isPeak: boolean;
    peakConfidence: number;
    signalMetrics: {
      snr: number;
      perfusionIndex: number;
      stability: number;
      noiseLevel: number;
    };
  } {
    // 1. Actualizar buffer de señal cruda
    this.updateSignalBuffer(rawSignal);
    
    // 2. Aplicar filtrado avanzado
    const filteredSignal = this.applyAdvancedFiltering(rawSignal);
    this.updateFilteredBuffer(filteredSignal);
    
    // 3. Calcular métricas de calidad
    const signalMetrics = this.calculateSignalMetrics();
    const overallQuality = this.calculateOverallQuality(signalMetrics);
    
    // 4. Detección de picos mejorada
    const peakDetection = this.detectEnhancedPeaks(filteredSignal, timestamp);
    
    // 5. Actualizar parámetros adaptativos
    this.updateAdaptiveParameters(filteredSignal, signalMetrics);
    
    return {
      enhancedSignal: filteredSignal,
      quality: overallQuality,
      isPeak: peakDetection.isPeak,
      peakConfidence: peakDetection.confidence,
      signalMetrics
    };
  }

  private updateSignalBuffer(signal: number): void {
    this.signalBuffer.push(signal);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
  }

  private updateFilteredBuffer(filteredSignal: number): void {
    this.filteredBuffer.push(filteredSignal);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
  }

  private applyAdvancedFiltering(rawSignal: number): number {
    // 1. Filtrado de banda pasada adaptativo
    const bandpassFiltered = this.applyBandpassFilter(rawSignal);
    
    // 2. Filtrado de mediana móvil para eliminar artefactos
    const medianFiltered = this.applyMedianFilter(bandpassFiltered);
    
    // 3. Filtrado de Kalman adaptativo
    const kalmanFiltered = this.applyKalmanFilter(medianFiltered);
    
    // 4. Normalización adaptativa
    const normalized = this.applyAdaptiveNormalization(kalmanFiltered);
    
    return normalized;
  }

  private applyBandpassFilter(signal: number): number {
    // Implementación simplificada de filtro IIR de banda pasada
    // Para una implementación real, se usarían coeficientes de filtro diseñados
    
    if (this.signalBuffer.length < 3) return signal;
    
    // Filtro pasa-bajos (elimina alta frecuencia)
    const alphaLow = 0.2;
    const lowPass = alphaLow * signal + (1 - alphaLow) * (this.filteredBuffer[this.filteredBuffer.length - 1] || signal);
    
    // Filtro pasa-altos (elimina DC y baja frecuencia)
    const alphaHigh = 0.1;
    const highPass = alphaHigh * (lowPass - this.baselineSignal) + (1 - alphaHigh) * 0;
    
    return highPass;
  }

  private applyMedianFilter(signal: number): number {
    const windowSize = 5;
    const recentSignals = this.filteredBuffer.slice(-windowSize + 1);
    recentSignals.push(signal);
    
    const sorted = [...recentSignals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    return median;
  }

  private applyKalmanFilter(signal: number): number {
    // Filtro de Kalman simplificado para suavizado adaptativo
    const processNoise = this.noiseFloor * 0.1;
    const measurementNoise = Math.max(0.1, this.noiseFloor);
    
    const kalmanGain = processNoise / (processNoise + measurementNoise);
    const previousEstimate = this.filteredBuffer[this.filteredBuffer.length - 1] || signal;
    const estimate = previousEstimate + kalmanGain * (signal - previousEstimate);
    
    return estimate;
  }

  private applyAdaptiveNormalization(signal: number): number {
    // Normalización basada en estadísticas adaptativas de la señal
    if (this.filteredBuffer.length < 10) return signal;
    
    const recentSignals = this.filteredBuffer.slice(-30);
    const mean = recentSignals.reduce((sum, val) => sum + val, 0) / recentSignals.length;
    const stdDev = Math.sqrt(
      recentSignals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentSignals.length
    );
    
    // Normalización a rango [0, 1] con manejo de outliers
    const normalized = stdDev > 0 ? (signal - mean) / (3 * stdDev) : 0;
    return Math.max(-1, Math.min(1, normalized));
  }

  private calculateSignalMetrics(): {
    snr: number;
    perfusionIndex: number;
    stability: number;
    noiseLevel: number;
  } {
    if (this.filteredBuffer.length < 20) {
      return { snr: 0, perfusionIndex: 0, stability: 0, noiseLevel: 1 };
    }
    
    const recentSignal = this.filteredBuffer.slice(-30);
    
    // 1. SNR (Signal-to-Noise Ratio)
    const signalPower = this.calculateSignalPower(recentSignal);
    const noisePower = this.calculateNoisePower(recentSignal);
    const snr = noisePower > 0 ? Math.min(1, signalPower / noisePower / 10) : 0;
    
    // 2. Índice de perfusión
    const perfusionIndex = this.calculatePerfusionIndex(recentSignal);
    
    // 3. Estabilidad
    const stability = this.calculateSignalStability(recentSignal);
    
    // 4. Nivel de ruido
    const noiseLevel = Math.min(1, noisePower / (signalPower + 0.001));
    
    return {
      snr: Math.max(0, snr),
      perfusionIndex: Math.max(0, Math.min(1, perfusionIndex)),
      stability: Math.max(0, Math.min(1, stability)),
      noiseLevel: Math.max(0, Math.min(1, noiseLevel))
    };
  }

  private calculateSignalPower(signal: number[]): number {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    return signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
  }

  private calculateNoisePower(signal: number[]): number {
    if (signal.length < 3) return 1;
    
    // Calcular ruido como la diferencia entre señal original y suavizada
    const smoothed = this.movingAverage(signal, 3);
    const noise = signal.map((val, idx) => Math.pow(val - smoothed[idx], 2));
    return noise.reduce((sum, val) => sum + val, 0) / noise.length;
  }

  private calculatePerfusionIndex(signal: number[]): number {
    const dc = signal.reduce((sum, val) => sum + Math.abs(val), 0) / signal.length;
    const ac = Math.sqrt(this.calculateSignalPower(signal));
    
    return dc > 0 ? Math.min(1, (ac / dc) * 5) : 0;
  }

  private calculateSignalStability(signal: number[]): number {
    if (signal.length < 10) return 0;
    
    // Calcular estabilidad como la inversa de la variabilidad
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    const coefficientOfVariation = Math.sqrt(variance) / Math.abs(mean);
    
    return Math.max(0, 1 - coefficientOfVariation);
  }

  private movingAverage(signal: number[], window: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < signal.length; i++) {
      const start = Math.max(0, i - Math.floor(window / 2));
      const end = Math.min(signal.length, i + Math.ceil(window / 2));
      const windowSlice = signal.slice(start, end);
      result.push(windowSlice.reduce((sum, val) => sum + val, 0) / windowSlice.length);
    }
    return result;
  }

  private calculateOverallQuality(metrics: {
    snr: number;
    perfusionIndex: number;
    stability: number;
    noiseLevel: number;
  }): number {
    // Ponderación de métricas para calidad general
    const weights = {
      snr: 0.3,
      perfusionIndex: 0.25,
      stability: 0.25,
      noiseLevel: 0.2 // Inverso: menor ruido = mejor calidad
    };
    
    const quality = 
      (metrics.snr * weights.snr) +
      (metrics.perfusionIndex * weights.perfusionIndex) +
      (metrics.stability * weights.stability) +
      ((1 - metrics.noiseLevel) * weights.noiseLevel);
    
    return Math.max(0, Math.min(1, quality));
  }

  private detectEnhancedPeaks(
    filteredSignal: number,
    timestamp: number
  ): PeakDetectionResult {
    const result: PeakDetectionResult = {
      isPeak: false,
      confidence: 0,
      peakIndex: -1,
      peakValue: filteredSignal,
      timestamp
    };
    
    if (this.filteredBuffer.length < 10) return result;
    
    const recentSignal = this.filteredBuffer.slice(-15);
    const currentIndex = recentSignal.length - 1;
    
    // Verificar si el punto actual es un pico local
    const isLocalMaximum = currentIndex > 0 && currentIndex < recentSignal.length - 1 &&
      filteredSignal > recentSignal[currentIndex - 1] &&
      filteredSignal > recentSignal[currentIndex + 1];
    
    if (!isLocalMaximum) return result;
    
    // Calcular confianza del pico basado en múltiples factores
    const prominence = this.calculatePeakProminence(recentSignal, currentIndex);
    const amplitude = Math.abs(filteredSignal);
    const morphologicalScore = this.assessPeakMorphology(recentSignal, currentIndex);
    const temporalConsistency = this.checkTemporalConsistency(timestamp);
    
    // Combinar factores para calcular confianza
    const confidence = this.calculatePeakConfidence(
      prominence,
      amplitude,
      morphologicalScore,
      temporalConsistency
    );
    
    // Aplicar umbral adaptativo
    if (confidence >= this.adaptiveThreshold && prominence > 0.1) {
      result.isPeak = true;
      result.confidence = confidence;
      result.peakIndex = currentIndex;
      
      // Actualizar historial de picos
      this.updatePeakHistory({
        isPeak: true,
        confidence,
        peakIndex: currentIndex,
        peakValue: filteredSignal,
        timestamp
      });
    }
    
    return result;
  }
  
  private calculatePeakProminence(signal: number[], peakIndex: number): number {
    if (peakIndex <= 0 || peakIndex >= signal.length - 1) return 0;
    
    const peakValue = signal[peakIndex];
    
    // Encontrar valles izquierdo y derecho
    let leftValley = peakValue;
    for (let i = peakIndex - 1; i >= 0; i--) {
      if (signal[i] < leftValley) {
        leftValley = signal[i];
      } else if (signal[i] > signal[i + 1]) {
        break;
      }
    }
    
    let rightValley = peakValue;
    for (let i = peakIndex + 1; i < signal.length; i++) {
      if (signal[i] < rightValley) {
        rightValley = signal[i];
      } else if (signal[i] > signal[i - 1]) {
        break;
      }
    }
    
    // La prominencia es la diferencia entre el pico y el valle más alto
    const referenceLevel = Math.max(leftValley, rightValley);
    return Math.max(0, peakValue - referenceLevel);
  }
  
  private assessPeakMorphology(signal: number[], peakIndex: number): number {
    if (peakIndex < 3 || peakIndex >= signal.length - 3) return 0;
    
    const peakValue = signal[peakIndex];
    
    // Evaluar simetría del pico
    const leftWidth = this.findPeakWidth(signal, peakIndex, -1, peakValue * 0.5);
    const rightWidth = this.findPeakWidth(signal, peakIndex, 1, peakValue * 0.5);
    
    const symmetryScore = leftWidth > 0 && rightWidth > 0 ? 
      1 - Math.abs(leftWidth - rightWidth) / Math.max(leftWidth, rightWidth) : 0;
    
    // Evaluar pendientes
    const leftSlope = (peakValue - signal[peakIndex - 2]) / 2;
    const rightSlope = (signal[peakIndex + 2] - peakValue) / 2;
    const slopeScore = Math.min(1, Math.abs(leftSlope) / Math.abs(rightSlope + 0.001));
    
    return (symmetryScore * 0.6) + (slopeScore * 0.4);
  }
  
  private findPeakWidth(signal: number[], peakIndex: number, direction: number, threshold: number): number {
    let width = 0;
    let i = peakIndex + direction;
    
    while (i >= 0 && i < signal.length && signal[i] > threshold) {
      width++;
      i += direction;
    }
    
    return width;
  }
  
  private checkTemporalConsistency(timestamp: number): number {
    if (this.peakHistory.length < 2) return 0.5;
    
    // Calcular intervalo promedio entre picos
    const recentPeaks = this.peakHistory.slice(-5);
    const intervals = [];
    
    for (let i = 1; i < recentPeaks.length; i++) {
      intervals.push(recentPeaks[i].timestamp - recentPeaks[i - 1].timestamp);
    }
    
    if (intervals.length === 0) return 0.5;
    
    const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const expectedInterval = 60000 / 80; // 80 BPM = 750ms
    
    // Calcular consistencia (1 = perfecta, 0 = muy inconsistente)
    const consistency = 1 - Math.abs(avgInterval - expectedInterval) / expectedInterval;
    return Math.max(0, Math.min(1, consistency));
  }
  
  private calculatePeakConfidence(
    prominence: number,
    amplitude: number,
    morphologicalScore: number,
    temporalConsistency: number
  ): number {
    const weights = {
      prominence: 0.4,
      amplitude: 0.2,
      morphology: 0.25,
      temporal: 0.15
    };
    
    // Normalizar valores
    const normalizedProminence = Math.min(1, prominence * 5);
    const normalizedAmplitude = Math.min(1, amplitude);
    
    const confidence = 
      (normalizedProminence * weights.prominence) +
      (normalizedAmplitude * weights.amplitude) +
      (morphologicalScore * weights.morphology) +
      (temporalConsistency * weights.temporal);
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  private updatePeakHistory(peak: PeakDetectionResult): void {
    this.peakHistory.push(peak);
    if (this.peakHistory.length > this.PEAK_HISTORY_SIZE) {
      this.peakHistory.shift();
    }
  }
  
  private updateAdaptiveParameters(
    filteredSignal: number,
    metrics: { snr: number; perfusionIndex: number; stability: number; noiseLevel: number }
  ): void {
    // Actualizar línea base de señal
    this.baselineSignal = this.baselineSignal * 0.99 + filteredSignal * 0.01;
    
    // Actualizar nivel de ruido
    this.noiseFloor = this.noiseFloor * 0.95 + metrics.noiseLevel * 0.05;
    
    // Ajustar umbral adaptativo basado en calidad de señal
    const qualityFactor = (metrics.snr + metrics.perfusionIndex + metrics.stability) / 3;
    this.adaptiveThreshold = Math.max(0.3, Math.min(0.8, 
      0.7 - (qualityFactor * 0.4) + (metrics.noiseLevel * 0.2)
    ));
  }
  
  /**
   * Obtiene métricas de rendimiento del sistema
   */
  getPerformanceMetrics(): {
    averageQuality: number;
    peakDetectionRate: number;
    falsePositiveRate: number;
    signalStability: number;
    adaptiveThreshold: number;
  } {
    const avgQuality = this.qualityBuffer.length > 0 ?
      this.qualityBuffer.reduce((sum, val) => sum + val, 0) / this.qualityBuffer.length : 0;
    
    const recentPeaks = this.peakHistory.filter(p => p.isPeak);
    const peakRate = this.peakHistory.length > 0 ?
      recentPeaks.length / this.peakHistory.length : 0;
    
    // Estimar tasa de falsos positivos basado en consistencia temporal
    const falsePositiveRate = this.estimateFalsePositiveRate();
    
    const stability = this.calculateSignalStability(this.filteredBuffer.slice(-30));
    
    return {
      averageQuality: avgQuality,
      peakDetectionRate: peakRate,
      falsePositiveRate,
      signalStability: stability,
      adaptiveThreshold: this.adaptiveThreshold
    };
  }
  
  private estimateFalsePositiveRate(): number {
    if (this.peakHistory.length < 5) return 0;
    
    const recentPeaks = this.peakHistory.slice(-10);
    const validPeaks = recentPeaks.filter(p => p.confidence >= this.MIN_PEAK_CONFIDENCE);
    
    // Falsos positivos estimados como picos de baja confianza
    const lowConfidencePeaks = recentPeaks.filter(p => p.confidence < this.MIN_PEAK_CONFIDENCE && p.isPeak);
    
    return recentPeaks.length > 0 ? lowConfidencePeaks.length / recentPeaks.length : 0;
  }
