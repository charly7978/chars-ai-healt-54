import { KalmanFilter } from './signal-processing/KalmanFilter';
import { BandpassFilter } from './signal-processing/BandpassFilter';

/**
 * PROCESADOR DE LATIDOS CARDÍACOS - VERSIÓN OPTIMIZADA
 * 
 * Usa filtro pasabanda 0.5-4Hz para aislar frecuencia cardíaca.
 * Detección de picos basada en derivada y cambio de tendencia.
 */
export class HeartBeatProcessor {
  // Configuración
  private readonly SAMPLE_RATE = 30;
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333; // 180 BPM máximo
  private readonly WARMUP_TIME_MS = 1500;
  private readonly BEEP_VOLUME = 1.0;
  private readonly MIN_BEEP_INTERVAL_MS = 350;
  
  // Filtros
  private kalmanFilter: KalmanFilter;
  private bandpassFilter: BandpassFilter;
  
  // Buffers
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90; // 3 segundos a 30fps
  
  // Estado de detección
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  private bpmHistory: number[] = [];
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.25;
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioInitialized: boolean = false;
  private lastBeepTime: number = 0;
  
  // Timestamps
  private startTime: number = 0;
  private lastProcessedTimestamp: number = 0;
  
  // Estado
  private isArrhythmiaDetected: boolean = false;
  private currentSignalQuality: number = 0;
  private wasFingerDetected: boolean = false;
  
  // Historial RR para exportar
  private rrIntervals: number[] = [];

  constructor() {
    this.kalmanFilter = new KalmanFilter();
    this.bandpassFilter = new BandpassFilter(this.SAMPLE_RATE);
    this.startTime = Date.now();
    this.initAudio();
  }

  private async initAudio() {
    if (this.audioInitialized) return;
    
    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume();
      this.audioInitialized = true;
      
      // Sonido de prueba silencioso para desbloquear audio
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      gain.gain.setValueAtTime(0.01, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start();
      osc.stop(this.audioContext.currentTime + 0.15);
    } catch (error) {
      console.error("Error inicializando audio:", error);
    }
  }

  private async playHeartSound() {
    if (!this.audioContext || this.isInWarmup()) return;
    
    const now = Date.now();
    if (now - this.lastBeepTime < this.MIN_BEEP_INTERVAL_MS) return;
    
    try {
      // Vibración
      if (navigator.vibrate) {
        navigator.vibrate([40, 20, 60]);
      }
      
      const currentTime = this.audioContext.currentTime;
      
      // LUB
      const osc1 = this.audioContext.createOscillator();
      const gain1 = this.audioContext.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = 150;
      gain1.gain.setValueAtTime(0, currentTime);
      gain1.gain.linearRampToValueAtTime(this.BEEP_VOLUME, currentTime + 0.03);
      gain1.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.15);
      osc1.connect(gain1);
      gain1.connect(this.audioContext.destination);
      osc1.start(currentTime);
      osc1.stop(currentTime + 0.2);
      
      // DUB
      const osc2 = this.audioContext.createOscillator();
      const gain2 = this.audioContext.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 120;
      const dubStart = currentTime + 0.08;
      gain2.gain.setValueAtTime(0, dubStart);
      gain2.gain.linearRampToValueAtTime(this.BEEP_VOLUME, dubStart + 0.03);
      gain2.gain.exponentialRampToValueAtTime(0.001, dubStart + 0.15);
      osc2.connect(gain2);
      gain2.connect(this.audioContext.destination);
      osc2.start(dubStart);
      osc2.stop(dubStart + 0.2);
      
      // Tono de arritmia si aplica
      if (this.isArrhythmiaDetected) {
        const osc3 = this.audioContext.createOscillator();
        const gain3 = this.audioContext.createGain();
        osc3.type = 'sine';
        osc3.frequency.value = 440;
        const arrStart = dubStart + 0.1;
        gain3.gain.setValueAtTime(0, arrStart);
        gain3.gain.linearRampToValueAtTime(0.5, arrStart + 0.02);
        gain3.gain.exponentialRampToValueAtTime(0.001, arrStart + 0.15);
        osc3.connect(gain3);
        gain3.connect(this.audioContext.destination);
        osc3.start(arrStart);
        osc3.stop(arrStart + 0.2);
        this.isArrhythmiaDetected = false;
      }
      
      this.lastBeepTime = now;
    } catch (error) {
      console.error("Error reproduciendo sonido:", error);
    }
  }

  private isInWarmup(): boolean {
    return Date.now() - this.startTime < this.WARMUP_TIME_MS;
  }

  /**
   * Procesa una muestra de señal PPG
   */
  processSignal(value: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    signalQuality?: number;
  } {
    const now = timestamp || Date.now();
    
    // Evitar procesamiento duplicado
    if (this.lastProcessedTimestamp === now) {
      return this.getDefaultResult();
    }
    this.lastProcessedTimestamp = now;
    
    // PASO 1: Filtrado Kalman para suavizar ruido
    const kalmanFiltered = this.kalmanFilter.filter(value);
    
    // PASO 2: Filtro pasabanda 0.5-4Hz para aislar frecuencia cardíaca
    const bandpassFiltered = this.bandpassFilter.filter(kalmanFiltered);
    
    // Guardar en buffers
    this.rawBuffer.push(kalmanFiltered);
    this.filteredBuffer.push(bandpassFiltered);
    
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
      this.filteredBuffer.shift();
    }
    
    // Necesitamos suficientes muestras
    if (this.filteredBuffer.length < 20) {
      return this.getDefaultResult(bandpassFiltered);
    }
    
    // PASO 3: Detección de picos en la señal filtrada
    const peakResult = this.detectPeak();
    
    // Calcular calidad de señal
    this.currentSignalQuality = this.calculateSignalQuality();
    
    // Si hay pico, actualizar BPM y reproducir sonido
    if (peakResult.isPeak && !this.isInWarmup()) {
      this.updateBPM();
      this.playHeartSound();
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: peakResult.confidence,
      isPeak: peakResult.isPeak,
      filteredValue: bandpassFiltered,
      arrhythmiaCount: 0,
      signalQuality: this.currentSignalQuality
    };
  }

  /**
   * DETECCIÓN DE PICOS - Basada en cambio de derivada
   * 
   * Un pico real tiene:
   * 1. Derivada positiva (subiendo) seguida de derivada negativa (bajando)
   * 2. Amplitud significativa en la señal pasabanda
   * 3. Intervalo mínimo desde el último pico
   */
  private detectPeak(): { isPeak: boolean; confidence: number } {
    const n = this.filteredBuffer.length;
    if (n < 10) return { isPeak: false, confidence: 0 };
    
    const now = Date.now();
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    
    // Intervalo mínimo fisiológico
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Obtener ventana reciente de la señal pasabanda
    const window = this.filteredBuffer.slice(-15);
    const windowLen = window.length;
    
    // Calcular rango AC de la señal pasabanda
    const windowMax = Math.max(...window);
    const windowMin = Math.min(...window);
    const acRange = windowMax - windowMin;
    
    // La señal pasabanda debe tener amplitud significativa
    // Un valor muy bajo indica que no hay pulso real
    const MIN_AC_AMPLITUDE = 0.3;
    if (acRange < MIN_AC_AMPLITUDE) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Calcular derivadas en los últimos 5 puntos
    const d1 = window[windowLen - 5] - window[windowLen - 6]; // hace 5 frames
    const d2 = window[windowLen - 4] - window[windowLen - 5]; // hace 4 frames
    const d3 = window[windowLen - 3] - window[windowLen - 4]; // hace 3 frames
    const d4 = window[windowLen - 2] - window[windowLen - 3]; // hace 2 frames
    const d5 = window[windowLen - 1] - window[windowLen - 2]; // actual
    
    // Buscar patrón: subida clara -> bajada clara
    // El pico está aproximadamente en window[windowLen-3]
    const wasRising = d1 > 0.01 && d2 > 0.01;
    const isFalling = d4 < -0.01 && d5 < -0.01;
    const peakTransition = d3 <= 0.02; // Cerca del máximo
    
    const isPotentialPeak = wasRising && peakTransition && isFalling;
    
    if (!isPotentialPeak) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Verificar que el pico está en la parte alta del rango
    const peakValue = window[windowLen - 3];
    const normalizedHeight = (peakValue - windowMin) / acRange;
    
    if (normalizedHeight < 0.5) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Calcular confianza basada en la claridad del pico
    const riseStrength = Math.abs(d1 + d2);
    const fallStrength = Math.abs(d4 + d5);
    const peakClarity = Math.min(riseStrength, fallStrength) / acRange;
    const confidence = Math.min(1, 0.5 + peakClarity * 2 + normalizedHeight * 0.3);
    
    // Registrar el pico
    this.previousPeakTime = this.lastPeakTime;
    this.lastPeakTime = now;
    
    // Guardar intervalo RR
    if (this.previousPeakTime) {
      const rrInterval = now - this.previousPeakTime;
      if (rrInterval >= 300 && rrInterval <= 2000) {
        this.rrIntervals.push(rrInterval);
        if (this.rrIntervals.length > 20) {
          this.rrIntervals.shift();
        }
      }
    }
    
    return { isPeak: true, confidence };
  }

  private updateBPM(): void {
    if (!this.lastPeakTime || !this.previousPeakTime) return;
    
    const interval = this.lastPeakTime - this.previousPeakTime;
    
    // Validar intervalo fisiológico
    if (interval < 333 || interval > 1500) return; // 40-180 BPM
    
    const instantBPM = 60000 / interval;
    
    // Suavizado exponencial
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      this.smoothBPM = this.smoothBPM * (1 - this.BPM_SMOOTHING) + instantBPM * this.BPM_SMOOTHING;
    }
    
    // Mantener en rango fisiológico
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
    
    // Historial para análisis
    this.bpmHistory.push(instantBPM);
    if (this.bpmHistory.length > 30) {
      this.bpmHistory.shift();
    }
  }

  private calculateSignalQuality(): number {
    if (this.filteredBuffer.length < 20) return 0;
    
    const window = this.filteredBuffer.slice(-30);
    const acRange = Math.max(...window) - Math.min(...window);
    
    // Calidad basada en amplitud de la señal pasabanda
    let quality = 0;
    
    if (acRange > 2.0) quality = 90;
    else if (acRange > 1.0) quality = 70;
    else if (acRange > 0.5) quality = 50;
    else if (acRange > 0.3) quality = 30;
    else quality = 10;
    
    // Bonus si tenemos BPM estable
    if (this.smoothBPM >= 50 && this.smoothBPM <= 120) {
      quality = Math.min(100, quality + 10);
    }
    
    return quality;
  }

  private getDefaultResult(filteredValue: number = 0): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    signalQuality?: number;
  } {
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: 0.3,
      isPeak: false,
      filteredValue,
      arrhythmiaCount: 0,
      signalQuality: this.currentSignalQuality
    };
  }

  // Métodos públicos
  
  getSmoothBPM(): number {
    return this.smoothBPM;
  }
  
  getRRIntervals(): number[] {
    return [...this.rrIntervals];
  }
  
  getLastPeakTime(): number | null {
    return this.lastPeakTime;
  }
  
  setArrhythmiaDetected(isDetected: boolean): void {
    this.isArrhythmiaDetected = isDetected;
  }
  
  setFingerDetected(detected: boolean): void {
    if (!detected && this.wasFingerDetected) {
      // Dedo perdido - resetear parcialmente
      this.filteredBuffer = [];
      this.smoothBPM = 0;
      this.lastPeakTime = null;
      this.previousPeakTime = null;
    }
    this.wasFingerDetected = detected;
  }

  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.bpmHistory = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = null;
    this.previousPeakTime = null;
    this.currentSignalQuality = 0;
    this.startTime = Date.now();
    this.kalmanFilter.reset();
    this.bandpassFilter.reset();
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.reset();
  }
}
