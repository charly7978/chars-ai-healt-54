/**
 * Detector híbrido dedo/tejido: combina señal del FrameAnalysisCore (pulsatilidad, cobertura, clipping)
 * con coherencia temporal local ligera. Sin depender solo de rojo/cobertura cuando hay snapshot de pipeline.
 */

import type { FrameAnalysisResult } from './FrameAnalysisCore';

export interface FingerTrackingResult {
  centerX: number;
  centerY: number;
  stabilityScore: number;
  driftVelocity: number;
  contactQuality: number;
  pressureEstimate: number;
  coverageUniformity: number;
  roiMeanR: number;
  roiMeanG: number;
  roiMeanB: number;
  perfusionIndex: number;
  signalToNoiseRatio: number;
  trackedFeatures: number;
  opticalFlowMagnitude: number;
  segmentationConfidence: number;
}

export class AdvancedFingerTracker {
  private readonly HISTORY = 90;
  private readonly signalHistory = new Float32Array(90);
  private historyIndex = 0;
  private lastSnr = 0;

  reset(): void {
    this.signalHistory.fill(0);
    this.historyIndex = 0;
    this.lastSnr = 0;
  }

  /**
   * @param pipelineSnapshot Resultado opcional del núcleo de análisis (misma ventana temporal que PPG).
   */
  processFrame(imageData: ImageData, pipelineSnapshot?: FrameAnalysisResult | null): FingerTrackingResult {
    const { width, height } = imageData;
    const cx = width * 0.5;
    const cy = height * 0.5;

    if (pipelineSnapshot) {
      const p = pipelineSnapshot;
      const pi = p.perfusionIndex;
      this.signalHistory[this.historyIndex] = pi;
      this.historyIndex = (this.historyIndex + 1) % this.HISTORY;
      this.lastSnr = this.computeSNRFromHistory();

      const tissueInstant = Math.max(0, Math.min(1, p.roi.fingerScore * 1.15));
      const temporalStability = p.spatialStabilityROI;
      const pulsatilityScore = Math.max(0, Math.min(1, pi / 10));
      const clipPen = Math.min(1, p.clipHighRatio * 2 + p.clipLowRatio * 1.2);

      const hybrid =
        tissueInstant * 0.28 +
        temporalStability * 0.22 +
        pulsatilityScore * 0.32 +
        Math.max(0, Math.min(1, p.aggregateContactScore)) * 0.18 -
        clipPen * 0.35;

      const contactQuality = Math.max(0, Math.min(100, hybrid * 100));
      const stabilityScore = Math.max(0, Math.min(1, temporalStability * 0.65 + (1 - clipPen) * 0.35));

      return {
        centerX: cx,
        centerY: cy,
        stabilityScore,
        driftVelocity: 1 - temporalStability,
        contactQuality,
        pressureEstimate: p.pressureScore,
        coverageUniformity: p.spatialUniformity,
        roiMeanR: p.rawRed,
        roiMeanG: p.rawGreen,
        roiMeanB: p.rawBlue,
        perfusionIndex: pi,
        signalToNoiseRatio: this.lastSnr,
        trackedFeatures: Math.round(p.coverageRatio * 192),
        opticalFlowMagnitude: p.globalMotion * 12,
        segmentationConfidence: tissueInstant,
      };
    }

    // Fallback mínimo sin pipeline (no debería ocurrir en flujo Elite integrado)
    const data = imageData.data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const step = 6;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) << 2;
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        n++;
      }
    }
    if (n > 0) {
      r /= n;
      g /= n;
      b /= n;
    }
    return {
      centerX: cx,
      centerY: cy,
      stabilityScore: 0.2,
      driftVelocity: 0,
      contactQuality: 15,
      pressureEstimate: 0.4,
      coverageUniformity: 0.2,
      roiMeanR: r,
      roiMeanG: g,
      roiMeanB: b,
      perfusionIndex: 0,
      signalToNoiseRatio: 0,
      trackedFeatures: 0,
      opticalFlowMagnitude: 0,
      segmentationConfidence: 0,
    };
  }

  private computeSNRFromHistory(): number {
    const n = this.HISTORY;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.signalHistory[i]!;
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = this.signalHistory[i]! - mean;
      v += d * d;
    }
    v /= Math.max(1, n - 1);
    const sp = mean * mean;
    return v > 1e-9 ? 10 * Math.log10(sp / v) : 0;
  }
}
