/**
 * BPM CONSENSUS ENGINE
 * 
 * Combina múltiples métodos de estimación de BPM para obtener un consenso robusto.
 * Métodos combinados:
 * 1. Peak detection (intervalos RR)
 * 2. Autocorrelation
 * 3. Espectral (FFT)
 * 4. RR intervals (mediana)
 * 5. Morfología (consistencia de forma de onda)
 * 
 * FAIL-CLOSED: Si no hay consenso entre métodos, BPM = 0.
 */

export interface BPMEstimate {
  bpm: number;
  confidence: number;
  method: string;
  valid: boolean;
}

export interface BPMConsensusResult {
  bpm: number;
  confidence: number;
  consensus: number; // 0-1, qué tan de acuerdo están los métodos
  methodBreakdown: {
    peak: BPMEstimate;
    autocorr: BPMEstimate;
    spectral: BPMEstimate;
    rr: BPMEstimate;
    morphology: BPMEstimate;
  };
  rejectionReasons: string[];
}

export class BPMConsensusEngine {
  private readonly MAX_BPM_VARIANCE = 5; // BPM de variación máxima aceptable
  private readonly MIN_CONSENSUS = 0.6; // Mínimo consenso requerido
  private readonly MIN_VALID_METHODS = 3; // Mínimo de métodos válidos requeridos

  /**
   * Calcular consenso BPM a partir de múltiples estimaciones
   */
  calculateConsensus(
    peakBpm: number,
    peakConfidence: number,
    autocorrBpm: number,
    autocorrConfidence: number,
    spectralBpm: number,
    spectralConfidence: number,
    rrIntervals: number[],
    morphologyScore: number
  ): BPMConsensusResult {
    // Validar entradas
    const peakValid = this.isValidBPM(peakBpm) && peakConfidence >= 0.5;
    const autocorrValid = this.isValidBPM(autocorrBpm) && autocorrConfidence >= 0.5;
    const spectralValid = this.isValidBPM(spectralBpm) && spectralConfidence >= 0.5;
    const rrValid = rrIntervals.length >= 4;
    const morphologyValid = morphologyScore >= 0.6;

    // Calcular estimación RR
    const rrEstimate = this.calculateRRBPM(rrIntervals);

    const methodBreakdown = {
      peak: {
        bpm: peakValid ? peakBpm : 0,
        confidence: peakValid ? peakConfidence : 0,
        method: 'peak',
        valid: peakValid
      },
      autocorr: {
        bpm: autocorrValid ? autocorrBpm : 0,
        confidence: autocorrValid ? autocorrConfidence : 0,
        method: 'autocorr',
        valid: autocorrValid
      },
      spectral: {
        bpm: spectralValid ? spectralBpm : 0,
        confidence: spectralValid ? spectralConfidence : 0,
        method: 'spectral',
        valid: spectralValid
      },
      rr: {
        bpm: rrValid ? rrEstimate.bpm : 0,
        confidence: rrValid ? rrEstimate.confidence : 0,
        method: 'rr',
        valid: rrValid
      },
      morphology: {
        bpm: morphologyValid ? 0 : 0, // Morfología no da BPM directo, solo valida
        confidence: morphologyValid ? morphologyScore : 0,
        method: 'morphology',
        valid: morphologyValid
      }
    };

    // Contar métodos válidos
    const validMethods = Object.values(methodBreakdown).filter(m => m.valid).length;

    // FAIL-CLOSED: No suficientes métodos válidos
    if (validMethods < this.MIN_VALID_METHODS) {
      return {
        bpm: 0,
        confidence: 0,
        consensus: 0,
        methodBreakdown,
        rejectionReasons: [
          `INSUFFICIENT_VALID_METHODS: ${validMethods}/${this.MIN_VALID_METHODS} required`
        ]
      };
    }

    // FAIL-CLOSED: Morfología inválida
    if (!morphologyValid) {
      return {
        bpm: 0,
        confidence: 0,
        consensus: 0,
        methodBreakdown,
        rejectionReasons: [
          'MORPHOLOGY_INVALID: Waveform morphology does not match cardiac pattern'
        ]
      };
    }

    // Obtener BPM válidos
    const validBPMs = [
      methodBreakdown.peak.bpm,
      methodBreakdown.autocorr.bpm,
      methodBreakdown.spectral.bpm,
      methodBreakdown.rr.bpm
    ].filter(bpm => bpm > 0);

    // Calcular consenso
    const consensus = this.calculateConsensusScore(validBPMs);

    // FAIL-CLOSED: Consenso insuficiente
    if (consensus < this.MIN_CONSENSUS) {
      return {
        bpm: 0,
        confidence: 0,
        consensus,
        methodBreakdown,
        rejectionReasons: [
          `LOW_CONSENSUS: ${consensus.toFixed(2)} < ${this.MIN_CONSENSUS}`
        ]
      };
    }

    // Calcular BPM promedio ponderado
    const weightedBPM = this.calculateWeightedBPM(
      methodBreakdown.peak,
      methodBreakdown.autocorr,
      methodBreakdown.spectral,
      methodBreakdown.rr
    );

    // Calcular confianza global
    const globalConfidence = this.calculateGlobalConfidence(
      methodBreakdown,
      consensus
    );

    return {
      bpm: weightedBPM,
      confidence: globalConfidence,
      consensus,
      methodBreakdown,
      rejectionReasons: []
    };
  }

  /**
   * Validar BPM en rango fisiológico
   */
  private isValidBPM(bpm: number): boolean {
    return bpm >= 40 && bpm <= 200 && isFinite(bpm);
  }

  /**
   * Calcular BPM a partir de intervalos RR
   */
  private calculateRRBPM(rrIntervals: number[]): { bpm: number; confidence: number } {
    if (rrIntervals.length < 4) {
      return { bpm: 0, confidence: 0 };
    }

    // Calcular mediana de intervalos RR
    const sorted = [...rrIntervals].sort((a, b) => a - b);
    const medianRR = sorted[Math.floor(sorted.length / 2)];

    // Convertir a BPM
    const bpm = 60000 / medianRR;

    // Validar BPM
    if (!this.isValidBPM(bpm)) {
      return { bpm: 0, confidence: 0 };
    }

    // Calcular confianza basada en variabilidad
    const stdDev = this.calculateStandardDeviation(rrIntervals);
    const cv = stdDev / medianRR; // Coeficiente de variación
    const confidence = Math.max(0, 1 - cv); // Menor variabilidad = mayor confianza

    return { bpm, confidence };
  }

  /**
   * Calcular score de consenso entre estimaciones
   */
  private calculateConsensusScore(bpms: number[]): number {
    if (bpms.length < 2) return 0;

    const mean = bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length;
    const variance = bpms.reduce((sum, bpm) => sum + Math.pow(bpm - mean, 2), 0) / bpms.length;
    const stdDev = Math.sqrt(variance);

    // Consenso = 1 - (desviación estándar / media)
    // Normalizado para que 1 = perfecto acuerdo, 0 = desacuerdo total
    const normalizedVariance = stdDev / mean;
    const consensus = Math.max(0, 1 - normalizedVariance);

    return consensus;
  }

  /**
   * Calcular BPM promedio ponderado por confianza
   */
  private calculateWeightedBPM(
    peak: BPMEstimate,
    autocorr: BPMEstimate,
    spectral: BPMEstimate,
    rr: BPMEstimate
  ): number {
    const estimates = [peak, autocorr, spectral, rr].filter(e => e.valid && e.bpm > 0);

    if (estimates.length === 0) return 0;

    const totalWeight = estimates.reduce((sum, e) => sum + e.confidence, 0);
    const weightedSum = estimates.reduce((sum, e) => sum + e.bpm * e.confidence, 0);

    return weightedSum / totalWeight;
  }

  /**
   * Calcular confianza global
   */
  private calculateGlobalConfidence(
    breakdown: BPMConsensusResult['methodBreakdown'],
    consensus: number
  ): number {
    const validMethods = Object.values(breakdown).filter(m => m.valid);
    const avgMethodConfidence = validMethods.reduce((sum, m) => sum + m.confidence, 0) / validMethods.length;

    // Confianza global = promedio de confianzas de métodos * consenso
    return avgMethodConfidence * consensus;
  }

  /**
   * Calcular desviación estándar
   */
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;

    return Math.sqrt(variance);
  }
}

export default BPMConsensusEngine;
