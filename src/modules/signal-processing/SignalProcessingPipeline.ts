import { ProcessedSignal, ProcessingError, SignalQualityMetrics } from '../../types/signal';
import { FrameProcessor } from './FrameProcessor';
import { SignalAnalyzer } from './SignalAnalyzer';
import { BiophysicalValidator } from './BiophysicalValidator';
import { SignalTrendAnalyzer } from './SignalTrendAnalyzer';

export class SignalProcessingPipeline {
  // Shared data buffers
  private sharedBuffer: SharedArrayBuffer;
  private signalBuffer: Float32Array;
  private qualityBuffer: Float32Array;
  private currentIndex = 0;
  
  // Callbacks for state changes
  private signalCallback?: (signal: ProcessedSignal) => void;
  private errorCallback?: (error: ProcessingError) => void;
  private qualityCallback?: (quality: SignalQualityMetrics) => void;
  
  // Processing components
  private frameProcessor: FrameProcessor;
  private signalAnalyzer: SignalAnalyzer;
  private biophysicalValidator: BiophysicalValidator;
  private trendAnalyzer: SignalTrendAnalyzer;
  
  // State
  private isProcessing = false;
  private lastProcessedFrame: ImageData | null = null;
  
  constructor() {
    // Initialize shared buffer (adjust size as needed)
    this.sharedBuffer = new SharedArrayBuffer(1024 * 4); // 1KB for signal data
    this.signalBuffer = new Float32Array(this.sharedBuffer);
    this.qualityBuffer = new Float32Array(100); // Circular buffer for quality metrics
    
    // Initialize processing components with shared configuration
    const analyzerConfig = {
      QUALITY_LEVELS: 100,
      QUALITY_HISTORY_SIZE: 10,
      MIN_CONSECUTIVE_DETECTIONS: 3,
      MAX_CONSECUTIVE_NO_DETECTIONS: 5
    };
    this.frameProcessor = new FrameProcessor({
      TEXTURE_GRID_SIZE: 4,
      ROI_SIZE_FACTOR: 0.6
    });
    this.signalAnalyzer = new SignalAnalyzer(analyzerConfig);
    this.biophysicalValidator = new BiophysicalValidator();
    this.trendAnalyzer = new SignalTrendAnalyzer();
  }
  
  // Public API
  public onSignal(callback: (signal: ProcessedSignal) => void): void {
    this.signalCallback = callback;
  }
  
  public onError(callback: (error: ProcessingError) => void): void {
    this.errorCallback = callback;
  }
  
  public onQuality(callback: (quality: SignalQualityMetrics) => void): void {
    this.qualityCallback = callback;
  }
  
  public start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    // Reset all components
    this.signalAnalyzer.reset();
    this.biophysicalValidator.reset();
    this.trendAnalyzer.reset();
    this.currentIndex = 0;
  }
  
  public stop(): void {
    this.isProcessing = false;
    // Clean up resources if needed
  }
  
  public async processFrame(imageData: ImageData): Promise<void> {
    if (!this.isProcessing) return;
    
    try {
      this.lastProcessedFrame = imageData;
      
      // 1. Frame processing
      const frameData = this.frameProcessor.extractFrameData(imageData);
      
      // 2. Update signal buffer (circular buffer)
      this.signalBuffer[this.currentIndex % this.signalBuffer.length] = frameData.redValue;
      
      // 3. Calculate signal quality metrics
      const qualityMetrics = this.calculateQualityMetrics(frameData);
      this.qualityBuffer[this.currentIndex % this.qualityBuffer.length] = qualityMetrics.overallQuality;
      
      // 4. Update analyzers
      const trendResult = this.trendAnalyzer.analyzeTrend(frameData.redValue);
      const stabilityScore = this.trendAnalyzer.getStabilityScore();
      
      // 5. Validate biophysical constraints
      const pulsatilityScore = this.biophysicalValidator.getPulsatilityScore([frameData.redValue]);
      const biophysicalValidation = pulsatilityScore > 0.03;
      
      // 6. Create processed signal
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: frameData.redValue,
        filteredValue: this.signalBuffer[this.currentIndex],
        quality: qualityMetrics.overallQuality,
        fingerDetected: biophysicalValidation,
        roi: {
          x: 0,
          y: 0,
          width: imageData.width,
          height: imageData.height
        },
        perfusionIndex: qualityMetrics.perfusionIndex
      };
      
      // 7. Emit the processed signal
      if (this.signalCallback) this.signalCallback(processedSignal);
      if (this.qualityCallback) this.qualityCallback(qualityMetrics);
      
      this.currentIndex++;
      
    } catch (error) {
      if (this.errorCallback) {
        this.errorCallback({
          code: 'FRAME_PROCESSING_ERROR',
          message: `Error processing frame: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now()
        });
      }
    }
  }
  
  private calculateQualityMetrics(frameData: any): SignalQualityMetrics {
    // Centralized quality metrics calculation
    const signalStrength = frameData.redValue / 255; // Normalized to 0-1
    const noiseLevel = this.calculateNoiseLevel();
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // Combine metrics into overall quality score (0-1)
    const overallQuality = Math.min(1, Math.max(0, 
      (signalStrength * 0.4) + 
      ((1 - noiseLevel) * 0.4) + 
      (perfusionIndex * 0.2)
    ));
    
    return {
      signalStrength,
      noiseLevel,
      perfusionIndex,
      overallQuality,
      timestamp: Date.now()
    };
  }
  
  private calculateNoiseLevel(): number {
    // Implement noise level calculation
    return 0.1; // Placeholder
  }
  
  private calculatePerfusionIndex(): number {
    // Implement perfusion index calculation
    return 0.8; // Placeholder
  }
}

