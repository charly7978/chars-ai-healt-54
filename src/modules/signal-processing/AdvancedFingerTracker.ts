/**
 * Detector híbrido dedo/tejido V2: combina señal del FrameAnalysisCore (pulsatilidad, cobertura, clipping)
 * con Optical Flow real (Lucas-Kanade simplificado) y Kalman Filter 2D para tracking robusto del dedo.
 * Basado en literatura 2024 de optical flow + Kalman filter para tracking.
 */

import type { FrameAnalysisResult } from './FrameAnalysisCore';

/** Kalman Filter 2D para tracking de posición del centroide */
class KalmanFilter2D {
  private x = 0.5; // Normalizado [0,1]
  private y = 0.5; // Normalizado [0,1]
  private vx = 0; // Velocidad X
  private vy = 0; // Velocidad Y
  private P = 0.1; // Covarianza de error
  private readonly processNoise = 0.001;
  private readonly measurementNoise = 0.01;

  predict(): { x: number; y: number } {
    this.x += this.vx;
    this.y += this.vy;
    this.P += this.processNoise;
    this.x = Math.max(0, Math.min(1, this.x));
    this.y = Math.max(0, Math.min(1, this.y));
    return { x: this.x, y: this.y };
  }

  update(measuredX: number, measuredY: number): void {
    const K = this.P / (this.P + this.measurementNoise);
    this.x += K * (measuredX - this.x);
    this.y += K * (measuredY - this.y);
    this.P *= (1 - K);
    
    // Actualizar velocidad (diferencia simple)
    this.vx = (measuredX - this.x) * 0.5;
    this.vy = (measuredY - this.y) * 0.5;
  }

  getState(): { x: number; y: number; vx: number; vy: number } {
    return { x: this.x, y: this.y, vx: this.vx, vy: this.vy };
  }

  reset(): void {
    this.x = 0.5;
    this.y = 0.5;
    this.vx = 0;
    this.vy = 0;
    this.P = 0.1;
  }
}

/** Optical Flow simplificado (Lucas-Kanade) para tracking de movimiento */
class OpticalFlowTracker {
  private prevFrame: Uint8ClampedArray | null = null;
  private prevWidth = 0;
  private prevHeight = 0;
  private readonly flowHistory: { dx: number; dy: number; magnitude: number }[] = [];
  private readonly historySize = 10;

  computeFlow(
    currentFrame: Uint8ClampedArray,
    width: number,
    height: number
  ): { dx: number; dy: number; magnitude: number } | null {
    if (!this.prevFrame || this.prevWidth !== width || this.prevHeight !== height) {
      this.prevFrame = new Uint8ClampedArray(currentFrame);
      this.prevWidth = width;
      this.prevHeight = height;
      return null;
    }

    // Optical flow simplificado en región central (ROI de interés)
    const roiSize = Math.min(width, height) * 0.4;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const step = 4; // Subsampling para performance

    let sumDx = 0;
    let sumDy = 0;
    let count = 0;

    for (let y = startY; y < startY + roiSize; y += step) {
      for (let x = startX; x < startX + roiSize; x += step) {
        const i = (y * width + x) * 4;
        const prevI = i;
        
        // Usar canal verde para optical flow (mejor SNR)
        const currentG = currentFrame[i + 1]!;
        const prevG = this.prevFrame[prevI + 1]!;
        
        if (currentG === 0 && prevG === 0) continue;

        // Gradientes espaciales simples
        const gx = currentFrame[i + 5]! - currentFrame[i - 3]!;
        const gy = currentFrame[i + 1 + width * 4]! - currentFrame[i + 1 - width * 4]!;
        const gt = currentG - prevG;

        if (Math.abs(gx) + Math.abs(gy) < 10) continue;

        const denom = gx * gx + gy * gy;
        if (denom < 1e-6) continue;

        const dx = -(gx * gt) / denom;
        const dy = -(gy * gt) / denom;

        sumDx += dx;
        sumDy += dy;
        count++;
      }
    }

    this.prevFrame = new Uint8ClampedArray(currentFrame);

    if (count === 0) {
      const last = this.flowHistory[this.flowHistory.length - 1];
      return last ? { dx: last.dx * 0.5, dy: last.dy * 0.5, magnitude: last.magnitude * 0.5 } : null;
    }

    const avgDx = sumDx / count;
    const avgDy = sumDy / count;
    const magnitude = Math.sqrt(avgDx * avgDx + avgDy * avgDy);

    this.flowHistory.push({ dx: avgDx, dy: avgDy, magnitude });
    if (this.flowHistory.length > this.historySize) {
      this.flowHistory.shift();
    }

    return { dx: avgDx, dy: avgDy, magnitude };
  }

  getAverageFlow(): { dx: number; dy: number; magnitude: number } {
    if (this.flowHistory.length === 0) return { dx: 0, dy: 0, magnitude: 0 };
    
    let sumDx = 0;
    let sumDy = 0;
    let sumMag = 0;
    for (const f of this.flowHistory) {
      sumDx += f.dx;
      sumDy += f.dy;
      sumMag += f.magnitude;
    }
    const n = this.flowHistory.length;
    return {
      dx: sumDx / n,
      dy: sumDy / n,
      magnitude: sumMag / n,
    };
  }

  reset(): void {
    this.prevFrame = null;
    this.flowHistory.length = 0;
  }
}

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
  /** Métricas de tracking extendidas */
  predictedX: number;
  predictedY: number;
  trackingConfidence: number;
  flowDx: number;
  flowDy: number;
  kalmanVelocityX: number;
  kalmanVelocityY: number;
}

export class AdvancedFingerTracker {
  private readonly HISTORY = 90;
  private readonly signalHistory = new Float32Array(90);
  private historyIndex = 0;
  private lastSnr = 0;
  private readonly kalmanFilter = new KalmanFilter2D();
  private readonly opticalFlow = new OpticalFlowTracker();
  private trackingConfidence = 0;
  private lastBbox = { sx: 0, sy: 0, ex: 0, ey: 0 };
  private bboxDriftAccumulator = 0;
  private bboxDriftSamples = 0;

  reset(): void {
    this.signalHistory.fill(0);
    this.historyIndex = 0;
    this.lastSnr = 0;
    this.kalmanFilter.reset();
    this.opticalFlow.reset();
    this.trackingConfidence = 0;
    this.lastBbox = { sx: 0, sy: 0, ex: 0, ey: 0 };
    this.bboxDriftAccumulator = 0;
    this.bboxDriftSamples = 0;
  }

  /**
   * @param frame Opcional si el pipeline ya aporta todo (worker/ImageBitmap sin readback en main).
   * @param pipelineSnapshot Resultado del núcleo de análisis (misma ventana temporal que PPG).
   */
  processFrame(
    frame: ImageData | ImageBitmap | null,
    pipelineSnapshot?: FrameAnalysisResult | null
  ): FingerTrackingResult {
    const { width, height } =
      frame && 'width' in frame
        ? { width: frame.width, height: frame.height }
        : { width: 320, height: 240 };

    // Calcular optical flow si tenemos frame real
    let flowResult = null;
    if (frame && !(frame instanceof ImageBitmap)) {
      flowResult = this.opticalFlow.computeFlow(frame.data, width, height);
    }

    if (pipelineSnapshot) {
      const p = pipelineSnapshot;
      const bb = p.roiBBox;
      
      // Calcular drift del bbox
      if (this.lastBbox.ex > 0) {
        const dx = Math.abs(bb.sx - this.lastBbox.sx) + Math.abs(bb.ex - this.lastBbox.ex);
        const dy = Math.abs(bb.sy - this.lastBbox.sy) + Math.abs(bb.ey - this.lastBbox.ey);
        const drift = (dx + dy) / (width + height);
        this.bboxDriftAccumulator += drift;
        this.bboxDriftSamples++;
      }
      this.lastBbox = { sx: bb.sx, sy: bb.sy, ex: bb.ex, ey: bb.ey };
      
      const cx = bb.ex > bb.sx ? (bb.sx + bb.ex) * 0.5 : width * 0.5;
      const cy = bb.ey > bb.sy ? (bb.sy + bb.ey) * 0.5 : height * 0.5;
      
      // Normalizar centroide para Kalman filter
      const normCx = cx / width;
      const normCy = cy / height;
      
      // Predicción Kalman
      const predicted = this.kalmanFilter.predict();
      this.kalmanFilter.update(normCx, normCy);
      const kalmanState = this.kalmanFilter.getState();
      
      // Calcular confianza de tracking
      const bboxDrift = this.bboxDriftSamples > 0 ? this.bboxDriftAccumulator / this.bboxDriftSamples : 0;
      this.trackingConfidence = Math.max(0, Math.min(1, 
        (1 - bboxDrift) * 0.5 + 
        (1 - Math.min(1, this.opticalFlow.getAverageFlow().magnitude / 10)) * 0.3 +
        p.spatialStabilityROI * 0.2
      ));
      
      const pi = p.perfusionIndex;
      this.signalHistory[this.historyIndex] = pi;
      this.historyIndex = (this.historyIndex + 1) % this.HISTORY;
      this.lastSnr = this.computeSNRFromHistory();

      const tissueInstant = Math.max(0, Math.min(1, p.roi.fingerScore * 1.15));
      const temporalStability = p.spatialStabilityROI;
      const pulsatilityScore = Math.max(0, Math.min(1, pi / 10));
      const clipPen = Math.min(1, p.clipHighRatio * 2 + p.clipLowRatio * 1.2);

      const agg = Math.max(0, Math.min(1, p.aggregateContactScore));
      const readinessOk =
        p.readinessReason === 'ok' ? 1 : p.readinessReason === 'contact_not_ready' ? 0.35 : 0.55;
      let bestSqi = 0;
      for (const v of Object.values(p.allSQI)) {
        if (v > bestSqi) bestSqi = v;
      }
      const sqiNorm = Math.max(0, Math.min(1, bestSqi));

      const maskIoU = p.maskIoU ?? 1;
      const poseCoherence = maskIoU * 0.55 + temporalStability * 0.45;

      const hybrid =
        tissueInstant * 0.2 +
        temporalStability * 0.18 +
        pulsatilityScore * 0.24 +
        agg * 0.13 +
        readinessOk * 0.09 +
        sqiNorm * 0.11 +
        poseCoherence * 0.09 -
        clipPen * 0.34;

      const contactQuality = Math.max(0, Math.min(100, hybrid * 100));
      const stabilityScore = Math.max(
        0,
        Math.min(1, temporalStability * 0.55 + (1 - clipPen) * 0.25 + sqiNorm * 0.2)
      );

      const avgFlow = this.opticalFlow.getAverageFlow();
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
        trackedFeatures: p.activeTileCount,
        opticalFlowMagnitude: p.globalMotion * 12,
        segmentationConfidence: tissueInstant,
        predictedX: predicted.x * width,
        predictedY: predicted.y * height,
        trackingConfidence: this.trackingConfidence,
        flowDx: avgFlow.dx,
        flowDy: avgFlow.dy,
        kalmanVelocityX: kalmanState.vx,
        kalmanVelocityY: kalmanState.vy,
      };
    }

    const cx = width * 0.5;
    const cy = height * 0.5;

    if (!frame || frame instanceof ImageBitmap) {
      return {
        centerX: cx,
        centerY: cy,
        stabilityScore: 0.2,
        driftVelocity: 0,
        contactQuality: 15,
        pressureEstimate: 0.4,
        coverageUniformity: 0.2,
        roiMeanR: 0,
        roiMeanG: 0,
        roiMeanB: 0,
        perfusionIndex: 0,
        signalToNoiseRatio: 0,
        trackedFeatures: 0,
        opticalFlowMagnitude: 0,
        segmentationConfidence: 0,
        predictedX: cx,
        predictedY: cy,
        trackingConfidence: 0,
        flowDx: 0,
        flowDy: 0,
        kalmanVelocityX: 0,
        kalmanVelocityY: 0,
      };
    }

    const data = frame.data;
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
      predictedX: cx,
      predictedY: cy,
      trackingConfidence: 0,
      flowDx: 0,
      flowDy: 0,
      kalmanVelocityX: 0,
      kalmanVelocityY: 0,
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
