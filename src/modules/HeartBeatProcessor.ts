/**
 * PROCESADOR DE LATIDOS CARDÍACOS - VERSIÓN SIMPLIFICADA
 * 
 * Detecta picos en la señal PPG filtrada
 * Sin validación de dedo - procesa todo
 */
export class HeartBeatProcessor {
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 200;
  private readonly MIN_PEAK_INTERVAL_MS = 300;  // 200 BPM máx
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM mín
  
  // Buffer de señal
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 60; // 2 segundos @ 30fps
  
  // Detección de picos
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  
  // BPM
  private bpmBuffer: number[] = [];
  private smoothBPM: number = 0;
  
  // RR intervals
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
        this.audioContext = new AudioContext();
        await this.audioContext.resume();
        this.audioUnlocked = true;
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  processSignal(value: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // Guardar en buffer
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos al menos 30 muestras
    if (this.signalBuffer.length < 30) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: value, arrhythmiaCount: 0 };
    }
    
    // Detectar pico
    const peakResult = this.detectPeak(now);
    
    // Si hay pico, actualizar BPM y reproducir sonido
    if (peakResult.isPeak) {
      this.updateBPM(now);
      this.playBeep();
      this.vibrate();
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: peakResult.confidence,
      isPeak: peakResult.isPeak,
      filteredValue: value,
      arrhythmiaCount: 0
    };
  }

  /**
   * DETECCIÓN DE PICOS SIMPLE
   * Busca máximos locales que superen un umbral adaptativo
   */
  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.signalBuffer.length;
    if (n < 30) return { isPeak: false, confidence: 0 };
    
    // Intervalo mínimo entre picos
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Ventana de análisis (últimas 30 muestras)
    const window = this.signalBuffer.slice(-30);
    
    // Estadísticas
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const std = Math.sqrt(window.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / window.length);
    const max = Math.max(...window);
    const min = Math.min(...window);
    const range = max - min;
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`🔍 PPG: range=${range.toFixed(1)}, std=${std.toFixed(1)}, mean=${mean.toFixed(1)}`);
    }
    
    // UMBRAL MÍNIMO: necesitamos algo de variación
    if (range < 0.3 || std < 0.1) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Buscar máximo en región central (índices 10-20)
    let maxIdx = 10;
    let maxVal = window[10];
    for (let i = 11; i < 20; i++) {
      if (window[i] > maxVal) {
        maxVal = window[i];
        maxIdx = i;
      }
    }
    
    // Umbral adaptativo: debe superar media + 0.5*std
    const threshold = mean + std * 0.5;
    if (maxVal < threshold) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Verificar que es un máximo local (cae a ambos lados)
    const leftVals = window.slice(Math.max(0, maxIdx - 3), maxIdx);
    const rightVals = window.slice(maxIdx + 1, Math.min(window.length, maxIdx + 4));
    
    if (leftVals.length === 0 || rightVals.length === 0) {
      return { isPeak: false, confidence: 0 };
    }
    
    const leftMax = Math.max(...leftVals);
    const rightMax = Math.max(...rightVals);
    
    // El pico debe ser mayor que sus vecinos
    if (maxVal <= leftMax || maxVal <= rightMax) {
      return { isPeak: false, confidence: 0 };
    }
    
    // ¡PICO DETECTADO!
    this.previousPeakTime = this.lastPeakTime;
    this.lastPeakTime = now;
    
    // Guardar intervalo RR
    if (this.previousPeakTime) {
      const rr = now - this.previousPeakTime;
      if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
        this.rrIntervals.push(rr);
        if (this.rrIntervals.length > 30) {
          this.rrIntervals.shift();
        }
      }
    }
    
    const confidence = Math.min(1, (maxVal - threshold) / (std + 0.1));
    return { isPeak: true, confidence };
  }

  private updateBPM(now: number): void {
    if (!this.previousPeakTime) return;
    
    const interval = now - this.previousPeakTime;
    if (interval < this.MIN_PEAK_INTERVAL_MS || interval > this.MAX_PEAK_INTERVAL_MS) return;
    
    const instantBPM = 60000 / interval;
    
    // Suavizado
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      this.smoothBPM = this.smoothBPM * 0.7 + instantBPM * 0.3;
    }
    
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
    
    this.bpmBuffer.push(instantBPM);
    if (this.bpmBuffer.length > 10) {
      this.bpmBuffer.shift();
    }
  }

  private vibrate(): void {
    try {
      if (navigator.vibrate) {
        navigator.vibrate([40, 20, 60]);
      }
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    
    const now = Date.now();
    if (now - this.lastBeepTime < 300) return;
    
    try {
      const t = this.audioContext.currentTime;
      
      // Sonido de latido simple
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.1);
      
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      
      osc.start(t);
      osc.stop(t + 0.2);
      
      this.lastBeepTime = now;
    } catch {}
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
  
  setFingerDetected(_detected: boolean): void {}

  reset(): void {
    this.signalBuffer = [];
    this.bpmBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = null;
    this.previousPeakTime = null;
    this.frameCount = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}