/**
 * SPATIAL COHERENCE
 * 
 * Calcula coherencia espacial entre tiles válidos.
 */

import { RobustStats } from './RobustStats';

export interface CoherenceMetrics {
  globalCoherence: number;
  referenceCorrelation: number;
  activeCorrelation: number;
  spectralSimilarity: number;
  phaseConsistency: number;
  outOfPhasePenalty: number;
  contradictoryTilePenalty: number;
  validTileCount: number;
}

export class SpatialCoherence {
  private tileSignals: Map<number, number[]> = new Map();
  private maxHistory = 120;
  private referenceSignal: number[] = [];

  /**
   * Agrega señal de un tile
   */
  addTileSignal(tileIndex: number, value: number): void {
    if (!this.tileSignals.has(tileIndex)) {
      this.tileSignals.set(tileIndex, []);
    }
    
    const signals = this.tileSignals.get(tileIndex)!;
    signals.push(value);
    
    if (signals.length > this.maxHistory) {
      signals.shift();
    }
  }

  /**
   * Establece señal de referencia (ej: media de todos los tiles)
   */
  setReferenceSignal(signal: number[]): void {
    this.referenceSignal = [...signal];
    if (this.referenceSignal.length > this.maxHistory) {
      this.referenceSignal = this.referenceSignal.slice(-this.maxHistory);
    }
  }

  /**
   * Calcula correlación con señal de referencia
   */
  private computeCorrelation(signal: number[], reference: number[]): number {
    const n = Math.min(signal.length, reference.length);
    if (n < 10) return 0;
    
    const sig = signal.slice(-n);
    const ref = reference.slice(-n);
    
    return RobustStats.correlation(sig, ref);
  }

  /**
   * Calcula similitud espectral (comparación de autocorrelaciones)
   */
  private computeSpectralSimilarity(signal1: number[], signal2: number[]): number {
    const n = Math.min(signal1.length, signal2.length);
    if (n < 20) return 0;
    
    const sig1 = signal1.slice(-n);
    const sig2 = signal2.slice(-n);
    
    // Autocorrelaciones en lags cardíacos
    const lags = [8, 10, 12, 15, 18, 20, 24, 30];
    let similarity = 0;
    
    for (const lag of lags) {
      if (lag >= n) continue;
      const ac1 = RobustStats.autocorrelation(sig1, lag);
      const ac2 = RobustStats.autocorrelation(sig2, lag);
      similarity += 1 - Math.abs(ac1 - ac2);
    }
    
    return similarity / lags.length;
  }

  /**
   * Calcula consistencia de fase (desfase relativo)
   */
  private computePhaseConsistency(signal: number[], reference: number[]): number {
    const n = Math.min(signal.length, reference.length);
    if (n < 20) return 0;
    
    const sig = signal.slice(-n);
    const ref = reference.slice(-n);
    
    // Encontrar lag de máxima correlación
    let bestLag = 0;
    let bestCorr = 0;
    
    for (let lag = 0; lag < Math.min(30, n - 10); lag++) {
      const corr = RobustStats.correlation(sig.slice(0, n - lag), ref.slice(lag));
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    
    // Penalizar lags grandes (fuera de fase)
    const phasePenalty = Math.min(1, bestLag / 15);
    return 1 - phasePenalty;
  }

  /**
   * Calcula coherencia global
   */
  compute(validTileIndices: number[]): CoherenceMetrics {
    if (validTileIndices.length === 0) {
      return {
        globalCoherence: 0,
        referenceCorrelation: 0,
        activeCorrelation: 0,
        spectralSimilarity: 0,
        phaseConsistency: 0,
        outOfPhasePenalty: 1,
        contradictoryTilePenalty: 1,
        validTileCount: 0
      };
    }

    // Usar el primer tile válido como referencia activa
    const activeTileIndex = validTileIndices[0];
    const activeSignal = this.tileSignals.get(activeTileIndex);
    
    if (!activeSignal || activeSignal.length < 10) {
      return {
        globalCoherence: 0,
        referenceCorrelation: 0,
        activeCorrelation: 0,
        spectralSimilarity: 0,
        phaseConsistency: 0,
        outOfPhasePenalty: 1,
        contradictoryTilePenalty: 1,
        validTileCount: validTileIndices.length
      };
    }

    // Calcular correlaciones con referencia global
    let refCorrSum = 0;
    let refCorrCount = 0;
    
    if (this.referenceSignal.length >= 10) {
      for (const idx of validTileIndices) {
        const sig = this.tileSignals.get(idx);
        if (sig && sig.length >= 10) {
          refCorrSum += this.computeCorrelation(sig, this.referenceSignal);
          refCorrCount++;
        }
      }
    }
    
    const referenceCorrelation = refCorrCount > 0 ? refCorrSum / refCorrCount : 0;

    // Calcular correlaciones con señal activa
    let activeCorrSum = 0;
    let activeCorrCount = 0;
    let spectralSum = 0;
    let phaseSum = 0;
    let outOfPhaseCount = 0;
    let contradictoryCount = 0;
    
    for (const idx of validTileIndices) {
      const sig = this.tileSignals.get(idx);
      if (!sig || sig.length < 10) continue;
      
      const corr = this.computeCorrelation(sig, activeSignal);
      activeCorrSum += corr;
      activeCorrCount++;
      
      spectralSum += this.computeSpectralSimilarity(sig, activeSignal);
      phaseSum += this.computePhaseConsistency(sig, activeSignal);
      
      // Detectar tiles fuera de fase
      if (corr < 0.3) {
        outOfPhaseCount++;
      }
      
      // Detectar tiles contradictorios (correlación negativa)
      if (corr < -0.2) {
        contradictoryCount++;
      }
    }
    
    const activeCorrelation = activeCorrCount > 0 ? activeCorrSum / activeCorrCount : 0;
    const spectralSimilarity = activeCorrCount > 0 ? spectralSum / activeCorrCount : 0;
    const phaseConsistency = activeCorrCount > 0 ? phaseSum / activeCorrCount : 0;
    
    const outOfPhasePenalty = activeCorrCount > 0 ? outOfPhaseCount / activeCorrCount : 0;
    const contradictoryTilePenalty = activeCorrCount > 0 ? contradictoryCount / activeCorrCount : 0;

    // Coherencia global combinada
    const globalCoherence = Math.max(0, Math.min(1,
      referenceCorrelation * 0.3 +
      activeCorrelation * 0.3 +
      spectralSimilarity * 0.2 +
      phaseConsistency * 0.2 -
      outOfPhasePenalty * 0.5 -
      contradictoryTilePenalty * 0.5
    ));

    return {
      globalCoherence,
      referenceCorrelation,
      activeCorrelation,
      spectralSimilarity,
      phaseConsistency,
      outOfPhasePenalty,
      contradictoryTilePenalty,
      validTileCount: validTileIndices.length
    };
  }

  /**
   * Limpia señal de un tile
   */
  clearTile(tileIndex: number): void {
    this.tileSignals.delete(tileIndex);
  }

  /**
   * Resetea todo
   */
  reset(): void {
    this.tileSignals.clear();
    this.referenceSignal = [];
  }

  /**
   * Obtiene número de tiles con señal
   */
  getTileCount(): number {
    return this.tileSignals.size;
  }
}
