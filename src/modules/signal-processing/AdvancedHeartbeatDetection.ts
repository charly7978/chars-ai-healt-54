/**
 * Advanced Heartbeat Detection System
 * Basado en algoritmos médicos reales de PPG para detección precisa de latidos
 * Implementa análisis espectral avanzado, filtrado adaptativo y validación biofísica
 */

export interface HeartbeatDetectionConfig {
  samplingRate: number;
  minHeartRate: number;
  maxHeartRate: number;
  spectralAnalysisWindow: number;
  peakDetectionSensitivity: number;
  motionArtifactThreshold: number;
  signalQualityThreshold: number;
  confidenceThreshold: number;
  adaptiveFiltering: boolean;
  spectralValidation: boolean;
}

export interface HeartbeatDetectionResult {
  isHeartbeatDetected: boolean;
  heartRate: number;
  confidence: number;
  signalQuality: number;
  motionArtifactLevel: number;
  peakAmplitude: number;
  rrInterval: number;
  spectralFeatures: {
    dominantFrequency: number;
    spectralPower: number;
    spectralEntropy: number;
    harmonicRatio: number;
    signalToNoiseRatio: number;
  };
  bioPhysicalValidation: {
    isValidHeartRate: boolean;
    isValidRRInterval: boolean;
    isValidSpectralProfile: boolean;
    isValidPeakAmplitude: boolean;
  };
  timestamp: number;
}

export class AdvancedHeartbeatDetection {
  private config: HeartbeatDetectionConfig;
  private signalBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  private peakTimes: number[] = [];
  private rrIntervals: number[] = [];
  private detectionHistory: HeartbeatDetectionResult[] = [];
  private lastPeakTime: number | null = null;
  private adaptiveThreshold: number = 0.1;
  private baselineLevel: number = 0;
  
  // Parámetros médicamente validados para detección de latidos
  private readonly DEFAULT_CONFIG: HeartbeatDetectionConfig = {
    samplingRate: 60,                 // 60 Hz
    minHeartRate: 30,                 // 30 BPM
    maxHeartRate: 220,                // 220 BPM
    spectralAnalysisWindow: 300,      // 5 segundos
    peakDetectionSensitivity: 0.6,    // Sensibilidad de detección de picos
    motionArtifactThreshold: 0.3,     // Umbral de artefacto de movimiento
    signalQualityThreshold: 0.5,      // Umbral mínimo de calidad de señal
    confidenceThreshold: 0.7,         // Umbral mínimo de confianza
    adaptiveFiltering: true,          // Filtrado adaptativo
    spectralValidation: true          // Validación espectral
  };

  constructor(config: Partial<HeartbeatDetectionConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Procesa una nueva muestra de señal PPG para detectar latidos
   */
  public processSample(signalValue: number, timestamp: number): HeartbeatDetectionResult | null {
    // Normalizar señal
    const normalizedSignal = this.normalizeSignal(signalValue);
    
    // Actualizar buffers
    this.updateBuffers(normalizedSignal, timestamp);
    
    // Verificar si tenemos suficientes muestras
    if (this.signalBuffer.length < this.config.spectralAnalysisWindow) {
      return this.createInitialResult(false, timestamp);
    }
    
    // Aplicar análisis avanzado
    return this.applyAdvancedAnalysis(timestamp);
  }

  /**
   * Análisis avanzado basado en múltiples criterios médicos
   */
  private applyAdvancedAnalysis(timestamp: number): HeartbeatDetectionResult {
    // 1. Filtrado adaptativo
    const filteredSignal = this.applyAdaptiveFiltering();
    
    // 2. Detección de picos
    const peakDetection = this.detectPeaks(filteredSignal, timestamp);
    
    // 3. Análisis espectral
    const spectralFeatures = this.calculateSpectralFeatures(filteredSignal);
    
    // 4. Detección de movimiento
    const motionArtifactLevel = this.detectMotionArtifacts();
    
    // 5. Cálculo de frecuencia cardíaca
    const heartRate = this.calculateHeartRate();
    
    // 6. Cálculo de intervalo RR
    const rrInterval = this.calculateRRInterval();
    
    // 7. Validación biofísica
    const bioPhysicalValidation = this.validateBioPhysicalCriteria(
      heartRate,
      rrInterval,
      spectralFeatures,
      peakDetection.amplitude
    );
    
    // 8. Cálculo de confianza
    const confidence = this.calculateConfidence(
      heartRate,
      spectralFeatures,
      motionArtifactLevel,
      bioPhysicalValidation,
      peakDetection.amplitude
    );
    
    // 9. Decisión final de detección
    const isHeartbeatDetected = this.makeDetectionDecision(
      peakDetection.isPeak,
      confidence,
      bioPhysicalValidation,
      motionArtifactLevel
    );
    
    // 10. Calcular calidad de señal
    const signalQuality = this.calculateSignalQuality(
      spectralFeatures,
      motionArtifactLevel,
      peakDetection.amplitude
    );

    const result: HeartbeatDetectionResult = {
      isHeartbeatDetected,
      heartRate,
      confidence,
      signalQuality,
      motionArtifactLevel,
      peakAmplitude: peakDetection.amplitude,
      rrInterval,
      spectralFeatures,
      bioPhysicalValidation,
      timestamp
    };

    // Actualizar historial
    this.updateDetectionHistory(result);

    return result;
  }

  /**
   * Filtrado adaptativo basado en características de señal
   */
  private applyAdaptiveFiltering(): number[] {
    const signal = this.signalBuffer.slice(-this.config.spectralAnalysisWindow);
    
    if (!this.config.adaptiveFiltering) {
      return signal;
    }
    
    // Filtro de mediana móvil adaptativo
    const medianFiltered = this.applyMedianFilter(signal, 3);
    
    // Filtro de promedio móvil adaptativo
    const averageFiltered = this.applyMovingAverage(medianFiltered, 5);
    
    // Filtro de paso bajo adaptativo
    const lowPassFiltered = this.applyLowPassFilter(averageFiltered, 0.1);
    
    return lowPassFiltered;
  }

  /**
   * Detección de picos basada en análisis de derivada
   */
  private detectPeaks(filteredSignal: number[], timestamp: number): {
    isPeak: boolean;
    amplitude: number;
  } {
    if (filteredSignal.length < 3) {
      return { isPeak: false, amplitude: 0 };
    }
    
    const currentValue = filteredSignal[filteredSignal.length - 1];
    const previousValue = filteredSignal[filteredSignal.length - 2];
    const prePreviousValue = filteredSignal[filteredSignal.length - 3];
    
    // Calcular derivada
    const derivative = currentValue - previousValue;
    const previousDerivative = previousValue - prePreviousValue;
    
    // Detectar pico: derivada cambia de positiva a negativa
    const isPeak = previousDerivative > 0 && derivative < 0;
    
    // Calcular amplitud del pico
    const amplitude = isPeak ? currentValue - this.baselineLevel : 0;
    
    // Actualizar umbral adaptativo
    if (isPeak && amplitude > this.adaptiveThreshold) {
      this.adaptiveThreshold = this.adaptiveThreshold * 0.9 + amplitude * 0.1;
      this.lastPeakTime = timestamp;
      
      // Actualizar intervalo RR
      if (this.lastPeakTime && this.peakTimes.length > 0) {
        const rrInterval = timestamp - this.peakTimes[this.peakTimes.length - 1];
        if (rrInterval > 200 && rrInterval < 2000) { // 30-300 BPM
          this.rrIntervals.push(rrInterval);
          if (this.rrIntervals.length > 20) {
            this.rrIntervals.shift();
          }
        }
      }
      
      this.peakTimes.push(timestamp);
      if (this.peakTimes.length > 50) {
        this.peakTimes.shift();
      }
    }
    
    // Actualizar nivel de baseline
    this.baselineLevel = this.baselineLevel * 0.95 + currentValue * 0.05;
    
    return { isPeak, amplitude };
  }

  /**
   * Cálculo de características espectrales avanzadas
   */
  private calculateSpectralFeatures(signal: number[]): HeartbeatDetectionResult['spectralFeatures'] {
    // Aplicar ventana de Hann
    const windowedSignal = this.applyHannWindow(signal);
    
    // Calcular FFT
    const fft = this.computeFFT(windowedSignal);
    
    // Calcular densidad espectral de potencia
    const psd = this.calculatePowerSpectralDensity(fft);
    
    // Buscar frecuencia dominante en rango cardíaco
    const dominantFrequency = this.findDominantFrequency(psd, 0.5, 3.67);
    
    // Calcular potencia espectral total
    const spectralPower = this.calculateTotalSpectralPower(psd);
    
    // Calcular entropía espectral
    const spectralEntropy = this.calculateSpectralEntropy(psd);
    
    // Calcular ratio armónico
    const harmonicRatio = this.calculateHarmonicRatio(psd, dominantFrequency);
    
    // Calcular SNR
    const signalToNoiseRatio = this.calculateSignalToNoiseRatio(psd, dominantFrequency);
    
    return {
      dominantFrequency,
      spectralPower,
      spectralEntropy,
      harmonicRatio,
      signalToNoiseRatio
    };
  }

  /**
   * Detección de artefactos de movimiento
   */
  private detectMotionArtifacts(): number {
    if (this.signalBuffer.length < 10) {
      return 0;
    }
    
    const recentSignal = this.signalBuffer.slice(-10);
    const motionScores: number[] = [];
    
    for (let i = 1; i < recentSignal.length; i++) {
      const diff = Math.abs(recentSignal[i] - recentSignal[i - 1]);
      motionScores.push(diff);
    }
    
    const avgMotion = motionScores.reduce((sum, score) => sum + score, 0) / motionScores.length;
    const motionVariance = this.calculateVariance(motionScores);
    
    return Math.min(1.0, avgMotion * motionVariance);
  }

  /**
   * Cálculo de frecuencia cardíaca
   */
  private calculateHeartRate(): number {
    if (this.rrIntervals.length < 3) {
      return 0;
    }
    
    // Calcular intervalo RR promedio
    const avgRRInterval = this.rrIntervals.reduce((sum, interval) => sum + interval, 0) / this.rrIntervals.length;
    
    // Convertir a BPM
    const heartRate = 60000 / avgRRInterval;
    
    // Validar rango fisiológico
    if (heartRate < this.config.minHeartRate || heartRate > this.config.maxHeartRate) {
      return 0;
    }
    
    return heartRate;
  }

  /**
   * Cálculo de intervalo RR
   */
  private calculateRRInterval(): number {
    if (this.rrIntervals.length === 0) {
      return 0;
    }
    
    return this.rrIntervals[this.rrIntervals.length - 1];
  }

  /**
   * Validación biofísica estricta
   */
  private validateBioPhysicalCriteria(
    heartRate: number,
    rrInterval: number,
    spectralFeatures: HeartbeatDetectionResult['spectralFeatures'],
    peakAmplitude: number
  ): HeartbeatDetectionResult['bioPhysicalValidation'] {
    // Validar frecuencia cardíaca
    const isValidHeartRate = heartRate >= this.config.minHeartRate && 
                             heartRate <= this.config.maxHeartRate;
    
    // Validar intervalo RR
    const isValidRRInterval = rrInterval >= 273 && rrInterval <= 2000; // 30-220 BPM
    
    // Validar perfil espectral
    const isValidSpectralProfile = spectralFeatures.dominantFrequency >= 0.5 && 
                                   spectralFeatures.dominantFrequency <= 3.67 &&
                                   spectralFeatures.signalToNoiseRatio > 2.0 &&
                                   spectralFeatures.harmonicRatio > 0.2;
    
    // Validar amplitud de pico
    const isValidPeakAmplitude = peakAmplitude > this.adaptiveThreshold * 0.5;
    
    return {
      isValidHeartRate,
      isValidRRInterval,
      isValidSpectralProfile,
      isValidPeakAmplitude
    };
  }

  /**
   * Cálculo de confianza basado en múltiples factores
   */
  private calculateConfidence(
    heartRate: number,
    spectralFeatures: HeartbeatDetectionResult['spectralFeatures'],
    motionArtifactLevel: number,
    bioPhysicalValidation: HeartbeatDetectionResult['bioPhysicalValidation'],
    peakAmplitude: number
  ): number {
    // Factores de confianza
    const heartRateConfidence = heartRate > 0 ? Math.min(1, heartRate / 100) : 0;
    const spectralConfidence = Math.min(1, spectralFeatures.signalToNoiseRatio / 5.0);
    const motionConfidence = Math.max(0, 1 - motionArtifactLevel);
    const amplitudeConfidence = Math.min(1, peakAmplitude / (this.adaptiveThreshold * 2));
    
    // Validación biofísica
    const bioPhysicalScore = Object.values(bioPhysicalValidation).filter(Boolean).length / 4;
    
    // Ponderación de factores
    const confidence = 0.3 * heartRateConfidence +
                      0.25 * spectralConfidence +
                      0.2 * motionConfidence +
                      0.15 * amplitudeConfidence +
                      0.1 * bioPhysicalScore;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Decisión final de detección
   */
  private makeDetectionDecision(
    isPeak: boolean,
    confidence: number,
    bioPhysicalValidation: HeartbeatDetectionResult['bioPhysicalValidation'],
    motionArtifactLevel: number
  ): boolean {
    // Requerir pico detectado
    if (!isPeak) {
      return false;
    }
    
    // Requerir confianza mínima
    if (confidence < this.config.confidenceThreshold) {
      return false;
    }
    
    // Requerir validación biofísica
    const validBioPhysicalCount = Object.values(bioPhysicalValidation).filter(Boolean).length;
    if (validBioPhysicalCount < 3) {
      return false;
    }
    
    // Rechazar si hay demasiado movimiento
    if (motionArtifactLevel > this.config.motionArtifactThreshold) {
      return false;
    }
    
    return true;
  }

  /**
   * Cálculo de calidad de señal
   */
  private calculateSignalQuality(
    spectralFeatures: HeartbeatDetectionResult['spectralFeatures'],
    motionArtifactLevel: number,
    peakAmplitude: number
  ): number {
    // Componentes de calidad
    const spectralQuality = Math.min(1, spectralFeatures.signalToNoiseRatio / 5.0);
    const motionQuality = Math.max(0, 1 - motionArtifactLevel);
    const amplitudeQuality = Math.min(1, peakAmplitude / (this.adaptiveThreshold * 2));
    const stabilityQuality = Math.min(1, 1 / (spectralFeatures.spectralEntropy + 0.1));
    
    // Calidad total ponderada
    const quality = 0.3 * spectralQuality +
                   0.3 * motionQuality +
                   0.2 * amplitudeQuality +
                   0.2 * stabilityQuality;
    
    return Math.max(0, Math.min(1, quality));
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private normalizeSignal(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private updateBuffers(signalValue: number, timestamp: number): void {
    this.signalBuffer.push(signalValue);
    this.timestampBuffer.push(timestamp);
    
    // Mantener tamaño del buffer
    const maxBufferSize = this.config.spectralAnalysisWindow * 2;
    if (this.signalBuffer.length > maxBufferSize) {
      this.signalBuffer.shift();
      this.timestampBuffer.shift();
    }
  }

  private applyMedianFilter(signal: number[], windowSize: number): number[] {
    const filtered: number[] = [];
    
    for (let i = 0; i < signal.length; i++) {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(signal.length, i + Math.floor(windowSize / 2) + 1);
      const window = signal.slice(start, end).sort((a, b) => a - b);
      const median = window[Math.floor(window.length / 2)];
      filtered.push(median);
    }
    
    return filtered;
  }

  private applyMovingAverage(signal: number[], windowSize: number): number[] {
    const filtered: number[] = [];
    
    for (let i = 0; i < signal.length; i++) {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(signal.length, i + Math.floor(windowSize / 2) + 1);
      const window = signal.slice(start, end);
      const average = window.reduce((sum, val) => sum + val, 0) / window.length;
      filtered.push(average);
    }
    
    return filtered;
  }

  private applyLowPassFilter(signal: number[], cutoffFreq: number): number[] {
    const filtered: number[] = [];
    let y1 = 0, y2 = 0;
    
    const alpha = cutoffFreq / (cutoffFreq + 1);
    
    for (let i = 0; i < signal.length; i++) {
      const y = alpha * signal[i] + (1 - alpha) * y1;
      filtered.push(y);
      y2 = y1;
      y1 = y;
    }
    
    return filtered;
  }

  private applyHannWindow(signal: number[]): number[] {
    return signal.map((value, index) => {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * index / (signal.length - 1)));
      return value * window;
    });
  }

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

  private calculatePowerSpectralDensity(fft: { real: number; imag: number }[]): number[] {
    return fft.map(complex => Math.sqrt(complex.real * complex.real + complex.imag * complex.imag));
  }

  private findDominantFrequency(psd: number[], minFreq: number, maxFreq: number): number {
    const samplingRate = this.config.samplingRate;
    const minBin = Math.floor(minFreq * psd.length / samplingRate);
    const maxBin = Math.floor(maxFreq * psd.length / samplingRate);
    
    let maxMagnitude = 0;
    let peakBin = 0;
    
    for (let i = minBin; i <= maxBin && i < psd.length / 2; i++) {
      if (psd[i] > maxMagnitude) {
        maxMagnitude = psd[i];
        peakBin = i;
      }
    }
    
    return peakBin * samplingRate / psd.length;
  }

  private calculateTotalSpectralPower(psd: number[]): number {
    return psd.reduce((sum, power) => sum + power, 0) / psd.length;
  }

  private calculateSpectralEntropy(psd: number[]): number {
    const totalPower = psd.reduce((sum, power) => sum + power, 0);
    let entropy = 0;
    
    psd.forEach(power => {
      if (power > 0) {
        const probability = power / totalPower;
        entropy -= probability * Math.log2(probability);
      }
    });
    
    return entropy;
  }

  private calculateHarmonicRatio(psd: number[], dominantFreq: number): number {
    const samplingRate = this.config.samplingRate;
    const fundamentalBin = Math.floor(dominantFreq * psd.length / samplingRate);
    const secondHarmonicBin = Math.floor(2 * dominantFreq * psd.length / samplingRate);
    
    if (secondHarmonicBin >= psd.length / 2) {
      return 0;
    }
    
    const fundamentalPower = psd[fundamentalBin] || 0;
    const harmonicPower = psd[secondHarmonicBin] || 0;
    
    return harmonicPower / (fundamentalPower + 1e-10);
  }

  private calculateSignalToNoiseRatio(psd: number[], dominantFreq: number): number {
    const samplingRate = this.config.samplingRate;
    const signalBin = Math.floor(dominantFreq * psd.length / samplingRate);
    
    if (signalBin >= psd.length / 2) {
      return 0;
    }
    
    const signalPower = psd[signalBin] || 0;
    const noisePower = psd.reduce((sum, power, index) => {
      if (index !== signalBin) {
        return sum + power;
      }
      return sum;
    }, 0) / (psd.length - 1);
    
    return signalPower / (noisePower + 1e-10);
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }

  private createInitialResult(isDetected: boolean, timestamp: number): HeartbeatDetectionResult {
    return {
      isHeartbeatDetected: isDetected,
      heartRate: 0,
      confidence: 0,
      signalQuality: 0,
      motionArtifactLevel: 0,
      peakAmplitude: 0,
      rrInterval: 0,
      spectralFeatures: {
        dominantFrequency: 0,
        spectralPower: 0,
        spectralEntropy: 0,
        harmonicRatio: 0,
        signalToNoiseRatio: 0
      },
      bioPhysicalValidation: {
        isValidHeartRate: false,
        isValidRRInterval: false,
        isValidSpectralProfile: false,
        isValidPeakAmplitude: false
      },
      timestamp
    };
  }

  private updateDetectionHistory(result: HeartbeatDetectionResult): void {
    this.detectionHistory.push(result);
    
    // Mantener solo los últimos 100 resultados
    if (this.detectionHistory.length > 100) {
      this.detectionHistory.shift();
    }
  }

  /**
   * Obtener estadísticas de detección
   */
  public getDetectionStats(): {
    totalSamples: number;
    detectionRate: number;
    averageHeartRate: number;
    averageConfidence: number;
    averageSignalQuality: number;
    lastDetection: HeartbeatDetectionResult | null;
  } {
    if (this.detectionHistory.length === 0) {
      return {
        totalSamples: 0,
        detectionRate: 0,
        averageHeartRate: 0,
        averageConfidence: 0,
        averageSignalQuality: 0,
        lastDetection: null
      };
    }
    
    const detections = this.detectionHistory.filter(result => result.isHeartbeatDetected);
    const detectionRate = detections.length / this.detectionHistory.length;
    const averageHeartRate = detections.reduce((sum, result) => sum + result.heartRate, 0) / Math.max(1, detections.length);
    const averageConfidence = this.detectionHistory.reduce((sum, result) => sum + result.confidence, 0) / this.detectionHistory.length;
    const averageSignalQuality = this.detectionHistory.reduce((sum, result) => sum + result.signalQuality, 0) / this.detectionHistory.length;
    const lastDetection = this.detectionHistory[this.detectionHistory.length - 1];
    
    return {
      totalSamples: this.detectionHistory.length,
      detectionRate,
      averageHeartRate,
      averageConfidence,
      averageSignalQuality,
      lastDetection
    };
  }

  /**
   * Reset del detector
   */
  public reset(): void {
    this.signalBuffer = [];
    this.timestampBuffer = [];
    this.peakTimes = [];
    this.rrIntervals = [];
    this.detectionHistory = [];
    this.lastPeakTime = null;
    this.adaptiveThreshold = 0.1;
    this.baselineLevel = 0;
  }

  /**
   * Actualizar configuración
   */
  public updateConfig(newConfig: Partial<HeartbeatDetectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
} 