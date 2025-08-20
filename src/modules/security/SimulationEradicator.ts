
import { ContinuousValidator } from '../../security/ContinuousValidator';

class SimulationEradicator {
  private validator: ContinuousValidator;
  private previousValues: number[] = [];
  
  constructor() {
    this.validator = new ContinuousValidator();
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

  public reset(): void {
    this.previousValues = [];
  }
}

export const simulationEradicator = new SimulationEradicator();
