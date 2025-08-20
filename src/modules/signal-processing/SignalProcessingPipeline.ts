import { AdvancedFingerDetector, FingerDetectionResult } from './AdvancedFingerDetector';
import { SignalQualityAnalyzer } from './SignalQualityAnalyzer';
import { BufferManager } from './BufferManager';
import type { ProcessedSignal, ProcessingConfig } from './types';

export class SignalProcessingPipeline {
  private fingerDetector: AdvancedFingerDetector;
  private qualityAnalyzer: SignalQualityAnalyzer;
  private bufferManager: BufferManager;
  private isInitialized = false;

  constructor(config: ProcessingConfig = {}) {
    this.fingerDetector = new AdvancedFingerDetector();
    this.qualityAnalyzer = new SignalQualityAnalyzer();
    this.bufferManager = BufferManager.getInstance();
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log('🔧 Inicializando pipeline de procesamiento avanzado...');
    this.isInitialized = true;
  }

  public processFrame(
    videoFrame: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D
  ): ProcessedSignal {
    if (!this.isInitialized) {
      throw new Error('Pipeline not initialized');
    }

    // Extract color values from video frame
    const colorValues = this.extractColorValues(videoFrame, canvas, context);
    
    // Advanced finger detection
    const fingerResult = this.fingerDetector.detectFinger(colorValues);
    
    // Add to buffer
    this.bufferManager.addSample(colorValues.r, Date.now());
    
    // Calculate PPG signal
    const ppgSignal = this.calculatePPGSignal(colorValues, fingerResult);
    
    // Analyze signal quality
    const quality = this.qualityAnalyzer.calculateQuality(
      this.bufferManager.getRecentSamples(30),
      fingerResult.isDetected
    );

    return {
      timestamp: Date.now(),
      rawValue: ppgSignal,
      filteredValue: ppgSignal,
      quality: Math.round(quality),
      fingerDetected: fingerResult.isDetected,
      roi: {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height
      },
      perfusionIndex: fingerResult.perfusionIndex
    };
  }

  private extractColorValues(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D
  ): { r: number; g: number; b: number } {
    const { videoWidth, videoHeight } = video;
    
    // Set canvas size to match video
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    
    // Draw video frame to canvas
    context.drawImage(video, 0, 0, videoWidth, videoHeight);
    
    // Extract ROI (Region of Interest) - center area where finger should be
    const roiX = Math.floor(videoWidth * 0.3);
    const roiY = Math.floor(videoHeight * 0.3);
    const roiWidth = Math.floor(videoWidth * 0.4);
    const roiHeight = Math.floor(videoHeight * 0.4);
    
    const imageData = context.getImageData(roiX, roiY, roiWidth, roiHeight);
    const data = imageData.data;
    
    // Calculate average RGB values
    let r = 0, g = 0, b = 0, pixelCount = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];     // Red
      g += data[i + 1]; // Green  
      b += data[i + 2]; // Blue
      pixelCount++;
    }
    
    return {
      r: Math.round(r / pixelCount),
      g: Math.round(g / pixelCount),
      b: Math.round(b / pixelCount)
    };
  }

  private calculatePPGSignal(
    colorValues: { r: number; g: number; b: number },
    fingerResult: FingerDetectionResult
  ): number {
    if (!fingerResult.isDetected) {
      return 0;
    }

    // Use green channel as primary PPG signal (best for photoplethysmography)
    const greenSignal = colorValues.g;
    
    // Apply finger detection confidence as signal multiplier
    const confidenceMultiplier = Math.max(0.1, fingerResult.confidence);
    
    // Normalize and scale signal
    const normalizedSignal = (greenSignal / 255) * confidenceMultiplier;
    
    return normalizedSignal * 100; // Scale to 0-100 range
  }

  public reset(): void {
    this.fingerDetector.reset();
    this.bufferManager.clear();
    this.qualityAnalyzer.reset();
  }

  public getFingerDetectionResult(): FingerDetectionResult | null {
    // Return the last detection result if available
    return null; // Would need to store last result in class property
  }
}
