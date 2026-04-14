/**
 * Arrhythmia Classifier para PPG.
 * Basado en literatura 2024 de clasificación de arritmias usando PPG.
 * Implementa:
 * - Clasificación de latidos (normal, weak, premature, irregular)
 * - Detección de fibrilación auricular (AF)
 * - Detección de taquicardia/bradicardia
 * - Análisis de irregularidad RR
 */

export interface BeatClassification {
  type: 'normal' | 'weak' | 'premature' | 'missed' | 'irregular' | 'afib' | 'tachycardia' | 'bradycardia';
  confidence: number;
  rrInterval: number;
  rrDeviation: number;
  morphologyScore: number;
  rhythmScore: number;
}

export interface ArrhythmiaReport {
  afibProbability: number;
  arrhythmiaCount: number;
  irregularityIndex: number;
  dominantRhythm: string;
  classificationHistory: BeatClassification[];
}

export interface ArrhythmiaConfig {
  rrWindow: number;
  afibThreshold: number;
  tachycardiaThreshold: number;
  bradycardiaThreshold: number;
}

export class ArrhythmiaClassifier {
  private readonly config: ArrhythmiaConfig;
  private readonly rrBuffer: Float32Array;
  private rrIndex = 0;
  private readonly bufferSize = 30;
  private classificationHistory: BeatClassification[] = [];
  private readonly maxHistory = 100;

  constructor(config?: Partial<ArrhythmiaConfig>) {
    this.config = {
      rrWindow: 10,
      afibThreshold: 0.18,
      tachycardiaThreshold: 100,
      bradycardiaThreshold: 60,
      ...config,
    };
    this.rrBuffer = new Float32Array(this.bufferSize);
  }

  /**
   * Clasifica un latido basado en características
   */
  classifyBeat(
    rrInterval: number,
    morphologyScore: number,
    rhythmScore: number,
    expectedRR: number
  ): BeatClassification {
    // Almacenar RR en buffer
    this.rrBuffer[this.rrIndex] = rrInterval;
    this.rrIndex = (this.rrIndex + 1) % this.bufferSize;

    // Calcular desviación de RR
    const rrDeviation = this.computeRRDeviation(rrInterval, expectedRR);

    // Clasificación básica
    let type: BeatClassification['type'] = 'normal';
    let confidence = 0.8;

    // Taquicardia/Bradycardia
    const bpm = 60000 / rrInterval;
    if (bpm > this.config.tachycardiaThreshold) {
      type = 'tachycardia';
      confidence = 0.9;
    } else if (bpm < this.config.bradycardiaThreshold) {
      type = 'bradycardia';
      confidence = 0.9;
    }
    // Latido prematuro (threshold más estricto: 0.6 en lugar de 0.7)
    else if (expectedRR > 0 && rrInterval < expectedRR * 0.6) {
      type = 'premature';
      confidence = 0.85;
    }
    // Latido débil
    else if (morphologyScore < 40) {
      type = 'weak';
      confidence = 0.75;
    }
    // Latido perdido (RR muy largo)
    else if (expectedRR > 0 && rrInterval > expectedRR * 1.7) {
      type = 'missed';
      confidence = 0.8;
    }
    // Irregular (threshold más estricto: 0.4 en lugar de 0.3)
    else if (rrDeviation > 0.4) {
      type = 'irregular';
      confidence = 0.7;
    }

    // Almacenar en historial
    const classification: BeatClassification = {
      type,
      confidence,
      rrInterval,
      rrDeviation,
      morphologyScore,
      rhythmScore,
    };

    this.classificationHistory.push(classification);
    if (this.classificationHistory.length > this.maxHistory) {
      this.classificationHistory.shift();
    }

    return classification;
  }

  /**
   * Genera reporte de arritmias
   */
  generateReport(): ArrhythmiaReport {
    const afibProbability = this.estimateAFibProbability();
    const irregularityIndex = this.computeIrregularityIndex();
    const dominantRhythm = this.determineDominantRhythm();
    const arrhythmiaCount = this.countArrhythmias();

    return {
      afibProbability,
      arrhythmiaCount,
      irregularityIndex,
      dominantRhythm,
      classificationHistory: this.classificationHistory.slice(-20),
    };
  }

  /**
   * Estima probabilidad de fibrilación auricular
   */
  private estimateAFibProbability(): number {
    if (this.rrIndex < 15) return 0;

    const n = Math.min(this.rrIndex, this.bufferSize);
    const rrValues: number[] = [];

    for (let i = 0; i < n; i++) {
      rrValues.push(this.rrBuffer[i]!);
    }

    // Calcular variabilidad RR
    const mean = rrValues.reduce((a, b) => a + b, 0) / n;
    const variance = rrValues.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / (mean + 1e-6);

    // AFib: alta variabilidad sin patrón regular (threshold más estricto)
    if (cv > this.config.afibThreshold) {
      // Verificar ausencia de patrón regular
      const regularityScore = this.checkRegularity(rrValues);
      
      // Solo considerar AFib si CV > 0.18 y regularityScore < 0.5
      if (cv > 0.18 && regularityScore < 0.5) {
        return Math.min(1, cv * 2.5 * (1 - regularityScore));
      }
    }

    return 0;
  }

  /**
   * Verifica regularidad de intervalos RR
   */
  private checkRegularity(rrValues: number[]): number {
    if (rrValues.length < 5) return 0;

    let regularCount = 0;
    const mean = rrValues.reduce((a, b) => a + b, 0) / rrValues.length;

    // Threshold más estricto: 10% en lugar de 15%
    for (let i = 1; i < rrValues.length; i++) {
      const deviation = Math.abs(rrValues[i]! - mean) / (mean + 1e-6);
      if (deviation < 0.10) regularCount++;
    }

    return regularCount / (rrValues.length - 1);
  }

  /**
   * Calcula índice de irregularidad
   */
  private computeIrregularityIndex(): number {
    if (this.rrIndex < 5) return 0;

    const n = Math.min(this.rrIndex, this.bufferSize);
    const rrValues: number[] = [];

    for (let i = 0; i < n; i++) {
      rrValues.push(this.rrBuffer[i]!);
    }

    // RMSSD (Root Mean Square of Successive Differences)
    let sumSquaredDiff = 0;
    for (let i = 1; i < n; i++) {
      const diff = rrValues[i]! - rrValues[i - 1]!;
      sumSquaredDiff += diff * diff;
    }
    const rmssd = Math.sqrt(sumSquaredDiff / (n - 1));

    // Normalizar por RR medio
    const mean = rrValues.reduce((a, b) => a + b, 0) / n;
    const irregularityIndex = rmssd / (mean + 1e-6);

    return irregularityIndex;
  }

  /**
   * Determina ritmo dominante
   */
  private determineDominantRhythm(): string {
    if (this.classificationHistory.length < 5) return 'unknown';

    const recent = this.classificationHistory.slice(-20);
    const typeCounts = new Map<string, number>();

    for (const c of recent) {
      const count = typeCounts.get(c.type) ?? 0;
      typeCounts.set(c.type, count + 1);
    }

    let maxCount = 0;
    let dominant = 'normal';

    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = type;
      }
    }

    return dominant;
  }

  /**
   * Cuenta arritmias en historial
   */
  private countArrhythmias(): number {
    return this.classificationHistory.filter(
      c => c.type !== 'normal' && c.type !== 'weak'
    ).length;
  }

  /**
   * Calcula desviación de RR
   */
  private computeRRDeviation(rr: number, expected: number): number {
    if (expected <= 0) return 0;
    return Math.abs(rr - expected) / expected;
  }

  reset(): void {
    this.rrBuffer.fill(0);
    this.rrIndex = 0;
    this.classificationHistory = [];
  }
}
