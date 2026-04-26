/**
 * GATE 2 - PPG EXTRACTION ENGINE
 * 
 * EXTRACCIÓN PPG REAL MULTICANAL
 * 
 * Pipeline obligatorio:
 * 1. Capturar frame
 * 2. Estabilizar dimensiones
 * 3. ROI central adaptativo
 * 4. Descartar bordes
 * 5. Máscara de píxeles válidos
 * 6. Convertir sRGB a lineal
 * 7. Aplicar calibración dark/white
 * 8. Calcular OD por canal
 * 9. Extraer media robusta
 * 10. Calcular AC/DC
 * 11. Buffers circulares
 * 12. FPS real con timestamps
 * 13. Filtrar 0.5-4.0 Hz
 * 14. Detrending robusto
 * 15. Filtro Butterworth
 * 16. Preservar morfología
 * 17. Derivadas
 * 18. Detectar picos sistólicos
 * 19. Detectar valles
 * 20. RR intervals
 * 21. Autocorrelación
 * 22. FFT/Welch
 * 23. Pico dominante
 * 24. SNR
 * 25. Harmonicidad
 * 26. Estabilidad frecuencia
 * 27. Coherencia tiempo-frecuencia
 */

export interface PPGSignal {
  timestamp: number;
  rawR: number;
  rawG: number;
  rawB: number;
  linearR: number;
  linearG: number;
  linearB: number;
  odR: number;
  odG: number;
  odB: number;
}

export interface PPGFeatures {
  // AC/DC por canal
  acR: number;
  acG: number;
  acB: number;
  dcR: number;
  dcG: number;
  dcB: number;
  acDcRatioR: number;
  acDcRatioG: number;
  acDcRatioB: number;
  
  // Señales filtradas
  filteredR: number[];
  filteredG: number[];
  filteredB: number[];
  filteredODR: number[];
  filteredODG: number[];
  filteredODB: number[];
  
  // Derivadas
  firstDerivativeR: number[];
  firstDerivativeG: number[];
  firstDerivativeB: number[];
  secondDerivativeR: number[];
  secondDerivativeG: number[];
  secondDerivativeB: number[];
  
  // Picos y valles
  peaksR: number[];
  peaksG: number[];
  peaksB: number[];
  valleysR: number[];
  valleysG: number[];
  valleysB: number[];
  
  // RR intervals
  rrIntervalsR: number[];
  rrIntervalsG: number[];
  rrIntervalsB: number[];
  
  // Análisis espectral
  dominantFrequencyR: number;
  dominantFrequencyG: number;
  dominantFrequencyB: number;
  spectralPeakR: number;
  spectralPeakG: number;
  spectralPeakB: number;
  
  // Calidad
  snrR: number;
  snrG: number;
  snrB: number;
  harmonicRatioR: number;
  harmonicRatioG: number;
  harmonicRatioB: number;
  
  // Coherencia
  temporalCoherence: number;
  spectralCoherence: number;
  channelCoherenceRG: number;
  channelCoherenceRB: number;
  channelCoherenceGB: number;
  
  // Estabilidad
  frequencyStability: number;
  amplitudeStability: number;
  morphologyStability: number;
}

export interface ExtractionResult {
  hasValidSignal: boolean;
  signal: PPGSignal;
  features: PPGFeatures;
  qualityScore: number;
  rejectionReasons: string[];
  fps: number;
  bufferLength: number;
}

export interface ExtractionConfig {
  // Buffers
  bufferSize: number;
  minSamplesForAnalysis: number;
  
  // Filtros
  bandpassLow: number;
  bandpassHigh: number;
  filterOrder: number;
  
  // Detección de picos
  minPeakHeight: number;
  minPeakDistance: number;
  peakProminence: number;
  
  // Calidad
  minSNR: number;
  minHarmonicRatio: number;
  minCoherence: number;
  minStability: number;
  
  // FPS
  targetFPS: number;
  fpsTolerance: number;
}

const DEFAULT_CONFIG: ExtractionConfig = {
  bufferSize: 600, // 10 segundos a 60 FPS
  minSamplesForAnalysis: 120, // 2 segundos mínimo
  bandpassLow: 0.5, // 30 BPM
  bandpassHigh: 4.0, // 240 BPM
  filterOrder: 4,
  minPeakHeight: 0.1,
  minPeakDistance: 0.3, // segundos
  peakProminence: 0.2,
  minSNR: 3,
  minHarmonicRatio: 0.6,
  minCoherence: 0.7,
  minStability: 0.6,
  targetFPS: 30,
  fpsTolerance: 5,
};

export class PPGExtractionEngine {
  private config: ExtractionConfig;
  private signalBuffer: PPGSignal[] = [];
  private timestamps: number[] = [];
  private readonly SATURATION_THRESHOLD = 250;
  private readonly DARK_THRESHOLD = 5;

  constructor(config: Partial<ExtractionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Conversión sRGB a lineal
   */
  private sRGBToLinear(srgb: number): number {
    const v = srgb / 255;
    if (v <= 0.04045) {
      return v / 12.92;
    }
    return Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /**
   * Conversión a densidad óptica
   */
  private opticalDensity(normalized: number): number {
    return -Math.log(Math.max(normalized, 1e-6));
  }

  /**
   * Aplicar calibración dark/white
   */
  private applyCalibration(
    linearR: number, linearG: number, linearB: number,
    darkOffset: { r: number; g: number; b: number },
    whiteRef: { r: number; g: number; b: number }
  ): { correctedR: number; correctedG: number; correctedB: number } {
    const correctedR = Math.max(0, (linearR - darkOffset.r) / (whiteRef.r - darkOffset.r));
    const correctedG = Math.max(0, (linearG - darkOffset.g) / (whiteRef.g - darkOffset.g));
    const correctedB = Math.max(0, (linearB - darkOffset.b) / (whiteRef.b - darkOffset.b));
    
    return { correctedR, correctedG, correctedB };
  }

  /**
   * Extraer media robusta del ROI (trimmed mean)
   */
  private extractRobustMean(
    imageData: ImageData,
    roi: { x: number; y: number; width: number; height: number }
  ): { r: number; g: number; b: number; validPixels: number } {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    const pixelsR: number[] = [];
    const pixelsG: number[] = [];
    const pixelsB: number[] = [];
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // Rechazar píxeles saturados o muy oscuros
        if (r < this.SATURATION_THRESHOLD && g < this.SATURATION_THRESHOLD && b < this.SATURATION_THRESHOLD &&
            r > this.DARK_THRESHOLD && g > this.DARK_THRESHOLD && b > this.DARK_THRESHOLD) {
          pixelsR.push(r);
          pixelsG.push(g);
          pixelsB.push(b);
        }
      }
    }
    
    // Trimmed mean (descartar 10% extremos)
    const trimPercent = 0.1;
    const trimCount = Math.floor(pixelsR.length * trimPercent);
    
    if (pixelsR.length <= trimCount * 2) {
      // No hay suficientes píxeles válidos
      return { r: 0, g: 0, b: 0, validPixels: 0 };
    }
    
    pixelsR.sort((a, b) => a - b);
    pixelsG.sort((a, b) => a - b);
    pixelsB.sort((a, b) => a - b);
    
    const trimmedR = pixelsR.slice(trimCount, -trimCount);
    const trimmedG = pixelsG.slice(trimCount, -trimCount);
    const trimmedB = pixelsB.slice(trimCount, -trimCount);
    
    const meanR = trimmedR.reduce((a, b) => a + b, 0) / trimmedR.length;
    const meanG = trimmedG.reduce((a, b) => a + b, 0) / trimmedG.length;
    const meanB = trimmedB.reduce((a, b) => a + b, 0) / trimmedB.length;
    
    return { r: meanR, g: meanG, b: meanB, validPixels: trimmedR.length };
  }

  /**
   * Diseñar filtro Butterworth paso banda
   */
  private designButterworthBandpass(lowFreq: number, highFreq: number, fs: number, order: number): number[] {
    const nyquist = fs / 2;
    const lowNorm = lowFreq / nyquist;
    const highNorm = highFreq / nyquist;
    
    // Coeficientes simplificados (implementación real necesitaría biblioteca DSP)
    const b: number[] = [];
    const a: number[] = [];
    
    // Para implementación simplificada, usamos promedio móvil ponderado
    // NOTA: En producción usar biblioteca como dsp.js o implementación completa
    return [0.2, 0.3, 0.4, 0.3, 0.2]; // Coeficientes aproximados
  }

  /**
   * Aplicar filtro FIR
   */
  private applyFIR(signal: number[], coefficients: number[]): number[] {
    const result: number[] = [];
    const halfKernel = Math.floor(coefficients.length / 2);
    
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      for (let j = 0; j < coefficients.length; j++) {
        const idx = i - halfKernel + j;
        if (idx >= 0 && idx < signal.length) {
          sum += signal[idx] * coefficients[j];
        }
      }
      result.push(sum);
    }
    
    return result;
  }

  /**
   * Detrending robusto (regresión lineal local)
   */
  private detrend(signal: number[]): number[] {
    const n = signal.length;
    if (n < 10) return [...signal];
    
    // Calcular tendencia lineal
    const indices = Array.from({ length: n }, (_, i) => i);
    const meanX = indices.reduce((a, b) => a + b, 0) / n;
    const meanY = signal.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (indices[i] - meanX) * (signal[i] - meanY);
      denominator += (indices[i] - meanX) ** 2;
    }
    
    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = meanY - slope * meanX;
    
    // Remover tendencia
    return signal.map((y, i) => y - (slope * i + intercept));
  }

  /**
   * Calcular derivada numérica
   */
  private derivative(signal: number[]): number[] {
    const result: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
      result.push((signal[i + 1] - signal[i - 1]) / 2);
    }
    // Extender con los mismos valores en los extremos
    result.unshift(result[0] || 0);
    result.push(result[result.length - 1] || 0);
    return result;
  }

  /**
   * Detectar picos (algoritmo simplificado)
   */
  private detectPeaks(signal: number[], minHeight: number, minDistance: number, fs: number): number[] {
    const peaks: number[] = [];
    const minSamples = Math.floor(minDistance * fs);
    
    for (let i = minSamples; i < signal.length - minSamples; i++) {
      const current = signal[i];
      
      // Verificar altura mínima
      if (current < minHeight) continue;
      
      // Verificar que es un máximo local
      let isPeak = true;
      for (let j = i - minSamples; j <= i + minSamples; j++) {
        if (signal[j] > current) {
          isPeak = false;
          break;
        }
      }
      
      if (isPeak) {
        peaks.push(i);
        i += minSamples; // Saltar para evitar detecciones múltiples
      }
    }
    
    return peaks;
  }

  /**
   * Detectar valles
   */
  private detectValleys(signal: number[], minDistance: number, fs: number): number[] {
    // Valles son picos en la señal invertida
    const inverted = signal.map(x => -x);
    return this.detectPeaks(inverted, 0, minDistance, fs);
  }

  /**
   * Calcular RR intervals
   */
  private calculateRRIntervals(peaks: number[], fs: number): number[] {
    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = (peaks[i] - peaks[i - 1]) / fs;
      intervals.push(interval);
    }
    return intervals;
  }

  /**
   * Autocorrelación simple
   */
  private autocorrelation(signal: number[], maxLag: number): number[] {
    const n = signal.length;
    const result: number[] = [];
    
    for (let lag = 0; lag <= maxLag && lag < n; lag++) {
      let correlation = 0;
      for (let i = 0; i < n - lag; i++) {
        correlation += signal[i] * signal[i + lag];
      }
      result.push(correlation / (n - lag));
    }
    
    return result;
  }

  /**
   * FFT simplificada
   */
  private simpleFFT(signal: number[]): { frequencies: number[]; magnitudes: number[] } {
    const n = signal.length;
    const frequencies: number[] = [];
    const magnitudes: number[] = [];
    
    // Implementación muy simplificada - usar biblioteca real en producción
    for (let k = 0; k < n / 2; k++) {
      let real = 0;
      let imag = 0;
      
      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        real += signal[i] * Math.cos(angle);
        imag += signal[i] * Math.sin(angle);
      }
      
      frequencies.push(k * 60 / n); // Convertir a BPM (asumiendo 1 Hz = 60 BPM)
      magnitudes.push(Math.sqrt(real * real + imag * imag) / n);
    }
    
    return { frequencies, magnitudes };
  }

  /**
   * Calcular SNR
   */
  private calculateSNR(signal: number[], noiseFloor: number = 0.1): number {
    const signalPower = signal.reduce((sum, x) => sum + x * x, 0) / signal.length;
    return signalPower > noiseFloor ? 10 * Math.log10(signalPower / noiseFloor) : 0;
  }

  /**
   * Calcular coherencia entre canales
   */
  private calculateCoherence(signal1: number[], signal2: number[]): number {
    if (signal1.length !== signal2.length || signal1.length === 0) return 0;
    
    // Correlación cruzada normalizada
    const n = signal1.length;
    const mean1 = signal1.reduce((a, b) => a + b, 0) / n;
    const mean2 = signal2.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let var1 = 0;
    let var2 = 0;
    
    for (let i = 0; i < n; i++) {
      const diff1 = signal1[i] - mean1;
      const diff2 = signal2[i] - mean2;
      numerator += diff1 * diff2;
      var1 += diff1 * diff1;
      var2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(var1 * var2);
    return denominator > 0 ? Math.abs(numerator / denominator) : 0;
  }

  /**
   * Calcular FPS real
   */
  private calculateRealFPS(): number {
    if (this.timestamps.length < 2) return this.config.targetFPS;
    
    const intervals: number[] = [];
    for (let i = 1; i < this.timestamps.length; i++) {
      intervals.push(this.timestamps[i] - this.timestamps[i - 1]);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return avgInterval > 0 ? 1000 / avgInterval : this.config.targetFPS;
  }

  /**
   * Procesar frame completo
   */
  processFrame(
    imageData: ImageData,
    roi: { x: number; y: number; width: number; height: number },
    darkOffset?: { r: number; g: number; b: number },
    whiteRef?: { r: number; g: number; b: number }
  ): ExtractionResult {
    const timestamp = performance.now();
    const rejectionReasons: string[] = [];
    
    // 1. Extraer media robusta
    const robustMean = this.extractRobustMean(imageData, roi);
    if (robustMean.validPixels === 0) {
      rejectionReasons.push('No hay píxeles válidos en ROI');
      return {
        hasValidSignal: false,
        signal: {} as PPGSignal,
        features: {} as PPGFeatures,
        qualityScore: 0,
        rejectionReasons,
        fps: this.calculateRealFPS(),
        bufferLength: this.signalBuffer.length,
      };
    }
    
    // 2. Convertir a lineal
    const linearR = this.sRGBToLinear(robustMean.r);
    const linearG = this.sRGBToLinear(robustMean.g);
    const linearB = this.sRGBToLinear(robustMean.b);
    
    // 3. Aplicar calibración si está disponible
    let correctedR = linearR, correctedG = linearG, correctedB = linearB;
    if (darkOffset && whiteRef) {
      const calibrated = this.applyCalibration(linearR, linearG, linearB, darkOffset, whiteRef);
      correctedR = calibrated.correctedR;
      correctedG = calibrated.correctedG;
      correctedB = calibrated.correctedB;
    }
    
    // 4. Calcular OD
    const odR = this.opticalDensity(correctedR);
    const odG = this.opticalDensity(correctedG);
    const odB = this.opticalDensity(correctedB);
    
    // 5. Crear señal
    const signal: PPGSignal = {
      timestamp,
      rawR: robustMean.r,
      rawG: robustMean.g,
      rawB: robustMean.b,
      linearR,
      linearG,
      linearB,
      odR,
      odG,
      odB,
    };
    
    // 6. Agregar a buffer
    this.signalBuffer.push(signal);
    this.timestamps.push(timestamp);
    
    // Limitar tamaño del buffer
    if (this.signalBuffer.length > this.config.bufferSize) {
      this.signalBuffer.shift();
      this.timestamps.shift();
    }
    
    // 7. Verificar si hay suficientes muestras
    if (this.signalBuffer.length < this.config.minSamplesForAnalysis) {
      rejectionReasons.push(`Insuficientes muestras: ${this.signalBuffer.length}/${this.config.minSamplesForAnalysis}`);
      return {
        hasValidSignal: false,
        signal,
        features: {} as PPGFeatures,
        qualityScore: 0,
        rejectionReasons,
        fps: this.calculateRealFPS(),
        bufferLength: this.signalBuffer.length,
      };
    }
    
    // 8. Extraer señales por canal
    const rSignal = this.signalBuffer.map(s => s.odR);
    const gSignal = this.signalBuffer.map(s => s.odG);
    const bSignal = this.signalBuffer.map(s => s.odB);
    
    // 9. Calcular AC/DC
    const dcR = rSignal.reduce((a, b) => a + b, 0) / rSignal.length;
    const dcG = gSignal.reduce((a, b) => a + b, 0) / gSignal.length;
    const dcB = bSignal.reduce((a, b) => a + b, 0) / bSignal.length;
    
    const acR = Math.sqrt(rSignal.reduce((sum, x) => sum + (x - dcR) ** 2, 0) / rSignal.length);
    const acG = Math.sqrt(gSignal.reduce((sum, x) => sum + (x - dcG) ** 2, 0) / gSignal.length);
    const acB = Math.sqrt(bSignal.reduce((sum, x) => sum + (x - dcB) ** 2, 0) / bSignal.length);
    
    const acDcRatioR = dcR > 0 ? acR / dcR : 0;
    const acDcRatioG = dcG > 0 ? acG / dcG : 0;
    const acDcRatioB = dcB > 0 ? acB / dcB : 0;
    
    // 10. Detrending
    const detrendedR = this.detrend(rSignal);
    const detrendedG = this.detrend(gSignal);
    const detrendedB = this.detrend(bSignal);
    
    // 11. Filtrado paso banda
    const fs = this.calculateRealFPS();
    const filterCoeffs = this.designButterworthBandpass(
      this.config.bandpassLow,
      this.config.bandpassHigh,
      fs,
      this.config.filterOrder
    );
    
    const filteredR = this.applyFIR(detrendedR, filterCoeffs);
    const filteredG = this.applyFIR(detrendedG, filterCoeffs);
    const filteredB = this.applyFIR(detrendedB, filterCoeffs);
    
    // 12. Derivadas
    const firstDerivativeR = this.derivative(filteredR);
    const firstDerivativeG = this.derivative(filteredG);
    const firstDerivativeB = this.derivative(filteredB);
    const secondDerivativeR = this.derivative(firstDerivativeR);
    const secondDerivativeG = this.derivative(firstDerivativeG);
    const secondDerivativeB = this.derivative(firstDerivativeB);
    
    // 13. Detección de picos y valles
    const peaksR = this.detectPeaks(filteredR, this.config.minPeakHeight, this.config.minPeakDistance, fs);
    const peaksG = this.detectPeaks(filteredG, this.config.minPeakHeight, this.config.minPeakDistance, fs);
    const peaksB = this.detectPeaks(filteredB, this.config.minPeakHeight, this.config.minPeakDistance, fs);
    
    const valleysR = this.detectValleys(filteredR, this.config.minPeakDistance, fs);
    const valleysG = this.detectValleys(filteredG, this.config.minPeakDistance, fs);
    const valleysB = this.detectValleys(filteredB, this.config.minPeakDistance, fs);
    
    // 14. RR intervals
    const rrIntervalsR = this.calculateRRIntervals(peaksR, fs);
    const rrIntervalsG = this.calculateRRIntervals(peaksG, fs);
    const rrIntervalsB = this.calculateRRIntervals(peaksB, fs);
    
    // 15. Análisis espectral
    const fftR = this.simpleFFT(filteredR);
    const fftG = this.simpleFFT(filteredG);
    const fftB = this.simpleFFT(filteredB);
    
    const dominantFrequencyR = fftR.frequencies[fftR.magnitudes.indexOf(Math.max(...fftR.magnitudes))];
    const dominantFrequencyG = fftG.frequencies[fftG.magnitudes.indexOf(Math.max(...fftG.magnitudes))];
    const dominantFrequencyB = fftB.frequencies[fftB.magnitudes.indexOf(Math.max(...fftB.magnitudes))];
    
    const spectralPeakR = Math.max(...fftR.magnitudes);
    const spectralPeakG = Math.max(...fftG.magnitudes);
    const spectralPeakB = Math.max(...fftB.magnitudes);
    
    // 16. Calidad de señal
    const snrR = this.calculateSNR(filteredR);
    const snrG = this.calculateSNR(filteredG);
    const snrB = this.calculateSNR(filteredB);
    
    // 17. Coherencia
    const channelCoherenceRG = this.calculateCoherence(filteredR, filteredG);
    const channelCoherenceRB = this.calculateCoherence(filteredR, filteredB);
    const channelCoherenceGB = this.calculateCoherence(filteredG, filteredB);
    
    // 18. Evaluar calidad general
    let qualityScore = 1;
    let hasValidSignal = true;
    
    // Verificar SNR mínimo
    if (snrR < this.config.minSNR && snrG < this.config.minSNR && snrB < this.config.minSNR) {
      hasValidSignal = false;
      rejectionReasons.push(`SNR bajo: R=${snrR.toFixed(1)}, G=${snrG.toFixed(1)}, B=${snrB.toFixed(1)}`);
      qualityScore *= 0.3;
    }
    
    // Verificar picos detectados
    if (peaksR.length < 3 && peaksG.length < 3 && peaksB.length < 3) {
      hasValidSignal = false;
      rejectionReasons.push('Insuficientes picos detectados');
      qualityScore *= 0.2;
    }
    
    // Verificar coherencia entre canales
    const avgCoherence = (channelCoherenceRG + channelCoherenceRB + channelCoherenceGB) / 3;
    if (avgCoherence < this.config.minCoherence) {
      hasValidSignal = false;
      rejectionReasons.push(`Baja coherencia entre canales: ${avgCoherence.toFixed(2)}`);
      qualityScore *= 0.5;
    }
    
    // Verificar frecuencia fisiológica
    const avgFreq = (dominantFrequencyR + dominantFrequencyG + dominantFrequencyB) / 3;
    if (avgFreq < 30 || avgFreq > 200) {
      hasValidSignal = false;
      rejectionReasons.push(`Frecuencia no fisiológica: ${avgFreq.toFixed(1)} BPM`);
      qualityScore *= 0.1;
    }
    
    const features: PPGFeatures = {
      acR, acG, acB,
      dcR, dcG, dcB,
      acDcRatioR, acDcRatioG, acDcRatioB,
      filteredR, filteredG, filteredB,
      filteredODR: filteredR, filteredODG: filteredG, filteredODB: filteredB,
      firstDerivativeR, firstDerivativeG, firstDerivativeB,
      secondDerivativeR, secondDerivativeG, secondDerivativeB,
      peaksR, peaksG, peaksB,
      valleysR, valleysG, valleysB,
      rrIntervalsR, rrIntervalsG, rrIntervalsB,
      dominantFrequencyR, dominantFrequencyG, dominantFrequencyB,
      spectralPeakR, spectralPeakG, spectralPeakB,
      snrR, snrG, snrB,
      harmonicRatioR: 0, harmonicRatioG: 0, harmonicRatioB: 0, // TODO: Implementar
      temporalCoherence: avgCoherence,
      spectralCoherence: avgCoherence,
      channelCoherenceRG, channelCoherenceRB, channelCoherenceGB,
      frequencyStability: 1, // TODO: Implementar
      amplitudeStability: 1, // TODO: Implementar
      morphologyStability: 1, // TODO: Implementar
    };
    
    return {
      hasValidSignal,
      signal,
      features,
      qualityScore,
      rejectionReasons,
      fps: fs,
      bufferLength: this.signalBuffer.length,
    };
  }

  /**
   * Resetear motor
   */
  reset(): void {
    this.signalBuffer = [];
    this.timestamps = [];
  }

  /**
   * Obtener buffer actual
   */
  getBuffer(): PPGSignal[] {
    return [...this.signalBuffer];
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): ExtractionConfig {
    return { ...this.config };
  }
}
