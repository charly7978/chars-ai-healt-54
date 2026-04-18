/**
 * RADIOMETRIC PROCESSOR — DEVICE-AWARE COLORIMETRIC LINEARIZATION
 * 
 * Transforms raw sRGB video frames into physically-meaningful optical density (OD)
 * and linear intensity values. Maintains device-specific calibration profiles.
 * 
 * Pipeline:
 * 1. sRGB → Linear RGB (inverse gamma correction)
 * 2. Per-channel gain normalization (device model specific)
 * 3. Dark offset estimation and subtraction
 * 4. Optical Density (OD) computation per channel
 * 5. Reference level tracking for temporal stability
 * 
 * References:
 * - van Gastel et al. (Philips 2016): Device radiometric calibration
 * - CIE Standard: sRGB to linear conversion
 * - Tremper & Barker: Optical density fundamentals
 */

export interface DeviceProfile {
  /** Model/device identifier */
  modelId: string;
  
  /** sRGB gamma (typically 2.2) */
  gamma: number;
  
  /** Per-channel gain multipliers */
  gainR: number;
  gainG: number;
  gainB: number;
  
  /** Dark offset (blacks level) */
  darkOffsetR: number;
  darkOffsetG: number;
  darkOffsetB: number;
  
  /** White level clipping point (typically 255) */
  whiteLevel: number;
  
  /** Tone curve adjustment factors (empirical per model) */
  toneCurveA: number; // Shadow lift
  toneCurveB: number; // Midtone
  toneCurveC: number; // Highlight compression
  
  /** Valid range for signal (after linearization) */
  validRangeMin: number;
  validRangeMax: number;
  
  /** Timestamp of profile creation */
  timestampCreated: number;
  
  /** Calibration confidence 0-1 (1.0 = factory, <0.5 = bootstrap) */
  calibrationConfidence: number;
}

export interface LinearizedFrame {
  /** Linear RGB values (0-1 range post-linearization) */
  linearR: Uint8ClampedArray | Float32Array;
  linearG: Uint8ClampedArray | Float32Array;
  linearB: Uint8ClampedArray | Float32Array;
  
  /** Optical Density per channel (log space) */
  odR: Float32Array;
  odG: Float32Array;
  odB: Float32Array;
  
  /** Reference baseline level per channel (for OD stability) */
  refLevelR: number;
  refLevelG: number;
  refLevelB: number;
  
  /** Histogram statistics pre-linearization */
  histStatsRaw: HistogramStats;
  histStatsLinear: HistogramStats;
  
  /** Quality metrics for this frame */
  qualityMetrics: RadiometricQuality;
  
  /** Dimension */
  width: number;
  height: number;
}

export interface HistogramStats {
  p1: number;
  p5: number;
  p25: number;
  p50: number; // median
  p75: number;
  p95: number;
  p99: number;
  mean: number;
  std: number;
}

export interface RadiometricQuality {
  /** Deviation from expected white level (0 = perfect) */
  whitePointDrift: number;
  
  /** Clipping ratio high end (should be low) */
  clipHighRatio: number;
  
  /** Clipping ratio low end (should be low) */
  clipLowRatio: number;
  
  /** Dynamic range of linearized signal (higher = better) */
  dynamicRange: number;
  
  /** Gamma estimation quality (0-1) */
  gammaEstimateConfidence: number;
  
  /** Overall radiometric health 0-100 */
  overallQuality: number;
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULT DEVICE PROFILES (Bootstrap)
// ═══════════════════════════════════════════════════════════════════

const PROFILE_GENERIC: DeviceProfile = {
  modelId: 'generic',
  gamma: 2.2,
  gainR: 1.0,
  gainG: 1.0,
  gainB: 1.0,
  darkOffsetR: 0,
  darkOffsetG: 0,
  darkOffsetB: 0,
  whiteLevel: 255,
  toneCurveA: 0,
  toneCurveB: 1.0,
  toneCurveC: 0,
  validRangeMin: 10,
  validRangeMax: 245,
  timestampCreated: Date.now(),
  calibrationConfidence: 0.3,
};

// Device-specific profiles (can be extended with real calibration data)
const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  'generic': PROFILE_GENERIC,
  // Additional profiles per device model can be added here
};

// ═══════════════════════════════════════════════════════════════════
// RADIOMETRIC PROCESSOR
// ═══════════════════════════════════════════════════════════════════

export class RadiometricProcessor {
  private profile: DeviceProfile;
  private referenceR: number = 100;
  private referenceG: number = 100;
  private referenceB: number = 100;
  private refUpdateCount = 0;
  private readonly REF_UPDATE_INTERVAL = 60; // Update reference every 60 frames
  
  // Reusable buffers to avoid allocations
  private linearRBuf: Float32Array;
  private linearGBuf: Float32Array;
  private linearBBuf: Float32Array;
  private odRBuf: Float32Array;
  private odGBuf: Float32Array;
  private odBBuf: Float32Array;
  
  constructor(deviceModelId: string = 'generic', width: number = 1280, height: number = 720) {
    this.profile = DEVICE_PROFILES[deviceModelId] || PROFILE_GENERIC;
    
    const pixelCount = width * height;
    this.linearRBuf = new Float32Array(pixelCount);
    this.linearGBuf = new Float32Array(pixelCount);
    this.linearBBuf = new Float32Array(pixelCount);
    this.odRBuf = new Float32Array(pixelCount);
    this.odGBuf = new Float32Array(pixelCount);
    this.odBBuf = new Float32Array(pixelCount);
  }
  
  /**
   * Update device profile (e.g., from user calibration or bootstrap)
   */
  public setProfile(profile: Partial<DeviceProfile>): void {
    this.profile = { ...this.profile, ...profile };
  }
  
  /**
   * Get current profile
   */
  public getProfile(): DeviceProfile {
    return this.profile;
  }
  
  /**
   * Process one frame: sRGB → Linear + OD
   */
  public process(imageData: ImageData): LinearizedFrame {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    
    // ── STEP 1: sRGB → Linear (inverse gamma) ──
    this.srgbToLinear(data, pixelCount);
    
    // ── STEP 2: Per-channel gain normalization ──
    this.applyGainNormalization(pixelCount);
    
    // ── STEP 3: Update reference levels (baseline) ──
    this.updateReferenceLevel(pixelCount);
    
    // ── STEP 4: Compute OD ──
    this.computeOpticalDensity(pixelCount);
    
    // ── STEP 5: Compute quality metrics ──
    const quality = this.computeQuality(data, pixelCount);
    
    // ── STEP 6: Compute histogram statistics ──
    const histRaw = this.computeHistogram(data, pixelCount);
    const histLinear = this.computeHistogramLinear(pixelCount);
    
    return {
      linearR: this.linearRBuf,
      linearG: this.linearGBuf,
      linearB: this.linearBBuf,
      odR: this.odRBuf,
      odG: this.odGBuf,
      odB: this.odBBuf,
      refLevelR: this.referenceR,
      refLevelG: this.referenceG,
      refLevelB: this.referenceB,
      histStatsRaw: histRaw,
      histStatsLinear: histLinear,
      qualityMetrics: quality,
      width,
      height,
    };
  }
  
  /**
   * sRGB → Linear RGB using inverse gamma correction
   */
  private srgbToLinear(data: Uint8ClampedArray, pixelCount: number): void {
    const gamma = this.profile.gamma;
    const invGamma = 1.0 / gamma;
    
    for (let i = 0; i < pixelCount; i++) {
      // Each pixel: RGBA
      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;
      
      this.linearRBuf[i] = Math.pow(r, gamma);
      this.linearGBuf[i] = Math.pow(g, gamma);
      this.linearBBuf[i] = Math.pow(b, gamma);
    }
  }
  
  /**
   * Apply per-channel gain and dark offset
   */
  private applyGainNormalization(pixelCount: number): void {
    const { gainR, gainG, gainB, darkOffsetR, darkOffsetG, darkOffsetB } = this.profile;
    const { whiteLevel } = this.profile;
    
    for (let i = 0; i < pixelCount; i++) {
      // Remove dark offset
      let r = Math.max(0, this.linearRBuf[i] - darkOffsetR / whiteLevel);
      let g = Math.max(0, this.linearGBuf[i] - darkOffsetG / whiteLevel);
      let b = Math.max(0, this.linearBBuf[i] - darkOffsetB / whiteLevel);
      
      // Apply gain
      r *= gainR;
      g *= gainG;
      b *= gainB;
      
      // Clamp to valid range
      this.linearRBuf[i] = Math.min(1.0, r);
      this.linearGBuf[i] = Math.min(1.0, g);
      this.linearBBuf[i] = Math.min(1.0, b);
    }
  }
  
  /**
   * Update reference level (running median of midtones)
   */
  private updateReferenceLevel(pixelCount: number): void {
    this.refUpdateCount++;
    
    if (this.refUpdateCount % this.REF_UPDATE_INTERVAL !== 0) {
      return;
    }
    
    // Collect midtone pixels (0.3-0.7 range)
    const midtonesR: number[] = [];
    const midtonesG: number[] = [];
    const midtonesB: number[] = [];
    
    for (let i = 0; i < pixelCount; i++) {
      const r = this.linearRBuf[i];
      const g = this.linearGBuf[i];
      const b = this.linearBBuf[i];
      
      if (r > 0.3 && r < 0.7) midtonesR.push(r);
      if (g > 0.3 && g < 0.7) midtonesG.push(g);
      if (b > 0.3 && b < 0.7) midtonesB.push(b);
    }
    
    // Update reference as median of midtones
    if (midtonesR.length > 0) {
      midtonesR.sort((a, b) => a - b);
      this.referenceR = midtonesR[Math.floor(midtonesR.length / 2)];
    }
    if (midtonesG.length > 0) {
      midtonesG.sort((a, b) => a - b);
      this.referenceG = midtonesG[Math.floor(midtonesG.length / 2)];
    }
    if (midtonesB.length > 0) {
      midtonesB.sort((a, b) => a - b);
      this.referenceB = midtonesB[Math.floor(midtonesB.length / 2)];
    }
  }
  
  /**
   * Compute optical density: OD = -log(I / Iref + eps)
   */
  private computeOpticalDensity(pixelCount: number): void {
    const eps = 1e-6;
    const refR = Math.max(eps, this.referenceR);
    const refG = Math.max(eps, this.referenceG);
    const refB = Math.max(eps, this.referenceB);
    
    for (let i = 0; i < pixelCount; i++) {
      const r = Math.max(eps, this.linearRBuf[i]);
      const g = Math.max(eps, this.linearGBuf[i]);
      const b = Math.max(eps, this.linearBBuf[i]);
      
      this.odRBuf[i] = -Math.log(r / refR);
      this.odGBuf[i] = -Math.log(g / refG);
      this.odBBuf[i] = -Math.log(b / refB);
    }
  }
  
  /**
   * Compute radiometric quality metrics
   */
  private computeQuality(data: Uint8ClampedArray, pixelCount: number): RadiometricQuality {
    const { whiteLevel, validRangeMin, validRangeMax } = this.profile;
    
    let clipHighCount = 0;
    let clipLowCount = 0;
    let inValidRangeCount = 0;
    let minVal = whiteLevel;
    let maxVal = 0;
    
    for (let i = 0; i < pixelCount; i++) {
      const v = data[i * 4 + 1]; // Green channel as representative
      
      if (v > 250) clipHighCount++;
      if (v < 5) clipLowCount++;
      if (v >= validRangeMin && v <= validRangeMax) inValidRangeCount++;
      
      minVal = Math.min(minVal, v);
      maxVal = Math.max(maxVal, v);
    }
    
    const clipHighRatio = clipHighCount / pixelCount;
    const clipLowRatio = clipLowCount / pixelCount;
    const validRangeRatio = inValidRangeCount / pixelCount;
    const dynamicRange = maxVal - minVal;
    
    // Expected white point is around 200-220 in valid signal
    const whitePointError = Math.abs(maxVal - 210) / 210;
    
    // Compute overall quality
    let quality = 100;
    quality -= Math.min(30, clipHighRatio * 100);
    quality -= Math.min(20, clipLowRatio * 100);
    quality -= Math.min(15, whitePointError * 50);
    quality += Math.min(10, validRangeRatio * 15);
    quality = Math.max(0, quality);
    
    return {
      whitePointDrift: whitePointError,
      clipHighRatio,
      clipLowRatio,
      dynamicRange,
      gammaEstimateConfidence: 0.8,
      overallQuality: quality,
    };
  }
  
  /**
   * Compute histogram statistics for raw data
   */
  private computeHistogram(data: Uint8ClampedArray, pixelCount: number): HistogramStats {
    const values: number[] = [];
    
    for (let i = 0; i < pixelCount; i++) {
      values.push(data[i * 4 + 1]); // Green channel
    }
    
    values.sort((a, b) => a - b);
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
    );
    
    return {
      p1: values[Math.floor(pixelCount * 0.01)],
      p5: values[Math.floor(pixelCount * 0.05)],
      p25: values[Math.floor(pixelCount * 0.25)],
      p50: values[Math.floor(pixelCount * 0.50)],
      p75: values[Math.floor(pixelCount * 0.75)],
      p95: values[Math.floor(pixelCount * 0.95)],
      p99: values[Math.floor(pixelCount * 0.99)],
      mean,
      std,
    };
  }
  
  /**
   * Compute histogram statistics for linearized data
   */
  private computeHistogramLinear(pixelCount: number): HistogramStats {
    const values: number[] = [];
    
    for (let i = 0; i < pixelCount; i++) {
      values.push(this.linearGBuf[i]);
    }
    
    values.sort((a, b) => a - b);
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
    );
    
    return {
      p1: values[Math.floor(pixelCount * 0.01)],
      p5: values[Math.floor(pixelCount * 0.05)],
      p25: values[Math.floor(pixelCount * 0.25)],
      p50: values[Math.floor(pixelCount * 0.50)],
      p75: values[Math.floor(pixelCount * 0.75)],
      p95: values[Math.floor(pixelCount * 0.95)],
      p99: values[Math.floor(pixelCount * 0.99)],
      mean,
      std,
    };
  }
}
