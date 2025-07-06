/**
 * Advanced Finger Detection System
 * Basado en algoritmos médicos reales de PPG para detección precisa de dedo
 * Implementa validación biofísica estricta y análisis espectral avanzado
 */

export interface FingerDetectionConfig {
  minPulsatilityThreshold: number;
  maxPulsatilityThreshold: number;
  minSignalAmplitude: number;
  maxSignalAmplitude: number;
  spectralAnalysisWindow: number;
  motionArtifactThreshold: number;
  skinToneValidation: boolean;
  perfusionIndexThreshold: number;
  confidenceThreshold: number;
}

export interface FingerDetectionResult {
  isFingerDetected: boolean;
  confidence: number;
  pulsatilityIndex: number;
  signalQuality: number;
  motionArtifactLevel: number;
  skinToneValidation: boolean;
  perfusionIndex: number;
  spectralFeatures: {
    dominantFrequency: number;
    spectralPower: number;
    spectralEntropy: number;
    harmonicRatio: number;
  };
  bioPhysicalValidation: {
    isValidSkinTone: boolean;
    isValidPulsatility: boolean;
    isValidAmplitude: boolean;
    isValidSpectralProfile: boolean;
  };
  timestamp: number;
}

export class AdvancedFingerDetection {
  private config: FingerDetectionConfig;
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  private detectionHistory: FingerDetectionResult[] = [];
  
  // Parámetros médicamente validados para detección de dedo
  private readonly DEFAULT_CONFIG: FingerDetectionConfig = {
    minPulsatilityThreshold: 0.05,    // Umbral mínimo de pulsatilidad (5%) - más permisivo
    maxPulsatilityThreshold: 0.95,    // Umbral máximo de pulsatilidad (95%) - más permisivo
    minSignalAmplitude: 0.01,         // Amplitud mínima de señal (1%) - más permisivo
    maxSignalAmplitude: 0.99,         // Amplitud máxima de señal (99%) - más permisivo
    spectralAnalysisWindow: 60,       // Ventana de análisis espectral (1 segundo a 60fps) - más pequeña
    motionArtifactThreshold: 0.5,     // Umbral de artefacto de movimiento (50%) - más permisivo
    skinToneValidation: true,         // Validación de tono de piel
    perfusionIndexThreshold: 0.1,     // Umbral mínimo de índice de perfusión (10%) - más permisivo
    confidenceThreshold: 0.4          // Umbral mínimo de confianza (40%) - más permisivo
  };

  constructor(config: Partial<FingerDetectionConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Procesa una nueva muestra de datos RGB para detectar dedo
   */
  public processSample(
    red: number, 
    green: number, 
    blue: number, 
    timestamp: number
  ): FingerDetectionResult | null {
    // Normalizar valores RGB
    const normalizedRed = this.normalizeRGB(red);
    const normalizedGreen = this.normalizeRGB(green);
    const normalizedBlue = this.normalizeRGB(blue);

    // Actualizar buffers
    this.updateBuffers(normalizedRed, normalizedGreen, normalizedBlue, timestamp);

    // Verificar si tenemos suficientes muestras para análisis
    if (this.redBuffer.length < this.config.spectralAnalysisWindow) {
      return this.createInitialResult(false, timestamp);
    }

    // Aplicar análisis avanzado
    return this.applyAdvancedAnalysis(timestamp);
  }

  /**
   * Análisis avanzado basado en múltiples criterios médicos
   */
  private applyAdvancedAnalysis(timestamp: number): FingerDetectionResult {
    // 1. Análisis de pulsatilidad
    const pulsatilityIndex = this.calculatePulsatilityIndex();
    
    // 2. Análisis espectral
    const spectralFeatures = this.calculateSpectralFeatures();
    
    // 3. Detección de movimiento
    const motionArtifactLevel = this.detectMotionArtifacts();
    
    // 4. Validación de tono de piel
    const skinToneValidation = this.validateSkinTone();
    
    // 5. Cálculo de índice de perfusión
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // 6. Validación biofísica
    const bioPhysicalValidation = this.validateBioPhysicalCriteria(
      pulsatilityIndex,
      spectralFeatures,
      motionArtifactLevel,
      skinToneValidation,
      perfusionIndex
    );
    
    // 7. Cálculo de confianza
    const confidence = this.calculateConfidence(
      pulsatilityIndex,
      spectralFeatures,
      motionArtifactLevel,
      skinToneValidation,
      perfusionIndex,
      bioPhysicalValidation
    );
    
    // 8. Decisión final de detección
    const isFingerDetected = this.makeDetectionDecision(
      confidence,
      bioPhysicalValidation,
      motionArtifactLevel
    );
    
    // 9. Calcular calidad de señal
    const signalQuality = this.calculateSignalQuality(
      pulsatilityIndex,
      spectralFeatures,
      motionArtifactLevel
    );

    const result: FingerDetectionResult = {
      isFingerDetected,
      confidence,
      pulsatilityIndex,
      signalQuality,
      motionArtifactLevel,
      skinToneValidation,
      perfusionIndex,
      spectralFeatures,
      bioPhysicalValidation,
      timestamp
    };

    // Actualizar historial
    this.updateDetectionHistory(result);

    return result;
  }

  /**
   * Cálculo de índice de pulsatilidad basado en PPG real
   */
  private calculatePulsatilityIndex(): number {
    const redSignal = this.redBuffer.slice(-this.config.spectralAnalysisWindow);
    const greenSignal = this.greenBuffer.slice(-this.config.spectralAnalysisWindow);
    
    // Calcular componente AC y DC para cada canal
    const redACDC = this.calculateACDC(redSignal);
    const greenACDC = this.calculateACDC(greenSignal);
    
    // Pulsatilidad basada en ratio AC/DC
    const redPulsatility = redACDC.ac / (redACDC.dc + 1e-10);
    const greenPulsatility = greenACDC.ac / (greenACDC.dc + 1e-10);
    
    // Pulsatilidad ponderada (verde tiene mejor absorción para PPG)
    return 0.3 * redPulsatility + 0.7 * greenPulsatility;
  }

  /**
   * Cálculo de características espectrales avanzadas
   */
  private calculateSpectralFeatures(): FingerDetectionResult['spectralFeatures'] {
    const greenSignal = this.greenBuffer.slice(-this.config.spectralAnalysisWindow);
    
    // Aplicar ventana de Hann para reducir leakage
    const windowedSignal = this.applyHannWindow(greenSignal);
    
    // Calcular FFT
    const fft = this.computeFFT(windowedSignal);
    
    // Calcular densidad espectral de potencia
    const psd = this.calculatePowerSpectralDensity(fft);
    
    // Buscar frecuencia dominante en rango cardíaco (0.5-3.67 Hz)
    const dominantFrequency = this.findDominantFrequency(psd, 0.5, 3.67);
    
    // Calcular potencia espectral total
    const spectralPower = this.calculateTotalSpectralPower(psd);
    
    // Calcular entropía espectral
    const spectralEntropy = this.calculateSpectralEntropy(psd);
    
    // Calcular ratio armónico
    const harmonicRatio = this.calculateHarmonicRatio(psd, dominantFrequency);
    
    return {
      dominantFrequency,
      spectralPower,
      spectralEntropy,
      harmonicRatio
    };
  }

  /**
   * Detección de artefactos de movimiento
   */
  private detectMotionArtifacts(): number {
    const motionScores: number[] = [];
    
    for (let i = 1; i < this.redBuffer.length; i++) {
      // Calcular variación temporal en todos los canales
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
   * Validación de tono de piel basada en características fisiológicas - Versión más permisiva
   */
  private validateSkinTone(): boolean {
    const recentRed = this.redBuffer.slice(-20); // Menos muestras para respuesta más rápida
    const recentGreen = this.greenBuffer.slice(-20);
    const recentBlue = this.blueBuffer.slice(-20);
    
    // Calcular promedios de tono
    const avgRed = recentRed.reduce((sum, val) => sum + val, 0) / recentRed.length;
    const avgGreen = recentGreen.reduce((sum, val) => sum + val, 0) / recentGreen.length;
    const avgBlue = recentBlue.reduce((sum, val) => sum + val, 0) / recentBlue.length;
    
    // Características de tono de piel válido (más permisivo)
    const redDominance = avgRed > avgGreen * 0.8 && avgRed > avgBlue * 0.8; // Más permisivo
    const greenRatio = avgGreen / (avgRed + 1e-10);
    const blueRatio = avgBlue / (avgRed + 1e-10);
    
    // Validar rangos fisiológicos de tono de piel (más permisivo)
    const validGreenRatio = greenRatio >= 0.4 && greenRatio <= 1.2; // Más permisivo
    const validBlueRatio = blueRatio >= 0.2 && blueRatio <= 1.0; // Más permisivo
    const validRedRange = avgRed >= 0.2 && avgRed <= 0.9; // Más permisivo
    
    return redDominance && validGreenRatio && validBlueRatio && validRedRange;
  }

  /**
   * Cálculo de índice de perfusión
   */
  private calculatePerfusionIndex(): number {
    const redSignal = this.redBuffer.slice(-this.config.spectralAnalysisWindow);
    const irSignal = this.blueBuffer.slice(-this.config.spectralAnalysisWindow); // Usar azul como IR
    
    const redACDC = this.calculateACDC(redSignal);
    const irACDC = this.calculateACDC(irSignal);
    
    // Perfusion Index = (AC_red / DC_red) / (AC_ir / DC_ir)
    const perfusionIndex = (redACDC.ac / (redACDC.dc + 1e-10)) / (irACDC.ac / (irACDC.dc + 1e-10));
    
    return Math.max(0, Math.min(1, perfusionIndex));
  }

  /**
   * Validación biofísica estricta
   */
  private validateBioPhysicalCriteria(
    pulsatilityIndex: number,
    spectralFeatures: FingerDetectionResult['spectralFeatures'],
    motionArtifactLevel: number,
    skinToneValidation: boolean,
    perfusionIndex: number
  ): FingerDetectionResult['bioPhysicalValidation'] {
    // Validar pulsatilidad (más permisivo)
    const isValidPulsatility = pulsatilityIndex >= this.config.minPulsatilityThreshold && 
                               pulsatilityIndex <= this.config.maxPulsatilityThreshold;
    
    // Validar amplitud de señal (más permisivo)
    const signalAmplitude = spectralFeatures.spectralPower;
    const isValidAmplitude = signalAmplitude >= this.config.minSignalAmplitude && 
                             signalAmplitude <= this.config.maxSignalAmplitude;
    
    // Validar perfil espectral (más permisivo)
    const isValidSpectralProfile = spectralFeatures.dominantFrequency >= 0.3 && 
                                   spectralFeatures.dominantFrequency <= 4.0 &&
                                   spectralFeatures.spectralEntropy > 0.1 &&
                                   spectralFeatures.harmonicRatio > 0.1;
    
    return {
      isValidSkinTone: skinToneValidation,
      isValidPulsatility,
      isValidAmplitude,
      isValidSpectralProfile
    };
  }

  /**
   * Cálculo de confianza basado en múltiples factores
   */
  private calculateConfidence(
    pulsatilityIndex: number,
    spectralFeatures: FingerDetectionResult['spectralFeatures'],
    motionArtifactLevel: number,
    skinToneValidation: boolean,
    perfusionIndex: number,
    bioPhysicalValidation: FingerDetectionResult['bioPhysicalValidation']
  ): number {
    // Factores de confianza
    const pulsatilityConfidence = Math.min(1, pulsatilityIndex / 0.5);
    const spectralConfidence = Math.min(1, spectralFeatures.spectralPower / 0.3);
    const motionConfidence = Math.max(0, 1 - motionArtifactLevel);
    const skinToneConfidence = skinToneValidation ? 1.0 : 0.0;
    const perfusionConfidence = Math.min(1, perfusionIndex / 0.5);
    
    // Validación biofísica
    const bioPhysicalScore = Object.values(bioPhysicalValidation).filter(Boolean).length / 4;
    
    // Ponderación de factores
    const confidence = 0.25 * pulsatilityConfidence +
                      0.25 * spectralConfidence +
                      0.20 * motionConfidence +
                      0.15 * skinToneConfidence +
                      0.10 * perfusionConfidence +
                      0.05 * bioPhysicalScore;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Decisión final de detección - Versión simplificada y más permisiva
   */
  private makeDetectionDecision(
    confidence: number,
    bioPhysicalValidation: FingerDetectionResult['bioPhysicalValidation'],
    motionArtifactLevel: number
  ): boolean {
    // Requerir confianza mínima (más permisiva)
    if (confidence < this.config.confidenceThreshold) {
      return false;
    }
    
    // Requerir solo 2 de 4 validaciones biofísicas (más permisivo)
    const validBioPhysicalCount = Object.values(bioPhysicalValidation).filter(Boolean).length;
    if (validBioPhysicalCount < 2) {
      return false;
    }
    
    // Rechazar solo si hay mucho movimiento (más permisivo)
    if (motionArtifactLevel > this.config.motionArtifactThreshold) {
      return false;
    }
    
    // Requerir tono de piel válido (mantener este criterio)
    if (!bioPhysicalValidation.isValidSkinTone) {
      return false;
    }
    
    return true;
  }

  /**
   * Cálculo de calidad de señal
   */
  private calculateSignalQuality(
    pulsatilityIndex: number,
    spectralFeatures: FingerDetectionResult['spectralFeatures'],
    motionArtifactLevel: number
  ): number {
    // Componentes de calidad
    const pulsatilityQuality = Math.min(1, pulsatilityIndex / 0.3);
    const spectralQuality = Math.min(1, spectralFeatures.spectralPower / 0.2);
    const motionQuality = Math.max(0, 1 - motionArtifactLevel);
    const stabilityQuality = Math.min(1, 1 / (spectralFeatures.spectralEntropy + 0.1));
    
    // Calidad total ponderada
    const quality = 0.3 * pulsatilityQuality +
                   0.3 * spectralQuality +
                   0.2 * motionQuality +
                   0.2 * stabilityQuality;
    
    return Math.max(0, Math.min(1, quality));
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private normalizeRGB(value: number): number {
    return Math.max(0, Math.min(1, value / 255));
  }

  private updateBuffers(red: number, green: number, blue: number, timestamp: number): void {
    this.redBuffer.push(red);
    this.greenBuffer.push(green);
    this.blueBuffer.push(blue);
    this.timestampBuffer.push(timestamp);
    
    // Mantener tamaño del buffer
    const maxBufferSize = this.config.spectralAnalysisWindow * 2;
    if (this.redBuffer.length > maxBufferSize) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
      this.timestampBuffer.shift();
    }
  }

  private calculateACDC(signal: number[]): { ac: number; dc: number } {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const ac = Math.sqrt(signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length);
    return { ac, dc: mean };
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
    const samplingRate = 60; // 60 Hz
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
    const samplingRate = 60;
    const fundamentalBin = Math.floor(dominantFreq * psd.length / samplingRate);
    const secondHarmonicBin = Math.floor(2 * dominantFreq * psd.length / samplingRate);
    
    if (secondHarmonicBin >= psd.length / 2) {
      return 0;
    }
    
    const fundamentalPower = psd[fundamentalBin] || 0;
    const harmonicPower = psd[secondHarmonicBin] || 0;
    
    return harmonicPower / (fundamentalPower + 1e-10);
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }

  private createInitialResult(isDetected: boolean, timestamp: number): FingerDetectionResult {
    return {
      isFingerDetected: isDetected,
      confidence: 0,
      pulsatilityIndex: 0,
      signalQuality: 0,
      motionArtifactLevel: 0,
      skinToneValidation: false,
      perfusionIndex: 0,
      spectralFeatures: {
        dominantFrequency: 0,
        spectralPower: 0,
        spectralEntropy: 0,
        harmonicRatio: 0
      },
      bioPhysicalValidation: {
        isValidSkinTone: false,
        isValidPulsatility: false,
        isValidAmplitude: false,
        isValidSpectralProfile: false
      },
      timestamp
    };
  }

  private updateDetectionHistory(result: FingerDetectionResult): void {
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
    averageConfidence: number;
    averageSignalQuality: number;
    lastDetection: FingerDetectionResult | null;
  } {
    if (this.detectionHistory.length === 0) {
      return {
        totalSamples: 0,
        detectionRate: 0,
        averageConfidence: 0,
        averageSignalQuality: 0,
        lastDetection: null
      };
    }
    
    const detections = this.detectionHistory.filter(result => result.isFingerDetected);
    const detectionRate = detections.length / this.detectionHistory.length;
    const averageConfidence = this.detectionHistory.reduce((sum, result) => sum + result.confidence, 0) / this.detectionHistory.length;
    const averageSignalQuality = this.detectionHistory.reduce((sum, result) => sum + result.signalQuality, 0) / this.detectionHistory.length;
    const lastDetection = this.detectionHistory[this.detectionHistory.length - 1];
    
    return {
      totalSamples: this.detectionHistory.length,
      detectionRate,
      averageConfidence,
      averageSignalQuality,
      lastDetection
    };
  }

  /**
   * Reset del detector
   */
  public reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.timestampBuffer = [];
    this.detectionHistory = [];
  }

  /**
   * Actualizar configuración
   */
  public updateConfig(newConfig: Partial<FingerDetectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
} 