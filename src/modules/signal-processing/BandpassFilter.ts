/**
 * BANDPASS FILTER V4 — MULTI-STAGE ROBUST FILTERING
 *
 * Architecture mejorada con etapas claras:
 *   1. Detrending robusto (EWMA + median filter para outliers)
 *   2. Band-pass cardíaco configurable (normal: 0.5-5Hz, extendida: 0.4-6Hz)
 *   3. Suavizado ligero opcional (media móvil adaptativa)
 *   4. Rechazo de outliers impulsivos (clipper adaptativo)
 *   5. Notch respiratorio adaptativo (opcional)
 *
 * Mejoras sobre V3:
 *   - Banda configurable según contexto
 *   - Mejor estabilidad numérica con clipping
 *   - Rechazo de outliers impulsivos
 *   - Suavizado no destructivo
 *   - Evitar ringing excesivo
 *   - Compatibilidad con beat detector existente
 *
 * References:
 *   - Proakis & Manolakis "Digital Signal Processing" 4th ed. §10.3
 *   - Elgendi 2016 "Systolic Peak Detection in PPG" Algorithms 9(1)
 *   - Mejia-Mejia 2022 Computers in Biology (respiratory notch in PPG)
 */

interface BiquadState { x: number[]; y: number[] }
interface BiquadCoeffs { b: number[]; a: number[] }

export type FilterBand = 'normal' | 'extended';

export interface BandpassFilterConfig {
  sampleRate: number;
  band: FilterBand;
  enableNotch: boolean;
  enableSmoothing: boolean;
  enableOutlierRejection: boolean;
  outlierThreshold: number;
  smoothingWindow: number;
}

export class BandpassFilter {
  // ── 2nd-order Butterworth HPF ───────────────────────────────────
  private hpfB = [0, 0, 0];
  private hpfA = [1, 0, 0];
  private hpfState: BiquadState = { x: [0, 0, 0], y: [0, 0, 0] };

  // ── 2nd-order Butterworth LPF ───────────────────────────────────
  private lpfB = [0, 0, 0];
  private lpfA = [1, 0, 0];
  private lpfState: BiquadState = { x: [0, 0, 0], y: [0, 0, 0] };

  // ── Respiratory notch ────────────────────────────────────────────
  private notchCoeffs: BiquadCoeffs = { b: [1, 0, 0], a: [1, 0, 0] };
  private notchState: BiquadState = { x: [0, 0, 0], y: [0, 0, 0] };
  private notchEnabled = false;
  private respFreqHz = 0.25;
  private readonly NOTCH_Q = 8.0;

  // ── Detrending robusto ──────────────────────────────────────────
  private baselineEWMA = 0;
  private baselineInit = false;
  private readonly DETREND_ALPHA = 0.015;
  private medianBuffer: number[] = [];
  private readonly MEDIAN_WINDOW = 7;

  // ── Suavizado adaptativo ────────────────────────────────────────
  private smoothingBuffer: number[] = [];
  private smoothingWindow: number;

  // ── Rechazo de outliers ─────────────────────────────────────────
  private outlierThreshold: number;
  private enableOutlierRejection: boolean;

  // ── Configuración ────────────────────────────────────────────────
  private sampleRate: number;
  private lastComputedRate = 0;
  private initialized = false;
  private config: BandpassFilterConfig;

  // ── Adaptive notch tracking ──────────────────────────────────────
  private respBuf: number[] = [];
  private readonly RESP_BUF_SIZE = 600;
  private lastNotchUpdate = 0;
  private readonly NOTCH_UPDATE_INTERVAL_MS = 3000;

  constructor(config: Partial<BandpassFilterConfig> = {}) {
    this.config = {
      sampleRate: 30,
      band: 'normal',
      enableNotch: true,
      enableSmoothing: false,
      enableOutlierRejection: true,
      outlierThreshold: 3.0,
      smoothingWindow: 3,
      ...config
    };

    this.sampleRate = this.config.sampleRate;
    this.smoothingWindow = this.config.smoothingWindow;
    this.outlierThreshold = this.config.outlierThreshold;
    this.enableOutlierRejection = this.config.enableOutlierRejection;
    this.notchEnabled = this.config.enableNotch;

    this.computeCoefficients();
  }

  // ══════════════════════════════════════════════════════════════════
  //  COEFFICIENT COMPUTATION
  // ══════════════════════════════════════════════════════════════════

  private computeCoefficients(): void {
    const fs = this.sampleRate;
    this.lastComputedRate = fs;

    // ── Configuración de banda según contexto ──────────────────────
    const bandConfig = this.config.band === 'extended' 
      ? { hp: 0.4, lp: 6.0 }  // Banda extendida
      : { hp: 0.5, lp: 5.0 };  // Banda normal (compatibilidad V2/V3)

    // ── 2nd-order Butterworth HPF ──────────────────────────────
    const fcHp = bandConfig.hp;
    const kHp = Math.tan(Math.PI * fcHp / fs);
    const normHp = 1 / (1 + Math.sqrt(2) * kHp + kHp * kHp);
    this.hpfB[0] = normHp;
    this.hpfB[1] = -2 * normHp;
    this.hpfB[2] = normHp;
    this.hpfA[0] = 1;
    this.hpfA[1] = 2 * (kHp * kHp - 1) * normHp;
    this.hpfA[2] = (1 - Math.sqrt(2) * kHp + kHp * kHp) * normHp;

    // ── 2nd-order Butterworth LPF ──────────────────────────────
    const fcLp = bandConfig.lp;
    const kLp = Math.tan(Math.PI * fcLp / fs);
    const normLp = 1 / (1 + Math.sqrt(2) * kLp + kLp * kLp);
    this.lpfB[0] = kLp * kLp * normLp;
    this.lpfB[1] = 2 * kLp * kLp * normLp;
    this.lpfB[2] = kLp * kLp * normLp;
    this.lpfA[0] = 1;
    this.lpfA[1] = 2 * (kLp * kLp - 1) * normLp;
    this.lpfA[2] = (1 - Math.sqrt(2) * kLp + kLp * kLp) * normLp;

    // ── Respiratory notch at current estimate ───────────────────────
    this.notchCoeffs = this.computeNotch(this.respFreqHz, fs, this.NOTCH_Q);

    this.initialized = true;
  }

  /**
   * 2nd-order IIR notch filter (bilinear transform).
   * Q=8 → narrow 3dB bandwidth ≈ fc/8 — removes respiratory without touching cardiac.
   */
  private computeNotch(fc: number, fs: number, Q: number): BiquadCoeffs {
    if (fc <= 0 || fc >= fs / 2) return { b: [1, 0, 0], a: [1, 0, 0] };
    const omega0 = 2 * Math.PI * fc / fs;
    const alpha = Math.sin(omega0) / (2 * Q);
    const cosW = Math.cos(omega0);
    const b0 = 1 / (1 + alpha);
    const b1 = -2 * cosW / (1 + alpha);
    const b2 = 1 / (1 + alpha);
    const a1 = -2 * cosW / (1 + alpha);
    const a2 = (1 - alpha) / (1 + alpha);
    return { b: [b0, b1, b2], a: [1, a1, a2] };
  }

  // ══════════════════════════════════════════════════════════════════
  //  BIQUAD (Direct Form II Transposed)
  // ══════════════════════════════════════════════════════════════════

  private applyBiquad(
    input: number,
    b: number[], a: number[],
    state: BiquadState
  ): number {
    state.x[2] = state.x[1]; state.x[1] = state.x[0]; state.x[0] = input;
    state.y[2] = state.y[1]; state.y[1] = state.y[0];
    state.y[0] = b[0] * state.x[0] + b[1] * state.x[1] + b[2] * state.x[2]
               - a[1] * state.y[1] - a[2] * state.y[2];
    if (!isFinite(state.y[0]) || Math.abs(state.y[0]) > 1e10) state.y[0] = 0;
    return state.y[0];
  }

  // ══════════════════════════════════════════════════════════════════
  //  DETRENDING ROBUSTO
  // ══════════════════════════════════════════════════════════════════

  /**
   * Detrending robusto con EWMA + median filter para outliers
   */
  detrend(value: number): number {
    if (!this.baselineInit) {
      this.baselineEWMA = value;
      this.baselineInit = true;
      return 0;
    }
    
    // Aplicar median filter para remover outliers antes de EWMA
    const filteredValue = this.medianFilter(value);
    
    // EWMA sobre valor filtrado
    this.baselineEWMA = this.baselineEWMA * (1 - this.DETREND_ALPHA) + filteredValue * this.DETREND_ALPHA;
    
    return value - this.baselineEWMA;
  }

  /**
   * Median filter simple para remover outliers impulsivos
   */
  private medianFilter(value: number): number {
    this.medianBuffer.push(value);
    if (this.medianBuffer.length > this.MEDIAN_WINDOW) {
      this.medianBuffer.shift();
    }
    
    if (this.medianBuffer.length < 3) {
      return value;
    }
    
    // Calcular mediana
    const sorted = [...this.medianBuffer].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // ══════════════════════════════════════════════════════════════════
  //  RECHAZO DE OUTLERS IMPULSIVOS
  // ══════════════════════════════════════════════════════════════════

  /**
   * Clipper adaptativo para rechazar outliers impulsivos
   */
  private rejectOutliers(value: number, reference: number): number {
    if (!this.enableOutlierRejection) {
      return value;
    }
    
    const deviation = Math.abs(value - reference);
    const threshold = this.outlierThreshold;
    
    // Si el valor excede el umbral, clippearlo
    if (deviation > threshold) {
      const sign = Math.sign(value - reference);
      return reference + sign * threshold;
    }
    
    return value;
  }

  // ══════════════════════════════════════════════════════════════════
  //  SUAVIZADO ADAPTATIVO
  // ══════════════════════════════════════════════════════════════════

  /**
   * Suavizado ligero opcional (media móvil adaptativa)
   */
  private smoothSignal(value: number): number {
    if (!this.config.enableSmoothing) {
      return value;
    }
    
    this.smoothingBuffer.push(value);
    if (this.smoothingBuffer.length > this.smoothingWindow) {
      this.smoothingBuffer.shift();
    }
    
    if (this.smoothingBuffer.length === 0) {
      return value;
    }
    
    // Media móvil simple
    return this.smoothingBuffer.reduce((sum, v) => sum + v, 0) / this.smoothingBuffer.length;
  }

  // ══════════════════════════════════════════════════════════════════
  //  ADAPTIVE RESPIRATORY NOTCH
  // ══════════════════════════════════════════════════════════════════

  private updateRespNotch(rawValue: number): void {
    this.respBuf.push(rawValue);
    if (this.respBuf.length > this.RESP_BUF_SIZE) this.respBuf.shift();

    const now = performance.now();
    if (now - this.lastNotchUpdate < this.NOTCH_UPDATE_INTERVAL_MS) return;
    if (this.respBuf.length < 90) return;
    this.lastNotchUpdate = now;

    const detectedFreq = this.estimateRespFrequency();
    if (detectedFreq > 0.1 && detectedFreq < 0.5) {
      const change = Math.abs(detectedFreq - this.respFreqHz) / Math.max(0.01, this.respFreqHz);
      if (change > 0.10) {
        this.respFreqHz = this.respFreqHz * 0.7 + detectedFreq * 0.3;
        this.notchCoeffs = this.computeNotch(this.respFreqHz, this.sampleRate, this.NOTCH_Q);
        this.notchEnabled = true;
      }
    }
  }

  private estimateRespFrequency(): number {
    const n = Math.min(this.RESP_BUF_SIZE, this.respBuf.length);
    if (n < 60) return 0;
    const buf = this.respBuf.slice(-n);
    const mean = buf.reduce((a, b) => a + b, 0) / n;
    const detrended = buf.map(v => v - mean);
    const fs = this.sampleRate;

    const minBin = Math.max(1, Math.round(0.1 * n / fs));
    const maxBin = Math.round(0.5 * n / fs);
    let bestPower = 0, bestFreq = 0;

    for (let k = minBin; k <= maxBin; k++) {
      let re = 0, im = 0;
      const phase = (2 * Math.PI * k) / n;
      for (let i = 0; i < n; i++) {
        re += detrended[i] * Math.cos(phase * i);
        im -= detrended[i] * Math.sin(phase * i);
      }
      const power = re * re + im * im;
      if (power > bestPower) { bestPower = power; bestFreq = k * fs / n; }
    }

    return bestFreq;
  }

  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API - PIPELINE MULTIEAPA COMPLETO
  // ══════════════════════════════════════════════════════════════════

  /**
   * Pipeline completo: detrending → outlier rejection → HPF → LPF [→ resp notch] → smoothing
   */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) return 0;

    this.updateRespNotch(value);

    // Etapa 1: Detrending robusto
    const detrended = this.detrend(value);
    
    // Etapa 2: Rechazo de outliers impulsivos
    const cleaned = this.rejectOutliers(detrended, 0);
    
    // Etapa 3: Band-pass cardíaco (HPF → LPF)
    let x = this.applyBiquad(cleaned, this.hpfB, this.hpfA, this.hpfState);
    x = this.applyBiquad(x, this.lpfB, this.lpfA, this.lpfState);

    // Etapa 4: Notch respiratorio (opcional)
    if (this.notchEnabled) {
      x = this.applyBiquad(x, this.notchCoeffs.b, this.notchCoeffs.a, this.notchState);
    }

    // Etapa 5: Suavizado ligero opcional
    const smoothed = this.smoothSignal(x);
    
    return smoothed;
  }

  /**
   * Pipeline simplificado (compatibilidad con V2/V3)
   */
  filterSimple(value: number): number {
    if (!this.initialized || !isFinite(value)) return 0;

    this.updateRespNotch(value);

    const detrended = this.detrend(value);
    let x = this.applyBiquad(detrended, this.hpfB, this.hpfA, this.hpfState);
    x = this.applyBiquad(x, this.lpfB, this.lpfA, this.lpfState);

    if (this.notchEnabled) {
      x = this.applyBiquad(x, this.notchCoeffs.b, this.notchCoeffs.a, this.notchState);
    }

    return x;
  }

  getDetrended(value: number): number { return this.detrend(value); }

  reset(): void {
    this.hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.notchState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.baselineEWMA = 0;
    this.baselineInit = false;
    this.medianBuffer = [];
    this.smoothingBuffer = [];
    this.respBuf = [];
    this.lastNotchUpdate = 0;
  }

  setSampleRate(rate: number): void {
    if (Math.abs(rate - this.lastComputedRate) < 1.5) return;
    this.sampleRate = rate;
    this.computeCoefficients();
  }

  setBand(band: FilterBand): void {
    if (this.config.band === band) return;
    this.config.band = band;
    this.computeCoefficients();
  }

  setNotchEnabled(enabled: boolean): void {
    this.notchEnabled = enabled;
  }

  setSmoothingEnabled(enabled: boolean): void {
    this.config.enableSmoothing = enabled;
    this.smoothingBuffer = []; // Reset buffer
  }

  setOutlierRejectionEnabled(enabled: boolean): void {
    this.enableOutlierRejection = enabled;
  }

  getConfig(): BandpassFilterConfig {
    return { ...this.config };
  }

  getRespFrequencyHz(): number { return this.respFreqHz; }
  
  getCurrentBand(): FilterBand { return this.config.band; }
}
