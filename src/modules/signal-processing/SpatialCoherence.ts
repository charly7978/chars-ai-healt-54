/**
 * SPATIAL COHERENCE - Coherencia entre tiles válidos
 * 
 * Calcula coherencia espacial entre tiles para mejorar selección de señal:
 * - Correlación con señal de referencia
 * - Coherencia con frecuencia dominante
 * - Penalización por tiles fuera de fase o ruidosos
 * - Análisis de consistencia espacial temporal
 * - Detección de tiles anómalos
 * 
 * Fundamental para ensemble robusto y detección de artefactos espaciales.
 */

export interface TileCoherenceMetrics {
  tileId: string;
  x: number;
  y: number;
  
  // Coherencia con referencia
  correlation: number;
  phaseCoherence: number;
  amplitudeCoherence: number;
  
  // Coherencia espectral
  frequencyCoherence: number;
  harmonicConsistency: number;
  
  // Métricas espaciales
  spatialConsistency: number;
  neighborAgreement: number;
  
  // Penalizaciones
  phasePenalty: number;
  noisePenalty: number;
  outlierPenalty: number;
  
  // Score final
  coherenceScore: number;
  
  // Metadatos
  weight: number;
  lastUpdate: number;
}

export interface SpatialCoherenceResult {
  globalCoherence: number;
  coherentTiles: string[];
  incoherentTiles: string[];
  referenceSignal: Float64Array;
  dominantFrequency: number;
  averagePhase: number;
  phaseSpread: number;
  spatialQuality: number;
}

export interface SpatialCoherenceConfig {
  minCorrelation: number;
  minPhaseCoherence: number;
  maxPhaseSpread: number;
  neighborRadius: number;
  frequencyTolerance: number;
  eps: number;
}

export class SpatialCoherence {
  private config: SpatialCoherenceConfig;
  private tileMetrics: Map<string, TileCoherenceMetrics> = new Map();
  private referenceSignal: Float64Array | null = null;
  private dominantFrequency: number = 0;
  
  constructor(config: Partial<SpatialCoherenceConfig> = {}) {
    this.config = {
      minCorrelation: 0.3,
      minPhaseCoherence: 0.5,
      maxPhaseSpread: Math.PI / 2,  // 90 degrees
      neighborRadius: 1,
      frequencyTolerance: 0.3,     // Hz
      eps: 1e-8,
      ...config
    };
  }

  /**
   * Calcular coherencia espacial para conjunto de tiles
   */
  public calculateCoherence(
    tiles: Array<{
      id: string;
      x: number;
      y: number;
      signal: Float64Array;
      weight: number;
    }>,
    dominantFrequency: number = 1.2
  ): SpatialCoherenceResult {
    if (tiles.length === 0) {
      return this.createEmptyResult();
    }

    this.dominantFrequency = dominantFrequency;
    
    // Generar señal de referencia (promedio ponderado)
    this.referenceSignal = this.generateReferenceSignal(tiles);
    if (!this.referenceSignal) {
      return this.createEmptyResult();
    }

    // Calcular métricas de coherencia por tile
    const tileMetrics: TileCoherenceMetrics[] = [];
    
    for (const tile of tiles) {
      const metrics = this.calculateTileCoherence(tile, this.referenceSignal);
      this.tileMetrics.set(tile.id, metrics);
      tileMetrics.push(metrics);
    }

    // Calcular coherencia global
    const globalCoherence = this.calculateGlobalCoherence(tileMetrics);
    
    // Clasificar tiles
    const coherentTiles = tileMetrics
      .filter(t => t.coherenceScore >= this.config.minCorrelation)
      .map(t => t.tileId);
    
    const incoherentTiles = tileMetrics
      .filter(t => t.coherenceScore < this.config.minCorrelation)
      .map(t => t.tileId);

    // Calcular métricas espaciales adicionales
    const averagePhase = this.calculateAveragePhase(tileMetrics);
    const phaseSpread = this.calculatePhaseSpread(tileMetrics);
    const spatialQuality = this.calculateSpatialQuality(tileMetrics);

    return {
      globalCoherence,
      coherentTiles,
      incoherentTiles,
      referenceSignal: this.referenceSignal,
      dominantFrequency,
      averagePhase,
      phaseSpread,
      spatialQuality
    };
  }

  /**
   * Generar señal de referencia robusta
   */
  private generateReferenceSignal(
    tiles: Array<{id: string; x: number; y: number; signal: Float64Array; weight: number}>
  ): Float64Array | null {
    if (tiles.length === 0) return null;

    // Encontrar longitud mínima común
    const minLength = Math.min(...tiles.map(t => t.signal.length));
    if (minLength < 10) return null;

    // Generar referencia ponderada por calidad inicial
    const reference = new Float64Array(minLength);
    let totalWeight = 0;

    for (const tile of tiles) {
      const weight = tile.weight;
      totalWeight += weight;

      for (let i = 0; i < minLength; i++) {
        reference[i] += tile.signal[i] * weight;
      }
    }

    // Normalizar
    if (totalWeight > this.config.eps) {
      for (let i = 0; i < minLength; i++) {
        reference[i] /= totalWeight;
      }
    }

    // Aplicar suavizado ligero para reducir ruido
    return this.smoothSignal(reference);
  }

  /**
   * Calcular métricas de coherencia para tile específico
   */
  private calculateTileCoherence(
    tile: {id: string; x: number; y: number; signal: Float64Array; weight: number},
    reference: Float64Array
  ): TileCoherenceMetrics {
    const signal = tile.signal;
    const minLength = Math.min(signal.length, reference.length);
    
    if (minLength < 10) {
      return this.createEmptyTileMetrics(tile.id, tile.x, tile.y, tile.weight);
    }

    // Truncar señales a longitud común
    const tileSignal = signal.slice(0, minLength);
    const refSignal = reference.slice(0, minLength);

    // 1. Correlación con referencia
    const correlation = this.calculateCorrelation(tileSignal, refSignal);
    
    // 2. Coherencia de fase
    const phaseCoherence = this.calculatePhaseCoherence(tileSignal, refSignal);
    
    // 3. Coherencia de amplitud
    const amplitudeCoherence = this.calculateAmplitudeCoherence(tileSignal, refSignal);
    
    // 4. Coherencia espectral
    const frequencyCoherence = this.calculateFrequencyCoherence(tileSignal, refSignal);
    
    // 5. Consistencia armónica
    const harmonicConsistency = this.calculateHarmonicConsistency(tileSignal, refSignal);
    
    // 6. Consistencia espacial
    const spatialConsistency = this.calculateSpatialConsistency(tile);
    
    // 7. Acuerdo con vecinos
    const neighborAgreement = this.calculateNeighborAgreement(tile);
    
    // 8. Penalizaciones
    const phasePenalty = this.calculatePhasePenalty(tileSignal, refSignal);
    const noisePenalty = this.calculateNoisePenalty(tileSignal);
    const outlierPenalty = this.calculateOutlierPenalty(tile, refSignal);

    // Score final de coherencia
    const coherenceScore = this.calculateCoherenceScore({
      correlation,
      phaseCoherence,
      amplitudeCoherence,
      frequencyCoherence,
      harmonicConsistency,
      spatialConsistency,
      neighborAgreement,
      phasePenalty,
      noisePenalty,
      outlierPenalty
    });

    return {
      tileId: tile.id,
      x: tile.x,
      y: tile.y,
      correlation,
      phaseCoherence,
      amplitudeCoherence,
      frequencyCoherence,
      harmonicConsistency,
      spatialConsistency,
      neighborAgreement,
      phasePenalty,
      noisePenalty,
      outlierPenalty,
      coherenceScore,
      weight: tile.weight,
      lastUpdate: performance.now()
    };
  }

  /**
   * Calcular correlación Pearson
   */
  private calculateCorrelation(signal1: Float64Array, signal2: Float64Array): number {
    const n = signal1.length;
    
    // Calcular medias
    const mean1 = signal1.reduce((sum, val) => sum + val, 0) / n;
    const mean2 = signal2.reduce((sum, val) => sum + val, 0) / n;
    
    // Calcular covarianza y varianzas
    let covariance = 0;
    let var1 = 0;
    let var2 = 0;
    
    for (let i = 0; i < n; i++) {
      const dev1 = signal1[i] - mean1;
      const dev2 = signal2[i] - mean2;
      covariance += dev1 * dev2;
      var1 += dev1 * dev1;
      var2 += dev2 * dev2;
    }
    
    const denominator = Math.sqrt(var1 * var2);
    return denominator > this.config.eps ? covariance / denominator : 0;
  }

  /**
   * Calcular coherencia de fase usando Hilbert transform simplificada
   */
  private calculatePhaseCoherence(signal1: Float64Array, signal2: Float64Array): number {
    const n = signal1.length;
    
    // Extraer fase usando método simple de cruce por cero
    const phase1 = this.extractPhase(signal1);
    const phase2 = this.extractPhase(signal2);
    
    if (!phase1 || !phase2) return 0;
    
    // Calcular coherencia de fase
    let coherenceSum = 0;
    let validPoints = 0;
    
    for (let i = 0; i < Math.min(phase1.length, phase2.length); i++) {
      if (phase1[i] !== null && phase2[i] !== null) {
        const phaseDiff = Math.abs(phase1[i]! - phase2[i]!);
        const coherence = Math.cos(phaseDiff);
        coherenceSum += coherence;
        validPoints++;
      }
    }
    
    return validPoints > 0 ? coherenceSum / validPoints : 0;
  }

  /**
   * Extraer fase de señal (método simplificado)
   */
  private extractPhase(signal: Float64Array): (number | null)[] {
    const n = signal.length;
    const phases: (number | null)[] = new Array(n);
    
    // Encontrar picos para estimar fase
    const mean = signal.reduce((sum, val) => sum + val, 0) / n;
    const threshold = mean * 1.1;
    
    let lastPeakIndex = -1;
    
    for (let i = 1; i < n - 1; i++) {
      if (signal[i] > threshold && signal[i] > signal[i-1] && signal[i] > signal[i+1]) {
        if (lastPeakIndex >= 0) {
          const period = i - lastPeakIndex;
          const phase = 2 * Math.PI * (i % period) / period;
          
          // Asignar fase a puntos alrededor del pico
          for (let j = Math.max(0, lastPeakIndex); j <= Math.min(n - 1, i); j++) {
            if (phases[j] === null) {
              const localPhase = phase - 2 * Math.PI * (i - j) / period;
              phases[j] = localPhase;
            }
          }
        }
        lastPeakIndex = i;
      }
    }
    
    return phases;
  }

  /**
   * Calcular coherencia de amplitud
   */
  private calculateAmplitudeCoherence(signal1: Float64Array, signal2: Float64Array): number {
    const env1 = this.calculateEnvelope(signal1);
    const env2 = this.calculateEnvelope(signal2);
    
    if (!env1 || !env2) return 0;
    
    return this.calculateCorrelation(env1, env2);
  }

  /**
   * Calcular envolvente de señal
   */
  private calculateEnvelope(signal: Float64Array): Float64Array | null {
    const n = signal.length;
    const envelope = new Float64Array(n);
    
    // Media móvil de valor absoluto
    const windowSize = Math.max(3, Math.floor(n / 20));
    
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      
      for (let j = Math.max(0, i - windowSize); j <= Math.min(n - 1, i + windowSize); j++) {
        sum += Math.abs(signal[j]);
        count++;
      }
      
      envelope[i] = sum / count;
    }
    
    return envelope;
  }

  /**
   * Calcular coherencia espectral
   */
  private calculateFrequencyCoherence(signal1: Float64Array, signal2: Float64Array): number {
    const psd1 = this.simplePSD(signal1);
    const psd2 = this.simplePSD(signal2);
    
    if (!psd1 || !psd2) return 0;
    
    // Encontrar coherencia en banda cardíaca
    const sampleRate = 30; // Asumir 30Hz
    const n = psd1.length;
    const freqResolution = sampleRate / n;
    
    const cardiacStart = Math.floor(0.8 / freqResolution);
    const cardiacEnd = Math.floor(3.0 / freqResolution);
    
    let coherenceSum = 0;
    let count = 0;
    
    for (let i = cardiacStart; i <= cardiacEnd && i < n; i++) {
      const power1 = psd1[i];
      const power2 = psd2[i];
      const totalPower = power1 + power2;
      
      if (totalPower > this.config.eps) {
        const coherence = 2 * Math.min(power1, power2) / totalPower;
        coherenceSum += coherence;
        count++;
      }
    }
    
    return count > 0 ? coherenceSum / count : 0;
  }

  /**
   * PSD simple
   */
  private simplePSD(signal: Float64Array): Float64Array | null {
    const n = signal.length;
    if (n < 4) return null;
    
    const psd = new Float64Array(n);
    
    for (let k = 0; k < n; k++) {
      let real = 0, imag = 0;
      
      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        real += signal[i] * Math.cos(angle);
        imag += signal[i] * Math.sin(angle);
      }
      
      psd[k] = (real * real + imag * imag) / (n * n);
    }
    
    return psd;
  }

  /**
   * Calcular consistencia armónica
   */
  private calculateHarmonicConsistency(signal1: Float64Array, signal2: Float64Array): number {
    const psd1 = this.simplePSD(signal1);
    const psd2 = this.simplePSD(signal2);
    
    if (!psd1 || !psd2) return 0;
    
    // Encontrar picos en armónicos
    const fundamental = this.dominantFrequency;
    const sampleRate = 30;
    const n = psd1.length;
    const freqResolution = sampleRate / n;
    
    const harmonics = [fundamental, 2 * fundamental, 3 * fundamental];
    let consistency = 0;
    
    for (const harmonic of harmonics) {
      const bin = Math.round(harmonic / freqResolution);
      if (bin > 0 && bin < n / 2) {
        const power1 = psd1[bin];
        const power2 = psd2[bin];
        const totalPower = power1 + power2;
        
        if (totalPower > this.config.eps) {
          consistency += 2 * Math.min(power1, power2) / totalPower;
        }
      }
    }
    
    return Math.min(1, consistency / harmonics.length);
  }

  /**
   * Calcular consistencia espacial
   */
  private calculateSpatialConsistency(tile: {id: string; x: number; y: number}): number {
    // Simplificado: basado en posición central
    const centerX = 4; // Asumir grilla 9x9, centro en (4,4)
    const centerY = 4;
    
    const distance = Math.sqrt(Math.pow(tile.x - centerX, 2) + Math.pow(tile.y - centerY, 2));
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    
    // Tiles más centrales tienen mayor consistencia esperada
    return 1 - (distance / maxDistance);
  }

  /**
   * Calcular acuerdo con vecinos
   */
  private calculateNeighborAgreement(tile: {id: string; x: number; y: number}): number {
    const neighbors = this.getNeighborTiles(tile.x, tile.y);
    if (neighbors.length === 0) return 0.5;
    
    let agreement = 0;
    
    for (const neighborId of neighbors) {
      const neighborMetrics = this.tileMetrics.get(neighborId);
      if (neighborMetrics) {
        // Simplificado: acuerdo basado en métricas existentes
        agreement += neighborMetrics.coherenceScore;
      }
    }
    
    return neighbors.length > 0 ? agreement / neighbors.length : 0.5;
  }

  /**
   * Obtener IDs de tiles vecinos
   */
  private getNeighborTiles(x: number, y: number): string[] {
    const neighbors: string[] = [];
    
    for (const [tileId, metrics] of this.tileMetrics) {
      const distance = Math.sqrt(Math.pow(metrics.x - x, 2) + Math.pow(metrics.y - y, 2));
      if (distance <= this.config.neighborRadius && distance > 0) {
        neighbors.push(tileId);
      }
    }
    
    return neighbors;
  }

  /**
   * Calcular penalización por fase
   */
  private calculatePhasePenalty(signal1: Float64Array, signal2: Float64Array): number {
    const phase1 = this.extractPhase(signal1);
    const phase2 = this.extractPhase(signal2);
    
    if (!phase1 || !phase2) return 1;
    
    let maxPhaseDiff = 0;
    let validPoints = 0;
    
    for (let i = 0; i < Math.min(phase1.length, phase2.length); i++) {
      if (phase1[i] !== null && phase2[i] !== null) {
        const phaseDiff = Math.abs(phase1[i]! - phase2[i]!);
        maxPhaseDiff = Math.max(maxPhaseDiff, phaseDiff);
        validPoints++;
      }
    }
    
    if (validPoints === 0) return 1;
    
    // Penalizar si la diferencia de fase excede el umbral
    return maxPhaseDiff > this.config.maxPhaseSpread ? 
      Math.min(1, (maxPhaseDiff - this.config.maxPhaseSpread) / Math.PI) : 0;
  }

  /**
   * Calcular penalización por ruido
   */
  private calculateNoisePenalty(signal: Float64Array): number {
    // Estimar ruido como alta frecuencia
    const diff = new Float64Array(signal.length - 1);
    for (let i = 0; i < diff.length; i++) {
      diff[i] = signal[i + 1] - signal[i];
    }
    
    const noisePower = diff.reduce((sum, val) => sum + val * val, 0) / diff.length;
    const signalPower = signal.reduce((sum, val) => sum + val * val, 0) / signal.length;
    
    return signalPower > this.config.eps ? Math.min(1, noisePower / signalPower) : 1;
  }

  /**
   * Calcular penalización por outlier
   */
  private calculateOutlierPenalty(
    tile: {id: string; x: number; y: number}, 
    reference: Float64Array
  ): number {
    const tileMetrics = this.tileMetrics.get(tile.id);
    if (!tileMetrics) return 0.5;
    
    // Comparar con vecinos
    const neighbors = this.getNeighborTiles(tile.x, tile.y);
    if (neighbors.length === 0) return 0.5;
    
    let neighborCorrelation = 0;
    let count = 0;
    
    for (const neighborId of neighbors) {
      const neighborMetrics = this.tileMetrics.get(neighborId);
      if (neighborMetrics) {
        neighborCorrelation += neighborMetrics.correlation;
        count++;
      }
    }
    
    if (count === 0) return 0.5;
    
    const avgNeighborCorrelation = neighborCorrelation / count;
    const tileCorrelation = tileMetrics.correlation;
    
    // Penalizar si este tile es muy diferente a sus vecinos
    const diff = Math.abs(tileCorrelation - avgNeighborCorrelation);
    return Math.min(1, diff * 2);
  }

  /**
   * Calcular score final de coherencia
   */
  private calculateCoherenceScore(metrics: {
    correlation: number;
    phaseCoherence: number;
    amplitudeCoherence: number;
    frequencyCoherence: number;
    harmonicConsistency: number;
    spatialConsistency: number;
    neighborAgreement: number;
    phasePenalty: number;
    noisePenalty: number;
    outlierPenalty: number;
  }): number {
    const weights = {
      correlation: 0.25,
      phaseCoherence: 0.20,
      amplitudeCoherence: 0.15,
      frequencyCoherence: 0.15,
      harmonicConsistency: 0.10,
      spatialConsistency: 0.05,
      neighborAgreement: 0.05,
      phasePenalty: -0.30,
      noisePenalty: -0.20,
      outlierPenalty: -0.15
    };

    let score = 0;
    score += metrics.correlation * weights.correlation;
    score += metrics.phaseCoherence * weights.phaseCoherence;
    score += metrics.amplitudeCoherence * weights.amplitudeCoherence;
    score += metrics.frequencyCoherence * weights.frequencyCoherence;
    score += metrics.harmonicConsistency * weights.harmonicConsistency;
    score += metrics.spatialConsistency * weights.spatialConsistency;
    score += metrics.neighborAgreement * weights.neighborAgreement;
    score += metrics.phasePenalty * weights.phasePenalty;
    score += metrics.noisePenalty * weights.noisePenalty;
    score += metrics.outlierPenalty * weights.outlierPenalty;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calcular coherencia global
   */
  private calculateGlobalCoherence(tileMetrics: TileCoherenceMetrics[]): number {
    if (tileMetrics.length === 0) return 0;
    
    const weightedSum = tileMetrics.reduce((sum, tile) => 
      sum + tile.coherenceScore * tile.weight, 0);
    const totalWeight = tileMetrics.reduce((sum, tile) => sum + tile.weight, 0);
    
    return totalWeight > this.config.eps ? weightedSum / totalWeight : 0;
  }

  /**
   * Calcular fase promedio
   */
  private calculateAveragePhase(tileMetrics: TileCoherenceMetrics[]): number {
    // Simplificado - podría calcularse de forma más precisa
    return 0;
  }

  /**
   * Calcular dispersión de fase
   */
  private calculatePhaseSpread(tileMetrics: TileCoherenceMetrics[]): number {
    // Simplificado - podría calcularse de forma más precisa
    return 0;
  }

  /**
   * Calcular calidad espacial
   */
  private calculateSpatialQuality(tileMetrics: TileCoherenceMetrics[]): number {
    if (tileMetrics.length === 0) return 0;
    
    const avgCoherence = tileMetrics.reduce((sum, tile) => sum + tile.coherenceScore, 0) / tileMetrics.length;
    const coherentRatio = tileMetrics.filter(tile => tile.coherenceScore >= this.config.minCorrelation).length / tileMetrics.length;
    
    return (avgCoherence * 0.7 + coherentRatio * 0.3);
  }

  /**
   * Suavizar señal
   */
  private smoothSignal(signal: Float64Array): Float64Array {
    const smoothed = new Float64Array(signal.length);
    const windowSize = 3;
    
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      let count = 0;
      
      for (let j = Math.max(0, i - windowSize); j <= Math.min(signal.length - 1, i + windowSize); j++) {
        sum += signal[j];
        count++;
      }
      
      smoothed[i] = sum / count;
    }
    
    return smoothed;
  }

  /**
   * Crear métricas vacías para tile
   */
  private createEmptyTileMetrics(id: string, x: number, y: number, weight: number): TileCoherenceMetrics {
    return {
      tileId: id,
      x,
      y,
      correlation: 0,
      phaseCoherence: 0,
      amplitudeCoherence: 0,
      frequencyCoherence: 0,
      harmonicConsistency: 0,
      spatialConsistency: 0,
      neighborAgreement: 0,
      phasePenalty: 1,
      noisePenalty: 1,
      outlierPenalty: 0.5,
      coherenceScore: 0,
      weight,
      lastUpdate: performance.now()
    };
  }

  /**
   * Crear resultado vacío
   */
  private createEmptyResult(): SpatialCoherenceResult {
    return {
      globalCoherence: 0,
      coherentTiles: [],
      incoherentTiles: [],
      referenceSignal: new Float64Array(0),
      dominantFrequency: 0,
      averagePhase: 0,
      phaseSpread: 0,
      spatialQuality: 0
    };
  }

  /**
   * Obtener métricas de tile específico
   */
  public getTileMetrics(tileId: string): TileCoherenceMetrics | null {
    return this.tileMetrics.get(tileId) || null;
  }

  /**
   * Resetear estado
   */
  public reset(): void {
    this.tileMetrics.clear();
    this.referenceSignal = null;
    this.dominantFrequency = 0;
  }
}
