/**
 * THERMAL COMPENSATOR — Flash-induced temperature drift correction
 * 
 * Models and compensates for thermal effects of prolonged flash exposure:
 * - Flash heating causes vasodilation → increased blood volume
 * - Temperature changes affect Beer-Lambert absorption coefficients
 * - Thermal drift appears as low-frequency trend in PPG signal
 * 
 * Compensation strategy:
 * 1. Estimate thermal state from DC trend (temperature proxy)
 * 2. Model thermal time constant (τ ≈ 5-15 seconds for finger tissue)
 * 3. Predict and subtract thermal drift from AC signal
 * 4. Adapt compensation based on measurement duration
 * 
 * Phase 5: Thermal-aware processing for long-duration measurements
 * 
 * References:
 * - Spruijt et al. (2014): Thermal effects in PPG measurements
 * - physiological thermal time constants: τ ≈ 8-12s for cutaneous tissue
 */

export interface ThermalConfig {
  /** Thermal time constant in seconds (default: 10s) */
  thermalTimeConstant: number;
  /** Sampling rate in Hz */
  sampleRate: number;
  /** Maximum compensation duration in seconds */
  maxCompensationDuration: number;
  /** DC trend smoothing factor */
  dcSmoothingAlpha: number;
  /** Enable adaptive time constant */
  adaptiveTau: boolean;
}

export interface ThermalState {
  /** Estimated tissue temperature (relative, arbitrary units) */
  temperature: number;
  /** Rate of temperature change (°C/s equivalent) */
  tempDerivative: number;
  /** Thermal time constant estimate (seconds) */
  estimatedTau: number;
  /** Compensation gain factor */
  compensationGain: number;
  /** Confidence in thermal model (0-1) */
  modelConfidence: number;
}

export interface CompensationResult {
  /** Compensated signal */
  signal: Float64Array;
  /** Thermal drift that was subtracted */
  thermalDrift: Float64Array;
  /** Estimated temperature profile */
  temperatureProfile: Float64Array;
  /** Recommended max measurement duration remaining */
  remainingValidDuration: number;
  /** Quality degradation warning */
  qualityWarning: boolean;
}

export class ThermalCompensator {
  private config: ThermalConfig;
  
  // State tracking
  private dcHistory: number[] = [];
  private tempEstimate = 0;
  private tempVelocity = 0;
  private frameCount = 0;
  private lastTimestamp = 0;
  private measurementStartTime = 0;
  
  // Adaptive parameters
  private estimatedTau: number;
  private compensationActive = false;
  private readonly MAX_HISTORY = 300; // 10s at 30fps
  
  // Thermal model parameters (physiological)
  private readonly TEMP_RISE_PER_SECOND = 0.5; // °C/s estimated
  private readonly MAX_VALID_DURATION = 45; // seconds before thermal effects dominate
  
  constructor(config: Partial<ThermalConfig> = {}) {
    this.config = {
      thermalTimeConstant: 10.0,
      sampleRate: 30,
      maxCompensationDuration: 45,
      dcSmoothingAlpha: 0.05,
      adaptiveTau: true,
      ...config
    };
    
    this.estimatedTau = this.config.thermalTimeConstant;
  }
  
  /**
   * Initialize compensator at measurement start
   */
  startMeasurement(timestamp?: number): void {
    this.measurementStartTime = timestamp ?? performance.now();
    this.dcHistory = [];
    this.tempEstimate = 0;
    this.tempVelocity = 0;
    this.frameCount = 0;
    this.compensationActive = true;
    this.estimatedTau = this.config.thermalTimeConstant;
  }
  
  /**
   * Compensate thermal drift from PPG signal
   * 
   * @param signal Input PPG signal (AC+DC)
   * @param dcLevel Current DC level (proxy for temperature)
   * @param timestamp Frame timestamp
   * @returns Compensated signal with thermal drift removed
   */
  compensate(
    signal: Float64Array,
    dcLevel: number,
    timestamp?: number
  ): CompensationResult {
    const now = timestamp ?? performance.now();
    const elapsed = (now - this.measurementStartTime) / 1000;
    
    this.frameCount++;
    
    // Update DC history
    this.updateDCHistory(dcLevel);
    
    // Estimate thermal state
    const thermalState = this.estimateThermalState(elapsed);
    
    // Predict thermal drift
    const thermalDrift = this.predictThermalDrift(signal.length, elapsed, thermalState);
    
    // Compensate signal
    const compensated = new Float64Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      compensated[i] = signal[i] - thermalDrift[i] * thermalState.compensationGain;
    }
    
    // Generate temperature profile
    const tempProfile = this.generateTemperatureProfile(signal.length, elapsed, thermalState);
    
    // Check remaining valid duration
    const remainingDuration = Math.max(0, this.config.maxCompensationDuration - elapsed);
    
    // Quality warning if thermal effects becoming dominant
    const qualityWarning = elapsed > this.config.maxCompensationDuration * 0.7 || 
                          thermalState.modelConfidence < 0.3;
    
    return {
      signal: compensated,
      thermalDrift,
      temperatureProfile: tempProfile,
      remainingValidDuration: remainingDuration,
      qualityWarning
    };
  }
  
  /**
   * Estimate current thermal state from DC history
   */
  private estimateThermalState(elapsed: number): ThermalState {
    if (this.dcHistory.length < 30) {
      // Not enough data for reliable estimate
      return {
        temperature: 0,
        tempDerivative: 0,
        estimatedTau: this.config.thermalTimeConstant,
        compensationGain: 0,
        modelConfidence: 0
      };
    }
    
    // Smooth DC to estimate temperature
    const recentDC = this.dcHistory.slice(-30);
    const smoothedDC = recentDC.reduce((a, b) => a + b, 0) / recentDC.length;
    
    // Temperature proxy: normalized deviation from baseline
    const baseline = this.dcHistory.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const tempProxy = (smoothedDC - baseline) / baseline;
    
    // Estimate derivative (rate of change)
    const dt = 1 / this.config.sampleRate;
    let derivative = 0;
    if (this.dcHistory.length >= 2) {
      const n = this.dcHistory.length;
      derivative = (this.dcHistory[n - 1] - this.dcHistory[n - 10]) / (9 * dt);
    }
    
    // Adaptive time constant estimation
    if (this.config.adaptiveTau && this.dcHistory.length > 60) {
      this.adaptTimeConstant();
    }
    
    // Compensation gain: increase with elapsed time
    // Early measurement: minimal compensation
    // Late measurement: aggressive compensation
    const gain = Math.min(1.0, elapsed / 15) * 0.8;
    
    // Confidence based on data quality
    const dcVariance = this.calculateVariance(this.dcHistory.slice(-60));
    const confidence = Math.min(1, Math.max(0, 1 - dcVariance / 100));
    
    return {
      temperature: tempProxy,
      tempDerivative: derivative,
      estimatedTau: this.estimatedTau,
      compensationGain: gain,
      modelConfidence: confidence
    };
  }
  
  /**
   * Predict thermal drift based on thermal model
   * 
   * Thermal model: T(t) = T_ambient + (T_flash - T_ambient) * (1 - exp(-t/τ))
   * Drift is proportional to temperature change
   */
  private predictThermalDrift(
    length: number,
    elapsed: number,
    state: ThermalState
  ): Float64Array {
    const drift = new Float64Array(length);
    const dt = 1 / this.config.sampleRate;
    
    // Exponential approach to steady-state temperature
    const tau = state.estimatedTau;
    const Tsteady = 1.0; // Normalized steady-state temperature rise
    
    for (let i = 0; i < length; i++) {
      const t = elapsed + i * dt;
      
      // Temperature rise curve
      const tempRise = Tsteady * (1 - Math.exp(-t / tau));
      
      // Drift is derivative of temperature (scaled)
      const driftRate = (Tsteady / tau) * Math.exp(-t / tau);
      
      // Accumulate drift
      drift[i] = tempRise * 0.1 + driftRate * 0.5; // Combined model
    }
    
    return drift;
  }
  
  /**
   * Generate temperature profile for telemetry
   */
  private generateTemperatureProfile(
    length: number,
    elapsed: number,
    state: ThermalState
  ): Float64Array {
    const profile = new Float64Array(length);
    const dt = 1 / this.config.sampleRate;
    const tau = state.estimatedTau;
    
    for (let i = 0; i < length; i++) {
      const t = elapsed + i * dt;
      // Exponential temperature rise
      profile[i] = (1 - Math.exp(-t / tau)) * 100; // Scale to arbitrary units
    }
    
    return profile;
  }
  
  /**
   * Adapt thermal time constant based on observed DC behavior
   */
  private adaptTimeConstant(): void {
    // Estimate time constant from rise time
    // τ ≈ t / ln(1 - T/Tsteady)
    
    const recent = this.dcHistory.slice(-60);
    const initial = recent[0];
    const current = recent[recent.length - 1];
    const delta = current - initial;
    
    if (Math.abs(delta) > 5) { // Significant change detected
      const elapsed = recent.length / this.config.sampleRate;
      // Estimate assuming we're halfway to steady state
      const estimatedTau = elapsed / Math.log(2);
      
      // Smooth adaptation (constrained to physiological range)
      const targetTau = Math.max(5, Math.min(20, estimatedTau));
      this.estimatedTau += (targetTau - this.estimatedTau) * 0.1;
    }
  }
  
  /**
   * Update DC history with new sample
   */
  private updateDCHistory(dcLevel: number): void {
    this.dcHistory.push(dcLevel);
    if (this.dcHistory.length > this.MAX_HISTORY) {
      this.dcHistory.shift();
    }
  }
  
  /**
   * Calculate variance of array
   */
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  }
  
  /**
   * Get current thermal state (for telemetry)
   */
  getThermalState(timestamp?: number): ThermalState {
    const now = timestamp ?? performance.now();
    const elapsed = (now - this.measurementStartTime) / 1000;
    return this.estimateThermalState(elapsed);
  }
  
  /**
   * Check if compensation is active
   */
  isActive(): boolean {
    return this.compensationActive;
  }
  
  /**
   * Get elapsed measurement time
   */
  getElapsedTime(timestamp?: number): number {
    const now = timestamp ?? performance.now();
    return (now - this.measurementStartTime) / 1000;
  }
  
  /**
   * Stop measurement and reset
   */
  stop(): void {
    this.compensationActive = false;
    this.dcHistory = [];
    this.tempEstimate = 0;
    this.tempVelocity = 0;
    this.frameCount = 0;
  }
  
  /**
   * Reset for new measurement
   */
  reset(): void {
    this.stop();
    this.estimatedTau = this.config.thermalTimeConstant;
  }
}

// Factory function
export function createThermalCompensator(config?: Partial<ThermalConfig>): ThermalCompensator {
  return new ThermalCompensator(config);
}
