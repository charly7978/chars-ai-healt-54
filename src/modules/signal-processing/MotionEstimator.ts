/**
 * MOTION ESTIMATOR
 * 
 * Real motion estimation combining:
 * - IMU sensors (accelerometer + gyroscope)
 * - Visual motion detection (frame difference, multi-resolution)
 * - Sensor fusion with adaptive weighting
 * - Temporal hysteresis and severity classification
 * 
 * Provides: motionScore [0-1], motionState, confidence
 */

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export type MotionState = 
  | 'STATIONARY'      // No significant motion
  | 'LOW'             // Minor motion, acceptable
  | 'MODERATE'        // Noticeable motion, signal degradation likely
  | 'HIGH'            // Significant motion, unusable signal
  | 'EXTREME';        // Extreme motion, measurement impossible

export interface MotionEstimate {
  score: number;              // 0-1 composite score
  state: MotionState;         // Discretized severity
  imuScore: number;          // 0-1 IMU contribution
  visualScore: number;       // 0-1 visual contribution
  confidence: number;        // 0-1 estimation confidence
  isReliable: boolean;       // Can we trust this estimate?
  imuAvailable: boolean;     // Was IMU data available?
  visualAvailable: boolean;  // Was visual data available?
}

export interface IMUData {
  acceleration: { x: number; y: number; z: number } | null;
  accelerationIncludingGravity: { x: number; y: number; z: number } | null;
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null;
  interval: number;
}

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface MotionEstimatorConfig {
  // Thresholds for motion severity
  stationaryThreshold: number;
  lowThreshold: number;
  moderateThreshold: number;
  highThreshold: number;
  
  // Sensor weights
  imuWeight: number;
  visualWeight: number;
  
  // Temporal smoothing
  temporalAlpha: number;     // EWMA factor (0-1, higher = more responsive)
  hysteresisFrames: number;    // Frames to confirm state change
  
  // Visual motion
  visualSampleStep: number;  // Pixel sampling step (performance)
  visualRegionRatio: number; // Region of frame to analyze
  visualNormalization: number; // Divisor for normalization
  
  // Multi-resolution visual
  enableMultiResolution: boolean;
  resolutionLevels: number[];  // Downsample factors
}

const DEFAULT_CONFIG: MotionEstimatorConfig = {
  stationaryThreshold: 0.05,
  lowThreshold: 0.15,
  moderateThreshold: 0.35,
  highThreshold: 0.60,
  
  imuWeight: 0.6,
  visualWeight: 0.4,
  
  temporalAlpha: 0.15,
  hysteresisFrames: 3,
  
  visualSampleStep: 4,
  visualRegionRatio: 0.6,
  visualNormalization: 30,
  
  enableMultiResolution: true,
  resolutionLevels: [1, 2, 4], // Full, half, quarter resolution
};

// ═══════════════════════════════════════════════════════════════════
//  MOTION ESTIMATOR CLASS
// ═══════════════════════════════════════════════════════════════════

export class MotionEstimator {
  private config: MotionEstimatorConfig;
  
  // State
  private smoothedScore = 0;
  private currentState: MotionState = 'STATIONARY';
  private pendingState: MotionState | null = null;
  private pendingCount = 0;
  
  // IMU state
  private lastAccel = { x: 0, y: 0, z: 0 };
  private lastAccelTimestamp = 0;
  private imuHistory: number[] = [];
  private readonly IMU_HISTORY_SIZE = 10;
  
  // Visual state
  private prevImageData: ImageData | null = null;
  private visualHistory: number[] = [];
  private readonly VISUAL_HISTORY_SIZE = 5;
  
  // Metrics tracking
  private imuAvailability = 0;  // 0-1 recent availability
  private visualAvailability = 0; // 0-1 recent availability
  
  constructor(config: Partial<MotionEstimatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  MAIN ESTIMATION
  // ═════════════════════════════════════════════════════════════════
  
  /**
   * Update with IMU data from DeviceMotionEvent
   */
  updateIMU(imuData: IMUData): void {
    const acc = imuData.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) {
      this.imuAvailability = Math.max(0, this.imuAvailability - 0.1);
      return;
    }
    
    // Compute acceleration delta
    const dx = acc.x - this.lastAccel.x;
    const dy = acc.y - this.lastAccel.y;
    const dz = acc.z - this.lastAccel.z;
    
    // Update last values
    this.lastAccel = { x: acc.x, y: acc.y, z: acc.z };
    
    // RMS acceleration (normalized)
    // Typical phone shaking: 0.5-2g → normalized to 0-1
    const accelMagnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const accelScore = Math.min(1, accelMagnitude / 0.5); // 0.5g as threshold
    
    // Gyroscope contribution
    let gyroScore = 0;
    const rot = imuData.rotationRate;
    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      const gyroMagnitude = Math.sqrt(
        (rot.alpha ?? 0) ** 2 + 
        (rot.beta ?? 0) ** 2 + 
        (rot.gamma ?? 0) ** 2
      );
      // Typical rotation: 30-100 deg/s → normalized
      gyroScore = Math.min(1, gyroMagnitude / 60);
    }
    
    // Combined IMU score (accel dominates, gyro confirms)
    const imuScore = Math.max(accelScore, gyroScore * 0.5);
    
    // Update history
    this.imuHistory.push(imuScore);
    if (this.imuHistory.length > this.IMU_HISTORY_SIZE) {
      this.imuHistory.shift();
    }
    
    this.imuAvailability = Math.min(1, this.imuAvailability + 0.2);
    this.lastAccelTimestamp = performance.now();
  }
  
  /**
   * Update with visual motion from frame difference
   */
  updateVisual(currentImageData: ImageData): void {
    if (!this.prevImageData) {
      this.prevImageData = this.cloneImageData(currentImageData);
      this.visualAvailability = Math.max(0, this.visualAvailability - 0.05);
      return;
    }
    
    const score = this.config.enableMultiResolution
      ? this.computeMultiResolutionVisualMotion(currentImageData, this.prevImageData)
      : this.computeVisualMotionSingle(currentImageData, this.prevImageData);
    
    // Update history
    this.visualHistory.push(score);
    if (this.visualHistory.length > this.VISUAL_HISTORY_SIZE) {
      this.visualHistory.shift();
    }
    
    // Store current frame for next comparison
    this.prevImageData = this.cloneImageData(currentImageData);
    this.visualAvailability = Math.min(1, this.visualAvailability + 0.1);
  }
  
  /**
   * Get current motion estimate
   */
  getEstimate(): MotionEstimate {
    // Get recent scores from history
    const recentImu = this.getRecentMax(this.imuHistory, 3);
    const recentVisual = this.getRecentMax(this.visualHistory, 3);
    
    // Determine availability
    const imuAvailable = this.imuAvailability > 0.3 && recentImu !== null;
    const visualAvailable = this.visualAvailability > 0.3 && recentVisual !== null;
    
    // Compute weighted score
    let rawScore = 0;
    let totalWeight = 0;
    
    if (imuAvailable) {
      rawScore += (recentImu ?? 0) * this.config.imuWeight;
      totalWeight += this.config.imuWeight;
    }
    
    if (visualAvailable) {
      rawScore += (recentVisual ?? 0) * this.config.visualWeight;
      totalWeight += this.config.visualWeight;
    }
    
    // Normalize if sensors missing
    if (totalWeight > 0) {
      rawScore /= totalWeight;
    }
    
    // Temporal smoothing
    this.smoothedScore = this.smoothedScore * (1 - this.config.temporalAlpha) + 
                         rawScore * this.config.temporalAlpha;
    
    // State determination with hysteresis
    const newState = this.determineState(this.smoothedScore);
    const finalState = this.applyHysteresis(newState);
    
    // Confidence based on sensor availability
    const confidence = Math.min(1, 
      (imuAvailable ? 0.5 : 0) + 
      (visualAvailable ? 0.5 : 0) +
      (totalWeight > 0.8 ? 0.2 : 0) // Bonus for both sensors
    );
    
    return {
      score: this.smoothedScore,
      state: finalState,
      imuScore: recentImu ?? 0,
      visualScore: recentVisual ?? 0,
      confidence,
      isReliable: confidence > 0.4,
      imuAvailable,
      visualAvailable,
    };
  }
  
  /**
   * Reset estimator state
   */
  reset(): void {
    this.smoothedScore = 0;
    this.currentState = 'STATIONARY';
    this.pendingState = null;
    this.pendingCount = 0;
    this.lastAccel = { x: 0, y: 0, z: 0 };
    this.imuHistory = [];
    this.visualHistory = [];
    this.prevImageData = null;
    this.imuAvailability = 0;
    this.visualAvailability = 0;
  }
  
  // ═════════════════════════════════════════════════════════════════
  //  PRIVATE METHODS
  // ═════════════════════════════════════════════════════════════════
  
  private determineState(score: number): MotionState {
    if (score < this.config.stationaryThreshold) return 'STATIONARY';
    if (score < this.config.lowThreshold) return 'LOW';
    if (score < this.config.moderateThreshold) return 'MODERATE';
    if (score < this.config.highThreshold) return 'HIGH';
    return 'EXTREME';
  }
  
  private applyHysteresis(newState: MotionState): MotionState {
    if (newState === this.currentState) {
      this.pendingState = null;
      this.pendingCount = 0;
      return this.currentState;
    }
    
    if (this.pendingState === newState) {
      this.pendingCount++;
    } else {
      this.pendingState = newState;
      this.pendingCount = 1;
    }
    
    if (this.pendingCount >= this.config.hysteresisFrames) {
      this.currentState = newState;
      this.pendingState = null;
      this.pendingCount = 0;
    }
    
    return this.currentState;
  }
  
  private getRecentMax(history: number[], window: number): number | null {
    if (history.length === 0) return null;
    const recent = history.slice(-window);
    return Math.max(...recent);
  }
  
  private computeVisualMotionSingle(
    current: ImageData, 
    previous: ImageData
  ): number {
    const data = current.data;
    const prevData = previous.data;
    const w = current.width;
    const h = current.height;
    
    // Sample central region
    const roiSize = Math.min(w, h) * this.config.visualRegionRatio;
    const sx = Math.floor((w - roiSize) / 2);
    const sy = Math.floor((h - roiSize) / 2);
    const ex = Math.min(sx + Math.floor(roiSize), w);
    const ey = Math.min(sy + Math.floor(roiSize), h);
    
    let totalDiff = 0;
    let sampleCount = 0;
    const step = this.config.visualSampleStep;
    
    for (let y = sy; y < ey; y += step) {
      for (let x = sx; x < ex; x += step) {
        const i = (y * w + x) * 4;
        const rDiff = Math.abs(data[i] - prevData[i]);
        const gDiff = Math.abs(data[i + 1] - prevData[i + 1]);
        const bDiff = Math.abs(data[i + 2] - prevData[i + 2]);
        totalDiff += (rDiff + gDiff + bDiff) / 3;
        sampleCount++;
      }
    }
    
    if (sampleCount === 0) return 0;
    const avgDiff = totalDiff / sampleCount;
    return Math.min(1, avgDiff / this.config.visualNormalization);
  }
  
  private computeMultiResolutionVisualMotion(
    current: ImageData,
    previous: ImageData
  ): number {
    const scores: number[] = [];
    
    for (const downsample of this.config.resolutionLevels) {
      const currentDown = this.downsampleImageData(current, downsample);
      const previousDown = this.downsampleImageData(previous, downsample);
      const score = this.computeVisualMotionSingle(currentDown, previousDown);
      scores.push(score);
    }
    
    // Weight higher resolution more (fine motion) but include coarse
    const weights = [0.5, 0.3, 0.2]; // Full, half, quarter
    let weightedSum = 0;
    let totalWeight = 0;
    
    scores.forEach((score, i) => {
      const weight = weights[i] ?? 0.1;
      weightedSum += score * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }
  
  private downsampleImageData(source: ImageData, factor: number): ImageData {
    if (factor === 1) return source;
    
    const w = Math.floor(source.width / factor);
    const h = Math.floor(source.height / factor);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    
    // Create temporary canvas for source
    const tempCanvas = new OffscreenCanvas(source.width, source.height);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(source, 0, 0);
    
    // Draw downscaled
    ctx.drawImage(tempCanvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }
  
  private cloneImageData(source: ImageData): ImageData {
    // Efficient clone using Uint8ClampedArray copy
    const cloned = new Uint8ClampedArray(source.data);
    return new ImageData(cloned, source.width, source.height);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY EXPORTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert MotionState to severity level (0-4)
 */
export function motionStateToLevel(state: MotionState): number {
  const levels: Record<MotionState, number> = {
    'STATIONARY': 0,
    'LOW': 1,
    'MODERATE': 2,
    'HIGH': 3,
    'EXTREME': 4,
  };
  return levels[state];
}

/**
 * Check if motion state allows reliable PPG measurement
 */
export function isMotionAcceptableForPPG(state: MotionState): boolean {
  return state === 'STATIONARY' || state === 'LOW';
}
