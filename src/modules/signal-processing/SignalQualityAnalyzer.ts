
import { SignalQualityMetrics } from './types';

export class SignalQualityAnalyzer {
  private qualityHistory: number[] = [];
  private readonly MAX_HISTORY = 50;

  constructor() {
    console.log('📊 SignalQualityAnalyzer inicializado');
  }

  public calculateQuality(samples: number[], fingerDetected: boolean): number {
    if (!fingerDetected || samples.length < 5) {
      return 0;
    }

    // Calculate basic quality metrics
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    
    // Signal-to-noise ratio estimation
    const snr = mean > 0 ? (mean / (stdDev + 1)) : 0;
    
    // Stability score (lower variation is better)
    const stability = Math.max(0, 100 - (stdDev / mean) * 100);
    
    // Overall quality score
    const quality = Math.min(100, Math.max(0, (snr * 20) + (stability * 0.8)));
    
    // Update history
    this.qualityHistory.push(quality);
    if (this.qualityHistory.length > this.MAX_HISTORY) {
      this.qualityHistory.shift();
    }
    
    return Math.round(quality);
  }

  public getQualityMetrics(samples: number[]): SignalQualityMetrics {
    if (samples.length < 5) {
      return {
        snr: 0,
        stability: 0,
        consistency: 0,
        overallQuality: 0
      };
    }

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    
    // Signal-to-noise ratio
    const snr = mean > 0 ? 10 * Math.log10(variance / (stdDev + 0.1)) : 0;
    
    // Stability (coefficient of variation)
    const stability = mean > 0 ? Math.max(0, 100 - (stdDev / mean) * 100) : 0;
    
    // Consistency based on recent quality history
    const consistency = this.qualityHistory.length > 5 ? 
      this.calculateConsistency() : 0;
    
    // Overall quality
    const overallQuality = (snr * 0.4) + (stability * 0.4) + (consistency * 0.2);
    
    return {
      snr: Math.round(snr),
      stability: Math.round(stability),
      consistency: Math.round(consistency),
      overallQuality: Math.round(Math.max(0, Math.min(100, overallQuality)))
    };
  }

  private calculateConsistency(): number {
    if (this.qualityHistory.length < 3) return 0;
    
    const recent = this.qualityHistory.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower standard deviation means higher consistency
    return Math.max(0, 100 - stdDev);
  }

  public reset(): void {
    this.qualityHistory = [];
    console.log('🔄 SignalQualityAnalyzer reiniciado');
  }
}
