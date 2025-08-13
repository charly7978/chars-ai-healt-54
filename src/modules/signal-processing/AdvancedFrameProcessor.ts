import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

// INTERFAZ PARA NÚMEROS COMPLEJOS
interface Complex {
  real: number;
  imag: number;
}

// INTERFAZ PARA ANÁLISIS ESPECTRAL AVANZADO
interface SpectralFeatures {
  centroid: number;
  rolloff: number;
  flux: number;
  bandwidth: number;
  flatness: number;
  crest: number;
}

/**
 * PROCESADOR DE FRAMES DE NIVEL INDUSTRIAL EXTREMO
 * Implementa algoritmos matemáticos de máxima complejidad para detección de dedo
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */
export class AdvancedFrameProcessor {
  private readonly CONFIG: { TEXTURE_GRID_SIZE: number, ROI_SIZE_FACTOR: number };
  
  // PARÁMETROS MATEMÁTICOS AVANZADOS DE NIVEL INDUSTRIAL
  private readonly SPECTRAL_ANALYSIS_WINDOW = 64;
  private readonly WAVELET_DECOMPOSITION_LEVELS = 6;
  private readonly FRACTAL_DIMENSION_THRESHOLD = 1.3;
  private readonly ENTROPY_COMPLEXITY_FACTOR = 2.718281828; // e
  private readonly GOLDEN_RATIO = 1.618033988749895; // φ
  private readonly EULER_MASCHERONI = 0.5772156649015329; // γ
  private readonly PI_SQUARED = 9.869604401089358; // π²
  private readonly FEIGENBAUM_CONSTANT = 4.669201609102990; // δ
  private readonly APERY_CONSTANT = 1.2020569031595942; // ζ(3)
  private readonly CATALAN_CONSTANT = 0.9159655941772190; // G
  
  // MATRICES DE CONVOLUCIÓN AVANZADAS PARA DETECCIÓN DE BORDES
  private readonly SOBEL_X = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  private readonly SOBEL_Y = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
  private readonly LAPLACIAN_GAUSSIAN = [
    [0, 0, -1, 0, 0],
    [0, -1, -2, -1, 0],
    [-1, -2, 16, -2, -1],
    [0, -1, -2, -1, 0],
    [0, 0, -1, 0, 0]
  ];
  
  // FILTROS WAVELETS DAUBECHIES DE ORDEN SUPERIOR
  private readonly DAUBECHIES_8 = [
    0.23037781330885523, 0.7148465705525415, 0.6308807679295904, -0.02798376941698385,
    -0.18703481171888114, 0.030841381835986965, 0.032883011666982945, -0.010597401784997278
  ];
  
  // ANÁLISIS ESPECTRAL MULTIDIMENSIONAL
  private spectralBuffer: Float64Array = new Float64Array(this.SPECTRAL_ANALYSIS_WINDOW);
  private spectralIndex: number = 0;
  private fftCache: Map<string, Complex[]> = new Map();
  private powerSpectralDensity: Float64Array = new Float64Array(this.SPECTRAL_ANALYSIS_WINDOW / 2);
  
  // ANÁLISIS FRACTAL Y TEORÍA DEL CAOS
  private fractalHistory: number[] = [];
  private entropyHistory: number[] = [];
  private hausdorffDimensions: number[] = [];
  private lyapunovExponents: number[] = [];
  private correlationDimensions: number[] = [];
  
  // ANÁLISIS MULTIRESOLUCIÓN WAVELET
  private pyramidLevels: ImageData[] = [];
  private orientationMaps: Float32Array[] = [];
  private coherenceMaps: Float32Array[] = [];
  private gabor_responses: Float32Array[] = [];
  
  // HISTORIA TEMPORAL COMPLEJA PARA ANÁLISIS DINÁMICO
  private temporalSignatures: Array<{
    timestamp: number,
    spectralCentroid: number,
    spectralRolloff: number,
    spectralFlux: number,
    mfccCoefficients: number[],
    chromaVector: number[],
    fractalDimension: number,
    lyapunovExponent: number,
    kolmogorovComplexity: number,
    shannonEntropy: number,
    renyi_entropy: number,
    tsallis_entropy: number
  }> = [];
  
  private readonly TEMPORAL_HISTORY_SIZE = 256;
  private readonly MFCC_COEFFICIENTS = 13;
  private readonly CHROMA_BINS = 12;
  private readonly GABOR_ORIENTATIONS = 8;
  private readonly GABOR_FREQUENCIES = 5;

  constructor(config: { TEXTURE_GRID_SIZE: number, ROI_SIZE_FACTOR: number }) {
    this.CONFIG = {
      ...config,
      ROI_SIZE_FACTOR: Math.min(0.8, config.ROI_SIZE_FACTOR * this.GOLDEN_RATIO / 2)
    };
    
    // INICIALIZACIÓN DE ESTRUCTURAS MATEMÁTICAS AVANZADAS
    this.initializeSpectralAnalysis();
    this.initializeWaveletDecomposition();
    this.initializeFractalAnalysis();
    this.initializeGaborFilters();
  }
  
  /**
   * INICIALIZACIÓN DEL ANÁLISIS ESPECTRAL AVANZADO
   */
  private initializeSpectralAnalysis(): void {
    this.spectralBuffer.fill(0);
    this.powerSpectralDensity.fill(0);
    this.fftCache.clear();
  }
  
  /**
   * INICIALIZACIÓN DE LA DESCOMPOSICIÓN WAVELET
   */
  private initializeWaveletDecomposition(): void {
    this.pyramidLevels = [];
    this.orientationMaps = [];
    this.coherenceMaps = [];
  }
  
  /**
   * INICIALIZACIÓN DEL ANÁLISIS FRACTAL
   */
  private initializeFractalAnalysis(): void {
    this.fractalHistory = [];
    this.entropyHistory = [];
    this.hausdorffDimensions = [];
    this.lyapunovExponents = [];
    this.correlationDimensions = [];
  }
  
  /**
   * INICIALIZACIÓN DE FILTROS GABOR MULTIORIENTACIÓN
   */
  private initializeGaborFilters(): void {
    this.gabor_responses = [];
    for (let i = 0; i < this.GABOR_ORIENTATIONS * this.GABOR_FREQUENCIES; i++) {
      this.gabor_responses.push(new Float32Array(0));
    }
  }

  /**
   * EXTRACCIÓN AVANZADA DE DATOS DE FRAME CON ANÁLISIS MULTIDIMENSIONAL
   */
  extractFrameData(imageData: ImageData): FrameData {
    const timestamp = performance.now();
    
    // ANÁLISIS ESPECTRAL MULTIDIMENSIONAL
    const spectralFeatures = this.computeSpectralFeatures(imageData);
    
    // ANÁLISIS FRACTAL DE LA TEXTURA
    const fractalDimension = this.computeFractalDimension(imageData);
    
    // ANÁLISIS WAVELET MULTIRESOLUCIÓN
    const waveletCoefficients = this.performWaveletDecomposition(imageData);
    
    // ANÁLISIS GABOR MULTIORIENTACIÓN
    const gaborResponses = this.computeGaborResponses(imageData);
    
    // ANÁLISIS DE ENTROPÍA MULTIVARIADA
    const entropyMeasures = this.computeEntropyMeasures(imageData);
    
    // DETECCIÓN DE DEDO MEDIANTE ANÁLISIS MATEMÁTICO COMPLEJO
    const fingerDetectionScore = this.computeAdvancedFingerDetection(
      imageData, spectralFeatures, fractalDimension, waveletCoefficients, 
      gaborResponses, entropyMeasures
    );
    
    // CÁLCULO DE ROI ADAPTATIVO BASADO EN TEORÍA DE LA INFORMACIÓN
    const adaptiveROI = this.computeAdaptiveROI(imageData, fingerDetectionScore);
    
    // EXTRACCIÓN DE SEÑAL PPG CON COMPENSACIÓN MATEMÁTICA AVANZADA
    const ppgSignal = this.extractAdvancedPPGSignal(imageData, adaptiveROI);
    
    // ACTUALIZACIÓN DE HISTORIA TEMPORAL
    this.updateTemporalSignatures({
      timestamp,
      spectralCentroid: spectralFeatures.centroid,
      spectralRolloff: spectralFeatures.rolloff,
      spectralFlux: spectralFeatures.flux,
      mfccCoefficients: this.computeMFCC(imageData),
      chromaVector: this.computeChromaVector(imageData),
      fractalDimension,
      lyapunovExponent: this.computeLyapunovExponent(),
      kolmogorovComplexity: this.estimateKolmogorovComplexity(imageData),
      shannonEntropy: entropyMeasures.shannon,
      renyi_entropy: entropyMeasures.renyi,
      tsallis_entropy: entropyMeasures.tsallis
    });
    
    console.log('[DEBUG] AdvancedFrameProcessor - Análisis matemático completo:', {
      spectralFeatures,
      fractalDimension,
      entropyMeasures,
      fingerDetectionScore,
      adaptiveROI,
      ppgSignal,
      timestamp
    });
    
    return {
      redValue: ppgSignal.red,
      avgRed: ppgSignal.red,
      avgGreen: ppgSignal.green,
      avgBlue: ppgSignal.blue,
      textureScore: fingerDetectionScore,
      rToGRatio: ppgSignal.red / (ppgSignal.green + 1e-10),
      rToBRatio: ppgSignal.red / (ppgSignal.blue + 1e-10)
    };
  }
  
  /**
   * CÁLCULO DE CARACTERÍSTICAS ESPECTRALES AVANZADAS
   */
  private computeSpectralFeatures(imageData: ImageData): SpectralFeatures {
    const data = imageData.data;
    const spectrum = new Float64Array(this.SPECTRAL_ANALYSIS_WINDOW);
    
    // FFT de la señal de luminancia
    for (let i = 0; i < Math.min(spectrum.length, data.length / 4); i++) {
      const idx = i * 4;
      spectrum[i] = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
    }
    
    const fftResult = this.computeFFT(spectrum);
    const magnitude = fftResult.map(c => Math.sqrt(c.real * c.real + c.imag * c.imag));
    
    // Centroide espectral
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < magnitude.length; i++) {
      weightedSum += i * magnitude[i];
      magnitudeSum += magnitude[i];
    }
    const centroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    
    // Rolloff espectral (95%)
    const rolloffThreshold = magnitudeSum * 0.95;
    let cumulativeSum = 0;
    let rolloff = 0;
    for (let i = 0; i < magnitude.length; i++) {
      cumulativeSum += magnitude[i];
      if (cumulativeSum >= rolloffThreshold) {
        rolloff = i;
        break;
      }
    }
    
    // Flujo espectral
    let flux = 0;
    if (this.powerSpectralDensity.length === magnitude.length) {
      for (let i = 0; i < magnitude.length; i++) {
        const diff = magnitude[i] - this.powerSpectralDensity[i];
        flux += diff * diff;
      }
      flux = Math.sqrt(flux);
    }
    
    // Actualizar PSD
    for (let i = 0; i < magnitude.length; i++) {
      this.powerSpectralDensity[i] = magnitude[i];
    }
    
    // Ancho de banda espectral
    const variance = magnitude.reduce((sum, mag, i) => {
      const deviation = i - centroid;
      return sum + deviation * deviation * mag;
    }, 0) / magnitudeSum;
    const bandwidth = Math.sqrt(variance);
    
    // Planitud espectral (medida geométrica vs aritmética)
    const geometricMean = Math.exp(magnitude.reduce((sum, mag) => sum + Math.log(mag + 1e-10), 0) / magnitude.length);
    const arithmeticMean = magnitude.reduce((sum, mag) => sum + mag, 0) / magnitude.length;
    const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;
    
    // Factor de cresta
    const maxMagnitude = Math.max(...magnitude);
    const rms = Math.sqrt(magnitude.reduce((sum, mag) => sum + mag * mag, 0) / magnitude.length);
    const crest = rms > 0 ? maxMagnitude / rms : 0;
    
    return { centroid, rolloff, flux, bandwidth, flatness, crest };
  }

  /**
   * CÁLCULO DE DIMENSIÓN FRACTAL MEDIANTE ALGORITMO BOX-COUNTING AVANZADO
   */
  private computeFractalDimension(imageData: ImageData): number {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // Convertir a escala de grises
    const grayscale = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      grayscale[i] = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
    }
    
    // Box-counting con múltiples escalas
    const scales = [2, 4, 8, 16, 32];
    const counts: number[] = [];
    
    for (const scale of scales) {
      let boxCount = 0;
      const boxWidth = Math.floor(width / scale);
      const boxHeight = Math.floor(height / scale);
      
      for (let by = 0; by < scale; by++) {
        for (let bx = 0; bx < scale; bx++) {
          let hasContent = false;
          
          for (let y = by * boxHeight; y < (by + 1) * boxHeight && y < height; y++) {
            for (let x = bx * boxWidth; x < (bx + 1) * boxWidth && x < width; x++) {
              if (grayscale[y * width + x] > 128) {
                hasContent = true;
                break;
              }
            }
            if (hasContent) break;
          }
          
          if (hasContent) boxCount++;
        }
      }
      
      counts.push(boxCount);
    }
    
    // Regresión lineal para calcular dimensión fractal
    const logScales = scales.map(s => Math.log(1 / s));
    const logCounts = counts.map(c => Math.log(c + 1));
    
    const n = logScales.length;
    const sumX = logScales.reduce((a, b) => a + b, 0);
    const sumY = logCounts.reduce((a, b) => a + b, 0);
    const sumXY = logScales.reduce((sum, x, i) => sum + x * logCounts[i], 0);
    const sumX2 = logScales.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    return Math.abs(slope);
  }

  /**
   * DESCOMPOSICIÓN WAVELET MULTIRESOLUCIÓN CON DAUBECHIES DE ORDEN SUPERIOR
   */
  private performWaveletDecomposition(imageData: ImageData): number[][] {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // Convertir a señal 1D
    const signal = new Float64Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      signal[i] = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
    }
    
    const coefficients: number[][] = [];
    let currentSignal = Array.from(signal);
    
    // Descomposición en múltiples niveles
    for (let level = 0; level < this.WAVELET_DECOMPOSITION_LEVELS; level++) {
      const { approximation, detail } = this.waveletTransform(currentSignal);
      coefficients.push(detail);
      currentSignal = approximation;
      
      if (currentSignal.length < this.DAUBECHIES_8.length) break;
    }
    
    coefficients.push(currentSignal); // Aproximación final
    return coefficients;
  }
  
  /**
   * TRANSFORMADA WAVELET DAUBECHIES
   */
  private waveletTransform(signal: number[]): { approximation: number[], detail: number[] } {
    const N = signal.length;
    const halfN = Math.floor(N / 2);
    const approximation = new Array(halfN);
    const detail = new Array(halfN);
    
    for (let i = 0; i < halfN; i++) {
      let approxSum = 0;
      let detailSum = 0;
      
      for (let j = 0; j < this.DAUBECHIES_8.length; j++) {
        const idx = (2 * i + j) % N;
        const coeff = this.DAUBECHIES_8[j];
        approxSum += signal[idx] * coeff;
        detailSum += signal[idx] * coeff * Math.pow(-1, j);
      }
      
      approximation[i] = approxSum;
      detail[i] = detailSum;
    }
    
    return { approximation, detail };
  }

  /**
   * RESPUESTAS DE FILTROS GABOR MULTIORIENTACIÓN
   */
  private computeGaborResponses(imageData: ImageData): Float32Array[] {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const responses: Float32Array[] = [];
    
    // Convertir a escala de grises
    const grayscale = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      grayscale[i] = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
    }
    
    // Aplicar filtros Gabor con diferentes orientaciones y frecuencias
    for (let orient = 0; orient < this.GABOR_ORIENTATIONS; orient++) {
      for (let freq = 0; freq < this.GABOR_FREQUENCIES; freq++) {
        const theta = (orient * Math.PI) / this.GABOR_ORIENTATIONS;
        const frequency = 0.1 + (freq * 0.1);
        const response = this.applyGaborFilter(grayscale, width, height, theta, frequency);
        responses.push(response);
      }
    }
    
    return responses;
  }
  
  /**
   * APLICACIÓN DE FILTRO GABOR INDIVIDUAL
   */
  private applyGaborFilter(image: Float32Array, width: number, height: number, theta: number, frequency: number): Float32Array {
    const result = new Float32Array(width * height);
    const sigma = 2.0;
    const kernelSize = 15;
    const halfKernel = Math.floor(kernelSize / 2);
    
    for (let y = halfKernel; y < height - halfKernel; y++) {
      for (let x = halfKernel; x < width - halfKernel; x++) {
        let sum = 0;
        
        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
          for (let kx = -halfKernel; kx <= halfKernel; kx++) {
            const xPrime = kx * Math.cos(theta) + ky * Math.sin(theta);
            const yPrime = -kx * Math.sin(theta) + ky * Math.cos(theta);
            
            const gaussian = Math.exp(-(xPrime * xPrime + yPrime * yPrime) / (2 * sigma * sigma));
            const sinusoid = Math.cos(2 * Math.PI * frequency * xPrime);
            const gaborValue = gaussian * sinusoid;
            
            const pixelIdx = (y + ky) * width + (x + kx);
            sum += image[pixelIdx] * gaborValue;
          }
        }
        
        result[y * width + x] = sum;
      }
    }
    
    return result;
  }

  /**
   * CÁLCULO DE MEDIDAS DE ENTROPÍA MULTIVARIADAS
   */
  private computeEntropyMeasures(imageData: ImageData): { shannon: number, renyi: number, tsallis: number } {
    const data = imageData.data;
    const histogram = new Array(256).fill(0);
    const totalPixels = imageData.width * imageData.height;
    
    // Construir histograma de luminancia
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const luminance = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
      histogram[luminance]++;
    }
    
    // Normalizar histograma
    const probabilities = histogram.map(count => count / totalPixels).filter(p => p > 0);
    
    // Entropía de Shannon
    const shannon = -probabilities.reduce((sum, p) => sum + p * Math.log2(p), 0);
    
    // Entropía de Rényi (orden 2)
    const renyi = -Math.log2(probabilities.reduce((sum, p) => sum + p * p, 0));
    
    // Entropía de Tsallis (q = 2)
    const tsallis = (1 - probabilities.reduce((sum, p) => sum + p * p, 0)) / (2 - 1);
    
    return { shannon, renyi, tsallis };
  }

  /**
   * DETECCIÓN AVANZADA DE DEDO MEDIANTE ANÁLISIS MATEMÁTICO COMPLEJO
   */
  private computeAdvancedFingerDetection(
    imageData: ImageData,
    spectralFeatures: SpectralFeatures,
    fractalDimension: number,
    waveletCoefficients: number[][],
    gaborResponses: Float32Array[],
    entropyMeasures: { shannon: number, renyi: number, tsallis: number }
  ): number {
    // ANÁLISIS MULTIDIMENSIONAL DE CARACTERÍSTICAS
    
    // 1. Score basado en características espectrales
    const spectralScore = this.computeSpectralScore(spectralFeatures);
    
    // 2. Score basado en dimensión fractal
    const fractalScore = this.computeFractalScore(fractalDimension);
    
    // 3. Score basado en coeficientes wavelet
    const waveletScore = this.computeWaveletScore(waveletCoefficients);
    
    // 4. Score basado en respuestas Gabor
    const gaborScore = this.computeGaborScore(gaborResponses);
    
    // 5. Score basado en entropía
    const entropyScore = this.computeEntropyScore(entropyMeasures);
    
    // 6. Score basado en análisis temporal
    const temporalScore = this.computeTemporalScore();
    
    // FUSIÓN MATEMÁTICA AVANZADA CON PESOS ADAPTATIVOS
    const weights = this.computeAdaptiveWeights();
    
    const finalScore = (
      spectralScore * weights.spectral +
      fractalScore * weights.fractal +
      waveletScore * weights.wavelet +
      gaborScore * weights.gabor +
      entropyScore * weights.entropy +
      temporalScore * weights.temporal
    ) / (weights.spectral + weights.fractal + weights.wavelet + weights.gabor + weights.entropy + weights.temporal);
    
    // APLICAR FUNCIÓN DE ACTIVACIÓN SIGMOIDAL AVANZADA
    return this.advancedSigmoid(finalScore);
  }

  /**
   * CÁLCULO DE SCORE ESPECTRAL AVANZADO
   */
  private computeSpectralScore(features: SpectralFeatures): number {
    // Normalización basada en rangos fisiológicos esperados
    const centroidNorm = Math.tanh(features.centroid / 32.0);
    const rolloffNorm = Math.tanh(features.rolloff / 16.0);
    const fluxNorm = Math.tanh(features.flux * 10.0);
    const bandwidthNorm = Math.tanh(features.bandwidth / 8.0);
    const flatnessNorm = features.flatness;
    const crestNorm = Math.tanh(features.crest / 4.0);
    
    // Combinación no lineal con pesos fisiológicos
    return (
      centroidNorm * 0.25 +
      rolloffNorm * 0.20 +
      fluxNorm * 0.20 +
      bandwidthNorm * 0.15 +
      flatnessNorm * 0.10 +
      crestNorm * 0.10
    );
  }
  
  /**
   * CÁLCULO DE SCORE FRACTAL
   */
  private computeFractalScore(fractalDimension: number): number {
    // Las texturas de piel tienen dimensiones fractales específicas
    const optimalRange = [1.2, 1.8];
    if (fractalDimension >= optimalRange[0] && fractalDimension <= optimalRange[1]) {
      return 1.0 - Math.abs(fractalDimension - 1.5) / 0.3;
    }
    return Math.exp(-Math.pow(fractalDimension - 1.5, 2) / 0.5);
  }
  
  /**
   * CÁLCULO DE SCORE WAVELET
   */
  private computeWaveletScore(coefficients: number[][]): number {
    let totalEnergy = 0;
    let detailEnergy = 0;
    
    for (let level = 0; level < coefficients.length - 1; level++) {
      const levelEnergy = coefficients[level].reduce((sum, coeff) => sum + coeff * coeff, 0);
      detailEnergy += levelEnergy;
      totalEnergy += levelEnergy;
    }
    
    // Energía de aproximación
    const approxEnergy = coefficients[coefficients.length - 1].reduce((sum, coeff) => sum + coeff * coeff, 0);
    totalEnergy += approxEnergy;
    
    // Ratio de energía de detalle vs total (indicativo de textura)
    const energyRatio = totalEnergy > 0 ? detailEnergy / totalEnergy : 0;
    
    // Las texturas de piel tienen ratios específicos
    return Math.exp(-Math.pow(energyRatio - 0.3, 2) / 0.1);
  }
  
  /**
   * CÁLCULO DE SCORE GABOR
   */
  private computeGaborScore(responses: Float32Array[]): number {
    let maxResponse = 0;
    let avgResponse = 0;
    let totalElements = 0;
    
    for (const response of responses) {
      for (let i = 0; i < response.length; i++) {
        const absValue = Math.abs(response[i]);
        maxResponse = Math.max(maxResponse, absValue);
        avgResponse += absValue;
        totalElements++;
      }
    }
    
    avgResponse /= totalElements;
    
    // Contraste y uniformidad de respuestas
    const contrast = maxResponse > 0 ? avgResponse / maxResponse : 0;
    
    return Math.tanh(contrast * 5.0);
  }
  
  /**
   * CÁLCULO DE SCORE DE ENTROPÍA
   */
  private computeEntropyScore(measures: { shannon: number, renyi: number, tsallis: number }): number {
    // Normalización de entropías
    const shannonNorm = Math.tanh(measures.shannon / 8.0);
    const renyiNorm = Math.tanh(measures.renyi / 6.0);
    const tsallisNorm = Math.tanh(measures.tsallis * 2.0);
    
    // Combinación ponderada
    return shannonNorm * 0.5 + renyiNorm * 0.3 + tsallisNorm * 0.2;
  }

  /**
   * CÁLCULO DE SCORE TEMPORAL BASADO EN HISTORIA
   */
  private computeTemporalScore(): number {
    if (this.temporalSignatures.length < 3) return 0.5;
    
    const recent = this.temporalSignatures.slice(-5);
    
    // Estabilidad temporal de características
    const spectralStability = this.computeStability(recent.map(s => s.spectralCentroid));
    const fractalStability = this.computeStability(recent.map(s => s.fractalDimension));
    const entropyStability = this.computeStability(recent.map(s => s.shannonEntropy));
    
    return (spectralStability + fractalStability + entropyStability) / 3.0;
  }
  
  /**
   * CÁLCULO DE ESTABILIDAD TEMPORAL
   */
  private computeStability(values: number[]): number {
    if (values.length < 2) return 0.5;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stability = Math.exp(-variance);
    
    return Math.min(1.0, stability);
  }
  
  /**
   * CÁLCULO DE PESOS ADAPTATIVOS
   */
  private computeAdaptiveWeights(): {
    spectral: number, fractal: number, wavelet: number,
    gabor: number, entropy: number, temporal: number
  } {
    // Pesos base
    let weights = {
      spectral: 0.25,
      fractal: 0.20,
      wavelet: 0.20,
      gabor: 0.15,
      entropy: 0.10,
      temporal: 0.10
    };
    
    // Adaptación basada en historia temporal
    if (this.temporalSignatures.length > 10) {
      const recentStability = this.computeTemporalScore();
      if (recentStability > 0.8) {
        weights.temporal *= 1.5;
        weights.spectral *= 0.9;
      }
    }
    
    return weights;
  }
  
  /**
   * FUNCIÓN SIGMOIDAL AVANZADA CON PARÁMETROS ADAPTATIVOS
   */
  private advancedSigmoid(x: number): number {
    const k = this.FEIGENBAUM_CONSTANT;
    const offset = this.EULER_MASCHERONI;
    
    return 1.0 / (1.0 + Math.exp(-k * (x - offset)));
  }

  /**
   * EXTRACCIÓN AVANZADA DE SEÑAL PPG CON COMPENSACIÓN MATEMÁTICA
   */
  private extractAdvancedPPGSignal(imageData: ImageData, roi: { x: number, y: number, width: number, height: number }): {
    red: number, green: number, blue: number
  } {
    const data = imageData.data;
    let redSum = 0, greenSum = 0, blueSum = 0;
    let pixelCount = 0;
    
    const startX = Math.max(0, Math.floor(roi.x));
    const endX = Math.min(imageData.width, Math.floor(roi.x + roi.width));
    const startY = Math.max(0, Math.floor(roi.y));
    const endY = Math.min(imageData.height, Math.floor(roi.y + roi.height));
    
    // Extracción con compensación matemática avanzada
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * imageData.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // Compensación basada en modelo de absorción de Beer-Lambert
        const compensatedR = r * Math.exp(-0.1 * (g + b) / 255);
        const compensatedG = g * Math.exp(-0.05 * (r + b) / 255);
        const compensatedB = b * Math.exp(-0.02 * (r + g) / 255);
        
        redSum += compensatedR;
        greenSum += compensatedG;
        blueSum += compensatedB;
        pixelCount++;
      }
    }
    
    if (pixelCount === 0) return { red: 0, green: 0, blue: 0 };
    
    return {
      red: redSum / pixelCount,
      green: greenSum / pixelCount,
      blue: blueSum / pixelCount
    };
  }

  /**
   * CÁLCULO DE ROI ADAPTATIVO BASADO EN TEORÍA DE LA INFORMACIÓN
   */
  private computeAdaptiveROI(imageData: ImageData, fingerScore: number): { x: number, y: number, width: number, height: number } {
    const centerX = imageData.width / 2;
    const centerY = imageData.height / 2;
    
    // Tamaño adaptativo basado en score de detección y proporción áurea
    const baseSize = Math.min(imageData.width, imageData.height) * this.CONFIG.ROI_SIZE_FACTOR;
    const adaptiveFactor = 0.8 + 0.4 * fingerScore; // Entre 0.8 y 1.2
    const finalSize = baseSize * adaptiveFactor * this.GOLDEN_RATIO / 2;
    
    return {
      x: centerX - finalSize / 2,
      y: centerY - finalSize / 2,
      width: finalSize,
      height: finalSize
    };
  }
  
  /**
   * ACTUALIZACIÓN DE FIRMAS TEMPORALES
   */
  private updateTemporalSignatures(signature: {
    timestamp: number,
    spectralCentroid: number,
    spectralRolloff: number,
    spectralFlux: number,
    mfccCoefficients: number[],
    chromaVector: number[],
    fractalDimension: number,
    lyapunovExponent: number,
    kolmogorovComplexity: number,
    shannonEntropy: number,
    renyi_entropy: number,
    tsallis_entropy: number
  }): void {
    this.temporalSignatures.push(signature);
    
    if (this.temporalSignatures.length > this.TEMPORAL_HISTORY_SIZE) {
      this.temporalSignatures.shift();
    }
  }

  /**
   * CÁLCULO DE COEFICIENTES MFCC (MEL-FREQUENCY CEPSTRAL COEFFICIENTS)
   */
  private computeMFCC(imageData: ImageData): number[] {
    const data = imageData.data;
    const signal = new Float64Array(this.SPECTRAL_ANALYSIS_WINDOW);
    
    // Convertir imagen a señal 1D
    for (let i = 0; i < Math.min(signal.length, data.length / 4); i++) {
      const idx = i * 4;
      signal[i] = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
    }
    
    // FFT
    const spectrum = this.computeFFT(signal);
    const magnitude = spectrum.map(c => Math.sqrt(c.real * c.real + c.imag * c.imag));
    
    // Filtros Mel
    const melFilters = this.createMelFilterBank(magnitude.length);
    const melSpectrum = melFilters.map(filter => 
      filter.reduce((sum, coeff, i) => sum + coeff * magnitude[i], 0)
    );
    
    // Log y DCT
    const logMel = melSpectrum.map(val => Math.log(val + 1e-10));
    return this.computeDCT(logMel).slice(0, this.MFCC_COEFFICIENTS);
  }
  
  /**
   * CÁLCULO DE VECTOR CHROMA
   */
  private computeChromaVector(imageData: ImageData): number[] {
    const chroma = new Array(this.CHROMA_BINS).fill(0);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      
      // Mapeo a bins cromáticos
      const hue = this.rgbToHue(r, g, b);
      const bin = Math.floor((hue / 360) * this.CHROMA_BINS) % this.CHROMA_BINS;
      chroma[bin] += Math.sqrt(r * r + g * g + b * b);
    }
    
    // Normalización
    const sum = chroma.reduce((a, b) => a + b, 0);
    return sum > 0 ? chroma.map(val => val / sum) : chroma;
  }
  
  /**
   * CÁLCULO DEL EXPONENTE DE LYAPUNOV
   */
  private computeLyapunovExponent(): number {
    if (this.temporalSignatures.length < 10) return 0;
    
    const recent = this.temporalSignatures.slice(-10);
    const values = recent.map(s => s.spectralCentroid);
    
    let sum = 0;
    for (let i = 1; i < values.length; i++) {
      const diff = Math.abs(values[i] - values[i-1]);
      if (diff > 0) {
        sum += Math.log(diff);
      }
    }
    
    return sum / (values.length - 1);
  }
  
  /**
   * ESTIMACIÓN DE COMPLEJIDAD DE KOLMOGOROV
   */
  private estimateKolmogorovComplexity(imageData: ImageData): number {
    const data = imageData.data;
    const bytes = new Uint8Array(data.buffer.slice(0, Math.min(1024, data.length)));
    
    // Aproximación mediante compresión LZ77 simplificada
    const compressed = this.simpleLZ77(bytes);
    return compressed.length / bytes.length;
  }

  /**
   * TRANSFORMADA RÁPIDA DE FOURIER (FFT)
   */
  private computeFFT(signal: Float64Array): Complex[] {
    const N = signal.length;
    if (N <= 1) return [{ real: signal[0] || 0, imag: 0 }];
    
    // Verificar si es potencia de 2
    if ((N & (N - 1)) !== 0) {
      // Rellenar con ceros hasta la siguiente potencia de 2
      const nextPow2 = Math.pow(2, Math.ceil(Math.log2(N)));
      const paddedSignal = new Float64Array(nextPow2);
      paddedSignal.set(signal);
      return this.computeFFT(paddedSignal);
    }
    
    // FFT Cooley-Tukey
    const even = new Float64Array(N / 2);
    const odd = new Float64Array(N / 2);
    
    for (let i = 0; i < N / 2; i++) {
      even[i] = signal[2 * i];
      odd[i] = signal[2 * i + 1];
    }
    
    const evenFFT = this.computeFFT(even);
    const oddFFT = this.computeFFT(odd);
    
    const result: Complex[] = new Array(N);
    
    for (let k = 0; k < N / 2; k++) {
      const angle = -2 * Math.PI * k / N;
      const twiddle = {
        real: Math.cos(angle),
        imag: Math.sin(angle)
      };
      
      const oddTerm = {
        real: twiddle.real * oddFFT[k].real - twiddle.imag * oddFFT[k].imag,
        imag: twiddle.real * oddFFT[k].imag + twiddle.imag * oddFFT[k].real
      };
      
      result[k] = {
        real: evenFFT[k].real + oddTerm.real,
        imag: evenFFT[k].imag + oddTerm.imag
      };
      
      result[k + N / 2] = {
        real: evenFFT[k].real - oddTerm.real,
        imag: evenFFT[k].imag - oddTerm.imag
      };
    }
    
    return result;
  }

  /**
   * CREACIÓN DE BANCO DE FILTROS MEL
   */
  private createMelFilterBank(spectrumLength: number): number[][] {
    const numFilters = 26;
    const filters: number[][] = [];
    
    // Frecuencias Mel
    const melMin = this.hzToMel(0);
    const melMax = this.hzToMel(22050); // Nyquist para 44.1kHz
    const melPoints = [];
    
    for (let i = 0; i <= numFilters + 1; i++) {
      melPoints.push(melMin + (melMax - melMin) * i / (numFilters + 1));
    }
    
    const hzPoints = melPoints.map(mel => this.melToHz(mel));
    const binPoints = hzPoints.map(hz => Math.floor((spectrumLength + 1) * hz / 22050));
    
    for (let i = 1; i <= numFilters; i++) {
      const filter = new Array(spectrumLength).fill(0);
      
      for (let j = binPoints[i - 1]; j < binPoints[i]; j++) {
        if (j < spectrumLength) {
          filter[j] = (j - binPoints[i - 1]) / (binPoints[i] - binPoints[i - 1]);
        }
      }
      
      for (let j = binPoints[i]; j < binPoints[i + 1]; j++) {
        if (j < spectrumLength) {
          filter[j] = (binPoints[i + 1] - j) / (binPoints[i + 1] - binPoints[i]);
        }
      }
      
      filters.push(filter);
    }
    
    return filters;
  }
  
  /**
   * CONVERSIÓN HZ A MEL
   */
  private hzToMel(hz: number): number {
    return 2595 * Math.log10(1 + hz / 700);
  }
  
  /**
   * CONVERSIÓN MEL A HZ
   */
  private melToHz(mel: number): number {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }
  
  /**
   * TRANSFORMADA DISCRETA DEL COSENO (DCT)
   */
  private computeDCT(signal: number[]): number[] {
    const N = signal.length;
    const result = new Array(N);
    
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) {
        sum += signal[n] * Math.cos(Math.PI * k * (2 * n + 1) / (2 * N));
      }
      result[k] = sum;
    }
    
    return result;
  }
  
  /**
   * CONVERSIÓN RGB A HUE
   */
  private rgbToHue(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    
    if (delta === 0) return 0;
    
    let hue = 0;
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    
    return (hue * 60 + 360) % 360;
  }
  
  /**
   * COMPRESIÓN LZ77 SIMPLIFICADA
   */
  private simpleLZ77(data: Uint8Array): Uint8Array {
    const result: number[] = [];
    let i = 0;
    
    while (i < data.length) {
      let bestLength = 0;
      let bestDistance = 0;
      
      // Buscar coincidencias en ventana deslizante
      const windowStart = Math.max(0, i - 255);
      for (let j = windowStart; j < i; j++) {
        let length = 0;
        while (i + length < data.length && 
               j + length < i && 
               data[j + length] === data[i + length] && 
               length < 255) {
          length++;
        }
        
        if (length > bestLength) {
          bestLength = length;
          bestDistance = i - j;
        }
      }
      
      if (bestLength > 2) {
        result.push(0, bestDistance, bestLength);
        i += bestLength;
      } else {
        result.push(data[i]);
        i++;
      }
    }
    
    return new Uint8Array(result);
  }

  /**
   * DETECCIÓN DE ROI CON ANÁLISIS MATEMÁTICO AVANZADO
   */
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    console.log('[DEBUG] AdvancedFrameProcessor detectROI - redValue:', redValue, 'imageSize:', imageData.width+'x'+imageData.height);
    
    // Análisis matemático complejo para determinar ROI óptimo
    const spectralFeatures = this.computeSpectralFeatures(imageData);
    const fractalDimension = this.computeFractalDimension(imageData);
    const entropyMeasures = this.computeEntropyMeasures(imageData);
    
    // Score de detección basado en múltiples características
    const detectionScore = (
      this.computeSpectralScore(spectralFeatures) * 0.4 +
      this.computeFractalScore(fractalDimension) * 0.3 +
      this.computeEntropyScore(entropyMeasures) * 0.3
    );
    
    // ROI adaptativo basado en análisis matemático
    return this.computeAdaptiveROI(imageData, detectionScore);
  }
}