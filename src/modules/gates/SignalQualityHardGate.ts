/**
 * GATE 3 - SIGNAL QUALITY HARD GATE
 * 
 * SQI DURO CON UMBRAL 0.85
 * 
 * Este módulo implementa un índice de calidad de señal extremadamente estricto.
 * Solo permite pasar señales con calidad excepcional.
 * 
 * Umbral inicial: SQI mínimo 0.85
 * Tiempo mínimo estable: 8 segundos
 * Pulsos mínimos válidos: 8
 * Autocorrelación mínima: 0.65
 * SNR mínima: estricta
 * Peak consistency: 0.75
 * 
 * Estados:
 * - NO_TARGET
 * - NON_BIOLOGICAL_OBJECT
 * - POSSIBLE_FINGER_NO_PULSE
 * - CONTACT_UNSTABLE
 * - LOW_PERFUSION
 * - MOTION_ARTIFACT
 * - SATURATED
 * - SIGNAL_TOO_NOISY
 * - CALIBRATING
 * - PULSE_CANDIDATE
 * - LIVE_PULSE_CONFIRMED
 * - MEASUREMENT_READY
 * - MEASUREMENT_BLOCKED
 */

import type { PPGFeatures } from './PPGExtractionEngine';
import type { LivenessFeatures } from './FingerLivenessGate';

export type SignalQualityState = 
  | 'NO_TARGET'
  | 'NON_BIOLOGICAL_OBJECT'
  | 'POSSIBLE_FINGER_NO_PULSE'
  | 'CONTACT_UNSTABLE'
  | 'LOW_PERFUSION'
  | 'MOTION_ARTIFACT'
  | 'SATURATED'
  | 'SIGNAL_TOO_NOISY'
  | 'CALIBRATING'
  | 'PULSE_CANDIDATE'
  | 'LIVE_PULSE_CONFIRMED'
  | 'MEASUREMENT_READY'
  | 'MEASUREMENT_BLOCKED';

export interface SignalQualityMetrics {
  // Métricas principales
  sqi: number; // 0..1
  snr: number;
  perfusionIndex: number;
  acDcRatio: number;
  
  // Métricas de picos
  peakProminence: number;
  peakConsistency: number;
  rrStability: number;
  
  // Métricas espectrales
  autocorrelation: number;
  spectralDominance: number;
  spectralEntropy: number;
  harmonicRatio: number;
  
  // Métricas de morfología
  morphologyScore: number;
  clippingRatio: number;
  motionScore: number;
  
  // Coherencia
  channelCoherence: number;
  
  // Detección de artefactos
  tissueLikelihood: number;
  textileLikelihood: number;
  flatObjectLikelihood: number;
  
  // Estabilidad temporal
  temporalStability: number;
  amplitudeStability: number;
  frequencyStability: number;
}

export interface SignalQualityResult {
  sqi: number; // 0..1
  passed: boolean;
  reasons: string[];
  metrics: SignalQualityMetrics;
  state: SignalQualityState;
  confidence: number;
  timeInState: number;
  pulsesAnalyzed: number;
}

export interface SignalQualityConfig {
  // Umbrales estrictos
  minSQI: number;
  minStableTime: number; // segundos
  minValidPulses: number;
  minAutocorrelation: number;
  minSNR: number;
  minPeakConsistency: number;
  minPerfusionIndex: number;
  minSpectralDominance: number;
  minChannelCoherence: number;
  minMorphologyScore: number;
  maxMotionScore: number;
  maxClippingRatio: number;
  maxTextileLikelihood: number;
  maxFlatObjectLikelihood: number;
  minTemporalStability: number;
  
  // Pesos para SQI
  weightSNR: number;
  weightPeak: number;
  weightSpectral: number;
  weightCoherence: number;
  weightMorphology: number;
  weightStability: number;
  weightAntiArtifact: number;
}

const DEFAULT_CONFIG: SignalQualityConfig = {
  // Umbrales muy estrictos
  minSQI: 0.85,
  minStableTime: 8.0,
  minValidPulses: 8,
  minAutocorrelation: 0.65,
  minSNR: 5.0,
  minPeakConsistency: 0.75,
  minPerfusionIndex: 0.003,
  minSpectralDominance: 0.4,
  minChannelCoherence: 0.8,
  minMorphologyScore: 0.7,
  maxMotionScore: 0.2,
  maxClippingRatio: 0.01,
  maxTextileLikelihood: 0.2,
  maxFlatObjectLikelihood: 0.15,
  minTemporalStability: 0.8,
  
  // Pesos
  weightSNR: 0.2,
  weightPeak: 0.2,
  weightSpectral: 0.15,
  weightCoherence: 0.15,
  weightMorphology: 0.15,
  weightStability: 0.1,
  weightAntiArtifact: 0.05,
};

export class SignalQualityHardGate {
  private config: SignalQualityConfig;
  private currentState: SignalQualityState = 'NO_TARGET';
  private stateStartTime: number = 0;
  private qualityHistory: SignalQualityMetrics[] = [];
  private pulseCount: number = 0;
  private readonly MAX_HISTORY = 100;

  constructor(config: Partial<SignalQualityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calcular entropía espectral
   */
  private calculateSpectralEntropy(magnitudes: number[]): number {
    // Normalizar magnitudes
    const total = magnitudes.reduce((sum, m) => sum + m, 0);
    if (total === 0) return 0;
    
    const probabilities = magnitudes.map(m => m / total).filter(p => p > 0);
    const entropy = -probabilities.reduce((sum, p) => sum + p * Math.log2(p), 0);
    
    // Normalizar a 0..1 (máxima entropía para distribución uniforme)
    const maxEntropy = Math.log2(magnitudes.length);
    return entropy / maxEntropy;
  }

  /**
   * Calcular ratio armónico
   */
  private calculateHarmonicRatio(frequencies: number[], magnitudes: number[], fundamentalFreq: number): number {
    // Encontrar pico en frecuencia fundamental
    const fundamentalIndex = frequencies.findIndex(f => Math.abs(f - fundamentalFreq) < 5);
    if (fundamentalIndex === -1 || magnitudes[fundamentalIndex] === 0) return 0;
    
    const fundamentalPower = magnitudes[fundamentalIndex];
    
    // Sumar poder de armónicos (2x, 3x fundamental)
    let harmonicPower = 0;
    for (let h = 2; h <= 4; h++) {
      const harmonicFreq = fundamentalFreq * h;
      const harmonicIndex = frequencies.findIndex(f => Math.abs(f - harmonicFreq) < 10);
      if (harmonicIndex !== -1) {
        harmonicPower += magnitudes[harmonicIndex];
      }
    }
    
    return harmonicPower / fundamentalPower;
  }

  /**
   * Calcular consistencia de picos
   */
  private calculatePeakConsistency(peaks: number[], signalLength: number, fs: number): number {
    if (peaks.length < 3) return 0;
    
    // Calcular intervalos entre picos
    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push((peaks[i] - peaks[i - 1]) / fs);
    }
    
    // Calcular coeficiente de variación
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + (interval - meanInterval) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    
    const coefficientOfVariation = meanInterval > 0 ? stdDev / meanInterval : 1;
    
    // Consistencia = 1 - CV (normalizado)
    return Math.max(0, 1 - coefficientOfVariation);
  }

  /**
   * Calcular estabilidad de RR intervals
   */
  private calculateRRStability(rrIntervals: number[]): number {
    if (rrIntervals.length < 3) return 0;
    
    const meanRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const variance = rrIntervals.reduce((sum, rr) => sum + (rr - meanRR) ** 2, 0) / rrIntervals.length;
    const stdDev = Math.sqrt(variance);
    
    // RMSSD (root mean square of successive differences)
    let rmssdSum = 0;
    for (let i = 1; i < rrIntervals.length; i++) {
      const diff = rrIntervals[i] - rrIntervals[i - 1];
      rmssdSum += diff * diff;
    }
    const rmssd = Math.sqrt(rmssdSum / (rrIntervals.length - 1));
    
    // Estabilidad = 1 - (RMSSD / meanRR)
    return Math.max(0, 1 - (rmssd / meanRR));
  }

  /**
   * Calcular score de morfología
   */
  private calculateMorphologyScore(
    signal: number[],
    peaks: number[],
    valleys: number[],
    firstDerivative: number[],
    secondDerivative: number[]
  ): number {
    if (peaks.length < 2 || valleys.length < 2) return 0;
    
    let morphologyScore = 1;
    
    // 1. Relación pico-valle
    let avgPeakValleyRatio = 0;
    let validRatios = 0;
    
    for (let i = 0; i < Math.min(peaks.length - 1, valleys.length); i++) {
      const peakValue = signal[peaks[i]];
      const valleyValue = signal[valleys[i]];
      
      if (valleyValue !== 0) {
        const ratio = (peakValue - valleyValue) / Math.abs(valleyValue);
        avgPeakValleyRatio += ratio;
        validRatios++;
      }
    }
    
    if (validRatios > 0) {
      avgPeakValleyRatio /= validRatios;
      morphologyScore *= Math.min(1, avgPeakValleyRatio / 2);
    }
    
    // 2. Pendiente ascendente/descendente
    let avgSlopeConsistency = 0;
    for (const peak of peaks) {
      if (peak > 5 && peak < signal.length - 5) {
        const slopeBefore = (signal[peak] - signal[peak - 5]) / 5;
        const slopeAfter = (signal[peak + 5] - signal[peak]) / 5;
        
        // Pico debe tener pendiente positiva antes y negativa después
        if (slopeBefore > 0 && slopeAfter < 0) {
          avgSlopeConsistency += 1;
        }
      }
    }
    
    if (peaks.length > 0) {
      avgSlopeConsistency /= peaks.length;
      morphologyScore *= avgSlopeConsistency;
    }
    
    // 3. Suavidad de la señal (no demasiado ruidosa)
    const signalVariance = signal.reduce((sum, x) => sum + x * x, 0) / signal.length;
    const smoothness = Math.max(0, 1 - signalVariance / 0.1);
    morphologyScore *= smoothness;
    
    return Math.max(0, Math.min(1, morphologyScore));
  }

  /**
   * Calcular estabilidad temporal
   */
  private calculateTemporalStability(): number {
    if (this.qualityHistory.length < 3) return 0;
    
    const recent = this.qualityHistory.slice(-10);
    const avgSQI = recent.reduce((sum, m) => sum + m.sqi, 0) / recent.length;
    const variance = recent.reduce((sum, m) => sum + (m.sqi - avgSQI) ** 2, 0) / recent.length;
    
    return Math.max(0, 1 - variance * 10);
  }

  /**
   * Determinar estado de la señal
   */
  private determineState(metrics: SignalQualityMetrics): SignalQualityState {
    // 1. Sin objetivo
    if (metrics.tissueLikelihood < 0.3) {
      return 'NO_TARGET';
    }
    
    // 2. Objeto no biológico
    if (metrics.textileLikelihood > 0.5 || metrics.flatObjectLikelihood > 0.4) {
      return 'NON_BIOLOGICAL_OBJECT';
    }
    
    // 3. Saturado
    if (metrics.clippingRatio > this.config.maxClippingRatio) {
      return 'SATURATED';
    }
    
    // 4. Movimiento excesivo
    if (metrics.motionScore > this.config.maxMotionScore) {
      return 'MOTION_ARTIFACT';
    }
    
    // 5. Contacto inestable
    if (metrics.tissueLikelihood < 0.6 || metrics.temporalStability < 0.5) {
      return 'CONTACT_UNSTABLE';
    }
    
    // 6. Baja perfusión
    if (metrics.perfusionIndex < this.config.minPerfusionIndex) {
      return 'LOW_PERFUSION';
    }
    
    // 7. Señal muy ruidosa
    if (metrics.snr < this.config.minSNR) {
      return 'SIGNAL_TOO_NOISY';
    }
    
    // 8. Calibrando
    if (metrics.sqi < 0.5) {
      return 'CALIBRATING';
    }
    
    // 9. Candidato a pulso
    if (metrics.sqi >= 0.5 && metrics.sqi < this.config.minSQI) {
      return 'PULSE_CANDIDATE';
    }
    
    // 10. Pulso confirmado pero no estable
    if (metrics.sqi >= this.config.minSQI && 
        (this.pulseCount < this.config.minValidPulses || 
         this.getTimeInCurrentState() < this.config.minStableTime)) {
      return 'LIVE_PULSE_CONFIRMED';
    }
    
    // 11. Listo para medición
    if (metrics.sqi >= this.config.minSQI && 
        this.pulseCount >= this.config.minValidPulses && 
        this.getTimeInCurrentState() >= this.config.minStableTime) {
      return 'MEASUREMENT_READY';
    }
    
    // 12. Bloqueado por defecto
    return 'MEASUREMENT_BLOCKED';
  }

  /**
   * Calcular SQI completo
   */
  private calculateSQI(
    ppgFeatures: PPGFeatures,
    livenessFeatures: LivenessFeatures
  ): SignalQualityMetrics {
    // 1. Métricas básicas
    const snr = Math.max(ppgFeatures.snrR, ppgFeatures.snrG, ppgFeatures.snrB);
    const perfusionIndex = Math.max(ppgFeatures.acDcRatioR, ppgFeatures.acDcRatioG, ppgFeatures.acDcRatioB);
    const acDcRatio = perfusionIndex;
    
    // 2. Métricas de picos
    const peakProminence = Math.min(1, Math.max(ppgFeatures.spectralPeakR, ppgFeatures.spectralPeakG, ppgFeatures.spectralPeakB) / 0.5);
    const peakConsistency = Math.max(
      this.calculatePeakConsistency(ppgFeatures.peaksR, ppgFeatures.filteredR.length, 30),
      this.calculatePeakConsistency(ppgFeatures.peaksG, ppgFeatures.filteredG.length, 30),
      this.calculatePeakConsistency(ppgFeatures.peaksB, ppgFeatures.filteredB.length, 30)
    );
    const rrStability = Math.max(
      this.calculateRRStability(ppgFeatures.rrIntervalsR),
      this.calculateRRStability(ppgFeatures.rrIntervalsG),
      this.calculateRRStability(ppgFeatures.rrIntervalsB)
    );
    
    // 3. Métricas espectrales
    const dominantFreq = (ppgFeatures.dominantFrequencyR + ppgFeatures.dominantFrequencyG + ppgFeatures.dominantFrequencyB) / 3;
    const spectralDominance = Math.min(1, Math.max(
      ppgFeatures.spectralPeakR, ppgFeatures.spectralPeakG, ppgFeatures.spectralPeakB
    ) / 0.3);
    
    // Calcular espectro completo para entropía y armónicos
    const fftResult = this.simpleFFT(ppgFeatures.filteredG); // Usar canal verde
    const spectralEntropy = this.calculateSpectralEntropy(fftResult.magnitudes);
    const harmonicRatio = this.calculateHarmonicRatio(fftResult.frequencies, fftResult.magnitudes, dominantFreq);
    
    // Autocorrelación
    const autocorr = this.autocorrelation(ppgFeatures.filteredG, Math.floor(30 / dominantFreq));
    const autocorrelation = autocorr.length > 0 ? Math.max(...autocorr.slice(1)) : 0;
    
    // 4. Morfología
    const morphologyScore = Math.max(
      this.calculateMorphologyScore(ppgFeatures.filteredR, ppgFeatures.peaksR, ppgFeatures.valleysR, ppgFeatures.firstDerivativeR, ppgFeatures.secondDerivativeR),
      this.calculateMorphologyScore(ppgFeatures.filteredG, ppgFeatures.peaksG, ppgFeatures.valleysG, ppgFeatures.firstDerivativeG, ppgFeatures.secondDerivativeG),
      this.calculateMorphologyScore(ppgFeatures.filteredB, ppgFeatures.peaksB, ppgFeatures.valleysB, ppgFeatures.firstDerivativeB, ppgFeatures.secondDerivativeB)
    );
    
    // 5. Coherencia
    const channelCoherence = (ppgFeatures.channelCoherenceRG + ppgFeatures.channelCoherenceRB + ppgFeatures.channelCoherenceGB) / 3;
    
    // 6. Artefactos
    const clippingRatio = livenessFeatures.clippingRatio;
    const motionScore = 1 - livenessFeatures.frameToFrameConsistency;
    const tissueLikelihood = livenessFeatures.tissueLikelihood;
    const textileLikelihood = livenessFeatures.textileLikelihood;
    const flatObjectLikelihood = livenessFeatures.flatSurfaceLikelihood;
    
    // 7. Estabilidad
    const temporalStability = this.calculateTemporalStability();
    const amplitudeStability = 1; // TODO: Implementar
    const frequencyStability = 1; // TODO: Implementar
    
    // 8. Calcular SQI ponderado
    const sqiComponents = {
      snr: Math.min(1, snr / 10),
      peak: peakConsistency,
      spectral: spectralDominance,
      coherence: channelCoherence,
      morphology: morphologyScore,
      stability: temporalStability,
      antiArtifact: (1 - motionScore) * (1 - clippingRatio * 10) * (1 - textileLikelihood) * (1 - flatObjectLikelihood),
    };
    
    const sqi = 
      sqiComponents.snr * this.config.weightSNR +
      sqiComponents.peak * this.config.weightPeak +
      sqiComponents.spectral * this.config.weightSpectral +
      sqiComponents.coherence * this.config.weightCoherence +
      sqiComponents.morphology * this.config.weightMorphology +
      sqiComponents.stability * this.config.weightStability +
      sqiComponents.antiArtifact * this.config.weightAntiArtifact;
    
    return {
      sqi: Math.max(0, Math.min(1, sqi)),
      snr,
      perfusionIndex,
      acDcRatio,
      peakProminence,
      peakConsistency,
      rrStability,
      autocorrelation,
      spectralDominance,
      spectralEntropy,
      harmonicRatio,
      morphologyScore,
      clippingRatio,
      motionScore,
      channelCoherence,
      tissueLikelihood,
      textileLikelihood,
      flatObjectLikelihood,
      temporalStability,
      amplitudeStability,
      frequencyStability,
    };
  }

  /**
   * FFT simplificada (misma que PPGExtractionEngine)
   */
  private simpleFFT(signal: number[]): { frequencies: number[]; magnitudes: number[] } {
    const n = signal.length;
    const frequencies: number[] = [];
    const magnitudes: number[] = [];
    
    for (let k = 0; k < n / 2; k++) {
      let real = 0;
      let imag = 0;
      
      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        real += signal[i] * Math.cos(angle);
        imag += signal[i] * Math.sin(angle);
      }
      
      frequencies.push(k * 60 / n);
      magnitudes.push(Math.sqrt(real * real + imag * imag) / n);
    }
    
    return { frequencies, magnitudes };
  }

  /**
   * Autocorrelación simplificada
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
   * Obtener tiempo en estado actual
   */
  private getTimeInCurrentState(): number {
    return (performance.now() - this.stateStartTime) / 1000;
  }

  /**
   * Evaluar calidad de señal
   */
  evaluate(
    ppgFeatures: PPGFeatures,
    livenessFeatures: LivenessFeatures
  ): SignalQualityResult {
    // Calcular métricas
    const metrics = this.calculateSQI(ppgFeatures, livenessFeatures);
    
    // Actualizar historial
    this.qualityHistory.push(metrics);
    if (this.qualityHistory.length > this.MAX_HISTORY) {
      this.qualityHistory.shift();
    }
    
    // Contar pulsos
    const totalPeaks = ppgFeatures.peaksR.length + ppgFeatures.peaksG.length + ppgFeatures.peaksB.length;
    this.pulseCount = Math.floor(totalPeaks / 3);
    
    // Determinar estado
    const newState = this.determineState(metrics);
    
    // Cambiar estado si es necesario
    if (newState !== this.currentState) {
      this.currentState = newState;
      this.stateStartTime = performance.now();
    }
    
    // Evaluar si pasa el gate
    const passed = metrics.sqi >= this.config.minSQI && 
                  this.currentState === 'MEASUREMENT_READY';
    
    // Generar razones de rechazo
    const reasons: string[] = [];
    if (!passed) {
      if (metrics.sqi < this.config.minSQI) {
        reasons.push(`SQI bajo: ${metrics.sqi.toFixed(3)} < ${this.config.minSQI}`);
      }
      if (this.pulseCount < this.config.minValidPulses) {
        reasons.push(`Pulsos insuficientes: ${this.pulseCount} < ${this.config.minValidPulses}`);
      }
      if (this.getTimeInCurrentState() < this.config.minStableTime) {
        reasons.push(`Tiempo estable insuficiente: ${this.getTimeInCurrentState().toFixed(1)}s < ${this.config.minStableTime}s`);
      }
      if (metrics.autocorrelation < this.config.minAutocorrelation) {
        reasons.push(`Autocorrelación baja: ${metrics.autocorrelation.toFixed(3)} < ${this.config.minAutocorrelation}`);
      }
      if (metrics.snr < this.config.minSNR) {
        reasons.push(`SNR bajo: ${metrics.snr.toFixed(1)} < ${this.config.minSNR}`);
      }
      if (metrics.peakConsistency < this.config.minPeakConsistency) {
        reasons.push(`Consistencia de picos baja: ${metrics.peakConsistency.toFixed(3)} < ${this.config.minPeakConsistency}`);
      }
      if (metrics.channelCoherence < this.config.minChannelCoherence) {
        reasons.push(`Coherencia entre canales baja: ${metrics.channelCoherence.toFixed(3)} < ${this.config.minChannelCoherence}`);
      }
      if (metrics.textileLikelihood > this.config.maxTextileLikelihood) {
        reasons.push(`Patrón de tela detectado: ${(metrics.textileLikelihood * 100).toFixed(1)}%`);
      }
      if (metrics.flatObjectLikelihood > this.config.maxFlatObjectLikelihood) {
        reasons.push(`Superficie plana detectada: ${(metrics.flatObjectLikelihood * 100).toFixed(1)}%`);
      }
    }
    
    // Calcular confianza
    const confidence = metrics.sqi;
    
    return {
      sqi: metrics.sqi,
      passed,
      reasons,
      metrics,
      state: this.currentState,
      confidence,
      timeInState: this.getTimeInCurrentState(),
      pulsesAnalyzed: this.pulseCount,
    };
  }

  /**
   * Resetear gate
   */
  reset(): void {
    this.currentState = 'NO_TARGET';
    this.stateStartTime = performance.now();
    this.qualityHistory = [];
    this.pulseCount = 0;
  }

  /**
   * Obtener estado actual
   */
  getCurrentState(): SignalQualityState {
    return this.currentState;
  }

  /**
   * Obtener historial de métricas
   */
  getHistory(): SignalQualityMetrics[] {
    return [...this.qualityHistory];
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<SignalQualityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): SignalQualityConfig {
    return { ...this.config };
  }
}
