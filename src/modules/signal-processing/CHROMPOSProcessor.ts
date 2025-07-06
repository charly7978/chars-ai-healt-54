/**
 * CHROM/POS Algorithm Implementation
 * Basado en: De Haan, G., & Jeanne, V. (2013). Robust pulse rate from chrominance-based rPPG.
 * IEEE Transactions on Biomedical Engineering, 60(10), 2878-2886.
 * 
 * Algoritmo robusto contra movimiento para extracción de frecuencia cardíaca
 */

export interface CHROMConfig {
  windowSize: number;
  alpha: number;
  beta: number;
  gamma: number;
  samplingRate: number;
  minFrequency: number;
  maxFrequency: number;
}

export interface CHROMResult {
  heartRate: number;
  confidence: number;
  signalQuality: number;
  motionArtifactLevel: number;
  chrominanceSignal: number[];
  processedSignal: number[];
}

export class CHROMPOSProcessor {
  private config: CHROMConfig;
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private chrominanceBuffer: number[] = [];
  private posBuffer: number[] = [];
  private motionBuffer: number[] = [];
  
  // Parámetros médicamente validados
  private readonly DEFAULT_CONFIG: CHROMConfig = {
    windowSize: 300, // ~5 segundos a 60fps
    alpha: 3,        // Factor de ponderación para CHROM
    beta: 2,         // Factor de ponderación para POS
    gamma: 1,        // Factor de fusión
    samplingRate: 60,
    minFrequency: 0.5,  // 30 BPM
    maxFrequency: 3.67  // 220 BPM
  };

  constructor(config: Partial<CHROMConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Procesa una nueva muestra de datos RGB
   */
  public processFrame(red: number, green: number, blue: number): CHROMResult | null {
    // Normalizar valores RGB
    const normalizedRed = this.normalizeRGB(red);
    const normalizedGreen = this.normalizeRGB(green);
    const normalizedBlue = this.normalizeRGB(blue);

    // Actualizar buffers
    this.updateBuffers(normalizedRed, normalizedGreen, normalizedBlue);

    // Verificar si tenemos suficientes muestras
    if (this.redBuffer.length < this.config.windowSize) {
      return null;
    }

    // Aplicar algoritmo CHROM
    const chrominanceSignal = this.applyCHROM();
    
    // Aplicar algoritmo POS
    const posSignal = this.applyPOS();
    
    // Fusionar señales
    const fusedSignal = this.fuseSignals(chrominanceSignal, posSignal);
    
    // Detectar movimiento
    const motionArtifactLevel = this.detectMotionArtifacts();
    
    // Calcular frecuencia cardíaca
    const heartRate = this.calculateHeartRate(fusedSignal);
    
    // Calcular calidad de señal
    const signalQuality = this.calculateSignalQuality(fusedSignal, motionArtifactLevel);
    
    // Calcular confianza
    const confidence = this.calculateConfidence(heartRate, signalQuality, motionArtifactLevel);

    return {
      heartRate,
      confidence,
      signalQuality,
      motionArtifactLevel,
      chrominanceSignal,
      processedSignal: fusedSignal
    };
  }

  /**
   * Algoritmo CHROM: Chrominance-based rPPG
   */
  private applyCHROM(): number[] {
    const { alpha } = this.config;
    const chrominanceSignal: number[] = [];
    
    for (let i = 0; i < this.redBuffer.length; i++) {
      // CHROM: X = R - αG
      const chrominance = this.redBuffer[i] - alpha * this.greenBuffer[i];
      chrominanceSignal.push(chrominance);
    }
    
    // Aplicar filtro de banda para frecuencias cardíacas
    return this.applyBandpassFilter(chrominanceSignal);
  }

  /**
   * Algoritmo POS: Plane-Orthogonal-to-Skin
   */
  private applyPOS(): number[] {
    const posSignal: number[] = [];
    
    for (let i = 0; i < this.redBuffer.length; i++) {
      // POS: Proyección ortogonal al plano de la piel
      const pos = this.redBuffer[i] + this.greenBuffer[i] - 2 * this.blueBuffer[i];
      posSignal.push(pos);
    }
    
    // Aplicar filtro de banda
    return this.applyBandpassFilter(posSignal);
  }

  /**
   * Fusión adaptativa de señales CHROM y POS
   */
  private fuseSignals(chrominanceSignal: number[], posSignal: number[]): number[] {
    const { beta, gamma } = this.config;
    const fusedSignal: number[] = [];
    
    // Calcular pesos adaptativos basados en la calidad de cada señal
    const chrominanceQuality = this.calculateSignalQuality(chrominanceSignal, 0);
    const posQuality = this.calculateSignalQuality(posSignal, 0);
    
    const totalQuality = chrominanceQuality + posQuality;
    const chrominanceWeight = totalQuality > 0 ? chrominanceQuality / totalQuality : 0.5;
    const posWeight = 1 - chrominanceWeight;
    
    for (let i = 0; i < chrominanceSignal.length; i++) {
      const fused = gamma * (chrominanceWeight * chrominanceSignal[i] + posWeight * posSignal[i]);
      fusedSignal.push(fused);
    }
    
    return fusedSignal;
  }

  /**
   * Detección de artefactos de movimiento
   */
  private detectMotionArtifacts(): number {
    const motionScores: number[] = [];
    
    for (let i = 1; i < this.redBuffer.length; i++) {
      // Calcular variación temporal
      const redDiff = Math.abs(this.redBuffer[i] - this.redBuffer[i - 1]);
      const greenDiff = Math.abs(this.greenBuffer[i] - this.greenBuffer[i - 1]);
      const blueDiff = Math.abs(this.blueBuffer[i] - this.blueBuffer[i - 1]);
      
      // Score de movimiento basado en cambios abruptos
      const motionScore = (redDiff + greenDiff + blueDiff) / 3;
      motionScores.push(motionScore);
    }
    
    // Calcular nivel de artefacto de movimiento
    const avgMotion = motionScores.reduce((sum, score) => sum + score, 0) / motionScores.length;
    const motionVariance = this.calculateVariance(motionScores);
    
    return Math.min(1.0, avgMotion * motionVariance);
  }

  /**
   * Cálculo de frecuencia cardíaca mediante FFT
   */
  private calculateHeartRate(signal: number[]): number {
    // Aplicar ventana de Hann para reducir leakage
    const windowedSignal = this.applyHannWindow(signal);
    
    // Calcular FFT
    const fft = this.computeFFT(windowedSignal);
    
    // Buscar pico en el rango de frecuencias cardíacas
    const { minFrequency, maxFrequency, samplingRate } = this.config;
    const minBin = Math.floor(minFrequency * signal.length / samplingRate);
    const maxBin = Math.floor(maxFrequency * signal.length / samplingRate);
    
    let maxMagnitude = 0;
    let peakFrequency = 0;
    
    for (let i = minBin; i <= maxBin && i < fft.length / 2; i++) {
      const magnitude = Math.sqrt(fft[i].real * fft[i].real + fft[i].imag * fft[i].imag);
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
        peakFrequency = i * samplingRate / signal.length;
      }
    }
    
    // Convertir frecuencia a BPM
    return peakFrequency * 60;
  }

  /**
   * Cálculo de calidad de señal
   */
  private calculateSignalQuality(signal: number[], motionArtifactLevel: number): number {
    // Calcular SNR (Signal-to-Noise Ratio)
    const signalPower = this.calculateSignalPower(signal);
    const noisePower = this.calculateNoisePower(signal);
    const snr = signalPower / (noisePower + 1e-10);
    
    // Calcular estabilidad temporal
    const stability = this.calculateTemporalStability(signal);
    
    // Factor de corrección por movimiento
    const motionCorrection = Math.max(0, 1 - motionArtifactLevel);
    
    // Calidad final
    const quality = Math.min(1.0, (snr * stability * motionCorrection) / 100);
    
    return quality;
  }

  /**
   * Cálculo de confianza basado en múltiples factores
   */
  private calculateConfidence(heartRate: number, signalQuality: number, motionArtifactLevel: number): number {
    // Validación fisiológica
    const physiologicalConfidence = this.validatePhysiologicalRange(heartRate);
    
    // Confianza basada en calidad de señal
    const qualityConfidence = signalQuality;
    
    // Confianza basada en estabilidad
    const stabilityConfidence = 1 - motionArtifactLevel;
    
    // Ponderación de factores
    const confidence = 0.4 * physiologicalConfidence + 
                      0.4 * qualityConfidence + 
                      0.2 * stabilityConfidence;
    
    return Math.max(0, Math.min(1, confidence));
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private normalizeRGB(value: number): number {
    return Math.max(0, Math.min(1, value / 255));
  }

  private updateBuffers(red: number, green: number, blue: number): void {
    this.redBuffer.push(red);
    this.greenBuffer.push(green);
    this.blueBuffer.push(blue);
    
    // Mantener tamaño del buffer
    if (this.redBuffer.length > this.config.windowSize) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }
  }

  private applyBandpassFilter(signal: number[]): number[] {
    const { minFrequency, maxFrequency, samplingRate } = this.config;
    
    // Filtro Butterworth de segundo orden
    const filteredSignal: number[] = [];
    const cutoffLow = minFrequency / (samplingRate / 2);
    const cutoffHigh = maxFrequency / (samplingRate / 2);
    
    // Coeficientes del filtro (simplificado)
    const b0 = 1;
    const b1 = 0;
    const b2 = -1;
    const a0 = 1;
    const a1 = -2 * Math.cos(Math.PI * (cutoffLow + cutoffHigh) / 2);
    const a2 = 1;
    
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    for (let i = 0; i < signal.length; i++) {
      const y = b0 * signal[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      filteredSignal.push(y);
      
      x2 = x1;
      x1 = signal[i];
      y2 = y1;
      y1 = y;
    }
    
    return filteredSignal;
  }

  private applyHannWindow(signal: number[]): number[] {
    return signal.map((value, index) => {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * index / (signal.length - 1)));
      return value * window;
    });
  }

  private computeFFT(signal: number[]): { real: number; imag: number }[] {
    // Implementación simplificada de FFT
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

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  private calculateSignalPower(signal: number[]): number {
    return signal.reduce((sum, val) => sum + val * val, 0) / signal.length;
  }

  private calculateNoisePower(signal: number[]): number {
    // Estimación de ruido mediante diferencias
    let noiseSum = 0;
    for (let i = 1; i < signal.length; i++) {
      noiseSum += Math.pow(signal[i] - signal[i - 1], 2);
    }
    return noiseSum / (signal.length - 1);
  }

  private calculateTemporalStability(signal: number[]): number {
    // Calcular autocorrelación para medir estabilidad
    const autocorr = this.calculateAutocorrelation(signal);
    return autocorr[1]; // Primer lag
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

  private validatePhysiologicalRange(heartRate: number): number {
    // Validar rango fisiológico (30-220 BPM)
    if (heartRate < 30 || heartRate > 220) {
      return 0;
    }
    
    // Mayor confianza en rango normal (60-100 BPM)
    if (heartRate >= 60 && heartRate <= 100) {
      return 1.0;
    }
    
    // Confianza decreciente fuera del rango normal
    const distanceFromNormal = Math.min(
      Math.abs(heartRate - 60),
      Math.abs(heartRate - 100)
    );
    
    return Math.max(0, 1 - distanceFromNormal / 100);
  }

  public reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.chrominanceBuffer = [];
    this.posBuffer = [];
    this.motionBuffer = [];
  }

  public getBufferStatus(): { red: number; green: number; blue: number } {
    return {
      red: this.redBuffer.length,
      green: this.greenBuffer.length,
      blue: this.blueBuffer.length
    };
  }
} 