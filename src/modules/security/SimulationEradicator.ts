
import { ContinuousValidator } from './ContinuousValidator';

class SimulationEradicator {
  private validator: ContinuousValidator;
  private previousValues: number[] = [];
  
  constructor() {
    this.validator = ContinuousValidator.getInstance();
  }

  public quickSimulationCheck(value: number, timestamp: number): boolean {
    // Store recent values for pattern analysis
    this.previousValues.push(value);
    if (this.previousValues.length > 20) {
      this.previousValues.shift();
    }

    // Check for obvious simulation patterns
    if (this.previousValues.length < 5) return false;

    // Check for constant values (obvious simulation)
    const lastFive = this.previousValues.slice(-5);
    const isConstant = lastFive.every(v => Math.abs(v - lastFive[0]) < 0.1);
    
    if (isConstant) {
      console.warn('⚠️ Simulation detected: constant values');
      return true;
    }

    // Check for unrealistic ranges
    if (value < 0 || value > 200) {
      console.warn('⚠️ Simulation detected: unrealistic range');
      return true;
    }

    return false;
  }

  public validateSignalAuthenticity(signal: number[]): boolean {
    if (signal.length < 10) return true;

    // Check for physiologically impossible patterns
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    
    // Too low variance suggests simulation
    if (variance < 0.5) {
      console.warn('⚠️ Low variance detected - possible simulation');
      return false;
    }

    return true;
  }

  public validateBiophysicalSignal(signal: number[]): boolean {
    if (signal.length < 5) return true;

    // Calculate biophysical metrics
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    
    // Check for physiologically realistic variance
    if (variance < 0.1) {
      console.warn('⚠️ Biophysical validation failed - too low variance');
      return false;
    }

    // Check for realistic signal range (PPG values)
    const minVal = Math.min(...signal);
    const maxVal = Math.max(...signal);
    
    if (maxVal - minVal < 1.0) {
      console.warn('⚠️ Biophysical validation failed - insufficient signal range');
      return false;
    }

    // Calculate spectral entropy (simplified)
    const spectralEntropy = this.calculateSpectralEntropy(signal);
    if (spectralEntropy < 0.5) {
      console.warn('⚠️ Biophysical validation failed - low spectral entropy');
      return false;
    }

    return true;
  }

  private calculateSpectralEntropy(signal: number[]): number {
    // Simplified spectral entropy calculation
    const fft = this.simpleFFT(signal);
    const powerSpectrum = fft.map(val => val * val);
    const totalPower = powerSpectrum.reduce((a, b) => a + b, 0);
    
    if (totalPower === 0) return 0;
    
    const normalizedSpectrum = powerSpectrum.map(p => p / totalPower);
    let entropy = 0;
    
    for (const p of normalizedSpectrum) {
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    
    return entropy / Math.log2(normalizedSpectrum.length);
  }

  private simpleFFT(signal: number[]): number[] {
    // Simplified FFT implementation for spectral analysis
    const N = signal.length;
    const result = new Array(N).fill(0);
    
    for (let k = 0; k < N; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += signal[n] * Math.cos(angle);
        imag += signal[n] * Math.sin(angle);
      }
      
      result[k] = Math.sqrt(real * real + imag * imag);
    }
    
    return result;
  }

  public reset(): void {
    this.previousValues = [];
  }
}

export const simulationEradicator = new SimulationEradicator();
