/**
 * DETECCIÓN DE DEDO - FASE 1
 * 
 * Responsabilidades:
 * - Detectar contacto por múltiples criterios
 * - Estados claros: NO_FINGER, FINGER_DETECTED_UNSTABLE, FINGER_STABLE, SATURATED, TOO_DARK, MOTION_CONTAMINATED
 * - Brillo medio
 * - Varianza espacial
 * - Dominancia R/G
 * - Estabilidad temporal
 * - Saturación
 * - Oclusión de ambiente
 * - Textura/edge score
 */

export type FingerState = 
  | 'NO_FINGER'
  | 'FINGER_DETECTED_UNSTABLE'
  | 'FINGER_STABLE'
  | 'SATURATED'
  | 'TOO_DARK'
  | 'MOTION_CONTAMINATED';

export interface FingerDetectionResult {
  state: FingerState;
  contactScore: number;
  brightness: number;
  spatialVariance: number;
  redDominance: number;
  rgRatio: number;
  temporalStability: number;
  saturationRatio: number;
  ambientOcclusion: number;
  edgeScore: number;
  confidence: number;
  reason: string;
}

export interface FingerDetectionConfig {
  minBrightness: number;
  maxBrightness: number;
  minRedDominance: number;
  minRgRatio: number;
  maxSaturationRatio: number;
  minSpatialVariance: number;
  maxSpatialVariance: number;
  minTemporalStability: number;
  minContactScore: number;
  stableFramesThreshold: number;
  motionThreshold: number;
}

const DEFAULT_CONFIG: FingerDetectionConfig = {
  minBrightness: 30,
  maxBrightness: 220,
  minRedDominance: 5,
  minRgRatio: 1.05,
  maxSaturationRatio: 0.05,
  minSpatialVariance: 50,
  maxSpatialVariance: 2000,
  minTemporalStability: 0.4,
  minContactScore: 0.5,
  stableFramesThreshold: 30,
  motionThreshold: 0.6,
};

export class FingerDetection {
  private config: FingerDetectionConfig;
  private currentState: FingerState = 'NO_FINGER';
  private stableFrameCount: number = 0;
  private brightnessHistory: number[] = [];
  private contactScoreHistory: number[] = [];
  private previousFrame: ImageData | null = null;
  private motionScore: number = 0;
  
  private readonly HISTORY_SIZE = 60;
  private readonly SATURATION_THRESHOLD = 250;
  private readonly DARK_THRESHOLD = 10;

  constructor(config: Partial<FingerDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calcular brillo medio del frame
   */
  private calculateBrightness(imageData: ImageData): number {
    const data = imageData.data;
    let totalLum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLum += lum;
    }
    
    return totalLum / (data.length / 4);
  }

  /**
   * Calcular varianza espacial
   */
  private calculateSpatialVariance(imageData: ImageData): number {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    
    // Calcular media primero
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sum += (r + g + b) / 3;
    }
    const mean = sum / (data.length / 4);
    
    // Calcular varianza
    let variance = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const pixel = (r + g + b) / 3;
      variance += (pixel - mean) ** 2;
    }
    
    return variance / (data.length / 4);
  }

  /**
   * Calcular dominancia del canal rojo
   */
  private calculateRedDominance(imageData: ImageData): number {
    const data = imageData.data;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      redSum += data[i];
      greenSum += data[i + 1];
      blueSum += data[i + 2];
    }
    
    const count = data.length / 4;
    const meanR = redSum / count;
    const meanG = greenSum / count;
    const meanB = blueSum / count;
    
    return meanR - (meanG + meanB) / 2;
  }

  /**
   * Calcular ratio R/G
   */
  private calculateRgRatio(imageData: ImageData): number {
    const data = imageData.data;
    let redSum = 0;
    let greenSum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      redSum += data[i];
      greenSum += data[i + 1];
    }
    
    const count = data.length / 4;
    const meanR = redSum / count;
    const meanG = greenSum / count;
    
    return meanG > 1 ? meanR / meanG : 0;
  }

  /**
   * Calcular ratio de saturación
   */
  private calculateSaturationRatio(imageData: ImageData): number {
    const data = imageData.data;
    let saturatedPixels = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      if (r >= this.SATURATION_THRESHOLD || g >= this.SATURATION_THRESHOLD || b >= this.SATURATION_THRESHOLD) {
        saturatedPixels++;
      }
    }
    
    return saturatedPixels / (data.length / 4);
  }

  /**
   * Calcular ratio de píxeles muy oscuros
   */
  private calculateDarkRatio(imageData: ImageData): number {
    const data = imageData.data;
    let darkPixels = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      if (r <= this.DARK_THRESHOLD && g <= this.DARK_THRESHOLD && b <= this.DARK_THRESHOLD) {
        darkPixels++;
      }
    }
    
    return darkPixels / (data.length / 4);
  }

  /**
   * Calcular estabilidad temporal
   */
  private calculateTemporalStability(): number {
    if (this.brightnessHistory.length < 5) return 0;
    
    const recent = this.brightnessHistory.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + (val - mean) ** 2, 0) / recent.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    
    return Math.max(0, Math.min(1, 1 - cv * 3));
  }

  /**
   * Calcular oclusión de ambiente (cambio brusco de iluminación)
   */
  private calculateAmbientOcclusion(): number {
    if (this.brightnessHistory.length < 2) return 0;
    
    const current = this.brightnessHistory[this.brightnessHistory.length - 1];
    const previous = this.brightnessHistory[0];
    
    // Si el brillo aumentó significativamente, probablemente el dedo cubrió la cámara
    const increase = (current - previous) / (previous + 1);
    return Math.max(0, Math.min(1, increase * 2));
  }

  /**
   * Calcular score de bordes (textura)
   */
  private calculateEdgeScore(imageData: ImageData): number {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    
    // Usar Sobel simple para detectar bordes
    let edgeSum = 0;
    let edgeCount = 0;
    
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        
        // Gradiente horizontal
        const gx = 
          -data[((y - 1) * w + (x - 1)) * 4] +
          data[((y - 1) * w + (x + 1)) * 4] +
          -2 * data[(y * w + (x - 1)) * 4] +
          2 * data[(y * w + (x + 1)) * 4] +
          -data[((y + 1) * w + (x - 1)) * 4] +
          data[((y + 1) * w + (x + 1)) * 4];
        
        // Gradiente vertical
        const gy = 
          -data[((y - 1) * w + (x - 1)) * 4] +
          -2 * data[((y - 1) * w + x) * 4] +
          -data[((y - 1) * w + (x + 1)) * 4] +
          data[((y + 1) * w + (x - 1)) * 4] +
          2 * data[((y + 1) * w + x) * 4] +
          data[((y + 1) * w + (x + 1)) * 4];
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edgeSum += magnitude;
        edgeCount++;
      }
    }
    
    return edgeCount > 0 ? edgeSum / edgeCount : 0;
  }

  /**
   * Calcular score de movimiento comparando con frame anterior
   */
  private calculateMotionScore(imageData: ImageData): number {
    if (!this.previousFrame) {
      this.previousFrame = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      );
      return 0;
    }
    
    const current = imageData.data;
    const previous = this.previousFrame.data;
    let diffSum = 0;
    
    for (let i = 0; i < current.length; i += 4) {
      const dr = current[i] - previous[i];
      const dg = current[i + 1] - previous[i + 1];
      const db = current[i + 2] - previous[i + 2];
      diffSum += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
    }
    
    const avgDiff = diffSum / (current.length / 4);
    this.motionScore = Math.min(1, avgDiff / 30);
    
    // Actualizar frame anterior
    this.previousFrame = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
    
    return this.motionScore;
  }

  /**
   * Calcular score de contacto combinado
   */
  private calculateContactScore(
    brightness: number,
    spatialVariance: number,
    redDominance: number,
    rgRatio: number,
    temporalStability: number,
    saturationRatio: number,
    ambientOcclusion: number,
    edgeScore: number
  ): number {
    let score = 0;
    
    // Brillo en rango aceptable
    const brightnessScore = brightness >= this.config.minBrightness && brightness <= this.config.maxBrightness
      ? 1
      : Math.max(0, 1 - Math.abs(brightness - (this.config.minBrightness + this.config.maxBrightness) / 2) / 100);
    score += brightnessScore * 0.15;
    
    // Dominancia rojo
    const redScore = Math.max(0, Math.min(1, (redDominance - this.config.minRedDominance) / 40));
    score += redScore * 0.2;
    
    // Ratio R/G
    const rgScore = rgRatio >= this.config.minRgRatio ? 1 : Math.max(0, rgRatio / this.config.minRgRatio);
    score += rgScore * 0.15;
    
    // Varianza espacial (ni muy baja ni muy alta)
    const varianceScore = spatialVariance >= this.config.minSpatialVariance && 
      spatialVariance <= this.config.maxSpatialVariance
      ? 1
      : Math.max(0, 1 - Math.abs(spatialVariance - 500) / 1000);
    score += varianceScore * 0.1;
    
    // Estabilidad temporal
    score += temporalStability * 0.15;
    
    // Oclusión de ambiente
    score += ambientOcclusion * 0.1;
    
    // Score de bordes (textura de piel)
    const edgeScoreNorm = Math.min(1, edgeScore / 50);
    score += edgeScoreNorm * 0.05;
    
    // Penalización por saturación
    const saturationPenalty = Math.min(1, saturationRatio / this.config.maxSaturationRatio);
    score *= (1 - saturationPenalty * 0.5);
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Determinar estado del dedo
   */
  private determineState(
    brightness: number,
    saturationRatio: number,
    darkRatio: number,
    contactScore: number,
    motionScore: number
  ): { state: FingerState; reason: string } {
    // Verificar saturación primero
    if (saturationRatio > this.config.maxSaturationRatio) {
      return { state: 'SATURATED', reason: 'Saturación excesiva' };
    }
    
    // Verificar muy oscuro
    if (darkRatio > 0.3 || brightness < this.config.minBrightness) {
      return { state: 'TOO_DARK', reason: 'Brillo insuficiente' };
    }
    
    // Verificar movimiento
    if (motionScore > this.config.motionThreshold) {
      return { state: 'MOTION_CONTAMINATED', reason: 'Movimiento detectado' };
    }
    
    // Verificar contacto
    if (contactScore < this.config.minContactScore) {
      return { state: 'NO_FINGER', reason: 'Sin contacto suficiente' };
    }
    
    // Determinar si es estable o inestable
    if (this.stableFrameCount >= this.config.stableFramesThreshold) {
      return { state: 'FINGER_STABLE', reason: 'Dedo estable' };
    }
    
    return { state: 'FINGER_DETECTED_UNSTABLE', reason: 'Dedo detectado, estabilizando...' };
  }

  /**
   * Procesar frame y detectar estado del dedo
   */
  process(imageData: ImageData): FingerDetectionResult {
    // Calcular métricas
    const brightness = this.calculateBrightness(imageData);
    const spatialVariance = this.calculateSpatialVariance(imageData);
    const redDominance = this.calculateRedDominance(imageData);
    const rgRatio = this.calculateRgRatio(imageData);
    const saturationRatio = this.calculateSaturationRatio(imageData);
    const darkRatio = this.calculateDarkRatio(imageData);
    const edgeScore = this.calculateEdgeScore(imageData);
    const motionScore = this.calculateMotionScore(imageData);
    
    // Actualizar historiales
    this.brightnessHistory.push(brightness);
    if (this.brightnessHistory.length > this.HISTORY_SIZE) {
      this.brightnessHistory.shift();
    }
    
    const temporalStability = this.calculateTemporalStability();
    const ambientOcclusion = this.calculateAmbientOcclusion();
    
    // Calcular score de contacto
    const contactScore = this.calculateContactScore(
      brightness,
      spatialVariance,
      redDominance,
      rgRatio,
      temporalStability,
      saturationRatio,
      ambientOcclusion,
      edgeScore
    );
    
    this.contactScoreHistory.push(contactScore);
    if (this.contactScoreHistory.length > this.HISTORY_SIZE) {
      this.contactScoreHistory.shift();
    }
    
    // Determinar estado
    const { state, reason } = this.determineState(
      brightness,
      saturationRatio,
      darkRatio,
      contactScore,
      motionScore
    );
    
    // Actualizar contador de frames estables
    if (state === 'FINGER_STABLE' || state === 'FINGER_DETECTED_UNSTABLE') {
      this.stableFrameCount++;
    } else {
      this.stableFrameCount = Math.max(0, this.stableFrameCount - 3);
    }
    
    this.currentState = state;
    
    // Calcular confianza
    const confidence = state === 'FINGER_STABLE' 
      ? Math.min(1, this.stableFrameCount / this.config.stableFramesThreshold)
      : state === 'FINGER_DETECTED_UNSTABLE'
        ? Math.min(1, this.stableFrameCount / (this.config.stableFramesThreshold * 0.5))
        : 0;
    
    return {
      state,
      contactScore,
      brightness,
      spatialVariance,
      redDominance,
      rgRatio,
      temporalStability,
      saturationRatio,
      ambientOcclusion,
      edgeScore,
      confidence,
      reason,
    };
  }

  /**
   * Obtener estado actual
   */
  getCurrentState(): FingerState {
    return this.currentState;
  }

  /**
   * Obtener score de movimiento actual
   */
  getMotionScore(): number {
    return this.motionScore;
  }

  /**
   * Resetear detector
   */
  reset(): void {
    this.currentState = 'NO_FINGER';
    this.stableFrameCount = 0;
    this.brightnessHistory = [];
    this.contactScoreHistory = [];
    this.previousFrame = null;
    this.motionScore = 0;
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<FingerDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): FingerDetectionConfig {
    return { ...this.config };
  }
}
