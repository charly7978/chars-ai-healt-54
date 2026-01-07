import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - CON VALIDACIÓN DE SANGRE REAL
 * 
 * La clave: la hemoglobina en la sangre absorbe luz VERDE y refleja LUZ ROJA.
 * Un dedo real sobre la cámara tiene:
 * - Ratio R/G > 1.5 (idealmente > 2.0)
 * - Canal rojo dominante (>50% del total RGB)
 * - Variación pulsátil en el rojo sincronizada con el latido
 * 
 * Sin estas características = NO HAY SANGRE = NO MEDIR
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private kalmanFilter: KalmanFilter;
  private sgFilter: SavitzkyGolayFilter;
  private frameProcessor: FrameProcessor;
  
  private readonly BUFFER_SIZE = 64;
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  
  // VALIDACIÓN DE SANGRE REAL - Umbrales científicos
  private readonly MIN_RG_RATIO = 1.4;        // Ratio R/G mínimo para considerar sangre
  private readonly MIN_RED_DOMINANCE = 0.45;  // Rojo debe ser >45% del RGB total
  private readonly MIN_RED_VALUE = 100;       // Valor mínimo de rojo (0-255)
  private readonly MAX_GREEN_VALUE = 200;     // Verde no debe saturar
  
  // Buffer para validación temporal (evitar falsos positivos por un solo frame)
  private validBloodFrames: number = 0;
  private readonly MIN_VALID_FRAMES = 5;      // Necesitamos 5 frames consistentes
  
  // Almacenar últimos valores RGB para diagnóstico
  private lastRGB = { r: 0, g: 0, b: 0, rgRatio: 0, redPercent: 0 };
  private frameCount: number = 0;
  
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
    this.validBloodFrames = 0;
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
   * VALIDAR SI LA SEÑAL PROVIENE DE SANGRE REAL
   * 
   * Criterios basados en la física de absorción de hemoglobina:
   * 1. La hemoglobina oxigenada (HbO2) absorbe fuertemente en verde (~540nm)
   * 2. La hemoglobina desoxigenada (Hb) absorbe en rojo (~660nm) pero menos
   * 3. Por esto, un dedo con sangre refleja MÁS ROJO que verde
   */
  private validateBloodSignal(r: number, g: number, b: number): boolean {
    // Calcular métricas
    const total = r + g + b;
    if (total < 50) return false; // Muy oscuro, no hay nada
    
    const rgRatio = g > 0 ? r / g : 0;
    const redPercent = total > 0 ? r / total : 0;
    
    // Guardar para diagnóstico
    this.lastRGB = { r, g, b, rgRatio, redPercent };
    
    // Log cada 90 frames (~3 segundos) para debug
    this.frameCount++;
    if (this.frameCount % 90 === 0) {
      console.log(`📊 Frame ${this.frameCount}: R=${r.toFixed(0)}, G=${g.toFixed(0)}, B=${b.toFixed(0)} | R/G=${rgRatio.toFixed(2)} | Red%=${(redPercent*100).toFixed(1)}%`);
    }
    
    // CRITERIOS DE SANGRE REAL:
    // 1. Ratio R/G debe ser > 1.4 (sangre absorbe verde)
    if (rgRatio < this.MIN_RG_RATIO) return false;
    
    // 2. Rojo debe dominar (>45% del total)
    if (redPercent < this.MIN_RED_DOMINANCE) return false;
    
    // 3. Valor de rojo debe ser significativo
    if (r < this.MIN_RED_VALUE) return false;
    
    // 4. Verde no debe estar saturado (indicaría luz ambiente, no sangre)
    if (g > this.MAX_GREEN_VALUE && rgRatio < 2.0) return false;
    
    return true;
  }

  /**
   * PROCESAR FRAME - Con validación de sangre real
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      const frameData = this.frameProcessor.extractFrameData(imageData);
      const { redValue, avgGreen, avgBlue } = frameData;
      const greenValue = avgGreen ?? 0;
      const blueValue = avgBlue ?? 0;
      
      // VALIDACIÓN CRÍTICA: ¿Es sangre real?
      const isBloodSignal = this.validateBloodSignal(redValue, greenValue, blueValue);
      
      if (isBloodSignal) {
        this.validBloodFrames = Math.min(this.validBloodFrames + 1, this.MIN_VALID_FRAMES + 10);
      } else {
        this.validBloodFrames = Math.max(0, this.validBloodFrames - 2); // Degradar más rápido
      }
      
      // Solo considerar "dedo detectado" si hay suficientes frames válidos consecutivos
      const hasConfirmedBlood = this.validBloodFrames >= this.MIN_VALID_FRAMES;
      
      // Filtrar señal
      let filteredValue = this.kalmanFilter.filter(redValue);
      filteredValue = this.sgFilter.filter(filteredValue);
      
      // Solo guardar en buffer si hay sangre confirmada
      if (hasConfirmedBlood) {
        this.signalBuffer[this.bufferIndex] = filteredValue;
        this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      }
      
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      const quality = hasConfirmedBlood ? this.calculateQuality(redValue, greenValue, blueValue) : 0;
      const perfusionIndex = hasConfirmedBlood ? this.calculatePerfusionIndex() : 0;
      
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: hasConfirmedBlood ? filteredValue : 0, // 0 si no hay sangre
        quality: quality,
        fingerDetected: hasConfirmedBlood, // AHORA SIGNIFICA "SANGRE DETECTADA"
        roi: roi,
        perfusionIndex: perfusionIndex,
        diagnostics: {
          message: `R:${redValue.toFixed(0)} G:${greenValue.toFixed(0)} B:${blueValue.toFixed(0)} | R/G:${this.lastRGB.rgRatio.toFixed(2)} | ${hasConfirmedBlood ? '✓ SANGRE' : '✗ SIN SANGRE'}`,
          hasPulsatility: hasConfirmedBlood && this.calculatePulsatility() > 0.003,
          pulsatilityValue: this.calculatePulsatility()
        }
      };

      this.onSignalReady(processedSignal);
    } catch (error) {
      // Silent error
    }
  }

  private calculateQuality(r: number, g: number, b: number): number {
    let score = 0;
    
    // Calidad basada en características de sangre
    const rgRatio = g > 0 ? r / g : 0;
    const total = r + g + b;
    const redPercent = total > 0 ? r / total : 0;
    
    // Mejor ratio R/G = mejor señal
    if (rgRatio > 3.0) score += 40;
    else if (rgRatio > 2.0) score += 30;
    else if (rgRatio > 1.5) score += 20;
    
    // Mayor dominancia de rojo = mejor
    if (redPercent > 0.7) score += 30;
    else if (redPercent > 0.6) score += 20;
    else if (redPercent > 0.5) score += 10;
    
    // Pulsatilidad
    const pulsatility = this.calculatePulsatility();
    if (pulsatility > 0.01) score += 30;
    else if (pulsatility > 0.005) score += 20;
    else if (pulsatility > 0.003) score += 10;
    
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
    this.validBloodFrames = 0;
    this.frameCount = 0;
  }

  getLastNSamples(n: number): number[] {
    const samples: number[] = [];
    for (let i = 0; i < Math.min(n, this.BUFFER_SIZE); i++) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      samples.unshift(this.signalBuffer[idx]);
    }
    return samples;
  }
  
  // Getter para diagnóstico externo
  getBloodValidationStatus(): { isValid: boolean; validFrames: number; rgb: typeof this.lastRGB } {
    return {
      isValid: this.validBloodFrames >= this.MIN_VALID_FRAMES,
      validFrames: this.validBloodFrames,
      rgb: this.lastRGB
    };
  }
}
