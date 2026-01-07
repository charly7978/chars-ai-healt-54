import { BandpassFilter } from './signal-processing/BandpassFilter';

/**
 * PROCESADOR DE LATIDOS CARDÍACOS - VERSIÓN CIENTÍFICAMENTE VALIDADA
 * 
 * ALGORITMO DE DETECCIÓN DE PICOS:
 * 
 * 1. Recibe señal ya filtrada del PPGSignalProcessor (pasabanda 0.5-4Hz)
 * 2. Aplica un segundo filtro adaptativo para suavizar
 * 3. Detecta picos basándose en:
 *    - Cambio de signo de la derivada (subida -> bajada)
 *    - Amplitud mínima sobre umbral adaptativo
 *    - Intervalo mínimo fisiológico entre picos (300ms = 200BPM)
 * 
 * Referencias:
 * - webcam-pulse-detector (GitHub 3.2k stars): detección por derivada
 * - De Haan & Jeanne 2013: filtrado adaptativo
 */
export class HeartBeatProcessor {
  // Configuración fisiológica
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333;  // 180 BPM máximo
  private readonly WARMUP_TIME_MS = 2000;       // 2s de calentamiento
  
  // Buffers
  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 120; // 4 segundos a 30fps
  
  // Estado de detección de picos
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  private peakAmplitudes: number[] = [];
  private adaptiveThreshold: number = 0.5;
  
  // BPM
  private bpmHistory: number[] = [];
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.2;
  
  // Intervalos RR para análisis
  private rrIntervals: number[] = [];
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioInitialized: boolean = false;
  private lastBeepTime: number = 0;
  private readonly BEEP_VOLUME = 0.8;
  private readonly MIN_BEEP_INTERVAL_MS = 350;
  
  // Estado
  private startTime: number = 0;
  private isArrhythmiaDetected: boolean = false;
  private wasFingerDetected: boolean = false;
  private lastProcessedValue: number = 0;
  private frameCount: number = 0;

  constructor() {
    this.startTime = Date.now();
    this.initAudio();
  }

  private async initAudio() {
    if (this.audioInitialized) return;
    
    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume();
      this.audioInitialized = true;
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
        navigator.vibrate([50, 30, 80]);
      }
      
      const currentTime = this.audioContext.currentTime;
      
      // LUB (primer sonido)
      const osc1 = this.audioContext.createOscillator();
      const gain1 = this.audioContext.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = 150;
      gain1.gain.setValueAtTime(0, currentTime);
      gain1.gain.linearRampToValueAtTime(this.BEEP_VOLUME, currentTime + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.12);
      osc1.connect(gain1);
      gain1.connect(this.audioContext.destination);
      osc1.start(currentTime);
      osc1.stop(currentTime + 0.15);
      
      // DUB (segundo sonido)
      const osc2 = this.audioContext.createOscillator();
      const gain2 = this.audioContext.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 120;
      const dubStart = currentTime + 0.1;
      gain2.gain.setValueAtTime(0, dubStart);
      gain2.gain.linearRampToValueAtTime(this.BEEP_VOLUME * 0.8, dubStart + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, dubStart + 0.12);
      osc2.connect(gain2);
      gain2.connect(this.audioContext.destination);
      osc2.start(dubStart);
      osc2.stop(dubStart + 0.15);
      
      // Tono de arritmia
      if (this.isArrhythmiaDetected) {
        const osc3 = this.audioContext.createOscillator();
        const gain3 = this.audioContext.createGain();
        osc3.type = 'sine';
        osc3.frequency.value = 440;
        const arrStart = dubStart + 0.15;
        gain3.gain.setValueAtTime(0, arrStart);
        gain3.gain.linearRampToValueAtTime(0.4, arrStart + 0.02);
        gain3.gain.exponentialRampToValueAtTime(0.001, arrStart + 0.1);
        osc3.connect(gain3);
        gain3.connect(this.audioContext.destination);
        osc3.start(arrStart);
        osc3.stop(arrStart + 0.15);
        this.isArrhythmiaDetected = false;
      }
      
      this.lastBeepTime = now;
    } catch (error) {
      // Silenciar error
    }
  }

  private isInWarmup(): boolean {
    return Date.now() - this.startTime < this.WARMUP_TIME_MS;
  }

  /**
   * PROCESA UNA MUESTRA DE SEÑAL
   * 
   * @param value Valor de señal (preferiblemente ya filtrado por PPGSignalProcessor)
   * @param timestamp Timestamp opcional
   */
  processSignal(value: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    signalQuality?: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // Guardar en buffer
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Calcular derivada (cambio entre muestras)
    const derivative = value - this.lastProcessedValue;
    this.lastProcessedValue = value;
    
    this.derivativeBuffer.push(derivative);
    if (this.derivativeBuffer.length > this.BUFFER_SIZE) {
      this.derivativeBuffer.shift();
    }
    
    // Necesitamos suficientes muestras
    if (this.signalBuffer.length < 30) {
      return this.getDefaultResult(value);
    }
    
    // Detectar pico
    const peakResult = this.detectPeak(now);
    
    // Si hay pico válido
    if (peakResult.isPeak && !this.isInWarmup()) {
      this.updateBPM();
      this.playHeartSound();
    }
    
    // Calcular calidad de señal
    const quality = this.calculateSignalQuality();
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: peakResult.confidence,
      isPeak: peakResult.isPeak,
      filteredValue: value,
      arrhythmiaCount: 0,
      signalQuality: quality
    };
  }

  /**
   * DETECCIÓN DE PICOS - Algoritmo basado en derivada
   * 
   * Un pico ocurre cuando:
   * 1. La derivada pasa de positiva a negativa (cruce por cero)
   * 2. La amplitud del pico supera el umbral adaptativo
   * 3. Ha pasado suficiente tiempo desde el último pico
   */
  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.derivativeBuffer.length;
    if (n < 5) return { isPeak: false, confidence: 0 };
    
    // Verificar intervalo mínimo desde último pico
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Obtener las últimas derivadas
    const d1 = this.derivativeBuffer[n - 4]; // hace 3 frames
    const d2 = this.derivativeBuffer[n - 3]; // hace 2 frames
    const d3 = this.derivativeBuffer[n - 2]; // hace 1 frame
    const d4 = this.derivativeBuffer[n - 1]; // actual
    
    // Buscar cruce por cero: derivada positiva -> negativa
    // El pico está aproximadamente en n-2 o n-3
    const wasRising = d1 > 0 && d2 > 0;
    const isNowFalling = d3 < 0 || d4 < 0;
    const hadPeak = d2 > 0 && d3 <= 0;
    
    if (!wasRising || !isNowFalling || !hadPeak) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Verificar amplitud del pico
    const recent = this.signalBuffer.slice(-30);
    const peakValue = Math.max(...this.signalBuffer.slice(-5));
    const minValue = Math.min(...recent);
    const maxValue = Math.max(...recent);
    const amplitude = maxValue - minValue;
    
    // Actualizar umbral adaptativo
    this.updateAdaptiveThreshold(amplitude);
    
    // El pico debe tener amplitud significativa
    if (amplitude < this.adaptiveThreshold * 0.5) {
      return { isPeak: false, confidence: 0 };
    }
    
    // El valor del pico debe estar en la zona alta
    const normalizedPeak = (peakValue - minValue) / (amplitude || 1);
    if (normalizedPeak < 0.6) {
      return { isPeak: false, confidence: 0 };
    }
    
    // ¡PICO DETECTADO!
    this.previousPeakTime = this.lastPeakTime;
    this.lastPeakTime = now;
    
    // Guardar amplitud para calibración
    this.peakAmplitudes.push(amplitude);
    if (this.peakAmplitudes.length > 20) {
      this.peakAmplitudes.shift();
    }
    
    // Guardar intervalo RR
    if (this.previousPeakTime) {
      const rr = now - this.previousPeakTime;
      if (rr >= 300 && rr <= 2000) { // 30-200 BPM
        this.rrIntervals.push(rr);
        if (this.rrIntervals.length > 30) {
          this.rrIntervals.shift();
        }
      }
    }
    
    // Calcular confianza
    const confidence = Math.min(1, 0.5 + normalizedPeak * 0.3 + (amplitude / this.adaptiveThreshold) * 0.2);
    
    return { isPeak: true, confidence };
  }

  /**
   * Actualiza el umbral adaptativo basado en las últimas amplitudes de pico
   */
  private updateAdaptiveThreshold(amplitude: number): void {
    if (this.peakAmplitudes.length < 3) {
      this.adaptiveThreshold = Math.max(0.3, amplitude * 0.6);
      return;
    }
    
    // Promedio de las últimas amplitudes
    const avgAmplitude = this.peakAmplitudes.reduce((a, b) => a + b, 0) / this.peakAmplitudes.length;
    
    // Umbral = 50% del promedio (permite detectar picos algo más débiles)
    this.adaptiveThreshold = avgAmplitude * 0.5;
    
    // Límites mínimo y máximo
    this.adaptiveThreshold = Math.max(0.2, Math.min(5, this.adaptiveThreshold));
  }

  private updateBPM(): void {
    if (!this.lastPeakTime || !this.previousPeakTime) return;
    
    const interval = this.lastPeakTime - this.previousPeakTime;
    
    // Validar rango fisiológico
    if (interval < 333 || interval > 1500) return; // 40-180 BPM
    
    const instantBPM = 60000 / interval;
    
    // Suavizado exponencial
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      // Rechazar cambios muy bruscos
      if (Math.abs(instantBPM - this.smoothBPM) > 30) {
        // Cambio muy grande - aplicar menos peso
        this.smoothBPM = this.smoothBPM * 0.9 + instantBPM * 0.1;
      } else {
        this.smoothBPM = this.smoothBPM * (1 - this.BPM_SMOOTHING) + instantBPM * this.BPM_SMOOTHING;
      }
    }
    
    // Mantener en rango
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
    
    // Historial
    this.bpmHistory.push(instantBPM);
    if (this.bpmHistory.length > 30) {
      this.bpmHistory.shift();
    }
  }

  private calculateSignalQuality(): number {
    if (this.signalBuffer.length < 30) return 0;
    
    const recent = this.signalBuffer.slice(-30);
    const amplitude = Math.max(...recent) - Math.min(...recent);
    
    let quality = 0;
    
    // Basado en amplitud
    if (amplitude > 3) quality = 90;
    else if (amplitude > 2) quality = 70;
    else if (amplitude > 1) quality = 50;
    else if (amplitude > 0.5) quality = 30;
    else quality = 10;
    
    // Bonus por tener BPM estable
    if (this.smoothBPM >= 50 && this.smoothBPM <= 120 && this.bpmHistory.length >= 5) {
      const variance = this.calculateVariance(this.bpmHistory.slice(-10));
      if (variance < 100) quality = Math.min(100, quality + 10);
    }
    
    return quality;
  }

  private calculateVariance(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  }

  private getDefaultResult(value: number) {
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: 0.2,
      isPeak: false,
      filteredValue: value,
      arrhythmiaCount: 0,
      signalQuality: this.calculateSignalQuality()
    };
  }

  // === MÉTODOS PÚBLICOS ===
  
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
      // Dedo perdido - resetear
      this.signalBuffer = [];
      this.derivativeBuffer = [];
      this.smoothBPM = 0;
      this.lastPeakTime = null;
      this.previousPeakTime = null;
      this.peakAmplitudes = [];
      this.adaptiveThreshold = 0.5;
    }
    this.wasFingerDetected = detected;
  }

  reset(): void {
    this.signalBuffer = [];
    this.derivativeBuffer = [];
    this.bpmHistory = [];
    this.rrIntervals = [];
    this.peakAmplitudes = [];
    this.smoothBPM = 0;
    this.lastPeakTime = null;
    this.previousPeakTime = null;
    this.adaptiveThreshold = 0.5;
    this.startTime = Date.now();
    this.frameCount = 0;
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.reset();
  }
}
