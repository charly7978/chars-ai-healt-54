/**
 * Utilidades avanzadas para procesamiento de señales médicas
 * Basadas en algoritmos validados por investigación médica
 */

/**
 * Calcula la desviación estándar de un conjunto de valores
 */
export function calculateStandardDeviation(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sqDiffs = values.map((v) => Math.pow(v - mean, 2));
  const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(avgSqDiff);
}

/**
 * Calcula el coeficiente de variación (CV) para evaluar la variabilidad relativa
 */
export function calculateCoefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const stdDev = calculateStandardDeviation(values);
  return (stdDev / mean) * 100;
}

/**
 * Calcula la mediana de un conjunto de valores
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Calcula el rango intercuartil (IQR) para detectar valores atípicos
 */
export function calculateIQR(values: number[]): number {
  if (values.length < 4) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  return sorted[q3Index] - sorted[q1Index];
}

/**
 * Detecta valores atípicos usando el método IQR
 */
export function detectOutliers(values: number[]): number[] {
  const iqr = calculateIQR(values);
  const q1 = calculatePercentile(values, 25);
  const q3 = calculatePercentile(values, 75);
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  
  return values.filter(value => value < lowerBound || value > upperBound);
}

/**
 * Calcula el percentil especificado de un conjunto de valores
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  
  if (upper === lower) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Aplica filtro de mediana móvil para suavizar señales
 */
export function applyMedianFilter(values: number[], windowSize: number = 5): number[] {
  if (values.length < windowSize) return values;
  
  const result: number[] = [];
  const halfWindow = Math.floor(windowSize / 2);
  
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(values.length, i + halfWindow + 1);
    const window = values.slice(start, end);
    result.push(calculateMedian(window));
  }
  
  return result;
}

/**
 * Aplica filtro de media móvil exponencial (EMA)
 */
export function applyEMAFilter(values: number[], alpha: number = 0.3): number[] {
  if (values.length === 0) return values;
  
  const result: number[] = [values[0]];
  
  for (let i = 1; i < values.length; i++) {
    const ema = alpha * values[i] + (1 - alpha) * result[i - 1];
    result.push(ema);
  }
  
  return result;
}

/**
 * Calcula la correlación de Pearson entre dos conjuntos de valores
 */
export function calculatePearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, val, i) => acc + val * y[i], 0);
  const sumX2 = x.reduce((acc, val) => acc + val * val, 0);
  const sumY2 = y.reduce((acc, val) => acc + val * val, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Calcula la autocorrelación de una señal para detectar periodicidad
 */
export function calculateAutocorrelation(signal: number[], maxLag: number = 20): number[] {
  const n = signal.length;
  if (n === 0) return [];
  
  const autocorr: number[] = [];
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const variance = signal.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
  
  for (let lag = 0; lag <= Math.min(maxLag, n - 1); lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (signal[i] - mean) * (signal[i + lag] - mean);
    }
    autocorr.push(sum / ((n - lag) * variance));
  }
  
  return autocorr;
}

/**
 * Encuentra picos en una señal usando detección de máximos locales
 */
export function findPeaks(signal: number[], minPeakHeight?: number, minPeakDistance: number = 1): number[] {
  const peaks: number[] = [];
  
  for (let i = 1; i < signal.length - 1; i++) {
    const isPeak = signal[i] > signal[i - 1] && signal[i] > signal[i + 1];
    
    if (isPeak) {
      if (minPeakHeight === undefined || signal[i] >= minPeakHeight) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minPeakDistance) {
          peaks.push(i);
        }
      }
    }
  }
  
  return peaks;
}

/**
 * Calcula la frecuencia dominante de una señal usando FFT simplificada
 */
export function calculateDominantFrequency(signal: number[], samplingRate: number): number {
  if (signal.length < 32) return 0;
  
  // Implementación simplificada de FFT para encontrar la frecuencia dominante
  const n = signal.length;
  const frequencies: number[] = [];
  const magnitudes: number[] = [];
  
  for (let k = 0; k < n / 2; k++) {
    let real = 0;
    let imag = 0;
    
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * k * i) / n;
      real += signal[i] * Math.cos(angle);
      imag += signal[i] * Math.sin(angle);
    }
    
    const magnitude = Math.sqrt(real * real + imag * imag);
    frequencies.push((k * samplingRate) / n);
    magnitudes.push(magnitude);
  }
  
  // Encontrar la frecuencia con mayor magnitud
  const maxIndex = magnitudes.indexOf(Math.max(...magnitudes));
  return frequencies[maxIndex];
}

/**
 * Calcula la entropía de Shannon para evaluar la complejidad de la señal
 */
export function calculateShannonEntropy(values: number[], bins: number = 10): number {
  if (values.length === 0) return 0;
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binWidth = (max - min) / bins;
  
  if (binWidth === 0) return 0;
  
  const histogram = new Array(bins).fill(0);
  
  for (const value of values) {
    const binIndex = Math.min(Math.floor((value - min) / binWidth), bins - 1);
    histogram[binIndex]++;
  }
  
  let entropy = 0;
  const total = values.length;
  
  for (const count of histogram) {
    if (count > 0) {
      const probability = count / total;
      entropy -= probability * Math.log2(probability);
    }
  }
  
  return entropy;
}

/**
 * Calcula la entropía de muestra (Sample Entropy) para análisis de complejidad
 */
export function calculateSampleEntropy(values: number[], m: number = 2, r: number = 0.2): number {
  if (values.length < m + 2) return 0;
  
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const stdDev = calculateStandardDeviation(values);
  
  if (stdDev === 0) return 0;
  
  const normalizedValues = values.map(val => (val - mean) / stdDev);
  const rAdjusted = r * stdDev;
  
  let A = 0; // Coincidencias para secuencias de longitud m+1
  let B = 0; // Coincidencias para secuencias de longitud m
  
  for (let i = 0; i < n - m; i++) {
    for (let j = i + 1; j < n - m; j++) {
      let matchM = true;
      let matchMPlus1 = true;
      
      // Verificar patrones de longitud m
      for (let k = 0; k < m; k++) {
        if (Math.abs(normalizedValues[i + k] - normalizedValues[j + k]) > rAdjusted) {
          matchM = false;
          break;
        }
      }
      
      if (matchM) {
        B++;
        
        // Verificar patrones de longitud m+1
        if (i + m < n && j + m < n) {
          if (Math.abs(normalizedValues[i + m] - normalizedValues[j + m]) <= rAdjusted) {
            A++;
          }
        }
      }
    }
  }
  
  if (B === 0) return Infinity;
  if (A === 0) return -Infinity;
  
  return -Math.log(A / B);
}

/**
 * Calcula el índice de pulsatilidad (PI) para evaluar la calidad de la señal PPG
 */
export function calculatePulsatilityIndex(signal: number[]): number {
  if (signal.length < 10) return 0;
  
  const ac = Math.max(...signal) - Math.min(...signal);
  const dc = signal.reduce((a, b) => a + b, 0) / signal.length;
  
  return dc > 0 ? (ac / dc) * 100 : 0;
}

/**
 * Calcula el índice de perfusión (PI) usando componentes AC/DC
 */
export function calculatePerfusionIndex(ac: number, dc: number): number {
  return dc > 0 ? (ac / dc) * 100 : 0;
}

/**
 * Valida si un valor está dentro de un rango fisiológico
 */
export function isPhysiologicalRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Normaliza un valor a un rango específico
 */
export function normalizeValue(value: number, min: number, max: number, targetMin: number = 0, targetMax: number = 1): number {
  const normalized = (value - min) / (max - min);
  return targetMin + normalized * (targetMax - targetMin);
}

/**
 * Aplica suavizado temporal usando filtro de Kalman simplificado
 */
export function applyKalmanSmoothing(values: number[], processNoise: number = 0.1, measurementNoise: number = 1.0): number[] {
  if (values.length === 0) return values;
  
  const result: number[] = [];
  let estimate = values[0];
  let errorCovariance = 1.0;
  
  for (const measurement of values) {
    // Predicción
    const prediction = estimate;
    const predictionErrorCovariance = errorCovariance + processNoise;
    
    // Actualización
    const kalmanGain = predictionErrorCovariance / (predictionErrorCovariance + measurementNoise);
    estimate = prediction + kalmanGain * (measurement - prediction);
    errorCovariance = (1 - kalmanGain) * predictionErrorCovariance;
    
    result.push(estimate);
  }
  
  return result;
}

/**
 * Calcula la calidad de señal basada en múltiples métricas
 */
export function calculateSignalQuality(signal: number[]): number {
  if (signal.length < 10) return 0;
  
  // SNR
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const stdDev = calculateStandardDeviation(signal);
  const snr = stdDev > 0 ? mean / stdDev : 0;
  
  // Estabilidad temporal
  const differences = [];
  for (let i = 1; i < signal.length; i++) {
    differences.push(Math.abs(signal[i] - signal[i-1]));
  }
  const avgDifference = differences.reduce((a, b) => a + b, 0) / differences.length;
  const maxDifference = Math.max(...differences);
  const stability = maxDifference > 0 ? 1 - (avgDifference / maxDifference) : 1;
  
  // Pulsatilidad
  const pulsatility = calculatePulsatilityIndex(signal);
  const normalizedPulsatility = Math.min(1.0, pulsatility / 10);
  
  // Combinar métricas
  const quality = (Math.min(1.0, snr / 5) * 0.4) + (stability * 0.3) + (normalizedPulsatility * 0.3);
  
  return Math.max(0, Math.min(1, quality));
}
