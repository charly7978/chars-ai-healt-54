/**
 * GATE 1 - FINGER LIVENESS GATE
 * 
 * DETECCIÓN MATERIAL/ÓPTICA DE DEDO VIVO
 * 
 * REGLA FUNDAMENTAL: Sábana roja NO es dedo. Mantel NO es dedo. 
 * Tela NO es dedo. Superficie plana NO es dedo.
 * 
 * Este módulo debe RECHAZAR cualquier objeto no biológico
 * y solo permitir pasar candidatos que tengan evidencia
 * de tejido vivo con contacto óptico real.
 */

export interface LivenessFeatures {
  // Características ópticas básicas
  meanLinearR: number;
  meanLinearG: number;
  meanLinearB: number;
  meanODR: number;
  meanODG: number;
  meanODB: number;
  
  // AC/DC por canal
  acR: number;
  acG: number;
  acB: number;
  dcR: number;
  dcG: number;
  dcB: number;
  acDcRatioR: number;
  acDcRatioG: number;
  acDcRatioB: number;
  
  // Saturación y clipping
  saturationRatioR: number;
  saturationRatioG: number;
  saturationRatioB: number;
  clippingRatio: number;
  
  // Análisis espacial
  spatialVariance: number;
  spatialEntropy: number;
  gradientMagnitude: number;
  edgeDensity: number;
  textureComplexity: number;
  uniformityScore: number;
  
  // Análisis de histograma
  histogramSkewness: number;
  histogramKurtosis: number;
  histogramSpread: number;
  
  // Detección de patrones no biológicos
  textileLikelihood: number;
  flatSurfaceLikelihood: number;
  specularReflectionLikelihood: number;
  artificialPatternLikelihood: number;
  
  // Análisis temporal
  temporalVariation: number;
  microVariationScore: number;
  frameToFrameConsistency: number;
  
  // Contacto y perfusión
  contactQuality: number;
  perfusionIndex: number;
  tissueLikelihood: number;
}

export interface LivenessResult {
  isCandidateFinger: boolean;
  isLiveTissueLikely: boolean;
  contactQuality: number; // 0..1
  opticalQuality: number; // 0..1
  rejectionReason: string[];
  features: LivenessFeatures;
  confidence: number;
  gateStatus: 'PASSED' | 'REJECTED' | 'INSUFFICIENT_DATA';
}

export interface LivenessConfig {
  // Umbrales estrictos anti-falsos positivos
  minSpatialVariance: number;
  maxSpatialVariance: number;
  minPerfusionIndex: number;
  maxClippingRatio: number;
  minAcDcRatio: number;
  minTemporalVariation: number;
  maxUniformityScore: number;
  minTissueLikelihood: number;
  maxTextileLikelihood: number;
  maxFlatSurfaceLikelihood: number;
  minContactQuality: number;
  minOpticalQuality: number;
  
  // Pesos para cálculo final
  weightSpatial: number;
  weightTemporal: number;
  weightOptical: number;
  weightContact: number;
  weightAntiArtifact: number;
}

const DEFAULT_CONFIG: LivenessConfig = {
  // Umbrales muy estrictos
  minSpatialVariance: 100,
  maxSpatialVariance: 3000,
  minPerfusionIndex: 0.002,
  maxClippingRatio: 0.02,
  minAcDcRatio: 0.005,
  minTemporalVariation: 0.01,
  maxUniformityScore: 0.7,
  minTissueLikelihood: 0.6,
  maxTextileLikelihood: 0.3,
  maxFlatSurfaceLikelihood: 0.2,
  minContactQuality: 0.5,
  minOpticalQuality: 0.6,
  
  // Pesos
  weightSpatial: 0.25,
  weightTemporal: 0.25,
  weightOptical: 0.25,
  weightContact: 0.15,
  weightAntiArtifact: 0.1,
};

export class FingerLivenessGate {
  private config: LivenessConfig;
  private frameHistory: LivenessFeatures[] = [];
  private readonly MAX_HISTORY = 30;
  private readonly SATURATION_THRESHOLD = 250;
  private readonly DARK_THRESHOLD = 5;

  constructor(config: Partial<LivenessConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Conversión sRGB a lineal (misma fórmula que RadiometricCalibration)
   */
  private sRGBToLinear(srgb: number): number {
    const v = srgb / 255;
    if (v <= 0.04045) {
      return v / 12.92;
    }
    return Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /**
   * Conversión a densidad óptica
   */
  private opticalDensity(normalized: number): number {
    return -Math.log(Math.max(normalized, 1e-6));
  }

  /**
   * Calcular características espaciales del ROI
   */
  private calculateSpatialFeatures(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): {
    variance: number;
    entropy: number;
    gradientMagnitude: number;
    edgeDensity: number;
    textureComplexity: number;
    uniformityScore: number;
  } {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    // Extraer píxeles del ROI
    const pixels: number[] = [];
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        pixels.push(gray);
      }
    }
    
    // Varianza espacial
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const variance = pixels.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pixels.length;
    
    // Entropía
    const histogram = new Array(256).fill(0);
    pixels.forEach(p => histogram[Math.floor(p)]++);
    const probabilities = histogram.map(h => h / pixels.length).filter(p => p > 0);
    const entropy = -probabilities.reduce((sum, p) => sum + p * Math.log2(p), 0);
    
    // Gradiente (Sobel)
    let gradientSum = 0;
    let edgeCount = 0;
    for (let py = y + 1; py < y + height - 1; py++) {
      for (let px = x + 1; px < x + width - 1; px++) {
        const idx = (py * w + px) * 4;
        const center = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        
        const idxTop = ((py - 1) * w + px) * 4;
        const top = 0.299 * data[idxTop] + 0.587 * data[idxTop + 1] + 0.114 * data[idxTop + 2];
        
        const idxBottom = ((py + 1) * w + px) * 4;
        const bottom = 0.299 * data[idxBottom] + 0.587 * data[idxBottom + 1] + 0.114 * data[idxBottom + 2];
        
        const idxLeft = (py * w + (px - 1)) * 4;
        const left = 0.299 * data[idxLeft] + 0.587 * data[idxLeft + 1] + 0.114 * data[idxLeft + 2];
        
        const idxRight = (py * w + (px + 1)) * 4;
        const right = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
        
        const gx = right - left;
        const gy = bottom - top;
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        
        gradientSum += magnitude;
        if (magnitude > 30) edgeCount++;
      }
    }
    
    const gradientMagnitude = gradientSum / ((width - 2) * (height - 2));
    const edgeDensity = edgeCount / ((width - 2) * (height - 2));
    
    // Complejidad de textura (varianza de gradientes locales)
    let textureSum = 0;
    const patchSize = 5;
    for (let py = y; py < y + height - patchSize; py += patchSize) {
      for (let px = x; px < x + width - patchSize; px += patchSize) {
        let patchVariance = 0;
        const patchPixels: number[] = [];
        
        for (let dy = 0; dy < patchSize; dy++) {
          for (let dx = 0; dx < patchSize; dx++) {
            const idx = ((py + dy) * w + (px + dx)) * 4;
            const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            patchPixels.push(gray);
          }
        }
        
        const patchMean = patchPixels.reduce((a, b) => a + b, 0) / patchPixels.length;
        patchVariance = patchPixels.reduce((sum, p) => sum + (p - patchMean) ** 2, 0) / patchPixels.length;
        textureSum += patchVariance;
      }
    }
    
    const textureComplexity = textureSum / (Math.floor(width / patchSize) * Math.floor(height / patchSize));
    
    // Uniformidad (inverso de textura)
    const uniformityScore = Math.max(0, 1 - textureComplexity / 1000);
    
    return {
      variance,
      entropy,
      gradientMagnitude,
      edgeDensity,
      textureComplexity,
      uniformityScore,
    };
  }

  /**
   * Analizar histograma para detectar patrones no biológicos
   */
  private analyzeHistogram(pixels: number[]): {
    skewness: number;
    kurtosis: number;
    spread: number;
  } {
    const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const variance = pixels.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pixels.length;
    const std = Math.sqrt(variance);
    
    // Skewness (asimetría)
    const skewness = pixels.reduce((sum, p) => sum + ((p - mean) / std) ** 3, 0) / pixels.length;
    
    // Kurtosis (apuntamiento)
    const kurtosis = pixels.reduce((sum, p) => sum + ((p - mean) / std) ** 4, 0) / pixels.length - 3;
    
    // Spread (rango intercuartílico)
    const sorted = [...pixels].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const spread = q3 - q1;
    
    return { skewness, kurtosis, spread };
  }

  /**
   * Detectar patrones de tela/textil
   */
  private detectTextilePattern(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): number {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    // Buscar patrones repetitivos espaciales característicos de tela
    let patternScore = 0;
    const analysisSize = 8;
    
    for (let py = y; py < y + height - analysisSize; py += 4) {
      for (let px = x; px < x + width - analysisSize; px += 4) {
        // Extraer parche
        const patch: number[] = [];
        for (let dy = 0; dy < analysisSize; dy++) {
          for (let dx = 0; dx < analysisSize; dx++) {
            const idx = ((py + dy) * w + (px + dx)) * 4;
            const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            patch.push(gray);
          }
        }
        
        // Buscar periodicidad en el parche
        const patchMean = patch.reduce((a, b) => a + b, 0) / patch.length;
        const patchVariance = patch.reduce((sum, p) => sum + (p - patchMean) ** 2, 0) / patch.length;
        
        // Las telas suelen tener variación moderada pero periódica
        if (patchVariance > 50 && patchVariance < 500) {
          patternScore += 0.1;
        }
      }
    }
    
    return Math.min(1, patternScore / 10);
  }

  /**
   * Detectar superficie plana (objeto no biológico)
   */
  private detectFlatSurface(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): number {
    const spatial = this.calculateSpatialFeatures(imageData, roi);
    
    let flatScore = 0;
    
    // Superficie muy uniforme
    if (spatial.uniformityScore > 0.8) flatScore += 0.4;
    
    // Baja complejidad de textura
    if (spatial.textureComplexity < 100) flatScore += 0.3;
    
    // Baja densidad de bordes
    if (spatial.edgeDensity < 0.05) flatScore += 0.3;
    
    return Math.min(1, flatScore);
  }

  /**
   * Detectar reflexión especular
   */
  private detectSpecularReflection(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): number {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    let specularPixels = 0;
    let totalPixels = 0;
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // Píxeles muy brillantes y saturados
        if (r > 240 && g > 240 && b > 240) {
          specularPixels++;
        }
        totalPixels++;
      }
    }
    
    return specularPixels / totalPixels;
  }

  /**
   * Extraer todas las características del frame
   */
  private extractFeatures(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): LivenessFeatures {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;
    
    // Medias RGB lineales
    let sumR = 0, sumG = 0, sumB = 0;
    let sumLinearR = 0, sumLinearG = 0, sumLinearB = 0;
    let saturatedPixels = 0;
    let darkPixels = 0;
    let totalPixels = 0;
    
    const pixels: number[] = [];
    
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        sumR += r;
        sumG += g;
        sumB += b;
        
        const linearR = this.sRGBToLinear(r);
        const linearG = this.sRGBToLinear(g);
        const linearB = this.sRGBToLinear(b);
        
        sumLinearR += linearR;
        sumLinearG += linearG;
        sumLinearB += linearB;
        
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        pixels.push(gray);
        
        if (r >= this.SATURATION_THRESHOLD || g >= this.SATURATION_THRESHOLD || b >= this.SATURATION_THRESHOLD) {
          saturatedPixels++;
        }
        if (r <= this.DARK_THRESHOLD && g <= this.DARK_THRESHOLD && b <= this.DARK_THRESHOLD) {
          darkPixels++;
        }
        
        totalPixels++;
      }
    }
    
    const meanR = sumR / totalPixels;
    const meanG = sumG / totalPixels;
    const meanB = sumB / totalPixels;
    const meanLinearR = sumLinearR / totalPixels;
    const meanLinearG = sumLinearG / totalPixels;
    const meanLinearB = sumLinearB / totalPixels;
    
    // OD (asumiendo calibración normalizada)
    const meanODR = this.opticalDensity(meanLinearR);
    const meanODG = this.opticalDensity(meanLinearG);
    const meanODB = this.opticalDensity(meanLinearB);
    
    // AC/DC (valores provisionales, se actualizarán con historial)
    const dcR = meanR;
    const dcG = meanG;
    const dcB = meanB;
    const acR = 0; // Se calculará con historial
    const acG = 0;
    const acB = 0;
    
    // Ratios
    const acDcRatioR = dcR > 0 ? acR / dcR : 0;
    const acDcRatioG = dcG > 0 ? acG / dcG : 0;
    const acDcRatioB = dcB > 0 ? acB / dcB : 0;
    
    // Saturación
    const saturationRatioR = saturatedPixels / totalPixels;
    const saturationRatioG = saturatedPixels / totalPixels;
    const saturationRatioB = saturatedPixels / totalPixels;
    const clippingRatio = saturatedPixels / totalPixels;
    
    // Características espaciales
    const spatial = this.calculateSpatialFeatures(imageData, roi);
    
    // Histograma
    const histogram = this.analyzeHistogram(pixels);
    
    // Detección de patrones no biológicos
    const textileLikelihood = this.detectTextilePattern(imageData, roi);
    const flatSurfaceLikelihood = this.detectFlatSurface(imageData, roi);
    const specularReflectionLikelihood = this.detectSpecularReflection(imageData, roi);
    const artificialPatternLikelihood = Math.max(textileLikelihood, flatSurfaceLikelihood);
    
    // Variación temporal (con historial)
    let temporalVariation = 0;
    let microVariationScore = 0;
    if (this.frameHistory.length > 0) {
      const lastFrame = this.frameHistory[this.frameHistory.length - 1];
      temporalVariation = Math.abs(meanLinearR - lastFrame.meanLinearR) + 
                          Math.abs(meanLinearG - lastFrame.meanLinearG) + 
                          Math.abs(meanLinearB - lastFrame.meanLinearB);
      temporalVariation /= 3;
      
      // Microvariación (cambios sutiles frame a frame)
      microVariationScore = Math.min(1, temporalVariation * 10);
    }
    
    // Consistencia frame a frame
    let frameToFrameConsistency = 1;
    if (this.frameHistory.length >= 5) {
      const recent = this.frameHistory.slice(-5);
      const meanRecentR = recent.reduce((sum, f) => sum + f.meanLinearR, 0) / recent.length;
      const varianceRecent = recent.reduce((sum, f) => sum + (f.meanLinearR - meanRecentR) ** 2, 0) / recent.length;
      frameToFrameConsistency = Math.max(0, 1 - varianceRecent / 0.01);
    }
    
    // Calidad de contacto y perfusión
    const contactQuality = Math.max(0, 1 - clippingRatio * 5) * Math.max(0, 1 - flatSurfaceLikelihood);
    const perfusionIndex = acDcRatioG; // Usar verde como referencia
    const tissueLikelihood = Math.max(0, 1 - artificialPatternLikelihood) * contactQuality;
    
    return {
      meanLinearR, meanLinearG, meanLinearB,
      meanODR, meanODG, meanODB,
      acR, acG, acB,
      dcR, dcG, dcB,
      acDcRatioR, acDcRatioG, acDcRatioB,
      saturationRatioR, saturationRatioG, saturationRatioB,
      clippingRatio,
      spatialVariance: spatial.variance,
      spatialEntropy: spatial.entropy,
      gradientMagnitude: spatial.gradientMagnitude,
      edgeDensity: spatial.edgeDensity,
      textureComplexity: spatial.textureComplexity,
      uniformityScore: spatial.uniformityScore,
      histogramSkewness: histogram.skewness,
      histogramKurtosis: histogram.kurtosis,
      histogramSpread: histogram.spread,
      textileLikelihood,
      flatSurfaceLikelihood,
      specularReflectionLikelihood,
      artificialPatternLikelihood,
      temporalVariation,
      microVariationScore,
      frameToFrameConsistency,
      contactQuality,
      perfusionIndex,
      tissueLikelihood,
    };
  }

  /**
   * Evaluar si el objeto es un candidato a dedo
   */
  private evaluateCandidate(features: LivenessFeatures): { passed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let passed = true;
    
    // RECHAZOS INMEDIATOS
    
    // 1. Demasiado uniforme (superficie plana, papel, pared)
    if (features.uniformityScore > this.config.maxUniformityScore) {
      passed = false;
      reasons.push(`Objeto demasiado uniforme: ${(features.uniformityScore * 100).toFixed(1)}%`);
    }
    
    // 2. Patrón de tela detectado
    if (features.textileLikelihood > this.config.maxTextileLikelihood) {
      passed = false;
      reasons.push(`Patrón de tela detectado: ${(features.textileLikelihood * 100).toFixed(1)}%`);
    }
    
    // 3. Superficie plana detectada
    if (features.flatSurfaceLikelihood > this.config.maxFlatSurfaceLikelihood) {
      passed = false;
      reasons.push(`Superficie plana detectada: ${(features.flatSurfaceLikelihood * 100).toFixed(1)}%`);
    }
    
    // 4. Saturación excesiva
    if (features.clippingRatio > this.config.maxClippingRatio) {
      passed = false;
      reasons.push(`Saturación excesiva: ${(features.clippingRatio * 100).toFixed(1)}%`);
    }
    
    // 5. Varianza espacial muy baja (objeto sin textura)
    if (features.spatialVariance < this.config.minSpatialVariance) {
      passed = false;
      reasons.push(`Varianza espacial muy baja: ${features.spatialVariance.toFixed(1)}`);
    }
    
    // 6. Varianza espacial muy alta (ruido o patrón artificial)
    if (features.spatialVariance > this.config.maxSpatialVariance) {
      passed = false;
      reasons.push(`Varianza espacial muy alta: ${features.spatialVariance.toFixed(1)}`);
    }
    
    // 7. Sin perfusión detectada
    if (features.perfusionIndex < this.config.minPerfusionIndex) {
      passed = false;
      reasons.push(`Sin perfusión detectada: ${features.perfusionIndex.toFixed(4)}`);
    }
    
    // 8. Reflexión especular alta
    if (features.specularReflectionLikelihood > 0.1) {
      passed = false;
      reasons.push(`Reflexión especular detectada`);
    }
    
    // 9. Baja calidad de contacto
    if (features.contactQuality < this.config.minContactQuality) {
      passed = false;
      reasons.push(`Contacto de baja calidad: ${(features.contactQuality * 100).toFixed(1)}%`);
    }
    
    return { passed, reasons };
  }

  /**
   * Evaluar si es tejido vivo
   */
  private evaluateLiveness(features: LivenessFeatures): { passed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let passed = true;
    
    // 1. Baja probabilidad de tejido
    if (features.tissueLikelihood < this.config.minTissueLikelihood) {
      passed = false;
      reasons.push(`Baja probabilidad de tejido: ${(features.tissueLikelihood * 100).toFixed(1)}%`);
    }
    
    // 2. Sin variación temporal (objeto estático)
    if (features.temporalVariation < this.config.minTemporalVariation && this.frameHistory.length > 0) {
      passed = false;
      reasons.push(`Objeto estático sin variación temporal`);
    }
    
    // 3. Patrón artificial alto
    if (features.artificialPatternLikelihood > 0.5) {
      passed = false;
      reasons.push(`Patrón artificial detectado`);
    }
    
    return { passed, reasons };
  }

  /**
   * Procesar frame y determinar si es dedo vivo
   */
  processFrame(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): LivenessResult {
    // Extraer características
    const features = this.extractFeatures(imageData, roi);
    
    // Actualizar historial
    this.frameHistory.push(features);
    if (this.frameHistory.length > this.MAX_HISTORY) {
      this.frameHistory.shift();
    }
    
    // Evaluar candidato
    const candidateResult = this.evaluateCandidate(features);
    
    // Evaluar liveness
    const livenessResult = this.evaluateLiveness(features);
    
    // Combinar razones de rechazo
    const rejectionReason = [...candidateResult.reasons, ...livenessResult.reasons];
    
    // Calificar calidad óptica
    const opticalQuality = Math.max(0, 1 - features.clippingRatio * 2) * 
                          Math.max(0, 1 - features.specularReflectionLikelihood * 5) *
                          Math.max(0, 1 - features.artificialPatternLikelihood);
    
    // Calcular confianza general
    const confidence = (
      features.contactQuality * this.config.weightContact +
      opticalQuality * this.config.weightOptical +
      (1 - features.artificialPatternLikelihood) * this.config.weightAntiArtifact +
      (features.spatialVariance > this.config.minSpatialVariance && features.spatialVariance < this.config.maxSpatialVariance ? 1 : 0) * this.config.weightSpatial +
      (features.temporalVariation > this.config.minTemporalVariation ? 1 : 0) * this.config.weightTemporal
    );
    
    // Determinar estado final
    const isCandidateFinger = candidateResult.passed;
    const isLiveTissueLikely = isCandidateFinger && livenessResult.passed;
    
    const gateStatus = rejectionReason.length > 0 ? 'REJECTED' : 
                      this.frameHistory.length < 5 ? 'INSUFFICIENT_DATA' : 'PASSED';
    
    return {
      isCandidateFinger,
      isLiveTissueLikely,
      contactQuality: features.contactQuality,
      opticalQuality,
      rejectionReason,
      features,
      confidence: Math.max(0, Math.min(1, confidence)),
      gateStatus,
    };
  }

  /**
   * Resetear gate
   */
  reset(): void {
    this.frameHistory = [];
  }

  /**
   * Obtener historial de características
   */
  getHistory(): LivenessFeatures[] {
    return [...this.frameHistory];
  }

  /**
   * Actualizar configuración
   */
  updateConfig(config: Partial<LivenessConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Obtener configuración actual
   */
  getConfig(): LivenessConfig {
    return { ...this.config };
  }
}
