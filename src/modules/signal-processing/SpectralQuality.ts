/**
 * SPECTRAL QUALITY - SQI espectral avanzado
 * 
 * Implementa Signal Quality Index basado en análisis espectral robusto:
 * - Welch PSD o equivalente liviano
 * - Frecuencia dominante en banda cardíaca
 * - Sharpness del pico espectral
 * - Razón armónica simple
 * - Potencia en banda / fuera de banda
 * - Estabilidad de frecuencia dominante entre ventanas
 * 
 * Liviano pero preciso, optimizado para procesamiento en tiempo real.
 */

export interface SpectralQualityMetrics {
  // Métricas principales
  sqi: number;                    // Signal Quality Index (0-1)
  dominantFrequency: number;      // Hz
  peakSharpness: number;          // Sharpness del pico dominante
  bandPowerRatio: number;         // Potencia banda cardíaca / total
  harmonicRatio: number;          // Razón armónica fundamental
  
  // Métricas secundarias
  totalPower: number;             // Potencia total
  signalToNoise: number;          // SNR estimado
  frequencyStability: number;     // Estabilidad freq entre ventanas
  
  // Información espectral
  spectralCentroid: number;       // Centroide espectral
  spectralSpread: number;         // Dispersión espectral
  spectralFlatness: number;       // Planitud espectral
  
  // Metadatos
  windowSize: number;
  sampleRate: number;
  confidence: number;
  lastUpdate: number;
}

export interface SpectralQualityConfig {
  sampleRate: number;
  windowSize: number;
  cardiacBandMin: number;         // Hz
  cardiacBandMax: number;         // Hz
  minPowerThreshold: number;
  frequencyTolerance: number;     // Hz para estabilidad
  eps: number;
}

export class SpectralQuality {
  private config: SpectralQualityConfig;
  private previousMetrics: SpectralQualityMetrics | null = null;
  private fftCache: {
    real: Float64Array;
    imag: Float64Array;
    magnitude: Float64Array;
    frequency: Float64Array;
  } | null = null;
  
  constructor(config: Partial<SpectralQualityConfig> = {}) {
    this.config = {
      sampleRate: 30,
      windowSize: 256,
      cardiacBandMin: 0.8,
      cardiacBandMax: 3.0,
      minPowerThreshold: 1e-6,
      frequencyTolerance: 0.2,
      eps: 1e-10,
      ...config
    };
    
    this.initializeFFTCache();
  }

  /**
   * Calcular SQI espectral completo
   */
  public calculate(signal: Float64Array): SpectralQualityMetrics {
    if (signal.length < this.config.windowSize) {
      return this.createEmptyMetrics(signal.length);
    }

    // Preparar ventana
    const windowedSignal = this.applyWindow(signal.slice(0, this.config.windowSize));
    
    // Calcular PSD
    const psd = this.calculateWelchPSD(windowedSignal);
    if (!psd) {
      return this.createEmptyMetrics(signal.length);
    }

    // Encontrar frecuencia dominante
    const dominantFreq = this.findDominantFrequency(psd);
    
    // Calcular métricas principales
    const bandPowerRatio = this.calculateBandPowerRatio(psd);
    const peakSharpness = this.calculatePeakSharpness(psd, dominantFreq);
    const harmonicRatio = this.calculateHarmonicRatio(psd, dominantFreq);
    
    // Calcular métricas secundarias
    const totalPower = psd.reduce((sum, val) => sum + val, 0);
    const signalToNoise = this.calculateSNR(psd, dominantFreq);
    const frequencyStability = this.calculateFrequencyStability(dominantFreq);
    
    // Métricas espectrales adicionales
    const spectralCentroid = this.calculateSpectralCentroid(psd);
    const spectralSpread = this.calculateSpectralSpread(psd, spectralCentroid);
    const spectralFlatness = this.calculateSpectralFlatness(psd);
    
    // SQI combinado
    const sqi = this.calculateCombinedSQI({
      bandPowerRatio,
      peakSharpness,
      harmonicRatio,
      signalToNoise,
      frequencyStability,
      spectralFlatness
    });

    const metrics: SpectralQualityMetrics = {
      sqi,
      dominantFrequency: dominantFreq,
      peakSharpness,
      bandPowerRatio,
      harmonicRatio,
      totalPower,
      signalToNoise,
      frequencyStability,
      spectralCentroid,
      spectralSpread,
      spectralFlatness,
      windowSize: signal.length,
      sampleRate: this.config.sampleRate,
      confidence: this.calculateConfidence(sqi, totalPower),
      lastUpdate: performance.now()
    };

    // Guardar para próxima iteración
    this.previousMetrics = metrics;
    
    return metrics;
  }

  /**
   * Aplicar ventana Hamming para reducir leakage
   */
  private applyWindow(signal: Float64Array): Float64Array {
    const n = signal.length;
    const windowed = new Float64Array(n);
    
    for (let i = 0; i < n; i++) {
      // Ventana Hamming: 0.54 - 0.46 * cos(2πi/(n-1))
      const hamming = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
      windowed[i] = signal[i] * hamming;
    }
    
    return windowed;
  }

  /**
   * Calcular PSD usando método Welch simplificado
   */
  private calculateWelchPSD(signal: Float64Array): Float64Array | null {
    if (!this.fftCache) return null;
    
    const { real, imag, magnitude, frequency } = this.fftCache;
    const n = signal.length;
    
    // Zero-padding si es necesario
    const paddedSignal = new Float64Array(n);
    for (let i = 0; i < Math.min(n, signal.length); i++) {
      paddedSignal[i] = signal[i];
    }

    // FFT
    this.computeFFT(paddedSignal, real, imag);
    
    // Calcular magnitud al cuadrado (PSD)
    for (let i = 0; i < n; i++) {
      magnitude[i] = (real[i] * real[i] + imag[i] * imag[i]) / (n * n);
    }
    
    // Normalizar PSD
    const totalPower = magnitude.reduce((sum, val) => sum + val, 0);
    if (totalPower > this.config.eps) {
      for (let i = 0; i < n; i++) {
        magnitude[i] /= totalPower;
      }
    }
    
    return magnitude;
  }

  /**
   * FFT in-place optimizado (Cooley-Tukey radix-2)
   */
  private computeFFT(signal: Float64Array, real: Float64Array, imag: Float64Array): void {
    const n = signal.length;
    
    // Verificar que n sea potencia de 2
    if ((n & (n - 1)) !== 0) {
      throw new Error('FFT length must be power of 2');
    }

    // Copiar señal
    for (let i = 0; i < n; i++) {
      real[i] = signal[i];
      imag[i] = 0;
    }

    // Bit reversal
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      
      if (i < j) {
        const tempReal = real[i];
        const tempImag = imag[i];
        real[i] = real[j];
        imag[i] = imag[j];
        real[j] = tempReal;
        imag[j] = tempImag;
      }
    }

    // FFT principal
    for (let len = 2; len <= n; len <<= 1) {
      const angle = -2 * Math.PI / len;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);
      
      for (let i = 0; i < n; i += len) {
        let wr = 1;
        let wi = 0;
        
        for (let j = 0; j < len / 2; j++) {
          const u = i + j;
          const v = i + j + len / 2;
          
          const tr = wr * real[v] - wi * imag[v];
          const ti = wr * imag[v] + wi * real[v];
          
          real[v] = real[u] - tr;
          imag[v] = imag[u] - ti;
          real[u] += tr;
          imag[u] += ti;
          
          const nextWr = wr * wReal - wi * wImag;
          wi = wr * wImag + wi * wReal;
          wr = nextWr;
        }
      }
    }
  }

  /**
   * Encontrar frecuencia dominante en banda cardíaca
   */
  private findDominantFrequency(psd: Float64Array): number {
    const n = psd.length;
    const freqResolution = this.config.sampleRate / n;
    
    // Encontrar pico en banda cardíaca
    const startBin = Math.floor(this.config.cardiacBandMin / freqResolution);
    const endBin = Math.ceil(this.config.cardiacBandMax / freqResolution);
    
    let maxPower = 0;
    let dominantBin = startBin;
    
    for (let i = startBin; i <= endBin && i < n / 2; i++) {
      if (psd[i] > maxPower) {
        maxPower = psd[i];
        dominantBin = i;
      }
    }
    
    // Interpolación parabólica para mejor precisión
    if (dominantBin > 0 && dominantBin < n / 2 - 1) {
      const y1 = psd[dominantBin - 1];
      const y2 = psd[dominantBin];
      const y3 = psd[dominantBin + 1];
      
      const delta = 0.5 * (y1 - y3) / (y1 - 2 * y2 + y3 + this.config.eps);
      dominantBin += delta;
    }
    
    return dominantBin * freqResolution;
  }

  /**
   * Calcular razón de potencia en banda cardíaca
   */
  private calculateBandPowerRatio(psd: Float64Array): number {
    const n = psd.length;
    const freqResolution = this.config.sampleRate / n;
    
    const startBin = Math.floor(this.config.cardiacBandMin / freqResolution);
    const endBin = Math.ceil(this.config.cardiacBandMax / freqResolution);
    
    let bandPower = 0;
    let totalPower = 0;
    
    for (let i = 1; i < n / 2; i++) {
      totalPower += psd[i];
      if (i >= startBin && i <= endBin) {
        bandPower += psd[i];
      }
    }
    
    return totalPower > this.config.eps ? bandPower / totalPower : 0;
  }

  /**
   * Calcular sharpness del pico dominante
   */
  private calculatePeakSharpness(psd: Float64Array, dominantFreq: number): number {
    const n = psd.length;
    const freqResolution = this.config.sampleRate / n;
    const dominantBin = Math.round(dominantFreq / freqResolution);
    
    if (dominantBin < 1 || dominantBin >= n / 2 - 1) {
      return 0;
    }
    
    // Calcular sharpness como ratio pico / vecindario
    const peakPower = psd[dominantBin];
    const neighborhoodPower = psd[dominantBin - 1] + psd[dominantBin + 1];
    
    return neighborhoodPower > this.config.eps ? peakPower / neighborhoodPower : 0;
  }

  /**
   * Calcular razón armónica (fundamental vs armónicos)
   */
  private calculateHarmonicRatio(psd: Float64Array, fundamentalFreq: number): number {
    const n = psd.length;
    const freqResolution = this.config.sampleRate / n;
    
    // Encontrar potencias en fundamental y primeros armónicos
    const fundamentalBin = Math.round(fundamentalFreq / freqResolution);
    const harmonic1Bin = Math.round(2 * fundamentalFreq / freqResolution);
    const harmonic2Bin = Math.round(3 * fundamentalFreq / freqResolution);
    
    let fundamentalPower = 0;
    let harmonicPower = 0;
    
    if (fundamentalBin > 0 && fundamentalBin < n / 2) {
      fundamentalPower = psd[fundamentalBin];
    }
    
    if (harmonic1Bin > 0 && harmonic1Bin < n / 2) {
      harmonicPower += psd[harmonic1Bin];
    }
    
    if (harmonic2Bin > 0 && harmonic2Bin < n / 2) {
      harmonicPower += psd[harmonic2Bin];
    }
    
    return fundamentalPower > this.config.eps ? harmonicPower / fundamentalPower : 0;
  }

  /**
   * Calcular SNR estimado
   */
  private calculateSNR(psd: Float64Array, dominantFreq: number): number {
    const n = psd.length;
    const freqResolution = this.config.sampleRate / n;
    
    const dominantBin = Math.round(dominantFreq / freqResolution);
    const signalBandwidth = 0.2; // Hz alrededor de la frecuencia dominante
    const signalBins = Math.ceil(signalBandwidth / freqResolution);
    
    let signalPower = 0;
    let noisePower = 0;
    
    for (let i = 1; i < n / 2; i++) {
      const freq = i * freqResolution;
      
      if (Math.abs(freq - dominantFreq) <= signalBandwidth) {
        signalPower += psd[i];
      } else {
        noisePower += psd[i];
      }
    }
    
    return noisePower > this.config.eps ? signalPower / noisePower : 0;
  }

  /**
   * Calcular estabilidad de frecuencia entre ventanas
   */
  private calculateFrequencyStability(currentFreq: number): number {
    if (!this.previousMetrics) {
      return 0.5; // Neutral para primera ventana
    }
    
    const freqDiff = Math.abs(currentFreq - this.previousMetrics.dominantFrequency);
    const stability = Math.max(0, 1 - freqDiff / this.config.frequencyTolerance);
    
    return stability;
  }

  /**
   * Calcular centroide espectral
   */
  private calculateSpectralCentroid(psd: Float64Array): number {
    const n = psd.length;
    const freqResolution = this.config.sampleRate / n;
    
    let weightedSum = 0;
    let totalPower = 0;
    
    for (let i = 1; i < n / 2; i++) {
      const freq = i * freqResolution;
      weightedSum += freq * psd[i];
      totalPower += psd[i];
    }
    
    return totalPower > this.config.eps ? weightedSum / totalPower : 0;
  }

  /**
   * Calcular dispersión espectral
   */
  private calculateSpectralSpread(psd: Float64Array, centroid: number): number {
    const n = psd.length;
    const freqResolution = this.config.sampleRate / n;
    
    let weightedVariance = 0;
    let totalPower = 0;
    
    for (let i = 1; i < n / 2; i++) {
      const freq = i * freqResolution;
      const deviation = freq - centroid;
      weightedVariance += deviation * deviation * psd[i];
      totalPower += psd[i];
    }
    
    return totalPower > this.config.eps ? Math.sqrt(weightedVariance / totalPower) : 0;
  }

  /**
   * Calcular planitud espectral (measures tonality vs noise)
   */
  private calculateSpectralFlatness(psd: Float64Array): number {
    const n = psd.length;
    
    let geometricMean = 0;
    let arithmeticMean = 0;
    
    for (let i = 1; i < n / 2; i++) {
      if (psd[i] > this.config.eps) {
        geometricMean += Math.log(psd[i]);
      }
      arithmeticMean += psd[i];
    }
    
    const count = n / 2 - 1;
    geometricMean = Math.exp(geometricMean / count);
    arithmeticMean /= count;
    
    return arithmeticMean > this.config.eps ? geometricMean / arithmeticMean : 0;
  }

  /**
   * Calcular SQI combinado
   */
  private calculateCombinedSQI(metrics: {
    bandPowerRatio: number;
    peakSharpness: number;
    harmonicRatio: number;
    signalToNoise: number;
    frequencyStability: number;
    spectralFlatness: number;
  }): number {
    const weights = {
      bandPowerRatio: 0.25,
      peakSharpness: 0.20,
      harmonicRatio: 0.15,
      signalToNoise: 0.20,
      frequencyStability: 0.10,
      spectralFlatness: 0.10
    };

    let sqi = 0;
    sqi += Math.min(1, metrics.bandPowerRatio) * weights.bandPowerRatio;
    sqi += Math.min(1, metrics.peakSharpness / 3) * weights.peakSharpness;
    sqi += Math.min(1, metrics.harmonicRatio) * weights.harmonicRatio;
    sqi += Math.min(1, metrics.signalToNoise / 10) * weights.signalToNoise;
    sqi += metrics.frequencyStability * weights.frequencyStability;
    sqi += (1 - Math.min(1, metrics.spectralFlatness)) * weights.spectralFlatness; // Invertido: menos planitud es mejor

    return Math.max(0, Math.min(1, sqi));
  }

  /**
   * Calcular confianza general
   */
  private calculateConfidence(sqi: number, totalPower: number): number {
    let confidence = sqi;
    
    // Penalizar potencia muy baja
    if (totalPower < this.config.minPowerThreshold) {
      confidence *= 0.5;
    }
    
    return confidence;
  }

  /**
   * Crear métricas vacías para señales inválidas
   */
  private createEmptyMetrics(windowSize: number): SpectralQualityMetrics {
    return {
      sqi: 0,
      dominantFrequency: 0,
      peakSharpness: 0,
      bandPowerRatio: 0,
      harmonicRatio: 0,
      totalPower: 0,
      signalToNoise: 0,
      frequencyStability: 0,
      spectralCentroid: 0,
      spectralSpread: 0,
      spectralFlatness: 0,
      windowSize,
      sampleRate: this.config.sampleRate,
      confidence: 0,
      lastUpdate: performance.now()
    };
  }

  /**
   * Inicializar cache para FFT
   */
  private initializeFFTCache(): void {
    const n = this.config.windowSize;
    
    // Encontrar próxima potencia de 2
    let fftSize = 1;
    while (fftSize < n) {
      fftSize <<= 1;
    }
    
    this.fftCache = {
      real: new Float64Array(fftSize),
      imag: new Float64Array(fftSize),
      magnitude: new Float64Array(fftSize),
      frequency: new Float64Array(fftSize)
    };
    
    // Pre-calcular frecuencias
    const freqResolution = this.config.sampleRate / fftSize;
    for (let i = 0; i < fftSize; i++) {
      this.fftCache.frequency[i] = i * freqResolution;
    }
  }

  /**
   * Resetear estado
   */
  public reset(): void {
    this.previousMetrics = null;
  }

  /**
   * Obtener configuración actual
   */
  public getConfig(): SpectralQualityConfig {
    return { ...this.config };
  }

  /**
   * Actualizar configuración
   */
  public updateConfig(newConfig: Partial<SpectralQualityConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.initializeFFTCache();
  }
}
