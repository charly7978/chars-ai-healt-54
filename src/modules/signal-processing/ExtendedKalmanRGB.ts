/**
 * EXTENDED KALMAN FILTER 3D — Non-linear state estimation for RGB PPG signals
 * 
 * Implements EKF for joint estimation of:
 * - DC levels (baseline) of R, G, B channels
 * - AC amplitudes (pulse strength) per channel
 * - Phase relationships between channels
 * - Slow drift (thermal/camera adaptation)
 * 
 * State vector: x = [R_dc, G_dc, B_dc, R_ac, G_ac, B_ac, phi_rg, phi_rb, drift]^T
 * 
 * Non-linear observation: z = h(x) + v, where h models Beer-Lambert
 * 
 * Phase 5: Joint multi-channel estimation with physiological constraints
 * 
 * References:
 * - Welch & Bishop (2006): An Introduction to the Kalman Filter
 * - Maybeck (1979): Stochastic Models, Estimation, and Control
 */

export interface EKFState {
  /** State vector: [R_dc, G_dc, B_dc, R_ac, G_ac, B_ac, phi_rg, phi_rb, drift] */
  x: Float64Array;
  /** State covariance matrix (9x9) */
  P: number[][];
  /** Estimated process noise covariance */
  Q: number[][];
  /** Estimated measurement noise covariance */
  R: number[][];
}

export interface EKFConfig {
  /** Process noise scaling */
  qScale: number;
  /** Measurement noise (RGB intensity units) */
  rMeasurement: number;
  /** Initial state covariance */
  p0: number;
  /** Adaptation rate for Q/R */
  adaptationRate: number;
}

export interface EKFResult {
  /** Filtered RGB values */
  rgb: { r: number; g: number; b: number };
  /** AC components (pulsatile) */
  ac: { r: number; g: number; b: number };
  /** Phase differences (radians) */
  phases: { rg: number; rb: number };
  /** Signal quality estimate (0-1) */
  quality: number;
  /** Prediction error (innovation) */
  innovation: { r: number; g: number; b: number };
  /** Kalman gain magnitude (average) */
  avgKalmanGain: number;
}

export class ExtendedKalmanRGB {
  private config: EKFConfig;
  private state: EKFState;
  
  // Innovation history for adaptive Q/R
  private innovationHistory: number[] = [];
  private readonly INNOVATION_WINDOW = 60;
  
  // Physiological constraints
  private readonly HR_MIN = 0.5; // Hz (30 BPM)
  private readonly HR_MAX = 4.0; // Hz (240 BPM)
  private sampleRate = 30;
  private frameCount = 0;
  
  constructor(config: Partial<EKFConfig> = {}, sampleRate = 30) {
    this.config = {
      qScale: 0.01,
      rMeasurement: 4.0,
      p0: 100.0,
      adaptationRate: 0.02,
      ...config
    };
    
    this.sampleRate = sampleRate;
    
    // Initialize state
    this.state = {
      x: new Float64Array([100, 100, 100, 5, 5, 5, 0, 0, 0]), // Initial guess
      P: this.diagMatrix(9, this.config.p0),
      Q: this.computeProcessNoise(),
      R: this.diagMatrix(3, this.config.rMeasurement)
    };
  }
  
  /**
   * Update EKF with new RGB measurement
   * 
   * @param r Raw red channel value
   * @param g Raw green channel value
   * @param b Raw blue channel value
   * @param timestamp Optional frame timestamp
   * @returns Filtered estimate with quality metrics
   */
  update(r: number, g: number, b: number, timestamp?: number): EKFResult {
    this.frameCount++;
    
    // Measurement vector
    const z = new Float64Array([r, g, b]);
    
    // === PREDICTION STEP ===
    const xPred = this.predictState(this.state.x);
    const FP = this.matrixMultiply(this.computeF(), this.state.P);
    const FPFt = this.matrixMultiply(FP, this.transpose(this.computeF()));
    const PPred = this.matrixAdd(FPFt, this.state.Q);
    
    // === UPDATE STEP ===
    // Observation function h(x)
    const h = this.observationFunction(xPred);
    
    // Innovation: y = z - h(x_pred)
    const innovation = new Float64Array([
      z[0] - h[0],
      z[1] - h[1],
      z[2] - h[2]
    ]);
    
    // Update innovation history for adaptive tuning
    this.updateInnovationHistory(innovation);
    
    // Adaptive Q/R based on recent innovation variance
    if (this.frameCount % 30 === 0) {
      this.adaptQR();
    }
    
    // Jacobian H = dh/dx (3x9)
    const H = this.computeJacobianH(xPred);
    
    // Innovation covariance: S = H * P_pred * H^T + R
    const HP = this.matrixMultiply(H, PPred);
    const HPHt = this.matrixMultiply(HP, this.transpose(H));
    const S = this.matrixAdd(HPHt, this.state.R);
    
    // Kalman gain: K = P_pred * H^T * S^(-1)
    const Sinv = this.invert3x3(S);
    const PHt = this.matrixMultiply(PPred, this.transpose(H));
    const K = this.matrixMultiply(PHt, Sinv); // 9x3
    
    // State update: x = x_pred + K * innovation
    const KInnovation = this.matrixVectorMultiply(K, innovation);
    this.state.x = this.vectorAdd(xPred, KInnovation);
    
    // Enforce physiological constraints
    this.enforceConstraints();
    
    // Covariance update: P = (I - K * H) * P_pred
    const KH = this.matrixMultiply(K, H);
    const I = this.identityMatrix(9);
    const IminusKH = this.matrixSubtract(I, KH);
    this.state.P = this.matrixMultiply(IminusKH, PPred);
    
    // Ensure P remains symmetric and positive semi-definite
    this.state.P = this.symmetrize(this.state.P);
    
    // Calculate quality metrics
    const quality = this.estimateQuality(innovation, K);
    
    // Average Kalman gain for diagnostics
    const avgGain = K.flat().reduce((a, b) => a + b, 0) / K.length;
    
    return {
      rgb: {
        r: this.state.x[0],
        g: this.state.x[1],
        b: this.state.x[2]
      },
      ac: {
        r: this.state.x[3],
        g: this.state.x[4],
        b: this.state.x[5]
      },
      phases: {
        rg: this.state.x[6],
        rb: this.state.x[7]
      },
      quality,
      innovation: {
        r: innovation[0],
        g: innovation[1],
        b: innovation[2]
      },
      avgKalmanGain: avgGain
    };
  }
  
  /**
   * State prediction: x_{k+1} = f(x_k)
   * Models slow drift of DC and oscillatory AC
   */
  private predictState(x: Float64Array): Float64Array {
    const xp = new Float64Array(x.length);
    const dt = 1 / this.sampleRate;
    
    // DC levels: random walk with very low drift
    xp[0] = x[0] + x[8] * dt; // R_dc + drift
    xp[1] = x[1] + x[8] * dt; // G_dc + drift (same drift)
    xp[2] = x[2] + x[8] * dt; // B_dc + drift
    
    // AC amplitudes: decay slightly (exponential forgetting)
    const decay = 0.98;
    xp[3] = x[3] * decay;
    xp[4] = x[4] * decay;
    xp[5] = x[5] * decay;
    
    // Phases: continue rotating (maintain frequency estimate)
    // Assuming nominal 1.5 Hz = 90 BPM
    const omega = 2 * Math.PI * 1.5;
    xp[6] = x[6] + omega * dt; // phi_rg
    xp[7] = x[7] + omega * dt; // phi_rb
    
    // Drift: random walk
    xp[8] = x[8] * 0.99;
    
    // Wrap phases to [-pi, pi]
    xp[6] = this.wrapAngle(xp[6]);
    xp[7] = this.wrapAngle(xp[7]);
    
    return xp;
  }
  
  /**
   * Observation function h(x): maps state to expected RGB measurement
   * Models DC + AC * sin(phase) + drift
   */
  private observationFunction(x: Float64Array): Float64Array {
    const t = this.frameCount / this.sampleRate;
    const omega = 2 * Math.PI * 1.5; // Nominal frequency
    
    // Cardiac phase
    const phase = omega * t;
    
    // Expected measurements
    const h0 = x[0] + x[3] * Math.sin(phase); // R
    const h1 = x[1] + x[4] * Math.sin(phase + x[6]); // G (phase shifted)
    const h2 = x[2] + x[5] * Math.sin(phase + x[7]); // B (phase shifted)
    
    return new Float64Array([h0, h1, h2]);
  }
  
  /**
   * Compute Jacobian of observation function: H = dh/dx
   */
  private computeJacobianH(x: Float64Array): number[][] {
    const t = this.frameCount / this.sampleRate;
    const omega = 2 * Math.PI * 1.5;
    const phase = omega * t;
    
    // H is 3x9 matrix
    const H: number[][] = [
      [1, 0, 0, Math.sin(phase), 0, 0, 0, 0, 1], // dh_r/dx
      [0, 1, 0, 0, Math.sin(phase + x[6]), 0, x[4] * Math.cos(phase + x[6]), 0, 1], // dh_g/dx
      [0, 0, 1, 0, 0, Math.sin(phase + x[7]), 0, x[5] * Math.cos(phase + x[7]), 1] // dh_b/dx
    ];
    
    return H;
  }
  
  /**
   * State transition Jacobian F = df/dx
   */
  private computeF(): number[][] {
    const F = this.identityMatrix(9);
    const dt = 1 / this.sampleRate;
    
    // Drift affects DC
    F[0][8] = dt;
    F[1][8] = dt;
    F[2][8] = dt;
    
    // AC decay
    F[3][3] = 0.98;
    F[4][4] = 0.98;
    F[5][5] = 0.98;
    
    // Drift decay
    F[8][8] = 0.99;
    
    return F;
  }
  
  /**
   * Process noise covariance Q
   */
  private computeProcessNoise(): number[][] {
    const q = this.config.qScale;
    const Q = this.diagMatrix(9, 0);
    
    // DC process noise (slow changes)
    Q[0][0] = q * 0.1;
    Q[1][1] = q * 0.1;
    Q[2][2] = q * 0.1;
    
    // AC process noise (moderate changes)
    Q[3][3] = q * 2.0;
    Q[4][4] = q * 2.0;
    Q[5][5] = q * 2.0;
    
    // Phase process noise (small)
    Q[6][6] = q * 0.01;
    Q[7][7] = q * 0.01;
    
    // Drift process noise
    Q[8][8] = q * 0.5;
    
    return Q;
  }
  
  /**
   * Enforce physiological constraints on state
   */
  private enforceConstraints(): void {
    // DC must be positive and reasonable (0-255 for 8-bit)
    this.state.x[0] = Math.max(10, Math.min(250, this.state.x[0]));
    this.state.x[1] = Math.max(10, Math.min(250, this.state.x[1]));
    this.state.x[2] = Math.max(10, Math.min(250, this.state.x[2]));
    
    // AC must be positive and less than DC (physiological)
    this.state.x[3] = Math.max(0, Math.min(this.state.x[0] * 0.3, this.state.x[3]));
    this.state.x[4] = Math.max(0, Math.min(this.state.x[1] * 0.3, this.state.x[4]));
    this.state.x[5] = Math.max(0, Math.min(this.state.x[2] * 0.3, this.state.x[5]));
    
    // Wrap phases
    this.state.x[6] = this.wrapAngle(this.state.x[6]);
    this.state.x[7] = this.wrapAngle(this.state.x[7]);
  }
  
  /**
   * Adapt Q and R based on innovation statistics
   */
  private adaptQR(): void {
    if (this.innovationHistory.length < 20) return;
    
    // Calculate innovation variance
    const recent = this.innovationHistory.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, v) => sum + (v - mean) ** 2, 0) / recent.length;
    
    // Target variance: measurement noise should explain ~10% of innovation variance
    const targetR = Math.max(1, variance * 0.1);
    const targetQ = Math.max(0.001, variance * 0.01);
    
    // Smooth adaptation
    const alpha = this.config.adaptationRate;
    
    for (let i = 0; i < 3; i++) {
      this.state.R[i][i] += (targetR - this.state.R[i][i]) * alpha;
    }
    
    for (let i = 0; i < 6; i++) {
      this.state.Q[i][i] += (targetQ - this.state.Q[i][i]) * alpha;
    }
  }
  
  /**
   * Estimate signal quality based on innovation and Kalman gain
   */
  private estimateQuality(innovation: Float64Array, K: number[][]): number {
    // Normalized innovation magnitude
    const innovMag = Math.sqrt(
      innovation[0] ** 2 + innovation[1] ** 2 + innovation[2] ** 2
    );
    const normalizedInnov = Math.min(1, innovMag / 50); // Assume 50 is large
    
    // Average Kalman gain (high gain = low confidence)
    const avgK = K.flat().reduce((a, b) => a + Math.abs(b), 0) / K.length / K[0].length;
    
    // Quality: high when innovation is small and Kalman gain is moderate
    let quality = 1 - normalizedInnov;
    quality *= (1 - Math.min(1, avgK * 2));
    
    return Math.max(0, Math.min(1, quality));
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // MATRIX UTILITIES (simplified for small matrices)
  // ═══════════════════════════════════════════════════════════════════
  
  private identityMatrix(n: number): number[][] {
    return Array(n).fill(0).map((_, i) => 
      Array(n).fill(0).map((_, j) => i === j ? 1 : 0)
    );
  }
  
  private diagMatrix(n: number, val: number): number[][] {
    return Array(n).fill(0).map((_, i) => 
      Array(n).fill(0).map((_, j) => i === j ? val : 0)
    );
  }
  
  private matrixMultiply(A: number[][], B: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < A.length; i++) {
      result[i] = [];
      for (let j = 0; j < B[0].length; j++) {
        let sum = 0;
        for (let k = 0; k < A[0].length; k++) {
          sum += A[i][k] * B[k][j];
        }
        result[i][j] = sum;
      }
    }
    return result;
  }
  
  private matrixAdd(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((val, j) => val + B[i][j]));
  }
  
  private matrixSubtract(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((val, j) => val - B[i][j]));
  }
  
  private transpose(A: number[][]): number[][] {
    return A[0].map((_, i) => A.map(row => row[i]));
  }
  
  private matrixVectorMultiply(A: number[][], v: Float64Array): Float64Array {
    const result = new Float64Array(A.length);
    for (let i = 0; i < A.length; i++) {
      let sum = 0;
      for (let j = 0; j < v.length; j++) {
        sum += A[i][j] * v[j];
      }
      result[i] = sum;
    }
    return result;
  }
  
  private vectorAdd(a: Float64Array, b: Float64Array): Float64Array {
    return a.map((v, i) => v + b[i]);
  }
  
  private invert3x3(A: number[][]): number[][] {
    // Matrix inversion for 3x3 (S is 3x3)
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
                A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
                A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    
    if (Math.abs(det) < 1e-10) {
      // Return pseudoinverse approximation
      return this.diagMatrix(3, 1e6);
    }
    
    const invDet = 1 / det;
    return [
      [
        (A[1][1] * A[2][2] - A[1][2] * A[2][1]) * invDet,
        (A[0][2] * A[2][1] - A[0][1] * A[2][2]) * invDet,
        (A[0][1] * A[1][2] - A[0][2] * A[1][1]) * invDet
      ],
      [
        (A[1][2] * A[2][0] - A[1][0] * A[2][2]) * invDet,
        (A[0][0] * A[2][2] - A[0][2] * A[2][0]) * invDet,
        (A[0][2] * A[1][0] - A[0][0] * A[1][2]) * invDet
      ],
      [
        (A[1][0] * A[2][1] - A[1][1] * A[2][0]) * invDet,
        (A[0][1] * A[2][0] - A[0][0] * A[2][1]) * invDet,
        (A[0][0] * A[1][1] - A[0][1] * A[1][0]) * invDet
      ]
    ];
  }
  
  private symmetrize(A: number[][]): number[][] {
    return A.map((row, i) => 
      row.map((val, j) => (val + A[j][i]) / 2)
    );
  }
  
  private wrapAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }
  
  private updateInnovationHistory(innovation: Float64Array): void {
    const mag = Math.sqrt(innovation[0]**2 + innovation[1]**2 + innovation[2]**2);
    this.innovationHistory.push(mag);
    if (this.innovationHistory.length > this.INNOVATION_WINDOW) {
      this.innovationHistory.shift();
    }
  }
  
  /**
   * Get current state (for debugging)
   */
  getState(): EKFState {
    return {
      x: new Float64Array(this.state.x),
      P: this.state.P.map(row => [...row]),
      Q: this.state.Q.map(row => [...row]),
      R: this.state.R.map(row => [...row])
    };
  }
  
  /**
   * Reset filter to initial state
   */
  reset(): void {
    this.state = {
      x: new Float64Array([100, 100, 100, 5, 5, 5, 0, 0, 0]),
      P: this.diagMatrix(9, this.config.p0),
      Q: this.computeProcessNoise(),
      R: this.diagMatrix(3, this.config.rMeasurement)
    };
    this.innovationHistory = [];
    this.frameCount = 0;
  }
}

// Factory function
export function createExtendedKalmanRGB(config?: Partial<EKFConfig>, sampleRate?: number): ExtendedKalmanRGB {
  return new ExtendedKalmanRGB(config, sampleRate);
}
