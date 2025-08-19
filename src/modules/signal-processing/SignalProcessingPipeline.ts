import { Subject, Observable } from 'rxjs';
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
  
  // Observables for state changes
  private signalSubject = new Subject<ProcessedSignal>();
  private errorSubject = new Subject<ProcessingError>();
  private qualitySubject = new Subject<SignalQualityMetrics>();
  
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
    this.frameProcessor = new FrameProcessor();
    this.signalAnalyzer = new SignalAnalyzer();
    this.biophysicalValidator = new BiophysicalValidator();
    this.trendAnalyzer = new SignalTrendAnalyzer();
  }
  
  // Public API
  public get signal$(): Observable<ProcessedSignal> {
    return this.signalSubject.asObservable();
  }
  
  public get error$(): Observable<ProcessingError> {
    return this.errorSubject.asObservable();
  }
  
  public get quality$(): Observable<SignalQualityMetrics> {
    return this.qualitySubject.asObservable();
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
      this.trendAnalyzer.update(frameData.redValue);
      const trend = this.trendAnalyzer.getTrend();
      
      // 5. Validate biophysical constraints
      const biophysicalValidation = this.biophysicalValidator.validate(frameData);
      
      // 6. Create processed signal
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: frameData.redValue,
        filteredValue: this.signalBuffer[this.currentIndex],
        quality: qualityMetrics.overallQuality,
        fingerDetected: biophysicalValidation.isValid,
        roi: frameData.roi,
        perfusionIndex: qualityMetrics.perfusionIndex,
        signalStrength: qualityMetrics.signalStrength,
        noiseLevel: qualityMetrics.noiseLevel
      };
      
      // 7. Emit the processed signal
      this.signalSubject.next(processedSignal);
      this.qualitySubject.next(qualityMetrics);
      
      this.currentIndex++;
      
    } catch (error) {
      this.errorSubject.next({
        type: 'PROCESSING_ERROR',
        message: `Error processing frame: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
        code: 'FRAME_PROCESSING_ERROR'
      });
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

// Types
export interface SignalQualityMetrics {
  signalStrength: number;
  noiseLevel: number;
  perfusionIndex: number;
  overallQuality: number;
  timestamp: number;
}
