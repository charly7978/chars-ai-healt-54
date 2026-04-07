import type { ProcessedSignal, ProcessingError, SignalProcessor as SignalProcessorInterface } from '../../types/signal';
import { BandpassFilter } from './BandpassFilter';

/**
 * PROCESADOR PPG OPTIMIZADO - CON DERIVADAS VPG/APG
 * 
 * MEJORAS:
 * 1. Cálculo de AC/DC con ventana de 3-4 segundos
 * 2. Primera derivada (VPG) para detección de picos
 * 3. Segunda derivada (APG) para análisis morfológico
 * 4. Exportación de estadísticas RGB precisas
 * 
 * Referencia: De Haan & Jeanne 2013, Elgendi 2012
 */
export class PPGSignalProcessor implements SignalProcessorInterface {
  public isProcessing: boolean = false;
  
  private bandpassFilter: BandpassFilter;
  
  // Buffers ampliados
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  private readonly ACDC_WINDOW = 120; // 4 segundos para AC/DC
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private vpgBuffer: number[] = []; // Primera derivada
  private apgBuffer: number[] = []; // Segunda derivada
  
  // Estadísticas para SpO2 - calculadas con ventana más larga
  private redDC: number = 0;
  private redAC: number = 0;
  private greenDC: number = 0;
  private greenAC: number = 0;
  
  // Control de logging
  private frameCount: number = 0;
  private lastLogTime: number = 0;
  
  // Detección de dedo con histéresis - MÁS TOLERANTE
  private fingerDetected: boolean = false;
  private signalQuality: number = 0;
  private fingerConfidenceCount: number = 0;
  private fingerLostCount: number = 0;
  private readonly FINGER_CONFIRM_FRAMES = 3;   // Detección más rápida para comodidad
  private readonly FINGER_LOST_FRAMES = 30;     // ~1 segundo tolerancia a temblores/reposición
  private smoothedRed: number = 0;
  private smoothedGreen: number = 0;
  private smoothedBlue: number = 0;
  private readonly RGB_SMOOTH_ALPHA = 0.18;     // Más estabilidad ante pequeños movimientos
  
  // IMU - Rechazo de movimiento
  private motionScore: number = 0;
  private motionListenerActive: boolean = false;
  private lastAcceleration: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private readonly MOTION_THRESHOLD = 0.35; // RMS threshold
  
  constructor(
    public onSignalReady?: (signal: ProcessedSignal) => void,
    public onError?: (error: ProcessingError) => void
  ) {
    // Filtro pasabanda: 0.5-4Hz (30-240 BPM)
    this.bandpassFilter = new BandpassFilter(30);
  }

  async initialize(): Promise<void> {
    this.reset();
    console.log('✅ PPGSignalProcessor inicializado - Con VPG/APG');
  }

  start(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.initialize();
    this.startMotionListener();
    console.log('🚀 PPGSignalProcessor iniciado');
  }

  stop(): void {
    this.isProcessing = false;
    this.stopMotionListener();
    console.log('🛑 PPGSignalProcessor detenido');
  }

  async calibrate(): Promise<boolean> {
    return true;
  }

  /**
   * PROCESAR FRAME - CON CÁLCULO DE DERIVADAS
   */
  processFrame(imageData: ImageData): void {
    if (!this.isProcessing || !this.onSignalReady) return;

    this.frameCount++;
    const timestamp = Date.now();
    
    // 1. EXTRAER RGB DE ROI CENTRAL (85% del área)
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // 2. GUARDAR EN BUFFERS
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
    }
    
    // 3. DETECCIÓN DE DEDO
    this.fingerDetected = this.detectFinger(rawRed, rawGreen, rawBlue);
    
    // 4. CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS
    if (this.redBuffer.length >= 60) {
      this.calculateACDCPrecise();
    }
    
    // 5. SELECCIONAR CANAL VERDE
    const greenSaturated = rawGreen > 250;
    const signalSource = greenSaturated ? rawRed : rawGreen;
    
    // 6. INVERTIR SEÑAL
    const inverted = 255 - signalSource;
    
    // 7. GUARDAR EN BUFFER RAW
    this.rawBuffer.push(inverted);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    // 8. FILTRO PASABANDA
    const filtered = this.bandpassFilter.filter(inverted);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 9. CALCULAR DERIVADAS
    this.calculateDerivatives();
    
    // 10. CALCULAR CALIDAD DE SEÑAL
    this.signalQuality = this.calculateSignalQuality();
    
    // 11. LOG CADA SEGUNDO
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      const src = greenSaturated ? 'R' : 'G';
      const fingerStatus = this.fingerDetected ? '✅' : '❌';
      console.log(`📷 PPG [${src}]: Raw=${signalSource.toFixed(0)} Filt=${filtered.toFixed(2)} Q=${this.signalQuality.toFixed(0)}% AC_R=${this.redAC.toFixed(1)} AC_G=${this.greenAC.toFixed(1)} ${fingerStatus}`);
    }
    
    // 12. CALCULAR ÍNDICE DE PERFUSIÓN
    const perfusionIndex = this.calculatePerfusionIndex();
    
    // 13. EMITIR SEÑAL PROCESADA
    const motionArtifact = this.motionScore > this.MOTION_THRESHOLD;
    const adjustedQuality = motionArtifact 
      ? Math.max(0, this.signalQuality * 0.5) 
      : this.signalQuality;

    const processedSignal: ProcessedSignal = {
      timestamp,
      rawValue: inverted,
      filteredValue: filtered,
      quality: adjustedQuality,
      fingerDetected: this.fingerDetected,
      motionArtifact,
      roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
      perfusionIndex,
      rawRed,
      rawGreen,
      diagnostics: {
        message: `${greenSaturated ? 'R' : 'G'}:${signalSource.toFixed(0)} PI:${perfusionIndex.toFixed(2)}${motionArtifact ? ' MOV' : ''}`,
        hasPulsatility: perfusionIndex > 0.1,
        pulsatilityValue: perfusionIndex
      }
    };

    this.onSignalReady(processedSignal);
  }
  
  /**
   * EXTRAER RGB DE REGIÓN AMPLIA (85%)
   */
  private extractROI(imageData: ImageData): { rawRed: number; rawGreen: number; rawBlue: number } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // ROI amplia - 85% del área
    const roiSize = Math.min(width, height) * 0.85;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    const tileColumns = 3;
    const tileRows = 3;
    const tiles = Array.from({ length: tileColumns * tileRows }, () => ({
      red: 0,
      green: 0,
      blue: 0,
      count: 0,
    }));
    const roiWidth = Math.max(1, endX - startX);
    const roiHeight = Math.max(1, endY - startY);
    
    // Muestrear cada 4 píxeles y usar medias robustas por subregión
    for (let y = startY; y < endY; y += 4) {
      for (let x = startX; x < endX; x += 4) {
        const i = (y * width + x) * 4;
        const tileX = Math.min(tileColumns - 1, Math.floor(((x - startX) / roiWidth) * tileColumns));
        const tileY = Math.min(tileRows - 1, Math.floor(((y - startY) / roiHeight) * tileRows));
        const tile = tiles[tileY * tileColumns + tileX];

        tile.red += data[i];
        tile.green += data[i + 1];
        tile.blue += data[i + 2];
        tile.count++;
      }
    }

    const robustAverage = (channel: 'red' | 'green' | 'blue') => {
      const values = tiles
        .filter(tile => tile.count > 0)
        .map(tile => tile[channel] / tile.count)
        .sort((a, b) => a - b);

      if (values.length === 0) return 0;
      if (values.length <= 3) {
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      }

      const trimmed = values.slice(1, -1);
      return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
    };
    
    return {
      rawRed: robustAverage('red'),
      rawGreen: robustAverage('green'),
      rawBlue: robustAverage('blue')
    };
  }
  
  /**
   * DETECCIÓN DE DEDO CON HISTÉRESIS Y SUAVIZADO
   * 
   * - Suaviza valores RGB para tolerar temblores/micromovimientos
   * - Usa histéresis: requiere varios frames consecutivos para cambiar estado
   * - Umbrales más permisivos para comodidad del usuario
   */
  private detectFinger(rawRed: number, rawGreen: number, rawBlue: number): boolean {
    // Suavizar RGB para absorber temblores y micromovimientos
    if (this.smoothedRed === 0) {
      this.smoothedRed = rawRed;
      this.smoothedGreen = rawGreen;
      this.smoothedBlue = rawBlue;
    } else {
      this.smoothedRed = this.smoothedRed * (1 - this.RGB_SMOOTH_ALPHA) + rawRed * this.RGB_SMOOTH_ALPHA;
      this.smoothedGreen = this.smoothedGreen * (1 - this.RGB_SMOOTH_ALPHA) + rawGreen * this.RGB_SMOOTH_ALPHA;
      this.smoothedBlue = this.smoothedBlue * (1 - this.RGB_SMOOTH_ALPHA) + rawBlue * this.RGB_SMOOTH_ALPHA;
    }
    
    const r = this.smoothedRed;
    const g = this.smoothedGreen;
    const b = this.smoothedBlue;

    const rgRatio = g > 0 ? r / g : 0;
    const rbRatio = b > 0 ? r / b : 0;
    const totalIntensity = r + g + b;
    const colorDominance = totalIntensity > 0 ? (r - ((g + b) / 2)) / totalIntensity : 0;
    const notBlownOut = !(r > 254.8 && g > 254.8 && b > 254.8);

    let detectionScore = 0;
    if (r > 34) detectionScore += 1;
    if (rgRatio > 0.72 && rgRatio < 4.2) detectionScore += 1;
    if (rbRatio > 1.12) detectionScore += 1;
    if (totalIntensity > 75 && totalIntensity < 720) detectionScore += 1;
    if (colorDominance > 0.1) detectionScore += 1;

    const requiredScore = this.fingerDetected ? 2 : 3;
    const instantDetected = notBlownOut && detectionScore >= requiredScore;
    
    // HISTÉRESIS: evitar parpadeo del estado
    if (instantDetected) {
      this.fingerLostCount = 0;
      this.fingerConfidenceCount = Math.min(this.fingerConfidenceCount + 1, this.FINGER_CONFIRM_FRAMES + 5);
      
      // Si ya estaba detectado, mantener. Si no, esperar confirmación
      if (this.fingerDetected) {
        return true;
      } else {
        return this.fingerConfidenceCount >= this.FINGER_CONFIRM_FRAMES;
      }
    } else {
      this.fingerConfidenceCount = Math.max(0, this.fingerConfidenceCount - 1);
      this.fingerLostCount++;
      
      // Si estaba detectado, tolerar pérdidas breves (temblor/reposición)
      if (this.fingerDetected) {
        return this.fingerLostCount < this.FINGER_LOST_FRAMES;
      }
      return false;
    }
  }
  
  /**
   * CALCULAR AC/DC CON VENTANA DE 4 SEGUNDOS - MÉTODO PROFESIONAL
   * 
   * Basado en Texas Instruments SLAA655:
   * - DC = promedio (componente no pulsátil)
   * - AC = RMS de la componente pulsátil (más preciso que pico-a-pico)
   * 
   * Para SpO2: R = (AC_red/DC_red) / (AC_green/DC_green)
   */
  private calculateACDCPrecise(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    if (windowSize < 60) return;
    
    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);
    
    // DC = promedio (componente continua / no pulsátil)
    this.redDC = redWindow.reduce((a, b) => a + b, 0) / redWindow.length;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / greenWindow.length;
    
    // Protección contra DC muy bajo
    if (this.redDC < 5 || this.greenDC < 5) return;
    
    // === MÉTODO 1: RMS de la señal centrada ===
    // RMS = sqrt(sum((x - mean)^2) / n)
    let redSumSq = 0;
    let greenSumSq = 0;
    
    for (let i = 0; i < windowSize; i++) {
      redSumSq += Math.pow(redWindow[i] - this.redDC, 2);
      greenSumSq += Math.pow(greenWindow[i] - this.greenDC, 2);
    }
    
    const redRMS = Math.sqrt(redSumSq / windowSize);
    const greenRMS = Math.sqrt(greenSumSq / windowSize);
    
    // === MÉTODO 2: Pico a pico con filtrado de outliers ===
    // Ordenar y usar percentiles para evitar ruido extremo
    const sortedRed = [...redWindow].sort((a, b) => a - b);
    const sortedGreen = [...greenWindow].sort((a, b) => a - b);
    
    const p5 = Math.floor(windowSize * 0.05);
    const p95 = Math.floor(windowSize * 0.95);
    
    const redP2P = sortedRed[p95] - sortedRed[p5];
    const greenP2P = sortedGreen[p95] - sortedGreen[p5];
    
    // === FUSIÓN: Usar RMS como base, pico-a-pico como validación ===
    // AC_rms * sqrt(2) ≈ amplitud pico para señal sinusoidal
    const redACFromRMS = redRMS * Math.sqrt(2);
    const greenACFromRMS = greenRMS * Math.sqrt(2);
    
    // Promediar ambos métodos para robustez
    this.redAC = (redACFromRMS + redP2P * 0.5) / 2;
    this.greenAC = (greenACFromRMS + greenP2P * 0.5) / 2;
    
    // Validación: Si AC es muy pequeño relativo a DC, señal débil
    const redPI = this.redAC / this.redDC;
    const greenPI = this.greenAC / this.greenDC;
    
    // Perfusion Index típico: 0.1% - 20%
    if (redPI < 0.001 || greenPI < 0.001) {
      // Señal muy débil, puede ser ruido
      this.redAC = 0;
      this.greenAC = 0;
    }
  }
  
  /**
   * CALCULAR DERIVADAS VPG y APG
   */
  private calculateDerivatives(): void {
    const n = this.filteredBuffer.length;
    
    if (n >= 3) {
      // VPG: Primera derivada (velocidad)
      // f'(x) = (f(x+1) - f(x-1)) / 2
      const vpg = (this.filteredBuffer[n-1] - this.filteredBuffer[n-3]) / 2;
      this.vpgBuffer.push(vpg);
      if (this.vpgBuffer.length > this.BUFFER_SIZE) {
        this.vpgBuffer.shift();
      }
    }
    
    if (this.vpgBuffer.length >= 3) {
      // APG: Segunda derivada (aceleración)
      const vn = this.vpgBuffer.length;
      const apg = (this.vpgBuffer[vn-1] - this.vpgBuffer[vn-3]) / 2;
      this.apgBuffer.push(apg);
      if (this.apgBuffer.length > this.BUFFER_SIZE) {
        this.apgBuffer.shift();
      }
    }
  }
  
  /**
   * CALCULAR CALIDAD DE SEÑAL
   */
  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 30) return 0;
    if (!this.fingerDetected) return 0;
    
    const recent = this.filteredBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    if (range < 0.5) return 10;
    
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    const snr = range / (stdDev + 0.01);
    const quality = Math.min(100, Math.max(0, snr * 15));
    
    return quality;
  }
  
  /**
   * ÍNDICE DE PERFUSIÓN: AC/DC * 100
   */
  private calculatePerfusionIndex(): number {
    if (this.greenDC === 0) return 0;
    return (this.greenAC / this.greenDC) * 100;
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.vpgBuffer = [];
    this.apgBuffer = [];
    this.frameCount = 0;
    this.lastLogTime = 0;
    this.fingerDetected = false;
    this.signalQuality = 0;
    this.fingerConfidenceCount = 0;
    this.fingerLostCount = 0;
    this.smoothedRed = 0;
    this.smoothedGreen = 0;
    this.smoothedBlue = 0;
    this.redDC = 0;
    this.redAC = 0;
    this.greenDC = 0;
    this.greenAC = 0;
    this.bandpassFilter.reset();
    this.motionScore = 0;
  }

  // ─── IMU MOTION REJECTION ───
  
  private handleMotionEvent = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
    
    // Calcular delta de aceleración (movimiento relativo)
    const dx = (acc.x ?? 0) - this.lastAcceleration.x;
    const dy = (acc.y ?? 0) - this.lastAcceleration.y;
    const dz = (acc.z ?? 0) - this.lastAcceleration.z;
    
    this.lastAcceleration = { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 };
    
    // RMS del delta (mide cambio, no gravedad estática)
    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Incorporar rotación si disponible
    const rot = event.rotationRate;
    let gyroRMS = 0;
    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      gyroRMS = Math.sqrt(
        (rot.alpha ?? 0) ** 2 + (rot.beta ?? 0) ** 2 + (rot.gamma ?? 0) ** 2
      ) / 100; // Normalizar grados/s
    }
    
    // Combinar: 60% aceleración, 40% giro
    const rawScore = accelRMS * 0.6 + gyroRMS * 0.4;
    
    // EMA para suavizar
    this.motionScore = this.motionScore * 0.7 + rawScore * 0.3;
  };
  
  private startMotionListener(): void {
    if (this.motionListenerActive) return;
    
    try {
      if (typeof DeviceMotionEvent !== 'undefined') {
        // iOS 13+ requires permission
        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
          (DeviceMotionEvent as any).requestPermission()
            .then((state: string) => {
              if (state === 'granted') {
                window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
                this.motionListenerActive = true;
                console.log('📱 IMU activado (iOS)');
              }
            })
            .catch(() => console.warn('⚠️ IMU: permiso denegado'));
        } else {
          window.addEventListener('devicemotion', this.handleMotionEvent, { passive: true });
          this.motionListenerActive = true;
          console.log('📱 IMU activado');
        }
      }
    } catch (e) {
      console.warn('⚠️ IMU no disponible:', e);
    }
  }
  
  private stopMotionListener(): void {
    if (!this.motionListenerActive) return;
    window.removeEventListener('devicemotion', this.handleMotionEvent);
    this.motionListenerActive = false;
    this.motionScore = 0;
  }

  /**
   * OBTENER ESTADÍSTICAS RGB PRECISAS
   * Para uso en cálculo de SpO2
   */
  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      rgRatio: this.greenDC > 0 ? this.redDC / this.greenDC : 0,
      ratioOfRatios: this.greenDC > 0 && this.greenAC > 0 && this.redDC > 0 
        ? (this.redAC / this.redDC) / (this.greenAC / this.greenDC) 
        : 0
    };
  }
  
}
