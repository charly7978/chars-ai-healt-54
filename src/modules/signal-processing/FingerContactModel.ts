/**
 * FINGER CONTACT MODEL - Detector multimétrica temporal robusto
 * 
 * Implementa detector de contacto por estados con 3 capas:
 * - Capa A: evidencia cromática (RGB, YCbCr, HSV)
 * - Capa B: evidencia geométrica/espacial (morfología, conectividad)
 * - Capa C: evidencia temporal (persistencia, histéresis)
 * 
 * Reemplaza umbrales RGB duros por modelo adaptativo temporal.
 */

export type ContactState = 
  | 'NO_CONTACT'
  | 'ACQUIRING_CONTACT' 
  | 'UNSTABLE_CONTACT'
  | 'STABLE_CONTACT'
  | 'SATURATED_CONTACT'
  | 'EXCESSIVE_PRESSURE';

export interface ChromaticEvidence {
  redDominance: number;
  rgRatio: number;
  normalizedR: number;
  normalizedG: number;
  normalizedB: number;
  ycbcrY: number;
  ycbcrCb: number;
  ycbcrCr: number;
  intensity: number;
  saturationHighRatio: number;
  saturationLowRatio: number;
  fingerLikelihood: number;
}

export interface GeometricEvidence {
  connectedComponentArea: number;
  centroidX: number;
  centroidY: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  spatialUniformity: number;
  centralDeviation: number;
  geometricScore: number;
}

export interface TemporalEvidence {
  chromaticConsistency: number;
  spatialStability: number;
  motionLevel: number;
  perfusionLevel: number;
  contactDuration: number;
  temporalScore: number;
}

export interface ContactModelResult {
  state: ContactState;
  confidence: number;
  chromaticEvidence: ChromaticEvidence;
  geometricEvidence: GeometricEvidence;
  temporalEvidence: TemporalEvidence;
  transitionReason: string;
  debugMetrics: {
    tilesEvaluated: number;
    validTiles: number;
    saturationRatio: number;
    clippingRatio: number;
  };
}

export class FingerContactModel {
  private stateHistory: ContactState[] = [];
  private chromaticHistory: ChromaticEvidence[] = [];
  private geometricHistory: GeometricEvidence[] = [];
  private stateEnterTime: number = 0;
  private lastTransitionTime: number = 0;
  private readonly maxHistoryLength = 30;
  private readonly stableContactMinDuration = 1500; // ms
  private readonly acquiringContactMinDuration = 800; // ms
  
  // Parámetros adaptativos por sesión
  private adaptiveThresholds = {
    redDominanceMin: 0.05,
    rgRatioMin: 1.2,
    intensityMin: 0.15,
    intensityMax: 0.95,
    saturationHighMax: 0.1,
    saturationLowMax: 0.05,
    minCoverage: 0.3,
    minSpatialUniformity: 0.6,
    maxCentralDeviation: 0.3,
    maxMotionLevel: 0.15,
    minPerfusion: 0.01
  };

  constructor() {
    this.stateHistory.push('NO_CONTACT');
    this.stateEnterTime = performance.now();
    this.lastTransitionTime = performance.now();
  }

  /**
   * Capa A: Evidencia cromática por tile
   */
  private calculateChromaticEvidence(tiles: Array<{r: number, g: number, b: number, valid: boolean}>): ChromaticEvidence {
    const validTiles = tiles.filter(t => t.valid);
    if (validTiles.length === 0) {
      return this.getEmptyChromaticEvidence();
    }

    // Calcular métricas cromáticas
    let redDominanceSum = 0;
    let rgRatioSum = 0;
    let intensitySum = 0;
    let saturationHigh = 0;
    let saturationLow = 0;
    let ySum = 0, cbSum = 0, crSum = 0;

    for (const tile of validTiles) {
      const { r, g, b } = tile;
      
      // Red dominance
      redDominanceSum += r - (g + b) * 0.5;
      
      // RG ratio
      rgRatioSum += g > 0 ? r / g : 0;
      
      // Intensidad total
      const intensity = r + g + b;
      intensitySum += intensity;
      
      // Saturación
      if (r > 0.97 || g > 0.97 || b > 0.97) saturationHigh++;
      if (r < 0.02 && g < 0.02 && b < 0.02) saturationLow++;
      
      // YCbCr
      ySum += 0.299 * r + 0.587 * g + 0.114 * b;
      cbSum += -0.169 * r - 0.331 * g + 0.500 * b;
      crSum += 0.500 * r - 0.419 * g - 0.081 * b;
    }

    const count = validTiles.length;
    const avgRedDominance = redDominanceSum / count;
    const avgRGRatio = rgRatioSum / count;
    const avgIntensity = intensitySum / count;
    const saturationHighRatio = saturationHigh / tiles.length;
    const saturationLowRatio = saturationLow / tiles.length;

    // Normalización cromática
    const totalIntensity = avgIntensity || 1;
    const normalizedR = tiles.reduce((sum, t) => sum + (t.r / totalIntensity), 0) / count;
    const normalizedG = tiles.reduce((sum, t) => sum + (t.g / totalIntensity), 0) / count;
    const normalizedB = tiles.reduce((sum, t) => sum + (t.b / totalIntensity), 0) / count;

    // Score de likelihood combinado
    const redDominanceScore = Math.max(0, Math.min(1, (avgRedDominance - this.adaptiveThresholds.redDominanceMin) / 0.2));
    const rgRatioScore = Math.max(0, Math.min(1, (avgRGRatio - this.adaptiveThresholds.rgRatioMin) / 2.0));
    const intensityScore = (avgIntensity >= this.adaptiveThresholds.intensityMin && avgIntensity <= this.adaptiveThresholds.intensityMax) ? 1 : 0;
    const saturationScore = 1 - Math.max(saturationHighRatio, saturationLowRatio) * 10;
    
    const fingerLikelihood = (redDominanceScore * 0.4 + rgRatioScore * 0.3 + intensityScore * 0.2 + saturationScore * 0.1);

    return {
      redDominance: avgRedDominance,
      rgRatio: avgRGRatio,
      normalizedR,
      normalizedG,
      normalizedB,
      ycbcrY: ySum / count,
      ycbcrCb: cbSum / count,
      ycbcrCr: crSum / count,
      intensity: avgIntensity,
      saturationHighRatio,
      saturationLowRatio,
      fingerLikelihood: Math.max(0, Math.min(1, fingerLikelihood))
    };
  }

  /**
   * Capa B: Evidencia geométrica/espacial
   */
  private calculateGeometricEvidence(tiles: Array<{r: number, g: number, b: number, valid: boolean, x: number, y: number}>): GeometricEvidence {
    const validTiles = tiles.filter(t => t.valid);
    if (validTiles.length === 0) {
      return this.getEmptyGeometricEvidence();
    }

    // Encontrar componente conexa dominante (simplificado)
    const centerX = tiles.reduce((sum, t) => sum + t.x, 0) / tiles.length;
    const centerY = tiles.reduce((sum, t) => sum + t.y, 0) / tiles.length;
    
    // Bounding box de tiles válidos
    const minX = Math.min(...validTiles.map(t => t.x));
    const maxX = Math.max(...validTiles.map(t => t.x));
    const minY = Math.min(...validTiles.map(t => t.y));
    const maxY = Math.max(...validTiles.map(t => t.y));
    
    const area = validTiles.length;
    const boundingBox = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };

    // Centralidad y uniformidad espacial
    const centroidX = validTiles.reduce((sum, t) => sum + t.x, 0) / area;
    const centroidY = validTiles.reduce((sum, t) => sum + t.y, 0) / area;
    
    const centralDeviation = Math.sqrt(
      validTiles.reduce((sum, t) => {
        const dx = t.x - centerX;
        const dy = t.y - centerY;
        return sum + dx * dx + dy * dy;
      }, 0) / area
    ) / Math.max(boundingBox.width, boundingBox.height);

    const spatialUniformity = 1 - centralDeviation;
    const geometricScore = spatialUniformity * (area / tiles.length) * (boundingBox.width * boundingBox.height > 4 ? 1 : 0.5);

    return {
      connectedComponentArea: area,
      centroidX,
      centroidY,
      boundingBox,
      spatialUniformity,
      centralDeviation,
      geometricScore: Math.max(0, Math.min(1, geometricScore))
    };
  }

  /**
   * Capa C: Evidencia temporal con histéresis
   */
  private calculateTemporalEvidence(chromatic: ChromaticEvidence, geometric: GeometricEvidence, motionScore: number): TemporalEvidence {
    const now = performance.now();
    const timeInState = now - this.stateEnterTime;
    
    // Consistencia cromática histórica
    let chromaticConsistency = 0.5;
    if (this.chromaticHistory.length > 0) {
      const recent = this.chromaticHistory.slice(-5);
      const avgLikelihood = recent.reduce((sum, h) => sum + h.fingerLikelihood, 0) / recent.length;
      chromaticConsistency = 1 - Math.abs(chromatic.fingerLikelihood - avgLikelihood);
    }

    // Estabilidad espacial histórica
    let spatialStability = 0.5;
    if (this.geometricHistory.length > 0) {
      const recent = this.geometricHistory.slice(-3);
      const avgCentroidX = recent.reduce((sum, h) => sum + h.centroidX, 0) / recent.length;
      const avgCentroidY = recent.reduce((sum, h) => sum + h.centroidY, 0) / recent.length;
      const deviation = Math.sqrt(
        Math.pow(geometric.centroidX - avgCentroidX, 2) + 
        Math.pow(geometric.centroidY - avgCentroidY, 2)
      );
      spatialStability = Math.max(0, 1 - deviation / 5);
    }

    // Nivel de perfusión (AC/DC ratio)
    const perfusionLevel = chromatic.fingerLikelihood * 0.1; // Estimación simple

    // Score temporal combinado
    const consistencyScore = (chromaticConsistency + spatialStability) / 2;
    const motionScoreNorm = 1 - Math.min(1, motionScore / this.adaptiveThresholds.maxMotionLevel);
    const temporalScore = consistencyScore * 0.5 + motionScoreNorm * 0.3 + (timeInState > 1000 ? 0.2 : 0);

    return {
      chromaticConsistency,
      spatialStability,
      motionLevel: motionScore,
      perfusionLevel,
      contactDuration: timeInState,
      temporalScore: Math.max(0, Math.min(1, temporalScore))
    };
  }

  /**
   * Máquina de estados con histéresis real
   */
  private updateState(chromatic: ChromaticEvidence, geometric: GeometricEvidence, temporal: TemporalEvidence): ContactState {
    const currentState = this.stateHistory[this.stateHistory.length - 1];
    const now = performance.now();
    let newState = currentState;
    let reason = '';

    // Condiciones de transición según estado actual
    switch (currentState) {
      case 'NO_CONTACT':
        if (chromatic.fingerLikelihood > 0.6 && geometric.geometricScore > 0.4) {
          newState = 'ACQUIRING_CONTACT';
          reason = 'Initial finger detection';
        }
        break;

      case 'ACQUIRING_CONTACT':
        if (temporal.contactDuration > this.acquiringContactMinDuration) {
          if (chromatic.fingerLikelihood > 0.7 && geometric.geometricScore > 0.6 && temporal.motionLevel < 0.2) {
            newState = 'UNSTABLE_CONTACT';
            reason = 'Contact stabilized';
          } else {
            newState = 'NO_CONTACT';
            reason = 'Contact lost during acquisition';
          }
        } else if (chromatic.fingerLikelihood < 0.3) {
          newState = 'NO_CONTACT';
          reason = 'Finger disappeared';
        }
        break;

      case 'UNSTABLE_CONTACT':
        if (temporal.contactDuration > this.stableContactMinDuration) {
          if (chromatic.fingerLikelihood > 0.8 && geometric.geometricScore > 0.7 && 
              temporal.motionLevel < this.adaptiveThresholds.maxMotionLevel && 
              temporal.chromaticConsistency > 0.7) {
            newState = 'STABLE_CONTACT';
            reason = 'Stable contact achieved';
          }
        } else if (chromatic.fingerLikelihood < 0.4 || geometric.geometricScore < 0.3) {
          newState = 'NO_CONTACT';
          reason = 'Contact lost during unstable phase';
        }
        
        // Detectar problemas específicos
        if (chromatic.saturationHighRatio > 0.3) {
          newState = 'SATURATED_CONTACT';
          reason = 'Saturation detected';
        } else if (chromatic.intensity > 0.9 && temporal.motionLevel < 0.1) {
          newState = 'EXCESSIVE_PRESSURE';
          reason = 'Excessive pressure detected';
        }
        break;

      case 'STABLE_CONTACT':
        // Mantener estado estable pero detectar degradación
        if (chromatic.fingerLikelihood < 0.5 || geometric.geometricScore < 0.4) {
          newState = 'UNSTABLE_CONTACT';
          reason = 'Contact quality degraded';
        } else if (chromatic.saturationHighRatio > 0.2) {
          newState = 'SATURATED_CONTACT';
          reason = 'Saturation during stable contact';
        } else if (chromatic.intensity > 0.85 && temporal.motionLevel < 0.05) {
          newState = 'EXCESSIVE_PRESSURE';
          reason = 'Excessive pressure during stable contact';
        }
        break;

      case 'SATURATED_CONTACT':
        if (chromatic.saturationHighRatio < 0.1 && chromatic.fingerLikelihood > 0.6) {
          newState = 'UNSTABLE_CONTACT';
          reason = 'Saturation resolved';
        } else if (chromatic.fingerLikelihood < 0.3) {
          newState = 'NO_CONTACT';
          reason = 'Contact lost after saturation';
        }
        break;

      case 'EXCESSIVE_PRESSURE':
        if (chromatic.intensity < 0.8 && chromatic.fingerLikelihood > 0.6) {
          newState = 'UNSTABLE_CONTACT';
          reason = 'Pressure normalized';
        } else if (chromatic.fingerLikelihood < 0.3) {
          newState = 'NO_CONTACT';
          reason = 'Contact lost after excessive pressure';
        }
        break;
    }

    // Actualizar historial si cambió el estado
    if (newState !== currentState) {
      this.stateHistory.push(newState);
      this.stateEnterTime = now;
      this.lastTransitionTime = now;
      
      // Limitar historial
      if (this.stateHistory.length > this.maxHistoryLength) {
        this.stateHistory.shift();
      }
    }

    return newState;
  }

  /**
   * Procesar frame y actualizar modelo de contacto
   */
  public processFrame(
    tiles: Array<{r: number, g: number, b: number, valid: boolean, x: number, y: number}>,
    motionScore: number
  ): ContactModelResult {
    // Capa A: Evidencia cromática
    const chromaticEvidence = this.calculateChromaticEvidence(tiles);
    
    // Capa B: Evidencia geométrica
    const geometricEvidence = this.calculateGeometricEvidence(tiles);
    
    // Capa C: Evidencia temporal
    const temporalEvidence = this.calculateTemporalEvidence(chromaticEvidence, geometricEvidence, motionScore);
    
    // Actualizar historiales
    this.chromaticHistory.push(chromaticEvidence);
    this.geometricHistory.push(geometricEvidence);
    
    if (this.chromaticHistory.length > this.maxHistoryLength) {
      this.chromaticHistory.shift();
      this.geometricHistory.shift();
    }
    
    // Máquina de estados
    const newState = this.updateState(chromaticEvidence, geometricEvidence, temporalEvidence);
    
    // Calcular confianza general
    const confidence = (
      chromaticEvidence.fingerLikelihood * 0.4 +
      geometricEvidence.geometricScore * 0.3 +
      temporalEvidence.temporalScore * 0.3
    );

    // Adaptar umbrales basados en la sesión
    this.adaptThresholds();

    return {
      state: newState,
      confidence: Math.max(0, Math.min(1, confidence)),
      chromaticEvidence,
      geometricEvidence,
      temporalEvidence,
      transitionReason: this.getTransitionReason(newState),
      debugMetrics: {
        tilesEvaluated: tiles.length,
        validTiles: tiles.filter(t => t.valid).length,
        saturationRatio: chromaticEvidence.saturationHighRatio,
        clippingRatio: chromaticEvidence.saturationLowRatio
      }
    };
  }

  /**
   * Adaptación automática de umbrales basada en estadísticas de la sesión
   */
  private adaptThresholds(): void {
    if (this.chromaticHistory.length < 10) return;

    const recent = this.chromaticHistory.slice(-20);
    const avgLikelihood = recent.reduce((sum, h) => sum + h.fingerLikelihood, 0) / recent.length;
    const stdLikelihood = Math.sqrt(
      recent.reduce((sum, h) => sum + Math.pow(h.fingerLikelihood - avgLikelihood, 2), 0) / recent.length
    );

    // Adaptar umbrales suavemente
    this.adaptiveThresholds.redDominanceMin = Math.max(0.02, Math.min(0.1, avgLikelihood * 0.3));
    this.adaptiveThresholds.rgRatioMin = Math.max(0.8, Math.min(1.5, avgLikelihood * 2));
  }

  private getTransitionReason(state: ContactState): string {
    return state; // Simplificado - en implementación real registrar razón específica
  }

  private getEmptyChromaticEvidence(): ChromaticEvidence {
    return {
      redDominance: 0,
      rgRatio: 0,
      normalizedR: 0,
      normalizedG: 0,
      normalizedB: 0,
      ycbcrY: 0,
      ycbcrCb: 0,
      ycbcrCr: 0,
      intensity: 0,
      saturationHighRatio: 0,
      saturationLowRatio: 0,
      fingerLikelihood: 0
    };
  }

  private getEmptyGeometricEvidence(): GeometricEvidence {
    return {
      connectedComponentArea: 0,
      centroidX: 0,
      centroidY: 0,
      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      spatialUniformity: 0,
      centralDeviation: 1,
      geometricScore: 0
    };
  }

  /**
   * Obtener estado actual para debug
   */
  public getCurrentState(): ContactState {
    return this.stateHistory[this.stateHistory.length - 1] || 'NO_CONTACT';
  }

  public getTimeInCurrentState(): number {
    return performance.now() - this.stateEnterTime;
  }

  public reset(): void {
    this.stateHistory = ['NO_CONTACT'];
    this.chromaticHistory = [];
    this.geometricHistory = [];
    this.stateEnterTime = performance.now();
    this.lastTransitionTime = performance.now();
  }
}
