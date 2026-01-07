import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - SIN DETECCIÓN DE DEDO
 * Medición directa de señales PPG
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private kalmanFilter: KalmanFilter;
  private sgFilter: SavitzkyGolayFilter;
  private frameProcessor: FrameProcessor;
  
  private readonly BUFFER_SIZE = 64;
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.signalBuffer = new Float32Array(this.BUFFER_SIZE);
    this.kalmanFilter = new KalmanFilter();
    this.sgFilter = new SavitzkyGolayFilter();
    this.frameProcessor = new FrameProcessor({ TEXTURE_GRID_SIZE: 8, ROI_SIZE_FACTOR: 0.85 });
  }

  async initialize(): Promise<void> {
    this.signalBuffer.fill(0);
    this.bufferIndex = 0;
    this.kalmanFilter.reset();
    this.sgFilter.reset();
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.reset();
  }

  stop(): void {
    this.isProcessing = false;
    this.reset();
  }

  async calibrate(): Promise<boolean> {
    await this.initialize();
    return true;
  }

  /**
   * PROCESAR FRAME - SIN DETECCIÓN DE DEDO
   * fingerDetected siempre true para medición directa
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      const frameData = this.frameProcessor.extractFrameData(imageData);
      const { redValue, avgGreen, avgBlue } = frameData;
      const greenValue = avgGreen ?? 0;
      const blueValue = avgBlue ?? 0;
      
      // Filtrar señal directamente
      let filteredValue = this.kalmanFilter.filter(redValue);
      filteredValue = this.sgFilter.filter(filteredValue);
      
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      const quality = this.calculateQuality(redValue, greenValue, blueValue);
      const perfusionIndex = this.calculatePerfusionIndex();
      
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: filteredValue,
        quality: quality,
        fingerDetected: true, // SIEMPRE TRUE - Sin detección
        roi: roi,
        perfusionIndex: perfusionIndex,
        diagnostics: {
          message: `R:${redValue.toFixed(0)} G:${greenValue.toFixed(0)} B:${blueValue.toFixed(0)}`,
          hasPulsatility: true,
          pulsatilityValue: this.calculatePulsatility()
        }
      };

      this.onSignalReady(processedSignal);
    } catch (error) {
      // Silent error
    }
  }

  private calculateQuality(r: number, g: number, b: number): number {
    let score = 50;
    if (r > 80 && r < 220) score += 20;
    if (r > g && r > b) score += 15;
    if (this.calculatePulsatility() > 0.003) score += 15;
    return Math.min(100, score);
  }

  private calculatePulsatility(): number {
    const samples = this.getValidSamples();
    if (samples.length < 10) return 0;
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc === 0) return 0;
    return (Math.max(...samples) - Math.min(...samples)) / Math.abs(dc);
  }

  private calculatePerfusionIndex(): number {
    const samples = this.getValidSamples();
    if (samples.length < 10) return 0;
    const dc = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (dc === 0) return 0;
    return Math.min(20, ((Math.max(...samples) - Math.min(...samples)) / dc) * 100);
  }

  private getValidSamples(): number[] {
    const samples: number[] = [];
    for (let i = 0; i < this.BUFFER_SIZE; i++) {
      if (this.signalBuffer[i] > 0) samples.push(this.signalBuffer[i]);
    }
    return samples.slice(-20);
  }

  reset(): void {
    this.signalBuffer.fill(0);
    this.bufferIndex = 0;
    this.kalmanFilter.reset();
    this.sgFilter.reset();
    this.frameProcessor.reset();
  }

  getLastNSamples(n: number): number[] {
    const samples: number[] = [];
    for (let i = 0; i < Math.min(n, this.BUFFER_SIZE); i++) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      samples.unshift(this.signalBuffer[idx]);
    }
    return samples;
  }
}
