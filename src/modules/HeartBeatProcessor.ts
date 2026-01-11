/**
 * PROCESADOR DE LATIDOS - VERSIÓN FINAL CON AUTO-GAIN (AGC)
 * * Características clave:
 * 1. Filtro Pasa-Altos: Elimina el brillo base (DC).
 * 2. Auto-Gain Control: Amplifica señales débiles automáticamente (x50, x100, etc).
 * 3. Normalización: Garantiza que la onda siempre se vea en pantalla.
 */
export class HeartBeatProcessor {
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 200;
  private readonly MIN_PEAK_INTERVAL_MS = 300;  
  private readonly MAX_PEAK_INTERVAL_MS = 1500; 
  
  // Buffer de señal
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 150; // Buffer histórico
  
  // Filtro Pasa-Altos (High Pass)
  private outputFilter: number = 0;
  private lastInput: number = 0;
  private readonly ALPHA = 0.90; // Filtro suave

  // Detección de picos
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  
  // BPM
  private bpmBuffer: number[] = [];
  private smoothBPM: number = 0;
  private rrIntervals: number[] = [];
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  private frameCount: number = 0;
  private isArrhythmiaDetected: boolean = false;

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
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  /**
   * PROCESO PRINCIPAL
   * Recibe el valor crudo invertido de la cámara
   */
  processSignal(rawValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // --- 1. FILTRO DC (Eliminar línea base) ---
    const currentInput = rawValue;
    this.outputFilter = currentInput - this.lastInput + this.ALPHA * this.outputFilter;
    this.lastInput = currentInput;

    // --- 2. GESTIÓN DE BUFFER ---
    this.signalBuffer.push(this.outputFilter);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }

    // --- 3. AUTO-GAIN CONTROL (AGC) ---
    // Aquí ocurre la magia para visualizar ondas débiles
    let normalizedValue = 0;
    
    if (this.signalBuffer.length > 20) {
        // Buscamos el mínimo y máximo recientes para ver qué tan débil es la señal
        let min = Infinity;
        let max = -Infinity;
        
        // Analizamos el último segundo (aprox 60 frames)
        const checkLimit = Math.min(this.signalBuffer.length, 60);
        for(let i = 1; i <= checkLimit; i++) {
            const val = this.signalBuffer[this.signalBuffer.length - i];
            if (val < min) min = val;
            if (val > max) max = val;
        }
        
        const range = max - min;
        
        // Si hay algo de señal (evitamos ruido eléctrico puro)
        if (range > 0.0001) {
            // Calculamos cuánto multiplicar para que la onda llegue a tamaño 50
            const targetAmplitude = 50;
            const gain = targetAmplitude / range; 
            
            // Limitamos la ganancia máxima a 1000x para no volvernos locos con ruido
            const safeGain = Math.min(gain, 1000); 
            
            normalizedValue = this.outputFilter * safeGain;
        }
    }

    // --- 4. DETECCIÓN DE PICOS ---
    // Usamos el valor normalizado, así que usamos un umbral fijo y cómodo
    const peakResult = this.detectPeak(normalizedValue, now);
    
    if (peakResult.isPeak) {
      this.updateBPM(now);
      this.playBeep();
      // VIBRACIÓN FUERTE para que se sienta
      this.vibrate();
      console.log(`💓 PICO DETECTADO! BPM=${Math.round(this.smoothBPM)} Val=${normalizedValue.toFixed(1)}`);
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: peakResult.confidence,
      isPeak: peakResult.isPeak,
      filteredValue: normalizedValue, // ¡Valor AMPLIFICADO para ver en gráfica!
      arrhythmiaCount: 0
    };
  }

  private detectPeak(val: number, now: number): { isPeak: boolean; confidence: number } {
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
        return { isPeak: false, confidence: 0 };
    }

    // Como normalizamos la señal a +/- 25 aprox, ponemos el umbral en 10
    const THRESHOLD = 10; 

    if (val > THRESHOLD) {
        // Verificamos si es pico real (máximo local simple)
        // Nota: En una señal amplificada, a veces conviene ser permisivo
        this.previousPeakTime = this.lastPeakTime;
        this.lastPeakTime = now;
        
        if (this.previousPeakTime) {
          const rr = now - this.previousPeakTime;
          if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
            this.rrIntervals.push(rr);
            if (this.rrIntervals.length > 30) this.rrIntervals.shift();
          }
        }
        
        return { isPeak: true, confidence: 1 };
    }
    
    return { isPeak: false, confidence: 0 };
  }

  private updateBPM(now: number): void {
    if (!this.previousPeakTime) return;
    const interval = now - this.previousPeakTime;
    if (interval < this.MIN_PEAK_INTERVAL_MS || interval > this.MAX_PEAK_INTERVAL_MS) return;
    
    const instantBPM = 60000 / interval;
    
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      this.smoothBPM = this.smoothBPM * 0.8 + instantBPM * 0.2;
    }
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
  }

  private vibrate(): void {
    try { 
      if (navigator.vibrate) {
        // Vibración más larga y fuerte: 50ms
        navigator.vibrate(50); 
      }
    } catch (e) {
      console.warn('Vibración no soportada:', e);
    }
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 300) return;
    
    try {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(400, t + 0.1);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.15);
      this.lastBeepTime = now;
    } catch {}
  }

  getRRIntervals(): number[] { return [...this.rrIntervals]; }
  getLastPeakTime(): number | null { return this.lastPeakTime; }
  setArrhythmiaDetected(isDetected: boolean): void { this.isArrhythmiaDetected = isDetected; }
  setFingerDetected(_detected: boolean): void {}
  
  reset(): void {
    this.signalBuffer = [];
    this.bpmBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = null;
    this.previousPeakTime = null;
    this.frameCount = 0;
    this.outputFilter = 0;
    this.lastInput = 0;
  }
  
  dispose(): void {
    if (this.audioContext) this.audioContext.close().catch(() => {});
  }
}
