/**
 * PROCESADOR DE LATIDOS - VERSIÓN LIMPIA
 * 
 * IMPORTANTE: Recibe señal YA FILTRADA del BandpassFilter
 * NO aplica filtros adicionales, solo detecta picos
 * 
 * Flujo de datos:
 * Cámara → FrameProcessor → BandpassFilter → ESTE PROCESADOR → BPM
 */
export class HeartBeatProcessor {
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 200;
  private readonly MIN_PEAK_INTERVAL_MS = 300;  // 200 BPM máx
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM mín
  
  // Buffer para análisis
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90; // 3 segundos a 30fps
  
  // Detección de picos - usa derivada
  private prevValue: number = 0;
  private prevDerivative: number = 0;
  private lastPeakTime: number = 0;
  private previousPeakTime: number = 0;
  
  // BPM
  private rrIntervals: number[] = [];
  private smoothBPM: number = 0;
  
  // Audio y vibración
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  private frameCount: number = 0;

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
   * PROCESO PRINCIPAL
   * @param filteredValue - Valor YA FILTRADO por BandpassFilter (0.3-5Hz)
   * @param timestamp - Timestamp en ms
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
    
    // Guardar en buffer
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // --- NORMALIZACIÓN DINÁMICA ---
    // Escalar la señal basándose en el rango reciente
    let normalizedValue = 0;
    if (this.signalBuffer.length >= 30) {
      const recent = this.signalBuffer.slice(-60);
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      const range = max - min;
      
      if (range > 0.001) {
        // Normalizar a rango -50 a +50 para visualización
        normalizedValue = ((filteredValue - min) / range - 0.5) * 100;
      }
    }
    
    // --- DETECCIÓN DE PICOS POR DERIVADA ---
    const derivative = normalizedValue - this.prevValue;
    const timeSinceLastPeak = now - this.lastPeakTime;
    
    // Detectar cruce de cero de la derivada (máximo local)
    const isPeak = (
      this.prevDerivative > 0 &&           // Derivada era positiva
      derivative <= 0 &&                    // Ahora es negativa o cero
      normalizedValue > 10 &&               // Valor significativo (umbral bajo)
      timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS
    );
    
    if (isPeak) {
      // Registrar RR interval
      if (this.lastPeakTime > 0) {
        const rrInterval = now - this.lastPeakTime;
        if (rrInterval >= this.MIN_PEAK_INTERVAL_MS && rrInterval <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(rrInterval);
          if (this.rrIntervals.length > 20) {
            this.rrIntervals.shift();
          }
          
          // Calcular BPM
          const instantBPM = 60000 / rrInterval;
          if (this.smoothBPM === 0) {
            this.smoothBPM = instantBPM;
          } else {
            // Suavizado exponencial
            this.smoothBPM = this.smoothBPM * 0.7 + instantBPM * 0.3;
          }
          this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
        }
      }
      
      this.previousPeakTime = this.lastPeakTime;
      this.lastPeakTime = now;
      
      // Feedback
      this.playBeep();
      this.vibrate();
      
      console.log(`💓 PICO! BPM=${Math.round(this.smoothBPM)} Val=${normalizedValue.toFixed(1)}`);
    }
    
    // Log periódico
    if (this.frameCount % 30 === 0) {
      console.log(`📊 Señal: Val=${normalizedValue.toFixed(1)} Der=${derivative.toFixed(2)} BPM=${Math.round(this.smoothBPM)}`);
    }
    
    this.prevValue = normalizedValue;
    this.prevDerivative = derivative;
    
    // Calcular confianza basada en estabilidad del BPM
    let confidence = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean; // Coeficiente de variación
      confidence = Math.max(0, Math.min(1, 1 - cv));
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence,
      isPeak,
      filteredValue: normalizedValue, // Valor normalizado para gráfica
      arrhythmiaCount: 0
    };
  }

  private vibrate(): void {
    try { 
      if (navigator.vibrate) {
        navigator.vibrate(80); // Vibración de 80ms
      }
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 250) return;
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
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
    this.previousPeakTime = 0;
    this.prevValue = 0;
    this.prevDerivative = 0;
    this.frameCount = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
