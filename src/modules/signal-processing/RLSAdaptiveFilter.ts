/**
 * RLS (Recursive Least Squares) Adaptive Filter for PPG Motion Artifact Removal
 * 
 * Based on: Recursive least squares adaptive filtering theory
 * 
 * Advantages over LMS:
 * - Faster convergence (exponential vs linear)
 * - Lower steady-state error
 * - Better tracking of rapidly changing motion patterns
 * - No step size parameter to tune
 * 
 * Algorithm:
 * P(n+1) = (1/λ) * [P(n) - k(n) * x(n)^T * P(n)]
 * k(n) = P(n) * x(n) / [λ + x(n)^T * P(n) * x(n)]
 * w(n+1) = w(n) + k(n) * e(n)
 * e(n) = d(n) - w(n)^T * x(n)
 * 
 * Where:
 * - P: Inverse correlation matrix (initialized as δ*I)
 * - λ: Forgetting factor (0.95 < λ < 1.0, typically 0.99)
 * - k: Gain vector
 * - w: Filter weights
 * - e: Error signal
 * - x: Reference input
 * - d: Desired signal
 * 
 * Tradeoff:
 * - Computational complexity: O(N²) vs LMS O(N)
 * - Better performance justifies complexity for critical applications
 */

export class RLSAdaptiveFilter {
  // Filter weights
  private weights: Float64Array;
  private filterOrder: number;

  // Inverse correlation matrix P
  private P: Float64Array[];  // 2D array as array of Float64Arrays

  // Gain vector
  private k: Float64Array;

  // Forgetting factor (0.95-1.0)
  private lambda: number;

  // Regularization parameter (initial P = δ*I)
  private delta: number;

  // State variables
  private inputBuffer: Float64Array;
  private bufferIndex: number = 0;

  // Statistics
  private outputHistory: Float64Array;
  private errorHistory: Float64Array;
  private historySize: number = 100;

  constructor(
    filterOrder: number = 32,
    lambda: number = 0.99,
    delta: number = 0.01
  ) {
    this.filterOrder = filterOrder;
    this.weights = new Float64Array(filterOrder);
    this.lambda = lambda;
    this.delta = delta;

    // Initialize P as δ * I (identity matrix)
    this.P = [];
    for (let i = 0; i < filterOrder; i++) {
      const row = new Float64Array(filterOrder);
      row[i] = delta;  // Diagonal elements
      this.P.push(row);
    }

    this.k = new Float64Array(filterOrder);
    this.inputBuffer = new Float64Array(filterOrder);
    this.outputHistory = new Float64Array(this.historySize);
    this.errorHistory = new Float64Array(this.historySize);
  }

  /**
   * Process a new sample with RLS adaptive filtering
   * 
   * @param primaryInput - The corrupted PPG signal
   * @param referenceInput - The motion reference (accelerometer or pseudo-reference)
   * @returns Filtered output (estimated clean PPG)
   */
  process(primaryInput: number, referenceInput: number): {
    output: number;
    error: number;
    weights: Float64Array;
  } {
    // Update input buffer (circular)
    this.inputBuffer[this.bufferIndex] = referenceInput;
    this.bufferIndex = (this.bufferIndex + 1) % this.filterOrder;

    // Construct input vector x(n) from buffer
    const x = new Float64Array(this.filterOrder);
    for (let i = 0; i < this.filterOrder; i++) {
      const idx = (this.bufferIndex - i - 1 + this.filterOrder) % this.filterOrder;
      x[i] = this.inputBuffer[idx];
    }

    // Compute filter output: y(n) = w^T * x(n)
    let output = 0;
    for (let i = 0; i < this.filterOrder; i++) {
      output += this.weights[i] * x[i];
    }

    // Compute error: e(n) = d(n) - y(n)
    const error = primaryInput - output;

    // Compute P * x
    const Px = new Float64Array(this.filterOrder);
    for (let i = 0; i < this.filterOrder; i++) {
      for (let j = 0; j < this.filterOrder; j++) {
        Px[i] += this.P[i][j] * x[j];
      }
    }

    // Compute denominator: λ + x^T * P * x
    let denominator = this.lambda;
    for (let i = 0; i < this.filterOrder; i++) {
      denominator += x[i] * Px[i];
    }

    // Compute gain vector: k = P * x / (λ + x^T * P * x)
    for (let i = 0; i < this.filterOrder; i++) {
      this.k[i] = Px[i] / denominator;
    }

    // Update weights: w(n+1) = w(n) + k * e(n)
    for (let i = 0; i < this.filterOrder; i++) {
      this.weights[i] += this.k[i] * error;
      
      // Weight clipping to prevent instability
      this.weights[i] = Math.max(-10, Math.min(10, this.weights[i]));
    }

    // Update P matrix: P(n+1) = (1/λ) * [P(n) - k * x^T * P(n)]
    const kxT_P = new Float64Array(this.filterOrder);
    for (let i = 0; i < this.filterOrder; i++) {
      for (let j = 0; j < this.filterOrder; j++) {
        kxT_P[i] += this.k[i] * x[j] * this.P[j][i];
      }
    }

    for (let i = 0; i < this.filterOrder; i++) {
      for (let j = 0; j < this.filterOrder; j++) {
        this.P[i][j] = (this.P[i][j] - this.k[i] * Px[j]) / this.lambda;
      }
    }

    // Update history
    this.updateHistory(output, error);

    return {
      output: error,  // In PPG, the error is the clean signal
      error: error,
      weights: this.weights.slice()
    };
  }

  /**
   * Process a buffer of samples (batch processing)
   */
  processBatch(
    primaryInput: Float64Array,
    referenceInput: Float64Array
  ): {
    output: Float64Array;
    error: Float64Array;
    finalWeights: Float64Array;
  } {
    const length = Math.min(primaryInput.length, referenceInput.length);
    const output = new Float64Array(length);
    const error = new Float64Array(length);

    for (let i = 0; i < length; i++) {
      const result = this.process(primaryInput[i], referenceInput[i]);
      output[i] = result.output;
      error[i] = result.error;
    }

    return {
      output,
      error,
      finalWeights: this.weights.slice()
    };
  }

  /**
   * Update output and error history buffers
   */
  private updateHistory(output: number, error: number): void {
    for (let i = 0; i < this.historySize - 1; i++) {
      this.outputHistory[i] = this.outputHistory[i + 1];
      this.errorHistory[i] = this.errorHistory[i + 1];
    }
    this.outputHistory[this.historySize - 1] = output;
    this.errorHistory[this.historySize - 1] = error;
  }

  /**
   * Reset filter state
   */
  reset(): void {
    this.weights.fill(0);
    this.inputBuffer.fill(0);
    this.bufferIndex = 0;
    this.outputHistory.fill(0);
    this.errorHistory.fill(0);

    // Reinitialize P matrix
    for (let i = 0; i < this.filterOrder; i++) {
      this.P[i].fill(0);
      this.P[i][i] = this.delta;
    }
  }

  /**
   * Get filter convergence metrics
   */
  getConvergenceMetrics(): {
    converged: boolean;
    steadyStateError: number;
    weightStability: number;
  } {
    let errorSum = 0;
    let errorCount = 0;
    for (let i = Math.max(0, this.historySize - 20); i < this.historySize; i++) {
      errorSum += Math.abs(this.errorHistory[i]);
      errorCount++;
    }
    const steadyStateError = errorCount > 0 ? errorSum / errorCount : 0;

    let weightVar = 0;
    for (let i = 0; i < this.filterOrder; i++) {
      weightVar += this.weights[i] * this.weights[i];
    }
    const weightStability = Math.sqrt(weightVar / this.filterOrder);

    // RLS converges faster than LMS
    const converged = steadyStateError < 0.05 && weightStability < 1.0;

    return {
      converged,
      steadyStateError,
      weightStability
    };
  }

  /**
   * Get filter weights
   */
  getWeights(): Float64Array {
    return this.weights.slice();
  }

  /**
   * Set forgetting factor
   */
  setLambda(lambda: number): void {
    this.lambda = Math.max(0.95, Math.min(1.0, lambda));
  }

  /**
   * Get forgetting factor
   */
  getLambda(): number {
    return this.lambda;
  }
}

/**
 * Multi-reference RLS for triaxial accelerometer
 * Combines three RLS filters for improved motion cancellation
 */
export class MultiReferenceRLS {
  private filters: RLSAdaptiveFilter[];
  private numReferences: number;

  constructor(
    filterOrder: number = 32,
    lambda: number = 0.99,
    numReferences: number = 3
  ) {
    this.numReferences = numReferences;
    this.filters = [];
    for (let i = 0; i < numReferences; i++) {
      this.filters.push(new RLSAdaptiveFilter(filterOrder, lambda, 0.01));
    }
  }

  /**
   * Process with multiple reference inputs
   */
  process(
    primaryInput: number,
    referenceInputs: number[]
  ): {
    output: number;
    error: number;
  } {
    if (referenceInputs.length !== this.numReferences) {
      throw new Error(`Expected ${this.numReferences} reference inputs`);
    }

    let cumulativeError = primaryInput;

    for (let i = 0; i < this.numReferences; i++) {
      const result = this.filters[i].process(cumulativeError, referenceInputs[i]);
      cumulativeError = result.error;
    }

    return {
      output: cumulativeError,
      error: cumulativeError
    };
  }

  /**
   * Process batch with multiple references
   */
  processBatch(
    primaryInput: Float64Array,
    referenceInputs: Float64Array[]
  ): {
    output: Float64Array;
  } {
    const length = primaryInput.length;
    const output = new Float64Array(length);

    for (let i = 0; i < length; i++) {
      const refs = referenceInputs.map(ref => ref[i]);
      const result = this.process(primaryInput[i], refs);
      output[i] = result.output;
    }

    return { output };
  }

  /**
   * Reset all filters
   */
  reset(): void {
    for (const filter of this.filters) {
      filter.reset();
    }
  }

  /**
   * Get individual filter metrics
   */
  getFilterMetrics(index: number) {
    if (index < 0 || index >= this.filters.length) {
      throw new Error('Invalid filter index');
    }
    return this.filters[index].getConvergenceMetrics();
  }
}
