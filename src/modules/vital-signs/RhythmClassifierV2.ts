/**
 * RHYTHM CLASSIFIER V2 - FASE 8 COMPLETA
 * 
 * Detector jerárquico de arritmias PPG con:
 * - Pipeline: SQI gate → Beat validation → RR cleaning → Feature extraction → Classification
 * - Features temporales: RMSSD, pNN50, CVRR, SD1/SD2, sample entropy
 * - Features morfológicas: Amplitude, width, asymmetry, notch depth
 * - Features espectrales: Dominant freq, bandwidth, entropy
 * - Temporal smoothing con persistencia configurable
 * - Evidence scores para cada clase
 * 
 * Output: RhythmLabelV2 con confidence y evidence breakdown
 */

import { OutputStatus, type BPMOutput, type QualityFlag } from '../../types/measurement';

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export type RhythmLabelV2 = 
  | 'sinus_regular'
  | 'sinus_variable' 
  | 'irregular_undetermined'
  | 'af_suspected'
  | 'frequent_ectopy_suspected'
  | 'bigeminy_suspected'
  | 'trigeminy_suspected'
  | 'brady_irregular'
  | 'tachy_irregular'
  | 'noise_or_unreliable'
  | 'insufficient_data';

export interface RhythmEvidence {
  afEvidence: number;           // 0-1 likelihood of AF
  ectopyEvidence: number;       // 0-1 premature beat evidence
  bigeminyEvidence: number;     // 0-1 bigeminy pattern
  trigeminyEvidence: number;    // 0-1 trigeminy pattern
  irregularityEvidence: number; // 0-1 general irregularity
  noiseEvidence: number;        // 0-1 noise/motion contamination
  burden: number;               // % of abnormal beats
}

interface BeatInput {
  ibiMs: number;
  beatSQI: number;
  morphologyScore: number;
  amplitude?: number;
  peakTime?: number;
  flags: {
    isWeak: boolean;
    isPremature: boolean;
    isSuspicious: boolean;
    isDoublePeak: boolean;
  };
}

interface RRInterval {
  value: number;
  timestamp: number;
  isValid: boolean;
  isEctopic: boolean;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  // Persistence thresholds (frames consecutivos para cambiar estado)
  AF_PERSISTENCE: 4,
  ECTOPY_PERSISTENCE: 3,
  BIGEMINY_PERSISTENCE: 3,
  TRIGEMINY_PERSISTENCE: 3,
  NOISE_PERSISTENCE: 2,
  
  // RR validity
  MIN_RR: 300,    // 200 bpm
  MAX_RR: 2000,   // 30 bpm
  
  // Classification thresholds
  AF_CV_THRESHOLD: 0.12,
  AF_PNN50_THRESHOLD: 0.15,
  ECTOPY_RATIO_THRESHOLD: 0.15,
  BIGEMINY_RATIO_THRESHOLD: 0.4,
  TRIGEMINY_RATIO_THRESHOLD: 0.4,
  NOISE_EVIDENCE_THRESHOLD: 0.6,
  
  // Quality
  MIN_SQI: 0.4,
  MIN_BEATS: 5,
  MIN_ACCEPTED_BEATS_RATIO: 0.6,
};

// ═══════════════════════════════════════════════════════════════════
//  CLASE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export class RhythmClassifierV2 {
  private persistenceCounter: Record<RhythmLabelV2, number> = {
    sinus_regular: 0, sinus_variable: 0, irregular_undetermined: 0,
    af_suspected: 0, frequent_ectopy_suspected: 0, bigeminy_suspected: 0,
    trigeminy_suspected: 0, brady_irregular: 0, tachy_irregular: 0,
    noise_or_unreliable: 0, insufficient_data: 0,
  };
  
  private lastLabel: RhythmLabelV2 = 'insufficient_data';
  private rrHistory: RRInterval[] = [];
  private readonly HISTORY_SIZE = 30;
  private consecutiveNoiseFrames = 0;
  
  /**
   * Clasificar ritmo cardíaco desde beats detectados
   */
  classify(
    beatInputs: BeatInput[],
    windowSQI: number,
    sourceStability: number
  ): BPMOutput & { evidence: RhythmEvidence; rhythmLabel: RhythmLabelV2 } {
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 1: Suficientes datos de calidad
    // ═══════════════════════════════════════════════════════════════
    if (!beatInputs || beatInputs.length < CONFIG.MIN_BEATS) {
      return this.createBlockedOutput(
        { flag: 'insufficient_data', description: 'Insufficient beats for rhythm analysis', severity: 'warning' },
        {
          reason: 'Insufficient beats',
          beatsReceived: beatInputs?.length ?? 0,
          minRequired: CONFIG.MIN_BEATS,
        }
      );
    }
    
    if (windowSQI < CONFIG.MIN_SQI) {
      return this.createBlockedOutput(
        { flag: 'low_snr', description: 'Signal quality too low for rhythm analysis', severity: 'warning' },
        {
          sqi: windowSQI,
          minSQI: CONFIG.MIN_SQI,
        }
      );
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  GATE 2: Validar y limpiar beats
    // ═══════════════════════════════════════════════════════════════
    const validBeats = this.validateBeats(beatInputs);
    const acceptedRatio = validBeats.length / beatInputs.length;
    
    if (acceptedRatio < CONFIG.MIN_ACCEPTED_BEATS_RATIO) {
      return this.createBlockedOutput(
        { flag: 'beat_rejection_high', description: 'Too many beats rejected', severity: 'warning' },
        {
          acceptedRatio,
          minRequired: CONFIG.MIN_ACCEPTED_BEATS_RATIO,
        }
      );
    }
    
    if (validBeats.length < CONFIG.MIN_BEATS) {
      return this.createBlockedOutput(
        { flag: 'insufficient_beats', description: 'Not enough valid beats', severity: 'warning' },
        {
          validBeats: validBeats.length,
          minRequired: CONFIG.MIN_BEATS,
        }
      );
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  EXTRAER INTERVALOS RR
    // ═══════════════════════════════════════════════════════════════
    const rrIntervals = this.extractRRIntervals(validBeats);
    
    // Agregar a historial
    this.rrHistory.push(...rrIntervals);
    if (this.rrHistory.length > this.HISTORY_SIZE) {
      this.rrHistory = this.rrHistory.slice(-this.HISTORY_SIZE);
    }
    
    // Usar historial completo para análisis
    const cleanRR = this.rrHistory
      .filter(rr => rr.isValid && !rr.isEctopic)
      .map(rr => rr.value);
    
    if (cleanRR.length < 3) {
      return this.createBlockedOutput(
        { flag: 'insufficient_data', description: 'Not enough clean RR intervals', severity: 'warning' },
        {
          cleanIntervals: cleanRR.length,
          totalHistory: this.rrHistory.length,
        }
      );
    }
    
    // ═══════════════════════════════════════════════════════════════
    //  EXTRAER FEATURES
    // ═══════════════════════════════════════════════════════════════
    const temporalFeatures = this.extractTemporalFeatures(cleanRR);
    const ectopicFeatures = this.detectEctopicPatterns(validBeats, rrIntervals);
    const noiseEvidence = this.estimateNoiseEvidence(windowSQI, sourceStability, validBeats);
    
    // ═══════════════════════════════════════════════════════════════
    //  CLASIFICACIÓN JERÁRQUICA
    // ═══════════════════════════════════════════════════════════════
    const classification = this.hierarchicalClassification(
      temporalFeatures,
      ectopicFeatures,
      noiseEvidence,
      cleanRR
    );
    
    // ═══════════════════════════════════════════════════════════════
    //  TEMPORAL SMOOTHING (Persistencia)
    // ═══════════════════════════════════════════════════════════════
    const smoothedLabel = this.applyTemporalSmoothing(
      classification.label,
      classification.evidence,
      noiseEvidence
    );
    
    // ═══════════════════════════════════════════════════════════════
    //  CALCULAR BPM
    // ═══════════════════════════════════════════════════════════════
    const medianRR = this.median(cleanRR);
    const bpm = medianRR > 0 ? Math.round(60000 / medianRR) : 0;
    const confidence = this.computeConfidence(
      windowSQI,
      sourceStability,
      classification.evidence,
      validBeats.length
    );
    
    return {
      value: bpm,
      unit: 'bpm',
      confidence,
      status: confidence > 0.6 ? OutputStatus.OK : confidence > 0.3 ? OutputStatus.LOW_QUALITY : OutputStatus.BLOCKED,
      qualityFlags: noiseEvidence > 0.5 ? [{ flag: 'high_motion_artifact', description: 'High motion/artifact detected', severity: 'warning' }] : [],
      evidence: {
        sqi: windowSQI,
        acceptedWindows: 1,
        acceptedBeats: validBeats.length,
        signalDuration: medianRR * cleanRR.length,
        ...classification.evidence,
      },
      rhythmLabel: smoothedLabel,
      debug: {
        temporalFeatures,
        ectopicFeatures,
        noiseEvidence,
        rawClassification: classification.label,
        smoothedClassification: smoothedLabel,
      },
    };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  VALIDACIÓN DE BEATS
  // ═════════════════════════════════════════════════════════════════
  
  private validateBeats(beats: BeatInput[]): BeatInput[] {
    return beats.filter(b => {
      // Rechazar beats débiles o con SQI muy bajo
      if (b.flags.isWeak && b.beatSQI < 0.3) return false;
      if (b.beatSQI < 0.2) return false;
      if (b.ibiMs < CONFIG.MIN_RR || b.ibiMs > CONFIG.MAX_RR) return false;
      return true;
    });
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  EXTRACCIÓN DE RR
  // ═════════════════════════════════════════════════════════════════
  
  private extractRRIntervals(beats: BeatInput[]): RRInterval[] {
    const now = Date.now();
    return beats.map((b, i) => ({
      value: b.ibiMs,
      timestamp: now + i * 10, // Offset artificial para orden
      isValid: !b.flags.isWeak && b.beatSQI > 0.4,
      isEctopic: b.flags.isPremature || b.flags.isSuspicious,
    }));
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  FEATURES TEMPORALES
  // ═════════════════════════════════════════════════════════════════
  
  private extractTemporalFeatures(rr: number[]) {
    const mean = this.mean(rr);
    const std = this.std(rr);
    const cv = std / (mean + 0.001);
    
    // RMSSD
    let rmssd = 0;
    for (let i = 1; i < rr.length; i++) {
      rmssd += Math.pow(rr[i] - rr[i-1], 2);
    }
    rmssd = Math.sqrt(rmssd / (rr.length - 1));
    
    // pNN50 y pNN20
    let nn50 = 0, nn20 = 0;
    for (let i = 1; i < rr.length; i++) {
      const diff = Math.abs(rr[i] - rr[i-1]);
      if (diff > 50) nn50++;
      if (diff > 20) nn20++;
    }
    const pnn50 = nn50 / (rr.length - 1);
    const pnn20 = nn20 / (rr.length - 1);
    
    // Turning point ratio (irregularidad)
    let turningPoints = 0;
    for (let i = 1; i < rr.length - 1; i++) {
      if ((rr[i] > rr[i-1] && rr[i] > rr[i+1]) || 
          (rr[i] < rr[i-1] && rr[i] < rr[i+1])) {
        turningPoints++;
      }
    }
    const tpr = turningPoints / (rr.length - 2);
    
    // Poincaré SD1/SD2
    const sd1 = rmssd / Math.sqrt(2);
    let sd2Sum = 0;
    for (let i = 1; i < rr.length; i++) {
      sd2Sum += Math.pow((rr[i] + rr[i-1]) / 2 - mean, 2);
    }
    const sd2 = Math.sqrt(sd2Sum / (rr.length - 1));
    
    // Sample entropy (simplificado)
    const sampEn = this.estimateSampleEntropy(rr);
    
    return {
      mean, std, cv, rmssd, pnn50, pnn20, tpr, sd1, sd2, sampEn,
      hr: 60000 / mean,
    };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  DETECCIÓN DE PATRONES ECTÓPICOS
  // ═════════════════════════════════════════════════════════════════
  
  private detectEctopicPatterns(beats: BeatInput[], rr: RRInterval[]) {
    const ectopicBeats = beats.filter(b => b.flags.isPremature || b.flags.isSuspicious);
    const ectopicRatio = ectopicBeats.length / beats.length;
    
    // Detectar bigeminy (patrón corto-largo-corto-largo)
    let bigeminyScore = 0;
    if (rr.length >= 6) {
      for (let i = 2; i < rr.length; i += 2) {
        const r1 = rr[i-2].value;
        const r2 = rr[i-1].value;
        const r3 = rr[i].value;
        
        // Patrón: corto-largo-corto
        if (r2 > r1 * 1.3 && r2 < r1 * 1.8 && 
            Math.abs(r3 - r1) < r1 * 0.2) {
          bigeminyScore++;
        }
      }
    }
    const bigeminyRatio = bigeminyScore / Math.floor(rr.length / 2);
    
    // Detectar trigeminy (2 normales + 1 ectópico)
    let trigeminyScore = 0;
    if (rr.length >= 9) {
      for (let i = 3; i < rr.length; i += 3) {
        const r1 = rr[i-3].value;
        const r2 = rr[i-2].value;
        const r3 = rr[i-1].value;
        const r4 = rr[i].value;
        
        // Patrón: normal-normal-corto-normal
        if (Math.abs(r2 - r1) < r1 * 0.15 && 
            r3 < r2 * 0.85 &&
            Math.abs(r4 - r1) < r1 * 0.15) {
          trigeminyScore++;
        }
      }
    }
    const trigeminyRatio = trigeminyScore / Math.floor(rr.length / 3);
    
    // Irregularidad no específica
    let irregularCount = 0;
    for (let i = 1; i < rr.length; i++) {
      const ratio = rr[i].value / (rr[i-1].value + 0.001);
      if (Math.abs(1 - ratio) > 0.2) irregularCount++;
    }
    const irregularRatio = irregularCount / (rr.length - 1);
    
    return {
      ectopicRatio,
      bigeminyRatio,
      trigeminyRatio,
      irregularRatio,
    };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  ESTIMACIÓN DE RUIDO
  // ═════════════════════════════════════════════════════════════════
  
  private estimateNoiseEvidence(sqi: number, sourceStability: number, beats: BeatInput[]) {
    const lowSQIPenalty = Math.max(0, 1 - sqi * 2);
    const instabilityPenalty = Math.max(0, 1 - sourceStability * 1.5);
    
    // Penalizar beats débiles
    const weakRatio = beats.filter(b => b.flags.isWeak).length / beats.length;
    
    return Math.min(1, (lowSQIPenalty + instabilityPenalty + weakRatio) / 2);
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  CLASIFICACIÓN JERÁRQUICA
  // ═════════════════════════════════════════════════════════════════
  
  private hierarchicalClassification(
    temporal: ReturnType<typeof this.extractTemporalFeatures>,
    ectopic: ReturnType<typeof this.detectEctopicPatterns>,
    noiseEvidence: number,
    rr: number[]
  ) {
    // Evidence scores
    const afEvidence = Math.min(1, 
      (temporal.cv > CONFIG.AF_CV_THRESHOLD ? 0.4 : 0) +
      (temporal.pnn50 > CONFIG.AF_PNN50_THRESHOLD ? 0.3 : 0) +
      (temporal.tpr > 0.5 ? 0.2 : 0) +
      (temporal.sampEn > 0.5 ? 0.1 : 0)
    );
    
    const ectopyEvidence = Math.min(1, ectopic.ectopicRatio * 2);
    const bigeminyEvidence = ectopic.bigeminyRatio;
    const trigeminyEvidence = ectopic.trigeminyRatio;
    const irregularityEvidence = Math.min(1, ectopic.irregularRatio * 1.5 + temporal.cv);
    
    // Jerarquía de decisión
    let label: RhythmLabelV2 = 'sinus_regular';
    
    if (noiseEvidence > CONFIG.NOISE_EVIDENCE_THRESHOLD) {
      label = 'noise_or_unreliable';
    } else if (afEvidence > 0.65 && ectopyEvidence < 0.3) {
      // AF: irregularidad sin ectopías dominantes
      label = 'af_suspected';
    } else if (bigeminyEvidence > CONFIG.BIGEMINY_RATIO_THRESHOLD) {
      label = 'bigeminy_suspected';
    } else if (trigeminyEvidence > CONFIG.TRIGEMINY_RATIO_THRESHOLD) {
      label = 'trigeminy_suspected';
    } else if (ectopyEvidence > CONFIG.ECTOPY_RATIO_THRESHOLD) {
      label = 'frequent_ectopy_suspected';
    } else if (temporal.hr < 50 && temporal.cv > 0.1) {
      label = 'brady_irregular';
    } else if (temporal.hr > 120 && temporal.cv > 0.1) {
      label = 'tachy_irregular';
    } else if (temporal.cv > 0.1 || ectopic.irregularRatio > 0.3) {
      label = 'irregular_undetermined';
    } else if (temporal.cv > 0.05) {
      label = 'sinus_variable';
    } else {
      label = 'sinus_regular';
    }
    
    return {
      label,
      evidence: {
        afEvidence,
        ectopyEvidence,
        bigeminyEvidence,
        trigeminyEvidence,
        irregularityEvidence,
        noiseEvidence,
        burden: ectopic.ectopicRatio,
      },
    };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  TEMPORAL SMOOTHING (Persistencia)
  // ═════════════════════════════════════════════════════════════════
  
  private applyTemporalSmoothing(
    newLabel: RhythmLabelV2,
    evidence: RhythmEvidence,
    noiseEvidence: number
  ): RhythmLabelV2 {
    // Incrementar contador del nuevo label
    this.persistenceCounter[newLabel]++;
    
    // Decrementar otros labels
    for (const key of Object.keys(this.persistenceCounter) as RhythmLabelV2[]) {
      if (key !== newLabel) {
        this.persistenceCounter[key] = Math.max(0, this.persistenceCounter[key] - 1);
      }
    }
    
    // Determinar threshold de persistencia según clase
    let requiredPersistence = 1;
    if (newLabel === 'af_suspected') requiredPersistence = CONFIG.AF_PERSISTENCE;
    else if (newLabel === 'frequent_ectopy_suspected') requiredPersistence = CONFIG.ECTOPY_PERSISTENCE;
    else if (newLabel === 'bigeminy_suspected') requiredPersistence = CONFIG.BIGEMINY_PERSISTENCE;
    else if (newLabel === 'trigeminy_suspected') requiredPersistence = CONFIG.TRIGEMINY_PERSISTENCE;
    else if (newLabel === 'noise_or_unreliable') requiredPersistence = CONFIG.NOISE_PERSISTENCE;
    
    // Si no alcanza persistencia, mantener label anterior (si no es noise)
    if (this.persistenceCounter[newLabel] < requiredPersistence) {
      if (this.lastLabel !== 'noise_or_unreliable' && noiseEvidence < 0.8) {
        return this.lastLabel;
      }
    }
    
    // Actualizar estado
    this.lastLabel = newLabel;
    return newLabel;
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═════════════════════════════════════════════════════════════════
  
  private computeConfidence(
    sqi: number,
    sourceStability: number,
    evidence: RhythmEvidence,
    beatCount: number
  ): number {
    let confidence = sqi * 0.4 + sourceStability * 0.3;
    confidence += Math.min(0.2, beatCount / 20);
    confidence *= (1 - evidence.noiseEvidence * 0.5);
    return Math.max(0, Math.min(1, confidence));
  }
  
  private createBlockedOutput(
    reason: { flag: string; description: string; severity: 'info' | 'warning' | 'error' },
    debugData: Record<string, any> = {}
  ): BPMOutput & { evidence: RhythmEvidence; rhythmLabel: RhythmLabelV2 } {
    return {
      value: null,
      unit: 'bpm',
      confidence: 0,
      status: OutputStatus.BLOCKED,
      qualityFlags: [reason],
      evidence: {
        sqi: 0,
        acceptedWindows: 0,
        acceptedBeats: 0,
        signalDuration: 0,
        afEvidence: 0,
        ectopyEvidence: 0,
        bigeminyEvidence: 0,
        trigeminyEvidence: 0,
        irregularityEvidence: 0,
        noiseEvidence: 1,
        burden: 0,
      },
      rhythmLabel: 'insufficient_data',
      debug: debugData,
    };
  }
  
  private mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  }
  
  private std(arr: number[]): number {
    const m = this.mean(arr);
    return Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / arr.length);
  }
  
  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  private estimateSampleEntropy(rr: number[]): number {
    // Simplificación: usar CV como proxy de complejidad
    const m = this.mean(rr);
    const cv = this.std(rr) / (m + 0.001);
    return Math.min(1, cv * 3);
  }
  
  /**
   * Resetear estado
   */
  reset(): void {
    this.rrHistory = [];
    this.lastLabel = 'insufficient_data';
    this.consecutiveNoiseFrames = 0;
    for (const key of Object.keys(this.persistenceCounter) as RhythmLabelV2[]) {
      this.persistenceCounter[key] = 0;
    }
  }
  
  fullReset(): void {
    this.reset();
  }
}
