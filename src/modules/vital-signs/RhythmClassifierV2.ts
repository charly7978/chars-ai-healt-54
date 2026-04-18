/**
 * RHYTHM CLASSIFIER V2 - FASE 8 COMPLETA
 * 
 * Detector jerárquico de ritmos PPG basado en:
 * - SQI gate estricto
 * - Beat detector con acceptance/rejection
 * - RR series cleaning
 * - Beat morphology extraction
 * - Feature extraction por ventana
 * - Rule engine + probabilistic smoothing
 * - Output state machine
 * 
 * Clasificación jerárquica:
 * - sinus_regular
 * - sinus_variable
 * - irregular_undetermined
 * - af_suspected
 * - frequent_ectopy_suspected
 * - brady_irregular
 * - tachy_irregular
 * - noise_or_unreliable
 * 
 * REGLAS ESTRICTAS:
 * - AF no dispara por 2-3 RR raros (requiere persistencia)
 * - Ectopia ≠ AF (separación explícita)
 * - Ruido/motion ≠ arritmia
 * - Cada clase aporta evidenceBreakdown
 */

import type { 
  MeasurementOutput, 
  ArrhythmiaOutput, 
  QualityFlag,
  MeasurementFrameState,
  BeatAccepted 
} from '../../types/measurement';

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export type RhythmLabelV2 = 
  | 'sinus_regular'
  | 'sinus_variable'
  | 'brady_regular'
  | 'tachy_regular'
  | 'brady_irregular'
  | 'tachy_irregular'
  | 'irregular_undetermined'
  | 'af_suspected'
  | 'frequent_ectopy_suspected'
  | 'bigeminy_suspected'
  | 'trigeminy_suspected'
  | 'noise_or_unreliable'
  | 'insufficient_data';

export interface RhythmEvidence {
  // Features temporales
  temporal: {
    medianRR: number;           // ms
    madRR: number;              // Median Absolute Deviation
    cvrr: number;               // Coefficient of Variation
    rmssd: number;
    pnn20: number;
    pnn50: number;
    turningPointRatio: number;
    irregularityIndex: number;
    sampleEntropy: number;
    sd1: number;                // Poincaré short-term
    sd2: number;                // Poincaré long-term
    sd1sd2Ratio: number;
    shortTermVariability: number;
    tachyBurden: number;        // % time HR > 100
    bradyBurden: number;        // % time HR < 50
  };
  
  // Features morfológicas (promedio de beats aceptados)
  morphological: {
    meanAmplitude: number;
    amplitudeCV: number;        // Variabilidad de amplitud
    meanPulseWidth: number;
    meanRiseTime: number;
    meanDecayTime: number;
    meanCrestTime: number;
    meanArea: number;
    templateCorrelation: number;
    asymmetryIndex: number;
    notchPresence: number;      // evidencia de notch dicrotico
    dicroticNotchDepth: number;
    derivativeEnergy: number;
  };
  
  // Features espectrales
  spectral: {
    dominantFreq: number;       // Hz
    bandwidth: number;
    harmonicRatio: number;
    spectralEntropy: number;
    sidebandInstability: number;
  };
  
  // Scores de evidencia (0-1)
  scores: {
    afEvidence: number;         // Patrón irregular + ausencia de onda P
    ectopyEvidence: number;     // Beats prematuros con compensación
    bigeminyEvidence: number;   // Patrón alternante
    trigeminyEvidence: number;  // Patrón cada 3ro
    bradyEvidence: number;      // Bradicardia
    tachyEvidence: number;      // Taquicardia
    noiseEvidence: number;      // Ruido/artefactos
  };
  
  // Metadata
  acceptedBeats: number;
  totalBeats: number;
  acceptanceRate: number;
  windowDurationMs: number;
  classificationPath: string[];
}

// Beat con información morfológica completa
interface MorphologyBeat extends BeatAccepted {
  // Timing
  onset: number;              // inicio de subida
  peak: number;               // pico
  dicroticNotch?: number;     // notch dicrotico
  end: number;                // fin del pulso
  
  // Amplitudes
  amplitude: number;          // pico - baseline
  sysPeak: number;            // pico sistólico
  diaPeak?: number;           // pico diastólico (reflexión)
  
  // Tiempos característicos (ms)
  riseTime: number;           // onset → peak
  decayTime: number;        // peak → end
  pulseWidth: number;       // ancho a 50%
  pw25: number;             // ancho a 25%
  pw75: number;             // ancho a 75%
  crestTime: number;        // tiempo al pico desde inicio
  
  // Áreas
  sysArea: number;          // área sistólica
  totalArea: number;        // área total
  areaRatio: number;        // sys/total
  
  // Derivadas
  maxSlopeUp: number;
  maxSlopeDown: number;
  slopeRatio: number;
  
  // Calidad morfológica
  morphologySQI: number;
  templateCorrelation: number;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  // Ventanas de análisis
  MIN_BEATS_FOR_CLASSIFICATION: 8,
  OPTIMAL_BEATS: 15,
  MAX_BEATS_IN_WINDOW: 30,
  MIN_WINDOW_DURATION_MS: 8000,
  ANALYSIS_WINDOW_MS: 30000,    // 30 segundos de contexto
  
  // Thresholds de calidad
  MIN_ACCEPTANCE_RATE: 0.6,     // 60% beats aceptados mínimo
  MIN_MORPHOLOGY_SQI: 0.35,
  MIN_TEMPLATE_CORRELATION: 0.5,
  
  // Thresholds fisiológicos
  BRADYCARDIA_THRESHOLD: 50,    // bpm
  TACHYCARDIA_THRESHOLD: 100,   // bpm
  MIN_VALID_RR: 300,            // ms (200 bpm)
  MAX_VALID_RR: 2000,           // ms (30 bpm)
  
  // Thresholds de irregularidad
  AF_PERSISTENCE_FRAMES: 4,     // frames consecutivos para AF
  ECTOPY_PERSISTENCE_FRAMES: 3,
  IRREGULARITY_THRESHOLD: 0.15,  // CVRR > 15% es irregular
  HIGH_IRREGULARITY: 0.25,       // CVRR > 25% muy irregular
  
  // Pesos de evidencia
  AF_SCORE_THRESHOLD: 0.65,
  ECTOPY_SCORE_THRESHOLD: 0.60,
  BIGEMINY_THRESHOLD: 0.70,
  
  // Smoothing temporal
  LABEL_HYSTERESIS: 2,          // frames de confirmación
  CONFIDENCE_SMOOTHING: 0.3,    // alpha EWMA
};

// ═══════════════════════════════════════════════════════════════════
//  CLASE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export class RhythmClassifierV2 {
  private beatHistory: MorphologyBeat[] = [];
  private labelHistory: RhythmLabelV2[] = [];
  private evidenceHistory: Partial<RhythmEvidence>[] = [];
  
  // Estado temporal
  private afCandidateCount = 0;
  private ectopyCandidateCount = 0;
  private lastLabel: RhythmLabelV2 = 'insufficient_data';
  private smoothedConfidence = 0;
  private frameCount = 0;
  
  // Templates
  private beatTemplate: number[] | null = null;
  private templateUpdateCount = 0;
  private readonly TEMPLATE_UPDATE_INTERVAL = 10;
  
  /**
   * Procesar ventana de beats y clasificar ritmo
   */
  classify(
    beats: MorphologyBeat[],
    frameState: MeasurementFrameState,
    sqi: number
  ): ArrhythmiaOutput {
    this.frameCount++;
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 1: Suficientes datos
    // ═══════════════════════════════════════════════════════════════
    if (beats.length < CONFIG.MIN_BEATS_FOR_CLASSIFICATION) {
      return this.createOutput('insufficient_data', 0, [], {
        reason: `Insufficient beats: ${beats.length}/${CONFIG.MIN_BEATS_FOR_CLASSIFICATION}`,
        acceptedBeats: beats.length,
        totalBeats: beats.length,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 2: Calidad de aceptación
    // ═══════════════════════════════════════════════════════════════
    const acceptedBeats = beats.filter(b => b.rrIntervalValid);
    const acceptanceRate = acceptedBeats.length / beats.length;
    
    if (acceptanceRate < CONFIG.MIN_ACCEPTANCE_RATE) {
      return this.createOutput('noise_or_unreliable', 0.1, ['beat_rejection_high'], {
        reason: `Low acceptance rate: ${(acceptanceRate * 100).toFixed(1)}%`,
        acceptedBeats: acceptedBeats.length,
        totalBeats: beats.length,
        acceptanceRate,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 3: SQI global
    // ═══════════════════════════════════════════════════════════════
    if (sqi < 0.3) {
      return this.createOutput('noise_or_unreliable', 0.15, ['low_snr'], {
        reason: `Low SQI: ${sqi.toFixed(2)}`,
        sqi,
        acceptedBeats: acceptedBeats.length,
        totalBeats: beats.length,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  EXTRACCIÓN DE FEATURES
    // ═══════════════════════════════════════════════════════════════
    const evidence = this.extractEvidence(acceptedBeats, frameState);
    
    // ═══════════════════════════════════════════════════════════════
    //  CLASIFICACIÓN JERÁRQUICA
    // ═══════════════════════════════════════════════════════════════
    const classification = this.hierarchicalClassify(evidence, sqi);
    
    // ═══════════════════════════════════════════════════════════════
    //  SMOOTHING TEMPORAL Y PERSISTENCIA
    // ═══════════════════════════════════════════════════════════════
    const smoothedLabel = this.applyTemporalSmoothing(
      classification.label, 
      classification.confidence,
      evidence
    );
    
    // Actualizar historial
    this.labelHistory.push(smoothedLabel);
    if (this.labelHistory.length > 10) this.labelHistory.shift();
    
    this.evidenceHistory.push(evidence);
    if (this.evidenceHistory.length > 5) this.evidenceHistory.shift();
    
    // Actualizar template
    this.updateTemplate(acceptedBeats);
    
    return this.createOutput(
      smoothedLabel,
      this.smoothedConfidence,
      this.deriveQualityFlags(smoothedLabel, evidence),
      evidence
    );
  }
  
  /**
   * Extraer todas las evidencias de la ventana
   */
  private extractEvidence(
    beats: MorphologyBeat[],
    frameState: MeasurementFrameState
  ): RhythmEvidence {
    const rrIntervals = beats
      .filter(b => b.rrIntervalValid)
      .map(b => b.rrInterval);
    
    // Temporal features
    const temporal = this.computeTemporalFeatures(rrIntervals);
    
    // Morphological features
    const morphological = this.computeMorphologicalFeatures(beats);
    
    // Spectral features
    const spectral = this.computeSpectralFeatures(rrIntervals);
    
    // Evidence scores
    const scores = this.computeEvidenceScores(
      temporal, 
      morphological, 
      spectral,
      frameState
    );
    
    return {
      temporal,
      morphological,
      spectral,
      scores,
      acceptedBeats: beats.length,
      totalBeats: this.beatHistory.length + beats.length,
      acceptanceRate: beats.length / (this.beatHistory.length + beats.length),
      windowDurationMs: rrIntervals.reduce((a, b) => a + b, 0),
      classificationPath: [],
    };
  }
  
  /**
   * Features temporales (HRV)
   */
  private computeTemporalFeatures(rrIntervals: number[]): RhythmEvidence['temporal'] {
    if (rrIntervals.length < 2) {
      return {
        medianRR: 0, madRR: 0, cvrr: 0, rmssd: 0,
        pnn20: 0, pnn50: 0, turningPointRatio: 0,
        irregularityIndex: 0, sampleEntropy: 0,
        sd1: 0, sd2: 0, sd1sd2Ratio: 0,
        shortTermVariability: 0, tachyBurden: 0, bradyBurden: 0,
      };
    }
    
    // RR statistics
    const medianRR = this.median(rrIntervals);
    const madRR = this.medianAbsoluteDeviation(rrIntervals, medianRR);
    const meanRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const stdRR = this.standardDeviation(rrIntervals, meanRR);
    const cvrr = meanRR > 0 ? stdRR / meanRR : 0;
    
    // RMSSD
    let rmssd = 0;
    let pnn20 = 0;
    let pnn50 = 0;
    
    for (let i = 1; i < rrIntervals.length; i++) {
      const diff = rrIntervals[i] - rrIntervals[i - 1];
      rmssd += diff * diff;
      if (Math.abs(diff) > 20) pnn20++;
      if (Math.abs(diff) > 50) pnn50++;
    }
    rmssd = Math.sqrt(rmssd / (rrIntervals.length - 1));
    pnn20 = pnn20 / (rrIntervals.length - 1);
    pnn50 = pnn50 / (rrIntervals.length - 1);
    
    // Turning point ratio
    let turningPoints = 0;
    for (let i = 1; i < rrIntervals.length - 1; i++) {
      if ((rrIntervals[i] > rrIntervals[i-1] && rrIntervals[i] > rrIntervals[i+1]) ||
          (rrIntervals[i] < rrIntervals[i-1] && rrIntervals[i] < rrIntervals[i+1])) {
        turningPoints++;
      }
    }
    const turningPointRatio = turningPoints / Math.max(1, rrIntervals.length - 2);
    
    // Irregularity index
    const irregularityIndex = this.computeIrregularityIndex(rrIntervals);
    
    // Sample entropy
    const sampleEntropy = this.computeSampleEntropy(rrIntervals, 2, 0.2 * stdRR);
    
    // Poincaré
    const sd1 = Math.sqrt(rmssd * rmssd / 2);
    const sd2 = Math.sqrt(2 * stdRR * stdRR - sd1 * sd1);
    const sd1sd2Ratio = sd2 > 0 ? sd1 / sd2 : 0;
    
    // Burden
    const bpmValues = rrIntervals.map(rr => 60000 / rr);
    const tachyBurden = bpmValues.filter(bpm => bpm > CONFIG.TACHYCARDIA_THRESHOLD).length / bpmValues.length;
    const bradyBurden = bpmValues.filter(bpm => bpm < CONFIG.BRADYCARDIA_THRESHOLD).length / bpmValues.length;
    
    return {
      medianRR, madRR, cvrr, rmssd,
      pnn20, pnn50, turningPointRatio,
      irregularityIndex, sampleEntropy,
      sd1, sd2, sd1sd2Ratio,
      shortTermVariability: sd1,
      tachyBurden, bradyBurden,
    };
  }
  
  /**
   * Features morfológicas
   */
  private computeMorphologicalFeatures(beats: MorphologyBeat[]): RhythmEvidence['morphological'] {
    if (beats.length === 0) {
      return {
        meanAmplitude: 0, amplitudeCV: 0, meanPulseWidth: 0,
        meanRiseTime: 0, meanDecayTime: 0, meanCrestTime: 0,
        meanArea: 0, templateCorrelation: 0, asymmetryIndex: 0,
        notchPresence: 0, dicroticNotchDepth: 0, derivativeEnergy: 0,
      };
    }
    
    const amplitudes = beats.map(b => b.amplitude);
    const widths = beats.map(b => b.pulseWidth);
    const riseTimes = beats.map(b => b.riseTime);
    const decayTimes = beats.map(b => b.decayTime);
    const crestTimes = beats.map(b => b.crestTime);
    const areas = beats.map(b => b.totalArea);
    const correlations = beats.map(b => b.templateCorrelation);
    const notchDepths = beats.map(b => b.dicroticNotch ?? 0);
    
    const meanAmplitude = this.mean(amplitudes);
    const amplitudeCV = this.coefficientOfVariation(amplitudes);
    const meanTemplateCorrelation = this.mean(correlations);
    
    // Asymmetry: rise vs decay
    const asymmetryIndex = this.mean(riseTimes) / (this.mean(decayTimes) + 0.001);
    
    // Notch presence
    const notchPresence = beats.filter(b => (b.dicroticNotch ?? 0) > 0.1).length / beats.length;
    
    return {
      meanAmplitude,
      amplitudeCV,
      meanPulseWidth: this.mean(widths),
      meanRiseTime: this.mean(riseTimes),
      meanDecayTime: this.mean(decayTimes),
      meanCrestTime: this.mean(crestTimes),
      meanArea: this.mean(areas),
      templateCorrelation: meanTemplateCorrelation,
      asymmetryIndex,
      notchPresence,
      dicroticNotchDepth: this.mean(notchDepths),
      derivativeEnergy: this.mean(beats.map(b => b.maxSlopeUp + Math.abs(b.maxSlopeDown))),
    };
  }
  
  /**
   * Features espectrales
   */
  private computeSpectralFeatures(rrIntervals: number[]): RhythmEvidence['spectral'] {
    if (rrIntervals.length < 4) {
      return {
        dominantFreq: 0, bandwidth: 0,
        harmonicRatio: 0, spectralEntropy: 0, sidebandInstability: 0,
      };
    }
    
    // FFT simple
    const n = Math.min(rrIntervals.length, 64);
    const freqs = this.computeFFT(rrIntervals.slice(-n));
    
    // Frecuencia dominante
    let maxMag = 0;
    let dominantFreq = 0;
    for (let i = 0; i < freqs.length / 2; i++) {
      if (freqs[i] > maxMag) {
        maxMag = freqs[i];
        dominantFreq = i / n;
      }
    }
    
    // Bandwidth (frecuencias con >50% de energía)
    const threshold = maxMag * 0.5;
    let bandwidth = 0;
    for (let i = 0; i < freqs.length / 2; i++) {
      if (freqs[i] > threshold) bandwidth++;
    }
    bandwidth = bandwidth / n;
    
    // Entropía espectral
    const totalEnergy = freqs.reduce((a, b) => a + b, 0) + 0.001;
    const spectralEntropy = -freqs
      .slice(0, freqs.length / 2)
      .reduce((sum, mag) => {
        const p = mag / totalEnergy;
        return sum + (p > 0 ? p * Math.log2(p) : 0);
      }, 0);
    
    return {
      dominantFreq,
      bandwidth,
      harmonicRatio: 0, // Computar si hay frecuencias armónicas claras
      spectralEntropy,
      sidebandInstability: bandwidth > 0.1 ? 1 : 0,
    };
  }
  
  /**
   * Scores de evidencia (0-1)
   */
  private computeEvidenceScores(
    temporal: RhythmEvidence['temporal'],
    morphological: RhythmEvidence['morphological'],
    spectral: RhythmEvidence['spectral'],
    frameState: MeasurementFrameState
  ): RhythmEvidence['scores'] {
    // AF evidence: irregularidad + caos + ausencia de organización
    let afEvidence = 0;
    if (temporal.cvrr > 0.15) afEvidence += 0.3;
    if (temporal.cvrr > 0.25) afEvidence += 0.3;
    if (temporal.sampleEntropy > 1.5) afEvidence += 0.2;
    if (spectral.spectralEntropy > 0.7) afEvidence += 0.1;
    if (temporal.sd1sd2Ratio > 0.8) afEvidence += 0.1;
    // Penalizar si hay mucho ruido
    if (frameState.motion.score > 0.3) afEvidence *= 0.5;
    
    // Ectopy evidence: beats prematuros aislados
    let ectopyEvidence = 0;
    if (temporal.pnn50 > 0.2 && temporal.cvrr < 0.2) ectopyEvidence += 0.4; // RR irregular pero no caótico
    if (morphological.amplitudeCV > 0.25) ectopyEvidence += 0.3; // Amplitudes variables
    if (temporal.turningPointRatio > 0.4) ectopyEvidence += 0.3;
    
    // Bigeminy: patrón alternante
    let bigeminyEvidence = 0;
    if (this.detectAlternatingPattern()) bigeminyEvidence += 0.7;
    if (temporal.turningPointRatio > 0.5) bigeminyEvidence += 0.3;
    
    // Trigeminy: patrón cada 3ro
    let trigeminyEvidence = 0;
    if (this.detectTrigeminyPattern()) trigeminyEvidence += 0.7;
    
    // Brady/Tachy
    const meanBPM = 60000 / (temporal.medianRR + 0.001);
    const bradyEvidence = meanBPM < CONFIG.BRADYCARDIA_THRESHOLD ? 
      (CONFIG.BRADYCARDIA_THRESHOLD - meanBPM) / CONFIG.BRADYCARDIA_THRESHOLD : 0;
    const tachyEvidence = meanBPM > CONFIG.TACHYCARDIA_THRESHOLD ? 
      (meanBPM - CONFIG.TACHYCARDIA_THRESHOLD) / 50 : 0;
    
    // Noise evidence
    const noiseEvidence = Math.max(
      frameState.motion.score * 0.4,
      (1 - morphological.templateCorrelation) * 0.3,
      (1 - frameState.signalQuality.sqi) * 0.3
    );
    
    return {
      afEvidence: Math.min(1, afEvidence),
      ectopyEvidence: Math.min(1, ectopyEvidence),
      bigeminyEvidence: Math.min(1, bigeminyEvidence),
      trigeminyEvidence: Math.min(1, trigeminyEvidence),
      bradyEvidence: Math.min(1, bradyEvidence),
      tachyEvidence: Math.min(1, tachyEvidence),
      noiseEvidence: Math.min(1, noiseEvidence),
    };
  }
  
  /**
   * Clasificación jerárquica
   */
  private hierarchicalClassify(
    evidence: RhythmEvidence,
    sqi: number
  ): { label: RhythmLabelV2; confidence: number } {
    const { temporal, morphological, scores } = evidence;
    const path: string[] = [];
    
    // Nivel 1: Calidad
    path.push('quality_check');
    if (scores.noiseEvidence > 0.6 || sqi < 0.4) {
      return { label: 'noise_or_unreliable', confidence: scores.noiseEvidence };
    }
    
    // Nivel 2: Frecuencia (brady/tachy)
    path.push('rate_check');
    const meanBPM = 60000 / (temporal.medianRR + 0.001);
    const isBrady = scores.bradyEvidence > 0.6;
    const isTachy = scores.tachyEvidence > 0.6;
    
    // Nivel 3: Irregularidad
    path.push('rhythm_pattern');
    const isRegular = temporal.cvrr < CONFIG.IRREGULARITY_THRESHOLD;
    
    if (!isRegular) {
      // Hay irregularidad - clasificar tipo
      path.push('irregular_type');
      
      // AF vs Ectopy vs Bigeminy
      if (scores.afEvidence > scores.ectopyEvidence && 
          scores.afEvidence > scores.bigeminyEvidence &&
          scores.afEvidence > CONFIG.AF_SCORE_THRESHOLD) {
        return { label: 'af_suspected', confidence: scores.afEvidence };
      }
      
      if (scores.bigeminyEvidence > CONFIG.BIGEMINY_THRESHOLD) {
        return { label: 'bigeminy_suspected', confidence: scores.bigeminyEvidence };
      }
      
      if (scores.trigeminyEvidence > CONFIG.BIGEMINY_THRESHOLD) {
        return { label: 'trigeminy_suspected', confidence: scores.trigeminyEvidence };
      }
      
      if (scores.ectopyEvidence > CONFIG.ECTOPY_SCORE_THRESHOLD) {
        return { label: 'frequent_ectopy_suspected', confidence: scores.ectopyEvidence };
      }
      
      // Irregularidad indeterminada
      if (isBrady) return { label: 'brady_irregular', confidence: 0.6 };
      if (isTachy) return { label: 'tachy_irregular', confidence: 0.6 };
      return { label: 'irregular_undetermined', confidence: 0.5 };
    }
    
    // Regular
    path.push('regular_type');
    if (isBrady) return { label: 'brady_regular', confidence: scores.bradyEvidence };
    if (isTachy) return { label: 'tachy_regular', confidence: scores.tachyEvidence };
    
    // Variable vs estable
    if (temporal.cvrr > 0.08) {
      return { label: 'sinus_variable', confidence: 0.7 };
    }
    
    return { label: 'sinus_regular', confidence: 0.85 };
  }
  
  /**
   * Smoothing temporal con histéresis
   */
  private applyTemporalSmoothing(
    newLabel: RhythmLabelV2,
    rawConfidence: number,
    evidence: RhythmEvidence
  ): RhythmLabelV2 {
    // EWMA de confianza
    this.smoothedConfidence = this.smoothedConfidence * (1 - CONFIG.CONFIDENCE_SMOOTHING) + 
                             rawConfidence * CONFIG.CONFIDENCE_SMOOTHING;
    
    // Persistencia para AF
    if (newLabel === 'af_suspected') {
      this.afCandidateCount++;
      if (this.afCandidateCount >= CONFIG.AF_PERSISTENCE_FRAMES) {
        this.lastLabel = 'af_suspected';
        return 'af_suspected';
      }
      return this.lastLabel;
    } else {
      this.afCandidateCount = Math.max(0, this.afCandidateCount - 1);
    }
    
    // Persistencia para ectopy
    if (newLabel === 'frequent_ectopy_suspected') {
      this.ectopyCandidateCount++;
      if (this.ectopyCandidateCount >= CONFIG.ECTOPY_PERSISTENCE_FRAMES) {
        this.lastLabel = 'frequent_ectopy_suspected';
        return 'frequent_ectopy_suspected';
      }
      return this.lastLabel;
    } else {
      this.ectopyCandidateCount = Math.max(0, this.ectopyCandidateCount - 1);
    }
    
    // Histéresis general
    if (newLabel === this.lastLabel || this.labelHistory.length < CONFIG.LABEL_HYSTERESIS) {
      this.lastLabel = newLabel;
      return newLabel;
    }
    
    // Verificar estabilidad del nuevo label
    const recentLabels = this.labelHistory.slice(-CONFIG.LABEL_HYSTERESIS);
    const isStable = recentLabels.every(l => l === newLabel);
    
    if (isStable) {
      this.lastLabel = newLabel;
    }
    
    return this.lastLabel;
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═════════════════════════════════════════════════════════════════
  
  private createOutput(
    label: RhythmLabelV2,
    confidence: number,
    flags: QualityFlag[],
    evidence: Partial<RhythmEvidence> | { reason: string; [key: string]: any }
  ): ArrhythmiaOutput {
    return {
      value: label === 'noise_or_unreliable' || label === 'insufficient_data' ? null : label,
      unit: 'classification',
      confidence,
      status: label === 'noise_or_unreliable' ? 'blocked' : 
              label === 'insufficient_data' ? 'initializing' : 'ok',
      qualityFlags: flags,
      evidence: {
        sqi: this.smoothedConfidence,
        acceptedWindows: evidence.acceptedBeats || 0,
        totalWindows: evidence.totalBeats || 0,
        acceptedBeats: evidence.acceptedBeats || 0,
        totalBeats: evidence.totalBeats || 0,
        measurementDurationMs: evidence.windowDurationMs || 0,
        effectiveFps: 0,
          // Extended arrhythmia evidence (always include for arrhythmia output)
        rhythmLabel: label,
        classificationPath: evidence.classificationPath || [],
        afEvidence: evidence.scores?.afEvidence || 0,
        ectopyEvidence: evidence.scores?.ectopyEvidence || 0,
        irregularityEvidence: evidence.temporal?.cvrr || 0,
        burden: evidence.scores ? (evidence.scores.afEvidence || evidence.scores.ectopyEvidence || 0) : 0,
      },
      debug: evidence,
    };
  }
  
  private deriveQualityFlags(label: RhythmLabelV2, evidence: RhythmEvidence): QualityFlag[] {
    const flags: QualityFlag[] = [];
    
    if (evidence.acceptedBeats < CONFIG.OPTIMAL_BEATS) {
      flags.push('insufficient_beats');
    }
    
    if (evidence.morphological?.templateCorrelation < CONFIG.MIN_TEMPLATE_CORRELATION) {
      flags.push('morphology_atypical');
    }
    
    if (evidence.temporal?.cvrr > 0.2) {
      flags.push('rr_instability');
    }
    
    if (label === 'noise_or_unreliable') {
      flags.push('high_motion_artifact');
    }
    
    return flags;
  }
  
  private updateTemplate(beats: MorphologyBeat[]): void {
    if (beats.length < 3) return;
    
    this.templateUpdateCount++;
    if (this.templateUpdateCount % this.TEMPLATE_UPDATE_INTERVAL !== 0) return;
    
    // Usar el beat más típico como template
    const validBeats = beats.filter(b => b.templateCorrelation > 0.6);
    if (validBeats.length === 0) return;
    
    // Promedio de morfología
    const avgAmplitude = this.mean(validBeats.map(b => b.amplitude));
    const avgWidth = this.mean(validBeats.map(b => b.pulseWidth));
    
    this.beatTemplate = [avgAmplitude, avgWidth];
  }
  
  private detectAlternatingPattern(): boolean {
    if (this.beatHistory.length < 6) return false;
    
    const recent = this.beatHistory.slice(-6);
    const rr1 = recent[0].rrInterval;
    const rr2 = recent[1].rrInterval;
    
    // Patrón alternante: corto-largo-corto-largo
    let alternations = 0;
    for (let i = 2; i < recent.length; i++) {
      const expected = i % 2 === 0 ? rr1 : rr2;
      const actual = recent[i].rrInterval;
      if (Math.abs(actual - expected) < 50) alternations++;
    }
    
    return alternations >= 3;
  }
  
  private detectTrigeminyPattern(): boolean {
    if (this.beatHistory.length < 9) return false;
    
    const recent = this.beatHistory.slice(-9);
    const pattern = [0, 1, 2].map(i => recent[i].rrInterval);
    
    // Verificar repetición del patrón de 3
    let matches = 0;
    for (let i = 3; i < recent.length; i++) {
      const expectedIdx = i % 3;
      const diff = Math.abs(recent[i].rrInterval - pattern[expectedIdx]);
      if (diff < 50) matches++;
    }
    
    return matches >= 4;
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  ESTADÍSTICAS
  // ═════════════════════════════════════════════════════════════════
  
  private mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  }
  
  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  private medianAbsoluteDeviation(arr: number[], median?: number): number {
    const med = median ?? this.median(arr);
    const deviations = arr.map(x => Math.abs(x - med));
    return this.median(deviations);
  }
  
  private standardDeviation(arr: number[], mean?: number): number {
    const m = mean ?? this.mean(arr);
    const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length || 1);
    return Math.sqrt(variance);
  }
  
  private coefficientOfVariation(arr: number[]): number {
    const m = this.mean(arr);
    return m > 0 ? this.standardDeviation(arr, m) / m : 0;
  }
  
  private computeIrregularityIndex(rrIntervals: number[]): number {
    if (rrIntervals.length < 3) return 0;
    let sum = 0;
    for (let i = 1; i < rrIntervals.length - 1; i++) {
      const diff1 = Math.abs(rrIntervals[i] - rrIntervals[i-1]);
      const diff2 = Math.abs(rrIntervals[i+1] - rrIntervals[i]);
      sum += Math.abs(diff1 - diff2);
    }
    return sum / (rrIntervals.length - 2);
  }
  
  private computeSampleEntropy(data: number[], m: number, r: number): number {
    const N = data.length;
    if (N < m + 1) return 0;
    
    // Simplificado: usar Aproximate Entropy como proxy
    let matches = 0;
    let total = 0;
    
    for (let i = 0; i < N - m; i++) {
      for (let j = i + 1; j < N - m; j++) {
        let match = true;
        for (let k = 0; k < m; k++) {
          if (Math.abs(data[i+k] - data[j+k]) > r) {
            match = false;
            break;
          }
        }
        total++;
        if (match) matches++;
      }
    }
    
    return total > 0 ? -Math.log(matches / (total + 0.001)) : 0;
  }
  
  private computeFFT(data: number[]): number[] {
    // FFT simplificada (placeholder para implementación real)
    const n = data.length;
    const result = new Array(n).fill(0);
    
    // Usar DFT básico
    for (let k = 0; k < n; k++) {
      let real = 0;
      let imag = 0;
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * k * t) / n;
        real += data[t] * Math.cos(angle);
        imag -= data[t] * Math.sin(angle);
      }
      result[k] = Math.sqrt(real * real + imag * imag);
    }
    
    return result;
  }
  
  /**
   * Resetear estado
   */
  reset(): void {
    this.beatHistory = [];
    this.labelHistory = [];
    this.evidenceHistory = [];
    this.afCandidateCount = 0;
    this.ectopyCandidateCount = 0;
    this.lastLabel = 'insufficient_data';
    this.smoothedConfidence = 0;
    this.frameCount = 0;
    this.beatTemplate = null;
    this.templateUpdateCount = 0;
  }
}
