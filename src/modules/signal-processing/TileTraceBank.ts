/**
 * TILE TRACE BANK
 * 
 * Banco temporal de trazas por tile para extracción de señal PPG.
 */

export interface TileTrace {
  timestamp: number;
  rawR: number;
  rawG: number;
  rawB: number;
  dcBaselineR: number;
  dcBaselineG: number;
  dcBaselineB: number;
  acResidualR: number;
  acResidualG: number;
  acResidualB: number;
  absorbanceR: number;
  absorbanceG: number;
  absorbanceB: number;
  acdcR: number;
  acdcG: number;
  acdcB: number;
  detrendedR: number;
  detrendedG: number;
  detrendedB: number;
  qualityScore: number;
  coherenceScore: number;
  clipPenalty: number;
  pressureMark: number;
}

export class TileTraceBank {
  private traces: Map<number, TileTrace[]> = new Map();
  private maxTracesPerTile = 180; // ~6 segundos a 30fps
  private topKTiles: number[] = [];
  private maxTopK = 12;
  private readonly EPS = 1e-6;

  /**
   * Agrega una traza para un tile específico
   */
  addTrace(
    tileIndex: number,
    r: number, g: number, b: number,
    dcR: number, dcG: number, dcB: number,
    quality: number,
    coherence: number,
    clipPenalty: number,
    pressureMark: number
  ): void {
    const timestamp = performance.now();
    
    const acR = r - dcR;
    const acG = g - dcG;
    const acB = b - dcB;
    
    const absorbanceR = dcR > this.EPS ? -Math.log((r + this.EPS) / dcR) : 0;
    const absorbanceG = dcG > this.EPS ? -Math.log((g + this.EPS) / dcG) : 0;
    const absorbanceB = dcB > this.EPS ? -Math.log((b + this.EPS) / dcB) : 0;
    
    const acdcR = dcR > this.EPS ? acR / dcR : 0;
    const acdcG = dcG > this.EPS ? acG / dcG : 0;
    const acdcB = dcB > this.EPS ? acB / dcB : 0;
    
    const trace: TileTrace = {
      timestamp,
      rawR: r, rawG: g, rawB: b,
      dcBaselineR: dcR, dcBaselineG: dcG, dcBaselineB: dcB,
      acResidualR: acR, acResidualG: acG, acResidualB: acB,
      absorbanceR, absorbanceG, absorbanceB,
      acdcR, acdcG, acdcB,
      detrendedR: acR, detrendedG: acG, detrendedB: acB,
      qualityScore: quality,
      coherenceScore: coherence,
      clipPenalty,
      pressureMark
    };
    
    if (!this.traces.has(tileIndex)) {
      this.traces.set(tileIndex, []);
    }
    
    const tileTraces = this.traces.get(tileIndex)!;
    tileTraces.push(trace);
    
    // Mantener tamaño máximo
    if (tileTraces.length > this.maxTracesPerTile) {
      tileTraces.shift();
    }
  }

  /**
   * Obtiene trazas de un tile
   */
  getTraces(tileIndex: number): TileTrace[] {
    return this.traces.get(tileIndex) || [];
  }

  /**
   * Obtiene trazas recientes de un tile
   */
  getRecentTraces(tileIndex: number, count: number): TileTrace[] {
    const traces = this.traces.get(tileIndex);
    if (!traces) return [];
    return traces.slice(-count);
  }

  /**
   * Actualiza top-K tiles basado en calidad promedio
   */
  updateTopK(): void {
    const tileScores: { index: number; avgQuality: number }[] = [];
    
    for (const [index, traces] of this.traces.entries()) {
      if (traces.length < 10) continue;
      
      const recent = traces.slice(-30);
      const avgQuality = recent.reduce((sum, t) => sum + t.qualityScore, 0) / recent.length;
      tileScores.push({ index, avgQuality });
    }
    
    // Ordenar por calidad y tomar top-K
    tileScores.sort((a, b) => b.avgQuality - a.avgQuality);
    this.topKTiles = tileScores.slice(0, this.maxTopK).map(t => t.index);
  }

  /**
   * Obtiene top-K tiles
   */
  getTopKTiles(): number[] {
    return this.topKTiles;
  }

  /**
   * Obtiene señal combinada de top-K tiles
   */
  getCombinedSignal(channel: 'rawR' | 'rawG' | 'rawB' | 'absorbanceR' | 'absorbanceG' | 'absorbanceB' | 'acdcR' | 'acdcG' | 'acdcB'): number[] {
    if (this.topKTiles.length === 0) return [];
    
    const minLength = Math.min(...this.topKTiles.map(i => this.traces.get(i)?.length || 0));
    if (minLength === 0) return [];
    
    const combined: number[] = [];
    
    for (let t = 0; t < minLength; t++) {
      let sum = 0;
      let weight = 0;
      
      for (const tileIndex of this.topKTiles) {
        const traces = this.traces.get(tileIndex);
        if (!traces) continue;
        
        const trace = traces[t];
        const value = trace[channel as keyof TileTrace] as number;
        const w = trace.qualityScore * trace.coherenceScore * (1 - trace.clipPenalty);
        
        sum += value * w;
        weight += w;
      }
      
      combined.push(weight > 0 ? sum / weight : 0);
    }
    
    return combined;
  }

  /**
   * Obtiene absorbancia promedio de top-K tiles
   */
  getAverageAbsorbance(): { r: number; g: number; b: number } {
    const rSignal = this.getCombinedSignal('absorbanceR');
    const gSignal = this.getCombinedSignal('absorbanceG');
    const bSignal = this.getCombinedSignal('absorbanceB');
    
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    
    return {
      r: avg(rSignal),
      g: avg(gSignal),
      b: avg(bSignal)
    };
  }

  /**
   * Obtiene AC/DC promedio de top-K tiles
   */
  getAverageACDC(): { r: number; g: number; b: number } {
    const rSignal = this.getCombinedSignal('acdcR');
    const gSignal = this.getCombinedSignal('acdcG');
    const bSignal = this.getCombinedSignal('acdcB');
    
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    
    return {
      r: avg(rSignal),
      g: avg(gSignal),
      b: avg(bSignal)
    };
  }

  /**
   * Limpia trazas de tiles específicos
   */
  clearTile(tileIndex: number): void {
    this.traces.delete(tileIndex);
    this.topKTiles = this.topKTiles.filter(i => i !== tileIndex);
  }

  /**
   * Limpia trazas de tiles basura (calidad muy baja)
   */
  purgeGarbageTiles(threshold: number = 0.2): void {
    const toDelete: number[] = [];
    
    for (const [index, traces] of this.traces.entries()) {
      if (traces.length < 20) continue;
      
      const recent = traces.slice(-30);
      const avgQuality = recent.reduce((sum, t) => sum + t.qualityScore, 0) / recent.length;
      
      if (avgQuality < threshold) {
        toDelete.push(index);
      }
    }
    
    for (const index of toDelete) {
      this.clearTile(index);
    }
  }

  /**
   * Resetea parcialmente cuando la máscara cae
   */
  partialReset(activeTiles: number[]): void {
    const toDelete: number[] = [];
    
    for (const index of this.traces.keys()) {
      if (!activeTiles.includes(index)) {
        toDelete.push(index);
      }
    }
    
    for (const index of toDelete) {
      this.clearTile(index);
    }
  }

  /**
   * Resetea completo
   */
  reset(): void {
    this.traces.clear();
    this.topKTiles = [];
  }

  /**
   * Obtiene estadísticas del banco
   */
  getStats() {
    let totalTraces = 0;
    let totalTiles = this.traces.size;
    
    for (const traces of this.traces.values()) {
      totalTraces += traces.length;
    }
    
    return {
      totalTiles,
      totalTraces,
      topKCount: this.topKTiles.length,
      avgTracesPerTile: totalTiles > 0 ? totalTraces / totalTiles : 0
    };
  }
}
