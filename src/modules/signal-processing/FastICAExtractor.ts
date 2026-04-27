/**
 * FAST ICA EXTRACTOR — Independent Component Analysis for PPG Signal Separation
 * 
 * Implements FastICA algorithm to separate independent sources from RGB mixture:
 * - Separates cardiac pulse from motion artifacts, ambient light changes, thermal drift
 * - Uses kurtosis maximization (fourth-order cumulant) for non-Gaussianity
 * - Symmetric decorrelation for unbiased source extraction
 * - Multiple parallel iterations for robust convergence
 * 
 * Mathematical foundation:
 * - Hyvärinen & Oja (2000): Independent Component Analysis
 * - Comon (1994): Independent component analysis, a new concept?
 * 
 * Phase 5: Advanced signal extraction for maximum PPG purity
 */

export interface ICASignal {
  /** Independent component signal */
  signal: Float64Array;
  /** Kurtosis of the component (higher = more non-Gaussian = more likely physiological) */
  kurtosis: number;
  /** Negentropy approximation (0-1, higher = more structured) */
  negentropy: number;
  /** Estimated source type based on spectral analysis */
  sourceType: 'cardiac' | 'motion' | 'thermal' | 'ambient' | 'mixed';
  /** Confidence score 0-1 */
  confidence: number;
  /** Mixing weight in original RGB */
  mixingWeights: { r: number; g: number; b: number };
}

export interface FastICAConfig {
  /** Number of components to extract (max 3 for RGB) */
  nComponents: number;
  /** Maximum iterations for convergence */
  maxIterations: number;
  /** Convergence tolerance */
  tolerance: number;
  /** Non-linearity: 'pow3' (kurtosis) or 'tanh' (robust) */
  nonlinearity: 'pow3' | 'tanh';
  /** Enable symmetric decorrelation (slower but more accurate) */
  symmetric: boolean;
}

export class FastICAExtractor {
  private config: FastICAConfig;
  private whiteningMatrix: number[][] | null = null;
  private dewhiteningMatrix: number[][] | null = null;
  private mixingMatrix: number[][] | null = null;
  private unmixingMatrix: number[][] | null = null;

  constructor(config: Partial<FastICAConfig> = {}) {
    this.config = {
      nComponents: 3,
      maxIterations: 200,
      tolerance: 1e-4,
      nonlinearity: 'pow3',
      symmetric: true,
      ...config
    };
  }

  /**
   * Extract independent components from RGB PPG signals
   * 
   * @param rSignal Red channel signal
   * @param gSignal Green channel signal  
   * @param bSignal Blue channel signal
   * @returns Array of independent components sorted by cardiac likelihood
   */
  public extractComponents(
    rSignal: Float64Array,
    gSignal: Float64Array,
    bSignal: Float64Array
  ): ICASignal[] {
    const n = rSignal.length;
    
    // Center the data (remove mean)
    const { centered, means } = this.centerData([rSignal, gSignal, bSignal]);
    
    // Whiten the data (decorrelate + unit variance)
    const { whitened, whiteningMatrix, dewhiteningMatrix } = this.whitenData(centered);
    this.whiteningMatrix = whiteningMatrix;
    this.dewhiteningMatrix = dewhiteningMatrix;
    
    // Run FastICA algorithm
    const unmixingMatrix = this.fastICACore(whitened);
    this.unmixingMatrix = unmixingMatrix;
    
    // Compute mixing matrix (W^-1 for transformation back)
    this.mixingMatrix = this.invertMatrix(unmixingMatrix);
    
    // Extract components
    const components: ICASignal[] = [];
    for (let i = 0; i < this.config.nComponents; i++) {
      const component = this.extractComponent(whitened, unmixingMatrix[i]);
      const kurt = this.calculateKurtosis(component);
      const negent = this.estimateNegentropy(component);
      const sourceType = this.classifySource(component, kurt);
      
      components.push({
        signal: component,
        kurtosis: kurt,
        negentropy: negent,
        sourceType,
        confidence: this.calculateConfidence(kurt, negent, sourceType),
        mixingWeights: {
          r: this.mixingMatrix[0][i],
          g: this.mixingMatrix[1][i],
          b: this.mixingMatrix[2][i]
        }
      });
    }
    
    // Sort by cardiac likelihood (kurtosis + spectral cardiac power)
    return this.sortByCardiacLikelihood(components);
  }

  /**
   * Center data by subtracting mean from each channel
   */
  private centerData(data: Float64Array[]): { centered: Float64Array[]; means: number[] } {
    const centered: Float64Array[] = [];
    const means: number[] = [];
    
    for (const channel of data) {
      const mean = channel.reduce((a, b) => a + b, 0) / channel.length;
      means.push(mean);
      
      const centeredChannel = new Float64Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        centeredChannel[i] = channel[i] - mean;
      }
      centered.push(centeredChannel);
    }
    
    return { centered, means };
  }

  /**
   * Whiten data: decorrelate channels and normalize variance
   * Uses eigenvalue decomposition of covariance matrix
   */
  private whitenData(data: Float64Array[]): {
    whitened: Float64Array[];
    whiteningMatrix: number[][];
    dewhiteningMatrix: number[][];
  } {
    const nChannels = data.length;
    const nSamples = data[0].length;
    
    // Compute covariance matrix
    const cov = this.computeCovarianceMatrix(data);
    
    // Eigendecomposition (simplified power iteration for 3x3)
    const { eigenvalues, eigenvectors } = this.eigendecompose3x3(cov);
    
    // Whitening matrix: W = E * D^(-1/2) * E^T
    const whiteningMatrix: number[][] = [];
    const dewhiteningMatrix: number[][] = [];
    
    for (let i = 0; i < nChannels; i++) {
      whiteningMatrix[i] = [];
      dewhiteningMatrix[i] = [];
      for (let j = 0; j < nChannels; j++) {
        let wSum = 0;
        let dSum = 0;
        for (let k = 0; k < nChannels; k++) {
          const invSqrtLambda = 1 / Math.sqrt(Math.max(1e-10, eigenvalues[k]));
          wSum += eigenvectors[i][k] * invSqrtLambda * eigenvectors[j][k];
          dSum += eigenvectors[i][k] * Math.sqrt(eigenvalues[k]) * eigenvectors[j][k];
        }
        whiteningMatrix[i][j] = wSum;
        dewhiteningMatrix[i][j] = dSum;
      }
    }
    
    // Apply whitening
    const whitened: Float64Array[] = [];
    for (let i = 0; i < nChannels; i++) {
      whitened[i] = new Float64Array(nSamples);
      for (let t = 0; t < nSamples; t++) {
        let sum = 0;
        for (let j = 0; j < nChannels; j++) {
          sum += whiteningMatrix[i][j] * data[j][t];
        }
        whitened[i][t] = sum;
      }
    }
    
    return { whitened, whiteningMatrix, dewhiteningMatrix };
  }

  /**
   * Core FastICA algorithm using fixed-point iteration
   */
  private fastICACore(whitened: Float64Array[][]): number[][] {
    const nChannels = whitened.length;
    const nSamples = whitened[0].length;
    const nComp = Math.min(this.config.nComponents, nChannels);
    
    // Initialize unmixing matrix randomly
    let W = this.initializeRandom(nComp, nChannels);
    
    // Orthogonalize initial matrix
    W = this.orthogonalize(W);
    
    // Fixed-point iterations
    for (let iter = 0; iter < this.config.maxIterations; iter++) {
      const Wold = W.map(row => [...row]);
      
      if (this.config.symmetric) {
        // Symmetric decorrelation (all components in parallel)
        W = this.symmetricIteration(whitened, W);
      } else {
        // Deflationary decorrelation (one component at a time)
        W = this.deflationaryIteration(whitened, W);
      }
      
      // Check convergence
      const convergence = this.checkConvergence(W, Wold);
      if (convergence < this.config.tolerance) {
        break;
      }
    }
    
    return W;
  }

  /**
   * Symmetric iteration (all components updated in parallel)
   */
  private symmetricIteration(whitened: Float64Array[], W: number[][]): number[][] {
    const nComp = W.length;
    const nSamples = whitened[0].length;
    const newW: number[][] = [];
    
    // Compute y = W * z for all samples
    for (let i = 0; i < nComp; i++) {
      newW[i] = [];
      
      // Calculate g(y) and g'(y) expectations
      const gVec = new Float64Array(nSamples);
      const gpVec = new Float64Array(nSamples);
      
      for (let t = 0; t < nSamples; t++) {
        let y = 0;
        for (let j = 0; j < whitened.length; j++) {
          y += W[i][j] * whitened[j][t];
        }
        
        if (this.config.nonlinearity === 'pow3') {
          gVec[t] = y * y * y; // g(y) = y^3
          gpVec[t] = 3 * y * y; // g'(y) = 3y^2
        } else {
          // tanh nonlinearity (more robust)
          const tanhY = Math.tanh(y);
          gVec[t] = tanhY;
          gpVec[t] = 1 - tanhY * tanhY;
        }
      }
      
      // Update rule: w_new = E[z * g(w^T * z)] - E[g'(w^T * z)] * w
      for (let j = 0; j < whitened.length; j++) {
        let zgSum = 0;
        for (let t = 0; t < nSamples; t++) {
          zgSum += whitened[j][t] * gVec[t];
        }
        const E_zg = zgSum / nSamples;
        
        const E_gp = gpVec.reduce((a, b) => a + b, 0) / nSamples;
        
        newW[i][j] = E_zg - E_gp * W[i][j];
      }
    }
    
    // Symmetric orthogonalization: W * (W^T * W)^(-1/2)
    return this.orthogonalize(newW);
  }

  /**
   * Deflationary iteration (components extracted sequentially)
   */
  private deflationaryIteration(whitened: Float64Array[], W: number[][]): number[][] {
    const nSamples = whitened[0].length;
    const newW: number[][] = [];
    
    for (let i = 0; i < W.length; i++) {
      let w = [...W[i]];
      
      // Gram-Schmidt orthogonalization against previous components
      for (let j = 0; j < i; j++) {
        const proj = this.dotProduct(w, newW[j]);
        for (let k = 0; k < w.length; k++) {
          w[k] -= proj * newW[j][k];
        }
      }
      
      // Normalize
      w = this.normalizeVector(w);
      
      // Fixed-point iteration for this component
      const gVec = new Float64Array(nSamples);
      const gpVec = new Float64Array(nSamples);
      
      for (let t = 0; t < nSamples; t++) {
        let y = 0;
        for (let j = 0; j < whitened.length; j++) {
          y += w[j] * whitened[j][t];
        }
        
        if (this.config.nonlinearity === 'pow3') {
          gVec[t] = y * y * y;
          gpVec[t] = 3 * y * y;
        } else {
          const tanhY = Math.tanh(y);
          gVec[t] = tanhY;
          gpVec[t] = 1 - tanhY * tanhY;
        }
      }
      
      // Update
      for (let j = 0; j < whitened.length; j++) {
        let zgSum = 0;
        for (let t = 0; t < nSamples; t++) {
          zgSum += whitened[j][t] * gVec[t];
        }
        const E_zg = zgSum / nSamples;
        const E_gp = gpVec.reduce((a, b) => a + b, 0) / nSamples;
        
        w[j] = E_zg - E_gp * w[j];
      }
      
      // Renormalize
      w = this.normalizeVector(w);
      newW[i] = w;
    }
    
    return newW;
  }

  /**
   * Orthogonalize matrix using symmetric decorrelation
   */
  private orthogonalize(W: number[][]): number[][] {
    // Simplified orthogonalization for small matrices
    // W_new = W * (W^T * W)^(-1/2)
    
    const n = W.length;
    const WtW = this.matrixMultiply(this.transpose(W), W);
    const invSqrt = this.matrixInvSqrtSymmetric(WtW);
    return this.matrixMultiply(W, invSqrt);
  }

  /**
   * Extract single component using unmixing weights
   */
  private extractComponent(whitened: Float64Array[], weights: number[]): Float64Array {
    const nSamples = whitened[0].length;
    const component = new Float64Array(nSamples);
    
    for (let t = 0; t < nSamples; t++) {
      let sum = 0;
      for (let i = 0; i < whitened.length; i++) {
        sum += weights[i] * whitened[i][t];
      }
      component[t] = sum;
    }
    
    return component;
  }

  /**
   * Calculate excess kurtosis (measure of non-Gaussianity)
   * Higher kurtosis = more "peaked" distribution = more likely physiological pulse
   */
  private calculateKurtosis(signal: Float64Array): number {
    const n = signal.length;
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    
    let variance = 0;
    let fourthMoment = 0;
    
    for (let i = 0; i < n; i++) {
      const diff = signal[i] - mean;
      const diff2 = diff * diff;
      variance += diff2;
      fourthMoment += diff2 * diff2;
    }
    
    variance /= n;
    fourthMoment /= n;
    
    // Excess kurtosis (Fisher definition): γ2 = μ4/σ4 - 3
    return variance > 1e-10 ? (fourthMoment / (variance * variance)) - 3 : 0;
  }

  /**
   * Estimate negentropy using approximation
   * Higher negentropy = more structured/organized signal
   */
  private estimateNegentropy(signal: Float64Array): number {
    // Negentropy approximation using kurtosis
    // J(y) ≈ (1/12) * E[y^3]^2 + (1/48) * kurtosis(y)^2
    const kurt = this.calculateKurtosis(signal);
    return (1/48) * kurt * kurt;
  }

  /**
   * Classify source type based on spectral characteristics
   */
  private classifySource(signal: Float64Array, kurtosis: number): ICASignal['sourceType'] {
    // Quick spectral analysis (simplified)
    const n = signal.length;
    const sampleRate = 30; // Assuming 30fps
    
    // Estimate dominant frequency using zero crossings
    let zeroCrossings = 0;
    for (let i = 1; i < n; i++) {
      if ((signal[i-1] > 0) !== (signal[i] > 0)) {
        zeroCrossings++;
      }
    }
    
    // Approximate frequency
    const duration = n / sampleRate;
    const freq = zeroCrossings / (2 * duration);
    const bpm = freq * 60;
    
    // Classification rules
    if (bpm >= 40 && bpm <= 200 && kurtosis > 0.5) {
      return 'cardiac';
    } else if (bpm < 5) {
      return 'thermal';
    } else if (bpm > 200) {
      return 'motion';
    } else if (kurtosis < -1) {
      return 'ambient';
    }
    
    return 'mixed';
  }

  /**
   * Calculate confidence score based on kurtosis, negentropy and source type
   */
  private calculateConfidence(
    kurtosis: number,
    negentropy: number,
    sourceType: ICASignal['sourceType']
  ): number {
    let confidence = 0;
    
    // Kurtosis contribution (higher is better for cardiac)
    confidence += Math.min(1, Math.abs(kurtosis) / 3) * 0.4;
    
    // Negentropy contribution
    confidence += Math.min(1, negentropy * 10) * 0.3;
    
    // Source type bonus
    if (sourceType === 'cardiac') confidence += 0.3;
    else if (sourceType === 'motion') confidence -= 0.2;
    else if (sourceType === 'thermal') confidence -= 0.1;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Sort components by likelihood of being the true cardiac signal
   */
  private sortByCardiacLikelihood(components: ICASignal[]): ICASignal[] {
    return components.sort((a, b) => {
      // Scoring function favoring cardiac characteristics
      const scoreA = this.cardiacScore(a);
      const scoreB = this.cardiacScore(b);
      return scoreB - scoreA;
    });
  }

  private cardiacScore(comp: ICASignal): number {
    let score = comp.confidence;
    if (comp.sourceType === 'cardiac') score += 0.5;
    score += Math.min(0.3, comp.kurtosis / 5);
    score += comp.negentropy * 0.2;
    return score;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MATRIX OPERATIONS (simplified for 3x3)
  // ═══════════════════════════════════════════════════════════════════

  private computeCovarianceMatrix(data: Float64Array[]): number[][] {
    const nChannels = data.length;
    const nSamples = data[0].length;
    const cov: number[][] = [];
    
    for (let i = 0; i < nChannels; i++) {
      cov[i] = [];
      for (let j = 0; j < nChannels; j++) {
        let sum = 0;
        for (let t = 0; t < nSamples; t++) {
          sum += data[i][t] * data[j][t];
        }
        cov[i][j] = sum / (nSamples - 1);
      }
    }
    
    return cov;
  }

  private eigendecompose3x3(matrix: number[][]): { eigenvalues: number[]; eigenvectors: number[][] } {
    // Simplified power iteration for 3x3 symmetric matrix
    const n = 3;
    const eigenvalues: number[] = [];
    const eigenvectors: number[][] = [];
    
    let A = matrix.map(row => [...row]);
    
    for (let eig = 0; eig < n; eig++) {
      // Power iteration
      let v = [1, 1, 1];
      v = this.normalizeVector(v);
      
      for (let iter = 0; iter < 50; iter++) {
        const Av = this.matrixVectorMultiply(A, v);
        v = this.normalizeVector(Av);
      }
      
      // Rayleigh quotient for eigenvalue
      const Av = this.matrixVectorMultiply(A, v);
      const lambda = this.dotProduct(v, Av);
      
      eigenvalues.push(lambda);
      eigenvectors.push([...v]);
      
      // Deflate for next eigenvalue
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          A[i][j] -= lambda * v[i] * v[j];
        }
      }
    }
    
    return { eigenvalues, eigenvectors };
  }

  private initializeRandom(rows: number, cols: number): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < rows; i++) {
      result[i] = [];
      for (let j = 0; j < cols; j++) {
        // Xavier initialization
        result[i][j] = (Math.random() - 0.5) * Math.sqrt(2 / cols);
      }
    }
    return result;
  }

  private checkConvergence(W: number[][], Wold: number[][]): number {
    let maxDiff = 0;
    for (let i = 0; i < W.length; i++) {
      for (let j = 0; j < W[i].length; j++) {
        const diff = Math.abs(W[i][j] - Wold[i][j]);
        maxDiff = Math.max(maxDiff, diff);
      }
    }
    return maxDiff;
  }

  private normalizeVector(v: number[]): number[] {
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    return norm > 1e-10 ? v.map(x => x / norm) : v;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, x, i) => sum + x * b[i], 0);
  }

  private transpose(matrix: number[][]): number[][] {
    return matrix[0].map((_, i) => matrix.map(row => row[i]));
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

  private matrixVectorMultiply(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, x, i) => sum + x * v[i], 0));
  }

  private matrixInvSqrtSymmetric(A: number[][]): number[][] {
    // Simplified for 3x3: use eigendecomposition
    const { eigenvalues, eigenvectors } = this.eigendecompose3x3(A);
    
    // Reconstruct with inverse square root of eigenvalues
    const n = A.length;
    const result: number[][] = [];
    
    for (let i = 0; i < n; i++) {
      result[i] = [];
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          const invSqrtLambda = 1 / Math.sqrt(Math.max(1e-10, eigenvalues[k]));
          sum += eigenvectors[i][k] * invSqrtLambda * eigenvectors[j][k];
        }
        result[i][j] = sum;
      }
    }
    
    return result;
  }

  private invertMatrix(A: number[][]): number[][] {
    // Simplified 3x3 matrix inversion
    const n = A.length;
    if (n !== 3) throw new Error('Only 3x3 supported');
    
    const det = this.determinant3x3(A);
    if (Math.abs(det) < 1e-10) throw new Error('Singular matrix');
    
    const invDet = 1 / det;
    const result: number[][] = [
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
    
    return result;
  }

  private determinant3x3(A: number[][]): number {
    return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
           A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
           A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  }
}

// Factory function
export function createFastICAExtractor(config?: Partial<FastICAConfig>): FastICAExtractor {
  return new FastICAExtractor(config);
}
