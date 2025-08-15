import { SignalQualityMetrics } from '../../types/signal';

export class SignalQualityAnalyzer {
  private readonly WINDOW_SIZE = 30; // Number of samples for quality analysis
  private signalBuffer: number[] = [];
  private qualityHistory: number[] = [];
  private frameTimestamps: number[] = [];
  
  constructor() {}
  
  public reset(): void {
    this.signalBuffer = [];
    this.qualityHistory = [];
    this.frameTimestamps = [];
  }
  
  public calculateMetrics(signalValue: number): SignalQualityMetrics {
    const now = Date.now();
    
    // Update signal buffer
    this.signalBuffer.push(signalValue);
    if (this.signalBuffer.length > this.WINDOW_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Update frame timestamps for FPS calculation
    this.frameTimestamps.push(now);
    this.frameTimestamps = this.frameTimestamps.filter(t => now - t < 1000); // Keep last second
    
    // Calculate signal statistics
    const signalMean = this.calculateMean(this.signalBuffer);
    const signalStd = this.calculateStd(this.signalBuffer, signalMean);
    const signalRange = this.calculateRange(this.signalBuffer);
    
    // Calculate quality metrics
    const signalStrength = signalMean / 255; // Normalize to 0-1
    const noiseLevel = signalStd / (signalRange || 1); // Normalized noise level
    const perfusionIndex = this.calculatePerfusionIndex();
    const frameRate = this.frameTimestamps.length; // FPS
    
    // Calculate overall quality score (0-1)
    const stabilityScore = Math.max(0, 1 - (noiseLevel * 2)); // Lower noise = higher stability
    const strengthScore = Math.min(1, signalStrength * 1.5); // Boost weaker signals
    const overallQuality = (stabilityScore * 0.6) + (strengthScore * 0.4);
    
    // Update quality history
    this.qualityHistory.push(overallQuality);
    if (this.qualityHistory.length > this.WINDOW_SIZE) {
      this.qualityHistory.shift();
    }
    
    return {
      signalStrength,
      noiseLevel,
      perfusionIndex,
      overallQuality,
      timestamp: now,
      frameRate,
      bufferUsage: this.signalBuffer.length / this.WINDOW_SIZE,
      confidence: this.calculateConfidence()
    };
  }
  
  private calculateMean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / (values.length || 1);
  }
  
  private calculateStd(values: number[], mean: number): number {
    const squareDiffs = values.map(val => Math.pow(val - mean, 2));
    return Math.sqrt(this.calculateMean(squareDiffs));
  }
  
  private calculateRange(values: number[]): number {
    if (values.length === 0) return 0;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max - min;
  }
  
  private calculatePerfusionIndex(): number {
    if (this.signalBuffer.length < 2) return 0;
    
    // Simple AC/DC ratio calculation for perfusion index
    const ac = this.calculateStd(this.signalBuffer, this.calculateMean(this.signalBuffer));
    const dc = this.calculateMean(this.signalBuffer);
    
    // Normalize to 0-1 range
    return Math.min(1, Math.max(0, (ac / (dc || 1)) * 10));
  }
  
  private calculateConfidence(): number {
    if (this.qualityHistory.length === 0) return 0;
    
    // Calculate confidence based on recent quality stability
    const recentQuality = this.qualityHistory.slice(-5); // Last 5 samples
    const avgQuality = this.calculateMean(recentQuality);
    const qualityVariance = this.calculateStd(recentQuality, avgQuality);
    
    // Higher confidence for stable, high-quality signals
    const stabilityScore = 1 - Math.min(1, qualityVariance * 2);
    return Math.min(1, avgQuality * stabilityScore);
  }
}
