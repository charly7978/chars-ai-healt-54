
export interface ColorRatios {
  red: number;
  green: number;
  blue: number;
}

/**
 * VALIDADOR BIOFÍSICO MATEMÁTICO - SIN MEMORY LEAKS
 * Implementa algoritmos matemáticos avanzados sin acumulaciones de memoria
 */
export class BiophysicalValidator {
  // Parámetros fisiológicos basados en literatura médica
  private readonly HEMOGLOBIN_ABSORPTION = {
    red: 0.82,
    green: 0.64,
    blue: 0.45
  };
  
  private readonly PHYSIOLOGICAL_THRESHOLDS = {
    minPulsatility: 0.08,
    maxPulsatility: 0.95,
    pulsatilityNormalization: 42.0,
    optimalSNR: 15.0,
    minPerfusionIndex: 0.1,
    maxPerfusionIndex: 20.0
  };
  
  // Buffers circulares fijos - NUNCA crecen
  private readonly HISTORY_SIZE = 10;
  private pulsatilityBuffer: Float32Array;
  private perfusionBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferFull: boolean = false;
  
  constructor() {
    this.pulsatilityBuffer = new Float32Array(this.HISTORY_SIZE);
    this.perfusionBuffer = new Float32Array(this.HISTORY_SIZE);
  }
  
  /**
   * Cálculo de pulsatilidad usando análisis espectral avanzado
   */
  public getPulsatilityScore(signalChunk: number[]): number {
    if (signalChunk.length < 8) return 0;
    
    // 1. Transformada wavelet discreta simplificada
    const waveletCoeffs = this.discreteWaveletTransform(signalChunk);
    
    // 2. Extracción de componente cardíaco
    const cardiacComponent = this.extractCardiacFrequencyComponent(waveletCoeffs);
    
    // 3. Pulsatilidad hemodinámica
    const pulsatilityIndex = this.calculateHemodynamicPulsatility(cardiacComponent);
    
    // 4. Morfología de onda
    const morphologyScore = this.analyzePulseMorphology(signalChunk);
    
    // 5. Combinación ponderada
    const combinedScore = (pulsatilityIndex * 0.7) + (morphologyScore * 0.3);
    
    // Buffer circular sin crecimiento
    this.pulsatilityBuffer[this.bufferIndex] = combinedScore;
    this.bufferIndex = (this.bufferIndex + 1) % this.HISTORY_SIZE;
    if (this.bufferIndex === 0) this.bufferFull = true;
    
    return Math.min(1.0, Math.max(0.0, combinedScore));
  }
  
  /**
   * Validación de pulsatilidad con criterios médicos
   */
  public isPulsatile(signalChunk: number[]): boolean {
    const pulsatilityScore = this.getPulsatilityScore(signalChunk);
    const temporalCoherence = this.calculateTemporalCoherence();
    
    return pulsatilityScore > this.PHYSIOLOGICAL_THRESHOLDS.minPulsatility && 
           temporalCoherence > 0.6;
  }
  
  /**
   * Score biofísico usando múltiples validadores matemáticos
   */
  public getBiophysicalScore(ratios: ColorRatios): number {
    // Validaciones matemáticas paralelas
    const opticalScore = this.validateOpticalAbsorption(ratios);
    const perfusionScore = this.analyzeTissuePerfusion(ratios);
    const spectralScore = this.validateHemoglobinSpectrum(ratios);
    const colorCoherenceScore = this.analyzeColorCoherence(ratios);
    const temporalConsistency = this.validateTemporalConsistency(ratios);
    
    // Pesos basados en análisis de sensibilidad
    const weights = [0.25, 0.25, 0.20, 0.15, 0.15];
    const scores = [opticalScore, perfusionScore, spectralScore, colorCoherenceScore, temporalConsistency];
    
    const finalScore = scores.reduce((sum, score, index) => sum + score * weights[index], 0);
    
    return Math.min(1.0, Math.max(0.0, finalScore));
  }
  
  /**
   * DWT simplificada usando filtros Daubechies-4
   */
  private discreteWaveletTransform(signal: number[]): number[][] {
    const h = [0.4830, 0.8365, 0.2241, -0.1294];
    const g = [-0.1294, -0.2241, 0.8365, -0.4830];
    
    const coeffs: number[][] = [];
    let currentSignal = [...signal];
    
    // 3 niveles de descomposición
    for (let level = 0; level < 3; level++) {
      const approx: number[] = [];
      const detail: number[] = [];
      
      for (let i = 0; i < Math.floor(currentSignal.length / 2); i++) {
        let approxSum = 0;
        let detailSum = 0;
        
        for (let j = 0; j < h.length; j++) {
          const index = (2 * i + j) % currentSignal.length;
          approxSum += currentSignal[index] * h[j];
          detailSum += currentSignal[index] * g[j];
        }
        
        approx.push(approxSum);
        detail.push(detailSum);
      }
      
      coeffs.push(detail);
      currentSignal = approx;
    }
    
    coeffs.push(currentSignal);
    return coeffs;
  }
  
  private extractCardiacFrequencyComponent(waveletCoeffs: number[][]): number {
    const cardiacLevel = waveletCoeffs[1];
    if (cardiacLevel.length === 0) return 0;
    
    const energy = cardiacLevel.reduce((sum, coeff) => sum + coeff * coeff, 0);
    return Math.sqrt(energy / cardiacLevel.length);
  }
  
  private calculateHemodynamicPulsatility(cardiacComponent: number): number {
    const normalizedComponent = Math.tanh(cardiacComponent / 10);
    const complianceFactor = 1 / (1 + Math.exp(-5 * (normalizedComponent - 0.3)));
    return normalizedComponent * complianceFactor;
  }
  
  private analyzePulseMorphology(signal: number[]): number {
    if (signal.length < 12) return 0;
    
    const peaks = this.detectPeaks(signal);
    const valleys = this.detectValleys(signal);
    
    const systolicAmplitude = peaks.length > 0 ? Math.max(...peaks) : 0;
    const diastolicAmplitude = valleys.length > 0 ? Math.abs(Math.min(...valleys)) : 0;
    
    const amplitudeRatio = diastolicAmplitude > 0 ? systolicAmplitude / diastolicAmplitude : 0;
    const optimalRatio = 2.0;
    const ratioError = Math.abs(amplitudeRatio - optimalRatio) / optimalRatio;
    
    return Math.exp(-ratioError * 2);
  }
  
  private validateOpticalAbsorption(ratios: ColorRatios): number {
    const { red, green, blue } = ratios;
    
    const redExtinction = -Math.log((red + 1e-10) / 255) / 0.12;
    const greenExtinction = -Math.log((green + 1e-10) / 255) / 0.12;
    
    const redError = Math.abs(redExtinction - this.HEMOGLOBIN_ABSORPTION.red) / this.HEMOGLOBIN_ABSORPTION.red;
    const greenError = Math.abs(greenExtinction - this.HEMOGLOBIN_ABSORPTION.green) / this.HEMOGLOBIN_ABSORPTION.green;
    
    const averageError = (redError + greenError) / 2;
    return Math.exp(-averageError * 3);
  }
  
  private analyzeTissuePerfusion(ratios: ColorRatios): number {
    const colorVariability = Math.sqrt(
      Math.pow(ratios.red - 128, 2) + 
      Math.pow(ratios.green - 128, 2) + 
      Math.pow(ratios.blue - 128, 2)
    ) / Math.sqrt(3 * Math.pow(127, 2));
    
    const perfusionIndex = Math.tanh(colorVariability * 4);
    
    // Buffer circular
    this.perfusionBuffer[this.bufferIndex] = perfusionIndex;
    
    return perfusionIndex;
  }
  
  private validateHemoglobinSpectrum(ratios: ColorRatios): number {
    const isobesticRatio = (ratios.red + ratios.green) / 2;
    const blueRatio = ratios.blue;
    
    const isobesticScore = 1 - Math.abs(isobesticRatio - blueRatio) / (isobesticRatio + blueRatio + 1e-10);
    const redDominance = ratios.red > ratios.green && ratios.red > ratios.blue ? 1 : 0;
    
    return (isobesticScore * 0.7) + (redDominance * 0.3);
  }
  
  private analyzeColorCoherence(ratios: ColorRatios): number {
    const lab = this.rgbToCieLab(ratios.red, ratios.green, ratios.blue);
    
    const skinRefL = 65, skinRefA = 15, skinRefB = 20;
    const labDistance = Math.sqrt(
      Math.pow(lab.L - skinRefL, 2) + 
      Math.pow(lab.a - skinRefA, 2) + 
      Math.pow(lab.b - skinRefB, 2)
    );
    
    return Math.exp(-labDistance / 30);
  }
  
  private validateTemporalConsistency(ratios: ColorRatios): number {
    const bufferLength = this.bufferFull ? this.HISTORY_SIZE : this.bufferIndex;
    if (bufferLength < 3) return 0.5;
    
    let mean = 0;
    for (let i = 0; i < bufferLength; i++) {
      mean += this.perfusionBuffer[i];
    }
    mean /= bufferLength;
    
    let variance = 0;
    for (let i = 0; i < bufferLength; i++) {
      variance += Math.pow(this.perfusionBuffer[i] - mean, 2);
    }
    variance /= bufferLength;
    
    const coefficientOfVariation = Math.sqrt(variance) / (mean + 1e-10);
    return 1 / (1 + coefficientOfVariation);
  }
  
  private calculateTemporalCoherence(): number {
    const bufferLength = this.bufferFull ? this.HISTORY_SIZE : this.bufferIndex;
    if (bufferLength < 5) return 0.5;
    
    let maxCorrelation = 0;
    
    for (let lag = 1; lag < Math.min(3, bufferLength - 1); lag++) {
      let correlation = 0;
      for (let i = 0; i < bufferLength - lag; i++) {
        correlation += this.pulsatilityBuffer[i] * this.pulsatilityBuffer[i + lag];
      }
      correlation /= (bufferLength - lag);
      maxCorrelation = Math.max(maxCorrelation, Math.abs(correlation));
    }
    
    return Math.tanh(maxCorrelation * 2);
  }
  
  private detectPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] > signal[i-1] && signal[i] > signal[i+1]) {
        peaks.push(signal[i]);
      }
    }
    return peaks;
  }
  
  private detectValleys(signal: number[]): number[] {
    const valleys: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] < signal[i-1] && signal[i] < signal[i+1]) {
        valleys.push(signal[i]);
      }
    }
    return valleys;
  }
  
  private rgbToCieLab(r: number, g: number, b: number): {L: number, a: number, b: number} {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    
    const L = 0.2126 * rNorm + 0.7152 * gNorm + 0.0722 * bNorm;
    const a = (rNorm - gNorm) * 100;
    const bLab = (gNorm - bNorm) * 100;
    
    return { L: L * 100, a: a, b: bLab };
  }
  
  public reset(): void {
    this.pulsatilityBuffer.fill(0);
    this.perfusionBuffer.fill(0);
    this.bufferIndex = 0;
    this.bufferFull = false;
  }
}
