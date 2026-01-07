import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { FrameProcessor } from './FrameProcessor';
import { HumanFingerDetector } from './HumanFingerDetector';

/**
 * PROCESADOR PPG SIMPLIFICADO
 * 
 * La detección de dedo se hace ÚNICAMENTE en HumanFingerDetector.
 * Este procesador solo se encarga de:
 * 1. Extraer datos del frame
 * 2. Delegar detección al detector único
 * 3. Filtrar la señal si hay dedo
 * 4. Emitir señal procesada
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  // Componentes
  private kalmanFilter: KalmanFilter;
  private sgFilter: SavitzkyGolayFilter;
  private frameProcessor: FrameProcessor;
  private fingerDetector: HumanFingerDetector;
  
  // Buffer de señal
  private readonly BUFFER_SIZE = 64;
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🎯 PPGSignalProcessor: Inicializando (detector único)");
    
    this.signalBuffer = new Float32Array(this.BUFFER_SIZE);
    this.kalmanFilter = new KalmanFilter();
    this.sgFilter = new SavitzkyGolayFilter();
    this.frameProcessor = new FrameProcessor({
      TEXTURE_GRID_SIZE: 8,
      ROI_SIZE_FACTOR: 0.85
    });
    this.fingerDetector = new HumanFingerDetector();
  }

  async initialize(): Promise<void> {
    try {
      this.signalBuffer.fill(0);
      this.bufferIndex = 0;
      this.kalmanFilter.reset();
      this.sgFilter.reset();
      this.fingerDetector.reset();
      console.log("✅ PPGSignalProcessor: Inicializado");
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error inicialización", error);
      this.handleError("INIT_ERROR", "Error inicializando procesador");
    }
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log("🚀 PPGSignalProcessor: Iniciado");
  }

  stop(): void {
    this.isProcessing = false;
    console.log("⏹️ PPGSignalProcessor: Detenido");
  }

  async calibrate(): Promise<boolean> {
    await this.initialize();
    return true;
  }

  /**
   * PROCESAR FRAME DE VIDEO
   * La detección de dedo se delega 100% a HumanFingerDetector
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      // 1. Extraer datos RGB del frame
      const frameData = this.frameProcessor.extractFrameData(imageData);
      const { redValue, avgGreen, avgBlue } = frameData;
      const greenValue = avgGreen ?? 0;
      const blueValue = avgBlue ?? 0;
      
      // 2. DETECCIÓN DE DEDO - ÚNICO PUNTO EN TODA LA APP
      const detection = this.fingerDetector.detectFinger(
        redValue,
        greenValue,
        blueValue
      );
      
      // 3. Filtrar señal solo si hay dedo detectado
      let filteredValue = redValue;
      if (detection.isFingerDetected) {
        filteredValue = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(filteredValue);
      }
      
      // 4. Almacenar en buffer
      this.signalBuffer[this.bufferIndex] = filteredValue;
      this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      
      // 5. Calcular ROI
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      
      // 6. Calcular índice de perfusión
      const perfusionIndex = detection.isFingerDetected 
        ? this.calculatePerfusionIndex(redValue, detection.quality)
        : 0;
      
      // 7. Emitir señal procesada con diagnósticos completos
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: filteredValue,
        quality: detection.quality,
        fingerDetected: detection.isFingerDetected,
        roi: roi,
        perfusionIndex: perfusionIndex,
        diagnostics: {
          message: detection.diagnostics.message,
          hasPulsatility: detection.diagnostics.hasPulsatility,
          pulsatilityValue: detection.diagnostics.pulsatilityValue
        }
      };

      this.onSignalReady(processedSignal);
      
    } catch (error) {
      console.error("❌ PPGSignalProcessor: Error procesando frame", error);
      this.handleError("PROCESSING_ERROR", "Error en procesamiento");
    }
  }

  /**
   * Calcular índice de perfusión simple
   */
  private calculatePerfusionIndex(redValue: number, quality: number): number {
    if (quality < 30) return 0;
    
    // Usar los últimos valores del buffer para calcular AC/DC
    const validSamples: number[] = [];
    for (let i = 0; i < this.BUFFER_SIZE; i++) {
      if (this.signalBuffer[i] > 0) {
        validSamples.push(this.signalBuffer[i]);
      }
    }
    
    if (validSamples.length < 10) return 0;
    
    const recent = validSamples.slice(-20);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    if (mean === 0) return 0;
    
    // PI = (AC / DC) * 100
    const pi = ((max - min) / mean) * 100;
    
    return Math.min(20, Math.max(0, pi));
  }

  private handleError(code: string, message: string): void {
    if (this.onError) {
      this.onError({ code, message, timestamp: Date.now() });
    }
  }

  reset(): void {
    this.signalBuffer.fill(0);
    this.bufferIndex = 0;
    this.kalmanFilter.reset();
    this.sgFilter.reset();
    this.fingerDetector.reset();
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
