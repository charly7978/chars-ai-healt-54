
import { AdvancedFingerDetector, FingerDetectionResult } from './AdvancedFingerDetector';
import { SignalQualityAnalyzer } from './SignalQualityAnalyzer';
import { BufferManager } from './BufferManager';
import type { ProcessedSignal } from './types';

export class PPGSignalProcessor {
  private fingerDetector: AdvancedFingerDetector;
  private qualityAnalyzer: SignalQualityAnalyzer;
  private bufferManager: BufferManager;
  private lastFingerResult: FingerDetectionResult | null = null;

  constructor() {
    this.fingerDetector = new AdvancedFingerDetector();
    this.qualityAnalyzer = new SignalQualityAnalyzer();
    this.bufferManager = new BufferManager(300);
    
    console.log('📡 PPGSignalProcessor inicializado con detector avanzado de dedo');
  }

  public processVideoFrame(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D
  ): ProcessedSignal {
    // Extract color values from video frame
    const colorValues = this.extractColorValues(video, canvas, context);
    
    // Advanced finger detection with multi-level consensus
    this.lastFingerResult = this.fingerDetector.detectFinger(colorValues);
    
    // Add sample to buffer for quality analysis
    this.bufferManager.addSample(colorValues.g, Date.now());
    
    // Calculate PPG signal based on finger detection
    const ppgValue = this.calculatePPGSignal(colorValues, this.lastFingerResult);
    
    // Analyze signal quality
    const quality = this.qualityAnalyzer.calculateQuality(
      this.bufferManager.getRecentSamples(30),
      this.lastFingerResult.isDetected
    );

    const result: ProcessedSignal = {
      ppgValue,
      quality: Math.round(quality),
      fingerDetected: this.lastFingerResult.isDetected,
      confidence: this.lastFingerResult.confidence,
      timestamp: Date.now(),
      colorValues,
      fingerDetails: this.lastFingerResult
    };

    console.log('📊 PPG Signal processed:', {
      fingerDetected: result.fingerDetected,
      confidence: result.confidence.toFixed(2),
      quality: result.quality,
      ppgValue: result.ppgValue.toFixed(2)
    });

    return result;
  }

  private extractColorValues(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D
  ): { r: number; g: number; b: number } {
    const { videoWidth, videoHeight } = video;
    
    // Ensure canvas matches video dimensions
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }
    
    // Draw current video frame
    context.drawImage(video, 0, 0, videoWidth, videoHeight);
    
    // Define ROI (Region of Interest) for finger detection
    const roiX = Math.floor(videoWidth * 0.25);
    const roiY = Math.floor(videoHeight * 0.25);
    const roiWidth = Math.floor(videoWidth * 0.5);
    const roiHeight = Math.floor(videoHeight * 0.5);
    
    // Extract image data from ROI
    const imageData = context.getImageData(roiX, roiY, roiWidth, roiHeight);
    const data = imageData.data;
    
    // Calculate average RGB values with improved sampling
    let r = 0, g = 0, b = 0;
    let validPixels = 0;
    
    // Sample every 4th pixel for performance while maintaining accuracy
    for (let i = 0; i < data.length; i += 16) { // Skip more pixels for performance
      const red = data[i];
      const green = data[i + 1];
      const blue = data[i + 2];
      
      // Only include pixels that might be skin (basic filtering)
      if (red > 30 && green > 20 && blue > 10) {
        r += red;
        g += green;
        b += blue;
        validPixels++;
      }
    }
    
    // Return averaged values or defaults if no valid pixels
    if (validPixels === 0) {
      return { r: 50, g: 50, b: 50 };
    }
    
    return {
      r: Math.round(r / validPixels),
      g: Math.round(g / validPixels),
      b: Math.round(b / validPixels)
    };
  }

  private calculatePPGSignal(
    colorValues: { r: number; g: number; b: number },
    fingerResult: FingerDetectionResult
  ): number {
    if (!fingerResult.isDetected || fingerResult.confidence < 0.3) {
      return 0;
    }

    // Green channel is most sensitive to blood volume changes
    const greenChannel = colorValues.g;
    
    // Apply advanced signal conditioning
    const baselineGreen = 128; // Expected baseline for green channel
    const deviation = greenChannel - baselineGreen;
    
    // Normalize by confidence and quality factors
    const confidenceWeight = Math.max(0.1, fingerResult.confidence);
    const qualityWeight = Math.max(0.1, fingerResult.quality / 100);
    
    // Calculate PPG signal with proper scaling
    const rawPPG = deviation * confidenceWeight * qualityWeight;
    
    // Apply physiological bounds and scaling
    const scaledPPG = Math.max(-50, Math.min(50, rawPPG));
    
    // Convert to positive range (0-100) for compatibility
    return (scaledPPG + 50);
  }

  public getLastFingerDetectionResult(): FingerDetectionResult | null {
    return this.lastFingerResult;
  }

  public reset(): void {
    this.fingerDetector.reset();
    this.bufferManager.clear();
    this.qualityAnalyzer.reset();
    this.lastFingerResult = null;
    console.log('🔄 PPGSignalProcessor reiniciado');
  }
}
