import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

/**
 * PROCESADOR PPG OPTIMIZADO - CANAL VERDE COMO FUENTE PRINCIPAL
 * 
 * ARQUITECTURA LIMPIA:
 * Frame → RGB → Canal VERDE (mejor SNR) → Inversión → Filtro Pasabanda → Señal
 * 
 * FUNDAMENTO CIENTÍFICO:
 * - El canal verde (540nm) tiene mejor penetración en tejido y mayor absorción por sangre
 * - Mejor relación señal/ruido que el rojo en condiciones de flash intenso
 * - Referencia: De Haan & Jeanne 2013, webcam-pulse-detector
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  
  // Buffers
  private readonly BUFFER_SIZE = 150; // 5 segundos @ 30fps
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  
  // Estadísticas para SpO2
  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;
  
  // Control de logging
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  
  // Detección de dedo
  private fingerDetected: boolean = false;
  private signalQuality: number = 0;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    // Filtro pasabanda: 0.5-4Hz (30-240 BPM)
    this.bandpassFilter = new BandpassFilter(30);
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor inicializado - Canal Verde como fuente principal');
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    console.log('🚀 PPGSignalProcessor iniciado');
  }

  stop(): void {
    this.isProcessing = false;
    console.log('🛑 PPGSignalProcessor detenido');
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  /**
   * PROCESAR FRAME - FLUJO ÚNICO Y LIMPIO
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. EXTRAER RGB DE ROI CENTRAL (60% del área)
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // 2. GUARDAR EN BUFFERS PARA CÁLCULO DE AC/DC
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
    
    // 3. DETECCIÓN DE DEDO - Basado en características RGB
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue);
    
    // 4. CALCULAR ESTADÍSTICAS AC/DC (para SpO2)
    if (this.redBuffer.length >= 30) {
      this.calculateACDC();
    }
    
    // 5. SELECCIONAR CANAL PRINCIPAL: VERDE
    // El canal verde tiene mejor SNR y menos saturación con flash
    // Solo usamos rojo como fallback si verde está saturado
    const greenSaturated = rawGreen > 250;
    const signalSource = greenSaturated ? rawRed : rawGreen;
    
    // 6. INVERTIR SEÑAL: más sangre = menos luz reflejada
    // Invertimos para que los picos sistólicos sean positivos
    const inverted = 255 - signalSource;
    
    // 7. GUARDAR EN BUFFER RAW
    this.rawBuffer.push(inverted);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // 8. FILTRO PASABANDA (0.5-4 Hz)
    const filtered = this.bandpassFilter.filter(inverted);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 9. CALCULAR CALIDAD DE SEÑAL
    this.signalQuality = this.calculateSignalQuality();
    
    // 10. LOG CADA SEGUNDO
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const src = greenSaturated ? 'R' : 'G';
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      console.log(`📷 PPG [${src}]: Raw=${signalSource.toFixed(0)} Inv=${inverted.toFixed(0)} Filt=${filtered.toFixed(2)} Q=${this.signalQuality.toFixed(0)}% ${fingerStatus}`);
    }
    
    // 11. CALCULAR ÍNDICE DE PERFUSIÓN
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // 12. EMITIR SEÑAL PROCESADA
    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: inverted,
      filteredValue: filtered,
      quality: this.signalQuality,
      fingerDetected: this.fingerDetected,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message: `${greenSaturated ? 'R' : 'G'}:${signalSource.toFixed(0)} PI:${perfusionIndex.toFixed(2)}`,
        hasPulsatility: perfusionIndex > 0.1,
        pulsatilityValue: perfusionIndex
      }
    };

    this.onSignalReady(processedSignal);
  }
  
  /**
   * EXTRAER RGB DE REGIÓN AMPLIA
   * ROI del 85% para captura más fácil y cómoda
   */
  private extractROI(imageData: ImageData): { rawRed: number; rawGreen: number; rawBlue: number } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // ROI amplia - 85% del área para mayor comodidad de uso
    const roiSize = Math.min(width, height) * 0.95;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let count = 0;
    
    // Muestrear cada 4 píxeles para velocidad con ROI más grande
    for (let y = startY; y < endY; y += 6) {
      for (let x = startX; x < endX; x += 6) {
        const i = (y * width + x) * 4;
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        count++;
      }
    }
    
    return {
      rawRed: count > 0 ? redSum / count : 0,
      rawGreen: count > 0 ? greenSum / count : 0,
      rawBlue: count > 0 ? blueSum / count : 0
    };
  }
  
  /**
   * DETECCIÓN DE DEDO ULTRA-ROBUSTA Y ESTABLE
   * Evita cortes y fluctuaciones - prioriza continuidad
   */
  private fingerConfidence: number = 0;
  private consecutiveFingerFrames: number = 0;
  private consecutiveNoFingerFrames: number = 0;
  
  private detectFinger(rawRed: number, rawGreen: number, rawBlue: number): boolean {
    // Umbrales muy permisivos para máxima comodidad
    const redMinThreshold = 25;  // Muy bajo para aceptar más casos
    const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
    
    // Criterios básicos muy amplios
    const hasRedSignal = rawRed > redMinThreshold;
    const hasLight = rawRed > 15 && rawGreen > 10;
    const ratioOK = rgRatio > 0.5 && rgRatio < 5.0; // Rango muy amplio
    const notFullySaturated = rawRed < 254 && rawGreen < 254;
    
    // Detección instantánea
    const instantDetected = (hasRedSignal && ratioOK && notFullySaturated) || 
                           (hasLight && hasRedSignal);
    
    // Sistema de histéresis para evitar cortes
    if (instantDetected) {
      this.consecutiveFingerFrames++;
      this.consecutiveNoFingerFrames = 0;
      
      // Subir confianza gradualmente
      this.fingerConfidence = Math.min(1, this.fingerConfidence + 0.1);
    } else {
      this.consecutiveNoFingerFrames++;
      
      // Solo bajar confianza después de varios frames sin dedo
      if (this.consecutiveNoFingerFrames > 15) { // ~0.5 segundos de tolerancia
        this.fingerConfidence = Math.max(0, this.fingerConfidence - 0.05);
        this.consecutiveFingerFrames = 0;
      }
    }
    
    // Considerar dedo presente si confianza > 0.3 (histéresis)
    // Una vez detectado, necesita mucho tiempo sin señal para perderlo
    if (this.fingerConfidence > 0.3) {
      return true;
    }
    
    // Si acaba de empezar y tiene señal instantánea, aceptar
    if (instantDetected && this.consecutiveFingerFrames >= 3) {
      this.fingerConfidence = 0.5;
      return true;
    }
    
    return false;
  }
  
  /**
   * CALCULAR ESTADÍSTICAS AC/DC PARA SpO2
   */
  private calculateACDC(): void {
    if (this.redBuffer.length < 30 || this.greenBuffer.length < 30) return;
    
    const recent = 60; // Últimos 2 segundos
    const redRecent = this.redBuffer.slice(-recent);
    const greenRecent = this.greenBuffer.slice(-recent);
    
    // DC = promedio (componente continua)
    this.redDC = redRecent.reduce((a, b) => a + b, 0) / redRecent.length;
    this.greenDC = greenRecent.reduce((a, b) => a + b, 0) / greenRecent.length;
    
    // AC = amplitud pico a pico (componente pulsátil)
    this.redAC = Math.max(...redRecent) - Math.min(...redRecent);
    this.greenAC = Math.max(...greenRecent) - Math.min(...greenRecent);
  }
  
  /**
   * CALCULAR CALIDAD DE SEÑAL - VERSIÓN ESTABLE Y ROBUSTA
   * Mantiene calidad alta si hay señal presente con suavizado
   */
  private smoothedQuality: number = 0;
  
  private calculateSignalQuality(): number {
    // Si no hay suficiente buffer, calidad inicial moderada
    if (this.filteredBuffer.length < 15) {
      return this.fingerDetected ? 60 : 0;
    }
    
    // Si no hay dedo, calidad baja pero no cero inmediatamente
    if (!this.fingerDetected) {
      // Decay gradual para evitar cortes bruscos
      this.smoothedQuality = Math.max(0, this.smoothedQuality * 0.9);
      return Math.round(this.smoothedQuality);
    }
    
    const recent = this.filteredBuffer.slice(-45); // 1.5 segundos
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    // Calcular calidad objetivo basada en métricas
    let targetQuality: number;
    
    if (range < 0.3) {
      // Señal muy plana pero dedo presente
      targetQuality = 55;
    } else if (range < 1) {
      // Señal débil
      targetQuality = 70;
    } else if (range < 5) {
      // Señal buena
      targetQuality = 85;
    } else if (range < 20) {
      // Señal excelente
      targetQuality = 95;
    } else {
      // Señal muy fuerte (normal con flash)
      targetQuality = 90;
    }
    
    // Bonus por perfusión
    const perfusion = this.calculatePerfusionIndex();
    if (perfusion > 0.5) targetQuality = Math.min(100, targetQuality + 5);
    
    // Suavizado exponencial fuerte para estabilidad
    // Alpha bajo = más estable, menos saltos
    const alpha = 0.08;
    this.smoothedQuality = alpha * targetQuality + (1 - alpha) * this.smoothedQuality;
    
    // Inicialización rápida si empezamos de cero
    if (this.smoothedQuality < 30 && targetQuality > 60) {
      this.smoothedQuality = Math.max(this.smoothedQuality, 50);
    }
    
    return Math.round(Math.max(20, this.smoothedQuality));
  }
  
  /**
   * ÍNDICE DE PERFUSIÓN: AC/DC * 100
   * Indica la fuerza del pulso
   */
  private calculatePerfusionIndex(): number {
    if (this.greenDC === 0) return 0;
    // Usar canal verde ya que es nuestra fuente principal
    return (this.greenAC / this.greenDC) * 100;
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.fingerDetected = false;
    this.signalQuality = 0;
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.smoothedQuality = 0;
    this.fingerConfidence = 0;
    this.consecutiveFingerFrames = 0;
    this.consecutiveNoFingerFrames = 0;
    this.bandpassFilter.reset();
  }

  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0
    };
  }

  getLastNSamples(n: number): number[] {
    return this.filteredBuffer.slice(-n);
  }
  
  getRawBuffer(): number[] {
    return [...this.rawBuffer];
  }
  
  getFilteredBuffer(): number[] {
    return [...this.filteredBuffer];
  }
}
