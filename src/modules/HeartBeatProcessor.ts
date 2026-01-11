/**
 * PROCESADOR DE LATIDOS - DETECCIÓN POR DERIVADA
 * 
 * Recibe señal YA FILTRADA del BandpassFilter
 * Detecta picos usando cruces de cero de la derivada
 */
export class HeartBeatProcessor {
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 200;
  private readonly MIN_PEAK_INTERVAL_MS = 300;
  private readonly MAX_PEAK_INTERVAL_MS = 1500;
  
  // Buffer para análisis
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90;
  
  // Derivada para detección de picos
  private prevValues: number[] = [];
  private lastPeakTime: number = 0;
  private fingerDetected: boolean = true;
  
  // BPM
  private rrIntervals: number[] = [];
  private smoothBPM: number = 0;
  
  // Audio
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
   * PROCESAR SEÑAL FILTRADA
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

    // Si no hay dedo, no intentamos detectar picos (evita BPM fantasmas)
    if (!this.fingerDetected) {
      // Mantener buffer pequeño para no sobre-cargar
      this.signalBuffer.push(filteredValue);
      if (this.signalBuffer.length > 30) this.signalBuffer.shift();
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0,
      };
    }
    
    // Guardar valor original
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // === NORMALIZACIÓN ADAPTATIVA ===
    let normalizedValue = 0;
    if (this.signalBuffer.length >= 30) {
      const recent = this.signalBuffer.slice(-60);
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      const range = max - min;
      
      if (range > 0.01) {
        // Normalizar a -50 a +50
        normalizedValue = ((filteredValue - min) / range - 0.5) * 100;
      }
    }
    
    // === DETECCIÓN DE PICOS (más robusta) ===
    this.prevValues.push(normalizedValue);
    if (this.prevValues.length > 5) {
      this.prevValues.shift();
    }
    
    let isPeak = false;
    const timeSinceLastPeak = now - this.lastPeakTime;
    
    // Necesitamos al menos 3 valores para detectar un máximo local
    if (this.prevValues.length >= 3 && timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      const n = this.prevValues.length;
      const prev2 = this.prevValues[n - 3];
      const prev1 = this.prevValues[n - 2];
      const curr = this.prevValues[n - 1];
      
      // Umbral adaptativo: basado en la dispersión reciente
      const recent = this.prevValues.slice(-5);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const varr = recent.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / recent.length;
      const sd = Math.sqrt(varr);
      const dynThreshold = Math.max(6, mean + sd * 1.1);

      // Máximo local con prominencia mínima
      const localMin = Math.min(prev2, curr);
      const prominence = prev1 - localMin;

      if (prev1 > prev2 && prev1 > curr && prev1 > dynThreshold && prominence > 6) {
        isPeak = true;
        
        // Calcular RR interval
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
              this.smoothBPM = this.smoothBPM * 0.7 + instantBPM * 0.3;
            }
            this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
          }
        }
        
        this.lastPeakTime = now;

        // Feedback solo cuando hay algo de confianza (evita vibración/beep por ruido)
        if (this.rrIntervals.length >= 3) {
          this.playBeep();
          this.vibrate();
        }
      }
    }
    
    // Log periódico (reducido)
    // if (this.frameCount % 60 === 0) console.log(`📊 PPG Norm=${normalizedValue.toFixed(1)} BPM=${Math.round(this.smoothBPM)}`);
    
    // Confianza
    let confidence = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean;
      confidence = Math.max(0, Math.min(1, 1 - cv));
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0
    };
  }

  private vibrate(): void {
    try { 
      if (navigator.vibrate) {
        navigator.vibrate(100);
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
      gain.gain.setValueAtTime(0.2, t);
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
  setFingerDetected(detected: boolean): void {
    if (this.fingerDetected === detected) return;
    this.fingerDetected = detected;
    if (!detected) {
      // Reset duro para evitar que quede BPM anterior congelado
      this.rrIntervals = [];
      this.smoothBPM = 0;
      this.lastPeakTime = 0;
      this.prevValues = [];
    }
  }
  
  reset(): void {
    this.signalBuffer = [];
    this.prevValues = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.frameCount = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
  }
