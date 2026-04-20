/**
 * ADAPTIVE ROI MASK V3 - ADVANCED TILE SYSTEM
 * 
 * Sistema avanzado de tiles con:
 * 1. Grilla configurable 7x7 o 9x9 según resolución efectiva
 * 2. Cálculo completo de métricas por tile (RGB, absorbancia, clipping, scores)
 * 3. Máscara gruesa de contacto y máscara fina de extracción
 * 4. Bounding box, centroide, elipse o peso radial
 * 5. Penalización de tiles que cambian violentamente de válidos a inválidos
 * 6. Máscara fina ponderada que favorece tiles centrales, menor clipping, mayor coherencia temporal
 * 7. Devuelve tileWeights, connectedComponentArea, centroid, boundingBox, extractionMaskConfidence
 */

import type { TileData } from './TileFusionEngine';
import type { RadiometricProcessor } from './RadiometricProcessor';

export interface AdvancedTileMetrics {
  // Métricas básicas RGB
  meanR: number;
  meanG: number;
  meanB: number;
  
  // Métricas cromáticas
  redDominance: number;
  rgRatio: number;
  normalizedR: number;
  normalizedG: number;
  normalizedB: number;
  ycbcrY: number;
  ycbcrCb: number;
  ycbcrCr: number;
  
  // Métricas de calidad
  intensity: number;
  clipHighPct: number;
  clipLowPct: number;
  validPixels: number;
  totalPixels: number;
  
  // Absorbancia preliminar
  absorbR: number;
  absorbG: number;
  absorbB: number;
  
  // Scores
  chromaticScore: number;
  geometricScore: number;
  temporalScore: number;
  clippingScore: number;
  finalScore: number;
  
  // Posición y peso
  x: number;
  y: number;
  centerBias: number;
  weight: number;
  
  // Estado
  valid: boolean;
  inContactMask: boolean;
  inExtractionMask: boolean;
  
  // Radiometric (opcional)
  meanRLin?: number;
  meanGLin?: number;
  meanBLin?: number;
  odR?: number;
  odG?: number;
  odB?: number;
}

export interface ROIMaskResult {
  // Señales RGB (compatibilidad)
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  linRed: number;
  linGreen: number;
  linBlue: number;
  odR: number;
  odG: number;
  odB: number;
  
  // Métricas de cobertura
  coverageRatio: number;
  fingerScore: number;
  clipHighRatio: number;
  clipLowRatio: number;
  spatialUniformity: number;
  centerCoverage: number;
  brightness: number;
  brightnessVariance: number;
  validPixelCount: number;
  totalPixelCount: number;
  
  // Nuevas métricas avanzadas
  tileWeights: Float64Array;
  connectedComponentArea: number;
  centroid: { x: number; y: number };
  boundingBox: { x: number; y: number; width: number; height: number };
  extractionMaskConfidence: number;
  temporalMaskStability: number;
  
  // Datos de tiles
  tileScores: Float64Array;
  tileData: TileData[];
  tileMetrics: AdvancedTileMetrics[];
  
  // Máscaras
  contactMask: Uint8Array;
  extractionMask: Uint8Array;
}

export interface ROIMaskConfig {
  gridSize: 7 | 9;
  clipHighThreshold: number;
  clipLowThreshold: number;
  minValidPixelsPerTile: number;
  temporalStabilityWindow: number;
  centerBiasStrength: number;
  enableRadiometric: boolean;
}

export class AdaptiveROIMask {
  private config: ROIMaskConfig;
  private grid: number;
  private totalTiles: number;
  
  // Buffers reutilizables
  private tileConfidence: Float64Array;
  private prevMaskValid: Uint8Array;
  private tileR: Float64Array;
  private tileG: Float64Array;
  private tileB: Float64Array;
  private tileCount: Int32Array;
  private tileClipHigh: Int32Array;
  private tileClipLow: Int32Array;
  private tileValid: Int32Array;
  private tileMetrics: AdvancedTileMetrics[];
  
  private frameCount = 0;
  private radiometric: RadiometricProcessor | null = null;
  private maskChangeHistory: number[] = [];
  
  constructor(config: Partial<ROIMaskConfig> = {}) {
    this.config = {
      gridSize: 7,
      clipHighThreshold: 250,
      clipLowThreshold: 5,
      minValidPixelsPerTile: 3,
      temporalStabilityWindow: 5,
      centerBiasStrength: 1.4,
      enableRadiometric: false,
      ...config
    };
    
    this.grid = this.config.gridSize;
    this.totalTiles = this.grid * this.grid;
    
    // Inicializar buffers
    this.tileConfidence = new Float64Array(this.totalTiles);
    this.prevMaskValid = new Uint8Array(this.totalTiles).fill(0);
    this.tileR = new Float64Array(this.totalTiles);
    this.tileG = new Float64Array(this.totalTiles);
    this.tileB = new Float64Array(this.totalTiles);
    this.tileCount = new Int32Array(this.totalTiles);
    this.tileClipHigh = new Int32Array(this.totalTiles);
    this.tileClipLow = new Int32Array(this.totalTiles);
    this.tileValid = new Int32Array(this.totalTiles);
    this.tileMetrics = new Array(this.totalTiles);
    
    // Inicializar métricas de tiles
    for (let i = 0; i < this.totalTiles; i++) {
      this.tileMetrics[i] = this.createEmptyTileMetrics(i);
    }
  }

  /**
   * Crear métricas vacías para tile
   */
  private createEmptyTileMetrics(index: number): AdvancedTileMetrics {
    const x = index % this.grid;
    const y = Math.floor(index / this.grid);
    
    return {
      meanR: 0,
      meanG: 0,
      meanB: 0,
      redDominance: 0,
      rgRatio: 0,
      normalizedR: 0,
      normalizedG: 0,
      normalizedB: 0,
      ycbcrY: 0,
      ycbcrCb: 0,
      ycbcrCr: 0,
      intensity: 0,
      clipHighPct: 0,
      clipLowPct: 0,
      validPixels: 0,
      totalPixels: 0,
      absorbR: 0,
      absorbG: 0,
      absorbB: 0,
      chromaticScore: 0,
      geometricScore: 0,
      temporalScore: 0,
      clippingScore: 0,
      finalScore: 0,
      x,
      y,
      centerBias: 0,
      weight: 0,
      valid: false,
      inContactMask: false,
      inExtractionMask: false
    };
  }

  /** Optional radiometric processor for end-to-end Beer-Lambert pipeline */
  setRadiometricProcessor(rp: RadiometricProcessor | null): void {
    this.radiometric = rp;
  }

  /**
   * Procesar imagen y generar máscaras avanzadas
   */
  process(imageData: ImageData): ROIMaskResult {
    this.frameCount++;
    
    // Reset accumulators
    this.tileR.fill(0);
    this.tileG.fill(0);
    this.tileB.fill(0);
    this.tileCount.fill(0);
    this.tileClipHigh.fill(0);
    this.tileClipLow.fill(0);
    this.tileValid.fill(0);

    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;

    // Central ROI: 80% de dimensión mínima
    const roiSize = Math.min(w, h) * 0.80;
    const sx = Math.floor((w - roiSize) / 2);
    const sy = Math.floor((h - roiSize) / 2);
    const ex = sx + Math.floor(roiSize);
    const ey = sy + Math.floor(roiSize);
    const roiW = ex - sx;
    const roiH = ey - sy;

    let totalPixels = 0;
    let totalClipHigh = 0;
    let totalClipLow = 0;

    // Samplear cada 2do pixel para rendimiento
    const step = 2;
    for (let y = sy; y < ey; y += step) {
      const rowOff = y * w;
      for (let x = sx; x < ex; x += step) {
        const i = (rowOff + x) << 2;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const tileX = Math.min(this.grid - 1, Math.floor((x - sx) * this.grid / roiW));
        const tileY = Math.min(this.grid - 1, Math.floor((y - sy) * this.grid / roiH));
        const ti = tileY * this.grid + tileX;

        totalPixels++;

        // Check clipping
        const isClipHigh = r >= this.config.clipHighThreshold || g >= this.config.clipHighThreshold || b >= this.config.clipHighThreshold;
        const isClipLow = r <= this.config.clipLowThreshold && g <= this.config.clipLowThreshold && b <= this.config.clipLowThreshold;

        if (isClipHigh) {
          this.tileClipHigh[ti]++;
          totalClipHigh++;
        }
        if (isClipLow) {
          this.tileClipLow[ti]++;
          totalClipLow++;
        }

        if (!isClipHigh && !isClipLow) {
          this.tileR[ti] += r;
          this.tileG[ti] += g;
          this.tileB[ti] += b;
          this.tileValid[ti]++;
        }
        this.tileCount[ti]++;
      }
    }

    // Calcular métricas por tile
    const allScores: number[] = [];
    
    for (let ti = 0; ti < this.totalTiles; ti++) {
      const cnt = this.tileValid[ti];
      const total = this.tileCount[ti];
      
      if (cnt === 0 || total === 0) {
        this.tileMetrics[ti] = this.createEmptyTileMetrics(ti);
        this.tileMetrics[ti].totalPixels = total;
        continue;
      }

      const meanR = this.tileR[ti] / cnt;
      const meanG = this.tileG[ti] / cnt;
      const meanB = this.tileB[ti] / cnt;
      const intensity = meanR + meanG + meanB;
      
      // Métricas cromáticas
      const redDominance = meanR - (meanG + meanB) / 2;
      const rgRatio = meanG > 1 ? meanR / meanG : 0;
      const totalIntensity = meanR + meanG + meanB || 1;
      const normalizedR = meanR / totalIntensity;
      const normalizedG = meanG / totalIntensity;
      const normalizedB = meanB / totalIntensity;
      
      // YCbCr
      const ycbcrY = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB;
      const ycbcrCb = -0.169 * meanR - 0.331 * meanG + 0.500 * meanB;
      const ycbcrCr = 0.500 * meanR - 0.419 * meanG - 0.081 * meanB;
      
      // Clipping
      const clipHighPct = this.tileClipHigh[ti] / total;
      const clipLowPct = this.tileClipLow[ti] / total;
      
      // Absorbancia preliminar
      const absorbR = normalizedR > 0.001 ? -Math.log(normalizedR) : 0;
      const absorbG = normalizedG > 0.001 ? -Math.log(normalizedG) : 0;
      const absorbB = normalizedB > 0.001 ? -Math.log(normalizedB) : 0;
      
      // Center bias
      const gx = ti % this.grid;
      const gy = Math.floor(ti / this.grid);
      const nx = this.grid > 1 ? gx / (this.grid - 1) : 0.5;
      const ny = this.grid > 1 ? gy / (this.grid - 1) : 0.5;
      const dist = Math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2);
      const centerBias = Math.max(0.2, 1 - dist * this.config.centerBiasStrength);
      
      // Scores
      const chromaticScore = this.calculateChromaticScore(redDominance, rgRatio, intensity);
      const geometricScore = centerBias;
      const clippingScore = 1 - Math.min(1, (clipHighPct + clipLowPct) * 5);
      
      // Score temporal (smoothed)
      const frameScore = (chromaticScore * 0.4 + geometricScore * 0.3 + clippingScore * 0.3);
      this.tileConfidence[ti] = this.tileConfidence[ti] * 0.7 + frameScore * 0.3;
      const temporalScore = this.tileConfidence[ti];
      
      // Score final
      const finalScore = (chromaticScore * 0.35 + geometricScore * 0.25 + temporalScore * 0.25 + clippingScore * 0.15);
      
      this.tileMetrics[ti] = {
        meanR, meanG, meanB,
        redDominance, rgRatio,
        normalizedR, normalizedG, normalizedB,
        ycbcrY, ycbcrCb, ycbcrCr,
        intensity,
        clipHighPct, clipLowPct,
        validPixels: cnt,
        totalPixels: total,
        absorbR, absorbG, absorbB,
        chromaticScore, geometricScore, temporalScore, clippingScore, finalScore,
        x: gx, y: gy,
        centerBias,
        weight: finalScore,
        valid: cnt >= this.config.minValidPixelsPerTile,
        inContactMask: false,
        inExtractionMask: false
      };
      
      allScores.push(finalScore);
    }

    // Thresholding adaptativo con percentiles
    allScores.sort((a, b) => a - b);
    const p50 = allScores.length > 0 ? allScores[Math.floor(allScores.length * 0.5)] : 0;
    const fingerThreshold = Math.max(0.25, p50 * 0.85);

    // Máscaras
    const contactMask = new Uint8Array(this.totalTiles);
    const extractionMask = new Uint8Array(this.totalTiles);
    let contactTileCount = 0;
    
    // Identificar tiles de contacto (máscara gruesa)
    for (let ti = 0; ti < this.totalTiles; ti++) {
      const m = this.tileMetrics[ti];
      const isContactTile = 
        m.valid &&
        m.finalScore > fingerThreshold &&
        m.meanR > 40 &&
        m.rgRatio > 1.05 &&
        m.intensity > 80 &&
        m.clipHighPct < 0.5 &&
        m.clipLowPct < 0.5;

      if (isContactTile) {
        contactMask[ti] = 1;
        m.inContactMask = true;
        contactTileCount++;
      }
    }
    
    // Penalizar tiles que cambian violentamente
    let maskChangeCount = 0;
    for (let ti = 0; ti < this.totalTiles; ti++) {
      if (contactMask[ti] !== this.prevMaskValid[ti]) {
        maskChangeCount++;
        // Penalizar tiles que flipan
        if (this.maskChangeHistory.length >= this.config.temporalStabilityWindow) {
          const recentChanges = this.maskChangeHistory.slice(-this.config.temporalStabilityWindow);
          const avgChanges = recentChanges.reduce((sum, val) => sum + val, 0) / recentChanges.length;
          if (avgChanges > 3) {
            this.tileMetrics[ti].finalScore *= 0.5;
          }
        }
      }
    }
    this.prevMaskValid.set(contactMask);
    this.maskChangeHistory.push(maskChangeCount);
    if (this.maskChangeHistory.length > 20) {
      this.maskChangeHistory.shift();
    }

    // Máscara fina ponderada (extracción)
    const validTiles = this.tileMetrics.filter(t => t.inContactMask);
    const connectedComponent = this.findConnectedComponent(validTiles);
    
    for (const tile of connectedComponent) {
      const ti = tile.x * this.grid + tile.y;
      extractionMask[ti] = 1;
      this.tileMetrics[ti].inExtractionMask = true;
    }

    // Calcular bounding box y centroide
    const { boundingBox, centroid, connectedComponentArea } = this.calculateGeometry(connectedComponent);

    // Calcular pesos para extracción
    const tileWeights = new Float64Array(this.totalTiles);
    for (let ti = 0; ti < this.totalTiles; ti++) {
      const m = this.tileMetrics[ti];
      if (m.inExtractionMask) {
        // Peso combinado: score * centerBias * (1 - clipping)
        tileWeights[ti] = m.finalScore * m.centerBias * m.clippingScore;
      }
    }

    // Calcular señales ponderadas
    const signals = this.calculateWeightedSignals(this.tileMetrics.filter(t => t.inExtractionMask), tileWeights);

    // Métricas de calidad de máscara
    const extractionMaskConfidence = validTiles.length > 0 
      ? validTiles.reduce((sum, t) => sum + t.finalScore, 0) / validTiles.length 
      : 0;
    
    const temporalMaskStability = this.maskChangeHistory.length > 0
      ? 1 - (this.maskChangeHistory.reduce((sum, val) => sum + val, 0) / this.maskChangeHistory.length) / this.totalTiles
      : 0.5;

    // TileData para compatibilidad
    const tileData: TileData[] = new Array(this.totalTiles);
    const tileScores = new Float64Array(this.totalTiles);
    for (let ti = 0; ti < this.totalTiles; ti++) {
      const m = this.tileMetrics[ti];
      tileScores[ti] = m.finalScore;
      tileData[ti] = {
        r: m.meanR,
        g: m.meanG,
        b: m.meanB,
        quality: Math.max(0, Math.min(1, m.finalScore)),
        coverage: m.validPixels / Math.max(1, m.totalPixels),
        temporalConfidence: Math.max(0, Math.min(1, m.temporalScore)),
        tileIndex: ti,
      };
    }

    return {
      ...signals,
      coverageRatio: contactTileCount / this.totalTiles,
      fingerScore: validTiles.length > 0 ? validTiles.reduce((sum, t) => sum + t.finalScore, 0) / validTiles.length : 0,
      clipHighRatio: totalPixels > 0 ? totalClipHigh / totalPixels : 0,
      clipLowRatio: totalPixels > 0 ? totalClipLow / totalPixels : 0,
      spatialUniformity: this.calculateSpatialUniformity(validTiles),
      centerCoverage: this.calculateCenterCoverage(extractionMask),
      brightness: validTiles.length > 0 ? validTiles.reduce((sum, t) => sum + t.intensity, 0) / validTiles.length : 0,
      brightnessVariance: this.calculateBrightnessVariance(validTiles),
      validPixelCount: this.tileValid.reduce((sum, val) => sum + val, 0),
      totalPixelCount: totalPixels,
      tileWeights,
      connectedComponentArea,
      centroid,
      boundingBox,
      extractionMaskConfidence,
      temporalMaskStability,
      tileScores,
      tileData,
      tileMetrics: this.tileMetrics,
      contactMask,
      extractionMask
    };
  }

  private calculateChromaticScore(redDominance: number, rgRatio: number, intensity: number): number {
    const redScore = Math.max(0, Math.min(1, (rgRatio - 1.0) / 0.8));
    const domScore = Math.max(0, Math.min(1, (redDominance - 5) / 40));
    const brightScore = Math.max(0, Math.min(1, (intensity - 80) / 300));
    return (redScore * 0.4 + domScore * 0.35 + brightScore * 0.25);
  }

  private findConnectedComponent(tiles: AdvancedTileMetrics[]): AdvancedTileMetrics[] {
    if (tiles.length === 0) return [];
    
    // BFS para encontrar componente conexa más grande
    const visited = new Set<string>();
    let largestComponent: AdvancedTileMetrics[] = [];
    
    for (const startTile of tiles) {
      if (visited.has(`${startTile.x},${startTile.y}`)) continue;
      
      const component: AdvancedTileMetrics[] = [];
      const queue = [startTile];
      visited.add(`${startTile.x},${startTile.y}`);
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        
        // Vecinos
        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 }
        ];
        
        for (const neighbor of neighbors) {
          const key = `${neighbor.x},${neighbor.y}`;
          if (!visited.has(key)) {
            const neighborTile = tiles.find(t => t.x === neighbor.x && t.y === neighbor.y);
            if (neighborTile) {
              visited.add(key);
              queue.push(neighborTile);
            }
          }
        }
      }
      
      if (component.length > largestComponent.length) {
        largestComponent = component;
      }
    }
    
    return largestComponent;
  }

  private calculateGeometry(tiles: AdvancedTileMetrics[]): {
    boundingBox: { x: number; y: number; width: number; height: number };
    centroid: { x: number; y: number };
    connectedComponentArea: number;
  } {
    if (tiles.length === 0) {
      return {
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        centroid: { x: 0, y: 0 },
        connectedComponentArea: 0
      };
    }

    const minX = Math.min(...tiles.map(t => t.x));
    const maxX = Math.max(...tiles.map(t => t.x));
    const minY = Math.min(...tiles.map(t => t.y));
    const maxY = Math.max(...tiles.map(t => t.y));

    const centroidX = tiles.reduce((sum, t) => sum + t.x, 0) / tiles.length;
    const centroidY = tiles.reduce((sum, t) => sum + t.y, 0) / tiles.length;

    return {
      boundingBox: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      },
      centroid: { x: centroidX, y: centroidY },
      connectedComponentArea: tiles.length
    };
  }

  private calculateWeightedSignals(tiles: AdvancedTileMetrics[], weights: Float64Array): {
    rawRed: number;
    rawGreen: number;
    rawBlue: number;
    linRed: number;
    linGreen: number;
    linBlue: number;
    odR: number;
    odG: number;
    odB: number;
  } {
    if (tiles.length === 0) {
      return { rawRed: 0, rawGreen: 0, rawBlue: 0, linRed: 0, linGreen: 0, linBlue: 0, odR: 0, odG: 0, odB: 0 };
    }

    let wR = 0, wG = 0, wB = 0, wTotal = 0;
    let wOdR = 0, wOdG = 0, wOdB = 0;

    for (const tile of tiles) {
      const ti = tile.x * this.grid + tile.y;
      const w = weights[ti] || tile.weight;
      wR += tile.meanR * w;
      wG += tile.meanG * w;
      wB += tile.meanB * w;
      wOdR += tile.absorbR * w;
      wOdG += tile.absorbG * w;
      wOdB += tile.absorbB * w;
      wTotal += w;
    }

    return {
      rawRed: wTotal > 0 ? wR / wTotal : 0,
      rawGreen: wTotal > 0 ? wG / wTotal : 0,
      rawBlue: wTotal > 0 ? wB / wTotal : 0,
      linRed: wTotal > 0 ? wR / wTotal : 0,
      linGreen: wTotal > 0 ? wG / wTotal : 0,
      linBlue: wTotal > 0 ? wB / wTotal : 0,
      odR: wTotal > 0 ? wOdR / wTotal : 0,
      odG: wTotal > 0 ? wOdG / wTotal : 0,
      odB: wTotal > 0 ? wOdB / wTotal : 0
    };
  }

  private calculateSpatialUniformity(tiles: AdvancedTileMetrics[]): number {
    if (tiles.length < 3) return 0;
    
    const scores = tiles.map(t => t.finalScore);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    
    return Math.max(0, Math.min(1, 1 - cv));
  }

  private calculateCenterCoverage(mask: Uint8Array): number {
    const centerIndices = this.getCenterIndices();
    const centerCount = centerIndices.filter(ti => mask[ti] === 1).length;
    return centerCount / centerIndices.length;
  }

  private getCenterIndices(): number[] {
    const center = Math.floor(this.grid / 2);
    const indices: number[] = [];
    
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = center + dx;
        const y = center + dy;
        if (x >= 0 && x < this.grid && y >= 0 && y < this.grid) {
          indices.push(y * this.grid + x);
        }
      }
    }
    
    return indices;
  }

  private calculateBrightnessVariance(tiles: AdvancedTileMetrics[]): number {
    if (tiles.length < 2) return 0;
    
    const intensities = tiles.map(t => t.intensity);
    const mean = intensities.reduce((a, b) => a + b, 0) / intensities.length;
    return intensities.reduce((a, s) => a + (s - mean) ** 2, 0) / intensities.length - mean * mean;
  }

  reset(): void {
    this.tileConfidence.fill(0);
    this.prevMaskValid.fill(0);
    this.frameCount = 0;
    this.maskChangeHistory = [];
    
    for (let i = 0; i < this.totalTiles; i++) {
      this.tileMetrics[i] = this.createEmptyTileMetrics(i);
    }
  }

  getGridSize(): number {
    return this.grid;
  }

  setGridSize(size: 7 | 9): void {
    this.config.gridSize = size;
    this.grid = size;
    this.totalTiles = size * size;
    // Re-inicializar buffers
    this.tileConfidence = new Float64Array(this.totalTiles);
    this.prevMaskValid = new Uint8Array(this.totalTiles).fill(0);
    this.tileR = new Float64Array(this.totalTiles);
    this.tileG = new Float64Array(this.totalTiles);
    this.tileB = new Float64Array(this.totalTiles);
    this.tileCount = new Int32Array(this.totalTiles);
    this.tileClipHigh = new Int32Array(this.totalTiles);
    this.tileClipLow = new Int32Array(this.totalTiles);
    this.tileValid = new Int32Array(this.totalTiles);
    this.tileMetrics = new Array(this.totalTiles);
    
    for (let i = 0; i < this.totalTiles; i++) {
      this.tileMetrics[i] = this.createEmptyTileMetrics(i);
    }
  }
}
