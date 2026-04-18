/**
 * FINGER CONTACT CLASSIFIER V2
 * 
 * High-level finger contact detection combining:
 * - Coverage ratio (total + center occupancy)
 * - Red dominance / color ratios
 * - Clipping high/low
 * - Texture entropy
 * - Spatial uniformity
 * - Temporal stability
 * - Pressure proxy (estimated from saturation, variance drop, morphological compression)
 * - Motion contamination
 * 
 * Emits unified taxonomy states with temporal hysteresis and confidence [0..1]
 */

import type { ContactState } from '../../types/signal';
import type { RadiometricTileMetrics } from './RadiometricProcessor';

export type { ContactState };

// ═══════════════════════════════════════════════════════════════════
//  ENHANCED CONTACT FEATURES
// ═══════════════════════════════════════════════════════════════════

export interface ContactFeatures {
  // Radiometric (from linear RGB)
  linearMeanR: number;
  linearMeanG: number;
  linearMeanB: number;
  odMeanR: number;            // Optical density
  odMeanG: number;
  odMeanB: number;
  
  // Color signatures
  redDominance: number;         // R - (G+B)/2 in linear space
  rgRatio: number;              // R/G ratio
  redGreenDiff: number;         // (R-G)/(R+G+B)
  
  // Coverage (critical for finger detection)
  totalCoverage: number;        // 0-1 valid pixel ratio
  centerCoverage: number;       // 0-1 center region coverage
  centerOccupancy: number;      // 0-1 center actually occupied
  
  // Shape & Spatial
  spatialUniformity: number;    // 0-1 uniformity score
  circularity: number;          // Shape compactness
  
  // Texture & Quality
  entropy: number;              // Texture entropy
  variance: number;             // Signal variance
  edgeMagnitude: number;        // Edge/gradient info
  
  // Clipping (indicates pressure/saturation)
  clipHighRatio: number;        // Saturated pixels
  clipLowRatio: number;         // Dark/clipped pixels
  
  // Temporal
  temporalStability: number;    // Frame-to-frame stability
  
  // Motion
  motionScore: number;          // 0-1 motion contamination
  motionVariance: number;       // Variance due to motion
}

// ═══════════════════════════════════════════════════════════════════
//  PRESSURE PROXY ESTIMATION
// ═══════════════════════════════════════════════════════════════════

export interface PressureEstimate {
  level: 'LOW' | 'OPTIMAL' | 'HIGH' | 'EXCESSIVE';
  proxyValue: number;           // 0-1 composite score
  saturationIndicator: number;  // High clipping ratio
  varianceDropIndicator: number; // Reduced variance (compressed)
  morphologicalCompression: number; // Change in spatial pattern
  confidence: number;           // 0-1 confidence in estimate
}

// ═══════════════════════════════════════════════════════════════════
//  CLASSIFICATION RESULT
// ═══════════════════════════════════════════════════════════════════

export interface ContactClassification {
  state: ContactState;
  confidence: number;           // 0-1 overall confidence
  features: ContactFeatures;
  pressureEstimate: PressureEstimate;
  guidance: string;             // User guidance message
  stateDuration: number;        // Frames in current state
  stabilityScore: number;       // 0-1 temporal stability
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface ClassifierConfig {
  // Coverage thresholds
  minTotalCoverage: number;     // Minimum for any finger detection
  minCenterCoverage: number;      // Minimum for "good" contact
  
  // Color thresholds
  minRedDominance: number;        // For finger signature
  minRGRatio: number;             // R/G ratio minimum
  
  // Clipping thresholds
  maxClipHighRatio: number;       // For pressure detection
  maxClipLowRatio: number;        // For darkness detection
  
  // Temporal hysteresis
  stateTransitionDelay: number;   // Frames before state change
  minStateDuration: number;       // Minimum frames in state
  
  // Pressure proxy
  pressureSaturationThreshold: number;
  pressureVarianceDropThreshold: number;
}

const DEFAULT_CONFIG: ClassifierConfig = {
  minTotalCoverage: 0.15,
  minCenterCoverage: 0.30,
  minRedDominance: 0.02,        // In linear space
  minRGRatio: 1.05,
  maxClipHighRatio: 0.25,
  maxClipLowRatio: 0.20,
  stateTransitionDelay: 5,      // ~150ms at 30fps
  minStateDuration: 3,
  pressureSaturationThreshold: 0.15,
  pressureVarianceDropThreshold: 0.3,
};

// ═══════════════════════════════════════════════════════════════════
//  CLASSIFIER CLASS
// ═══════════════════════════════════════════════════════════════════

export class FingerContactClassifier {
  private config: ClassifierConfig;
  private stateHistory: ContactState[] = [];
  private featureHistory: ContactFeatures[] = [];
  private readonly HISTORY_SIZE = 15;  // ~500ms history
  private currentStateDuration = 0;
  private pendingState: ContactState | null = null;
  private pendingStateCount = 0;
  private lastClassification: ContactClassification | null = null;
  
  // Pressure proxy tracking
  private baselineVariance: number | null = null;
  private varianceHistory: number[] = [];

  constructor(config: Partial<ClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ═════════════════════════════════════════════════════════════════
  //  FEATURE EXTRACTION FROM RADIOMETRIC TILES
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Extract contact features from radiometric tile metrics
   * This is the preferred method - uses pre-computed radiometric data
   */
  extractFeaturesFromTiles(
    tiles: RadiometricTileMetrics[],
    motionScore: number = 0
  ): ContactFeatures {
    // Filter valid tiles
    const validTiles = tiles.filter(t => t.isValid);
    
    if (validTiles.length === 0) {
      return this.getDefaultFeatures(motionScore);
    }
    
    // Compute weighted averages by quality score
    let totalWeight = 0;
    let sumLinearR = 0, sumLinearG = 0, sumLinearB = 0;
    let sumODR = 0, sumODG = 0, sumODB = 0;
    let sumVariance = 0, sumEntropy = 0, sumEdgeMag = 0;
    let sumClipHigh = 0, sumClipLow = 0;
    let sumRedDom = 0, sumRGRatio = 0, sumRedGreenDiff = 0;
    
    // For center coverage calculation
    const centerIndices = this.getCenterTileIndices(Math.sqrt(tiles.length) | 0);
    let centerValidCount = 0;
    
    validTiles.forEach((tile, idx) => {
      const weight = tile.qualityScore;
      totalWeight += weight;
      
      sumLinearR += tile.linearR * weight;
      sumLinearG += tile.linearG * weight;
      sumLinearB += tile.linearB * weight;
      sumODR += tile.odR * weight;
      sumODG += tile.odG * weight;
      sumODB += tile.odB * weight;
      sumVariance += tile.variance * weight;
      sumEntropy += tile.entropy * weight;
      sumEdgeMag += tile.edgeMagnitude * weight;
      sumClipHigh += tile.clipHighRatio * weight;
      sumClipLow += tile.clipLowRatio * weight;
      sumRedDom += tile.redDominance * weight;
      sumRGRatio += tile.rgRatio * weight;
      sumRedGreenDiff += tile.redGreenDiff * weight;
      
      if (centerIndices.includes(idx) && tile.isValid) {
        centerValidCount++;
      }
    });
    
    const normWeight = totalWeight > 0 ? totalWeight : 1;
    
    const avgLinearR = sumLinearR / normWeight;
    const avgLinearG = sumLinearG / normWeight;
    const avgLinearB = sumLinearB / normWeight;
    
    // Coverage metrics
    const totalCoverage = validTiles.length / tiles.length;
    const centerCoverage = centerValidCount / centerIndices.length;
    const centerOccupancy = centerValidCount > 0 ? 1 : 0; // Binary for now
    
    // Spatial uniformity (from tile score variance)
    const scores = validTiles.map(t => t.qualityScore);
    const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const scoreVariance = scores.reduce((a, s) => a + (s - meanScore) ** 2, 0) / scores.length;
    const spatialUniformity = Math.max(0, 1 - scoreVariance);
    
    // Temporal stability (compare with history)
    const temporalStability = this.computeTemporalStability({
      linearMeanR: avgLinearR,
      linearMeanG: avgLinearG,
      linearMeanB: avgLinearB,
      totalCoverage,
    });
    
    return {
      linearMeanR: avgLinearR,
      linearMeanG: avgLinearG,
      linearMeanB: avgLinearB,
      odMeanR: sumODR / normWeight,
      odMeanG: sumODG / normWeight,
      odMeanB: sumODB / normWeight,
      redDominance: sumRedDom / normWeight,
      rgRatio: sumRGRatio / normWeight,
      redGreenDiff: sumRedGreenDiff / normWeight,
      totalCoverage,
      centerCoverage,
      centerOccupancy,
      spatialUniformity,
      circularity: totalCoverage, // Simplified
      entropy: sumEntropy / normWeight,
      variance: sumVariance / normWeight,
      edgeMagnitude: sumEdgeMag / normWeight,
      clipHighRatio: sumClipHigh / normWeight,
      clipLowRatio: sumClipLow / normWeight,
      temporalStability,
      motionScore,
      motionVariance: motionScore > 0.5 ? sumVariance / normWeight * motionScore : 0,
    };
  }
  
  private getCenterTileIndices(gridSize: number): number[] {
    // Center 3x3 for 5x5 or 7x7 grid
    if (gridSize === 5) {
      return [6, 7, 8, 11, 12, 13, 16, 17, 18];
    } else if (gridSize === 7) {
      return [16, 17, 18, 23, 24, 25, 30, 31, 32];
    }
    // Generic: center 3x3
    const center = Math.floor(gridSize / 2);
    const indices: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        indices.push((center + dy) * gridSize + (center + dx));
      }
    }
    return indices;
  }
  
  private getDefaultFeatures(motionScore: number): ContactFeatures {
    return {
      linearMeanR: 0, linearMeanG: 0, linearMeanB: 0,
      odMeanR: 0, odMeanG: 0, odMeanB: 0,
      redDominance: 0, rgRatio: 0, redGreenDiff: 0,
      totalCoverage: 0, centerCoverage: 0, centerOccupancy: 0,
      spatialUniformity: 0, circularity: 0,
      entropy: 0, variance: 0, edgeMagnitude: 0,
      clipHighRatio: 0, clipLowRatio: 0,
      temporalStability: 0, motionScore, motionVariance: 0,
    };
  }
  
  private computeTemporalStability(current: Partial<ContactFeatures>): number {
    if (this.featureHistory.length === 0) return 1.0;
    
    const prev = this.featureHistory[this.featureHistory.length - 1];
    const dr = Math.abs((current.linearMeanR || 0) - prev.linearMeanR) / Math.max(0.01, prev.linearMeanR);
    const dg = Math.abs((current.linearMeanG || 0) - prev.linearMeanG) / Math.max(0.01, prev.linearMeanG);
    const db = Math.abs((current.linearMeanB || 0) - prev.linearMeanB) / Math.max(0.01, prev.linearMeanB);
    const dcov = Math.abs((current.totalCoverage || 0) - prev.totalCoverage);
    
    const instability = (dr + dg + db + dcov) / 4;
    return Math.max(0, Math.min(1, 1 - instability));
  }

  // ═════════════════════════════════════════════════════════════════
  //  PRESSURE PROXY ESTIMATION
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Estimate pressure proxy combining multiple indicators:
   * - High clipping ratio (saturation from pressure)
   * - Variance drop (morphological compression)
   * - Spatial pattern compression
   */
  estimatePressure(features: ContactFeatures): PressureEstimate {
    // Saturation indicator
    const saturationIndicator = Math.min(1, features.clipHighRatio / this.config.pressureSaturationThreshold);
    
    // Variance drop indicator (compared to baseline)
    if (this.baselineVariance === null && features.variance > 0) {
      this.baselineVariance = features.variance;
      this.varianceHistory = [features.variance];
    } else if (features.variance > 0) {
      this.varianceHistory.push(features.variance);
      if (this.varianceHistory.length > 30) this.varianceHistory.shift();
      
      // Update baseline as median of recent history
      const sorted = [...this.varianceHistory].sort((a, b) => a - b);
      this.baselineVariance = sorted[Math.floor(sorted.length / 2)];
    }
    
    let varianceDropIndicator = 0;
    if (this.baselineVariance && this.baselineVariance > 0 && features.variance > 0) {
      const ratio = features.variance / this.baselineVariance;
      varianceDropIndicator = Math.max(0, 1 - ratio);
    }
    
    // Morphological compression (from spatial uniformity changes)
    const morphologicalCompression = features.spatialUniformity > 0.8 && features.totalCoverage > 0.7 
      ? (features.spatialUniformity - 0.8) * 5  // Scale to 0-1
      : 0;
    
    // Composite pressure proxy (weighted combination)
    const proxyValue = Math.min(1,
      saturationIndicator * 0.4 +
      varianceDropIndicator * 0.35 +
      morphologicalCompression * 0.25
    );
    
    // Determine pressure level
    let level: PressureEstimate['level'];
    if (proxyValue > 0.8) level = 'EXCESSIVE';
    else if (proxyValue > 0.6) level = 'HIGH';
    else if (proxyValue > 0.3) level = 'OPTIMAL';
    else level = 'LOW';
    
    // Confidence based on data quality
    const confidence = Math.min(1, 
      features.totalCoverage * 0.4 +
      features.temporalStability * 0.3 +
      (features.variance > 0 ? 0.3 : 0)
    );
    
    return {
      level,
      proxyValue,
      saturationIndicator,
      varianceDropIndicator,
      morphologicalCompression,
      confidence,
    };
  }

  // ═════════════════════════════════════════════════════════════════
  //  MAIN CLASSIFICATION
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Classify contact state from features with temporal hysteresis
   */
  classify(features: ContactFeatures): ContactClassification {
    // Estimate pressure
    const pressureEstimate = this.estimatePressure(features);
    
    // Determine raw state from features
    const rawState = this.determineRawState(features, pressureEstimate);
    
    // Apply temporal hysteresis
    const finalState = this.applyTemporalHysteresis(rawState);
    
    // Compute confidence
    const confidence = this.computeConfidence(features, finalState, pressureEstimate);
    
    // Generate guidance
    const guidance = this.generateGuidance(finalState, features, pressureEstimate);
    
    // Compute stability score
    const stabilityScore = this.computeStabilityScore(finalState);
    
    // Update history
    this.updateHistory(features, finalState);
    
    const classification: ContactClassification = {
      state: finalState,
      confidence,
      features,
      pressureEstimate,
      guidance,
      stateDuration: this.currentStateDuration,
      stabilityScore,
    };
    
    this.lastClassification = classification;
    return classification;
  }
  
  private determineRawState(features: ContactFeatures, pressure: PressureEstimate): ContactState {
    // Priority 1: Motion contamination
    if (features.motionScore > 0.7) {
      return 'MOTION_CONTAMINATED';
    }
    
    // Priority 2: Excessive clipping (overpressure)
    if (features.clipHighRatio > this.config.maxClipHighRatio) {
      return 'EXCESSIVE_CLIPPING';
    }
    
    // Priority 3: Underilluminated
    if (features.clipLowRatio > this.config.maxClipLowRatio || 
        features.totalCoverage < 0.05) {
      return 'UNDERILLUMINATED';
    }
    
    // Priority 4: Pressure-based states
    if (pressure.level === 'EXCESSIVE') {
      return 'OVERPRESSURE';
    }
    
    // Priority 5: Coverage-based states
    const hasFingerSignature = 
      features.redDominance > this.config.minRedDominance &&
      features.rgRatio > this.config.minRGRatio;
    
    if (!hasFingerSignature || features.totalCoverage < this.config.minTotalCoverage) {
      return 'NO_FINGER';
    }
    
    if (features.totalCoverage >= this.config.minCenterCoverage &&
        features.centerCoverage >= 0.3 &&
        features.spatialUniformity >= 0.4) {
      return 'GOOD_CONTACT';
    }
    
    return 'PARTIAL_CONTACT';
  }
  
  private applyTemporalHysteresis(rawState: ContactState): ContactState {
    // If same as current, increment duration
    if (this.stateHistory.length > 0 && 
        this.stateHistory[this.stateHistory.length - 1] === rawState) {
      this.currentStateDuration++;
      this.pendingState = null;
      this.pendingStateCount = 0;
      return rawState;
    }
    
    // Different state - track as pending
    if (this.pendingState === rawState) {
      this.pendingStateCount++;
    } else {
      this.pendingState = rawState;
      this.pendingStateCount = 1;
    }
    
    // Only transition if pending long enough
    if (this.pendingStateCount >= this.config.stateTransitionDelay) {
      this.currentStateDuration = 1;
      return rawState;
    }
    
    // Stay in current state
    const currentState = this.stateHistory[this.stateHistory.length - 1] || 'NO_FINGER';
    this.currentStateDuration++;
    return currentState;
  }
  
  private computeConfidence(
    features: ContactFeatures, 
    state: ContactState,
    pressure: PressureEstimate
  ): number {
    // Base confidence from feature quality
    let confidence = 
      features.totalCoverage * 0.25 +
      features.spatialUniformity * 0.20 +
      features.temporalStability * 0.20 +
      (1 - features.motionScore) * 0.15 +
      (features.redDominance > 0 ? 0.1 : 0) +
      (state === 'GOOD_CONTACT' ? 0.1 : 0);
    
    // Pressure estimate adds confidence
    confidence += pressure.confidence * 0.1;
    
    // Penalize uncertain states
    if (state === 'PARTIAL_CONTACT' || state === 'UNSTABLE_CONTACT') {
      confidence *= 0.8;
    }
    
    return Math.min(1, Math.max(0, confidence));
  }
  
  private computeStabilityScore(state: ContactState): number {
    if (this.stateHistory.length < 3) return 0.5;
    
    const recent = this.stateHistory.slice(-5);
    const stateCount = recent.filter(s => s === state).length;
    const ratio = stateCount / recent.length;
    
    // Duration bonus
    const durationBonus = Math.min(0.3, this.currentStateDuration / 60);
    
    return Math.min(1, ratio * 0.7 + durationBonus);
  }
  
  private generateGuidance(
    state: ContactState, 
    features: ContactFeatures,
    pressure: PressureEstimate
  ): string {
    switch (state) {
      case 'NO_FINGER':
        if (features.totalCoverage < 0.1) {
          return 'COLOQUE SU DEDO SOBRE LA CÁMARA';
        } else if (features.redDominance < this.config.minRedDominance) {
          return 'ASEGÚRESE DE QUE SEA SU DEDO (DEBE SER ROJIZO)';
        }
        return 'COLOQUE SU DEDO SOBRE LA CÁMARA Y EL FLASH';
        
      case 'UNDERILLUMINATED':
        return 'ACTIVE EL FLASH O ACERQUE MÁS EL DEDO';
        
      case 'EXCESSIVE_CLIPPING':
      case 'OVERPRESSURE':
        return 'REDUZCA LA PRESIÓN DEL DEDO';
        
      case 'MOTION_CONTAMINATED':
        return 'MANTENGA EL DEDO COMPLETAMENTE QUIETO';
        
      case 'PARTIAL_CONTACT':
        if (features.centerCoverage < 0.3) {
          return 'CENTRE EL DEDO SOBRE LA CÁMARA';
        } else if (features.spatialUniformity < 0.4) {
          return 'APLIQUE PRESIÓN UNIFORME EN TODO EL DEDO';
        }
        return 'CUBRA MÁS ÁREA CON SU DEDO';
        
      case 'GOOD_CONTACT':
        if (pressure.level === 'HIGH') {
          return 'CONTACTO BUENO - LIGERA PRESIÓN ALTA';
        }
        return 'CONTACTO ÓPTIMO - MANTENGA ASÍ';
        
      case 'UNSTABLE_CONTACT':
        return 'CONTACTO INESTABLE - AJUSTE LIGERAMENTE';
        
      case 'STABLE_CONTACT':
        return 'CONTACTO ESTABLE - MEDICIÓN EN PROGRESO';
        
      default:
        return 'AJUSTE LA POSICIÓN DEL DEDO';
    }
  }
  
  private updateHistory(features: ContactFeatures, state: ContactState): void {
    this.featureHistory.push({ ...features });
    if (this.featureHistory.length > this.HISTORY_SIZE) {
      this.featureHistory.shift();
    }
    
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.HISTORY_SIZE) {
      this.stateHistory.shift();
    }
  }

  // ═════════════════════════════════════════════════════════════════
  //  UTILITY METHODS
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Get state distribution over history
   */
  getStateDistribution(): Record<ContactState, number> {
    const distribution: Partial<Record<ContactState, number>> = {};
    
    for (const state of this.stateHistory) {
      distribution[state] = (distribution[state] || 0) + 1;
    }
    
    // Fill missing states with 0
    const allStates: ContactState[] = [
      'NO_FINGER', 'PARTIAL_CONTACT', 'GOOD_CONTACT', 'OVERPRESSURE',
      'UNDERILLUMINATED', 'EXCESSIVE_CLIPPING', 'MOTION_CONTAMINATED',
      'UNSTABLE_CONTACT', 'STABLE_CONTACT', 'NO_CONTACT',
      'ACQUIRING_CONTACT', 'SATURATED_CONTACT', 'EXCESSIVE_PRESSURE',
      'LOW_PERFUSION_CONTACT', 'MOTION_CONTAMINATED_CONTACT'
    ];
    
    return Object.fromEntries(
      allStates.map(s => [s, distribution[s] || 0])
    ) as Record<ContactState, number>;
  }
  
  /**
   * Check if contact is stable enough for measurement
   */
  isStableForMeasurement(): boolean {
    const recent = this.stateHistory.slice(-10);
    const goodStates = recent.filter(s => 
      s === 'GOOD_CONTACT' || s === 'STABLE_CONTACT'
    ).length;
    return goodStates >= 7 && this.currentStateDuration > 30;
  }
  
  /**
   * Reset classifier state
   */
  reset(): void {
    this.stateHistory = [];
    this.featureHistory = [];
    this.currentStateDuration = 0;
    this.pendingState = null;
    this.pendingStateCount = 0;
    this.baselineVariance = null;
    this.varianceHistory = [];
    this.lastClassification = null;
  }
  
  /**
   * Get last classification
   */
  getLastClassification(): ContactClassification | null {
    return this.lastClassification;
  }
}
