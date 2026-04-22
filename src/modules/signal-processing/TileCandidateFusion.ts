/**
 * TILE CANDIDATE FUSION
 * 
 * Fusión de candidatos de señal desde múltiples tiles con ranking.
 */

import { RobustStats } from './RobustStats';

export interface TileCandidate {
  tileIndex: number;
  value: number;
  quality: number;
  weight: number;
}

export interface FusionResult {
  fusedValue: number;
  activeTileCount: number;
  discardedTileCount: number;
  averageQuality: number;
  coherence: number;
  fusionMethod: string;
}

export class TileCandidateFusion {
  private candidates: TileCandidate[] = [];
  private maxCandidates = 49; // 7x7 grid

  /**
   * Agrega candidato de un tile
   */
  addCandidate(tileIndex: number, value: number, quality: number, weight: number = 1): void {
    this.candidates.push({
      tileIndex,
      value,
      quality: Math.max(0, Math.min(1, quality)),
      weight: Math.max(0, weight)
    });

    if (this.candidates.length > this.maxCandidates) {
      this.candidates.shift();
    }
  }

  /**
   * Fusión por promedio ponderado
   */
  fuseWeightedAverage(): FusionResult {
    if (this.candidates.length === 0) {
      return this.getEmptyResult('weighted_average');
    }

    let weightedSum = 0;
    let totalWeight = 0;
    let qualitySum = 0;

    for (const c of this.candidates) {
      const w = c.weight * c.quality;
      weightedSum += c.value * w;
      totalWeight += w;
      qualitySum += c.quality;
    }

    const fusedValue = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const averageQuality = this.candidates.length > 0 ? qualitySum / this.candidates.length : 0;

    return {
      fusedValue,
      activeTileCount: this.candidates.length,
      discardedTileCount: 0,
      averageQuality,
      coherence: this.computeCoherence(),
      fusionMethod: 'weighted_average'
    };
  }

  /**
   * Fusión por mediana robusta
   */
  fuseMedian(): FusionResult {
    if (this.candidates.length === 0) {
      return this.getEmptyResult('median');
    }

    const values = this.candidates.map(c => c.value);
    const fusedValue = RobustStats.median(values);
    const averageQuality = RobustStats.mean(this.candidates.map(c => c.quality));

    return {
      fusedValue,
      activeTileCount: this.candidates.length,
      discardedTileCount: 0,
      averageQuality,
      coherence: this.computeCoherence(),
      fusionMethod: 'median'
    };
  }

  /**
   * Fusión por top-K tiles
   */
  fuseTopK(k: number = 8): FusionResult {
    if (this.candidates.length === 0) {
      return this.getEmptyResult('top_k');
    }

    // Ordenar por calidad
    const sorted = [...this.candidates].sort((a, b) => b.quality - a.quality);
    const topK = sorted.slice(0, Math.min(k, sorted.length));
    const discarded = sorted.slice(k);

    let weightedSum = 0;
    let totalWeight = 0;
    let qualitySum = 0;

    for (const c of topK) {
      const w = c.weight * c.quality;
      weightedSum += c.value * w;
      totalWeight += w;
      qualitySum += c.quality;
    }

    const fusedValue = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const averageQuality = topK.length > 0 ? qualitySum / topK.length : 0;

    return {
      fusedValue,
      activeTileCount: topK.length,
      discardedTileCount: discarded.length,
      averageQuality,
      coherence: this.computeCoherence(),
      fusionMethod: 'top_k'
    };
  }

  /**
   * Fusión adaptativa (elige método automáticamente)
   */
  fuseAdaptive(): FusionResult {
    const count = this.candidates.length;
    
    if (count < 3) {
      return this.fuseWeightedAverage();
    }
    
    const qualityStd = RobustStats.std(this.candidates.map(c => c.quality));
    
    // Si hay mucha variación en calidad, usar top-K
    if (qualityStd > 0.2) {
      return this.fuseTopK(Math.floor(count * 0.5));
    }
    
    // Si hay outliers, usar mediana
    const values = this.candidates.map(c => c.value);
    const { outliers } = RobustStats.detectOutliersIQR(values);
    if (outliers.length > count * 0.2) {
      return this.fuseMedian();
    }
    
    // Default: weighted average
    return this.fuseWeightedAverage();
  }

  /**
   * Calcula coherencia entre candidatos
   */
  private computeCoherence(): number {
    if (this.candidates.length < 2) return 1;

    const values = this.candidates.map(c => c.value);
    const mean = RobustStats.mean(values);
    const std = RobustStats.std(values);
    
    if (std === 0) return 1;
    
    const cv = std / Math.abs(mean);
    return Math.max(0, 1 - cv);
  }

  /**
   * Filtra candidatos por calidad mínima
   */
  filterByQuality(minQuality: number): void {
    this.candidates = this.candidates.filter(c => c.quality >= minQuality);
  }

  /**
   * Filtra candidatos por peso mínimo
   */
  filterByWeight(minWeight: number): void {
    this.candidates = this.candidates.filter(c => c.weight >= minWeight);
  }

  /**
   * Obtiene resultado vacío
   */
  private getEmptyResult(method: string): FusionResult {
    return {
      fusedValue: 0,
      activeTileCount: 0,
      discardedTileCount: 0,
      averageQuality: 0,
      coherence: 0,
      fusionMethod: method
    };
  }

  /**
   * Resetea candidatos
   */
  reset(): void {
    this.candidates = [];
  }

  /**
   * Obtiene número de candidatos
   */
  getCandidateCount(): number {
    return this.candidates.length;
  }
}
