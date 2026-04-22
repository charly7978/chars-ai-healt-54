/**
 * Advanced Color Space Analyzer for Enhanced Finger Detection
 * 
 * Implements multiple color space transformations for robust skin/finger detection:
 * 1. YCbCr - Luminance-Chrominance separation (excellent for skin detection)
 * 2. HSV - Hue-Saturation-Value (illumination-invariant)
 * 3. YIQ - Another luminance-chrominance space
 * 4. Normalized RGB - Illumination normalization
 * 
 * Skin Detection Models:
 * - YCbCr: Cr ∈ [133, 173], Cb ∈ [77, 127] (standard skin ranges)
 * - HSV: H ∈ [0, 50], S ∈ [0.23, 0.68] (skin hue/saturation)
 * - Adaptive thresholds based on frame statistics
 * 
 * Advantages over RGB-only:
 * - Illumination invariance
 * - Better separation of skin from background
 * - Robust to lighting changes
 * - Improved detection under varying flash intensity
 */

export interface ColorSpaceMetrics {
  // RGB
  r: number;
  g: number;
  b: number;
  
  // Normalized RGB (illumination invariant)
  nr: number;
  ng: number;
  nb: number;
  
  // YCbCr (ITU-R BT.601)
  Y: number;
  Cb: number;
  Cr: number;
  
  // HSV
  h: number;
  s: number;
  v: number;
  
  // YIQ
  Yiq: number;
  I: number;
  Q: number;
  
  // Skin probability scores
  ycbcrSkinScore: number;
  hsvSkinScore: number;
  combinedSkinScore: number;
}

export interface AdvancedTileMetrics {
  baseMetrics: {
    meanR: number;
    meanG: number;
    meanB: number;
    redDominance: number;
    rgRatio: number;
    intensity: number;
  };
  colorSpaceMetrics: ColorSpaceMetrics;
  skinProbability: number;
  illuminationInvariant: number;
  textureScore: number;
  finalScore: number;
}

/**
 * Advanced color space transformations and skin detection
 */
export class AdvancedColorSpaceAnalyzer {
  // Adaptive skin thresholds (updated from frame statistics)
  private ycbcrCrMin = 133;
  private ycbcrCrMax = 173;
  private ycbcrCbMin = 77;
  private ycbcrCbMax = 127;
  
  private hsvHMin = 0;
  private hsvHMax = 50;
  private hsvSMin = 0.23;
  private hsvSMax = 0.68;
  
  // Frame statistics for adaptive thresholds
  private frameYMean = 0;
  private frameCbMean = 0;
  private frameCrMean = 0;
  private frameHMean = 0;
  private frameSMean = 0;

  /**
   * Convert RGB to YCbCr (ITU-R BT.601 standard)
   * Y = 0.299*R + 0.587*G + 0.114*B
   * Cb = 128 - 0.168736*R - 0.331264*G + 0.5*B
   * Cr = 128 + 0.5*R - 0.418688*G - 0.081312*B
   */
  rgbToYCbCr(r: number, g: number, b: number): { Y: number; Cb: number; Cr: number } {
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return { Y, Cb, Cr };
  }

  /**
   * Convert RGB to HSV
   * H: 0-360 (hue angle)
   * S: 0-1 (saturation)
   * V: 0-1 (value/brightness)
   */
  rgbToHSV(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;

    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;

    let h = 0;
    if (delta === 0) {
      h = 0;
    } else if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }

    const s = max === 0 ? 0 : delta / max;
    const v = max;

    return { h: h < 0 ? h + 360 : h, s, v };
  }

  /**
   * Convert RGB to YIQ (NTSC standard)
   * Y = 0.299*R + 0.587*G + 0.114*B
   * I = 0.596*R - 0.274*G - 0.322*B
   * Q = 0.211*R - 0.523*G + 0.312*B
   */
  rgbToYIQ(r: number, g: number, b: number): { Yiq: number; I: number; Q: number } {
    const Yiq = 0.299 * r + 0.587 * g + 0.114 * b;
    const I = 0.596 * r - 0.274 * g - 0.322 * b;
    const Q = 0.211 * r - 0.523 * g + 0.312 * b;
    return { Yiq, I, Q };
  }

  /**
   * Normalize RGB to remove illumination dependency
   * nr = R / (R+G+B), etc.
   */
  normalizeRGB(r: number, g: number, b: number): { nr: number; ng: number; nb: number } {
    const sum = r + g + b;
    if (sum === 0) return { nr: 0, ng: 0, nb: 0 };
    return {
      nr: r / sum,
      ng: g / sum,
      nb: b / sum
    };
  }

  /**
   * Compute skin probability in YCbCr space
   * Uses standard skin detection ranges with adaptive thresholds
   */
  computeYCbCrSkinScore(Y: number, Cb: number, Cr: number): number {
    // Standard skin detection ranges (from literature)
    const crScore = this.sigmoid(Cr, this.ycbcrCrMin, this.ycbcrCrMax);
    const cbScore = this.sigmoid(Cb, this.ycbcrCbMin, this.ycbcrCbMax);
    
    // Y should be in reasonable range (not too dark/bright)
    const yScore = Y > 50 && Y < 220 ? 1 : 0.5;
    
    return (crScore + cbScore) / 2 * yScore;
  }

  /**
   * Compute skin probability in HSV space
   * Skin typically has: H ∈ [0, 50], S ∈ [0.23, 0.68]
   */
  computeHSVSkinScore(h: number, s: number, v: number): number {
    // Hue score (skin is reddish)
    const hScore = h >= this.hsvHMin && h <= this.hsvHMax ? 1 : 
                   h > 350 ? 0.5 : 0; // Handle wraparound near 360
    
    // Saturation score (not grayscale, not oversaturated)
    const sScore = this.sigmoid(s, this.hsvSMin, this.hsvSMax);
    
    // Value score (not too dark)
    const vScore = v > 0.2 ? 1 : v * 5;
    
    return (hScore * 0.5 + sScore * 0.3 + vScore * 0.2);
  }

  /**
   * Sigmoid function for smooth thresholding
   */
  private sigmoid(x: number, min: number, max: number): number {
    if (x < min) return 0;
    if (x > max) return 1;
    const center = (min + max) / 2;
    const width = (max - min) / 4;
    return 1 / (1 + Math.exp(-(x - center) / width));
  }

  /**
   * Compute comprehensive color space metrics for a pixel
   */
  computePixelMetrics(r: number, g: number, b: number): ColorSpaceMetrics {
    const normalized = this.normalizeRGB(r, g, b);
    const ycbcr = this.rgbToYCbCr(r, g, b);
    const hsv = this.rgbToHSV(r, g, b);
    const yiq = this.rgbToYIQ(r, g, b);

    const ycbcrSkinScore = this.computeYCbCrSkinScore(ycbcr.Y, ycbcr.Cb, ycbcr.Cr);
    const hsvSkinScore = this.computeHSVSkinScore(hsv.h, hsv.s, hsv.v);
    const combinedSkinScore = (ycbcrSkinScore * 0.6 + hsvSkinScore * 0.4);

    return {
      r, g, b,
      nr: normalized.nr,
      ng: normalized.ng,
      nb: normalized.nb,
      Y: ycbcr.Y,
      Cb: ycbcr.Cb,
      Cr: ycbcr.Cr,
      h: hsv.h,
      s: hsv.s,
      v: hsv.v,
      Yiq: yiq.Yiq,
      I: yiq.I,
      Q: yiq.Q,
      ycbcrSkinScore,
      hsvSkinScore,
      combinedSkinScore
    };
  }

  /**
   * Update adaptive thresholds based on frame statistics
   */
  updateAdaptiveThresholds(allPixels: ColorSpaceMetrics[]): void {
    if (allPixels.length === 0) return;

    // Compute statistics
    let sumY = 0, sumCb = 0, sumCr = 0;
    let sumH = 0, sumS = 0;
    
    for (const p of allPixels) {
      sumY += p.Y;
      sumCb += p.Cb;
      sumCr += p.Cr;
      sumH += p.h;
      sumS += p.s;
    }

    const n = allPixels.length;
    this.frameYMean = sumY / n;
    this.frameCbMean = sumCb / n;
    this.frameCrMean = sumCr / n;
    this.frameHMean = sumH / n;
    this.frameSMean = sumS / n;

    // Adaptive skin ranges based on frame statistics
    // Cr range adapts to illumination
    this.ycbcrCrMin = Math.max(120, this.frameCrMean - 20);
    this.ycbcrCrMax = Math.min(180, this.frameCrMean + 20);
    
    // Cb range
    this.ycbcrCbMin = Math.max(70, this.frameCbMean - 15);
    this.ycbcrCbMax = Math.min(130, this.frameCbMean + 15);
    
    // HSV saturation adapts
    this.hsvSMin = Math.max(0.15, this.frameSMean - 0.1);
    this.hsvSMax = Math.min(0.8, this.frameSMean + 0.15);
  }

  /**
   * Compute illumination-invariant feature
   * Uses normalized RGB ratios that are independent of lighting intensity
   */
  computeIlluminationInvariant(metrics: ColorSpaceMetrics): number {
    // R/G ratio in normalized space
    const rgRatio = metrics.ng > 0.01 ? metrics.nr / metrics.ng : 0;
    
    // Skin typically has R/G > 1.0
    const skinRatio = Math.max(0, Math.min(1, (rgRatio - 0.8) / 0.8));
    
    // Combined with chrominance skin score
    return (metrics.combinedSkinScore * 0.7 + skinRatio * 0.3);
  }

  /**
   * Compute texture score using local variance
   * Skin has moderate texture (not uniform like wall, not chaotic like noise)
   */
  computeTextureScore(localPixels: ColorSpaceMetrics[]): number {
    if (localPixels.length < 4) return 0;

    // Compute variance in normalized green channel
    let meanNg = 0;
    for (const p of localPixels) {
      meanNg += p.ng;
    }
    meanNg /= localPixels.length;

    let variance = 0;
    for (const p of localPixels) {
      variance += (p.ng - meanNg) ** 2;
    }
    variance /= localPixels.length;

    // Skin has moderate variance (not too low, not too high)
    const textureScore = variance > 0.001 && variance < 0.01 ? 1 : 
                       variance < 0.001 ? 0.5 : 0.3;

    return textureScore;
  }

  /**
   * Enhanced finger detection combining multiple color spaces
   */
  detectFingerTile(
    tilePixels: ColorSpaceMetrics[],
    baseMetrics: { meanR: number; meanG: number; meanB: number; redDominance: number; rgRatio: number; intensity: number }
  ): AdvancedTileMetrics {
    if (tilePixels.length === 0) {
      return {
        baseMetrics: { meanR: 0, meanG: 0, meanB: 0, redDominance: 0, rgRatio: 0, intensity: 0 },
        colorSpaceMetrics: this.computePixelMetrics(0, 0, 0),
        skinProbability: 0,
        illuminationInvariant: 0,
        textureScore: 0,
        finalScore: 0
      };
    }

    // Average color space metrics over tile
    let avgMetrics: ColorSpaceMetrics = tilePixels[0];
    for (let i = 1; i < tilePixels.length; i++) {
      avgMetrics = {
        r: (avgMetrics.r + tilePixels[i].r) / 2,
        g: (avgMetrics.g + tilePixels[i].g) / 2,
        b: (avgMetrics.b + tilePixels[i].b) / 2,
        nr: (avgMetrics.nr + tilePixels[i].nr) / 2,
        ng: (avgMetrics.ng + tilePixels[i].ng) / 2,
        nb: (avgMetrics.nb + tilePixels[i].nb) / 2,
        Y: (avgMetrics.Y + tilePixels[i].Y) / 2,
        Cb: (avgMetrics.Cb + tilePixels[i].Cb) / 2,
        Cr: (avgMetrics.Cr + tilePixels[i].Cr) / 2,
        h: (avgMetrics.h + tilePixels[i].h) / 2,
        s: (avgMetrics.s + tilePixels[i].s) / 2,
        v: (avgMetrics.v + tilePixels[i].v) / 2,
        Yiq: (avgMetrics.Yiq + tilePixels[i].Yiq) / 2,
        I: (avgMetrics.I + tilePixels[i].I) / 2,
        Q: (avgMetrics.Q + tilePixels[i].Q) / 2,
        ycbcrSkinScore: (avgMetrics.ycbcrSkinScore + tilePixels[i].ycbcrSkinScore) / 2,
        hsvSkinScore: (avgMetrics.hsvSkinScore + tilePixels[i].hsvSkinScore) / 2,
        combinedSkinScore: (avgMetrics.combinedSkinScore + tilePixels[i].combinedSkinScore) / 2
      };
    }

    const skinProbability = avgMetrics.combinedSkinScore;
    const illuminationInvariant = this.computeIlluminationInvariant(avgMetrics);
    const textureScore = this.computeTextureScore(tilePixels);

    // Combined score with weighted components
    // Skin probability is most important
    const finalScore = 
      skinProbability * 0.5 +
      illuminationInvariant * 0.25 +
      textureScore * 0.15 +
      (baseMetrics.redDominance > 5 ? 0.1 : 0);

    return {
      baseMetrics,
      colorSpaceMetrics: avgMetrics,
      skinProbability,
      illuminationInvariant,
      textureScore,
      finalScore
    };
  }

  /**
   * Reset adaptive thresholds
   */
  reset(): void {
    this.ycbcrCrMin = 133;
    this.ycbcrCrMax = 173;
    this.ycbcrCbMin = 77;
    this.ycbcrCbMax = 127;
    this.hsvHMin = 0;
    this.hsvHMax = 50;
    this.hsvSMin = 0.23;
    this.hsvSMax = 0.68;
    this.frameYMean = 0;
    this.frameCbMean = 0;
    this.frameCrMean = 0;
    this.frameHMean = 0;
    this.frameSMean = 0;
  }
}
