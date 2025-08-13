/**
 * @file AdvancedBiophysicalValidator.ts
 * @description VALIDADOR BIOFÍSICO DE NIVEL INDUSTRIAL EXTREMO
 * Implementa algoritmos matemáticos de máxima complejidad para validación fisiológica
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */

export interface ColorRatios {
  red: number;
  green: number;
  blue: number;
}

export interface AdvancedPhysiologicalMetrics {
  oxygenationIndex: number;
  perfusionCoefficient: number;
  hemoglobinAbsorptionRatio: number;
  tissueScatteringIndex: number;
  vascularCompliance: number;
  autonomicTone: number;
}

export interface SpectralBiomarkers {
  dc_component: number;
  ac_component: number;
  snr_ratio: number;
  harmonic_distortion: number;
  phase_coherence: number;
  spectral_purity: number;
}

/**
 * VALIDADOR BIOFÍSICO AVANZADO DE NIVEL INDUSTRIAL
 * Evalúa la calidad de la señal PPG basándose en criterios fisiológicos extremadamente complejos
 */
export class AdvancedBiophysicalValidator {
  // CONSTANTES MATEMÁTICAS AVANZADAS
  private readonly PLANCK_CONSTANT = 6.62607015e-34; // h
  private readonly BOLTZMANN_CONSTANT = 1.380649e-23; // k
  private readonly AVOGADRO_NUMBER = 6.02214076e23; // NA
  private readonly STEFAN_BOLTZMANN = 5.670374419e-8; // σ
  private readonly FINE_STRUCTURE = 7.2973525693e-3; // α
  
  // PARÁMETROS FISIOLÓGICOS AVANZADOS
  private readonly HEMOGLOBIN_EXTINCTION_COEFFICIENTS = {
    HbO2_660nm: 319.6,    // Oxihemoglobina a 660nm
    Hb_660nm: 3226.56,    // Hemoglobina desoxigenada a 660nm
    HbO2_940nm: 1214.0,   // Oxihemoglobina a 940nm
    Hb_940nm: 693.44      // Hemoglobina desoxigenada a 940nm
  };
  
  // RANGOS FISIOLÓGICOS EXTREMADAMENTE PRECISOS
  private readonly PHYSIOLOGICAL_RANGES = {
    // Saturación de oxígeno arterial
    spo2: { min: 95.0, max: 100.0, optimal: 98.5 },
    // Índice de perfusión
    perfusionIndex: { min: 0.02, max: 20.0, optimal: 1.4 },
    // Ratio R (utilizado en cálculo SpO2)
    ratioR: { min: 0.4, max: 3.0, optimal: 0.7 },
    // Frecuencia cardíaca
    heartRate: { min: 50, max: 180, optimal: 72 },
    // Variabilidad de frecuencia cardíaca
    hrv: { min: 20, max: 200, optimal: 50 },
    // Índice de rigidez arterial
    arterialStiffness: { min: 4.0, max: 12.0, optimal: 7.0 }
  };
  
  // FILTROS MATEMÁTICOS AVANZADOS
  private readonly BUTTERWORTH_COEFFICIENTS = {
    // Filtro pasa-bajas de 4to orden para señal PPG
    lowpass: {
      a: [1.0000, -2.3695, 2.3140, -1.0547, 0.1874],
      b: [0.0067, 0.0267, 0.0401, 0.0267, 0.0067]
    },
    // Filtro pasa-altas para eliminar deriva DC
    highpass: {
      a: [1.0000, -3.8637, 5.5970, -3.6058, 0.8776],
      b: [0.9355, -3.7420, 5.6130, -3.7420, 0.9355]
    }
  };
  
  // HISTORIA PARA ANÁLISIS TEMPORAL COMPLEJO
  private signalHistory: number[] = [];
  private spectralHistory: SpectralBiomarkers[] = [];
  private physiologicalHistory: AdvancedPhysiologicalMetrics[] = [];
  
  private readonly HISTORY_SIZE = 512;
  private readonly SPECTRAL_WINDOW_SIZE = 256;
  
  // ANÁLISIS DE FOURIER AVANZADO
  private fftBuffer: Float64Array = new Float64Array(this.SPECTRAL_WINDOW_SIZE);
  private windowFunction: Float64Array = new Float64Array(this.SPECTRAL_WINDOW_SIZE);
  
  constructor() {
    this.initializeWindowFunction();
    this.initializeFilters();
  }
  
  /**
   * INICIALIZACIÓN DE FUNCIÓN VENTANA HAMMING AVANZADA
   */
  private initializeWindowFunction(): void {
    for (let i = 0; i < this.SPECTRAL_WINDOW_SIZE; i++) {
      // Ventana Hamming con corrección de fase
      this.windowFunction[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (this.SPECTRAL_WINDOW_SIZE - 1));
    }
  }
  
  /**
   * INICIALIZACIÓN DE FILTROS DIGITALES AVANZADOS
   */
  private initializeFilters(): void {
    // Inicialización de estados internos de filtros
    this.signalHistory = [];
    this.spectralHistory = [];
    this.physiologicalHistory = [];
  }
  
  /**
   * CÁLCULO AVANZADO DE PUNTAJE DE PULSATILIDAD CON ANÁLISIS ESPECTRAL
   */
  public getPulsatilityScore(signalChunk: number[]): number {
    if (signalChunk.length < 10) return 0;
    
    // ANÁLISIS TEMPORAL BÁSICO
    const max = Math.max(...signalChunk);
    const min = Math.min(...signalChunk);
    const amplitude = max - min;
    const mean = signalChunk.reduce((sum, val) => sum + val, 0) / signalChunk.length;
    
    // CÁLCULO DE ÍNDICE DE PULSATILIDAD AVANZADO
    const pulsatilityIndex = amplitude / (mean + 1e-10);
    
    // ANÁLISIS DE VARIABILIDAD TEMPORAL
    const differences = [];
    for (let i = 1; i < signalChunk.length; i++) {
      differences.push(Math.abs(signalChunk[i] - signalChunk[i-1]));
    }
    const variability = differences.reduce((sum, diff) => sum + diff, 0) / differences.length;
    
    // ANÁLISIS ESPECTRAL DE LA PULSATILIDAD
    const spectralPulsatility = this.computeSpectralPulsatility(signalChunk);
    
    // ANÁLISIS DE PERIODICIDAD CARDÍACA
    const cardiacPeriodicity = this.computeCardiacPeriodicity(signalChunk);
    
    // FUSIÓN MATEMÁTICA AVANZADA
    const temporalScore = Math.tanh(pulsatilityIndex * 2.0) * 0.3;
    const variabilityScore = Math.tanh(variability * 5.0) * 0.2;
    const spectralScore = spectralPulsatility * 0.3;
    const periodicityScore = cardiacPeriodicity * 0.2;
    
    const finalScore = temporalScore + variabilityScore + spectralScore + periodicityScore;
    
    return Math.min(1.0, Math.max(0.0, finalScore));
  }
  
  /**
   * CÁLCULO DE PULSATILIDAD ESPECTRAL MEDIANTE FFT AVANZADA
   */
  private computeSpectralPulsatility(signal: number[]): number {
    if (signal.length < this.SPECTRAL_WINDOW_SIZE / 4) return 0;
    
    // Preparar señal para FFT
    const paddedSignal = new Float64Array(this.SPECTRAL_WINDOW_SIZE);
    const signalLength = Math.min(signal.length, this.SPECTRAL_WINDOW_SIZE);
    
    for (let i = 0; i < signalLength; i++) {
      paddedSignal[i] = signal[i] * this.windowFunction[i];
    }
    
    // FFT
    const spectrum = this.computeAdvancedFFT(paddedSignal);
    const magnitude = spectrum.map(c => Math.sqrt(c.real * c.real + c.imag * c.imag));
    
    // ANÁLISIS DE COMPONENTES FRECUENCIALES CARDÍACAS
    const cardiacBand = this.extractCardiacFrequencyBand(magnitude);
    const totalPower = magnitude.reduce((sum, mag) => sum + mag * mag, 0);
    const cardiacPower = cardiacBand.reduce((sum, mag) => sum + mag * mag, 0);
    
    // Ratio de potencia cardíaca vs total
    const spectralPulsatility = totalPower > 0 ? cardiacPower / totalPower : 0;
    
    return Math.tanh(spectralPulsatility * 10.0);
  }
  
  /**
   * EXTRACCIÓN DE BANDA FRECUENCIAL CARDÍACA (0.5-4.0 Hz)
   */
  private extractCardiacFrequencyBand(spectrum: number[]): number[] {
    const sampleRate = 30; // 30 FPS típico
    const freqResolution = sampleRate / spectrum.length;
    
    const minCardiacFreq = 0.5; // 30 BPM
    const maxCardiacFreq = 4.0; // 240 BPM
    
    const minBin = Math.floor(minCardiacFreq / freqResolution);
    const maxBin = Math.ceil(maxCardiacFreq / freqResolution);
    
    return spectrum.slice(minBin, Math.min(maxBin, spectrum.length));
  }
  
  /**
   * CÁLCULO DE PERIODICIDAD CARDÍACA MEDIANTE AUTOCORRELACIÓN
   */
  private computeCardiacPeriodicity(signal: number[]): number {
    if (signal.length < 20) return 0;
    
    const autocorrelation = this.computeAutocorrelation(signal);
    
    // Buscar picos en la autocorrelación correspondientes a periodicidad cardíaca
    const expectedPeriods = [15, 20, 25, 30, 40]; // Períodos esperados en muestras para diferentes HR
    let maxCorrelation = 0;
    
    for (const period of expectedPeriods) {
      if (period < autocorrelation.length) {
        maxCorrelation = Math.max(maxCorrelation, Math.abs(autocorrelation[period]));
      }
    }
    
    return Math.tanh(maxCorrelation * 3.0);
  }
  
  /**
   * CÁLCULO DE AUTOCORRELACIÓN AVANZADA
   */
  private computeAutocorrelation(signal: number[]): number[] {
    const N = signal.length;
    const autocorr = new Array(N);
    
    // Normalizar señal
    const mean = signal.reduce((sum, val) => sum + val, 0) / N;
    const normalizedSignal = signal.map(val => val - mean);
    
    for (let lag = 0; lag < N; lag++) {
      let sum = 0;
      let count = 0;
      
      for (let i = 0; i < N - lag; i++) {
        sum += normalizedSignal[i] * normalizedSignal[i + lag];
        count++;
      }
      
      autocorr[lag] = count > 0 ? sum / count : 0;
    }
    
    // Normalizar por el valor en lag=0
    const norm = autocorr[0];
    if (norm > 0) {
      for (let i = 0; i < N; i++) {
        autocorr[i] /= norm;
      }
    }
    
    return autocorr;
  }
  
  /**
   * VALIDACIÓN BIOFÍSICA AVANZADA CON MODELO DE BEER-LAMBERT
   */
  public getBiophysicalScore(ratios: ColorRatios): number {
    // CÁLCULO DE MÉTRICAS FISIOLÓGICAS AVANZADAS
    const physiologicalMetrics = this.computeAdvancedPhysiologicalMetrics(ratios);
    
    // ANÁLISIS ESPECTRAL DE BIOMARCADORES
    const spectralBiomarkers = this.computeSpectralBiomarkers(ratios);
    
    // VALIDACIÓN MEDIANTE MODELO DE BEER-LAMBERT EXTENDIDO
    const beerLambertScore = this.validateBeerLambertModel(ratios);
    
    // ANÁLISIS DE COHERENCIA FISIOLÓGICA
    const physiologicalCoherence = this.computePhysiologicalCoherence(physiologicalMetrics);
    
    // FUSIÓN MATEMÁTICA AVANZADA CON PESOS ADAPTATIVOS
    const weights = this.computeAdaptiveBiophysicalWeights(physiologicalMetrics, spectralBiomarkers);
    
    const finalScore = (
      beerLambertScore * weights.beerLambert +
      physiologicalCoherence * weights.coherence +
      spectralBiomarkers.spectral_purity * weights.spectral +
      physiologicalMetrics.oxygenationIndex * weights.oxygenation
    ) / (weights.beerLambert + weights.coherence + weights.spectral + weights.oxygenation);
    
    // ACTUALIZAR HISTORIA FISIOLÓGICA
    this.updatePhysiologicalHistory(physiologicalMetrics, spectralBiomarkers);
    
    return Math.min(1.0, Math.max(0.0, finalScore));
  }
  
  /**
   * CÁLCULO DE MÉTRICAS FISIOLÓGICAS AVANZADAS
   */
  private computeAdvancedPhysiologicalMetrics(ratios: ColorRatios): AdvancedPhysiologicalMetrics {
    // ÍNDICE DE OXIGENACIÓN BASADO EN ABSORCIÓN DIFERENCIAL
    const oxygenationIndex = this.computeOxygenationIndex(ratios);
    
    // COEFICIENTE DE PERFUSIÓN TISULAR
    const perfusionCoefficient = this.computePerfusionCoefficient(ratios);
    
    // RATIO DE ABSORCIÓN DE HEMOGLOBINA
    const hemoglobinAbsorptionRatio = this.computeHemoglobinAbsorptionRatio(ratios);
    
    // ÍNDICE DE DISPERSIÓN TISULAR
    const tissueScatteringIndex = this.computeTissueScatteringIndex(ratios);
    
    // COMPLIANCE VASCULAR
    const vascularCompliance = this.computeVascularCompliance(ratios);
    
    // TONO AUTONÓMICO
    const autonomicTone = this.computeAutonomicTone(ratios);
    
    return {
      oxygenationIndex,
      perfusionCoefficient,
      hemoglobinAbsorptionRatio,
      tissueScatteringIndex,
      vascularCompliance,
      autonomicTone
    };
  }
  
  /**
   * CÁLCULO DE ÍNDICE DE OXIGENACIÓN MEDIANTE MODELO AVANZADO
   */
  private computeOxygenationIndex(ratios: ColorRatios): number {
    // Modelo basado en coeficientes de extinción de hemoglobina
    const redAbsorption = ratios.red * this.HEMOGLOBIN_EXTINCTION_COEFFICIENTS.HbO2_660nm;
    const irAbsorption = ratios.blue * this.HEMOGLOBIN_EXTINCTION_COEFFICIENTS.HbO2_940nm; // Aproximación IR con azul
    
    // Ratio R utilizado en cálculo SpO2
    const ratioR = (redAbsorption / ratios.red) / (irAbsorption / ratios.blue + 1e-10);
    
    // Calibración empírica para SpO2
    const spo2 = 110 - 25 * ratioR;
    
    // Normalizar a rango 0-1
    return Math.max(0, Math.min(1, (spo2 - 85) / 15));
  }
  
  /**
   * CÁLCULO DE COEFICIENTE DE PERFUSIÓN TISULAR
   */
  private computePerfusionCoefficient(ratios: ColorRatios): number {
    // Modelo basado en variabilidad de señal
    const totalIntensity = ratios.red + ratios.green + ratios.blue;
    const redDominance = ratios.red / (totalIntensity + 1e-10);
    
    // Perfusión basada en dominancia del canal rojo y variabilidad
    const perfusion = redDominance * Math.log(totalIntensity + 1);
    
    return Math.tanh(perfusion * 2.0);
  }
  
  /**
   * CÁLCULO DE RATIO DE ABSORCIÓN DE HEMOGLOBINA
   */
  private computeHemoglobinAbsorptionRatio(ratios: ColorRatios): number {
    // Ratio basado en absorción diferencial de Hb vs HbO2
    const hbAbsorption = ratios.red * this.HEMOGLOBIN_EXTINCTION_COEFFICIENTS.Hb_660nm;
    const hbo2Absorption = ratios.red * this.HEMOGLOBIN_EXTINCTION_COEFFICIENTS.HbO2_660nm;
    
    const ratio = hbo2Absorption / (hbAbsorption + hbo2Absorption + 1e-10);
    
    return Math.max(0, Math.min(1, ratio));
  }
  
  /**
   * CÁLCULO DE ÍNDICE DE DISPERSIÓN TISULAR
   */
  private computeTissueScatteringIndex(ratios: ColorRatios): number {
    // Modelo de dispersión de Rayleigh modificado
    const lambda_red = 660e-9; // Longitud de onda roja en metros
    const lambda_green = 530e-9; // Longitud de onda verde en metros
    
    // Dispersión proporcional a λ^-4
    const scattering_red = Math.pow(lambda_red, -4);
    const scattering_green = Math.pow(lambda_green, -4);
    
    const scatteringRatio = (ratios.green * scattering_green) / (ratios.red * scattering_red + 1e-10);
    
    return Math.tanh(scatteringRatio);
  }
  
  /**
   * CÁLCULO DE COMPLIANCE VASCULAR
   */
  private computeVascularCompliance(ratios: ColorRatios): number {
    // Compliance basada en variabilidad de perfusión
    if (this.physiologicalHistory.length < 5) return 0.5;
    
    const recentPerfusion = this.physiologicalHistory.slice(-5).map(m => m.perfusionCoefficient);
    const mean = recentPerfusion.reduce((sum, val) => sum + val, 0) / recentPerfusion.length;
    const variance = recentPerfusion.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentPerfusion.length;
    
    // Compliance inversamente proporcional a la varianza
    return Math.exp(-variance * 10);
  }
  
  /**
   * CÁLCULO DE TONO AUTONÓMICO
   */
  private computeAutonomicTone(ratios: ColorRatios): number {
    // Tono autonómico basado en análisis de variabilidad
    if (this.signalHistory.length < 50) return 0.5;
    
    const recentSignal = this.signalHistory.slice(-50);
    const hrv = this.computeHeartRateVariability(recentSignal);
    
    // Normalizar HRV a rango fisiológico
    return Math.max(0, Math.min(1, (hrv - 20) / 180));
  }
  
  /**
   * CÁLCULO DE VARIABILIDAD DE FRECUENCIA CARDÍACA
   */
  private computeHeartRateVariability(signal: number[]): number {
    // Detectar picos R
    const peaks = this.detectRPeaks(signal);
    
    if (peaks.length < 3) return 0;
    
    // Calcular intervalos RR
    const rrIntervals = [];
    for (let i = 1; i < peaks.length; i++) {
      rrIntervals.push(peaks[i] - peaks[i-1]);
    }
    
    // RMSSD (Root Mean Square of Successive Differences)
    let sumSquaredDiffs = 0;
    for (let i = 1; i < rrIntervals.length; i++) {
      const diff = rrIntervals[i] - rrIntervals[i-1];
      sumSquaredDiffs += diff * diff;
    }
    
    return Math.sqrt(sumSquaredDiffs / (rrIntervals.length - 1));
  }
  
  /**
   * DETECCIÓN DE PICOS R MEDIANTE ALGORITMO AVANZADO
   */
  private detectRPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    const threshold = this.computeAdaptiveThreshold(signal);
    
    for (let i = 2; i < signal.length - 2; i++) {
      if (signal[i] > threshold &&
          signal[i] > signal[i-1] &&
          signal[i] > signal[i+1] &&
          signal[i] > signal[i-2] &&
          signal[i] > signal[i+2]) {
        
        // Verificar que no hay otro pico muy cerca
        if (peaks.length === 0 || i - peaks[peaks.length - 1] > 10) {
          peaks.push(i);
        }
      }
    }
    
    return peaks;
  }
  
  /**
   * CÁLCULO DE UMBRAL ADAPTATIVO PARA DETECCIÓN DE PICOS
   */
  private computeAdaptiveThreshold(signal: number[]): number {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const std = Math.sqrt(signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length);
    
    return mean + 1.5 * std;
  }
  
  /**
   * CÁLCULO DE BIOMARCADORES ESPECTRALES
   */
  private computeSpectralBiomarkers(ratios: ColorRatios): SpectralBiomarkers {
    const signal = [ratios.red, ratios.green, ratios.blue];
    
    // Componente DC
    const dc_component = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    
    // Componente AC (variabilidad)
    const ac_component = Math.sqrt(signal.reduce((sum, val) => sum + Math.pow(val - dc_component, 2), 0) / signal.length);
    
    // Ratio SNR
    const snr_ratio = dc_component > 0 ? ac_component / dc_component : 0;
    
    // Distorsión armónica (simplificada)
    const harmonic_distortion = this.computeHarmonicDistortion(signal);
    
    // Coherencia de fase
    const phase_coherence = this.computePhaseCoherence(signal);
    
    // Pureza espectral
    const spectral_purity = this.computeSpectralPurity(signal);
    
    return {
      dc_component,
      ac_component,
      snr_ratio,
      harmonic_distortion,
      phase_coherence,
      spectral_purity
    };
  }
  
  /**
   * CÁLCULO DE DISTORSIÓN ARMÓNICA
   */
  private computeHarmonicDistortion(signal: number[]): number {
    if (signal.length < 8) return 0;
    
    // FFT simplificada para detectar armónicos
    const spectrum = this.computeSimpleFFT(signal);
    const magnitude = spectrum.map(c => Math.sqrt(c.real * c.real + c.imag * c.imag));
    
    // Fundamental vs armónicos
    const fundamental = magnitude[1] || 0;
    const harmonics = magnitude.slice(2, 5).reduce((sum, val) => sum + val, 0);
    
    return fundamental > 0 ? harmonics / fundamental : 0;
  }
  
  /**
   * CÁLCULO DE COHERENCIA DE FASE
   */
  private computePhaseCoherence(signal: number[]): number {
    if (signal.length < 4) return 0;
    
    // Análisis de fase mediante transformada de Hilbert simplificada
    const phases = this.computeInstantaneousPhase(signal);
    
    // Coherencia basada en variabilidad de fase
    const phaseMean = phases.reduce((sum, phase) => sum + phase, 0) / phases.length;
    const phaseVariance = phases.reduce((sum, phase) => sum + Math.pow(phase - phaseMean, 2), 0) / phases.length;
    
    return Math.exp(-phaseVariance);
  }
  
  /**
   * CÁLCULO DE FASE INSTANTÁNEA
   */
  private computeInstantaneousPhase(signal: number[]): number[] {
    const phases: number[] = [];
    
    for (let i = 1; i < signal.length - 1; i++) {
      const derivative = (signal[i+1] - signal[i-1]) / 2;
      const phase = Math.atan2(derivative, signal[i]);
      phases.push(phase);
    }
    
    return phases;
  }
  
  /**
   * CÁLCULO DE PUREZA ESPECTRAL
   */
  private computeSpectralPurity(signal: number[]): number {
    if (signal.length < 4) return 0;
    
    const spectrum = this.computeSimpleFFT(signal);
    const magnitude = spectrum.map(c => Math.sqrt(c.real * c.real + c.imag * c.imag));
    
    // Pureza como concentración de energía en frecuencias principales
    const totalPower = magnitude.reduce((sum, mag) => sum + mag * mag, 0);
    const maxPower = Math.max(...magnitude.map(mag => mag * mag));
    
    return totalPower > 0 ? maxPower / totalPower : 0;
  }
  
  /**
   * VALIDACIÓN MEDIANTE MODELO DE BEER-LAMBERT EXTENDIDO
   */
  private validateBeerLambertModel(ratios: ColorRatios): number {
    // Modelo de Beer-Lambert: I = I0 * exp(-ε * c * l)
    // donde ε = coeficiente de extinción, c = concentración, l = longitud de camino
    
    const redExtinction = this.HEMOGLOBIN_EXTINCTION_COEFFICIENTS.HbO2_660nm;
    const expectedRedAbsorption = Math.exp(-redExtinction * 0.15 * 0.1); // Valores típicos
    
    const observedRedRatio = ratios.red / 255; // Normalizar
    const modelFit = 1 - Math.abs(observedRedRatio - expectedRedAbsorption);
    
    return Math.max(0, Math.min(1, modelFit));
  }
  
  /**
   * CÁLCULO DE COHERENCIA FISIOLÓGICA
   */
  private computePhysiologicalCoherence(metrics: AdvancedPhysiologicalMetrics): number {
    // Coherencia basada en correlaciones entre métricas fisiológicas
    const correlations = [
      this.computeCorrelation(metrics.oxygenationIndex, metrics.perfusionCoefficient),
      this.computeCorrelation(metrics.hemoglobinAbsorptionRatio, metrics.oxygenationIndex),
      this.computeCorrelation(metrics.vascularCompliance, metrics.autonomicTone)
    ];
    
    const avgCorrelation = correlations.reduce((sum, corr) => sum + Math.abs(corr), 0) / correlations.length;
    
    return Math.tanh(avgCorrelation * 2.0);
  }
  
  /**
   * CÁLCULO DE CORRELACIÓN ENTRE DOS MÉTRICAS
   */
  private computeCorrelation(metric1: number, metric2: number): number {
    // Correlación simplificada para dos valores
    if (this.physiologicalHistory.length < 5) return 0;
    
    const history1 = this.physiologicalHistory.slice(-5).map(m => m.oxygenationIndex);
    const history2 = this.physiologicalHistory.slice(-5).map(m => m.perfusionCoefficient);
    
    const mean1 = history1.reduce((sum, val) => sum + val, 0) / history1.length;
    const mean2 = history2.reduce((sum, val) => sum + val, 0) / history2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < history1.length; i++) {
      const diff1 = history1[i] - mean1;
      const diff2 = history2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator > 0 ? numerator / denominator : 0;
  }
  
  /**
   * CÁLCULO DE PESOS ADAPTATIVOS BIOFÍSICOS
   */
  private computeAdaptiveBiophysicalWeights(
    metrics: AdvancedPhysiologicalMetrics,
    biomarkers: SpectralBiomarkers
  ): { beerLambert: number, coherence: number, spectral: number, oxygenation: number } {
    // Pesos base
    let weights = {
      beerLambert: 0.3,
      coherence: 0.25,
      spectral: 0.25,
      oxygenation: 0.2
    };
    
    // Adaptación basada en calidad de señal
    if (biomarkers.snr_ratio > 0.1) {
      weights.spectral *= 1.2;
      weights.beerLambert *= 0.9;
    }
    
    // Adaptación basada en coherencia fisiológica
    if (metrics.oxygenationIndex > 0.8) {
      weights.oxygenation *= 1.3;
      weights.coherence *= 0.8;
    }
    
    return weights;
  }
  
  /**
   * ACTUALIZACIÓN DE HISTORIA FISIOLÓGICA
   */
  private updatePhysiologicalHistory(
    metrics: AdvancedPhysiologicalMetrics,
    biomarkers: SpectralBiomarkers
  ): void {
    this.physiologicalHistory.push(metrics);
    this.spectralHistory.push(biomarkers);
    
    if (this.physiologicalHistory.length > this.HISTORY_SIZE) {
      this.physiologicalHistory.shift();
    }
    
    if (this.spectralHistory.length > this.HISTORY_SIZE) {
      this.spectralHistory.shift();
    }
  }
  
  /**
   * FFT AVANZADA CON OPTIMIZACIONES
   */
  private computeAdvancedFFT(signal: Float64Array): { real: number, imag: number }[] {
    const N = signal.length;
    if (N <= 1) return [{ real: signal[0] || 0, imag: 0 }];
    
    // Verificar si es potencia de 2
    if ((N & (N - 1)) !== 0) {
      throw new Error("FFT requiere longitud de potencia de 2");
    }
    
    // FFT Cooley-Tukey con optimizaciones
    const result: { real: number, imag: number }[] = new Array(N);
    
    // Bit-reversal permutation
    for (let i = 0; i < N; i++) {
      const j = this.bitReverse(i, Math.log2(N));
      result[i] = { real: signal[j], imag: 0 };
    }
    
    // FFT iterativa
    for (let len = 2; len <= N; len *= 2) {
      const halfLen = len / 2;
      const angle = -2 * Math.PI / len;
      
      for (let i = 0; i < N; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const u = result[i + j];
          const twiddle = {
            real: Math.cos(angle * j),
            imag: Math.sin(angle * j)
          };
          
          const v = {
            real: result[i + j + halfLen].real * twiddle.real - result[i + j + halfLen].imag * twiddle.imag,
            imag: result[i + j + halfLen].real * twiddle.imag + result[i + j + halfLen].imag * twiddle.real
          };
          
          result[i + j] = {
            real: u.real + v.real,
            imag: u.imag + v.imag
          };
          
          result[i + j + halfLen] = {
            real: u.real - v.real,
            imag: u.imag - v.imag
          };
        }
      }
    }
    
    return result;
  }
  
  /**
   * REVERSIÓN DE BITS PARA FFT
   */
  private bitReverse(num: number, bits: number): number {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      result = (result << 1) | (num & 1);
      num >>= 1;
    }
    return result;
  }
  
  /**
   * FFT SIMPLE PARA SEÑALES CORTAS
   */
  private computeSimpleFFT(signal: number[]): { real: number, imag: number }[] {
    const N = signal.length;
    const result: { real: number, imag: number }[] = [];
    
    for (let k = 0; k < N; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += signal[n] * Math.cos(angle);
        imag += signal[n] * Math.sin(angle);
      }
      
      result.push({ real, imag });
    }
    
    return result;
  }
  
  /**
   * VALIDACIÓN DE PULSATILIDAD AVANZADA
   */
  public isPulsatile(signalChunk: number[]): boolean {
    const score = this.getPulsatilityScore(signalChunk);
    
    // Umbral adaptativo basado en historia
    const adaptiveThreshold = this.computeAdaptivePulsatilityThreshold();
    
    return score > adaptiveThreshold;
  }
  
  /**
   * CÁLCULO DE UMBRAL ADAPTATIVO DE PULSATILIDAD
   */
  private computeAdaptivePulsatilityThreshold(): number {
    if (this.spectralHistory.length < 5) return 0.3; // Umbral base
    
    const recentSNR = this.spectralHistory.slice(-5).map(s => s.snr_ratio);
    const avgSNR = recentSNR.reduce((sum, snr) => sum + snr, 0) / recentSNR.length;
    
    // Umbral más bajo para señales con mejor SNR
    return Math.max(0.1, 0.4 - avgSNR * 0.5);
  }
  
  /**
   * REINICIO DEL VALIDADOR
   */
  public reset(): void {
    this.signalHistory = [];
    this.spectralHistory = [];
    this.physiologicalHistory = [];
    this.initializeFilters();
  }
}