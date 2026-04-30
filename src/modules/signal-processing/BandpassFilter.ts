/**
 * BANDPASS FILTER V3 — ROBUST DETRENDING + OUTLIER REJECTION
 * 
 * IIR Butterworth 2nd order: HPF + LPF configurable
 * - Robust detrending (EWMA + median fallback)
 * - Outlier rejection (winsorization)
 * - Configurable cutoff frequencies
 * - Optional light smoothing
 * - Adaptive sample rate
 */
export interface BandpassConfig {
  hpfFreq: number;      // High-pass cutoff (Hz)
  lpfFreq: number;      // Low-pass cutoff (Hz)
  detrendAlpha: number; // EWMA alpha for baseline
  winsorize: boolean;   // Enable outlier rejection
  winsorizePct: number; // Percentile for winsorization (0-1)
  smoothAlpha: number;  // Optional smoothing (0 = disabled)
}

// Banda PPG OPTIMIZADA según especificaciones forenses y literatura:
// - HPF 0.6 Hz: elimina deriva DC y baseline wander sin distorsionar onda PPG
// - LPF 5.0 Hz: cubre hasta 300 BPM (5 Hz × 60) con margen para taquicardias
// - Butterworth 2° orden (4 polos efectivos cascadeados)
// - detrendAlpha 0.01: EWMA suave para deriva lenta (~100s constante de tiempo)
// Referencias: van Gastel 2023, ISO 80601-2-61, Elgendi 2013
const DEFAULT_CONFIG: BandpassConfig = {
  hpfFreq: 0.6,        // Optimizado: 0.6 Hz mejor rechazo de deriva
  lpfFreq: 5.0,        // Optimizado: 5 Hz cubre rango cardíaco completo
  detrendAlpha: 0.01,  // Suavizado: 0.01 para eliminación gradual de baseline
  winsorize: false,    // Desactivado: preserva picos sistólicos
  winsorizePct: 0.04,
  smoothAlpha: 0
};

export class BandpassFilter {
  private config: BandpassConfig;
  private hpfB = [0, 0, 0];
  private hpfA = [1, 0, 0];
  private lpfB = [0, 0, 0];
  private lpfA = [1, 0, 0];

  private hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
  private lpfState = { x: [0, 0, 0], y: [0, 0, 0] };

  // Robust detrending state
  private baselineEWMA = 0;
  private baselineInitialized = false;
  private medianBuffer: number[] = [];
  private readonly MEDIAN_WINDOW = 90;  // Aumentado: 3s a 30 FPS para mejor estimación de mediana

  // Outlier rejection state
  private historyBuffer: number[] = [];
  private readonly HISTORY_WINDOW = 30;

  // Smoothing state
  private lastSmoothed = 0;

  private sampleRate: number;
  private lastComputedRate = 0;
  private initialized = false;

  constructor(sampleRate: number = 30, config: Partial<BandpassConfig> = {}) {
    this.sampleRate = sampleRate;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.computeCoefficients();
  }

  private computeCoefficients(): void {
    const fs = this.sampleRate;
    this.lastComputedRate = fs;

    // HPF at configurable frequency
    const fcHp = this.config.hpfFreq;
    const kHp = Math.tan(Math.PI * fcHp / fs);
    const normHp = 1 / (1 + Math.sqrt(2) * kHp + kHp * kHp);
    this.hpfB[0] = normHp;
    this.hpfB[1] = -2 * normHp;
    this.hpfB[2] = normHp;
    this.hpfA[0] = 1;
    this.hpfA[1] = 2 * (kHp * kHp - 1) * normHp;
    this.hpfA[2] = (1 - Math.sqrt(2) * kHp + kHp * kHp) * normHp;

    // LPF at configurable frequency
    const fcLp = this.config.lpfFreq;
    const kLp = Math.tan(Math.PI * fcLp / fs);
    const normLp = 1 / (1 + Math.sqrt(2) * kLp + kLp * kLp);
    this.lpfB[0] = kLp * kLp * normLp;
    this.lpfB[1] = 2 * kLp * kLp * normLp;
    this.lpfB[2] = kLp * kLp * normLp;
    this.lpfA[0] = 1;
    this.lpfA[1] = 2 * (kLp * kLp - 1) * normLp;
    this.lpfA[2] = (1 - Math.sqrt(2) * kLp + kLp * kLp) * normLp;

    this.initialized = true;
  }

  private applyBiquad(
    input: number,
    b: number[], a: number[],
    state: { x: number[], y: number[] }
  ): number {
    state.x[2] = state.x[1];
    state.x[1] = state.x[0];
    state.x[0] = input;
    state.y[2] = state.y[1];
    state.y[1] = state.y[0];
    state.y[0] = b[0] * state.x[0] + b[1] * state.x[1] + b[2] * state.x[2]
      - a[1] * state.y[1] - a[2] * state.y[2];

    if (!isFinite(state.y[0]) || Math.abs(state.y[0]) > 1e10) {
      state.y[0] = 0;
    }
    return state.y[0];
  }

  /** Robust detrend: remove slow baseline wander with median fallback */
  detrend(value: number): number {
    if (!this.baselineInitialized) {
      this.baselineEWMA = value;
      this.baselineInitialized = true;
      return 0;
    }
    
    // Update median buffer
    this.medianBuffer.push(value);
    if (this.medianBuffer.length > this.MEDIAN_WINDOW) {
      this.medianBuffer.shift();
    }
    
    // Use EWMA for baseline, fallback to median if EWMA drifts too much
    this.baselineEWMA = this.baselineEWMA * (1 - this.config.detrendAlpha) + value * this.config.detrendAlpha;
    
    // Check if EWMA is drifting significantly from median
    if (this.medianBuffer.length >= 30) {
      const sorted = [...this.medianBuffer].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const drift = Math.abs(this.baselineEWMA - median);
      if (drift > Math.abs(median) * 0.2) {
        // EWMA is drifting, use median instead
        this.baselineEWMA = median;
      }
    }
    
    return value - this.baselineEWMA;
  }

  /** Outlier rejection via winsorization */
  private winsorize(value: number): number {
    if (!this.config.winsorize) return value;
    
    this.historyBuffer.push(value);
    if (this.historyBuffer.length > this.HISTORY_WINDOW) {
      this.historyBuffer.shift();
    }
    
    if (this.historyBuffer.length < 10) return value;
    
    const sorted = [...this.historyBuffer].sort((a, b) => a - b);
    const pLow = sorted[Math.floor(this.historyBuffer.length * this.config.winsorizePct)];
    const pHigh = sorted[Math.floor(this.historyBuffer.length * (1 - this.config.winsorizePct))];
    
    return Math.max(pLow, Math.min(pHigh, value));
  }

  /** Full pipeline: winsorize → detrend → HPF → LPF → smooth */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) return 0;
    
    // Outlier rejection
    const cleaned = this.winsorize(value);
    
    // Detrend
    const detrended = this.detrend(cleaned);
    
    // Bandpass
    const hpf = this.applyBiquad(detrended, this.hpfB, this.hpfA, this.hpfState);
    const bandpassed = this.applyBiquad(hpf, this.lpfB, this.lpfA, this.lpfState);
    
    // Optional smoothing
    if (this.config.smoothAlpha > 0) {
      this.lastSmoothed = this.lastSmoothed * (1 - this.config.smoothAlpha) + bandpassed * this.config.smoothAlpha;
      return this.lastSmoothed;
    }
    
    return bandpassed;
  }

  /** Get detrended value only (no bandpass) */
  getDetrended(value: number): number {
    return this.detrend(this.winsorize(value));
  }

  reset(): void {
    this.hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.baselineEWMA = 0;
    this.baselineInitialized = false;
    this.medianBuffer = [];
    this.historyBuffer = [];
    this.lastSmoothed = 0;
  }

  /** Only recompute if rate changed significantly (>1.5 fps) */
  setSampleRate(rate: number): void {
    if (Math.abs(rate - this.lastComputedRate) < 1.5) return;
    this.sampleRate = rate;
    this.computeCoefficients();
    // Do NOT reset filter state for small rate changes — preserves continuity
  }
}
