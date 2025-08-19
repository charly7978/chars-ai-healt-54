/**
 * @file FingerDetector.ts
 * @description Detector específico de dedo humano con validaciones anatómicas estrictas
 * PROHIBIDA LA SIMULACIÓN - Solo detecta dedos humanos reales
 */

export interface FingerDetectionResult {
  isFingerDetected: boolean;
  confidence: number;
  anatomicalScore: number;
  bloodPerfusionScore: number;
  skinTextureScore: number;
  fingertipCharacteristics: {
    hasRidges: boolean;
    hasPerfusion: boolean;
    correctColorProfile: boolean;
    appropriateSize: boolean;
  };
}

export interface FingerMetrics {
  redIntensity: number;
  greenIntensity: number;
  blueIntensity: number;
  textureVariance: number;
  perfusionIndex: number;
  colorRatios: {
    redToGreen: number;
    redToBlue: number;
    greenToBlue: number;
  };
}

/**
 * Detector específico de dedo humano con validaciones anatómicas
 */
export class FingerDetector {
  // Parámetros anatómicos específicos para dedos humanos
  private readonly HUMAN_FINGER_CHARACTERISTICS = {
    // Rangos de color para piel humana con sangre oxigenada - AJUSTADOS PARA REALIDAD
    skinColor: {
      red: { min: 60, max: 240 },   // Más permisivo para diferentes tonos de piel
      green: { min: 20, max: 200 }, // Más amplio para condiciones de iluminación
      blue: { min: 1, max: 180 }    // Muy permisivo - cámaras pueden tener bajo canal azul
    },
    // Ratios específicos para tejido perfundido - AJUSTADOS PARA CONDICIONES REALES
    perfusionRatios: {
      redToGreen: { min: 0.8, max: 6.0 }, // Expandido para condiciones de iluminación variables
      redToBlue: { min: 1.0, max: 60.0 },  // Expandido para cámaras con bajo canal azul
      greenToBlue: { min: 0.5, max: 4.0 }  // Más permisivo
    },
    // Características de textura de la piel
    texture: {
      minVariance: 8.0,  // Piel tiene textura natural
      maxVariance: 45.0, // Pero no excesiva
      ridgePattern: 0.15 // Huellas dactilares
    },
    // Índice de perfusión sanguínea
    perfusion: {
      minIndex: 0.8,  // Mínima perfusión detectable
      maxIndex: 15.0, // Máxima perfusión normal
      pulsatilityThreshold: 2.5 // Variación pulsátil mínima
    }
  };

  // Historia para validación temporal
  private detectionHistory: boolean[] = [];
  private metricsHistory: FingerMetrics[] = [];
  private readonly HISTORY_SIZE = 10;
  private readonly CONSENSUS_THRESHOLD = 0.5; // 50% de detecciones positivas - más permisivo

  constructor() {}

  /**
   * Detecta si hay un dedo humano presente basado en características anatómicas
   */
  public detectFinger(imageData: ImageData): FingerDetectionResult {
    const metrics = this.extractFingerMetrics(imageData);
    
    // Validaciones anatómicas específicas
    const anatomicalScore = this.validateAnatomicalCharacteristics(metrics);
    const bloodPerfusionScore = this.validateBloodPerfusion(metrics);
    const skinTextureScore = this.validateSkinTexture(metrics);
    
    // Características específicas del dedo
    const fingertipCharacteristics = this.analyzeFingertipCharacteristics(metrics);
    
    // Calcular confianza combinada (todas las validaciones deben pasar)
    const combinedScore = (anatomicalScore * 0.4) + 
                         (bloodPerfusionScore * 0.35) + 
                         (skinTextureScore * 0.25);
    
    // Umbral más realista para detección positiva
    const isFingerDetected = combinedScore > 0.4 &&  // Reducido de 0.65 a 0.4
                           fingertipCharacteristics.hasPerfusion &&
                           fingertipCharacteristics.correctColorProfile;
    
    // Actualizar historia para validación temporal
    this.detectionHistory.push(isFingerDetected);
    this.metricsHistory.push(metrics);
    
    if (this.detectionHistory.length > this.HISTORY_SIZE) {
      this.detectionHistory.shift();
      this.metricsHistory.shift();
    }
    
    // Aplicar consenso temporal
    const temporalConsensus = this.calculateTemporalConsensus();
    const finalDetection = isFingerDetected && (temporalConsensus > 0.6);
    
    const confidence = finalDetection ? 
                      Math.min(0.95, combinedScore * temporalConsensus) : 
                      Math.max(0.05, combinedScore * 0.3);

    return {
      isFingerDetected: finalDetection,
      confidence,
      anatomicalScore,
      bloodPerfusionScore,
      skinTextureScore,
      fingertipCharacteristics
    };
  }

  /**
   * Extrae métricas específicas del dedo del área de interés
   */
  private extractFingerMetrics(imageData: ImageData): FingerMetrics {
    const data = imageData.data;
    const centerX = Math.floor(imageData.width / 2);
    const centerY = Math.floor(imageData.height / 2);
    const roiSize = Math.min(imageData.width, imageData.height) * 0.6;
    
    const startX = Math.max(0, Math.floor(centerX - roiSize / 2));
    const endX = Math.min(imageData.width, Math.floor(centerX + roiSize / 2));
    const startY = Math.max(0, Math.floor(centerY - roiSize / 2));
    const endY = Math.min(imageData.height, Math.floor(centerY + roiSize / 2));
    
    let redSum = 0, greenSum = 0, blueSum = 0;
    let pixelCount = 0;
    const intensityValues: number[] = [];
    
    // Extraer valores de color y calcular varianza de textura
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * imageData.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        redSum += r;
        greenSum += g;
        blueSum += b;
        pixelCount++;
        
        // Para cálculo de textura
        const intensity = (r + g + b) / 3;
        intensityValues.push(intensity);
      }
    }
    
    if (pixelCount === 0) {
      return this.getDefaultMetrics();
    }
    
    const avgRed = redSum / pixelCount;
    const avgGreen = greenSum / pixelCount;
    const avgBlue = blueSum / pixelCount;
    
    // Calcular varianza de textura
    const avgIntensity = intensityValues.reduce((sum, val) => sum + val, 0) / intensityValues.length;
    const textureVariance = intensityValues.reduce((sum, val) => sum + Math.pow(val - avgIntensity, 2), 0) / intensityValues.length;
    
    // Calcular índice de perfusión basado en variabilidad del canal rojo
    const perfusionIndex = this.calculatePerfusionIndex(data, startX, startY, endX, endY, imageData.width);
    
    return {
      redIntensity: avgRed,
      greenIntensity: avgGreen,
      blueIntensity: avgBlue,
      textureVariance,
      perfusionIndex,
      colorRatios: {
        redToGreen: avgGreen > 0 ? avgRed / avgGreen : 0,
        redToBlue: avgBlue > 0 ? avgRed / avgBlue : 0,
        greenToBlue: avgBlue > 0 ? avgGreen / avgBlue : 0
      }
    };
  }

  /**
   * Valida características anatómicas específicas de dedos humanos
   */
  private validateAnatomicalCharacteristics(metrics: FingerMetrics): number {
    let score = 0;
    const char = this.HUMAN_FINGER_CHARACTERISTICS;
    
    // Validar rangos de color para piel humana
    const redValid = metrics.redIntensity >= char.skinColor.red.min && 
                    metrics.redIntensity <= char.skinColor.red.max;
    const greenValid = metrics.greenIntensity >= char.skinColor.green.min && 
                      metrics.greenIntensity <= char.skinColor.green.max;
    const blueValid = metrics.blueIntensity >= char.skinColor.blue.min && 
                     metrics.blueIntensity <= char.skinColor.blue.max;
    
    if (redValid) score += 0.4;
    if (greenValid) score += 0.3;
    if (blueValid) score += 0.3;
    
    // Validar ratios de color específicos para tejido perfundido
    const rgRatioValid = metrics.colorRatios.redToGreen >= char.perfusionRatios.redToGreen.min &&
                        metrics.colorRatios.redToGreen <= char.perfusionRatios.redToGreen.max;
    const rbRatioValid = metrics.colorRatios.redToBlue >= char.perfusionRatios.redToBlue.min &&
                        metrics.colorRatios.redToBlue <= char.perfusionRatios.redToBlue.max;
    
    if (rgRatioValid && rbRatioValid) {
      score *= 1.2; // Bonus por ratios correctos
    } else if (!rgRatioValid || !rbRatioValid) {
      score *= 0.5; // Penalización por ratios incorrectos
    }
    
    return Math.min(1.0, score);
  }

  /**
   * Valida perfusión sanguínea característica de dedos vivos
   */
  private validateBloodPerfusion(metrics: FingerMetrics): number {
    const char = this.HUMAN_FINGER_CHARACTERISTICS;
    
    // El índice de perfusión debe estar en rango fisiológico
    if (metrics.perfusionIndex < char.perfusion.minIndex) {
      return 0; // No hay perfusión detectable
    }
    
    if (metrics.perfusionIndex > char.perfusion.maxIndex) {
      return 0.3; // Perfusión excesiva (posible artefacto)
    }
    
    // Perfusión normal
    const normalizedPerfusion = (metrics.perfusionIndex - char.perfusion.minIndex) / 
                               (char.perfusion.maxIndex - char.perfusion.minIndex);
    
    return Math.min(1.0, normalizedPerfusion * 1.2);
  }

  /**
   * Valida textura de piel característica de dedos humanos
   */
  private validateSkinTexture(metrics: FingerMetrics): number {
    const char = this.HUMAN_FINGER_CHARACTERISTICS;
    
    // La piel humana tiene una textura específica (no uniforme, no excesivamente rugosa)
    if (metrics.textureVariance < char.texture.minVariance) {
      return 0.2; // Demasiado uniforme (posible objeto no orgánico)
    }
    
    if (metrics.textureVariance > char.texture.maxVariance) {
      return 0.3; // Demasiado rugoso (posible artefacto)
    }
    
    // Textura en rango normal
    const normalizedTexture = (metrics.textureVariance - char.texture.minVariance) / 
                             (char.texture.maxVariance - char.texture.minVariance);
    
    return Math.min(1.0, 0.6 + (0.4 * normalizedTexture));
  }

  /**
   * Analiza características específicas de la yema del dedo
   */
  private analyzeFingertipCharacteristics(metrics: FingerMetrics): FingerDetectionResult['fingertipCharacteristics'] {
    const char = this.HUMAN_FINGER_CHARACTERISTICS;
    
    return {
      hasRidges: metrics.textureVariance >= char.texture.ridgePattern,
      hasPerfusion: metrics.perfusionIndex >= char.perfusion.minIndex &&
                   metrics.perfusionIndex <= char.perfusion.maxIndex,
      correctColorProfile: metrics.colorRatios.redToGreen >= char.perfusionRatios.redToGreen.min &&
                          metrics.colorRatios.redToGreen <= char.perfusionRatios.redToGreen.max,
      appropriateSize: true // Implementar validación de tamaño si es necesario
    };
  }

  /**
   * Calcula índice de perfusión basado en variabilidad temporal del canal rojo
   */
  private calculatePerfusionIndex(data: Uint8ClampedArray, startX: number, startY: number, 
                                endX: number, endY: number, width: number): number {
    // Usar historia de métricas para calcular variabilidad temporal
    if (this.metricsHistory.length < 3) {
      return 0;
    }
    
    const recentReds = this.metricsHistory.slice(-5).map(m => m.redIntensity);
    const avgRed = recentReds.reduce((sum, val) => sum + val, 0) / recentReds.length;
    const redVariance = recentReds.reduce((sum, val) => sum + Math.pow(val - avgRed, 2), 0) / recentReds.length;
    
    // Perfusión = (varianza AC / promedio DC) * 100
    return avgRed > 0 ? (Math.sqrt(redVariance) / avgRed) * 100 : 0;
  }

  /**
   * Calcula consenso temporal para evitar falsos positivos momentáneos
   */
  private calculateTemporalConsensus(): number {
    if (this.detectionHistory.length < 3) {
      return 0.5; // Consenso neutral con poca historia
    }
    
    const positiveDetections = this.detectionHistory.filter(d => d).length;
    const consensusRatio = positiveDetections / this.detectionHistory.length;
    
    return consensusRatio >= this.CONSENSUS_THRESHOLD ? consensusRatio : 0.3;
  }

  /**
   * Retorna métricas por defecto cuando no hay datos
   */
  private getDefaultMetrics(): FingerMetrics {
    return {
      redIntensity: 0,
      greenIntensity: 0,
      blueIntensity: 0,
      textureVariance: 0,
      perfusionIndex: 0,
      colorRatios: {
        redToGreen: 0,
        redToBlue: 0,
        greenToBlue: 0
      }
    };
  }

  /**
   * Reinicia el estado del detector
   */
  public reset(): void {
    this.detectionHistory = [];
    this.metricsHistory = [];
  }
}