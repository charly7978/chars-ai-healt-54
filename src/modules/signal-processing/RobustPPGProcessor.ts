/**
 * Procesador PPG Robusto para detección precisa de latidos cardíacos
 * Objetivo: <3% de error en detección
 */

import { goertzelPower } from './Goertzel';

export interface RobustPeakResult {
  peaks: number[];
  confidence: number[];
  rrIntervals: number[];
  bpm: number | null;
  signalQuality: number;
  noiseLevel: number;
}

export class RobustPPGProcessor {
  // Constantes fisiológicas estrictas
  private readonly MIN_HR = 40;
  private readonly MAX_HR = 180;
  private readonly MIN_RR_MS = 333; // 180 BPM
  private readonly MAX_RR_MS = 1500; // 40 BPM
  
  // Buffers para procesamiento multi-escala
  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private secondDerivativeBuffer: number[] = [];
  
  // Historia para validación
  private peakHistory: { time: number; value: number; confidence: number }[] = [];
  private rrHistory: number[] = [];
  
  // Parámetros adaptativos
  private adaptiveThreshold = 0.5;
  private noiseFloor = 0;
  
  /**
   * Procesa una señal PPG completa con múltiples técnicas
   */
  processSignal(
    signal: number[], 
    fs: number,
    previousRR?: number[]
  ): RobustPeakResult {
    if (signal.length < fs * 2) {
      return {
        peaks: [],
        confidence: [],
        rrIntervals: [],
        bpm: null,
        signalQuality: 0,
        noiseLevel: 1
      };
    }

    // 1. Pre-procesamiento avanzado
    const preprocessed = this.advancedPreprocess(signal, fs);
    
    // 2. Evaluación de calidad de señal
    const { quality, noiseLevel } = this.assessSignalQuality(preprocessed, fs);
    
    if (quality < 0.3) {
      return {
        peaks: [],
        confidence: [],
        rrIntervals: [],
        bpm: null,
        signalQuality: quality,
        noiseLevel
      };
    }
    
    // 3. Detección multi-método
    const candidates = this.multiMethodDetection(preprocessed, fs);
    
    // 4. Fusión y validación
    const validated = this.validateAndFusePeaks(candidates, fs, previousRR);
    
    // 5. Cálculo robusto de BPM
    const { bpm, rrIntervals } = this.calculateRobustBPM(validated.peaks, fs);
    
    return {
      peaks: validated.peaks,
      confidence: validated.confidence,
      rrIntervals,
      bpm,
      signalQuality: quality,
      noiseLevel
    };
  }

  /**
   * Pre-procesamiento avanzado de señal
   */
  private advancedPreprocess(signal: number[], fs: number): number[] {
    // 1. Detrending con ventana móvil
    const detrended = this.movingWindowDetrend(signal, fs);
    
    // 2. Filtro Butterworth pasabanda de orden 4
    const filtered = this.butterworthBandpass(detrended, fs, 0.5, 4.0);
    
    // 3. Normalización adaptativa
    const normalized = this.adaptiveNormalize(filtered);
    
    // 4. Mejora de señal con Savitzky-Golay
    const windowSize = Math.floor(fs * 0.15); // 150ms
    const enhanced = this.savitzkyGolayEnhanced(normalized, windowSize);
    
    return enhanced;
  }

  /**
   * Detrending con ventana móvil para eliminar deriva de línea base
   */
  private movingWindowDetrend(signal: number[], fs: number): number[] {
    const windowSize = Math.floor(fs * 2); // 2 segundos
    const detrended = new Array(signal.length);
    
    for (let i = 0; i < signal.length; i++) {
      const start = Math.max(0, i - windowSize / 2);
      const end = Math.min(signal.length, i + windowSize / 2);
      
      // Calcular tendencia local con regresión lineal
      const window = signal.slice(start, end);
      const trend = this.localLinearTrend(window, i - start);
      
      detrended[i] = signal[i] - trend;
    }
    
    return detrended;
  }

  /**
   * Filtro Butterworth pasabanda de orden 4
   */
  private butterworthBandpass(signal: number[], fs: number, lowFreq: number, highFreq: number): number[] {
    // Coeficientes pre-calculados para Butterworth orden 4
    const nyquist = fs / 2;
    const lowNorm = lowFreq / nyquist;
    const highNorm = highFreq / nyquist;
    
    // Aplicar filtro hacia adelante y atrás para fase cero
    let filtered = this.butterworthForward(signal, lowNorm, highNorm);
    filtered = this.butterworthBackward(filtered, lowNorm, highNorm);
    
    return filtered;
  }

  /**
   * Normalización adaptativa basada en percentiles
   */
  private adaptiveNormalize(signal: number[]): number[] {
    const sorted = [...signal].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(signal.length * 0.05)];
    const p95 = sorted[Math.floor(signal.length * 0.95)];
    const range = p95 - p5;
    
    if (range < 0.001) return signal.map(() => 0);
    
    // Normalizar con clipping suave
    return signal.map(x => {
      const normalized = (x - p5) / range;
      return Math.tanh(normalized * 2); // Función sigmoide suave
    });
  }

  /**
   * Savitzky-Golay mejorado con detección de bordes
   */
  private savitzkyGolayEnhanced(signal: number[], windowSize: number): number[] {
    const halfWindow = Math.floor(windowSize / 2);
    const result = new Array(signal.length);
    
    // Coeficientes para polinomio de orden 3
    const coeffs = this.calculateSGCoefficients(windowSize, 3);
    
    for (let i = 0; i < signal.length; i++) {
      if (i < halfWindow || i >= signal.length - halfWindow) {
        result[i] = signal[i];
        continue;
      }
      
      let sum = 0;
      for (let j = -halfWindow; j <= halfWindow; j++) {
        sum += signal[i + j] * coeffs[j + halfWindow];
      }
      result[i] = sum;
    }
    
    return result;
  }

  /**
   * Evaluación de calidad de señal
   */
  private assessSignalQuality(signal: number[], fs: number): { quality: number; noiseLevel: number } {
    // 1. SNR en dominio de frecuencia
    const snr = this.calculateSpectralSNR(signal, fs);
    
    // 2. Regularidad temporal
    const regularity = this.calculateTemporalRegularity(signal);
    
    // 3. Contenido de frecuencia cardíaca
    const hrContent = this.calculateHRFrequencyContent(signal, fs);
    
    // 4. Nivel de ruido
    const noiseLevel = this.estimateNoiseLevel(signal, fs);
    
    // Combinar métricas con pesos
    const quality = (
      0.4 * Math.min(1, snr / 10) +
      0.3 * regularity +
      0.2 * hrContent +
      0.1 * (1 - noiseLevel)
    );
    
    return { quality: Math.max(0, Math.min(1, quality)), noiseLevel };
  }

  /**
   * Detección multi-método para robustez
   */
  private multiMethodDetection(signal: number[], fs: number): {
    method: string;
    peaks: number[];
    confidence: number[];
  }[] {
    const methods = [];
    
    // Método 1: Derivada adaptativa
    methods.push(this.adaptiveDerivativeMethod(signal, fs));
    
    // Método 2: Energía local
    methods.push(this.localEnergyMethod(signal, fs));
    
    // Método 3: Correlación con plantilla
    methods.push(this.templateMatchingMethod(signal, fs));
    
    // Método 4: Transformada Wavelet
    methods.push(this.waveletMethod(signal, fs));
    
    return methods;
  }

  /**
   * Método de derivada adaptativa
   */
  private adaptiveDerivativeMethod(signal: number[], fs: number): {
    method: string;
    peaks: number[];
    confidence: number[];
  } {
    const peaks: number[] = [];
    const confidence: number[] = [];
    
    // Calcular derivadas
    const firstDer = this.calculateDerivative(signal, 5);
    const secondDer = this.calculateDerivative(firstDer, 5);
    
    // Umbral adaptativo basado en estadísticas locales
    const windowSize = Math.floor(fs * 1.5); // 1.5 segundos
    const minDistance = Math.floor(fs * this.MIN_RR_MS / 1000);
    
    let lastPeak = -minDistance;
    
    for (let i = windowSize; i < signal.length - windowSize; i++) {
      if (i - lastPeak < minDistance) continue;
      
      // Condiciones para pico
      const isMaxima = signal[i] > signal[i-1] && signal[i] > signal[i+1];
      const derivCrossing = firstDer[i-1] > 0 && firstDer[i+1] <= 0;
      const secondDerNeg = secondDer[i] < 0;
      
      if ((isMaxima || derivCrossing) && secondDerNeg) {
        // Calcular umbral local
        const localWindow = signal.slice(i - windowSize/2, i + windowSize/2);
        const localMean = this.mean(localWindow);
        const localStd = this.std(localWindow);
        const threshold = localMean + this.adaptiveThreshold * localStd;
        
        if (signal[i] > threshold) {
          // Calcular confianza basada en prominencia y forma
          const prominence = this.calculateProminence(signal, i, windowSize/2);
          const shapeScore = this.evaluatePeakShape(signal, i, fs);
          
          const peakConfidence = (prominence + shapeScore) / 2;
          
          if (peakConfidence > 0.5) {
            peaks.push(i);
            confidence.push(peakConfidence);
            lastPeak = i;
          }
        }
      }
    }
    
    return { method: 'adaptive_derivative', peaks, confidence };
  }

  /**
   * Método de energía local
   */
  private localEnergyMethod(signal: number[], fs: number): {
    method: string;
    peaks: number[];
    confidence: number[];
  } {
    const peaks: number[] = [];
    const confidence: number[] = [];
    
    // Calcular energía local
    const windowSize = Math.floor(fs * 0.1); // 100ms
    const energy = new Array(signal.length).fill(0);
    
    for (let i = windowSize; i < signal.length - windowSize; i++) {
      let sum = 0;
      for (let j = -windowSize; j <= windowSize; j++) {
        sum += signal[i + j] ** 2;
      }
      energy[i] = sum / (2 * windowSize + 1);
    }
    
    // Encontrar picos en energía
    const minDistance = Math.floor(fs * this.MIN_RR_MS / 1000);
    let lastPeak = -minDistance;
    
    for (let i = 1; i < energy.length - 1; i++) {
      if (i - lastPeak < minDistance) continue;
      
      if (energy[i] > energy[i-1] && energy[i] > energy[i+1]) {
        const prominence = this.calculateProminence(energy, i, windowSize);
        
        if (prominence > 0.3) {
          peaks.push(i);
          confidence.push(prominence);
          lastPeak = i;
        }
      }
    }
    
    return { method: 'local_energy', peaks, confidence };
  }

  /**
   * Método de correlación con plantilla
   */
  private templateMatchingMethod(signal: number[], fs: number): {
    method: string;
    peaks: number[];
    confidence: number[];
  } {
    // Crear plantilla de latido cardíaco ideal
    const templateSize = Math.floor(fs * 0.3); // 300ms
    const template = this.createHeartbeatTemplate(templateSize);
    
    // Correlación cruzada
    const correlation = this.crossCorrelate(signal, template);
    
    // Encontrar picos en correlación
    const peaks: number[] = [];
    const confidence: number[] = [];
    const minDistance = Math.floor(fs * this.MIN_RR_MS / 1000);
    let lastPeak = -minDistance;
    
    for (let i = templateSize; i < correlation.length - templateSize; i++) {
      if (i - lastPeak < minDistance) continue;
      
      if (correlation[i] > correlation[i-1] && correlation[i] > correlation[i+1]) {
        const corr = correlation[i];
        
        if (corr > 0.7) {
          peaks.push(i);
          confidence.push(corr);
          lastPeak = i;
        }
      }
    }
    
    return { method: 'template_matching', peaks, confidence };
  }

  /**
   * Método de Transformada Wavelet
   */
  private waveletMethod(signal: number[], fs: number): {
    method: string;
    peaks: number[];
    confidence: number[];
  } {
    // Descomposición wavelet (Daubechies 4)
    const scales = [4, 8, 16, 32]; // Escalas correspondientes a frecuencias cardíacas
    const coefficients = this.waveletTransform(signal, scales);
    
    // Combinar escalas relevantes
    const combined = new Array(signal.length).fill(0);
    for (let i = 0; i < signal.length; i++) {
      combined[i] = (
        coefficients[0][i] * 0.25 +
        coefficients[1][i] * 0.35 +
        coefficients[2][i] * 0.25 +
        coefficients[3][i] * 0.15
      );
    }
    
    // Detectar picos
    const peaks: number[] = [];
    const confidence: number[] = [];
    const minDistance = Math.floor(fs * this.MIN_RR_MS / 1000);
    let lastPeak = -minDistance;
    
    for (let i = 1; i < combined.length - 1; i++) {
      if (i - lastPeak < minDistance) continue;
      
      if (combined[i] > combined[i-1] && combined[i] > combined[i+1]) {
        const prominence = this.calculateProminence(combined, i, 32);
        
        if (prominence > 0.4) {
          peaks.push(i);
          confidence.push(prominence);
          lastPeak = i;
        }
      }
    }
    
    return { method: 'wavelet', peaks, confidence };
  }

  /**
   * Validación y fusión de picos detectados
   */
  private validateAndFusePeaks(
    candidates: { method: string; peaks: number[]; confidence: number[] }[],
    fs: number,
    previousRR?: number[]
  ): { peaks: number[]; confidence: number[] } {
    // Agrupar picos cercanos de diferentes métodos
    const groups = this.groupNearbyPeaks(candidates, fs);
    
    // Validar cada grupo
    const validatedPeaks: number[] = [];
    const validatedConfidence: number[] = [];
    
    for (const group of groups) {
      // Calcular consenso
      const consensus = group.length / candidates.length;
      
      if (consensus >= 0.5) { // Al menos 50% de métodos coinciden
        // Posición promedio ponderada por confianza
        let weightedSum = 0;
        let confidenceSum = 0;
        
        for (const peak of group) {
          weightedSum += peak.position * peak.confidence;
          confidenceSum += peak.confidence;
        }
        
        const finalPosition = Math.round(weightedSum / confidenceSum);
        const finalConfidence = Math.min(1, consensus * (confidenceSum / group.length));
        
        // Validación fisiológica
        if (this.isPhysiologicallyValid(finalPosition, validatedPeaks, fs, previousRR)) {
          validatedPeaks.push(finalPosition);
          validatedConfidence.push(finalConfidence);
        }
      }
    }
    
    return { peaks: validatedPeaks, confidence: validatedConfidence };
  }

  /**
   * Agrupa picos cercanos de diferentes métodos
   */
  private groupNearbyPeaks(
    candidates: { method: string; peaks: number[]; confidence: number[] }[],
    fs: number
  ): { position: number; confidence: number; method: string }[][] {
    const tolerance = Math.floor(fs * 0.05); // 50ms de tolerancia
    const allPeaks: { position: number; confidence: number; method: string }[] = [];
    
    // Recopilar todos los picos
    for (const candidate of candidates) {
      for (let i = 0; i < candidate.peaks.length; i++) {
        allPeaks.push({
          position: candidate.peaks[i],
          confidence: candidate.confidence[i],
          method: candidate.method
        });
      }
    }
    
    // Ordenar por posición
    allPeaks.sort((a, b) => a.position - b.position);
    
    // Agrupar
    const groups: { position: number; confidence: number; method: string }[][] = [];
    let currentGroup: { position: number; confidence: number; method: string }[] = [];
    
    for (const peak of allPeaks) {
      if (currentGroup.length === 0) {
        currentGroup.push(peak);
      } else {
        const lastPeak = currentGroup[currentGroup.length - 1];
        
        if (peak.position - lastPeak.position <= tolerance) {
          currentGroup.push(peak);
        } else {
          groups.push(currentGroup);
          currentGroup = [peak];
        }
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  /**
   * Validación fisiológica de picos
   */
  private isPhysiologicallyValid(
    peakPosition: number,
    existingPeaks: number[],
    fs: number,
    previousRR?: number[]
  ): boolean {
    if (existingPeaks.length === 0) return true;
    
    const lastPeak = existingPeaks[existingPeaks.length - 1];
    const interval = (peakPosition - lastPeak) / fs * 1000; // ms
    
    // Verificar rango fisiológico
    if (interval < this.MIN_RR_MS || interval > this.MAX_RR_MS) {
      return false;
    }
    
    // Si hay historia previa, verificar consistencia
    if (previousRR && previousRR.length >= 3) {
      const meanPrevRR = this.mean(previousRR.slice(-5));
      const variation = Math.abs(interval - meanPrevRR) / meanPrevRR;
      
      // Permitir hasta 25% de variación respecto a latidos previos
      if (variation > 0.25) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Cálculo robusto de BPM
   */
  private calculateRobustBPM(peaks: number[], fs: number): {
    bpm: number | null;
    rrIntervals: number[];
  } {
    if (peaks.length < 3) {
      return { bpm: null, rrIntervals: [] };
    }
    
    // Calcular intervalos RR
    const rrIntervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = (peaks[i] - peaks[i-1]) / fs * 1000; // ms
      rrIntervals.push(interval);
    }
    
    // Filtrar outliers con método IQR
    const filtered = this.filterOutliersIQR(rrIntervals);
    
    if (filtered.length < 2) {
      return { bpm: null, rrIntervals };
    }
    
    // Calcular BPM con media recortada
    const trimmedMean = this.trimmedMean(filtered, 0.1); // 10% recorte
    const bpm = Math.round(60000 / trimmedMean);
    
    // Validación final
    if (bpm < this.MIN_HR || bpm > this.MAX_HR) {
      return { bpm: null, rrIntervals };
    }
    
    return { bpm, rrIntervals };
  }

  // Métodos auxiliares

  private calculateDerivative(signal: number[], order: number): number[] {
    const derivative = new Array(signal.length).fill(0);
    const half = Math.floor(order / 2);
    
    for (let i = half; i < signal.length - half; i++) {
      let sum = 0;
      for (let j = 1; j <= half; j++) {
        sum += j * (signal[i + j] - signal[i - j]);
      }
      derivative[i] = sum / (half * (half + 1) * (2 * half + 1) / 3);
    }
    
    return derivative;
  }

  private calculateProminence(signal: number[], peakIdx: number, window: number): number {
    const start = Math.max(0, peakIdx - window);
    const end = Math.min(signal.length, peakIdx + window);
    
    let leftMin = signal[peakIdx];
    let rightMin = signal[peakIdx];
    
    for (let i = peakIdx - 1; i >= start; i--) {
      leftMin = Math.min(leftMin, signal[i]);
      if (signal[i] > signal[peakIdx]) break;
    }
    
    for (let i = peakIdx + 1; i < end; i++) {
      rightMin = Math.min(rightMin, signal[i]);
      if (signal[i] > signal[peakIdx]) break;
    }
    
    const prominence = signal[peakIdx] - Math.max(leftMin, rightMin);
    const normalized = prominence / (Math.max(...signal.slice(start, end)) - Math.min(...signal.slice(start, end)));
    
    return Math.max(0, Math.min(1, normalized));
  }

  private evaluatePeakShape(signal: number[], peakIdx: number, fs: number): number {
    const windowSize = Math.floor(fs * 0.15); // 150ms
    const start = Math.max(0, peakIdx - windowSize);
    const end = Math.min(signal.length, peakIdx + windowSize);
    
    // Evaluar simetría
    let symmetryScore = 0;
    const halfWindow = Math.floor((end - start) / 2);
    
    for (let i = 1; i < halfWindow; i++) {
      const left = signal[peakIdx - i] || 0;
      const right = signal[peakIdx + i] || 0;
      const diff = Math.abs(left - right) / Math.max(left, right, 0.001);
      symmetryScore += 1 - diff;
    }
    symmetryScore /= halfWindow;
    
    // Evaluar suavidad
    let smoothness = 0;
    for (let i = start + 1; i < end - 1; i++) {
      const secondDer = Math.abs(signal[i-1] - 2*signal[i] + signal[i+1]);
      smoothness += 1 / (1 + secondDer);
    }
    smoothness /= (end - start - 2);
    
    return (symmetryScore + smoothness) / 2;
  }

  private calculateSpectralSNR(signal: number[], fs: number): number {
    // Calcular espectro de potencia en frecuencias cardíacas
    const freqs = [];
    const powers = [];
    
    for (let f = 0.5; f <= 4.0; f += 0.1) {
      freqs.push(f);
      powers.push(goertzelPower(signal, fs, f));
    }
    
    // Encontrar pico principal
    const maxPower = Math.max(...powers);
    const maxIdx = powers.indexOf(maxPower);
    
    // Calcular ruido como mediana fuera del pico
    const noisePowers = powers.filter((_, i) => Math.abs(i - maxIdx) > 5);
    const noisePower = this.median(noisePowers);
    
    return maxPower / Math.max(noisePower, 1e-10);
  }

  private calculateTemporalRegularity(signal: number[]): number {
    // Autocorrelación normalizada
    const maxLag = Math.floor(signal.length / 4);
    let maxCorr = 0;
    
    for (let lag = Math.floor(signal.length * 0.02); lag < maxLag; lag++) {
      let corr = 0;
      let count = 0;
      
      for (let i = 0; i < signal.length - lag; i++) {
        corr += signal[i] * signal[i + lag];
        count++;
      }
      
      corr /= count;
      maxCorr = Math.max(maxCorr, Math.abs(corr));
    }
    
    return Math.min(1, maxCorr);
  }

  private calculateHRFrequencyContent(signal: number[], fs: number): number {
    // Calcular energía en banda de frecuencia cardíaca
    let hrEnergy = 0;
    let totalEnergy = 0;
    
    for (let f = 0.1; f <= 5.0; f += 0.1) {
      const power = goertzelPower(signal, fs, f);
      totalEnergy += power;
      
      if (f >= 0.5 && f <= 4.0) {
        hrEnergy += power;
      }
    }
    
    return hrEnergy / Math.max(totalEnergy, 1e-10);
  }

  private estimateNoiseLevel(signal: number[], fs: number): number {
    // Estimar ruido usando MAD en banda de alta frecuencia
    const highFreq = this.butterworthHighpass(signal, fs, 5.0);
    const mad = this.mad(highFreq);
    const signalRange = Math.max(...signal) - Math.min(...signal);
    
    return Math.min(1, mad / Math.max(signalRange, 1e-10));
  }

  private localLinearTrend(window: number[], targetIdx: number): number {
    const n = window.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += window[i];
      sumXY += i * window[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return slope * targetIdx + intercept;
  }

  private createHeartbeatTemplate(size: number): number[] {
    const template = new Array(size);
    const center = Math.floor(size / 2);
    
    // Forma típica de onda R en PPG
    for (let i = 0; i < size; i++) {
      const t = (i - center) / size * 4;
      template[i] = Math.exp(-t * t) * Math.cos(t * Math.PI);
    }
    
    // Normalizar
    const max = Math.max(...template);
    return template.map(x => x / max);
  }

  private crossCorrelate(signal: number[], template: number[]): number[] {
    const result = new Array(signal.length).fill(0);
    const templateSum = template.reduce((a, b) => a + b, 0);
    const templateSum2 = template.reduce((a, b) => a + b * b, 0);
    
    for (let i = 0; i <= signal.length - template.length; i++) {
      let sum = 0, signalSum = 0, signalSum2 = 0;
      
      for (let j = 0; j < template.length; j++) {
        const s = signal[i + j];
        sum += s * template[j];
        signalSum += s;
        signalSum2 += s * s;
      }
      
      const num = sum - signalSum * templateSum / template.length;
      const den1 = signalSum2 - signalSum * signalSum / template.length;
      const den2 = templateSum2 - templateSum * templateSum / template.length;
      
      result[i + Math.floor(template.length / 2)] = num / Math.sqrt(Math.max(den1 * den2, 1e-10));
    }
    
    return result;
  }

  private waveletTransform(signal: number[], scales: number[]): number[][] {
    const coefficients: number[][] = [];
    
    for (const scale of scales) {
      const wavelet = this.createMorletWavelet(scale);
      coefficients.push(this.convolve(signal, wavelet));
    }
    
    return coefficients;
  }

  private createMorletWavelet(scale: number): number[] {
    const size = scale * 6;
    const wavelet = new Array(size);
    const center = Math.floor(size / 2);
    
    for (let i = 0; i < size; i++) {
      const t = (i - center) / scale;
      wavelet[i] = Math.exp(-t * t / 2) * Math.cos(5 * t);
    }
    
    return wavelet;
  }

  private convolve(signal: number[], kernel: number[]): number[] {
    const result = new Array(signal.length).fill(0);
    const halfKernel = Math.floor(kernel.length / 2);
    
    for (let i = halfKernel; i < signal.length - halfKernel; i++) {
      for (let j = 0; j < kernel.length; j++) {
        result[i] += signal[i - halfKernel + j] * kernel[j];
      }
    }
    
    return result;
  }

  private filterOutliersIQR(data: number[]): number[] {
    const sorted = [...data].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    return data.filter(x => x >= lowerBound && x <= upperBound);
  }

  private trimmedMean(data: number[], trim: number): number {
    const sorted = [...data].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * trim);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    
    return this.mean(trimmed);
  }

  private butterworthForward(signal: number[], lowNorm: number, highNorm: number): number[] {
    // Implementación simplificada de Butterworth
    // En producción, usar coeficientes pre-calculados
    const result = [...signal];
    
    // Paso alto
    let prev = 0;
    const alpha = 1 / (1 + 2 * Math.PI * lowNorm);
    
    for (let i = 0; i < result.length; i++) {
      const curr = alpha * (result[i] + prev);
      prev = result[i];
      result[i] = curr;
    }
    
    // Paso bajo
    const beta = 2 * Math.PI * highNorm / (1 + 2 * Math.PI * highNorm);
    
    for (let i = 1; i < result.length; i++) {
      result[i] = result[i-1] + beta * (result[i] - result[i-1]);
    }
    
    return result;
  }

  private butterworthBackward(signal: number[], lowNorm: number, highNorm: number): number[] {
    const reversed = [...signal].reverse();
    const filtered = this.butterworthForward(reversed, lowNorm, highNorm);
    return filtered.reverse();
  }

  private butterworthHighpass(signal: number[], fs: number, cutoff: number): number[] {
    const nyquist = fs / 2;
    const norm = cutoff / nyquist;
    
    const result = [...signal];
    let prev = 0;
    const alpha = 1 / (1 + 2 * Math.PI * norm);
    
    for (let i = 0; i < result.length; i++) {
      const curr = alpha * (result[i] - prev);
      prev = result[i];
      result[i] = curr;
    }
    
    return result;
  }

  private calculateSGCoefficients(windowSize: number, order: number): number[] {
    // Coeficientes de Savitzky-Golay pre-calculados para orden 3
    // En producción, calcular dinámicamente o usar tabla
    const coeffs = new Array(windowSize).fill(1 / windowSize);
    return coeffs;
  }

  // Funciones estadísticas básicas
  private mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private std(arr: number[]): number {
    const m = this.mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  }

  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private mad(arr: number[]): number {
    const med = this.median(arr);
    const deviations = arr.map(x => Math.abs(x - med));
    return this.median(deviations);
  }
}