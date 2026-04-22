/**
 * ICA (Independent Component Analysis) for PPG Signal Separation
 * 
 * Based on: FastICA algorithm for blind source separation
 * 
 * ICA separates mixed signals into statistically independent components
 * without requiring prior knowledge of the mixing process.
 * 
 * For PPG:
 * - Input: Multiple color channels (R, G, B) or multiple sources
 * - Output: Independent components (cardiac, motion, respiration)
 * - Advantage: No motion reference needed (blind separation)
 * 
 * Algorithm (FastICA):
 * 1. Center and whiten data
 * 2. Initialize weight vector
 * 3. Iterate: w = E[x * g(w^T * x)] - E[g'(w^T * x)] * w
 * 4. Decorrelate weights
 * 5. Normalize weights
 * 
 * Where g is non-linear function (typically tanh or Gaussian)
 */

export class ICAProcessor {
  private numComponents: number;
  private numSamples: number;
  private maxIterations: number;
  private tolerance: number;
  private nonLinearity: 'tanh' | 'gaussian' | 'cube';

  constructor(
    numComponents: number = 3,
    maxIterations: number = 100,
    tolerance: number = 1e-6,
    nonLinearity: 'tanh' | 'gaussian' | 'cube' = 'tanh'
  ) {
    this.numComponents = numComponents;
    this.maxIterations = maxIterations;
    this.tolerance = tolerance;
    this.nonLinearity = nonLinearity;
    this.numSamples = 0;
  }

  /**
   * Perform FastICA on input signals
   * 
   * @param signals - Matrix of input signals (each row is a signal)
   * @returns Separated independent components
   */
  process(signals: Float64Array[]): {
    components: Array<Float64Array>;
    mixingMatrix: Float64Array;
    convergenceIterations: number;
  } {
    if (signals.length === 0) {
      return {
        components: [],
        mixingMatrix: new Float64Array(0),
        convergenceIterations: 0
      };
    }

    this.numSamples = signals[0].length;
    const numSignals = signals.length;

    // Ensure all signals have same length
    for (const signal of signals) {
      if (signal.length !== this.numSamples) {
        throw new Error('All signals must have the same length');
      }
    }

    // Step 1: Center the data (subtract mean)
    const centered = this.centerSignals(signals);

    // Step 2: Whiten the data (PCA + whitening)
    const { whitened, whiteningMatrix } = this.whitenData(centered as Array<Float64Array>);

    // Step 3: FastICA iteration
    const { components, mixingMatrix, iterations } = this.fastICA(whitened);

    return {
      components,
      mixingMatrix,
      convergenceIterations: iterations
    };
  }

  /**
   * Center signals by subtracting mean
   */
  private centerSignals(signals: Float64Array[]): Array<Float64Array> {
    const centered: Float64Array[] = [];

    for (const signal of signals) {
      let sum = 0;
      for (let i = 0; i < signal.length; i++) {
        sum += signal[i];
      }
      const mean = sum / signal.length;

      const centeredSignal = new Float64Array(signal.length);
      for (let i = 0; i < signal.length; i++) {
        centeredSignal[i] = signal[i] - mean;
      }
      centered.push(centeredSignal);
    }

    return centered;
  }

  /**
   * Whiten data using PCA
   */
  private whitenData(signals: Array<Float64Array>): {
    whitened: Array<Float64Array>;
    whiteningMatrix: Float64Array;
  } {
    const numSignals = signals.length;
    const numSamples = this.numSamples;

    // Compute covariance matrix
    const covMatrix = this.computeCovariance(signals as Float64Array[]);

    // Eigenvalue decomposition (simplified - use power iteration)
    const { eigenvalues, eigenvectors } = this.eigenDecomposition(covMatrix);

    // Whitening matrix: D^(-1/2) * E^T
    const whiteningMatrix = new Float64Array(numSignals * numSignals);
    for (let i = 0; i < numSignals; i++) {
      for (let j = 0; j < numSignals; j++) {
        const idx = i * numSignals + j;
        whiteningMatrix[idx] = eigenvectors[j * numSignals + i] / Math.sqrt(eigenvalues[i] + 1e-10);
      }
    }

    // Apply whitening
    const whitened: Float64Array[] = [];
    for (let s = 0; s < numSignals; s++) {
      const whitenedSignal = new Float64Array(numSamples);
      for (let t = 0; t < numSamples; t++) {
        let sum = 0;
        for (let i = 0; i < numSignals; i++) {
          sum += whiteningMatrix[i * numSignals + s] * signals[i][t];
        }
        whitenedSignal[t] = sum;
      }
      whitened.push(whitenedSignal);
    }

    return { whitened, whiteningMatrix };
  }

  /**
   * Compute covariance matrix
   */
  private computeCovariance(signals: Float64Array[]): Float64Array {
    const numSignals = signals.length;
    const covMatrix = new Float64Array(numSignals * numSignals);

    for (let i = 0; i < numSignals; i++) {
      for (let j = 0; j < numSignals; j++) {
        let sum = 0;
        for (let t = 0; t < this.numSamples; t++) {
          sum += signals[i][t] * signals[j][t];
        }
        covMatrix[i * numSignals + j] = sum / this.numSamples;
      }
    }

    return covMatrix;
  }

  /**
   * Simplified eigenvalue decomposition using power iteration
   * (Full SVD would be more accurate but this is sufficient for ICA)
   */
  private eigenDecomposition(matrix: Float64Array): {
    eigenvalues: Float64Array;
    eigenvectors: Float64Array;
  } {
    const n = Math.sqrt(matrix.length);
    const eigenvalues = new Float64Array(n);
    const eigenvectors = new Float64Array(n * n);

    // Power iteration for each eigenvalue
    for (let k = 0; k < n; k++) {
      let v = new Float64Array(n);
      v[k] = 1;  // Initial guess

      for (let iter = 0; iter < 50; iter++) {
        // Matrix multiplication: Av
        const Av = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            Av[i] += matrix[i * n + j] * v[j];
          }
        }

        // Normalize
        let norm = 0;
        for (let i = 0; i < n; i++) {
          norm += Av[i] * Av[i];
        }
        norm = Math.sqrt(norm);

        if (norm < 1e-10) break;

        for (let i = 0; i < n; i++) {
          v[i] = Av[i] / norm;
        }
      }

      // Compute eigenvalue
      let lambda = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          lambda += v[i] * matrix[i * n + j] * v[j];
        }
      }

      eigenvalues[k] = lambda;

      // Store eigenvector
      for (let i = 0; i < n; i++) {
        eigenvectors[i * n + k] = v[i];
      }

      // Deflate matrix (remove this component)
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          matrix[i * n + j] -= lambda * v[i] * v[j];
        }
      }
    }

    return { eigenvalues, eigenvectors };
  }

  /**
   * FastICA algorithm
   */
  private fastICA(whitened: Array<Float64Array>): {
    components: Array<Float64Array>;
    mixingMatrix: Float64Array;
    iterations: number;
  } {
    const numSignals = whitened.length;
    const numSamples = this.numSamples;
    const numComponents = Math.min(this.numComponents, numSignals);

    // Initialize weight vectors randomly
    const W: Array<Float64Array> = [];
    for (let i = 0; i < numComponents; i++) {
      const w = new Float64Array(numSignals);
      for (let j = 0; j < numSignals; j++) {
        w[j] = Math.random() - 0.5;
      }
      // Normalize
      this.normalize(w);
      W.push(w);
    }

    let totalIterations = 0;

    // Iterate for each component
    for (let p = 0; p < numComponents; p++) {
      let w = W[p];
      let converged = false;
      let iter = 0;

      while (!converged && iter < this.maxIterations) {
        const wOld = w.slice();

        // Compute: w = E[x * g(w^T * x)] - E[g'(w^T * x)] * w
        const gwx = new Float64Array(numSamples);
        const gPrimeWx = new Float64Array(numSamples);

        for (let t = 0; t < numSamples; t++) {
          // Compute w^T * x
          let wx = 0;
          for (let i = 0; i < numSignals; i++) {
            wx += w[i] * whitened[i][t];
          }

          // Apply non-linearity
          const { g, gPrime } = this.applyNonLinearity(wx);
          gwx[t] = g;
          gPrimeWx[t] = gPrime;
        }

        // Update w
        const E_gwx_x = new Float64Array(numSignals);
        const E_gPrimeWx = this.mean(gPrimeWx);

        for (let i = 0; i < numSignals; i++) {
          let sum = 0;
          for (let t = 0; t < numSamples; t++) {
            sum += whitened[i][t] * gwx[t];
          }
          E_gwx_x[i] = sum / numSamples;
          w[i] = E_gwx_x[i] - E_gPrimeWx * w[i];
        }

        // Decorrelate with previous components
        for (let j = 0; j < p; j++) {
          const wj = W[j];
          let dot = 0;
          for (let i = 0; i < numSignals; i++) {
            dot += w[i] * wj[i];
          }
          for (let i = 0; i < numSignals; i++) {
            w[i] -= dot * wj[i];
          }
        }

        // Normalize
        this.normalize(w);

        // Check convergence
        let diff = 0;
        for (let i = 0; i < numSignals; i++) {
          diff += Math.abs(w[i] - wOld[i]);
        }

        if (diff < this.tolerance) {
          converged = true;
        }

        iter++;
        totalIterations++;
      }

      W[p] = w;
    }

    // Compute independent components: S = W^T * X
    const components: Float64Array[] = [];
    for (let p = 0; p < numComponents; p++) {
      const component = new Float64Array(numSamples);
      for (let t = 0; t < numSamples; t++) {
        let sum = 0;
        for (let i = 0; i < numSignals; i++) {
          sum += W[p][i] * whitened[i][t];
        }
        component[t] = sum;
      }
      components.push(component);
    }

    // Mixing matrix is inverse of W (approximately W^T for whitened data)
    const mixingMatrix = new Float64Array(numComponents * numSignals);
    for (let i = 0; i < numComponents; i++) {
      for (let j = 0; j < numSignals; j++) {
        mixingMatrix[i * numSignals + j] = W[i][j];
      }
    }

    return {
      components,
      mixingMatrix,
      iterations: totalIterations
    };
  }

  /**
   * Apply non-linearity function and its derivative
   */
  private applyNonLinearity(x: number): { g: number; gPrime: number } {
    switch (this.nonLinearity) {
      case 'tanh':
        return {
          g: Math.tanh(x),
          gPrime: 1 - Math.tanh(x) * Math.tanh(x)
        };
      case 'gaussian':
        return {
          g: x * Math.exp(-x * x / 2),
          gPrime: (1 - x * x) * Math.exp(-x * x / 2)
        };
      case 'cube':
        return {
          g: x * x * x,
          gPrime: 3 * x * x
        };
      default:
        return {
          g: Math.tanh(x),
          gPrime: 1 - Math.tanh(x) * Math.tanh(x)
        };
    }
  }

  /**
   * Normalize vector
   */
  private normalize(v: Float64Array): void {
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 1e-10) {
      for (let i = 0; i < v.length; i++) {
        v[i] /= norm;
      }
    }
  }

  /**
   * Compute mean of array
   */
  private mean(arr: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
    }
    return sum / arr.length;
  }

  /**
   * Identify cardiac component from separated components
   * Cardiac component typically has frequency in 0.7-4 Hz range
   */
  identifyCardiacComponent(
    components: Array<Float64Array>,
    sampleRate: number = 30
  ): {
    cardiacComponent: Float64Array;
    cardiacIndex: number;
    frequencies: number[];
  } {
    const frequencies: number[] = [];

    for (const component of components) {
      const freq = this.estimateDominantFrequency(component, sampleRate);
      frequencies.push(freq);
    }

    // Find component with frequency in cardiac range (0.7-4 Hz)
    let cardiacIndex = 0;
    let bestScore = 0;

    for (let i = 0; i < frequencies.length; i++) {
      const freq = frequencies[i];
      if (freq >= 0.7 && freq <= 4.0) {
        // Score based on closeness to 1.2 Hz (72 BPM)
        const score = 1 - Math.abs(freq - 1.2) / 3.3;
        if (score > bestScore) {
          bestScore = score;
          cardiacIndex = i;
        }
      }
    }

    return {
      cardiacComponent: components[cardiacIndex],
      cardiacIndex,
      frequencies
    };
  }

  /**
   * Estimate dominant frequency using autocorrelation
   */
  private estimateDominantFrequency(signal: Float64Array, sampleRate: number): number {
    const n = signal.length;
    const autocorr = new Float64Array(n);

    // Compute autocorrelation
    for (let lag = 0; lag < n; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) {
        sum += signal[i] * signal[i + lag];
      }
      autocorr[lag] = sum / (n - lag);
    }

    // Find first peak after lag 0
    let peakLag = 1;
    let peakValue = autocorr[1];

    for (let lag = 8; lag < Math.min(60, n); lag++) {
      if (autocorr[lag] > peakValue) {
        peakValue = autocorr[lag];
        peakLag = lag;
      }
    }

    return sampleRate / peakLag;
  }

  /**
   * Reset processor state
   */
  reset(): void {
    this.numSamples = 0;
  }
}
