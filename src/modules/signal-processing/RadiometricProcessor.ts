/**
 * RADIOMETRIC PROCESSOR V1
 * 
 * Preprocesamiento serio antes de extracción PPG:
 * - sRGB → Linear RGB (inverse gamma)
 * - Linear RGB → Optical Density (OD = -log(R + eps))
 * - Métricas por tile: linear mean, OD mean, varianza, clipping, entropía
 * - Device calibration profile persistible
 * - Centralización de thresholds tipados
 */

// ═══════════════════════════════════════════════════════════════════
//  TYPED CONFIGURATION - No magic values
// ═══════════════════════════════════════════════════════════════════

export interface RadiometricConfig {
  // Gamma correction
  gamma: number;                    // Default 2.2 for sRGB
  gammaInverse: number;             // 1/gamma precomputed
  
  // Clipping thresholds (0-255 range)
  clipHigh: number;                 // Pixels >= this considered clipped high
  clipLow: number;                  // Pixels <= this considered clipped low
  
  // Optical Density computation
  eps: number;                      // Epsilon for log stability
  
  // Tile metrics thresholds
  minValidPixelsRatio: number;      // Minimum ratio of valid pixels per tile
  
  // Device-specific calibration
  deviceProfile?: DeviceCalibrationProfile;
}

export interface DeviceCalibrationProfile {
  // Device identification
  userAgent: string;
  deviceModel?: string;             // If detectable
  
  // Gamma estimation
  gammaEstimated: number;
  gammaConfidence: number;          // 0-1 how confident
  
  // Operating point (estable después de warmup)
  stableOperatingPoint: {
    exposureCompensation: number;
    iso: number;
    frameRate: number;
    torch: boolean;
  };
  
  // Channel weights iniciales (de calibración estática)
  initialChannelWeights: {
    red: number;
    green: number;
    blue: number;
  };
  
  // Thresholds específicos del dispositivo
  deviceSpecificThresholds: {
    clippingHigh: number;           // Algunos dispositivos saturan antes
    clippingLow: number;
    minSignalAmplitude: number;     // Basado en ruido del sensor
    maxSignalAmplitude: number;       // Basado en saturación
  };
  
  // Historial de calibración
  calibrationDate: number;
  calibrationFrames: number;
  
  // Persistencia
  persistKey: string;               // localStorage key
}

// ═══════════════════════════════════════════════════════════════════
//  DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_RADIOMETRIC_CONFIG: RadiometricConfig = {
  gamma: 2.2,
  gammaInverse: 1 / 2.2,
  clipHigh: 250,
  clipLow: 5,
  eps: 1e-6,
  minValidPixelsRatio: 0.5,
};

// ═══════════════════════════════════════════════════════════════════
//  RADIOMETRIC TILE METRICS
// ═══════════════════════════════════════════════════════════════════

export interface RadiometricTileMetrics {
  // Índice del tile
  tileIndex: number;
  
  // Linear RGB (post-gamma correction)
  linearR: number;
  linearG: number;
  linearB: number;
  linearIntensity: number;          // R+G+B (no normalizado)
  
  // Optical Density (Beer's Law approximation)
  odR: number;
  odG: number;
  odB: number;
  odMean: number;                   // Promedio de OD
  
  // Estadísticas
  variance: number;                 // Varianza de intensidad
  stdDev: number;                   // Desviación estándar
  
  // Clipping
  clipHighCount: number;
  clipLowCount: number;
  clipHighRatio: number;            // 0-1
  clipLowRatio: number;             // 0-1
  validPixelCount: number;
  totalPixelCount: number;
  validPixelRatio: number;          // 0-1
  
  // Textura
  entropy: number;                  // Entropía de histograma
  edgeMagnitude: number;            // Magnitud de gradiente promedio
  
  // Firma hemodinámica
  redDominance: number;             // R - (G+B)/2
  rgRatio: number;                  // R/G
  redGreenDiff: number;             // (R-G)/(R+G+B+eps)
  
  // Calidad del tile
  qualityScore: number;             // 0-1 compuesto
  isValid: boolean;                 // Pasa umbrales mínimos
  rejectionReason?: string;         // Por qué fue rechazado
}

// ═══════════════════════════════════════════════════════════════════
//  AGGREGATE RADIOMETRIC RESULT
// ═══════════════════════════════════════════════════════════════════

export interface RadiometricResult {
  // Por tile
  tileMetrics: RadiometricTileMetrics[];
  
  // Agregado global (weighted por qualityScore)
  global: {
    linearR: number;
    linearG: number;
    linearB: number;
    odR: number;
    odG: number;
    odB: number;
    odMean: number;
    intensity: number;
    variance: number;
    clipHighRatio: number;
    clipLowRatio: number;
    entropy: number;
    redDominance: number;
    rgRatio: number;
  };
  
  // Información de validación
  validTileCount: number;
  totalTileCount: number;
  validTileRatio: number;
  
  // Métricas de calidad global
  globalQualityScore: number;
  isFrameValid: boolean;
  frameRejectionReason?: string;
  
  // Referencia a config usada
  config: RadiometricConfig;
  
  // Timestamp
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════
//  RADIOMETRIC PROCESSOR CLASS
// ═══════════════════════════════════════════════════════════════════

export class RadiometricProcessor {
  private config: RadiometricConfig;
  private deviceProfile: DeviceCalibrationProfile | null = null;
  
  // Reusable buffers para zero-alloc
  private tempLinearR: Float32Array;
  private tempLinearG: Float32Array;
  private tempLinearB: Float32Array;
  private readonly MAX_TILE_PIXELS = 4096; // 64x64 max tile
  
  constructor(config: Partial<RadiometricConfig> = {}) {
    this.config = { ...DEFAULT_RADIOMETRIC_CONFIG, ...config };
    
    // Pre-allocate temp buffers
    this.tempLinearR = new Float32Array(this.MAX_TILE_PIXELS);
    this.tempLinearG = new Float32Array(this.MAX_TILE_PIXELS);
    this.tempLinearB = new Float32Array(this.MAX_TILE_PIXELS);
    
    // Intentar cargar perfil de dispositivo
    this.loadDeviceProfile();
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  GAMMA CORRECTION (sRGB → Linear)
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Convert sRGB (0-255) to linear (0-1) using inverse gamma
   * Aplica corrección gamma real, no lineal simple
   */
  srgbToLinear(srgbValue: number): number {
    const normalized = srgbValue / 255;
    
    // sRGB gamma curve piecewise:
    // <= 0.04045: linear / 12.92
    // > 0.04045: ((linear + 0.055) / 1.055) ^ 2.4
    if (normalized <= 0.04045) {
      return normalized / 12.92;
    } else {
      return Math.pow((normalized + 0.055) / 1.055, 2.4);
    }
  }
  
  /**
   * Batch convert sRGB array to linear
   */
  batchSrgbToLinear(srgbArray: Uint8Array | number[], outArray: Float32Array, length: number): void {
    for (let i = 0; i < length; i++) {
      outArray[i] = this.srgbToLinear(srgbArray[i]);
    }
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  OPTICAL DENSITY (Beer-Lambert Law)
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Compute Optical Density: OD = -log10(I / I0)
   * Donde I es intensidad transmitida, I0 es intensidad incidente
   * 
   * En PPG: asumimos I0 ≈ baseline (DC), I ≈ señal actual
   * OD ≈ -log(linear + eps)
   */
  linearToOD(linearValue: number): number {
    return -Math.log10(linearValue + this.config.eps);
  }
  
  /**
   * Batch convert linear to OD
   */
  batchLinearToOD(linearArray: Float32Array, outArray: Float32Array, length: number): void {
    const eps = this.config.eps;
    for (let i = 0; i < length; i++) {
      outArray[i] = -Math.log10(linearArray[i] + eps);
    }
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  TILE PROCESSING
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Process single tile and compute radiometric metrics
   */
  processTile(
    imageData: ImageData,
    tileX: number,
    tileY: number,
    tileWidth: number,
    tileHeight: number,
    tileIndex: number
  ): RadiometricTileMetrics {
    const data = imageData.data;
    const imgWidth = imageData.width;
    
    let pixelIdx = 0;
    let clipHighCount = 0;
    let clipLowCount = 0;
    let sumR = 0, sumG = 0, sumB = 0;
    let sumLinearR = 0, sumLinearG = 0, sumLinearB = 0;
    let sumODR = 0, sumODG = 0, sumODB = 0;
    
    // Histograma para entropía (16 bins por canal para eficiencia)
    const histogram = new Uint32Array(16);
    
    // Sample pixels (step 2 para performance, procesa ~25% de pixels)
    const step = 2;
    
    for (let y = tileY; y < tileY + tileHeight && y < imageData.height; y += step) {
      for (let x = tileX; x < tileX + tileWidth && x < imageData.width; x += step) {
        const i = (y * imgWidth + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Clipping check
        const isClipHigh = r >= this.config.clipHigh || g >= this.config.clipHigh || b >= this.config.clipHigh;
        const isClipLow = r <= this.config.clipLow && g <= this.config.clipLow && b <= this.config.clipLow;
        
        if (isClipHigh) clipHighCount++;
        if (isClipLow) clipLowCount++;
        
        // Convert to linear (siempre, incluso si clippeado para estadísticas)
        const linearR = this.srgbToLinear(r);
        const linearG = this.srgbToLinear(g);
        const linearB = this.srgbToLinear(b);
        
        // Store in temp buffers
        if (pixelIdx < this.MAX_TILE_PIXELS) {
          this.tempLinearR[pixelIdx] = linearR;
          this.tempLinearG[pixelIdx] = linearG;
          this.tempLinearB[pixelIdx] = linearB;
        }
        
        // Accumulate
        sumR += r;
        sumG += g;
        sumB += b;
        sumLinearR += linearR;
        sumLinearG += linearG;
        sumLinearB += linearB;
        
        // Optical Density
        sumODR += this.linearToOD(linearR);
        sumODG += this.linearToOD(linearG);
        sumODB += this.linearToOD(linearB);
        
        // Histogram bin (intensity)
        const intensity = Math.floor((r + g + b) / 3 / 16);
        histogram[Math.min(15, intensity)]++;
        
        pixelIdx++;
      }
    }
    
    const totalPixels = pixelIdx;
    const validPixels = totalPixels - clipHighCount - clipLowCount;
    const validPixelRatio = validPixels / Math.max(1, totalPixels);
    
    // Means
    const meanR = sumR / totalPixels;
    const meanG = sumG / totalPixels;
    const meanB = sumB / totalPixels;
    const meanLinearR = sumLinearR / totalPixels;
    const meanLinearG = sumLinearG / totalPixels;
    const meanLinearB = sumLinearB / totalPixels;
    const meanODR = sumODR / totalPixels;
    const meanODG = sumODG / totalPixels;
    const meanODB = sumODB / totalPixels;
    const meanOD = (meanODR + meanODG + meanODB) / 3;
    
    // Variance (of linear intensity)
    let variance = 0;
    if (validPixels > 1) {
      const meanLinearIntensity = (meanLinearR + meanLinearG + meanLinearB) / 3;
      for (let i = 0; i < Math.min(totalPixels, this.MAX_TILE_PIXELS); i++) {
        const intensity = (this.tempLinearR[i] + this.tempLinearG[i] + this.tempLinearB[i]) / 3;
        variance += Math.pow(intensity - meanLinearIntensity, 2);
      }
      variance /= validPixels;
    }
    const stdDev = Math.sqrt(variance);
    
    // Entropy
    let entropy = 0;
    for (let i = 0; i < 16; i++) {
      if (histogram[i] > 0) {
        const p = histogram[i] / totalPixels;
        entropy -= p * Math.log2(p);
      }
    }
    
    // Edge magnitude (simplified, usando diferencias)
    let edgeMag = 0;
    if (totalPixels > 10) {
      let diffSum = 0;
      let diffCount = 0;
      for (let i = 1; i < Math.min(totalPixels, this.MAX_TILE_PIXELS); i++) {
        const di = Math.abs(this.tempLinearR[i] - this.tempLinearR[i-1]);
        diffSum += di;
        diffCount++;
      }
      edgeMag = diffCount > 0 ? diffSum / diffCount : 0;
    }
    
    // Hemodynamic signatures
    const linearIntensity = meanLinearR + meanLinearG + meanLinearB;
    const redDominance = meanLinearR - (meanLinearG + meanLinearB) / 2;
    const rgRatio = meanLinearG > 0 ? meanLinearR / meanLinearG : 0;
    const redGreenDiff = linearIntensity > 0 ? (meanLinearR - meanLinearG) / linearIntensity : 0;
    
    // Quality score
    let qualityScore = 0;
    let isValid = false;
    let rejectionReason: string | undefined;
    
    // Validity criteria
    const clipRatio = (clipHighCount + clipLowCount) / totalPixels;
    const hasEnoughSignal = meanLinearG > 0.05; // Not too dark
    const hasRedSignature = redDominance > 0;   // Red should dominate
    const hasValidRatio = validPixelRatio >= this.config.minValidPixelsRatio;
    
    if (clipRatio > 0.5) {
      rejectionReason = `Excessive clipping (${(clipRatio*100).toFixed(0)}%)`;
    } else if (!hasEnoughSignal) {
      rejectionReason = 'Insufficient signal (too dark)';
    } else if (!hasRedSignature) {
      rejectionReason = 'No red signature (not a finger?)';
    } else if (!hasValidRatio) {
      rejectionReason = `Too many clipped pixels (${(validPixelRatio*100).toFixed(0)}% valid)`;
    } else {
      isValid = true;
      // Compute quality score
      qualityScore = (
        (1 - clipRatio) * 0.3 +                    // Low clipping is good
        Math.min(1, linearIntensity) * 0.2 +       // Good intensity
        Math.min(1, redDominance * 2) * 0.2 +      // Red dominance
        (validPixelRatio) * 0.2 +                  // Valid pixels
        Math.min(1, entropy / 4) * 0.1           // Some texture (entropy)
      );
    }
    
    return {
      tileIndex,
      linearR: meanLinearR,
      linearG: meanLinearG,
      linearB: meanLinearB,
      linearIntensity,
      odR: meanODR,
      odG: meanODG,
      odB: meanODB,
      odMean: meanOD,
      variance,
      stdDev,
      clipHighCount,
      clipLowCount,
      clipHighRatio: clipHighCount / totalPixels,
      clipLowRatio: clipLowCount / totalPixels,
      validPixelCount: validPixels,
      totalPixelCount: totalPixels,
      validPixelRatio,
      entropy,
      edgeMagnitude: edgeMag,
      redDominance,
      rgRatio,
      redGreenDiff,
      qualityScore,
      isValid,
      rejectionReason,
    };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  FULL FRAME PROCESSING
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Process full image with grid-based tile analysis
   */
  processFrame(imageData: ImageData, gridSize: number = 5): RadiometricResult {
    const w = imageData.width;
    const h = imageData.height;
    const tileW = Math.ceil(w / gridSize);
    const tileH = Math.ceil(h / gridSize);
    
    const tileMetrics: RadiometricTileMetrics[] = [];
    let validTileCount = 0;
    let globalSumWeight = 0;
    
    // Accumulators for global metrics (weighted by tile quality)
    let accLinearR = 0, accLinearG = 0, accLinearB = 0;
    let accODR = 0, accODG = 0, accODB = 0, accODMean = 0;
    let accIntensity = 0, accVariance = 0;
    let accClipHigh = 0, accClipLow = 0;
    let accEntropy = 0;
    let accRedDom = 0, accRGRatio = 0;
    
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const tileX = gx * tileW;
        const tileY = gy * tileH;
        const tileIndex = gy * gridSize + gx;
        
        const tile = this.processTile(imageData, tileX, tileY, tileW, tileH, tileIndex);
        tileMetrics.push(tile);
        
        if (tile.isValid) {
          validTileCount++;
          const weight = tile.qualityScore;
          globalSumWeight += weight;
          
          // Weighted accumulation
          accLinearR += tile.linearR * weight;
          accLinearG += tile.linearG * weight;
          accLinearB += tile.linearB * weight;
          accODR += tile.odR * weight;
          accODG += tile.odG * weight;
          accODB += tile.odB * weight;
          accODMean += tile.odMean * weight;
          accIntensity += tile.linearIntensity * weight;
          accVariance += tile.variance * weight;
          accClipHigh += tile.clipHighRatio * weight;
          accClipLow += tile.clipLowRatio * weight;
          accEntropy += tile.entropy * weight;
          accRedDom += tile.redDominance * weight;
          accRGRatio += tile.rgRatio * weight;
        }
      }
    }
    
    const totalTileCount = gridSize * gridSize;
    const validTileRatio = validTileCount / totalTileCount;
    
    // Normalize global metrics
    const normWeight = globalSumWeight > 0 ? globalSumWeight : 1;
    
    const global = {
      linearR: accLinearR / normWeight,
      linearG: accLinearG / normWeight,
      linearB: accLinearB / normWeight,
      odR: accODR / normWeight,
      odG: accODG / normWeight,
      odB: accODB / normWeight,
      odMean: accODMean / normWeight,
      intensity: accIntensity / normWeight,
      variance: accVariance / normWeight,
      clipHighRatio: accClipHigh / normWeight,
      clipLowRatio: accClipLow / normWeight,
      entropy: accEntropy / normWeight,
      redDominance: accRedDom / normWeight,
      rgRatio: accRGRatio / normWeight,
    };
    
    // Global quality
    const globalQualityScore = validTileRatio > 0.3 
      ? tileMetrics.filter(t => t.isValid).reduce((s, t) => s + t.qualityScore, 0) / validTileCount
      : 0;
    
    const isFrameValid = validTileRatio >= 0.3 && globalQualityScore > 0.3;
    
    return {
      tileMetrics,
      global,
      validTileCount,
      totalTileCount,
      validTileRatio,
      globalQualityScore,
      isFrameValid,
      frameRejectionReason: isFrameValid ? undefined : `Valid tiles: ${(validTileRatio*100).toFixed(0)}%, Quality: ${globalQualityScore.toFixed(2)}`,
      config: this.config,
      timestamp: performance.now(),
    };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  DEVICE CALIBRATION PROFILE
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Save device calibration profile to localStorage
   */
  saveDeviceProfile(profile: DeviceCalibrationProfile): void {
    try {
      localStorage.setItem(profile.persistKey, JSON.stringify(profile));
      this.deviceProfile = profile;
      console.log('💾 Device calibration profile saved:', profile.persistKey);
    } catch {
      console.warn('⚠️ Failed to save device profile');
    }
  }
  
  /**
   * Load device calibration profile from localStorage
   */
  loadDeviceProfile(): DeviceCalibrationProfile | null {
    try {
      const key = this.generateProfileKey();
      const stored = localStorage.getItem(key);
      if (stored) {
        this.deviceProfile = JSON.parse(stored) as DeviceCalibrationProfile;
        console.log('📂 Device calibration profile loaded:', key);
        return this.deviceProfile;
      }
    } catch {
      console.warn('⚠️ Failed to load device profile');
    }
    return null;
  }
  
  /**
   * Generate unique profile key for this device/browser
   */
  private generateProfileKey(): string {
    const ua = navigator.userAgent;
    // Simple hash of UA (in production, could use more robust device detection)
    let hash = 0;
    for (let i = 0; i < ua.length; i++) {
      const char = ua.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `ppg-radiometric-profile-${hash}`;
  }
  
  /**
   * Get current device profile
   */
  getDeviceProfile(): DeviceCalibrationProfile | null {
    return this.deviceProfile;
  }
  
  /**
   * Update config with device-specific thresholds
   */
  applyDeviceProfile(): void {
    if (!this.deviceProfile) return;
    
    // Override thresholds with device-specific values
    this.config.clipHigh = this.deviceProfile.deviceSpecificThresholds.clippingHigh;
    this.config.clipLow = this.deviceProfile.deviceSpecificThresholds.clippingLow;
    
    console.log('🔧 Device-specific thresholds applied');
  }
  
  /**
   * Build device profile from calibration data
   */
  buildDeviceProfile(
    calibrationFrames: number,
    stableSettings: { exposureCompensation: number; iso: number; frameRate: number; torch: boolean },
    noiseFloor: number,
    maxSignal: number
  ): DeviceCalibrationProfile {
    const profile: DeviceCalibrationProfile = {
      userAgent: navigator.userAgent,
      deviceModel: undefined, // Would need platform detection library
      gammaEstimated: 2.2,
      gammaConfidence: 0.8,
      stableOperatingPoint: stableSettings,
      initialChannelWeights: { red: 0.35, green: 0.45, blue: 0.20 },
      deviceSpecificThresholds: {
        clippingHigh: Math.min(255, 250 + noiseFloor * 10),
        clippingLow: Math.max(0, 5 - noiseFloor),
        minSignalAmplitude: noiseFloor * 3,
        maxSignalAmplitude: maxSignal * 0.9,
      },
      calibrationDate: Date.now(),
      calibrationFrames,
      persistKey: this.generateProfileKey(),
    };
    
    this.saveDeviceProfile(profile);
    return profile;
  }
}

// Export singleton para uso global
export const radiometricProcessor = new RadiometricProcessor();
