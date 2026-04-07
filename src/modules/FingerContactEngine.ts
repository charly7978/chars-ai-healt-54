/**
 * FINGER CONTACT ENGINE — Detección robusta de dedo sobre cámara
 *
 * Calcula ContactScore 0-100 usando combinación de:
 * - Cobertura del lente
 * - Distribución de histograma
 * - Brillo medio
 * - Varianza espacial
 * - Consistencia temporal del color
 * - Porcentaje de píxeles saturados
 * - Porcentaje de píxeles near-black
 * - Homogeneidad espacial
 * - Persistencia del contacto
 */
import { PPG_CONFIG } from '../config/ppgConfig';
import type {
  FingerContactState,
  ContactScore,
  FingerContactResult,
  FrameRGBData,
} from '../types/ppg-types';

const C = PPG_CONFIG.finger;
const CAM = PPG_CONFIG.camera;

export class FingerContactEngine {
  // Temporal tracking
  private stableContactStartMs = 0;
  private lastContactState: FingerContactState = 'SEARCHING_FINGER';
  private confirmFrames = 0;
  private lostFrames = 0;
  private fingerDetected = false;

  // Smoothed values (EMA)
  private sR = 0; private sG = 0; private sB = 0;
  private sCoverage = 0; private sFingerScore = 0;
  private sBrightness = 0;
  private temporalRBuffer: number[] = [];
  private temporalGBuffer: number[] = [];
  private readonly TEMPORAL_BUFFER_SIZE = 30; // ~1s

  // AC/DC for perfusion check
  private perfusionAC = 0;
  private perfusionDC = 0;

  // Camera availability
  private cameraAvailable = true;

  setCameraAvailable(available: boolean): void {
    this.cameraAvailable = available;
  }

  setPerfusion(ac: number, dc: number): void {
    this.perfusionAC = ac;
    this.perfusionDC = dc;
  }

  /**
   * Process one frame and return contact state + instructions
   */
  process(frameData: FrameRGBData, motionScore: number): FingerContactResult {
    if (!this.cameraAvailable) {
      return this.makeResult('NO_CAMERA', this.emptyScore(), 'Cámara no disponible', false, 0);
    }

    const score = this.computeContactScore(frameData, motionScore);
    const state = this.classifyState(score, frameData);
    const instruction = this.getInstruction(state, score);
    const warmup = this.getWarmupProgress(state);

    this.lastContactState = state;

    return this.makeResult(state, score, instruction, this.fingerDetected, warmup);
  }

  private computeContactScore(f: FrameRGBData, motionScore: number): ContactScore {
    // EMA smoothing
    const a = 0.12;
    if (this.sR === 0) {
      this.sR = f.meanR; this.sG = f.meanG; this.sB = f.meanB;
      this.sCoverage = 0; this.sFingerScore = 0; this.sBrightness = f.brightness;
    } else {
      this.sR = this.sR * (1 - a) + f.meanR * a;
      this.sG = this.sG * (1 - a) + f.meanG * a;
      this.sB = this.sB * (1 - a) + f.meanB * a;
      this.sBrightness = this.sBrightness * (1 - a) + f.brightness * a;
    }

    // Temporal consistency
    this.temporalRBuffer.push(f.meanR);
    this.temporalGBuffer.push(f.meanG);
    if (this.temporalRBuffer.length > this.TEMPORAL_BUFFER_SIZE) {
      this.temporalRBuffer.shift();
      this.temporalGBuffer.shift();
    }
    const temporalConsistency = this.computeTemporalConsistency();

    // Sub-scores
    const redDominance = this.sR - (this.sG + this.sB) / 2;
    const rgRatio = this.sR / Math.max(1, this.sG);
    const satPct = f.saturationCount / Math.max(1, f.totalPixels);
    const blackPct = f.nearBlackCount / Math.max(1, f.totalPixels);

    // Coverage from uniformity + brightness
    const brightnessOk = this.sBrightness > C.minBrightness && this.sBrightness < C.maxBrightness;
    const redOk = this.sR > C.minRedValue;
    const ratioOk = rgRatio > C.minRGRatio && rgRatio < C.maxRGRatio;
    const domOk = redDominance > C.minRedDominance;

    let coverageScore = 0;
    if (brightnessOk) coverageScore += 0.2;
    if (redOk) coverageScore += 0.2;
    if (ratioOk) coverageScore += 0.2;
    if (domOk) coverageScore += 0.2;
    if (f.uniformity > 0.5) coverageScore += 0.1;
    if (satPct < C.maxSaturationPercent) coverageScore += 0.1;

    this.sCoverage = this.sCoverage * 0.85 + coverageScore * 0.15;
    this.sFingerScore = this.sCoverage;

    // Histgoram spread (normalized)
    const histogramSpread = Math.min(1, Math.max(0, (this.sR - 30) / 200));

    // Persistence
    const now = Date.now();
    const persistenceMs = this.fingerDetected && this.stableContactStartMs > 0
      ? now - this.stableContactStartMs
      : 0;

    // Total score (0-100)
    let total = 0;
    total += Math.min(20, this.sCoverage * 25);                          // coverage: 0-20
    total += Math.min(15, (brightnessOk ? 15 : 0));                      // brightness: 0-15
    total += Math.min(15, (redDominance / 30) * 15);                     // red dominance: 0-15
    total += Math.min(10, f.uniformity * 12);                            // uniformity: 0-10
    total += Math.min(10, temporalConsistency * 12);                     // temporal: 0-10
    total += Math.min(10, Math.max(0, (1 - satPct) * 12));              // no clipping: 0-10
    total += Math.min(10, Math.max(0, (1 - blackPct) * 12));            // no black: 0-10
    total += Math.min(10, Math.min(1, persistenceMs / C.warmupStableMs) * 10); // persistence: 0-10

    // Motion penalty
    total -= Math.min(20, motionScore * 25);
    total = Math.max(0, Math.min(100, total));

    return {
      total,
      coverage: this.sCoverage,
      brightness: this.sBrightness,
      redDominance,
      spatialUniformity: f.uniformity,
      temporalConsistency,
      saturationPercent: satPct,
      nearBlackPercent: blackPct,
      histogramSpread,
      persistenceMs,
    };
  }

  private computeTemporalConsistency(): number {
    if (this.temporalRBuffer.length < 10) return 0;
    const recent = this.temporalRBuffer.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (mean < 5) return 0;
    const variance = recent.reduce((a, v) => a + (v - mean) ** 2, 0) / recent.length;
    const cv = Math.sqrt(variance) / mean;
    // Low CV = high consistency
    return Math.max(0, Math.min(1, 1 - cv * 5));
  }

  private classifyState(score: ContactScore, f: FrameRGBData): FingerContactState {
    const now = Date.now();
    const perfIndex = this.perfusionDC > 0 ? (this.perfusionAC / this.perfusionDC) * 100 : 0;

    // NO FINGER checks
    if (score.total < 15 || score.nearBlackPercent > C.maxNearBlackPercent) {
      this.lostFrames++;
      if (this.lostFrames > C.lostGraceFrames || !this.fingerDetected) {
        this.fingerDetected = false;
        this.confirmFrames = 0;
        this.stableContactStartMs = 0;
        return 'SEARCHING_FINGER';
      }
      // Grace period
      return 'UNSTABLE_CONTACT';
    }

    // OVERPRESSURE
    if (this.sR > C.overpressureRedMin && score.saturationPercent > 0.5 &&
        perfIndex < C.overpressureACThreshold * 100 && this.temporalRBuffer.length > 15) {
      this.lostFrames = 0;
      this.confirmFrames = Math.max(0, this.confirmFrames - 1);
      return 'OVERPRESSURE_OR_CLIPPING';
    }

    // CLIPPING (different from overpressure — clipping is exposure-based)
    if (score.saturationPercent > C.maxSaturationPercent) {
      this.lostFrames = 0;
      return 'OVERPRESSURE_OR_CLIPPING';
    }

    // PARTIAL CONTACT
    if (score.total < 35 || score.coverage < 0.3) {
      this.lostFrames = 0;
      this.confirmFrames = Math.max(0, this.confirmFrames - 1);
      return 'PARTIAL_CONTACT';
    }

    // Contact detected
    this.lostFrames = 0;
    this.confirmFrames++;

    if (this.confirmFrames < C.confirmFrames) {
      return 'UNSTABLE_CONTACT';
    }

    // Finger confirmed
    if (!this.fingerDetected) {
      this.fingerDetected = true;
      this.stableContactStartMs = now;
    }

    // LOW PERFUSION
    if (perfIndex > 0 && perfIndex < C.lowPerfusionThreshold) {
      return 'LOW_PERFUSION';
    }

    // UNSTABLE (score not high enough)
    if (score.total < 50) {
      return 'UNSTABLE_CONTACT';
    }

    // WARMING UP
    const stableMs = now - this.stableContactStartMs;
    if (stableMs < C.warmupStableMs) {
      return 'CONTACT_OK_WARMING_UP';
    }

    // Check if we have quality for valid measurement
    if (score.total >= 60) {
      return 'MEASURING_VALID';
    }

    return 'MEASURING_INVALID';
  }

  private getInstruction(state: FingerContactState, score: ContactScore): string {
    switch (state) {
      case 'NO_CAMERA': return 'Cámara no disponible';
      case 'SEARCHING_FINGER': return 'Cubrí completamente cámara y flash con el dedo';
      case 'PARTIAL_CONTACT': return 'Cubrí completamente cámara y flash';
      case 'OVERPRESSURE_OR_CLIPPING': return 'Aflojá un poco la presión del dedo';
      case 'LOW_PERFUSION': return 'Presioná un poco más suavemente';
      case 'UNSTABLE_CONTACT': return 'Mantené el dedo quieto';
      case 'CONTACT_OK_WARMING_UP': return 'Esperando perfusión estable...';
      case 'MEASURING_VALID': return 'Lectura confiable';
      case 'MEASURING_INVALID': return 'Señal no confiable — mantené el dedo quieto';
      default: return '';
    }
  }

  private getWarmupProgress(state: FingerContactState): number {
    if (!this.fingerDetected || this.stableContactStartMs === 0) return 0;
    if (state === 'SEARCHING_FINGER' || state === 'NO_CAMERA') return 0;
    const elapsed = Date.now() - this.stableContactStartMs;
    return Math.min(1, elapsed / C.warmupStableMs);
  }

  reset(): void {
    this.stableContactStartMs = 0;
    this.lastContactState = 'SEARCHING_FINGER';
    this.confirmFrames = 0;
    this.lostFrames = 0;
    this.fingerDetected = false;
    this.sR = 0; this.sG = 0; this.sB = 0;
    this.sCoverage = 0; this.sFingerScore = 0; this.sBrightness = 0;
    this.temporalRBuffer = [];
    this.temporalGBuffer = [];
    this.perfusionAC = 0;
    this.perfusionDC = 0;
  }

  private emptyScore(): ContactScore {
    return {
      total: 0, coverage: 0, brightness: 0, redDominance: 0,
      spatialUniformity: 0, temporalConsistency: 0, saturationPercent: 0,
      nearBlackPercent: 0, histogramSpread: 0, persistenceMs: 0,
    };
  }

  private makeResult(
    state: FingerContactState, score: ContactScore,
    instruction: string, fingerDetected: boolean, warmup: number
  ): FingerContactResult {
    return { state, score, instruction, fingerDetected, warmupProgress: warmup };
  }
}
