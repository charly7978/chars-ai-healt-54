import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';
import { CalibrationProfile } from '../calibration/CalibrationManager';

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
 * 
 * CON CALIBRACIÓN ADAPTATIVA:
 * - Umbrales ajustados según tono de piel y dispositivo del usuario
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
  
  // CALIBRACIÓN ADAPTATIVA
  private calibrationProfile: CalibrationProfile | null = null;
  private isCalibrated: boolean = false;
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    // Filtro pasabanda: 0.5-4Hz (30-240 BPM)
    this.bandpassFilter = new BandpassFilter(30);
  }

  /**
   * APLICAR PERFIL DE CALIBRACIÓN
   * Ajusta umbrales según características del usuario/dispositivo
   */
  setCalibrationProfile(profile: CalibrationProfile): void {
    this.calibrationProfile = profile;
    this.isCalibrated = true;
    console.log('✅ PPGSignalProcessor: Perfil de calibración aplicado', {
      rgRatioRange: `${profile.rgRatioMin.toFixed(2)}-${profile.rgRatioMax.toFixed(2)}`,
      fingerThreshold: profile.fingerDetectionThreshold.toFixed(0),
      confidence: `${profile.confidence}%`
    });
  }

  /**
   * Obtener estado de calibración
   */
  getCalibrationStatus(): { isCalibrated: boolean; profile: CalibrationProfile | null } {
    return { isCalibrated: this.isCalibrated, profile: this.calibrationProfile };
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
    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
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
   * DETECCIÓN DE DEDO CON CALIBRACIÓN ADAPTATIVA
   * Usa umbrales personalizados si hay calibración, o permisivos por defecto
   * Histéresis para evitar parpadeo (on/off rápido)
   */
  private lastFingerState: boolean = false;
  private fingerStateCounter: number = 0;
  private readonly FINGER_HYSTERESIS = 5; // Frames para cambiar estado
  
  private detectFinger(rawRed: number, rawGreen: number, rawBlue: number): boolean {
    // USAR UMBRALES DE CALIBRACIÓN O DEFAULTS PERMISIVOS
    let redMinThreshold = 30;
    let rgRatioMin = 0.7;
    let rgRatioMax = 4.0;
    
    if (this.calibrationProfile && this.isCalibrated) {
      // Umbrales personalizados de la calibración
      redMinThreshold = this.calibrationProfile.fingerDetectionThreshold;
      rgRatioMin = this.calibrationProfile.rgRatioMin;
      rgRatioMax = this.calibrationProfile.rgRatioMax;
    }
    
    const redMaxThreshold = 255;
    const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
    
    // Validar según umbrales (calibrados o por defecto)
    const validRatio = rgRatio > rgRatioMin && rgRatio < rgRatioMax;
    const validRed = rawRed > redMinThreshold && rawRed < redMaxThreshold;
    const notFullySaturated = rawRed < 254 || rawGreen < 254;
    
    // Condición base: señal presente
    const hasSignal = rawRed > Math.max(20, redMinThreshold * 0.6) && rawGreen > 15;
    const currentDetection = (validRatio && validRed && notFullySaturated) || (hasSignal && validRed);
    
    // HISTÉRESIS: evitar cambios rápidos de estado
    if (currentDetection === this.lastFingerState) {
      this.fingerStateCounter = 0;
      return this.lastFingerState;
    }
    
    // Cambio de estado requiere N frames consecutivos
    this.fingerStateCounter++;
    if (this.fingerStateCounter >= this.FINGER_HYSTERESIS) {
      this.lastFingerState = currentDetection;
      this.fingerStateCounter = 0;
    }
    
    return this.lastFingerState;
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
   * CALCULAR CALIDAD DE SEÑAL
   * Basado en variabilidad y pulsatilidad
   */
  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 30) return 0;
    if (!this.fingerDetected) return 0;
    
    const recent = this.filteredBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    // Rango mínimo para señal válida
    if (range < 0.5) return 10;
    
    // Calcular SNR aproximado
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    // SNR = señal/ruido, normalizar a 0-100
    const snr = range / (stdDev + 0.01);
    const quality = Math.min(100, Math.max(0, snr * 15));
    
    return quality;
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
    this.bandpassFilter.reset();
    // Reset histéresis
    this.lastFingerState = false;
    this.fingerStateCounter = 0;
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
