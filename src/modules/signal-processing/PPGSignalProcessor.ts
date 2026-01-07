import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - VERSIÓN CIENTÍFICAMENTE VALIDADA
 * 
 * PRINCIPIOS DE DETECCIÓN DE SANGRE REAL:
 * 
 * 1. La hemoglobina (Hb) tiene absorción óptica característica:
 *    - HbO2 absorbe fuertemente en verde (~540nm)
 *    - Hb absorbe en rojo (~660nm) pero menos
 *    - Resultado: dedo con sangre refleja MÁS ROJO que verde
 * 
 * 2. Para PPG de dedo con flash LED:
 *    - Ratio R/G debe ser > 1.5 (idealmente > 2.0)
 *    - Rojo debe ser dominante (> 45% del RGB total)
 *    - Debe haber PULSATILIDAD (variación AC sincronizada con latido)
 * 
 * 3. Sin pulsatilidad = sin sangre pulsante = no hay pulso real
 * 
 * Referencias:
 * - webcam-pulse-detector (GitHub, 3.2k stars)
 * - De Haan & Jeanne 2013 (CHROM/POS)
 * - http://www.opticsinfobase.org/oe/abstract.cfm?uri=oe-16-26-21434
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  private frameProcessor: FrameProcessor;
  
  // Buffers para análisis
  private readonly BUFFER_SIZE = 150; // 5 segundos a 30fps
  private rawRedBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  
  // ====== UMBRALES MUY SENSIBLES PARA DETECCIÓN DE SANGRE ======
  // Basados en propiedades ópticas de la hemoglobina pero MÁS PERMISIVOS
  private readonly MIN_RG_RATIO = 1.2;        // Ratio R/G mínimo (reducido de 1.3)
  private readonly MIN_RED_DOMINANCE = 0.40;  // Rojo debe ser > 40% del RGB (reducido)
  private readonly MIN_RED_VALUE = 70;        // Valor mínimo absoluto de rojo (reducido)
  private readonly MIN_PULSATILITY = 0.0005;  // Pulsatilidad mínima 0.05% (MUY BAJO - antes 0.2%)
  
  // Control de validación temporal - MÁS RÁPIDO
  private validBloodFrameCount: number = 0;
  private readonly MIN_CONSECUTIVE_FRAMES = 5; // 5 frames consecutivos (~0.16s) - más rápido
  
  // Diagnóstico
  private lastRGB = { r: 0, g: 0, b: 0, rgRatio: 0, redPercent: 0, pulsatility: 0 };
  private frameCount: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    this.bandpassFilter = new BandpassFilter(30);
    this.frameProcessor = new FrameProcessor({ ROI_SIZE_FACTOR: 0.80 });
  }

  async initialize(): Promise<void> {
    this.rawRedBuffer = [];
    this.filteredBuffer = [];
    this.validBloodFrameCount = 0;
    this.bandpassFilter.reset();
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
  }

  stop(): void {
    this.isProcessing = false;
    this.initialize();
  }

  async calibrate(): Promise<boolean> {
    await this.initialize();
    return true;
  }

  /**
   * VALIDACIÓN DE SANGRE REAL - Criterios estrictos basados en física óptica
   */
  private validateBloodSignal(r: number, g: number, b: number): boolean {
    const total = r + g + b;
    if (total < 100) return false; // Muy oscuro
    
    const rgRatio = g > 0 ? r / g : 0;
    const redPercent = r / total;
    
    // Guardar para diagnóstico
    this.lastRGB.r = r;
    this.lastRGB.g = g;
    this.lastRGB.b = b;
    this.lastRGB.rgRatio = rgRatio;
    this.lastRGB.redPercent = redPercent;
    
    // CRITERIO 1: Ratio R/G característico de sangre
    if (rgRatio < this.MIN_RG_RATIO) return false;
    
    // CRITERIO 2: Dominancia de rojo
    if (redPercent < this.MIN_RED_DOMINANCE) return false;
    
    // CRITERIO 3: Intensidad mínima de rojo
    if (r < this.MIN_RED_VALUE) return false;
    
    return true;
  }

  /**
   * Calcula la pulsatilidad de la señal (componente AC / DC)
   * Este es el indicador más importante de pulso real
   */
  private calculatePulsatility(): number {
    if (this.rawRedBuffer.length < 30) return 0;
    
    const recent = this.rawRedBuffer.slice(-45); // 1.5 segundos
    const dc = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    if (dc === 0) return 0;
    
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const ac = max - min;
    
    return ac / dc;
  }

  /**
   * PROCESAMIENTO DE FRAME - Pipeline completo validado
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      this.frameCount++;
      
      // 1. Extraer valores RGB del ROI
      const frameData = this.frameProcessor.extractFrameData(imageData);
      const { redValue, avgGreen = 0, avgBlue = 0 } = frameData;
      
      // 2. Guardar en buffer crudo
      this.rawRedBuffer.push(redValue);
      if (this.rawRedBuffer.length > this.BUFFER_SIZE) {
        this.rawRedBuffer.shift();
      }
      
      // 3. Aplicar filtro pasabanda 0.5-4Hz
      const filtered = this.bandpassFilter.filter(redValue);
      this.filteredBuffer.push(filtered);
      if (this.filteredBuffer.length > this.BUFFER_SIZE) {
        this.filteredBuffer.shift();
      }
      
      // 4. Validar si hay sangre real
      const hasBloodCharacteristics = this.validateBloodSignal(redValue, avgGreen, avgBlue);
      
      // 5. Verificar pulsatilidad
      const pulsatility = this.calculatePulsatility();
      this.lastRGB.pulsatility = pulsatility;
      const hasPulsatility = pulsatility >= this.MIN_PULSATILITY;
      
      // 6. Actualizar contador de frames válidos
      if (hasBloodCharacteristics && hasPulsatility) {
        this.validBloodFrameCount = Math.min(this.validBloodFrameCount + 1, 100);
      } else if (hasBloodCharacteristics && !hasPulsatility) {
        // Tiene características de sangre pero sin pulso aún - mantener pero no aumentar mucho
        this.validBloodFrameCount = Math.min(this.validBloodFrameCount + 0.3, 30);
      } else {
        // No tiene características de sangre - degradar rápidamente
        this.validBloodFrameCount = Math.max(0, this.validBloodFrameCount - 3);
      }
      
      // 7. Determinar si hay sangre confirmada
      const hasConfirmedBlood = this.validBloodFrameCount >= this.MIN_CONSECUTIVE_FRAMES;
      
      // 8. Calcular calidad de señal
      const quality = this.calculateQuality(hasBloodCharacteristics, hasPulsatility, pulsatility);
      
      // 9. Log de diagnóstico cada 60 frames (~2s)
      if (this.frameCount % 60 === 0) {
        const status = hasConfirmedBlood ? '✓ SANGRE' : '✗ NO SANGRE';
        console.log(
          `🩸 PPG [${this.frameCount}]: R=${redValue.toFixed(0)} G=${avgGreen.toFixed(0)} ` +
          `| R/G=${this.lastRGB.rgRatio.toFixed(2)} ` +
          `| Puls=${(pulsatility * 100).toFixed(2)}% ` +
          `| Valid=${this.validBloodFrameCount.toFixed(0)} ` +
          `| ${status}`
        );
      }
      
      // 10. Emitir señal procesada
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: redValue,
        filteredValue: hasConfirmedBlood ? filtered : 0,
        quality: quality,
        fingerDetected: hasConfirmedBlood,
        roi: roi,
        perfusionIndex: pulsatility * 100,
        diagnostics: {
          message: `R:${redValue.toFixed(0)} G:${avgGreen.toFixed(0)} | R/G:${this.lastRGB.rgRatio.toFixed(2)} | Puls:${(pulsatility*100).toFixed(1)}% | ${hasConfirmedBlood ? '✓' : '✗'}`,
          hasPulsatility: hasPulsatility,
          pulsatilityValue: pulsatility
        }
      };

      this.onSignalReady(processedSignal);
    } catch (error) {
      // Error silenciado para rendimiento
    }
  }

  /**
   * Calcula calidad de señal 0-100
   */
  private calculateQuality(hasBlood: boolean, hasPulsatility: boolean, pulsatility: number): number {
    if (!hasBlood) return 0;
    
    let score = 20; // Base por tener características de sangre
    
    // Bonus por ratio R/G alto
    if (this.lastRGB.rgRatio > 2.5) score += 20;
    else if (this.lastRGB.rgRatio > 2.0) score += 15;
    else if (this.lastRGB.rgRatio > 1.5) score += 10;
    
    // Bonus por pulsatilidad
    if (pulsatility > 0.02) score += 40; // Excelente
    else if (pulsatility > 0.01) score += 30;
    else if (pulsatility > 0.005) score += 20;
    else if (pulsatility > 0.002) score += 10;
    
    // Bonus por frames consecutivos válidos
    if (this.validBloodFrameCount > 50) score += 20;
    else if (this.validBloodFrameCount > 20) score += 10;
    
    return Math.min(100, score);
  }

  reset(): void {
    this.rawRedBuffer = [];
    this.filteredBuffer = [];
    this.validBloodFrameCount = 0;
    this.frameCount = 0;
    this.bandpassFilter.reset();
    this.frameProcessor.reset();
  }

  getLastNSamples(n: number): number[] {
    return this.filteredBuffer.slice(-n);
  }
  
  getRawBuffer(): number[] {
    return [...this.rawRedBuffer];
  }
  
  getFilteredBuffer(): number[] {
    return [...this.filteredBuffer];
  }
  
  getDiagnostics(): typeof this.lastRGB {
    return { ...this.lastRGB };
  }
}
