/**
 * PROCESADOR DE LATIDOS CARDÍACOS - ALGORITMO ROBUSTO
 * 
 * Basado en:
 * - Ventana deslizante para encontrar máximos reales
 * - Umbral basado en percentil de amplitud
 * - Período refractario estricto
 * 
 * El algoritmo SOLO detecta un pico cuando:
 * 1. El valor actual es el MÁXIMO en una ventana de ~200ms
 * 2. Ha pasado el período refractario (>300ms desde último pico)
 * 3. La amplitud supera el umbral dinámico
 */
export class HeartBeatProcessor {
  // Configuración fisiológica
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333;  // 180 BPM máx
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM mín
  private readonly WARMUP_TIME_MS = 2000;       // 2s warmup
  
  // Buffer de señal - guarda valores con timestamp
  private signalBuffer: Array<{value: number, time: number}> = [];
  private readonly BUFFER_SIZE = 90; // ~3s a 30fps
  private readonly WINDOW_SIZE = 7;  // Ventana para máximo local (~230ms a 30fps)
  
  // Estado de detección
  private lastPeakTime: number = 0;
  private lastPeakValue: number = 0;
  private peakCount: number = 0;
  
  // Umbral adaptativo
  private amplitudeHistory: number[] = [];
  private readonly AMPLITUDE_HISTORY_SIZE = 30;
  
  // BPM
  private bpmHistory: number[] = [];
  private smoothBPM: number = 0;
  
  // RR intervals
  private rrIntervals: number[] = [];
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  private readonly MIN_BEEP_INTERVAL_MS = 280;
  
  // Estado
  private startTime: number = 0;
  private frameCount: number = 0;
  private isArrhythmiaDetected: boolean = false;
  
  // Listeners
  private unlockHandler: (() => Promise<void>) | null = null;

  constructor() {
    this.startTime = Date.now();
    this.initAudio();
    this.setupAudioUnlock();
  }

  private setupAudioUnlock() {
    this.unlockHandler = async () => {
      if (this.audioUnlocked) {
        this.removeAudioListeners();
        return;
      }
      
      try {
        if (!this.audioContext) {
          this.audioContext = new AudioContext();
        }
        
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
        
        // Sonido silencioso para desbloquear
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.start();
        osc.stop(this.audioContext.currentTime + 0.01);
        
        this.audioUnlocked = true;
        this.removeAudioListeners();
        console.log('🔊 Audio desbloqueado');
      } catch (e) {}
    };

    ['touchstart', 'touchend', 'click', 'pointerdown'].forEach(event => {
      document.addEventListener(event, this.unlockHandler!, { passive: true });
    });
  }
  
  private removeAudioListeners(): void {
    if (!this.unlockHandler) return;
    ['touchstart', 'touchend', 'click', 'pointerdown'].forEach(event => {
      document.removeEventListener(event, this.unlockHandler!);
    });
    this.unlockHandler = null;
  }

  private async initAudio() {
    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume();
    } catch (error) {}
  }

  private async playHeartSound() {
    if (!this.audioContext || !this.audioUnlocked) return;
    if (this.isInWarmup()) return;
    
    const now = Date.now();
    if (now - this.lastBeepTime < this.MIN_BEEP_INTERVAL_MS) return;
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Vibración
      if (navigator.vibrate) {
        navigator.vibrate([50, 30, 80]);
      }
      
      const t = this.audioContext.currentTime;
      
      // LUB (S1) - MÁS FUERTE
      const lub = this.audioContext.createOscillator();
      const lubGain = this.audioContext.createGain();
      const lubFilter = this.audioContext.createBiquadFilter();
      
      lub.type = 'sine';
      lub.frequency.setValueAtTime(65, t);
      lub.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      
      lubFilter.type = 'lowpass';
      lubFilter.frequency.value = 150;
      
      lubGain.gain.setValueAtTime(0, t);
      lubGain.gain.linearRampToValueAtTime(1.5, t + 0.02); // Más volumen
      lubGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      
      lub.connect(lubFilter);
      lubFilter.connect(lubGain);
      lubGain.connect(this.audioContext.destination);
      
      lub.start(t);
      lub.stop(t + 0.18);
      
      // DUB (S2) - MÁS FUERTE
      const dub = this.audioContext.createOscillator();
      const dubGain = this.audioContext.createGain();
      const dubFilter = this.audioContext.createBiquadFilter();
      
      const dubStart = t + 0.12;
      
      dub.type = 'sine';
      dub.frequency.setValueAtTime(85, dubStart);
      dub.frequency.exponentialRampToValueAtTime(55, dubStart + 0.08);
      
      dubFilter.type = 'lowpass';
      dubFilter.frequency.value = 180;
      
      dubGain.gain.setValueAtTime(0, dubStart);
      dubGain.gain.linearRampToValueAtTime(1.2, dubStart + 0.015); // Más volumen
      dubGain.gain.exponentialRampToValueAtTime(0.01, dubStart + 0.12);
      
      dub.connect(dubFilter);
      dubFilter.connect(dubGain);
      dubGain.connect(this.audioContext.destination);
      
      dub.start(dubStart);
      dub.stop(dubStart + 0.15);
      
      this.lastBeepTime = now;
    } catch (error) {}
  }

  private isInWarmup(): boolean {
    return Date.now() - this.startTime < this.WARMUP_TIME_MS;
  }

  /**
   * PROCESAMIENTO PRINCIPAL - Detección robusta por ventana deslizante
   */
  processSignal(value: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // === 1. GUARDAR EN BUFFER CON TIMESTAMP ===
    this.signalBuffer.push({ value, time: now });
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // No procesar hasta tener suficientes muestras
    if (this.signalBuffer.length < this.WINDOW_SIZE * 2 + 1) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: value, arrhythmiaCount: 0 };
    }
    
    // === 2. CALCULAR AMPLITUD DEL BUFFER RECIENTE ===
    const recentValues = this.signalBuffer.slice(-30).map(s => s.value);
    const recentMax = Math.max(...recentValues);
    const recentMin = Math.min(...recentValues);
    const amplitude = recentMax - recentMin;
    
    // Guardar historial de amplitudes para umbral
    this.amplitudeHistory.push(amplitude);
    if (this.amplitudeHistory.length > this.AMPLITUDE_HISTORY_SIZE) {
      this.amplitudeHistory.shift();
    }
    
    // === 3. CALCULAR UMBRAL DINÁMICO ===
    // Umbral = 30% de la amplitud mediana reciente
    const sortedAmps = [...this.amplitudeHistory].sort((a, b) => a - b);
    const medianAmp = sortedAmps[Math.floor(sortedAmps.length / 2)] || 0;
    const threshold = medianAmp * 0.30;
    
    // === 4. VERIFICAR SI HAY UN PICO EN EL CENTRO DE LA VENTANA ===
    // Miramos el punto que está WINDOW_SIZE muestras atrás (para tener contexto a ambos lados)
    const centerIdx = this.signalBuffer.length - 1 - this.WINDOW_SIZE;
    if (centerIdx < this.WINDOW_SIZE) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: value, arrhythmiaCount: 0 };
    }
    
    const centerSample = this.signalBuffer[centerIdx];
    const centerValue = centerSample.value;
    const centerTime = centerSample.time;
    
    // Verificar si es máximo local en la ventana
    let isLocalMax = true;
    const windowStart = centerIdx - this.WINDOW_SIZE;
    const windowEnd = centerIdx + this.WINDOW_SIZE;
    
    for (let i = windowStart; i <= windowEnd; i++) {
      if (i !== centerIdx && this.signalBuffer[i].value >= centerValue) {
        isLocalMax = false;
        break;
      }
    }
    
    // === 5. VALIDAR PICO ===
    let isPeak = false;
    let confidence = 0;
    
    const timeSinceLastPeak = this.lastPeakTime > 0 ? centerTime - this.lastPeakTime : 10000;
    
    // Condiciones para pico válido:
    // 1. Es máximo local en la ventana
    // 2. Ha pasado el período refractario
    // 3. La amplitud supera el umbral mínimo
    // 4. El valor está en la parte superior del rango (> 60% del rango)
    const valueInRange = amplitude > 0 ? (centerValue - recentMin) / amplitude : 0;
    
    if (
      isLocalMax && 
      timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS &&
      amplitude >= threshold &&
      valueInRange > 0.6 && // El pico debe estar en el 40% superior
      amplitude > 0.5 // Amplitud absoluta mínima
    ) {
      isPeak = true;
      this.peakCount++;
      
      // Calcular RR interval
      if (this.lastPeakTime > 0) {
        const rr = timeSinceLastPeak;
        
        if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(rr);
          if (this.rrIntervals.length > 20) {
            this.rrIntervals.shift();
          }
          
          // Actualizar BPM
          const instantBPM = 60000 / rr;
          this.updateBPM(instantBPM);
        }
      }
      
      // Actualizar estado
      this.lastPeakTime = centerTime;
      this.lastPeakValue = centerValue;
      
      // Calcular confianza
      confidence = this.calculateConfidence(amplitude);
      
      // Reproducir sonido
      if (!this.isInWarmup()) {
        this.playHeartSound();
      }
    }
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`💓 BPM=${this.smoothBPM.toFixed(0)}, picos=${this.peakCount}, RR=${this.rrIntervals.length}, amp=${amplitude.toFixed(2)}`);
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence,
      isPeak,
      filteredValue: value,
      arrhythmiaCount: 0
    };
  }

  /**
   * Actualiza BPM con suavizado
   */
  private updateBPM(instantBPM: number): void {
    if (instantBPM < this.MIN_BPM || instantBPM > this.MAX_BPM) return;
    
    this.bpmHistory.push(instantBPM);
    if (this.bpmHistory.length > 10) {
      this.bpmHistory.shift();
    }
    
    if (this.bpmHistory.length < 2) {
      this.smoothBPM = instantBPM;
      return;
    }
    
    // Usar mediana para ser robusto a outliers
    const sorted = [...this.bpmHistory].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    // Suavizado hacia la mediana
    const alpha = 0.3;
    this.smoothBPM = this.smoothBPM * (1 - alpha) + median * alpha;
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
  }

  /**
   * Calcula confianza
   */
  private calculateConfidence(amplitude: number): number {
    let confidence = 0.5;
    
    if (this.peakCount > 3) confidence += 0.1;
    if (this.peakCount > 6) confidence += 0.1;
    
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean;
      
      if (cv < 0.1) confidence += 0.2;
      else if (cv < 0.2) confidence += 0.1;
    }
    
    return Math.min(1, confidence);
  }

  getSmoothBPM(): number {
    return this.smoothBPM;
  }
  
  getRRIntervals(): number[] {
    return [...this.rrIntervals];
  }
  
  getLastPeakTime(): number | null {
    return this.lastPeakTime > 0 ? this.lastPeakTime : null;
  }
  
  setArrhythmiaDetected(isDetected: boolean): void {
    this.isArrhythmiaDetected = isDetected;
  }
  
  setFingerDetected(_detected: boolean): void {}

  reset(): void {
    this.signalBuffer = [];
    this.amplitudeHistory = [];
    this.bpmHistory = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.lastPeakValue = 0;
    this.peakCount = 0;
    this.startTime = Date.now();
    this.frameCount = 0;
  }

  dispose(): void {
    this.removeAudioListeners();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.reset();
  }
}
