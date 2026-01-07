import { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { KalmanFilter } from './KalmanFilter';
import { SavitzkyGolayFilter } from './SavitzkyGolayFilter';
import { FrameProcessor } from './FrameProcessor';

/**
 * PROCESADOR PPG - MEDICIÓN REAL SIN SIMULACIONES
 * Solo procesa datos reales de la cámara
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  private kalmanFilter: KalmanFilter;
  private sgFilter: SavitzkyGolayFilter;
  private frameProcessor: FrameProcessor;
  
  // Buffer de señal para análisis
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90; // 3 segundos a 30fps
  
  // Estado de detección de dedo - ESTRICTO
  private fingerState = {
    isDetected: false,
    consecutiveValid: 0,
    consecutiveInvalid: 0,
    lastValidTime: 0,
    baselineRed: 0,
    baselineEstablished: false
  };
  
  // Configuración OPTIMIZADA para detección de dedo
  // Más permisiva para detectar dedos reales, pero estricta contra objetos
  private readonly CONFIG = {
    // Umbrales de color para dedo con flash encendido
    MIN_RED_VALUE: 60,           // Rojo mínimo - más permisivo
    MAX_RED_VALUE: 250,          // Máximo antes de saturación
    MIN_RED_RATIO: 0.38,         // Proporción R/(R+G+B) mínima - más permisivo
    MAX_GREEN_RATIO: 0.38,       // Proporción G máxima - más permisivo
    
    // Detección de pulso real
    MIN_VARIANCE: 0.2,           // Varianza mínima - más sensible
    MAX_VARIANCE: 80,            // Varianza máxima - más tolerante
    
    // Consistencia temporal - más rápida
    MIN_CONSECUTIVE_FOR_DETECTION: 5,   // 5 frames = ~0.17s
    MAX_CONSECUTIVE_FOR_LOSS: 8,        // 8 frames de pérdida = reset
    
    // Luminancia
    MIN_LUMINANCE: 35,           // Más permisivo para condiciones de luz
    MAX_LUMINANCE: 250
  };
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    console.log("🎯 PPGSignalProcessor: Inicializado - Modo MEDICIÓN REAL");
    
    this.kalmanFilter = new KalmanFilter();
    this.sgFilter = new SavitzkyGolayFilter();
    this.frameProcessor = new FrameProcessor({
      TEXTURE_GRID_SIZE: 16,
      ROI_SIZE_FACTOR: 0.85
    });
  }

  async initialize(): Promise<void> {
    this.signalBuffer = [];
    this.resetFingerState();
    this.kalmanFilter.reset();
    this.sgFilter.reset();
  }

  private resetFingerState(): void {
    this.fingerState = {
      isDetected: false,
      consecutiveValid: 0,
      consecutiveInvalid: 0,
      lastValidTime: 0,
      baselineRed: 0,
      baselineEstablished: false
    };
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
  }

  stop(): void {
    this.isProcessing = false;
    this.signalBuffer = [];
    this.resetFingerState();
  }

  async calibrate(): Promise<boolean> {
    await this.initialize();
    return true;
  }

  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    try {
      const timestamp = Date.now();
      
      // 1. Extraer datos de la imagen
      const frameData = this.frameProcessor.extractFrameData(imageData);
      const { redValue, avgRed = 0, avgGreen = 0, avgBlue = 0 } = frameData;
      
      // 2. Calcular proporciones de color
      const total = avgRed + avgGreen + avgBlue + 0.001;
      const redRatio = avgRed / total;
      const greenRatio = avgGreen / total;
      
      // 3. Calcular luminancia
      const luminance = 0.299 * avgRed + 0.587 * avgGreen + 0.114 * avgBlue;
      
      // 4. VALIDACIÓN ESTRICTA DE DEDO
      const isValidFinger = this.validateFingerPresence(
        avgRed, avgGreen, avgBlue,
        redRatio, greenRatio, luminance
      );
      
      // 5. Actualizar estado de detección con histéresis
      this.updateFingerDetectionState(isValidFinger, timestamp);
      
      // 6. Procesar señal solo si hay dedo detectado
      let filteredValue = 0;
      let quality = 0;
      
      if (this.fingerState.isDetected) {
        // Filtrar señal
        const kalmanFiltered = this.kalmanFilter.filter(redValue);
        filteredValue = this.sgFilter.filter(kalmanFiltered);
        
        // Agregar al buffer
        this.signalBuffer.push(filteredValue);
        if (this.signalBuffer.length > this.BUFFER_SIZE) {
          this.signalBuffer.shift();
        }
        
        // Calcular calidad basada en SNR real
        quality = this.calculateSignalQuality();
      } else {
        // Sin dedo = sin señal
        filteredValue = 0;
        quality = 0;
        this.signalBuffer = []; // Limpiar buffer
      }
      
      // 7. Construir señal procesada
      const roi = this.frameProcessor.detectROI(redValue, imageData);
      
      const processedSignal: ProcessedSignal = {
        timestamp,
        rawValue: this.fingerState.isDetected ? redValue : 0,
        filteredValue,
        quality,
        fingerDetected: this.fingerState.isDetected,
        roi,
        perfusionIndex: this.fingerState.isDetected ? this.calculatePerfusion() : 0
      };

      this.onSignalReady(processedSignal);

    } catch (error) {
      console.error("❌ Error procesando frame:", error);
    }
  }

  /**
   * Validación ESTRICTA de presencia de dedo
   * Un dedo cubriendo la cámara con flash tiene características muy específicas
   */
  private validateFingerPresence(
    red: number, green: number, blue: number,
    redRatio: number, greenRatio: number, luminance: number
  ): boolean {
    // Criterio 1: Rojo dominante (dedo + flash = mucho rojo)
    const isRedDominant = redRatio >= this.CONFIG.MIN_RED_RATIO;
    
    // Criterio 2: Verde bajo (piel absorbe verde)
    const isGreenLow = greenRatio <= this.CONFIG.MAX_GREEN_RATIO;
    
    // Criterio 3: Valor absoluto de rojo en rango
    const isRedInRange = red >= this.CONFIG.MIN_RED_VALUE && red <= this.CONFIG.MAX_RED_VALUE;
    
    // Criterio 4: Luminancia en rango (no saturado, no oscuro)
    const isLuminanceValid = luminance >= this.CONFIG.MIN_LUMINANCE && 
                            luminance <= this.CONFIG.MAX_LUMINANCE;
    
    // Criterio 5: Rojo > Verde > Azul (característica de piel iluminada)
    const isColorOrderValid = red > green && green > blue * 0.8;
    
    // Todos los criterios deben cumplirse
    return isRedDominant && isGreenLow && isRedInRange && isLuminanceValid && isColorOrderValid;
  }

  /**
   * Actualiza estado de detección con histéresis para evitar parpadeo
   */
  private updateFingerDetectionState(isValid: boolean, timestamp: number): void {
    if (isValid) {
      this.fingerState.consecutiveValid++;
      this.fingerState.consecutiveInvalid = 0;
      this.fingerState.lastValidTime = timestamp;
      
      // Requiere múltiples frames válidos para confirmar detección
      if (!this.fingerState.isDetected && 
          this.fingerState.consecutiveValid >= this.CONFIG.MIN_CONSECUTIVE_FOR_DETECTION) {
        this.fingerState.isDetected = true;
        console.log("✅ Dedo DETECTADO - Iniciando medición PPG");
      }
    } else {
      this.fingerState.consecutiveInvalid++;
      this.fingerState.consecutiveValid = 0;
      
      // Requiere múltiples frames inválidos para perder detección
      if (this.fingerState.isDetected && 
          this.fingerState.consecutiveInvalid >= this.CONFIG.MAX_CONSECUTIVE_FOR_LOSS) {
        this.fingerState.isDetected = false;
        this.signalBuffer = [];
        console.log("❌ Dedo PERDIDO - Deteniendo medición");
      }
    }
  }

  /**
   * Calcula calidad de señal basada en SNR real
   */
  private calculateSignalQuality(): number {
    if (this.signalBuffer.length < 15) return 0;
    
    const recent = this.signalBuffer.slice(-30);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / recent.length;
    
    // Verificar que hay varianza (señal viva)
    if (variance < this.CONFIG.MIN_VARIANCE) return 0;
    if (variance > this.CONFIG.MAX_VARIANCE) return Math.max(0, 100 - variance);
    
    // Amplitud pico a pico
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const amplitude = max - min;
    
    // SNR = amplitud / desviación estándar
    const snr = amplitude / (Math.sqrt(variance) + 0.001);
    
    // Convertir a porcentaje 0-100
    return Math.min(100, Math.max(0, snr * 15));
  }

  /**
   * Calcula índice de perfusión
   */
  private calculatePerfusion(): number {
    if (this.signalBuffer.length < 10) return 0;
    
    const recent = this.signalBuffer.slice(-20);
    const ac = Math.max(...recent) - Math.min(...recent);
    const dc = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    if (dc <= 0) return 0;
    
    return (ac / dc) * 100;
  }
}
