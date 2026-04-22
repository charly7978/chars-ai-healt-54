/**
 * UNIFORM TIME RESAMPLER
 * 
 * Convierte series temporales irregulares a series uniformes a frecuencia objetivo.
 * Maneja jitter, gaps y discontinuidades.
 */

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface ResamplerResult {
  timestamps: number[];
  values: number[];
  confidence: number;
  gapFlags: boolean[];
  discontinuityFlags: boolean[];
}

export class UniformTimeResampler {
  private targetFrequency: number;
  private targetIntervalMs: number;
  private maxGapMs: number;
  private buffer: TimeSeriesPoint[] = [];
  private lastOutputTimestamp = 0;

  constructor(targetFrequency: number = 30, maxGapMs: number = 200) {
    this.targetFrequency = targetFrequency;
    this.targetIntervalMs = 1000 / targetFrequency;
    this.maxGapMs = maxGapMs;
  }

  /**
   * Agrega un punto a la serie temporal
   */
  addPoint(timestamp: number, value: number): void {
    if (!isFinite(timestamp) || !isFinite(value)) return;
    this.buffer.push({ timestamp, value });
    
    // Mantener buffer razonable (últimos 5 segundos a 30fps)
    const maxPoints = Math.ceil(this.targetFrequency * 5);
    if (this.buffer.length > maxPoints) {
      this.buffer.shift();
    }
  }

  /**
   * Resamplea a frecuencia uniforme desde el último timestamp de salida
   */
  resample(numPoints: number = 60): ResamplerResult {
    if (this.buffer.length < 2) {
      return {
        timestamps: [],
        values: [],
        confidence: 0,
        gapFlags: [],
        discontinuityFlags: []
      };
    }

    const result: ResamplerResult = {
      timestamps: [],
      values: [],
      confidence: 0,
      gapFlags: [],
      discontinuityFlags: []
    };

    // Determinar timestamp de inicio
    const startTimestamp = this.lastOutputTimestamp > 0 
      ? this.lastOutputTimestamp + this.targetIntervalMs
      : this.buffer[0].timestamp;

    let currentTimestamp = startTimestamp;
    let totalConfidence = 0;
    let validPoints = 0;

    for (let i = 0; i < numPoints; i++) {
      const interpolated = this.interpolateAt(currentTimestamp);
      
      if (interpolated !== null) {
        result.timestamps.push(currentTimestamp);
        result.values.push(interpolated.value);
        result.gapFlags.push(interpolated.isGap);
        result.discontinuityFlags.push(interpolated.isDiscontinuity);
        
        totalConfidence += interpolated.confidence;
        validPoints++;
      }

      currentTimestamp += this.targetIntervalMs;
    }

    this.lastOutputTimestamp = currentTimestamp - this.targetIntervalMs;
    result.confidence = validPoints > 0 ? totalConfidence / validPoints : 0;

    return result;
  }

  /**
   * Interpolación lineal en timestamp específico
   */
  private interpolateAt(timestamp: number): {
    value: number;
    confidence: number;
    isGap: boolean;
    isDiscontinuity: boolean;
  } | null {
    // Encontrar puntos adyacentes
    let before: TimeSeriesPoint | null = null;
    let after: TimeSeriesPoint | null = null;

    for (let i = 0; i < this.buffer.length; i++) {
      const p = this.buffer[i];
      if (p.timestamp <= timestamp) {
        before = p;
      } else {
        after = p;
        break;
      }
    }

    if (!before && !after) return null;
    if (!after) return null; // Timestamp futuro
    if (!before) {
      // Timestamp pasado al inicio del buffer
      return {
        value: after.value,
        confidence: 0.3,
        isGap: true,
        isDiscontinuity: true
      };
    }

    const gap = after.timestamp - before.timestamp;
    const isGap = gap > this.maxGapMs;
    const isDiscontinuity = gap > this.targetIntervalMs * 2;

    // Interpolación lineal
    const t = (timestamp - before.timestamp) / gap;
    const value = before.value + t * (after.value - before.value);
    
    // Confianza basada en tamaño del gap
    const confidence = isGap ? 0.2 : Math.max(0.5, 1 - (gap / this.maxGapMs) * 0.5);

    return { value, confidence, isGap, isDiscontinuity };
  }

  /**
   * Limpia el buffer
   */
  clear(): void {
    this.buffer = [];
    this.lastOutputTimestamp = 0;
  }

  /**
   * Cambia la frecuencia objetivo
   */
  setTargetFrequency(freq: number): void {
    this.targetFrequency = freq;
    this.targetIntervalMs = 1000 / freq;
  }

  /**
   * Obtiene estadísticas del buffer
   */
  getBufferStats() {
    if (this.buffer.length < 2) {
      return { count: 0, avgInterval: 0, maxGap: 0, jitter: 0 };
    }

    const intervals: number[] = [];
    for (let i = 1; i < this.buffer.length; i++) {
      intervals.push(this.buffer[i].timestamp - this.buffer[i - 1].timestamp);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const maxGap = Math.max(...intervals);
    const variance = intervals.reduce((sum, d) => sum + (d - avgInterval) ** 2, 0) / intervals.length;
    const jitter = Math.sqrt(variance);

    return {
      count: this.buffer.length,
      avgInterval,
      maxGap,
      jitter
    };
  }
}
