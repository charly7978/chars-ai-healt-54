/**
 * FINGER CONTACT CLASSIFIER
 * 
 * Multi-feature finger detection using:
 * - normalized RGB, HSV, YCbCr
 * - saturation analysis
 * - total and center coverage
 * - circularity/compactness
 * - edge penalty
 * - entropy
 * - gradient
 * - temporal stability
 * - spatial uniformity
 * - hot spots (specular reflections)
 * 
 * Classifies states compatible with signal.d.ts
 */

import type { FingerContactState as ContactState } from '../../types/signal';

export type { ContactState };

export interface ContactFeatures {
  // RGB features
  meanR: number;
  meanG: number;
  meanB: number;
  normalizedR: number;
  normalizedG: number;
  normalizedB: number;
  redDominance: number;
  rgRatio: number;
  
  // HSV features
  hue: number;
  saturation: number;
  value: number;
  saturationHigh: boolean;
  saturationLow: boolean;
  
  // YCbCr features
  y: number;
  cb: number;
  cr: number;
  
  // Coverage
  totalCoverage: number;
  centerCoverage: number;
  
  // Shape
  circularity: number;
  compactness: number;
  
  // Edge
  edgePenalty: number;
  
  // Texture
  entropy: number;
  gradient: number;
  
  // Quality
  spatialUniformity: number;
  hotSpotRatio: number;
  
  // Clipping
  clipHighRatio: number;
  clipLowRatio: number;
  
  // Temporal
  temporalStability: number;
}

export interface ContactClassification {
  state: ContactState;
  confidence: number;
  features: ContactFeatures;
  guidance: string;
}

export class FingerContactClassifier {
  private prevFeatures: ContactFeatures | null = null;
  private stateHistory: ContactState[] = [];
  private readonly HISTORY_SIZE = 10;
  private readonly CLIP_HIGH = 250;
  private readonly CLIP_LOW = 5;

  /**
   * RGB to HSV conversion
   */
  private rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;

    let h = 0;
    let s = 0;
    const v = max;

    if (delta !== 0) {
      s = delta / max;
      if (max === rn) {
        h = ((gn - bn) / delta) % 6;
      } else if (max === gn) {
        h = (bn - rn) / delta + 2;
      } else {
        h = (rn - gn) / delta + 4;
      }
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }

    return { h, s, v };
  }

  /**
   * RGB to YCbCr conversion (ITU-R BT.601)
   */
  private rgbToYCbCr(r: number, g: number, b: number): { y: number; cb: number; cr: number } {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return { y, cb, cr };
  }

  /**
   * Compute entropy of pixel values
   */
  private computeEntropy(values: number[]): number {
    if (values.length === 0) return 0;
    
    const histogram = new Array(256).fill(0);
    for (const v of values) {
      const bin = Math.min(255, Math.max(0, Math.round(v)));
      histogram[bin]++;
    }
    
    let entropy = 0;
    const total = values.length;
    for (let i = 0; i < 256; i++) {
      if (histogram[i] > 0) {
        const p = histogram[i] / total;
        entropy -= p * Math.log2(p);
      }
    }
    
    return entropy;
  }

  /**
   * Compute gradient magnitude
   */
  private computeGradient(pixels: Uint8ClampedArray, width: number, height: number): number {
    let totalGradient = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        const gx = -pixels[i - 4] + pixels[i + 4];
        const gy = -pixels[i - width * 4] + pixels[i + width * 4];
        const gradient = Math.sqrt(gx * gx + gy * gy);
        totalGradient += gradient;
        count++;
      }
    }

    return count > 0 ? totalGradient / count : 0;
  }

  /**
   * Extract features from image data
   */
  extractFeatures(imageData: ImageData, validMask?: Uint8Array): ContactFeatures {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    
    // Central ROI (80% of min dimension)
    const roiSize = Math.min(w, h) * 0.80;
    const sx = Math.floor((w - roiSize) / 2);
    const sy = Math.floor((h - roiSize) / 2);
    const ex = sx + Math.floor(roiSize);
    const ey = sy + Math.floor(roiSize);
    const roiW = ex - sx;
    const roiH = ey - sy;

    let sumR = 0, sumG = 0, sumB = 0;
    let totalIntensity = 0;
    let totalPixels = 0;
    let validPixels = 0;
    let clipHighCount = 0;
    let clipLowCount = 0;
    let hotSpotCount = 0;
    
    const pixelValues: number[] = [];
    const centerPixels: number[] = [];
    
    // Center region (inner 50%)
    const cx1 = sx + Math.floor(roiW * 0.25);
    const cy1 = sy + Math.floor(roiH * 0.25);
    const cx2 = sx + Math.floor(roiW * 0.75);
    const cy2 = sy + Math.floor(roiH * 0.75);

    // Sample every 2nd pixel for performance
    const step = 2;
    for (let y = sy; y < ey; y += step) {
      for (let x = sx; x < ex; x += step) {
        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        totalPixels++;
        
        // Check clipping
        const isClipHigh = r >= this.CLIP_HIGH || g >= this.CLIP_HIGH || b >= this.CLIP_HIGH;
        const isClipLow = r <= this.CLIP_LOW && g <= this.CLIP_LOW && b <= this.CLIP_LOW;
        
        if (isClipHigh) clipHighCount++;
        if (isClipLow) clipLowCount++;
        
        // Hot spot detection (very bright saturated pixels)
        const intensity = r + g + b;
        if (intensity > 720 && r > 245 && g > 240 && b > 235) {
          hotSpotCount++;
        }

        // Check if valid (non-clipped)
        const isValid = !isClipHigh && !isClipLow;
        if (validMask && validMask[totalPixels % validMask.length] === 0) {
          // Skip if masked as invalid
        } else if (isValid) {
          validPixels++;
          sumR += r;
          sumG += g;
          sumB += b;
          totalIntensity += intensity;
          pixelValues.push(intensity);
          
          // Center pixels
          if (x >= cx1 && x < cx2 && y >= cy1 && y < cy2) {
            centerPixels.push(intensity);
          }
        }
      }
    }

    const meanR = validPixels > 0 ? sumR / validPixels : 0;
    const meanG = validPixels > 0 ? sumG / validPixels : 0;
    const meanB = validPixels > 0 ? sumB / validPixels : 0;
    const totalI = meanR + meanG + meanB;

    // Normalized RGB
    const normalizedR = totalI > 0 ? meanR / totalI : 0;
    const normalizedG = totalI > 0 ? meanG / totalI : 0;
    const normalizedB = totalI > 0 ? meanB / totalI : 0;

    // Red dominance and RG ratio
    const redDominance = meanR - (meanG + meanB) / 2;
    const rgRatio = meanG > 1 ? meanR / meanG : 0;

    // HSV
    const hsv = this.rgbToHsv(meanR, meanG, meanB);
    const saturationHigh = hsv.s > 0.6;
    const saturationLow = hsv.s < 0.1;

    // YCbCr
    const ycbcr = this.rgbToYCbCr(meanR, meanG, meanB);

    // Coverage
    const totalCoverage = validPixels / totalPixels;
    const centerCoverage = centerPixels.length > 0 ? centerPixels.length / (totalPixels * 0.25) : 0;

    // Circularity and compactness (simplified)
    const circularity = totalCoverage > 0.5 ? 1.0 : totalCoverage * 2;
    const compactness = spatialUniformityFromVariance(pixelValues);

    // Edge penalty (gradient)
    const gradient = this.computeGradient(data, w, h);
    const edgePenalty = Math.min(1, gradient / 50);

    // Entropy
    const entropy = this.computeEntropy(pixelValues);

    // Spatial uniformity
    const spatialUniformity = compactness;

    // Hot spot ratio
    const hotSpotRatio = totalPixels > 0 ? hotSpotCount / totalPixels : 0;

    // Clipping ratios
    const clipHighRatio = totalPixels > 0 ? clipHighCount / totalPixels : 0;
    const clipLowRatio = totalPixels > 0 ? clipLowCount / totalPixels : 0;

    // Temporal stability
    let temporalStability = 1.0;
    if (this.prevFeatures) {
      const dr = Math.abs(meanR - this.prevFeatures.meanR) / (this.prevFeatures.meanR + 1);
      const dg = Math.abs(meanG - this.prevFeatures.meanG) / (this.prevFeatures.meanG + 1);
      const db = Math.abs(meanB - this.prevFeatures.meanB) / (this.prevFeatures.meanB + 1);
      const dcov = Math.abs(totalCoverage - this.prevFeatures.totalCoverage);
      temporalStability = Math.max(0, 1 - (dr + dg + db + dcov) / 4);
    }

    const features: ContactFeatures = {
      meanR, meanG, meanB,
      normalizedR, normalizedG, normalizedB,
      redDominance, rgRatio,
      hue: hsv.h,
      saturation: hsv.s,
      value: hsv.v,
      saturationHigh, saturationLow,
      y: ycbcr.y,
      cb: ycbcr.cb,
      cr: ycbcr.cr,
      totalCoverage,
      centerCoverage,
      circularity,
      compactness,
      edgePenalty,
      entropy,
      gradient,
      spatialUniformity,
      hotSpotRatio,
      clipHighRatio,
      clipLowRatio,
      temporalStability,
    };

    this.prevFeatures = features;
    return features;
  }

  /**
   * Classify contact state from features
   */
  classify(features: ContactFeatures, motionScore: number = 0): ContactClassification {
    const {
      meanR, meanG, meanB,
      redDominance, rgRatio,
      saturation, saturationHigh, saturationLow,
      totalCoverage, centerCoverage,
      circularity, compactness,
      edgePenalty, entropy,
      spatialUniformity, hotSpotRatio,
      clipHighRatio, clipLowRatio,
      temporalStability,
    } = features;

    let state: ContactState = 'NO_FINGER';
    let confidence = 0;
    let guidance = 'COLOQUE SU DEDO SOBRE LA CÁMARA Y EL FLASH';

    // Check for excessive clipping first
    if (clipHighRatio > 0.3) {
      state = 'EXCESSIVE_CLIPPING';
      confidence = 0.9;
      guidance = 'REDUZCA LA PRESIÓN - DEMASIADO CLIPPING';
      this.updateHistory(state);
      return { state, confidence, features, guidance };
    }

    // Check for motion contamination
    if (motionScore > 0.8) {
      state = 'MOTION_CONTAMINATED';
      confidence = 0.85;
      guidance = 'MANTENGA EL DEDO QUIETO';
      this.updateHistory(state);
      return { state, confidence, features, guidance };
    }

    // Check for under-illumination
    if (meanR < 40 && meanG < 40 && meanB < 40) {
      state = 'UNDERILLUMINATED';
      confidence = 0.85;
      guidance = 'ACTIVE EL FLASH O ACERQUE EL DEDO';
      this.updateHistory(state);
      return { state, confidence, features, guidance };
    }

    // Check for overpressure (high clipping + high coverage)
    if (clipHighRatio > 0.15 && totalCoverage > 0.7 && redDominance < 15) {
      state = 'OVERPRESSURE';
      confidence = 0.8;
      guidance = 'REDUZCA LA PRESIÓN DEL DEDO';
      this.updateHistory(state);
      return { state, confidence, features, guidance };
    }

    // Finger detection thresholds
    const hasFingerSignature = 
      redDominance > 10 &&
      rgRatio > 1.05 &&
      totalCoverage > 0.15 &&
      spatialUniformity > 0.3 &&
      !saturationLow &&
      meanR > 50;

    if (!hasFingerSignature) {
      state = 'NO_FINGER';
      confidence = 0.9;
      if (totalCoverage < 0.1) {
        guidance = 'COLOQUE SU DEDO SOBRE LA CÁMARA';
      } else if (redDominance < 10) {
        guidance = 'ASEGÚRESE DE QUE SEA SU DEDO';
      } else {
        guidance = 'AJUSTE LA POSICIÓN DEL DEDO';
      }
      this.updateHistory(state);
      return { state, confidence, features, guidance };
    }

    // Differentiate between partial and good contact
    if (totalCoverage >= 0.45 && centerCoverage >= 0.4 && spatialUniformity >= 0.5) {
      state = 'GOOD_CONTACT';
      confidence = Math.min(0.95, 0.7 + totalCoverage * 0.2 + centerCoverage * 0.1);
      
      if (hotSpotRatio > 0.1) {
        guidance = 'EVITE REFLEJOS ESPECULARES';
      } else if (edgePenalty > 0.3) {
        guidance = 'CENTRE EL DEDO MEJOR';
      } else {
        guidance = 'POSICIÓN CORRECTA - MANTENGA ASÍ';
      }
    } else {
      state = 'PARTIAL_CONTACT';
      confidence = 0.7;
      
      if (totalCoverage < 0.3) {
        guidance = 'CUBRA MÁS ÁREA CON SU DEDO';
      } else if (centerCoverage < 0.3) {
        guidance = 'CENTRE EL DEDO SOBRE LA CÁMARA';
      } else if (spatialUniformity < 0.4) {
        guidance = 'APLIQUE PRESIÓN UNIFORME';
      } else {
        guidance = 'AJUSTE LA POSICIÓN DEL DEDO';
      }
    }

    // Apply temporal hysteresis
    const recentStates = this.stateHistory.slice(-5);
    const goodContactCount = recentStates.filter(s => s === 'GOOD_CONTACT').length;
    
    if (state === 'PARTIAL_CONTACT' && goodContactCount >= 3) {
      state = 'GOOD_CONTACT';
      confidence = Math.max(confidence, 0.8);
      guidance = 'POSICIÓN CORRECTA - MANTENGA ASÍ';
    }

    this.updateHistory(state);
    return { state, confidence, features, guidance };
  }

  /**
   * Update state history
   */
  private updateHistory(state: ContactState): void {
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.HISTORY_SIZE) {
      this.stateHistory.shift();
    }
  }

  /**
   * Get recent state distribution
   */
  getStateDistribution(): Record<ContactState, number> {
    const distribution: Record<ContactState, number> = {
      NO_FINGER: 0,
      PARTIAL_CONTACT: 0,
      GOOD_CONTACT: 0,
      OVERPRESSURE: 0,
      UNDERILLUMINATED: 0,
      EXCESSIVE_CLIPPING: 0,
      MOTION_CONTAMINATED: 0,
    };

    for (const state of this.stateHistory) {
      distribution[state]++;
    }

    return distribution;
  }

  /**
   * Reset classifier state
   */
  reset(): void {
    this.prevFeatures = null;
    this.stateHistory = [];
  }
}

/**
 * Compute spatial uniformity from variance
 */
function spatialUniformityFromVariance(values: number[]): number {
  if (values.length < 2) return 0;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  
  return Math.max(0, Math.min(1, 1 - cv));
}
