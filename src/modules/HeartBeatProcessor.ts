/**
 * PROCESADOR DE LATIDOS CARDÍACOS - VERSIÓN ROBUSTA
 * 
 * Algoritmo basado en:
 * - Detección de picos por DERIVADA (slope change)
 * - Umbral adaptativo mínimo
 * - Validación temporal simple
 * 
 * Referencias:
 * - Vadrevu & Manikandan (2019) "A Robust Pulse Onset and Peak Detection Method"
 * - NeuroKit2 ECG peak detection
 */
export class HeartBeatProcessor {
  // Configuración fisiológica
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 200;
  private readonly MIN_PEAK_INTERVAL_MS = 300;  // 200 BPM máx
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM mín
  private readonly WARMUP_TIME_MS = 800;        // Warmup corto
  
  // Buffers
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 45; // ~1.5s a 30fps - suficiente
  
  // Baseline adaptativo
  private baseline: number = 0;
  private baselineAlpha: number = 0.02; // Filtro lento para baseline
  
  // Detección de picos por DERIVADA
  private lastDerivative: number = 0;
  private wasRising: boolean = false;
  
  // Estado de picos
  private lastPeakTime: number = 0;
  private previousPeakTime: number = 0;
  private lastPeakValue: number = 0;
  private peakCount: number = 0;
  
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
      
      // LUB (S1)
      const lub = this.audioContext.createOscillator();
      const lubGain = this.audioContext.createGain();
      const lubFilter = this.audioContext.createBiquadFilter();
      
      lub.type = 'sine';
      lub.frequency.setValueAtTime(65, t);
      lub.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      
      lubFilter.type = 'lowpass';
      lubFilter.frequency.value = 150;
      
      lubGain.gain.setValueAtTime(0, t);
      lubGain.gain.linearRampToValueAtTime(1, t + 0.02);
      lubGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      
      lub.connect(lubFilter);
      lubFilter.connect(lubGain);
      lubGain.connect(this.audioContext.destination);
      
      lub.start(t);
      lub.stop(t + 0.18);
      
      // DUB (S2)
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
      dubGain.gain.linearRampToValueAtTime(0.7, dubStart + 0.015);
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
   * PROCESAMIENTO PRINCIPAL - Algoritmo simplificado y robusto
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
    
    // === 1. ACTUALIZAR BASELINE ADAPTATIVO ===
    if (this.baseline === 0) {
      this.baseline = value;
    } else {
      this.baseline = this.baseline * (1 - this.baselineAlpha) + value * this.baselineAlpha;
    }
    
    // Señal normalizada
    const normalized = value - this.baseline;
    
    // Guardar en buffer
    this.signalBuffer.push(normalized);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // No procesar hasta tener suficientes muestras
    if (this.signalBuffer.length < 10) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: normalized, arrhythmiaCount: 0 };
    }
    
    // === 2. DETECTAR PICO POR CAMBIO DE PENDIENTE ===
    // Derivada = diferencia entre valores consecutivos
    const derivative = normalized - (this.signalBuffer[this.signalBuffer.length - 2] || 0);
    
    // Detectar transición: subiendo → bajando = PICO
    const isRising = derivative > 0;
    const isPeakCandidate = this.wasRising && !isRising && normalized > 0;
    
    this.wasRising = isRising;
    this.lastDerivative = derivative;
    
    let isPeak = false;
    let confidence = 0;
    
    if (isPeakCandidate) {
      // === 3. VALIDACIONES MÍNIMAS ===
      const timeSinceLastPeak = now - this.lastPeakTime;
      
      // Validación temporal: respetar intervalo mínimo
      if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
        
        // Validación de amplitud: el pico debe tener cierta altura
        const recentBuffer = this.signalBuffer.slice(-15);
        const bufferMax = Math.max(...recentBuffer);
        const bufferMin = Math.min(...recentBuffer);
        const amplitude = bufferMax - bufferMin;
        
        // Solo requiere amplitud mínima (señal tiene variación)
        if (amplitude > 0.1) {
          // Verificar que el valor actual está cerca del máximo
          const isNearMax = normalized >= bufferMax * 0.7;
          
          if (isNearMax) {
            // === PICO VÁLIDO ===
            isPeak = true;
            this.peakCount++;
            
            this.previousPeakTime = this.lastPeakTime;
            this.lastPeakTime = now;
            this.lastPeakValue = normalized;
            
            // Calcular RR interval
            if (this.previousPeakTime > 0) {
              const rr = now - this.previousPeakTime;
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
            
            // Calcular confianza basada en consistencia
            confidence = this.calculateConfidence(amplitude);
            
            // Reproducir sonido
            if (!this.isInWarmup()) {
              this.playHeartSound();
            }
          }
        }
      }
    }
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`💓 BPM=${this.smoothBPM.toFixed(0)}, picos=${this.peakCount}, RR=${this.rrIntervals.length}`);
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence,
      isPeak,
      filteredValue: normalized,
      arrhythmiaCount: 0
    };
  }

  /**
   * Actualiza BPM con suavizado adaptativo
   */
  private updateBPM(instantBPM: number): void {
    if (instantBPM < this.MIN_BPM || instantBPM > this.MAX_BPM) return;
    
    this.bpmHistory.push(instantBPM);
    if (this.bpmHistory.length > 10) {
      this.bpmHistory.shift();
    }
    
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      // Suavizado más agresivo para valores cercanos
      const diff = Math.abs(instantBPM - this.smoothBPM);
      let alpha: number;
      
      if (diff > 30) {
        alpha = 0.1;  // Cambio grande = suavizar mucho
      } else if (diff > 15) {
        alpha = 0.2;
      } else {
        alpha = 0.4;  // Cambio pequeño = responder rápido
      }
      
      this.smoothBPM = this.smoothBPM * (1 - alpha) + instantBPM * alpha;
    }
    
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
  }

  /**
   * Calcula confianza basada en consistencia de RR
   */
  private calculateConfidence(amplitude: number): number {
    let confidence = 0.5; // Base
    
    // Más picos detectados = más confianza
    if (this.peakCount > 3) confidence += 0.1;
    if (this.peakCount > 6) confidence += 0.1;
    
    // Consistencia de RR intervals
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean; // Coeficiente de variación
      
      // CV bajo = ritmo consistente = mayor confianza
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
  
  setFingerDetected(_detected: boolean): void {
    // No-op
  }

  reset(): void {
    this.signalBuffer = [];
    this.bpmHistory = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.previousPeakTime = 0;
    this.lastPeakValue = 0;
    this.peakCount = 0;
    this.baseline = 0;
    this.wasRising = false;
    this.lastDerivative = 0;
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
