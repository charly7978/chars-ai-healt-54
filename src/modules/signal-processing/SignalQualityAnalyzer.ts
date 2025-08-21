export function computeSNR(psdPeak: number, psdNoiseMedian: number) {
  if (!psdNoiseMedian || !isFinite(psdNoiseMedian)) return 0;
  const snr = psdPeak / psdNoiseMedian;
  const db = 10 * Math.log10(Math.max(1e-9, snr));
  const scaled = (db + 30) * 2; // ajustar escala: -30dB->0, ~+20dB->100
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

// Mantener clase existente para compatibilidad
export interface SignalQualityMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  overallQuality: number;
  timestamp: number;
}

export class SignalQualityAnalyzer {
  private readonly WINDOW_SIZE = 30;
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
    
    this.signalBuffer.push(signalValue);
    if (this.signalBuffer.length > this.WINDOW_SIZE) {
      this.signalBuffer.shift();
    }
    
    this.frameTimestamps.push(now);
    this.frameTimestamps = this.frameTimestamps.filter(t => now - t < 1000);
    
    const signalMean = this.calculateMean(this.signalBuffer);
    const signalStd = this.calculateStd(this.signalBuffer, signalMean);
    const signalRange = this.calculateRange(this.signalBuffer);
    
    const signalStrength = signalMean / 255;
    const noiseLevel = signalStd / (signalRange || 1);
    const perfusionIndex = this.calculatePerfusionIndex();
    
    const stabilityScore = Math.max(0, 1 - (noiseLevel * 2));
    const strengthScore = Math.min(1, signalStrength * 1.5);
    const overallQuality = (stabilityScore * 0.6) + (strengthScore * 0.4);
    
    this.qualityHistory.push(overallQuality);
    if (this.qualityHistory.length > this.WINDOW_SIZE) {
      this.qualityHistory.shift();
    }
    
    return {
      signalStrength,
      noiseLevel,
      perfusionIndex,
      overallQuality,
      timestamp: now
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
    
    const ac = this.calculateStd(this.signalBuffer, this.calculateMean(this.signalBuffer));
    const dc = this.calculateMean(this.signalBuffer);
    
    return Math.min(1, Math.max(0, (ac / (dc || 1)) * 10));
  }
}
