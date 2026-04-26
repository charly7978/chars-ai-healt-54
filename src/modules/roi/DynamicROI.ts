/**
 * ROI DINÁMICO - FASE 1
 * 
 * Responsabilidades:
 * - ROI inicial central
 * - Ajuste por mapa de estabilidad
 * - Evitar bordes
 * - Rechazar píxeles saturados
 * - Rechazar píxeles con varianza extrema
 * - Mantener ROI lock cuando señal sea estable
 * - Recalcular si baja SQI/contactScore
 */

export interface ROIBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ROIMetrics {
  meanR: number;
  meanG: number;
  meanB: number;
  variance: number;
  saturationRatio: number;
  darkRatio: number;
  qualityScore: number;
}

export interface DynamicROIResult {
  roi: ROIBox;
  metrics: ROIMetrics;
  isLocked: boolean;
  lockReason: string;
  shouldRecalculate: boolean;
}

export interface DynamicROIConfig {
  initialFraction: number;
  minFraction: number;
  maxFraction: number;
  borderPadding: number;
  saturationThreshold: number;
  darkThreshold: number;
  maxVariance: number;
  minVariance: number;
  lockThreshold: number;
  unlockThreshold: number;
  stabilityFrames: number;
}

const DEFAULT_CONFIG: DynamicROIConfig = {
  initialFraction: 0.8,
  minFraction: 0.3,
  maxFraction: 0.95,
  borderPadding: 0.1,
  saturationThreshold: 250,
  darkThreshold: 10,
  maxVariance: 2000,
  minVariance: 50,
  lockThreshold: 0.7,
  unlockThreshold: 0.4,
  stabilityFrames: 30,
};

export class DynamicROI {
  private config: DynamicROIConfig;
  private currentROI: ROIBox;
  private lockedROI: ROIBox | null = null;
  private isLocked: boolean = false;
  private stabilityHistory: number[] = [];
  private qualityHistory: number[] = [];
  private frameCount: number = 0;
  
  private readonly SATURATION_THRESHOLD = 250;
  private readonly DARK_THRESHOLD = 10;

  constructor(imageWidth: number, imageHeight: number, config: Partial<DynamicROIConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // ROI inicial central
    const size = Math.min(imageWidth, imageHeight) * this.config.initialFraction;
    this.currentROI = {
      x: Math.floor((imageWidth - size) / 2),
      y: Math.floor((imageHeight - size) / 2),
      width: Math.floor(size),
      height: Math.floor(size),
    };
  }

  /**
   * Calcular métricas de ROI
   */
  private calculateROIMetrics(imageData: ImageData, roi: ROIBox): ROIMetrics {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    let sumR = 0, sumG = 0, sumB = 0;
    let sumSq = 0;
    let saturatedPixels = 0;
    let darkPixels = 0;
    let count = 0;
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        sumR += r;
        sumG += g;
        sumB += b;
        
        const mean = (r + g + b) / 3;
        sumSq += mean * mean;
        
        if (r >= this.SATURATION_THRESHOLD || g >= this.SATURATION_THRESHOLD || b >= this.SATURATION_THRESHOLD) {
          saturatedPixels++;
        }
        
        if (r <= this.DARK_THRESHOLD && g <= this.DARK_THRESHOLD && b <= this.DARK_THRESHOLD) {
          darkPixels++;
        }
        
        count++;
      }
    }
    
    const meanR = sumR / count;
    const meanG = sumG / count;
    const meanB = sumB / count;
    const mean = (meanR + meanG + meanB) / 3;
    const variance = (sumSq / count) - (mean * mean);
    const saturationRatio = saturatedPixels / count;
    const darkRatio = darkPixels / count;
    
    // Calcular quality score
    let qualityScore = 1;
    
    // Penalizar saturación
    qualityScore *= Math.max(0, 1 - saturationRatio * 5);
    
    // Penalizar muy oscuro
    qualityScore *= Math.max(0, 1 - darkRatio * 3);
    
    // Penalizar varianza extrema
    if (variance < this.config.minVariance || variance > this.config.maxVariance) {
      qualityScore *= 0.5;
    }
    
    // Bonus para brillo en rango
    if (mean >= 30 && mean <= 220) {
      qualityScore *= 1.1;
    }
    
    qualityScore = Math.max(0, Math.min(1, qualityScore));
    
    return {
      meanR,
      meanG,
      meanB,
      variance,
      saturationRatio,
      darkRatio,
      qualityScore,
    };
  }

  /**
   * Crear mapa de estabilidad espacial
   */
  private createStabilityMap(imageData: ImageData): Float32Array {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const mapSize = 16; // 16x16 grid
    const cellW = Math.ceil(w / mapSize);
    const cellH = Math.ceil(h / mapSize);
    const stabilityMap = new Float32Array(mapSize * mapSize);
    
    for (let cy = 0; cy < mapSize; cy++) {
      for (let cx = 0; cx < mapSize; cx++) {
        const startX = cx * cellW;
        const startY = cy * cellH;
        const endX = Math.min(startX + cellW, w);
        const endY = Math.min(startY + cellH, h);
        
        let sum = 0;
        let count = 0;
        let saturated = 0;
        let dark = 0;
        
        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (py * w + px) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            sum += (r + g + b) / 3;
            count++;
            
            if (r >= this.SATURATION_THRESHOLD || g >= this.SATURATION_THRESHOLD || b >= this.SATURATION_THRESHOLD) {
              saturated++;
            }
            if (r <= this.DARK_THRESHOLD && g <= this.DARK_THRESHOLD && b <= this.DARK_THRESHOLD) {
              dark++;
            }
          }
        }
        
        const mean = sum / count;
        const satRatio = saturated / count;
        const darkRatio = dark / count;
        
        // Score de estabilidad: brillo medio, sin saturación, sin muy oscuro
        let score = 0;
        if (mean >= 30 && mean <= 220) score += 0.4;
        if (satRatio < 0.05) score += 0.3;
        if (darkRatio < 0.1) score += 0.3;
        
        stabilityMap[cy * mapSize + cx] = score;
      }
    }
    
    return stabilityMap;
  }

  /**
   * Encontrar mejor ROI basado en mapa de estabilidad
   */
  private findBestROI(stabilityMap: Float32Array, imageWidth: number, imageHeight: number): ROIBox {
    const mapSize = 16;
    const cellW = Math.ceil(imageWidth / mapSize);
    const cellH = Math.ceil(imageHeight / mapSize);
    
    // Buscar región con mayor estabilidad acumulada
    let bestScore = 0;
    let bestCx = 0, bestCy = 0;
    const roiCells = Math.floor(mapSize * this.config.initialFraction);
    
    for (let cy = 0; cy < mapSize - roiCells; cy++) {
      for (let cx = 0; cx < mapSize - roiCells; cx++) {
        let score = 0;
        
        // Bonus por centralidad
        const centerX = mapSize / 2;
        const centerY = mapSize / 2;
        const dist = Math.sqrt((cx - centerX) ** 2 + (cy - centerY) ** 2);
        const centerBonus = Math.max(0, 1 - dist / (mapSize / 2));
        
        // Sumar scores de celdas en el ROI
        for (let dy = 0; dy < roiCells; dy++) {
          for (let dx = 0; dx < roiCells; dx++) {
            score += stabilityMap[(cy + dy) * mapSize + (cx + dx)];
          }
        }
        
        score += centerBonus * roiCells * roiCells * 0.2;
        
        if (score > bestScore) {
          bestScore = score;
          bestCx = cx;
          bestCy = cy;
        }
      }
    }
    
    // Convertir a coordenadas de píxeles
    const roiW = roiCells * cellW;
    const roiH = roiCells * cellH;
    const x = bestCx * cellW;
    const y = bestCy * cellH;
    
    // Aplicar padding de bordes
    const paddingX = Math.floor(imageWidth * this.config.borderPadding);
    const paddingY = Math.floor(imageHeight * this.config.borderPadding);
    
    return {
      x: Math.max(paddingX, Math.min(imageWidth - roiW - paddingX, x)),
      y: Math.max(paddingY, Math.min(imageHeight - roiH - paddingY, y)),
      width: roiW,
      height: roiH,
    };
  }

  /**
   * Verificar si el ROI debe recalcularse
   */
  private shouldRecalculate(quality: number, contactScore: number): boolean {
    if (this.isLocked) {
      // Si está lockeado, desbloquear si la calidad baja significativamente
      return quality < this.config.unlockThreshold;
    }
    
    // Si no está lockeado, recalcular si la calidad es baja
    return quality < this.config.lockThreshold;
  }

  /**
   * Procesar frame y actualizar ROI
   */
  process(imageData: ImageData, contactScore: number): DynamicROIResult {
    this.frameCount++;
    
    // Calcular métricas del ROI actual
    const metrics = this.calculateROIMetrics(imageData, this.currentROI);
    
    // Actualizar historiales
    this.qualityHistory.push(metrics.qualityScore);
    if (this.qualityHistory.length > this.config.stabilityFrames) {
      this.qualityHistory.shift();
    }
    
    // Calcular estabilidad promedio
    const avgQuality = this.qualityHistory.length > 0
      ? this.qualityHistory.reduce((a, b) => a + b, 0) / this.qualityHistory.length
      : 0;
    
    // Determinar si debe recalcular
    const needsRecalc = this.shouldRecalculate(avgQuality, contactScore);
    
    let lockReason = '';
    
    if (this.isLocked) {
      if (needsRecalc) {
        this.isLocked = false;
        this.lockedROI = null;
        lockReason = 'Desbloqueado por baja calidad';
      } else {
        lockReason = 'ROI lockeado estable';
      }
    } else {
      if (avgQuality >= this.config.lockThreshold && this.qualityHistory.length >= this.config.stabilityFrames) {
        this.isLocked = true;
        this.lockedROI = { ...this.currentROI };
        lockReason = 'ROI lockeado por estabilidad';
      } else {
        lockReason = 'ROI ajustándose...';
      }
    }
    
    // Si no está lockeado o debe recalcular, buscar mejor ROI
    if (!this.isLocked || needsRecalc) {
      const stabilityMap = this.createStabilityMap(imageData);
      const newROI = this.findBestROI(stabilityMap, imageData.width, imageData.height);
      
      // Suavizar transición
      const alpha = 0.3;
      this.currentROI = {
        x: Math.round(this.currentROI.x * (1 - alpha) + newROI.x * alpha),
        y: Math.round(this.currentROI.y * (1 - alpha) + newROI.y * alpha),
        width: Math.round(this.currentROI.width * (1 - alpha) + newROI.width * alpha),
        height: Math.round(this.currentROI.height * (1 - alpha) + newROI.height * alpha),
      };
    }
    
    return {
      roi: this.currentROI,
      metrics,
      isLocked: this.isLocked,
      lockReason,
      shouldRecalculate: needsRecalc,
    };
  }

  /**
   * Forzar recálculo de ROI
   */
  forceRecalculate(): void {
    this.isLocked = false;
    this.lockedROI = null;
    this.qualityHistory = [];
  }

  /**
   * Obtener ROI actual
   */
  getCurrentROI(): ROIBox {
    return { ...this.currentROI };
  }

  /**
   * Obtener ROI lockeado (si existe)
   */
  getLockedROI(): ROIBox | null {
    return this.lockedROI ? { ...this.lockedROI } : null;
  }

  /**
   * Verificar si está lockeado
   */
  isROILocked(): boolean {
    return this.isLocked;
  }

  /**
   * Resetear ROI
   */
  reset(imageWidth: number, imageHeight: number): void {
    const size = Math.min(imageWidth, imageHeight) * this.config.initialFraction;
    this.currentROI = {
      x: Math.floor((imageWidth - size) / 2),
      y: Math.floor((imageHeight - size) / 2),
      width: Math.floor(size),
      height: Math.floor(size),
    };
    this.lockedROI = null;
    this.isLocked = false;
    this.stabilityHistory = [];
    this.qualityHistory = [];
    this.frameCount = 0;
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<DynamicROIConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): DynamicROIConfig {
    return { ...this.config };
  }
}
