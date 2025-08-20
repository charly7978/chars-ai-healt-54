
import { AdvancedFingerDetector, FingerDetectionResult } from './AdvancedFingerDetector';
import { SignalQualityAnalyzer } from './SignalQualityAnalyzer';
import { BufferManager } from './BufferManager';
import { ProcessedSignal } from './types';

export class PPGSignalProcessor {
  private fingerDetector: AdvancedFingerDetector;
  private qualityAnalyzer: SignalQualityAnalyzer;
  private bufferManager: BufferManager;
  private lastFingerResult: FingerDetectionResult | null = null;
  private isRunning = false;

  // Callbacks para hooks
  public onSignalReady?: (signal: ProcessedSignal) => void;
  public onError?: (error: any) => void;

  constructor(onSignalReady?: (signal: ProcessedSignal) => void, onError?: (error: any) => void) {
    this.fingerDetector = new AdvancedFingerDetector();
    this.qualityAnalyzer = new SignalQualityAnalyzer();
    this.bufferManager = new BufferManager();
    
    this.onSignalReady = onSignalReady;
    this.onError = onError;
    
    console.log('📡 PPGSignalProcessor inicializado con detector avanzado de dedo');
  }

  public start(): void {
    this.isRunning = true;
    console.log('📡 PPGSignalProcessor iniciado');
  }

  public stop(): void {
    this.isRunning = false;
    console.log('📡 PPGSignalProcessor detenido');
  }

  public async calibrate(): Promise<void> {
    console.log('📡 Iniciando calibración PPG');
    // Calibración simple - en una implementación real tendría más lógica
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('📡 Calibración PPG completada');
  }

  public get isProcessing(): boolean {
    return this.isRunning;
  }

  public processFrame(imageData: ImageData): void {
    if (!this.isRunning) return;

    try {
      // Extraer valores de color del ImageData
      const colorValues = this.extractColorFromImageData(imageData);
      
      // Detectar dedo
      this.lastFingerResult = this.fingerDetector.detectFinger(colorValues);
      
      // Agregar muestra al buffer
      if (this.bufferManager.addSample) {
        this.bufferManager.addSample(colorValues.g, Date.now());
      }
      
      // Calcular señal PPG
      const ppgValue = this.calculatePPGSignal(colorValues, this.lastFingerResult);
      
      // Analizar calidad de señal
      const quality = this.calculateBasicQuality(colorValues, this.lastFingerResult);

      const result: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: ppgValue,
        filteredValue: ppgValue,
        quality: Math.round(quality),
        fingerDetected: this.lastFingerResult.isDetected,
        roi: {
          x: 0,
          y: 0,
          width: imageData.width,
          height: imageData.height
        },
        perfusionIndex: this.lastFingerResult.perfusionIndex
      };

      // Llamar callback si existe
      if (this.onSignalReady) {
        this.onSignalReady(result);
      }

    } catch (error) {
      console.error('Error procesando frame PPG:', error);
      if (this.onError) {
        this.onError(error);
      }
    }
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
    
    // Add sample to buffer for quality analysis (si el método existe)
    if (this.bufferManager.addSample) {
      this.bufferManager.addSample(colorValues.g, Date.now());
    }
    
    // Calculate PPG signal based on finger detection
    const ppgValue = this.calculatePPGSignal(colorValues, this.lastFingerResult);
    
    // Analyze signal quality
    const quality = this.calculateBasicQuality(colorValues, this.lastFingerResult);

    const result: ProcessedSignal = {
      timestamp: Date.now(),
      rawValue: ppgValue,
      filteredValue: ppgValue,
      quality: Math.round(quality),
      fingerDetected: this.lastFingerResult.isDetected,
      roi: {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height
      },
      perfusionIndex: this.lastFingerResult.perfusionIndex
    };

    console.log('📊 PPG Signal processed:', {
      fingerDetected: result.fingerDetected,
      confidence: this.lastFingerResult.confidence.toFixed(2),
      quality: result.quality,
      ppgValue: result.rawValue.toFixed(2)
    });

    return result;
  }

  private extractColorFromImageData(imageData: ImageData): { r: number; g: number; b: number } {
    const { data, width, height } = imageData;
    let r = 0, g = 0, b = 0;
    let pixelCount = 0;

    // Muestra cada 4° pixel para performance
    for (let i = 0; i < data.length; i += 16) {
      const red = data[i];
      const green = data[i + 1];
      const blue = data[i + 2];
      
      if (red > 30 && green > 20 && blue > 10) {
        r += red;
        g += green;
        b += blue;
        pixelCount++;
      }
    }

    if (pixelCount === 0) {
      return { r: 50, g: 50, b: 50 };
    }

    return {
      r: Math.round(r / pixelCount),
      g: Math.round(g / pixelCount),
      b: Math.round(b / pixelCount)
    };
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
    for (let i = 0; i < data.length; i += 16) {
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

  private calculateBasicQuality(
    colorValues: { r: number; g: number; b: number },
    fingerResult: FingerDetectionResult
  ): number {
    if (!fingerResult.isDetected) return 0;
    
    // Calidad básica basada en la confianza de detección y características del color
    const confidenceScore = fingerResult.confidence * 40;
    const biophysicalScore = fingerResult.biophysicalScore * 30;
    const stabilityScore = fingerResult.stabilityScore * 30;
    
    return Math.min(100, confidenceScore + biophysicalScore + stabilityScore);
  }

  public getLastFingerDetectionResult(): FingerDetectionResult | null {
    return this.lastFingerResult;
  }

  public reset(): void {
    this.fingerDetector.reset();
    if (this.bufferManager.clear) {
      this.bufferManager.clear();
    }
    this.qualityAnalyzer.reset();
    this.lastFingerResult = null;
    console.log('🔄 PPGSignalProcessor reiniciado');
  }
}
