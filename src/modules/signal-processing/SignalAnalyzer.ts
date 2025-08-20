
import { AdvancedFingerDetector, FingerDetectionResult } from './AdvancedFingerDetector';
import { SignalQualityAnalyzer } from './SignalQualityAnalyzer';

export interface SignalAnalysisResult {
  quality: number;
  fingerDetected: boolean;
  confidence: number;
  snr: number;
  stability: number;
  artifacts: number;
  detectorDetails: Record<string, string | number>;
}

export class SignalAnalyzer {
  private fingerDetector: AdvancedFingerDetector;
  private qualityAnalyzer: SignalQualityAnalyzer;
  private signalHistory: number[] = [];
  private readonly MAX_HISTORY = 100;

  constructor() {
    this.fingerDetector = new AdvancedFingerDetector();
    this.qualityAnalyzer = new SignalQualityAnalyzer();
  }

  public analyzeSignal(
    ppgValue: number,
    colorValues: { r: number; g: number; b: number },
    timestamp: number
  ): SignalAnalysisResult {
    // Update signal history
    this.updateSignalHistory(ppgValue);
    
    // Advanced finger detection
    const fingerResult = this.fingerDetector.detectFinger(colorValues);
    
    // Signal quality analysis
    const quality = this.qualityAnalyzer.calculateQuality(
      this.signalHistory.slice(-30),
      fingerResult.isDetected
    );
    
    // Calculate additional metrics
    const snr = this.calculateSNR();
    const stability = this.calculateStability();
    const artifacts = this.detectArtifacts();
    
    // Prepare detector details with proper typing
    const detectorDetails: Record<string, string | number> = {
      biophysicalScore: fingerResult.biophysicalScore,
      stabilityScore: fingerResult.stabilityScore,
      perfusionIndex: fingerResult.perfusionIndex,
      colorValidation: fingerResult.details.colorValidation ? 1 : 0,
      pulsatilityValidation: fingerResult.details.pulsatilityValidation ? 1 : 0,
      stabilityValidation: fingerResult.details.stabilityValidation ? 1 : 0,
      perfusionValidation: fingerResult.details.perfusionValidation ? 1 : 0,
      temperatureValidation: fingerResult.details.temperatureValidation ? 1 : 0
    };

    return {
      quality: Math.round(quality),
      fingerDetected: fingerResult.isDetected,
      confidence: fingerResult.confidence,
      snr,
      stability,
      artifacts,
      detectorDetails
    };
  }

  private updateSignalHistory(ppgValue: number): void {
    this.signalHistory.push(ppgValue);
    
    if (this.signalHistory.length > this.MAX_HISTORY) {
      this.signalHistory.shift();
    }
  }

  private calculateSNR(): number {
    if (this.signalHistory.length < 10) return 0;
    
    const recent = this.signalHistory.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Signal power (variance from mean)
    const signalPower = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;
    
    // Noise estimation from high-frequency differences
    let noisePower = 0;
    for (let i = 1; i < recent.length; i++) {
      noisePower += Math.pow(recent[i] - recent[i-1], 2);
    }
    noisePower /= (recent.length - 1);
    
    return noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : 0;
  }

  private calculateStability(): number {
    if (this.signalHistory.length < 15) return 0;
    
    const recent = this.signalHistory.slice(-15);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation (lower is more stable)
    const cv = mean > 0 ? stdDev / mean : 1;
    
    // Convert to stability score (0-100, higher is better)
    return Math.max(0, Math.min(100, (1 - cv) * 100));
  }

  private detectArtifacts(): number {
    if (this.signalHistory.length < 10) return 0;
    
    const recent = this.signalHistory.slice(-10);
    let artifactCount = 0;
    
    // Detect sudden spikes or drops
    for (let i = 1; i < recent.length - 1; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      const next = recent[i + 1];
      
      // Check for sudden changes that don't follow physiological patterns
      if (Math.abs(curr - prev) > 20 && Math.abs(curr - next) > 20) {
        artifactCount++;
      }
    }
    
    // Return artifact percentage
    return Math.round((artifactCount / (recent.length - 2)) * 100);
  }

  public reset(): void {
    this.fingerDetector.reset();
    this.qualityAnalyzer.reset();
    this.signalHistory = [];
  }
}
