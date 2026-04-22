/**
 * FINGER CONTACT MODEL
 * 
 * Modelo multicapa de detección de contacto de dedo usando evidencias
 * cromáticas, espaciales y temporales.
 */

import { RobustStats } from './RobustStats';

export interface ChromaticEvidence {
  meanR: number;
  meanG: number;
  meanB: number;
  redDominance: number;
  rgRatio: number;
  rbRatio: number;
  chromaticity: { r: number; g: number; b: number };
  luminance: number;
  yCbCr: { y: number; cb: number; cr: number };
  clipHighPct: number;
  clipLowPct: number;
  colorUniformity: number;
  localVariability: number;
}

export interface SpatialEvidence {
  maskAdaptive: Uint8Array;
  blobDominant: boolean;
  blobCentrality: number;
  blobContinuity: number;
  minCoverage: number;
  chromaticConsistency: number;
}

export interface TemporalEvidence {
  stabilityScore: number;
  driftScore: number;
  persistenceScore: number;
  motionScore: number;
}

export interface ContactModelOutput {
  fingerLikelihood: number;
  chromaticScore: number;
  spatialScore: number;
  temporalScore: number;
  evidence: {
    chromatic: ChromaticEvidence;
    spatial: SpatialEvidence;
    temporal: TemporalEvidence;
  };
}

export class FingerContactModel {
  private readonly EPS = 1e-6;
  private history: number[] = [];
  private maxHistory = 60;
  private sessionPercentiles: { p25: number; p50: number; p75: number } = { p25: 0, p50: 0, p75: 0 };

  /**
   * Calcula evidencia cromática de un frame
   */
  computeChromaticEvidence(
    r: number, g: number, b: number,
    clipHigh: number, clipLow: number,
    localVariance: number = 0
  ): ChromaticEvidence {
    const total = r + g + b + this.EPS;
    
    const redDominance = r - (g + b) / 2;
    const rgRatio = r / Math.max(g, this.EPS);
    const rbRatio = r / Math.max(b, this.EPS);
    
    const chromaticity = {
      r: r / total,
      g: g / total,
      b: b / total
    };
    
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    
    const yCbCr = {
      y: luminance,
      cb: 0.5 * (b - luminance) + 128,
      cr: 0.5 * (r - luminance) + 128
    };
    
    const colorUniformity = 1 - Math.min(1, localVariance / (luminance + this.EPS));
    
    return {
      meanR: r,
      meanG: g,
      meanB: b,
      redDominance,
      rgRatio,
      rbRatio,
      chromaticity,
      luminance,
      yCbCr,
      clipHighPct: clipHigh,
      clipLowPct: clipLow,
      colorUniformity,
      localVariability: localVariance
    };
  }

  /**
   * Calcula score cromático (0-1)
   */
  computeChromaticScore(evidence: ChromaticEvidence): number {
    let score = 0;
    
    // Red dominance (peso 0.3)
    const redDomScore = Math.max(0, Math.min(1, (evidence.redDominance - 5) / 50));
    score += redDomScore * 0.3;
    
    // RG ratio (peso 0.25)
    const rgScore = Math.max(0, Math.min(1, (evidence.rgRatio - 1.0) / 0.8));
    score += rgScore * 0.25;
    
    // Luminancia en rango (peso 0.15)
    const lumScore = evidence.luminance > 80 && evidence.luminance < 600 ? 1 : 0;
    score += lumScore * 0.15;
    
    // Uniformidad de color (peso 0.1)
    score += evidence.colorUniformity * 0.1;
    
    // Penalización por clipping (peso 0.2)
    const clipPenalty = Math.min(1, (evidence.clipHighPct + evidence.clipLowPct) * 3);
    score *= (1 - clipPenalty);
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calcula evidencia espacial
   */
  computeSpatialEvidence(
    tileScores: Float64Array,
    gridWidth: number,
    gridHeight: number
  ): SpatialEvidence {
    // Máscara adaptativa basada en percentiles
    const threshold = RobustStats.percentile(tileScores, 0.5);
    const mask = new Uint8Array(tileScores.length);
    let validCount = 0;
    
    for (let i = 0; i < tileScores.length; i++) {
      if (tileScores[i] > threshold) {
        mask[i] = 1;
        validCount++;
      }
    }
    
    // Blob dominante (centro)
    const centerIdx = Math.floor(gridHeight / 2) * gridWidth + Math.floor(gridWidth / 2);
    const blobDominant = mask[centerIdx] === 1;
    
    // Centralidad
    let centerSum = 0;
    let centerCount = 0;
    const margin = Math.floor(gridWidth * 0.2);
    for (let y = margin; y < gridHeight - margin; y++) {
      for (let x = margin; x < gridWidth - margin; x++) {
        const i = y * gridWidth + x;
        centerSum += mask[i];
        centerCount++;
      }
    }
    const blobCentrality = centerCount > 0 ? centerSum / centerCount : 0;
    
    // Continuidad (vecinos similares)
    let continuitySum = 0;
    let continuityCount = 0;
    for (let y = 1; y < gridHeight - 1; y++) {
      for (let x = 1; x < gridWidth - 1; x++) {
        const i = y * gridWidth + x;
        const neighbors = [
          mask[i - 1], mask[i + 1],
          mask[i - gridWidth], mask[i + gridWidth]
        ];
        const avgNeighbor = neighbors.reduce((a, b) => a + b, 0) / 4;
        continuitySum += mask[i] === avgNeighbor ? 1 : 0;
        continuityCount++;
      }
    }
    const blobContinuity = continuityCount > 0 ? continuitySum / continuityCount : 0;
    
    // Cobertura mínima
    const minCoverage = validCount / tileScores.length;
    
    // Consistencia cromática (variación de scores)
    const validScores = Array.from(tileScores).filter((_, i) => mask[i] === 1);
    const chromaticConsistency = validScores.length > 1 
      ? 1 - RobustStats.cv(validScores)
      : 0;
    
    return {
      maskAdaptive: mask,
      blobDominant,
      blobCentrality,
      blobContinuity,
      minCoverage,
      chromaticConsistency
    };
  }

  /**
   * Calcula score espacial (0-1)
   */
  computeSpatialScore(evidence: SpatialEvidence): number {
    let score = 0;
    
    // Blob dominante en centro (peso 0.3)
    score += (evidence.blobDominant ? 1 : 0) * 0.3;
    
    // Centralidad (peso 0.25)
    score += evidence.blobCentrality * 0.25;
    
    // Continuidad (peso 0.2)
    score += evidence.blobContinuity * 0.2;
    
    // Cobertura mínima (peso 0.15)
    const covScore = Math.max(0, Math.min(1, (evidence.minCoverage - 0.2) / 0.4));
    score += covScore * 0.15;
    
    // Consistencia cromática (peso 0.1)
    score += evidence.chromaticConsistency * 0.1;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calcula evidencia temporal
   */
  computeTemporalEvidence(
    currentScore: number,
    motionScore: number
  ): TemporalEvidence {
    // Agregar al historial
    this.history.push(currentScore);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    // Actualizar percentiles de sesión
    if (this.history.length >= 30) {
      this.sessionPercentiles = {
        p25: RobustStats.percentile(this.history, 0.25),
        p50: RobustStats.percentile(this.history, 0.5),
        p75: RobustStats.percentile(this.history, 0.75)
      };
    }
    
    // Estabilidad (variación reciente)
    let stabilityScore = 0;
    if (this.history.length >= 10) {
      const recent = this.history.slice(-10);
      const cv = RobustStats.cv(recent);
      stabilityScore = Math.max(0, 1 - cv * 2);
    }
    
    // Drift (cambio de media a largo plazo)
    let driftScore = 0;
    if (this.history.length >= 30) {
      const firstHalf = this.history.slice(0, Math.floor(this.history.length / 2));
      const secondHalf = this.history.slice(Math.floor(this.history.length / 2));
      const mean1 = RobustStats.mean(firstHalf);
      const mean2 = RobustStats.mean(secondHalf);
      const drift = Math.abs(mean2 - mean1) / (Math.abs(mean1) + 1);
      driftScore = Math.max(0, 1 - drift * 5);
    }
    
    // Persistencia (tiempo sobre umbral)
    const threshold = this.sessionPercentiles.p50;
    const aboveThreshold = this.history.filter(s => s > threshold).length;
    const persistenceScore = this.history.length > 0 ? aboveThreshold / this.history.length : 0;
    
    return {
      stabilityScore,
      driftScore,
      persistenceScore,
      motionScore
    };
  }

  /**
   * Calcula score temporal (0-1)
   */
  computeTemporalScore(evidence: TemporalEvidence): number {
    let score = 0;
    
    // Estabilidad (peso 0.35)
    score += evidence.stabilityScore * 0.35;
    
    // Drift bajo (peso 0.25)
    score += evidence.driftScore * 0.25;
    
    // Persistencia (peso 0.25)
    score += evidence.persistenceScore * 0.25;
    
    // Motion bajo (peso 0.15)
    const motionPenalty = Math.min(1, evidence.motionScore);
    score += (1 - motionPenalty) * 0.15;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Procesa un frame completo y devuelve likelihood de dedo
   */
  processFrame(
    r: number, g: number, b: number,
    clipHigh: number, clipLow: number,
    tileScores: Float64Array,
    gridWidth: number,
    gridHeight: number,
    motionScore: number,
    localVariance: number = 0
  ): ContactModelOutput {
    // Evidencia cromática
    const chromaticEvidence = this.computeChromaticEvidence(r, g, b, clipHigh, clipLow, localVariance);
    const chromaticScore = this.computeChromaticScore(chromaticEvidence);
    
    // Evidencia espacial
    const spatialEvidence = this.computeSpatialEvidence(tileScores, gridWidth, gridHeight);
    const spatialScore = this.computeSpatialScore(spatialEvidence);
    
    // Evidencia temporal
    const temporalEvidence = this.computeTemporalEvidence(chromaticScore, motionScore);
    const temporalScore = this.computeTemporalScore(temporalEvidence);
    
    // Likelihood combinado con histéresis
    const combinedScore = chromaticScore * 0.4 + spatialScore * 0.35 + temporalScore * 0.25;
    
    return {
      fingerLikelihood: combinedScore,
      chromaticScore,
      spatialScore,
      temporalScore,
      evidence: {
        chromatic: chromaticEvidence,
        spatial: spatialEvidence,
        temporal: temporalEvidence
      }
    };
  }

  /**
   * Resetea el modelo
   */
  reset(): void {
    this.history = [];
    this.sessionPercentiles = { p25: 0, p50: 0, p75: 0 };
  }

  /**
   * Obtiene percentiles de sesión
   */
  getSessionPercentiles() {
    return this.sessionPercentiles;
  }
}
