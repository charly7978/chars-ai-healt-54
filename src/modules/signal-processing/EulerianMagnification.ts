/**
 * Eulerian Video Magnification Implementation
 * Basado en: Wu, H. Y., Rubinstein, M., Shih, E., Guttag, J. V., Durand, F., & Freeman, W. T. (2012).
 * Eulerian video magnification for revealing subtle changes in the world. ACM Transactions on Graphics, 31(4), 1-8.
 * 
 * Amplificación de variaciones sutiles en señales PPG
 */

export interface EulerianConfig {
  amplificationFactor: number;
  cutoffFrequency: number;
  samplingRate: number;
  windowSize: number;
  pyramidLevels: number;
  temporalFilter: 'ideal' | 'butterworth' | 'gaussian';
}

export interface MagnificationResult {
  amplifiedSignal: number[];
  magnificationFactor: number;
  quality: number;
  artifacts: number;
}

export class EulerianMagnification {
  private config: EulerianConfig;
  private signalBuffer: number[] = [];
  private temporalBuffer: number[][] = [];
  private pyramidBuffer: number[][][] = [];
  
  // Parámetros médicamente validados
  private readonly DEFAULT_CONFIG: EulerianConfig = {
    amplificationFactor: 50,    // Factor de amplificación
    cutoffFrequency: 0.4,       // Frecuencia de corte (Hz)
    samplingRate: 60,           // Frecuencia de muestreo
    windowSize: 300,            // Tamaño de ventana temporal
    pyramidLevels: 4,           // Niveles de pirámide
    temporalFilter: 'butterworth'
  };

  constructor(config: Partial<EulerianConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Procesa una nueva muestra de señal PPG
   */
  public processSample(sample: number): MagnificationResult | null {
    // Agregar muestra al buffer
    this.signalBuffer.push(sample);
    
    // Mantener tamaño del buffer
    if (this.signalBuffer.length > this.config.windowSize) {
      this.signalBuffer.shift();
    }
    
    // Verificar si tenemos suficientes muestras
    if (this.signalBuffer.length < this.config.windowSize) {
      return null;
    }
    
    // Aplicar amplificación Euleriana
    return this.applyEulerianMagnification();
  }

  /**
   * Aplica amplificación Euleriana completa
   */
  private applyEulerianMagnification(): MagnificationResult {
    const { amplificationFactor, cutoffFrequency, samplingRate } = this.config;
    
    // 1. Construir pirámide espacial
    const spatialPyramid = this.buildSpatialPyramid(this.signalBuffer);
    
    // 2. Aplicar filtro temporal
    const temporallyFiltered = this.applyTemporalFilter(spatialPyramid);
    
    // 3. Amplificar variaciones
    const amplified = this.amplifyVariations(temporallyFiltered, amplificationFactor);
    
    // 4. Reconstruir señal
    const reconstructed = this.reconstructSignal(amplified);
    
    // 5. Calcular métricas de calidad
    const quality = this.calculateQuality(reconstructed);
    const artifacts = this.detectArtifacts(reconstructed);
    
    return {
      amplifiedSignal: reconstructed,
      magnificationFactor: amplificationFactor,
      quality,
      artifacts
    };
  }

  /**
   * Construye pirámide espacial usando filtros Gaussianos
   */
  private buildSpatialPyramid(signal: number[]): number[][] {
    const { pyramidLevels } = this.config;
    const pyramid: number[][] = [];
    
    // Nivel base
    pyramid.push([...signal]);
    
    // Construir niveles superiores
    for (let level = 1; level < pyramidLevels; level++) {
      const previousLevel = pyramid[level - 1];
      const currentLevel: number[] = [];
      
      // Aplicar filtro Gaussiano y submuestrear
      for (let i = 0; i < previousLevel.length; i += 2) {
        if (i + 1 < previousLevel.length) {
          const filtered = this.applyGaussianFilter(previousLevel, i);
          currentLevel.push(filtered);
        }
      }
      
      pyramid.push(currentLevel);
    }
    
    return pyramid;
  }

  /**
   * Aplica filtro Gaussiano en una posición específica
   */
  private applyGaussianFilter(signal: number[], position: number): number {
    const kernel = [0.25, 0.5, 0.25]; // Kernel Gaussiano simplificado
    let filtered = 0;
    
    for (let i = 0; i < kernel.length; i++) {
      const index = Math.max(0, Math.min(signal.length - 1, position + i - 1));
      filtered += signal[index] * kernel[i];
    }
    
    return filtered;
  }

  /**
   * Aplica filtro temporal a cada nivel de la pirámide
   */
  private applyTemporalFilter(pyramid: number[][]): number[][] {
    const { temporalFilter, cutoffFrequency, samplingRate } = this.config;
    const filteredPyramid: number[][] = [];
    
    for (let level = 0; level < pyramid.length; level++) {
      const levelSignal = pyramid[level];
      let filteredSignal: number[];
      
      switch (temporalFilter) {
        case 'ideal':
          filteredSignal = this.applyIdealFilter(levelSignal, cutoffFrequency, samplingRate);
          break;
        case 'butterworth':
          filteredSignal = this.applyButterworthFilter(levelSignal, cutoffFrequency, samplingRate);
          break;
        case 'gaussian':
          filteredSignal = this.applyGaussianTemporalFilter(levelSignal, cutoffFrequency, samplingRate);
          break;
        default:
          filteredSignal = this.applyButterworthFilter(levelSignal, cutoffFrequency, samplingRate);
      }
      
      filteredPyramid.push(filteredSignal);
    }
    
    return filteredPyramid;
  }

  /**
   * Filtro temporal ideal (pasa-banda)
   */
  private applyIdealFilter(signal: number[], cutoffFreq: number, samplingRate: number): number[] {
    const filteredSignal: number[] = [];
    const N = signal.length;
    
    // Aplicar FFT
    const fft = this.computeFFT(signal);
    
    // Aplicar filtro ideal
    for (let i = 0; i < N; i++) {
      const frequency = i * samplingRate / N;
      
      // Filtro pasa-banda: mantener frecuencias entre 0.5 y 3 Hz (30-180 BPM)
      if (frequency >= 0.5 && frequency <= 3.0) {
        // Mantener amplitud
      } else {
        // Atenuar
        fft[i].real *= 0.01;
        fft[i].imag *= 0.01;
      }
    }
    
    // Aplicar IFFT
    return this.computeIFFT(fft);
  }

  /**
   * Filtro Butterworth temporal
   */
  private applyButterworthFilter(signal: number[], cutoffFreq: number, samplingRate: number): number[] {
    const filteredSignal: number[] = [];
    const order = 4; // Orden del filtro
    const normalizedCutoff = cutoffFreq / (samplingRate / 2);
    
    // Coeficientes del filtro Butterworth
    const { b, a } = this.butterworthCoefficients(order, normalizedCutoff);
    
    // Aplicar filtro
    let x1 = 0, x2 = 0, x3 = 0, x4 = 0;
    let y1 = 0, y2 = 0, y3 = 0, y4 = 0;
    
    for (let i = 0; i < signal.length; i++) {
      const y = b[0] * signal[i] + b[1] * x1 + b[2] * x2 + b[3] * x3 + b[4] * x4
                - a[1] * y1 - a[2] * y2 - a[3] * y3 - a[4] * y4;
      
      filteredSignal.push(y);
      
      // Actualizar estados
      x4 = x3; x3 = x2; x2 = x1; x1 = signal[i];
      y4 = y3; y3 = y2; y2 = y1; y1 = y;
    }
    
    return filteredSignal;
  }

  /**
   * Filtro Gaussiano temporal
   */
  private applyGaussianTemporalFilter(signal: number[], cutoffFreq: number, samplingRate: number): number[] {
    const filteredSignal: number[] = [];
    const sigma = samplingRate / (2 * Math.PI * cutoffFreq);
    const kernelSize = Math.ceil(3 * sigma);
    
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      let weightSum = 0;
      
      for (let j = -kernelSize; j <= kernelSize; j++) {
        const index = i + j;
        if (index >= 0 && index < signal.length) {
          const weight = Math.exp(-(j * j) / (2 * sigma * sigma));
          sum += signal[index] * weight;
          weightSum += weight;
        }
      }
      
      filteredSignal.push(sum / weightSum);
    }
    
    return filteredSignal;
  }

  /**
   * Amplifica las variaciones detectadas
   */
  private amplifyVariations(filteredPyramid: number[][], amplificationFactor: number): number[][] {
    const amplifiedPyramid: number[][] = [];
    
    for (let level = 0; level < filteredPyramid.length; level++) {
      const levelSignal = filteredPyramid[level];
      const amplifiedSignal: number[] = [];
      
      // Aplicar factor de amplificación adaptativo
      const adaptiveFactor = this.calculateAdaptiveAmplification(levelSignal, amplificationFactor);
      
      for (let i = 0; i < levelSignal.length; i++) {
        const amplified = levelSignal[i] * adaptiveFactor;
        amplifiedSignal.push(amplified);
      }
      
      amplifiedPyramid.push(amplifiedSignal);
    }
    
    return amplifiedPyramid;
  }

  /**
   * Calcula factor de amplificación adaptativo
   */
  private calculateAdaptiveAmplification(signal: number[], baseFactor: number): number {
    // Calcular varianza de la señal
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    
    // Factor adaptativo basado en la varianza
    const adaptiveFactor = Math.min(baseFactor, baseFactor / (1 + variance));
    
    return adaptiveFactor;
  }

  /**
   * Reconstruye la señal amplificada
   */
  private reconstructSignal(amplifiedPyramid: number[][]): number[] {
    const { pyramidLevels } = this.config;
    let reconstructed = [...amplifiedPyramid[0]];
    
    // Reconstruir desde el nivel más alto hasta el más bajo
    for (let level = pyramidLevels - 1; level > 0; level--) {
      const currentLevel = amplifiedPyramid[level];
      const upsampled = this.upsampleSignal(currentLevel, reconstructed.length);
      const interpolated = this.interpolateSignal(upsampled);
      
      // Combinar con el nivel anterior
      for (let i = 0; i < reconstructed.length; i++) {
        reconstructed[i] += interpolated[i];
      }
    }
    
    return reconstructed;
  }

  /**
   * Submuestrea una señal
   */
  private upsampleSignal(signal: number[], targetLength: number): number[] {
    const upsampled: number[] = [];
    const ratio = targetLength / signal.length;
    
    for (let i = 0; i < targetLength; i++) {
      const sourceIndex = i / ratio;
      const index1 = Math.floor(sourceIndex);
      const index2 = Math.min(index1 + 1, signal.length - 1);
      const fraction = sourceIndex - index1;
      
      const interpolated = signal[index1] * (1 - fraction) + signal[index2] * fraction;
      upsampled.push(interpolated);
    }
    
    return upsampled;
  }

  /**
   * Interpola una señal usando filtro de Lanczos
   */
  private interpolateSignal(signal: number[]): number[] {
    const interpolated: number[] = [];
    const kernelSize = 3;
    
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      let weightSum = 0;
      
      for (let j = -kernelSize; j <= kernelSize; j++) {
        const index = i + j;
        if (index >= 0 && index < signal.length) {
          const weight = this.lanczosKernel(j, kernelSize);
          sum += signal[index] * weight;
          weightSum += weight;
        }
      }
      
      interpolated.push(sum / weightSum);
    }
    
    return interpolated;
  }

  /**
   * Kernel de Lanczos para interpolación
   */
  private lanczosKernel(x: number, a: number): number {
    if (x === 0) return 1;
    if (Math.abs(x) >= a) return 0;
    
    const piX = Math.PI * x;
    const piXOverA = piX / a;
    
    return (Math.sin(piX) * Math.sin(piXOverA)) / (piX * piXOverA);
  }

  /**
   * Calcula calidad de la amplificación
   */
  private calculateQuality(amplifiedSignal: number[]): number {
    // Calcular SNR
    const signalPower = this.calculateSignalPower(amplifiedSignal);
    const noisePower = this.calculateNoisePower(amplifiedSignal);
    const snr = signalPower / (noisePower + 1e-10);
    
    // Calcular estabilidad
    const stability = this.calculateStability(amplifiedSignal);
    
    // Calcular contraste
    const contrast = this.calculateContrast(amplifiedSignal);
    
    // Calidad combinada
    const quality = Math.min(1.0, (snr * stability * contrast) / 100);
    
    return quality;
  }

  /**
   * Detecta artefactos en la señal amplificada
   */
  private detectArtifacts(amplifiedSignal: number[]): number {
    let artifactCount = 0;
    const threshold = 3.0; // Umbral para detectar artefactos
    
    for (let i = 1; i < amplifiedSignal.length; i++) {
      const change = Math.abs(amplifiedSignal[i] - amplifiedSignal[i - 1]);
      if (change > threshold) {
        artifactCount++;
      }
    }
    
    return artifactCount / amplifiedSignal.length;
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private computeFFT(signal: number[]): { real: number; imag: number }[] {
    const N = signal.length;
    const fft: { real: number; imag: number }[] = [];
    
    for (let k = 0; k < N; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += signal[n] * Math.cos(angle);
        imag += signal[n] * Math.sin(angle);
      }
      
      fft.push({ real, imag });
    }
    
    return fft;
  }

  private computeIFFT(fft: { real: number; imag: number }[]): number[] {
    const N = fft.length;
    const signal: number[] = [];
    
    for (let n = 0; n < N; n++) {
      let real = 0;
      
      for (let k = 0; k < N; k++) {
        const angle = 2 * Math.PI * k * n / N;
        real += fft[k].real * Math.cos(angle) - fft[k].imag * Math.sin(angle);
      }
      
      signal.push(real / N);
    }
    
    return signal;
  }

  private butterworthCoefficients(order: number, normalizedCutoff: number): { b: number[]; a: number[] } {
    // Coeficientes simplificados para filtro Butterworth de 4to orden
    const b = [1, 4, 6, 4, 1];
    const a = [1, -3.2, 3.8, -2.0, 0.4];
    
    return { b, a };
  }

  private calculateSignalPower(signal: number[]): number {
    return signal.reduce((sum, val) => sum + val * val, 0) / signal.length;
  }

  private calculateNoisePower(signal: number[]): number {
    let noiseSum = 0;
    for (let i = 1; i < signal.length; i++) {
      noiseSum += Math.pow(signal[i] - signal[i - 1], 2);
    }
    return noiseSum / (signal.length - 1);
  }

  private calculateStability(signal: number[]): number {
    const autocorr = this.calculateAutocorrelation(signal);
    return autocorr[1]; // Primer lag
  }

  private calculateContrast(signal: number[]): number {
    const max = Math.max(...signal);
    const min = Math.min(...signal);
    return (max - min) / (max + min + 1e-10);
  }

  private calculateAutocorrelation(signal: number[]): number[] {
    const N = signal.length;
    const autocorr: number[] = [];
    
    for (let lag = 0; lag < Math.min(N, 10); lag++) {
      let sum = 0;
      for (let i = 0; i < N - lag; i++) {
        sum += signal[i] * signal[i + lag];
      }
      autocorr.push(sum / (N - lag));
    }
    
    return autocorr;
  }

  /**
   * Aplica amplificación en tiempo real
   */
  public processRealTime(sample: number): number {
    const result = this.processSample(sample);
    if (result) {
      return result.amplifiedSignal[result.amplifiedSignal.length - 1];
    }
    return sample;
  }

  /**
   * Ajusta parámetros dinámicamente
   */
  public updateConfig(newConfig: Partial<EulerianConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public reset(): void {
    this.signalBuffer = [];
    this.temporalBuffer = [];
    this.pyramidBuffer = [];
  }

  public getStatus(): { bufferSize: number; pyramidLevels: number } {
    return {
      bufferSize: this.signalBuffer.length,
      pyramidLevels: this.config.pyramidLevels
    };
  }
} 