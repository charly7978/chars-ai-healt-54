/**
 * LMS (Least Mean Squares) Adaptive Filter for PPG Motion Artifact Removal
 * 
 * Based on: Widrow & Hoff (1960) adaptive filtering theory
 * Application to PPG: Uses accelerometer/motion reference to cancel motion artifacts
 * 
 * Algorithm:
 * w(n+1) = w(n) + 2*μ*e(n)*x(n)
 * 
 * Where:
 * - w: filter weights (adaptive)
 * - μ: step size (learning rate), controls convergence vs stability
 * - e(n): error signal (desired - output)
 * - x(n): reference input (motion/noise reference)
 * 
 * Normalized LMS (NLMS) variant adapts μ based on input power:
 * μ(n) = μ0 / (ε + ||x(n)||²)
 * 
 * Advantages:
 * - Real-time adaptation to changing motion patterns
 * - Low computational complexity (O(N) per sample)
 * - No prior knowledge of motion characteristics needed
 * 
 * Limitations:
 * - Assumes linear relationship between motion reference and artifact
 * - Requires accurate motion reference (accelerometer)
 * - Performance degrades with non-linear artifacts
 * 
 * For PPG without accelerometer: Can use secondary PPG wavelength or
 * principal component of motion-correlated signal as pseudo-reference.
 */

export class LMSAdaptiveFilter {
  // Filter weights
  private weights: Float64Array;
  private filterOrder: number;

  // Step size (learning rate)
  private mu: number;
  private mu0: number;  // Initial step size for NLMS

  // Normalization parameter for NLMS
  private epsilon: number = 0.001;

  // State variables
  private inputBuffer: Float64Array;
  private bufferIndex: number = 0;

  // Statistics
  private outputHistory: Float64Array;
  private errorHistory: Float64Array;
  private historySize: number = 100;

  // NLMS flag
  private useNLMS: boolean;

  constructor(
    filterOrder: number = 32,
    mu: number = 0.01,
    useNLMS: boolean = true
  ) {
    this.filterOrder = filterOrder;
    this.weights = new Float64Array(filterOrder);
    this.mu = mu;
    this.mu0 = mu;
    this.useNLMS = useNLMS;

    this.inputBuffer = new Float64Array(filterOrder);
    this.outputHistory = new Float64Array(this.historySize);
    this.errorHistory = new Float64Array(this.historySize);
  }

  /**
   * Process a new sample with adaptive filtering
   * 
   * @param primaryInput - The corrupted PPG signal (desired signal + noise)
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

    // Compute filter output: y(n) = w^T * x(n)
    let output = 0;
    for (let i = 0; i < this.filterOrder; i++) {
      const idx = (this.bufferIndex - i - 1 + this.filterOrder) % this.filterOrder;
      output += this.weights[i] * this.inputBuffer[idx];
    }

    // Compute error: e(n) = d(n) - y(n)
    // In PPG context: error = corrupted signal - estimated artifact
    // The error is our estimate of the clean PPG signal
    const error = primaryInput - output;

    // Adapt weights: w(n+1) = w(n) + 2*μ*e(n)*x(n)
    let adaptiveMu = this.mu;

    if (this.useNLMS) {
      // Normalized LMS: adapt μ based on input power
      let inputPower = 0;
      for (let i = 0; i < this.filterOrder; i++) {
        const idx = (this.bufferIndex - i - 1 + this.filterOrder) % this.filterOrder;
        inputPower += this.inputBuffer[idx] * this.inputBuffer[idx];
      }
      adaptiveMu = this.mu0 / (this.epsilon + inputPower);
    }

    // Weight update
    for (let i = 0; i < this.filterOrder; i++) {
      const idx = (this.bufferIndex - i - 1 + this.filterOrder) % this.filterOrder;
      this.weights[i] += 2 * adaptiveMu * error * this.inputBuffer[idx];

      // Weight clipping to prevent instability
      this.weights[i] = Math.max(-10, Math.min(10, this.weights[i]));
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
   * Update output and error history buffers
   */
  private updateHistory(output: number, error: number): void {
    // Shift arrays
    for (let i = 0; i < this.historySize - 1; i++) {
      this.outputHistory[i] = this.outputHistory[i + 1];
      this.errorHistory[i] = this.errorHistory[i + 1];
    }
    this.outputHistory[this.historySize - 1] = output;
    this.errorHistory[this.historySize - 1] = error;
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
   * Reset filter state
   */
  reset(): void {
    this.weights.fill(0);
    this.inputBuffer.fill(0);
    this.bufferIndex = 0;
    this.outputHistory.fill(0);
    this.errorHistory.fill(0);
  }

  /**
   * Set step size (learning rate)
   */
  setStepSize(mu: number): void {
    this.mu = Math.max(0, Math.min(1, mu));
    this.mu0 = this.mu;
  }

  /**
   * Get current step size
   */
  getStepSize(): number {
    return this.mu;
  }

  /**
   * Get filter convergence metrics
   */
  getConvergenceMetrics(): {
    converged: boolean;
    steadyStateError: number;
    weightStability: number;
  } {
    // Compute steady-state error (average of recent errors)
    let errorSum = 0;
    let errorCount = 0;
    for (let i = Math.max(0, this.historySize - 20); i < this.historySize; i++) {
      errorSum += Math.abs(this.errorHistory[i]);
      errorCount++;
    }
    const steadyStateError = errorCount > 0 ? errorSum / errorCount : 0;

    // Compute weight stability (variance of weight changes)
    let weightVar = 0;
    for (let i = 0; i < this.filterOrder; i++) {
      weightVar += this.weights[i] * this.weights[i];
    }
    const weightStability = Math.sqrt(weightVar / this.filterOrder);

    // Convergence heuristic
    const converged = steadyStateError < 0.1 && weightStability < 1.0;

    return {
      converged,
      steadyStateError,
      weightStability
    };
  }

  /**
   * Auto-tune step size based on convergence metrics
   */
  autoTuneStepSize(): void {
    const metrics = this.getConvergenceMetrics();

    if (!metrics.converged) {
      // Not converged - increase step size for faster convergence
      this.mu = Math.min(0.5, this.mu * 1.05);
    } else if (metrics.steadyStateError > 0.05) {
      // Converged but high error - moderate step size
      this.mu = Math.max(0.01, this.mu * 0.95);
    } else {
      // Well converged - reduce step size for stability
      this.mu = Math.max(0.001, this.mu * 0.9);
    }
  }

  /**
   * Get filter weights
   */
  getWeights(): Float64Array {
    return this.weights.slice();
  }

  /**
   * Set filter weights (useful for initialization)
   */
  setWeights(weights: Float64Array): void {
    if (weights.length === this.filterOrder) {
      this.weights.set(weights);
    }
  }
}

/**
 * Multi-reference LMS for triaxial accelerometer
 * Combines three LMS filters (X, Y, Z axes) for improved motion cancellation
 */
export class MultiReferenceLMS {
  private filters: LMSAdaptiveFilter[];
  private numReferences: number;

  constructor(
    filterOrder: number = 32,
    mu: number = 0.01,
    numReferences: number = 3
  ) {
    this.numReferences = numReferences;
    this.filters = [];
    for (let i = 0; i < numReferences; i++) {
      this.filters.push(new LMSAdaptiveFilter(filterOrder, mu, true));
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

    // Process each reference sequentially
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

/**
 * Pseudo-reference LMS for PPG without accelerometer
 * Uses motion-correlated signal component as reference
 */
export class PseudoReferenceLMS extends LMSAdaptiveFilter {
  /**
   * Generate pseudo-reference from PPG signal using bandpass filtering
   * Motion artifacts typically appear in specific frequency bands
   */
  static generatePseudoReference(ppgSignal: Float64Array, samplingRate: number = 30): Float64Array {
    // Simple high-pass to isolate motion component (> 4 Hz)
    const reference = new Float64Array(ppgSignal.length);
    
    // First-order high-pass filter (cutoff ~4 Hz)
    const alpha = 0.9;
    let prev = ppgSignal[0];
    reference[0] = 0;

    for (let i = 1; i < ppgSignal.length; i++) {
      const filtered = alpha * prev + (1 - alpha) * ppgSignal[i];
      reference[i] = ppgSignal[i] - filtered;
      prev = filtered;
    }

    return reference;
  }

  /**
   * Process PPG signal with pseudo-reference
   */
  processWithPseudoReference(ppgSignal: Float64Array): Float64Array {
    const reference = PseudoReferenceLMS.generatePseudoReference(ppgSignal);
    const result = this.processBatch(ppgSignal, reference);
    return result.output;
  }
}
