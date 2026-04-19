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

export interface TileRadiometricResult {
  /** sRGB → linear (gamma-corrected) channel value, normalized 0..1 */
  linearR: number;
  linearG: number;
  linearB: number;
  /** Linearized values mapped back to 0..255 for backwards compat */
  linearR8: number;
  linearG8: number;
  linearB8: number;
  /** Optical density (OD) per channel: −log(I/Iref) */
  odR: number;
  odG: number;
  odB: number;
}

const PERSISTED_PROFILE_KEY = 'cppg.device_profile.v1';

export class RadiometricProcessor {
  private profile: DeviceProfile;
  private referenceR: number = 100;
  private referenceG: number = 100;
  private referenceB: number = 100;
  private refUpdateCount = 0;
  private readonly REF_UPDATE_INTERVAL = 60; // Update reference every 60 frames

  // Tile-domain reference (works in linear 0..1 space)
  private linRefR = 0.5;
  private linRefG = 0.5;
  private linRefB = 0.5;
  private linRefInitialized = false;
  private readonly LIN_REF_ALPHA = 0.02;

  // Bootstrap state for dark frame and white point
  private darkFrameSamples = 0;
  private darkAccumR = 0;
  private darkAccumG = 0;
  private darkAccumB = 0;

  private whitePointSamples = 0;
  private whitePointMaxR = 0;
  private whitePointMaxG = 0;
  private whitePointMaxB = 0;

  // Drift tracking for re-bootstrap decisions
  private whitePointDriftEMA = 0;
  private whitePointDriftCount = 0;

  // Reusable buffers to avoid allocations (only used by per-pixel process())
  private linearRBuf: Float32Array;
  private linearGBuf: Float32Array;
  private linearBBuf: Float32Array;
  private odRBuf: Float32Array;
  private odGBuf: Float32Array;
  private odBBuf: Float32Array;

  constructor(deviceModelId: string = 'generic', width: number = 1280, height: number = 720) {
    this.profile = DEVICE_PROFILES[deviceModelId] || PROFILE_GENERIC;
    this.tryLoadPersistedProfile();

    const pixelCount = width * height;
    this.linearRBuf = new Float32Array(pixelCount);
    this.linearGBuf = new Float32Array(pixelCount);
    this.linearBBuf = new Float32Array(pixelCount);
    this.odRBuf = new Float32Array(pixelCount);
    this.odGBuf = new Float32Array(pixelCount);
    this.odBBuf = new Float32Array(pixelCount);
  }

  // ─────────────────────────────────────────────────────────────────
  // PROFILE PERSISTENCE
  // ─────────────────────────────────────────────────────────────────

  private tryLoadPersistedProfile(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(PERSISTED_PROFILE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<DeviceProfile>;
      if (parsed && typeof parsed === 'object') {
        this.profile = { ...this.profile, ...parsed };
      }
    } catch {
      // best-effort persistence — silently ignore corrupt storage
    }
  }

  private persistProfile(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(PERSISTED_PROFILE_KEY, JSON.stringify(this.profile));
    } catch {
      // ignore (private mode etc.)
    }
  }
  
  /**
   * Update device profile (e.g., from user calibration or bootstrap)
   */
  public setProfile(profile: Partial<DeviceProfile>): void {
    this.profile = { ...this.profile, ...profile };
    this.persistProfile();
  }

  /**
   * Get current profile
   */
  public getProfile(): DeviceProfile {
    return this.profile;
  }

  /**
   * Reset all temporal state (references, drift, bootstrap counters).
   * Profile is preserved (it represents the device, not the session).
   */
  public reset(): void {
    this.referenceR = 100; this.referenceG = 100; this.referenceB = 100;
    this.refUpdateCount = 0;
    this.linRefR = 0.5; this.linRefG = 0.5; this.linRefB = 0.5;
    this.linRefInitialized = false;
    this.darkFrameSamples = 0;
    this.darkAccumR = 0; this.darkAccumG = 0; this.darkAccumB = 0;
    this.whitePointSamples = 0;
    this.whitePointMaxR = 0; this.whitePointMaxG = 0; this.whitePointMaxB = 0;
    this.whitePointDriftEMA = 0;
    this.whitePointDriftCount = 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // FAST PATH: process per-tile aggregated RGB (no allocation, O(1))
  // ─────────────────────────────────────────────────────────────────

  /**
   * Linearize and compute OD for a single aggregated RGB triplet (e.g. mean
   * of a tile). Designed to be called 49× per frame (or per pixel only when
   * absolutely needed). Zero allocations.
   *
   * Pipeline:
   *  1. Subtract dark offset (sRGB units)
   *  2. sRGB → linear via gamma
   *  3. Apply per-channel gain
   *  4. Compute OD = −log(linear / linRef) using running tile-domain reference
   *  5. Update reference EWMA in linear space
   */
  public processTileRGB(meanR: number, meanG: number, meanB: number): TileRadiometricResult {
    const { gamma, gainR, gainG, gainB, darkOffsetR, darkOffsetG, darkOffsetB, whiteLevel } = this.profile;

    // 1. Dark-offset subtraction (clip ≥0)
    const r0 = Math.max(0, meanR - darkOffsetR) / whiteLevel;
    const g0 = Math.max(0, meanG - darkOffsetG) / whiteLevel;
    const b0 = Math.max(0, meanB - darkOffsetB) / whiteLevel;

    // 2. sRGB → linear
    const rLin0 = Math.pow(r0, gamma);
    const gLin0 = Math.pow(g0, gamma);
    const bLin0 = Math.pow(b0, gamma);

    // 3. Per-channel gain (clamp 0..1)
    const rLin = Math.min(1, rLin0 * gainR);
    const gLin = Math.min(1, gLin0 * gainG);
    const bLin = Math.min(1, bLin0 * gainB);

    // 4. Update tile-domain linear reference (EWMA), gate to plausible midtones
    if (!this.linRefInitialized) {
      this.linRefR = Math.max(0.05, rLin);
      this.linRefG = Math.max(0.05, gLin);
      this.linRefB = Math.max(0.05, bLin);
      this.linRefInitialized = true;
    } else {
      const alpha = this.LIN_REF_ALPHA;
      this.linRefR = this.linRefR * (1 - alpha) + Math.max(0.05, rLin) * alpha;
      this.linRefG = this.linRefG * (1 - alpha) + Math.max(0.05, gLin) * alpha;
      this.linRefB = this.linRefB * (1 - alpha) + Math.max(0.05, bLin) * alpha;
    }

    // 5. Optical density
    const eps = 1e-6;
    const odR = -Math.log(Math.max(eps, rLin) / Math.max(eps, this.linRefR));
    const odG = -Math.log(Math.max(eps, gLin) / Math.max(eps, this.linRefG));
    const odB = -Math.log(Math.max(eps, bLin) / Math.max(eps, this.linRefB));

    return {
      linearR: rLin,
      linearG: gLin,
      linearB: bLin,
      linearR8: rLin * 255,
      linearG8: gLin * 255,
      linearB8: bLin * 255,
      odR, odG, odB,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // BOOTSTRAP DARK FRAME — call N frames with torch OFF before lock
  // ─────────────────────────────────────────────────────────────────

  /**
   * Accumulate dark-frame statistics. Call this with the first frames captured
   * BEFORE the torch is enabled. After ≥5 samples, the device profile dark
   * offsets are updated and persisted.
   */
  public bootstrapDarkFrame(imageData: ImageData): void {
    const { data } = imageData;
    let sumR = 0, sumG = 0, sumB = 0;
    let n = 0;
    // Sample sparsely (every 16 pixels) — dark estimation is stable
    for (let i = 0; i < data.length; i += 64) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      n++;
    }
    if (n === 0) return;

    this.darkAccumR += sumR / n;
    this.darkAccumG += sumG / n;
    this.darkAccumB += sumB / n;
    this.darkFrameSamples++;

    if (this.darkFrameSamples >= 5) {
      const dR = this.darkAccumR / this.darkFrameSamples;
      const dG = this.darkAccumG / this.darkFrameSamples;
      const dB = this.darkAccumB / this.darkFrameSamples;
      // Conservative cap: never claim a "dark offset" >50 (would be a bug)
      this.profile = {
        ...this.profile,
        darkOffsetR: Math.min(50, dR),
        darkOffsetG: Math.min(50, dG),
        darkOffsetB: Math.min(50, dB),
        timestampCreated: Date.now(),
      };
      this.persistProfile();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // BOOTSTRAP WHITE POINT — call when finger is firmly placed + torch ON
  // ─────────────────────────────────────────────────────────────────

  /**
   * Accumulate white-point statistics during stable contact. After several
   * samples, update profile.whiteLevel to the per-channel max, which improves
   * AC/DC normalization across devices.
   */
  public bootstrapWhitePoint(imageData: ImageData, isFingerPresent: boolean): void {
    if (!isFingerPresent) return;
    const { data } = imageData;
    let mR = 0, mG = 0, mB = 0;
    for (let i = 0; i < data.length; i += 32) {
      if (data[i] > mR) mR = data[i];
      if (data[i + 1] > mG) mG = data[i + 1];
      if (data[i + 2] > mB) mB = data[i + 2];
    }
    this.whitePointMaxR = Math.max(this.whitePointMaxR, mR);
    this.whitePointMaxG = Math.max(this.whitePointMaxG, mG);
    this.whitePointMaxB = Math.max(this.whitePointMaxB, mB);
    this.whitePointSamples++;

    if (this.whitePointSamples >= 30) {
      const observedMax = Math.max(this.whitePointMaxR, this.whitePointMaxG, this.whitePointMaxB);
      // White level should never go below 200 (would mean torch never reaches a midtone red),
      // and should not exceed 255.
      const newWhite = Math.max(200, Math.min(255, observedMax + 5));
      this.profile = { ...this.profile, whiteLevel: newWhite };
      this.persistProfile();
      this.whitePointSamples = 0;
      this.whitePointMaxR = 0; this.whitePointMaxG = 0; this.whitePointMaxB = 0;
    }
  }

  /**
   * Track white-point drift for an arbitrary frame. If drift > 0.15 over 60
   * consecutive frames, rebootstrap is recommended. Call from the main pipeline.
   */
  public trackWhitePointDrift(imageData: ImageData): { drift: number; needsRebootstrap: boolean } {
    const { data } = imageData;
    let mG = 0;
    for (let i = 1; i < data.length; i += 64) {
      if (data[i] > mG) mG = data[i];
    }
    const target = this.profile.whiteLevel;
    const drift = target > 0 ? Math.abs(mG - target) / target : 0;
    this.whitePointDriftEMA = this.whitePointDriftEMA * 0.92 + drift * 0.08;

    if (this.whitePointDriftEMA > 0.15) {
      this.whitePointDriftCount++;
    } else {
      this.whitePointDriftCount = Math.max(0, this.whitePointDriftCount - 1);
    }

    return {
      drift: this.whitePointDriftEMA,
      needsRebootstrap: this.whitePointDriftCount >= 60,
    };
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
