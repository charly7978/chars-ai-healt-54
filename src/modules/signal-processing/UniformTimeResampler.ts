/**
 * UNIFORM TIME RESAMPLER - Resampleo temporal uniforme obligatorio
 * 
 * Convierte timestamps no uniformes de frames en serie temporal uniforme:
 * - Entrada: pares (timestamp, value) con timestamps reales del frame
 * - Salida: serie a frecuencia fija objetivo (ej: 30 Hz)
 * - Interpolación lineal robusta y barata
 * - Manejo de gaps y jitter
 * - Flag de confianza temporal
 * 
 * El filtro pasa banda debe operar sobre muestra temporalmente uniforme.
 */

export interface TimeSample {
  timestamp: number;
  value: number;
}

export interface ResamplerConfig {
  targetFrequency: number;  // Hz
  maxGapTime: number;       // ms máximo para interpolar
  maxJitterTime: number;    // ms máximo de jitter aceptable
  minSamples: number;       // muestras mínimas para resamplear
  eps: number;
}

export interface ResamplerResult {
  signal: Float64Array;
  timestamps: Float64Array;
  avgInterval: number;
  inputSampleRate: number;
  outputSampleRate: number;
  confidence: number;
  avgJitter?: number;
  maxGap?: number;
  gapsFilled?: number;
  samplesInterpolated?: number;
}

interface TimeStatistics {
  startTime: number;
  endTime: number;
  avgInterval: number;
  inputSampleRate: number;
  avgJitter: number;
  maxGap: number;
  gaps: Array<{start: number, end: number, duration: number}>;
}

export class UniformTimeResampler {
  private config: ResamplerConfig;
  private inputBuffer: TimeSample[] = [];
  private lastOutputTime: number = 0;
  
  constructor(config: Partial<ResamplerConfig> = {}) {
    this.config = {
      targetFrequency: 30,  // Hz
      maxGapTime: 200,      // 200ms max gap
      maxJitterTime: 50,    // 50ms max jitter
      minSamples: 5,
      eps: 1e-6,
      ...config
    };
  }

  /**
   * Agregar muestra con timestamp real
   */
  public addSample(timestamp: number, value: number): void {
    this.inputBuffer.push({ timestamp, value });
    
    // Mantener buffer ordenado por timestamp
    this.inputBuffer.sort((a, b) => a.timestamp - b.timestamp);
    
    // Limitar tamaño del buffer (mantener últimos ~10 segundos)
    const maxBufferLength = this.config.targetFrequency * 10;
    if (this.inputBuffer.length > maxBufferLength) {
      this.inputBuffer = this.inputBuffer.slice(-maxBufferLength);
    }
  }

  /**
   * Resamplear a frecuencia uniforme
   */
  public resample(): ResamplerResult | null {
    if (this.inputBuffer.length < this.config.minSamples) {
      return null;
    }

    // Calcular estadísticas de tiempo
    const timeStats = this.calculateTimeStatistics();
    if (!timeStats) {
      return null;
    }

    // Generar timestamps de salida uniformes
    const outputTimestamps = this.generateUniformTimestamps(timeStats);
    
    // Interpolar valores
    const result = this.interpolateValues(outputTimestamps, timeStats);
    
    // Actualizar estado
    this.lastOutputTime = outputTimestamps[outputTimestamps.length - 1];
    
    return result;
  }

  /**
   * Calcular estadísticas de tiempo del input
   */
  private calculateTimeStatistics(): TimeStatistics | null {
    if (this.inputBuffer.length < 2) {
      return null;
    }

    const intervals: number[] = [];
    const gaps: Array<{start: number, end: number, duration: number}> = [];
    
    let totalInterval = 0;
    let maxGap = 0;
    const expectedInterval = 1000 / this.config.targetFrequency;
    
    for (let i = 1; i < this.inputBuffer.length; i++) {
      const interval = this.inputBuffer[i].timestamp - this.inputBuffer[i-1].timestamp;
      intervals.push(interval);
      totalInterval += interval;
      
      // Detectar gaps (intervalos mucho más grandes que lo esperado)
      if (interval > expectedInterval * 2) {
        gaps.push({
          start: this.inputBuffer[i-1].timestamp,
          end: this.inputBuffer[i].timestamp,
          duration: interval
        });
        maxGap = Math.max(maxGap, interval);
      }
    }

    const avgInterval = totalInterval / intervals.length;
    const inputSampleRate = 1000 / avgInterval;
    
    // Calcular jitter como desviación estándar de intervalos
    let variance = 0;
    for (const interval of intervals) {
      variance += (interval - avgInterval) ** 2;
    }
    variance /= intervals.length;
    const avgJitter = Math.sqrt(variance);

    return {
      startTime: this.inputBuffer[0].timestamp,
      endTime: this.inputBuffer[this.inputBuffer.length - 1].timestamp,
      avgInterval,
      inputSampleRate,
      avgJitter,
      maxGap,
      gaps
    };
  }

  /**
   * Generar timestamps uniformes para salida
   */
  private generateUniformTimestamps(timeStats: TimeStatistics): Float64Array {
    const duration = timeStats.endTime - timeStats.startTime;
    const numSamples = Math.floor(duration * this.config.targetFrequency / 1000);
    const outputInterval = 1000 / this.config.targetFrequency;
    
    const timestamps = new Float64Array(Math.max(1, numSamples));
    
    // Generar timestamps uniformes empezando en múltiplo del intervalo
    const firstSampleTime = Math.ceil(timeStats.startTime / outputInterval) * outputInterval;
    
    for (let i = 0; i < timestamps.length; i++) {
      timestamps[i] = firstSampleTime + i * outputInterval;
    }
    
    return timestamps;
  }

  /**
   * Interpolar valores en timestamps uniformes
   */
  private interpolateValues(outputTimestamps: Float64Array, timeStats: TimeStatistics): ResamplerResult {
    const outputSamples = new Float64Array(outputTimestamps.length);
    const inputSamples = this.inputBuffer;
    
    let interpolatedCount = 0;
    let gapsFilled = 0;
    let totalConfidence = 0;
    
    for (let i = 0; i < outputTimestamps.length; i++) {
      const targetTime = outputTimestamps[i];
      const interpolation = this.interpolateAtTime(targetTime, inputSamples, timeStats);
      
      outputSamples[i] = interpolation.value;
      totalConfidence += interpolation.confidence;
      
      if (interpolation.interpolated) {
        interpolatedCount++;
      }
      
      if (interpolation.gapFilled) {
        gapsFilled++;
      }
    }

    const avgConfidence = outputTimestamps.length > 0 ? totalConfidence / outputTimestamps.length : 0;

    return {
      signal: outputSamples,
      timestamps: outputTimestamps,
      avgInterval: timeStats.avgInterval,
      inputSampleRate: timeStats.inputSampleRate,
      outputSampleRate: this.config.targetFrequency,
      confidence: avgConfidence,
      avgJitter: timeStats.avgJitter,
      maxGap: timeStats.maxGap,
      gapsFilled,
      samplesInterpolated: interpolatedCount
    };
  }

  /**
   * Interpolar valor en timestamp específico
   */
  private interpolateAtTime(
    targetTime: number, 
    inputSamples: TimeSample[], 
    timeStats: TimeStatistics
  ): {
    value: number;
    confidence: number;
    interpolated: boolean;
    gapFilled: boolean;
  } {
    // Encontrar muestras adyacentes
    let leftIdx = -1;
    let rightIdx = -1;
    
    for (let i = 0; i < inputSamples.length - 1; i++) {
      if (inputSamples[i].timestamp <= targetTime && inputSamples[i + 1].timestamp >= targetTime) {
        leftIdx = i;
        rightIdx = i + 1;
        break;
      }
    }

    // Caso especial: timestamp antes de la primera muestra
    if (targetTime < inputSamples[0].timestamp) {
      return {
        value: inputSamples[0].value,
        confidence: 0.3,
        interpolated: true,
        gapFilled: false
      };
    }

    // Caso especial: timestamp después de la última muestra
    if (targetTime > inputSamples[inputSamples.length - 1].timestamp) {
      return {
        value: inputSamples[inputSamples.length - 1].value,
        confidence: 0.3,
        interpolated: true,
        gapFilled: false
      };
    }

    // Si no se encontraron muestras adyacentes (no debería pasar)
    if (leftIdx === -1 || rightIdx === -1) {
      return {
        value: 0,
        confidence: 0,
        interpolated: true,
        gapFilled: true
      };
    }

    const leftSample = inputSamples[leftIdx];
    const rightSample = inputSamples[rightIdx];
    
    // Verificar si hay un gap grande
    const gapDuration = rightSample.timestamp - leftSample.timestamp;
    const isGap = gapDuration > this.config.maxGapTime;
    
    // Interpolación lineal
    const t = (targetTime - leftSample.timestamp) / gapDuration;
    const interpolatedValue = leftSample.value + t * (rightSample.value - leftSample.value);
    
    // Calcular confianza basada en jitter y gap
    let confidence = 1.0;
    
    // Penalizar por jitter
    if (timeStats.avgJitter > this.config.maxJitterTime) {
      confidence *= 0.8;
    }
    
    // Penalizar fuerte por gaps
    if (isGap) {
      confidence *= 0.3;
    }
    
    // Penalizar por extrapolación
    if (t < 0.1 || t > 0.9) {
      confidence *= 0.9;
    }

    return {
      value: interpolatedValue,
      confidence: Math.max(0, Math.min(1, confidence)),
      interpolated: Math.abs(targetTime - leftSample.timestamp) > this.config.eps && 
                 Math.abs(targetTime - rightSample.timestamp) > this.config.eps,
      gapFilled: isGap
    };
  }

  /**
   * Obtener estadísticas actuales del buffer
   */
  public getBufferStatistics(): {
    sampleCount: number;
    timeSpan: number;
    avgSampleRate: number;
    jitter: number;
    gapCount: number;
  } {
    if (this.inputBuffer.length < 2) {
      return {
        sampleCount: this.inputBuffer.length,
        timeSpan: 0,
        avgSampleRate: 0,
        jitter: 0,
        gapCount: 0
      };
    }

    const timeStats = this.calculateTimeStatistics();
    if (!timeStats) {
      return {
        sampleCount: this.inputBuffer.length,
        timeSpan: 0,
        avgSampleRate: 0,
        jitter: 0,
        gapCount: 0
      };
    }

    return {
      sampleCount: this.inputBuffer.length,
      timeSpan: timeStats.endTime - timeStats.startTime,
      avgSampleRate: timeStats.inputSampleRate,
      jitter: timeStats.avgJitter,
      gapCount: timeStats.gaps.length
    };
  }

  /**
   * Limpiar buffer antiguo
   */
  public cleanup(maxAge: number = 10000): void {
    const cutoffTime = performance.now() - maxAge;
    this.inputBuffer = this.inputBuffer.filter(sample => sample.timestamp > cutoffTime);
  }

  /**
   * Resetear resampler
   */
  public reset(): void {
    this.inputBuffer = [];
    this.lastOutputTime = 0;
  }

  /**
   * Configurar frecuencia objetivo
   */
  public setTargetFrequency(frequency: number): void {
    this.config.targetFrequency = Math.max(1, Math.min(120, frequency));
  }

  /**
   * Obtener configuración actual
   */
  public getConfig(): ResamplerConfig {
    return { ...this.config };
  }

  /**
   * Verificar si hay suficientes muestras para resamplear
   */
  public hasEnoughSamples(): boolean {
    return this.inputBuffer.length >= this.config.minSamples;
  }

  /**
   * Obtener tiempo de la última salida
   */
  public getLastOutputTime(): number {
    return this.lastOutputTime;
  }

  /**
   * Forzar resampleo con timestamps específicos (para testing)
   */
  public forceResample(outputTimestamps: Float64Array): ResamplerResult | null {
    if (this.inputBuffer.length < 2) {
      return null;
    }

    const timeStats = this.calculateTimeStatistics();
    if (!timeStats) {
      return null;
    }

    const result = this.interpolateValues(outputTimestamps, timeStats);
    this.lastOutputTime = outputTimestamps[outputTimestamps.length - 1];
    
    return result;
  }
}
