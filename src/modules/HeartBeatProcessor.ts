/**
 * PROCESADOR DE LATIDOS - VERSIÓN MEJORADA
 * 
 * MEJORAS:
 * 1. Detección de picos más robusta con análisis de pendientes
 * 2. Filtrado de falsos positivos mejorado
 * 3. BPM más estable con validación de intervalos
 * 4. Mejor manejo de señales débiles
 * 
 * Referencia: webcam-pulse-detector (thearn), De Haan & Jeanne 2013
 */
export class HeartBeatProcessor {
  // Constantes fisiológicas
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333;  // 180 BPM máximo
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM mínimo
  
  // Buffers para análisis
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;
  private adaptiveBaseline: number = 0;
  
  // RR Intervals y BPM
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 12;
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.75;
  
  // Audio feedback
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  // Estadísticas
  private frameCount: number = 0;
  private consecutivePeaks: number = 0;
  private lastPeakValue: number = 0;
  private peakHistory: { time: number; value: number }[] = [];

  constructor() {
    this.setupAudio();
  }
  
  private setupAudio() {
    const unlock = async () => {
      if (this.audioUnlocked) return;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();
        await this.audioContext.resume();
        this.audioUnlocked = true;
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
        console.log('🔊 Audio desbloqueado');
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  /**
   * PROCESAR SEÑAL FILTRADA
   * Recibe señal ya pasada por filtro pasabanda
   */
  processSignal(filteredValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // 1. GUARDAR EN BUFFER
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos suficientes muestras - pero mantener último BPM válido
    if (this.signalBuffer.length < 30) {
      return {
        bpm: this.smoothBPM > 0 ? Math.round(this.smoothBPM) : 0,
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0
      };
    }
    
    // 2. NORMALIZACIÓN ADAPTATIVA
    const { normalizedValue, range } = this.normalizeSignal(filteredValue);
    
    // 3. ACTUALIZAR UMBRAL DINÁMICO
    this.updateThreshold(range);
    
    // 4. DETECCIÓN DE PICO
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeak(normalizedValue, timeSinceLastPeak);
      
      if (isPeak) {
        // Registrar intervalo RR
        if (this.lastPeakTime > 0 && timeSinceLastPeak <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }
          
          // Calcular BPM instantáneo
          const instantBPM = 60000 / timeSinceLastPeak;
          
          // Suavizado exponencial
          if (this.smoothBPM === 0) {
            this.smoothBPM = instantBPM;
          } else {
            this.smoothBPM = this.smoothBPM * this.BPM_SMOOTHING + instantBPM * (1 - this.BPM_SMOOTHING);
          }
          
          // Clamp a rango fisiológico
          this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
          
          this.consecutivePeaks++;
        }
        
        this.lastPeakTime = now;
        
        // Feedback
        this.vibrate();
        this.playBeep();
        
        if (this.frameCount % 30 === 0 || this.consecutivePeaks <= 5) {
          console.log(`💓 PICO #${this.consecutivePeaks} BPM=${Math.round(this.smoothBPM)} RR=${timeSinceLastPeak}ms`);
        }
      }
    }
    
    // 5. CALCULAR CONFIANZA
    const confidence = this.calculateConfidence();
    
    // Log periódico
    if (this.frameCount % 60 === 0) {
      console.log(`📊 BPM=${Math.round(this.smoothBPM)} Conf=${(confidence * 100).toFixed(0)}% Picos=${this.consecutivePeaks} Thresh=${this.peakThreshold.toFixed(1)}`);
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0
    };
  }
  
  /**
   * NORMALIZACIÓN ADAPTATIVA CON ESTABILIDAD
   */
  private lastValidRange: number = 0;
  
  private normalizeSignal(value: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-90); // 3 segundos (más estable)
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    // Umbral más bajo para aceptar más señales
    if (range < 0.3) {
      // Si no hay señal ahora pero tuvimos antes, usar último rango válido temporalmente
      if (this.lastValidRange > 0) {
        const normalizedValue = ((value - min) / this.lastValidRange - 0.5) * 100;
        return { normalizedValue, range: 0 };
      }
      return { normalizedValue: 0, range: 0 };
    }
    
    this.lastValidRange = range;
    
    // Normalizar a -50 a +50
    const normalizedValue = ((value - min) / range - 0.5) * 100;
    
    return { normalizedValue, range };
  }
  
  /**
   * UMBRAL DINÁMICO MEJORADO
   */
  private updateThreshold(range: number): void {
    // Umbral proporcional a la amplitud pero con límites
    const newThreshold = Math.max(6, Math.min(25, range * 0.25));
    
    // Suavizar cambios
    this.peakThreshold = this.peakThreshold * 0.9 + newThreshold * 0.1;
  }
  
  /**
   * DETECCIÓN DE PICO MEJORADA
   * Usa análisis de pendiente además de máximo local
   */
  private detectPeak(normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    if (n < 7) return false;
    
    // Obtener últimos 7 valores normalizados para mejor análisis
    const recent = this.signalBuffer.slice(-7);
    const recentNormalized = recent.map(v => {
      const slice = this.signalBuffer.slice(-120);
      const min = Math.min(...slice);
      const max = Math.max(...slice);
      const range = max - min;
      if (range < 0.5) return 0;
      return ((v - min) / range - 0.5) * 100;
    });
    
    const [v0, v1, v2, v3, v4, v5, v6] = recentNormalized;
    
    // El valor central (v3) debe ser el máximo local
    const isLocalMax = v3 > v2 && v3 > v4 && v3 >= v1 && v3 >= v5;
    
    // Debe estar por encima del umbral
    const aboveThreshold = v3 > this.peakThreshold;
    
    // Pendiente ascendente antes (v0→v3 debe subir)
    const risingSlope = (v3 - v0) > 3;
    
    // Pendiente descendente después (v3→v6 debe bajar)  
    const fallingSlope = (v3 - v6) > 3;
    
    // No muy cerca del pico anterior
    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;
    
    // Validación de amplitud vs último pico (no muy diferente)
    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = v3 / this.lastPeakValue;
      amplitudeValid = ratio > 0.3 && ratio < 3.0;
    }
    
    const isPeak = isLocalMax && aboveThreshold && risingSlope && fallingSlope && notTooSoon && amplitudeValid;
    
    if (isPeak) {
      this.lastPeakValue = v3;
    }
    
    return isPeak;
  }
  
  /**
   * CALCULAR CONFIANZA
   * Basado en la consistencia de intervalos RR
   */
  private calculateConfidence(): number {
    if (this.rrIntervals.length < 3) return 0;
    
    // Calcular variabilidad de intervalos RR
    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / mean; // Coeficiente de variación
    
    // Menor variabilidad = mayor confianza
    // CV típico para ritmo normal: 0.02-0.08
    // CV > 0.3 indica mucha irregularidad
    const confidence = Math.max(0, Math.min(1, 1 - cv * 2));
    
    return confidence;
  }

  private vibrate(): void {
    try { 
      if (navigator.vibrate) {
        navigator.vibrate(80); // 80ms de vibración
      }
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 200) return; // Evitar beeps muy seguidos
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      // Tono descendente agradable
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.08);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.12);
      
      this.lastBeepTime = now;
    } catch {}
  }

  getRRIntervals(): number[] { 
    return [...this.rrIntervals]; 
  }
  
  getLastPeakTime(): number { 
    return this.lastPeakTime; 
  }
  
  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}
  
  reset(): void {
    this.signalBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 10;
    this.frameCount = 0;
    this.consecutivePeaks = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
