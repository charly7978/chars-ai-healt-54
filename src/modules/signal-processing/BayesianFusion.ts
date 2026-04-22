/**
 * Bayesian Multi-Source Fusion for PPG Signal Processing
 * 
 * Combines multiple signal sources (RGB, CHROM, POS, etc.) using Bayesian inference
 * to produce a robust estimate with quantified uncertainty.
 * 
 * Principles:
 * - Each source provides a measurement with associated uncertainty
 * - Prior knowledge about expected heart rate range
 * - Posterior distribution combines all evidence
 * - Adaptive weighting based on source reliability
 * 
 * Algorithm:
 * 1. Compute likelihood for each source measurement
 * 2. Combine with prior distribution
 * 3. Compute posterior distribution
 * 4. Extract MAP (Maximum A Posteriori) estimate
 * 5. Compute confidence from posterior variance
 */

export interface SourceMeasurement {
  value: number;  // Heart rate estimate
  uncertainty: number;  // Standard deviation
  reliability: number;  // 0-1 reliability score
}

export class BayesianFusion {
  // Prior distribution parameters (Gaussian)
  private priorMean: number;
  private priorStd: number;

  // Minimum and maximum plausible heart rates
  private minHR: number = 40;
  private maxHR: number = 200;

  constructor(
    priorMean: number = 72,
    priorStd: number = 15
  ) {
    this.priorMean = priorMean;
    this.priorStd = priorStd;
  }

  /**
   * Fuse multiple source measurements using Bayesian inference
   */
  fuse(measurements: SourceMeasurement[]): {
    fusedValue: number;
    confidence: number;
    weights: number[];
    posteriorMean: number;
    posteriorStd: number;
  } {
    if (measurements.length === 0) {
      return {
        fusedValue: this.priorMean,
        confidence: 0,
        weights: [],
        posteriorMean: this.priorMean,
        posteriorStd: this.priorStd
      };
    }

    // Filter out invalid measurements
    const validMeasurements = measurements.filter(m => 
      m.value >= this.minHR && m.value <= this.maxHR
    );

    if (validMeasurements.length === 0) {
      return {
        fusedValue: this.priorMean,
        confidence: 0,
        weights: measurements.map(() => 0),
        posteriorMean: this.priorMean,
        posteriorStd: this.priorStd
      };
    }

    // Compute posterior using conjugate prior (Gaussian)
    const posterior = this.computePosterior(validMeasurements);

    // Compute adaptive weights based on reliability and uncertainty
    const weights = this.computeWeights(validMeasurements);

    // Weighted fusion
    let fusedValue = 0;
    for (let i = 0; i < validMeasurements.length; i++) {
      fusedValue += weights[i] * validMeasurements[i].value;
    }

    // Blend with posterior
    const blendFactor = 0.3;
    fusedValue = blendFactor * posterior.mean + (1 - blendFactor) * fusedValue;

    // Confidence based on posterior variance
    const confidence = Math.max(0, Math.min(1, 1 - posterior.std / 30));

    return {
      fusedValue,
      confidence,
      weights,
      posteriorMean: posterior.mean,
      posteriorStd: posterior.std
    };
  }

  /**
   * Compute posterior distribution using Gaussian conjugate prior
   */
  private computePosterior(measurements: SourceMeasurement[]): {
    mean: number;
    std: number;
  } {
    // Precision (inverse variance)
    const priorPrecision = 1 / (this.priorStd * this.priorStd);

    let sumWeighted = 0;
    let totalPrecision = priorPrecision;

    for (const m of measurements) {
      const precision = 1 / (m.uncertainty * m.uncertainty + 1e-10);
      sumWeighted += precision * m.value;
      totalPrecision += precision;
    }

    // Add prior contribution
    sumWeighted += priorPrecision * this.priorMean;

    const posteriorMean = sumWeighted / totalPrecision;
    const posteriorStd = Math.sqrt(1 / totalPrecision);

    return { mean: posteriorMean, std: posteriorStd };
  }

  /**
   * Compute adaptive weights for each source
   */
  private computeWeights(measurements: SourceMeasurement[]): number[] {
    const weights: number[] = [];

    for (const m of measurements) {
      // Weight = reliability / uncertainty
      const weight = m.reliability / (m.uncertainty + 1e-10);
      weights.push(weight);
    }

    // Normalize
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < weights.length; i++) {
        weights[i] /= sum;
      }
    } else {
      // Equal weights if all have zero reliability
      const equalWeight = 1 / weights.length;
      for (let i = 0; i < weights.length; i++) {
        weights[i] = equalWeight;
      }
    }

    return weights;
  }

  /**
   * Update prior based on new evidence (online learning)
   */
  updatePrior(measurements: SourceMeasurement[]): void {
    const posterior = this.computePosterior(measurements);
    this.priorMean = posterior.mean;
    this.priorStd = Math.max(5, posterior.std);  // Minimum uncertainty
  }

  /**
   * Set prior parameters
   */
  setPrior(mean: number, std: number): void {
    this.priorMean = mean;
    this.priorStd = std;
  }

  /**
   * Get prior parameters
   */
  getPrior(): { mean: number; std: number } {
    return { mean: this.priorMean, std: this.priorStd };
  }

  /**
   * Set heart rate range constraints
   */
  setHRRange(min: number, max: number): void {
    this.minHR = min;
    this.maxHR = max;
  }

  /**
   * Reset to default prior
   */
  reset(): void {
    this.priorMean = 72;
    this.priorStd = 15;
  }
}

/**
 * Particle Filter for non-linear/non-Gaussian fusion
 * More flexible than Gaussian approximation but higher computational cost
 */
export class ParticleFilter {
  private particles: Float64Array;
  private weights: Float64Array;
  private numParticles: number;
  private processNoise: number;
  private measurementNoise: number;

  constructor(
    numParticles: number = 100,
    processNoise: number = 0.5,
    measurementNoise: number = 2.0
  ) {
    this.numParticles = numParticles;
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
    
    // Initialize particles around 72 BPM
    this.particles = new Float64Array(numParticles);
    this.weights = new Float64Array(numParticles);
    
    for (let i = 0; i < numParticles; i++) {
      this.particles[i] = 72 + (Math.random() - 0.5) * 30;
      this.weights[i] = 1 / numParticles;
    }
  }

  /**
   * Update particle filter with measurement
   */
  update(measurement: number, uncertainty: number): {
    estimate: number;
    confidence: number;
  } {
    // Prediction step: add process noise
    for (let i = 0; i < this.numParticles; i++) {
      this.particles[i] += this.gaussianRandom() * this.processNoise;
      
      // Constrain to plausible range
      this.particles[i] = Math.max(40, Math.min(200, this.particles[i]));
    }

    // Update step: compute weights based on likelihood
    let weightSum = 0;
    for (let i = 0; i < this.numParticles; i++) {
      const likelihood = this.gaussianPDF(
        measurement,
        this.particles[i],
        uncertainty + this.measurementNoise
      );
      this.weights[i] = likelihood;
      weightSum += likelihood;
    }

    // Normalize weights
    if (weightSum > 0) {
      for (let i = 0; i < this.numParticles; i++) {
        this.weights[i] /= weightSum;
      }
    }

    // Resample if effective sample size is low
    const ess = this.computeEffectiveSampleSize();
    if (ess < this.numParticles * 0.5) {
      this.resample();
    }

    // Compute estimate (weighted mean)
    let estimate = 0;
    for (let i = 0; i < this.numParticles; i++) {
      estimate += this.weights[i] * this.particles[i];
    }

    // Compute confidence (inverse of weighted std)
    let weightedVariance = 0;
    for (let i = 0; i < this.numParticles; i++) {
      weightedVariance += this.weights[i] * (this.particles[i] - estimate) ** 2;
    }
    const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(weightedVariance) / 30));

    return { estimate, confidence };
  }

  /**
   * Resample particles based on weights
   */
  private resample(): void {
    const newParticles = new Float64Array(this.numParticles);
    
    // Systematic resampling
    const cumsum = new Float64Array(this.numParticles);
    cumsum[0] = this.weights[0];
    for (let i = 1; i < this.numParticles; i++) {
      cumsum[i] = cumsum[i - 1] + this.weights[i];
    }

    const start = Math.random() / this.numParticles;
    for (let i = 0; i < this.numParticles; i++) {
      const u = start + i / this.numParticles;
      let j = 0;
      while (j < this.numParticles - 1 && cumsum[j] < u) {
        j++;
      }
      newParticles[i] = this.particles[j];
    }

    this.particles = newParticles;
    this.weights.fill(1 / this.numParticles);
  }

  /**
   * Compute effective sample size
   */
  private computeEffectiveSampleSize(): number {
    let sumSquared = 0;
    for (let i = 0; i < this.numParticles; i++) {
      sumSquared += this.weights[i] * this.weights[i];
    }
    return 1 / sumSquared;
  }

  /**
   * Gaussian probability density function
   */
  private gaussianPDF(x: number, mean: number, std: number): number {
    const diff = x - mean;
    return Math.exp(-0.5 * (diff * diff) / (std * std)) / (std * Math.sqrt(2 * Math.PI));
  }

  /**
   * Box-Muller transform for Gaussian random numbers
   */
  private gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * Reset particles
   */
  reset(initialHR: number = 72): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.particles[i] = initialHR + (Math.random() - 0.5) * 30;
      this.weights[i] = 1 / this.numParticles;
    }
  }

  /**
   * Get particle statistics
   */
  getStatistics(): {
    mean: number;
    std: number;
    min: number;
    max: number;
  } {
    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < this.numParticles; i++) {
      const p = this.particles[i];
      sum += p;
      sumSq += p * p;
      min = Math.min(min, p);
      max = Math.max(max, p);
    }

    const mean = sum / this.numParticles;
    const variance = (sumSq / this.numParticles) - (mean * mean);
    const std = Math.sqrt(Math.max(0, variance));

    return { mean, std, min, max };
  }
}
