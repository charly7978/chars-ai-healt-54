/**
 * Kalman Filter for Heart Rate Estimation
 * 
 * Based on: Kalman filtering theory for state estimation
 * 
 * Kalman filter provides optimal estimation of heart rate by:
 * - Fusing multiple measurements with uncertainty
 * - Predicting HR based on previous state
 * - Smoothing noisy measurements
 * - Adapting to changing dynamics
 * 
 * State vector: [heart_rate, heart_rate_derivative]
 * Measurement: Instantaneous heart rate from PPG
 * 
 * Algorithm:
 * 1. Predict: x̂(k|k-1) = F * x̂(k-1|k-1)
 * 2. Predict covariance: P(k|k-1) = F * P(k-1|k-1) * F^T + Q
 * 3. Compute Kalman gain: K = P(k|k-1) * H^T * (H * P(k|k-1) * H^T + R)^(-1)
 * 4. Update state: x̂(k|k) = x̂(k|k-1) + K * (z(k) - H * x̂(k|k-1))
 * 5. Update covariance: P(k|k) = (I - K * H) * P(k|k-1)
 * 
 * Where:
 * - F: State transition matrix
 * - H: Measurement matrix
 * - Q: Process noise covariance
 * - R: Measurement noise covariance
 * - P: Error covariance matrix
 * - K: Kalman gain
 * - z: Measurement
 * - x̂: State estimate
 */

export class KalmanFilter {
  // State vector: [heart_rate, heart_rate_derivative]
  private state: Float64Array;

  // State transition matrix F
  private F: Float64Array;

  // Measurement matrix H
  private H: Float64Array;

  // Error covariance matrix P
  private P: Float64Array;

  // Process noise covariance Q
  private Q: Float64Array;

  // Measurement noise covariance R
  private R: number;

  // Kalman gain
  private K: Float64Array;

  // Sampling interval (seconds)
  private dt: number;

  // Identity matrix
  private I: Float64Array;

  constructor(
    initialHR: number = 72,
    dt: number = 1/30,  // 30 Hz sampling
    processNoise: number = 0.1,
    measurementNoise: number = 5.0
  ) {
    this.dt = dt;
    this.state = new Float64Array([initialHR, 0]);

    // State transition matrix: [1, dt; 0, 1]
    this.F = new Float64Array([
      1, dt,
      0, 1
    ]);

    // Measurement matrix: [1, 0] (we only measure HR directly)
    this.H = new Float64Array([1, 0]);

    // Initial error covariance
    this.P = new Float64Array([
      10, 0,
      0, 1
    ]);

    // Process noise covariance (model uncertainty)
    this.Q = new Float64Array([
      processNoise * dt * dt, processNoise * dt,
      processNoise * dt, processNoise
    ]);

    // Measurement noise (sensor uncertainty)
    this.R = measurementNoise;

    // Kalman gain
    this.K = new Float64Array(2);

    // Identity matrix
    this.I = new Float64Array([
      1, 0,
      0, 1
    ]);
  }

  /**
   * Update filter with new measurement
   * 
   * @param measurement - Instantaneous heart rate measurement
   * @param measurementNoise - Optional dynamic measurement noise
   * @returns Filtered heart rate estimate
   */
  update(measurement: number, measurementNoise?: number): {
    heartRate: number;
    heartRateDerivative: number;
    kalmanGain: Float64Array;
    confidence: number;
  } {
    if (measurementNoise !== undefined) {
      this.R = measurementNoise;
    }

    // --- Prediction step ---
    // x̂(k|k-1) = F * x̂(k-1|k-1)
    const predictedState = this.matrixMultiply(this.F, this.state, 2, 2, 1);

    // P(k|k-1) = F * P(k-1|k-1) * F^T + Q
    const FP = this.matrixMultiply(this.F, this.P, 2, 2, 2);
    const FPT = this.matrixMultiply(FP, this.transpose(this.F, 2), 2, 2, 2);
    const predictedP = this.matrixAdd(FPT, this.Q, 2, 2);

    // --- Update step ---
    // S = H * P * H^T + R
    const HP = this.matrixMultiply(this.H, predictedP, 1, 2, 2);
    const HPT = this.matrixMultiply(HP, this.transpose(this.H, 2), 1, 2, 1);
    const S = HPT[0] + this.R;

    // K = P * H^T * S^(-1)
    const PHT = this.matrixMultiply(predictedP, this.transpose(this.H, 2), 2, 2, 1);
    const SInv = 1 / S;
    this.K = new Float64Array([
      PHT[0] * SInv,
      PHT[1] * SInv
    ]);

    // Innovation: y = z - H * x̂
    const Hx = this.matrixMultiply(this.H, predictedState, 1, 2, 1);
    const innovation = measurement - Hx[0];

    // x̂(k|k) = x̂(k|k-1) + K * y
    const Ky = new Float64Array([
      this.K[0] * innovation,
      this.K[1] * innovation
    ]);
    this.state = this.matrixAdd(predictedState, Ky, 2, 1);

    // P(k|k) = (I - K * H) * P
    const KH = this.matrixMultiply(this.reshape(this.K, 2, 1), this.H, 2, 1, 2);
    const I_KH = this.matrixSubtract(this.I, KH, 2, 2);
    this.P = this.matrixMultiply(I_KH, predictedP, 2, 2, 2);

    // Confidence based on trace of P
    const confidence = 1 / (1 + Math.sqrt(this.P[0] + this.P[3]));

    return {
      heartRate: this.state[0],
      heartRateDerivative: this.state[1],
      kalmanGain: this.K,
      confidence
    };
  }

  /**
   * Get current state estimate
   */
  getState(): {
    heartRate: number;
    heartRateDerivative: number;
  } {
    return {
      heartRate: this.state[0],
      heartRateDerivative: this.state[1]
    };
  }

  /**
   * Get error covariance matrix
   */
  getCovariance(): Float64Array {
    return this.P;
  }

  /**
   * Reset filter to initial state
   */
  reset(initialHR?: number): void {
    this.state = new Float64Array([initialHR || 72, 0]);
    this.P = new Float64Array([
      10, 0,
      0, 1
    ]);
  }

  /**
   * Set process noise covariance
   */
  setProcessNoise(processNoise: number): void {
    this.Q = new Float64Array([
      processNoise * this.dt * this.dt, processNoise * this.dt,
      processNoise * this.dt, processNoise
    ]);
  }

  /**
   * Set measurement noise
   */
  setMeasurementNoise(measurementNoise: number): void {
    this.R = measurementNoise;
  }

  /**
   * Matrix multiplication
   */
  private matrixMultiply(A: Float64Array, B: Float64Array, rowsA: number, colsA: number, colsB: number): Float64Array {
    const result = new Float64Array(rowsA * colsB);

    for (let i = 0; i < rowsA; i++) {
      for (let j = 0; j < colsB; j++) {
        let sum = 0;
        for (let k = 0; k < colsA; k++) {
          sum += A[i * colsA + k] * B[k * colsB + j];
        }
        result[i * colsB + j] = sum;
      }
    }

    return result;
  }

  /**
   * Matrix addition
   */
  private matrixAdd(A: Float64Array, B: Float64Array, rows: number, cols: number): Float64Array {
    const result = new Float64Array(rows * cols);

    for (let i = 0; i < rows * cols; i++) {
      result[i] = A[i] + B[i];
    }

    return result;
  }

  /**
   * Matrix subtraction
   */
  private matrixSubtract(A: Float64Array, B: Float64Array, rows: number, cols: number): Float64Array {
    const result = new Float64Array(rows * cols);

    for (let i = 0; i < rows * cols; i++) {
      result[i] = A[i] - B[i];
    }

    return result;
  }

  /**
   * Matrix transpose
   */
  private transpose(A: Float64Array, size: number): Float64Array {
    const result = new Float64Array(size * size);

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        result[i * size + j] = A[j * size + i];
      }
    }

    return result;
  }

  /**
   * Reshape 1D array to 2D (in-place view)
   */
  private reshape(A: Float64Array, rows: number, cols: number): Float64Array {
    return A;  // Float64Array is already 1D, just return it
  }
}

/**
 * Multi-source Kalman Filter for fusing multiple HR estimates
 */
export class MultiSourceKalmanFilter {
  private filters: KalmanFilter[];
  private fusionWeights: Float64Array;
  private numSources: number;

  constructor(
    numSources: number = 3,
    initialHR: number = 72,
    dt: number = 1/30
  ) {
    this.numSources = numSources;
    this.filters = [];
    this.fusionWeights = new Float64Array(numSources);

    for (let i = 0; i < numSources; i++) {
      this.filters.push(new KalmanFilter(initialHR, dt));
      this.fusionWeights[i] = 1 / numSources;  // Equal weights initially
    }
  }

  /**
   * Update all filters with measurements and fuse results
   */
  update(measurements: number[], measurementNoises?: number[]): {
    fusedHeartRate: number;
    individualEstimates: number[];
    confidences: number[];
  } {
    if (measurements.length !== this.numSources) {
      throw new Error(`Expected ${this.numSources} measurements`);
    }

    const individualEstimates: number[] = [];
    const confidences: number[] = [];

    for (let i = 0; i < this.numSources; i++) {
      const noise = measurementNoises?.[i];
      const result = this.filters[i].update(measurements[i], noise);
      individualEstimates.push(result.heartRate);
      confidences.push(result.confidence);
    }

    // Adaptive fusion based on confidence
    const totalConfidence = confidences.reduce((sum, c) => sum + c, 0);
    if (totalConfidence > 0) {
      for (let i = 0; i < this.numSources; i++) {
        this.fusionWeights[i] = confidences[i] / totalConfidence;
      }
    }

    // Weighted fusion
    let fusedHR = 0;
    for (let i = 0; i < this.numSources; i++) {
      fusedHR += this.fusionWeights[i] * individualEstimates[i];
    }

    return {
      fusedHeartRate: fusedHR,
      individualEstimates,
      confidences
    };
  }

  /**
   * Reset all filters
   */
  reset(initialHR?: number): void {
    for (const filter of this.filters) {
      filter.reset(initialHR);
    }
  }

  /**
   * Get fusion weights
   */
  getWeights(): Float64Array {
    return this.fusionWeights.slice();
  }
}
