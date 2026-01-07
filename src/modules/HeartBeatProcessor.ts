/**
 * PROCESADOR DE LATIDOS CARDÍACOS - VERSIÓN DIRECTA SIN FINGER DETECTION
 * 
 * PRINCIPIO: La señal entra → se procesa → sale
 * Si hay sangre real: BPM coherente, picos regulares
 * Si hay ambiente: valores erráticos o 0
 * 
 * NO valida si hay "dedo" - la calidad de la señal es la que determina si hay pulso real
 */
export class HeartBeatProcessor {
  // Configuración fisiológica
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333;  // 180 BPM máx
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM mín
  private readonly WARMUP_TIME_MS = 2000;       // 2 segundos warmup
  
  // Buffers
  private signalBuffer: number[] = [];
  private normalizedBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90;
  
  // Baseline
  private baselineBuffer: number[] = [];
  private readonly BASELINE_SIZE = 45;
  private baseline: number = 0;
  
  // Detección de picos
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  private validPeakCount: number = 0;
  private expectedPeakInterval: number = 800;
  
  // BPM
  private bpmHistory: number[] = [];
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.15;
  
  // RR intervals
  private rrIntervals: number[] = [];
  
  // Detección de movimiento
  private readonly MOTION_THRESHOLD = 12;
  private readonly MOTION_COOLDOWN_MS = 400;
  private lastMotionTime: number = 0;
  private consecutiveStableFrames: number = 0;
  private readonly MIN_STABLE_FRAMES = 10;
  private lastNormalizedValue: number = 0;
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioInitialized: boolean = false;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  private readonly BEEP_VOLUME = 1.0;
  private readonly MIN_BEEP_INTERVAL_MS = 350;
  
  // Estado
  private startTime: number = 0;
  private isArrhythmiaDetected: boolean = false;
  private frameCount: number = 0;

  constructor() {
    this.startTime = Date.now();
    this.initAudio();
    this.setupAudioUnlock();
  }

  private setupAudioUnlock() {
    const unlock = async () => {
      if (this.audioUnlocked) return;
      
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
        this.audioInitialized = true;
        console.log('🔊 Audio desbloqueado');
      } catch (e) {
        console.error('❌ Error desbloqueando audio:', e);
      }
    };

    ['touchstart', 'touchend', 'click', 'pointerdown'].forEach(event => {
      document.addEventListener(event, unlock, { once: false, passive: true });
    });
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
      
      // ===== SONIDO DE LATIDO CARDÍACO REALISTA =====
      // LUB (S1) - Cierre de válvulas mitral y tricúspide
      const lub = this.audioContext.createOscillator();
      const lubGain = this.audioContext.createGain();
      const lubFilter = this.audioContext.createBiquadFilter();
      
      lub.type = 'sine';
      lub.frequency.setValueAtTime(65, t);
      lub.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      
      lubFilter.type = 'lowpass';
      lubFilter.frequency.value = 150;
      lubFilter.Q.value = 1;
      
      lubGain.gain.setValueAtTime(0, t);
      lubGain.gain.linearRampToValueAtTime(this.BEEP_VOLUME, t + 0.02);
      lubGain.gain.setValueAtTime(this.BEEP_VOLUME, t + 0.05);
      lubGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      
      lub.connect(lubFilter);
      lubFilter.connect(lubGain);
      lubGain.connect(this.audioContext.destination);
      
      lub.start(t);
      lub.stop(t + 0.18);
      
      // DUB (S2) - Cierre de válvulas aórtica y pulmonar
      const dub = this.audioContext.createOscillator();
      const dubGain = this.audioContext.createGain();
      const dubFilter = this.audioContext.createBiquadFilter();
      
      const dubStart = t + 0.12;
      
      dub.type = 'sine';
      dub.frequency.setValueAtTime(85, dubStart);
      dub.frequency.exponentialRampToValueAtTime(55, dubStart + 0.08);
      
      dubFilter.type = 'lowpass';
      dubFilter.frequency.value = 180;
      dubFilter.Q.value = 0.8;
      
      dubGain.gain.setValueAtTime(0, dubStart);
      dubGain.gain.linearRampToValueAtTime(this.BEEP_VOLUME * 0.7, dubStart + 0.015);
      dubGain.gain.setValueAtTime(this.BEEP_VOLUME * 0.7, dubStart + 0.04);
      dubGain.gain.exponentialRampToValueAtTime(0.01, dubStart + 0.12);
      
      dub.connect(dubFilter);
      dubFilter.connect(dubGain);
      dubGain.connect(this.audioContext.destination);
      
      dub.start(dubStart);
      dub.stop(dubStart + 0.15);
      
      this.lastBeepTime = now;
      
    } catch (error) {
      // Silenciar
    }
  }

  private isInWarmup(): boolean {
    return Date.now() - this.startTime < this.WARMUP_TIME_MS;
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
    
    // Actualizar baseline
    this.baselineBuffer.push(value);
    if (this.baselineBuffer.length > this.BASELINE_SIZE) {
      this.baselineBuffer.shift();
    }
    this.baseline = this.baselineBuffer.reduce((a, b) => a + b, 0) / this.baselineBuffer.length;
    
    // Normalizar
    const normalized = value - this.baseline;
    
    // Detección de movimiento
    const jump = Math.abs(normalized - this.lastNormalizedValue);
    const isMotionArtifact = jump > this.MOTION_THRESHOLD;
    
    if (isMotionArtifact) {
      this.lastMotionTime = now;
      this.consecutiveStableFrames = 0;
    } else {
      this.consecutiveStableFrames++;
    }
    
    this.lastNormalizedValue = normalized;
    
    // Guardar en buffers
    this.signalBuffer.push(value);
    this.normalizedBuffer.push(normalized);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
      this.normalizedBuffer.shift();
    }
    
    // Detectar picos si hay estabilidad
    const isStable = this.consecutiveStableFrames >= this.MIN_STABLE_FRAMES;
    const cooledDown = (now - this.lastMotionTime) > this.MOTION_COOLDOWN_MS;
    
    let peakResult = { isPeak: false, confidence: 0 };
    if (isStable && cooledDown && this.normalizedBuffer.length >= 30) {
      peakResult = this.detectPeak(now);
    }
    
    // Si hay pico, actualizar BPM y sonar
    if (peakResult.isPeak && !this.isInWarmup()) {
      this.updateBPM();
      this.playHeartSound();
    }
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`💓 BPM=${this.smoothBPM.toFixed(0)}, picos=${this.validPeakCount}, estable=${isStable}`);
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: peakResult.confidence,
      isPeak: peakResult.isPeak,
      filteredValue: normalized,
      arrhythmiaCount: 0
    };
  }

  /**
   * DETECCIÓN DE PICOS MEJORADA
   * Basado en Vadrevu & Manikandan 2019 (IEEE Trans. Instrum. Meas.)
   */
  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.normalizedBuffer.length;
    if (n < 30) return { isPeak: false, confidence: 0 };
    
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    const window = this.normalizedBuffer.slice(-30);
    
    // === UMBRAL ADAPTATIVO ===
    const windowMean = window.reduce((a, b) => a + b, 0) / window.length;
    const windowStd = Math.sqrt(
      window.reduce((sum, v) => sum + Math.pow(v - windowMean, 2), 0) / window.length
    );
    
    // Umbral dinámico
    const adaptiveThreshold = windowMean + windowStd * 0.4;
    
    // Buscar máximo en región central
    const searchStart = 8;
    const searchEnd = 22;
    
    let maxIdx = searchStart;
    let maxVal = window[searchStart];
    for (let i = searchStart + 1; i < searchEnd; i++) {
      if (window[i] > maxVal) {
        maxVal = window[i];
        maxIdx = i;
      }
    }
    
    // Debe superar umbral adaptativo
    if (maxVal < adaptiveThreshold) {
      return { isPeak: false, confidence: 0 };
    }
    
    // === VALIDACIÓN DE PROMINENCIA ===
    const leftNeighbors = [
      window[maxIdx - 4] ?? 0,
      window[maxIdx - 3] ?? 0,
      window[maxIdx - 2] ?? 0
    ];
    const rightNeighbors = [
      window[maxIdx + 2] ?? 0,
      window[maxIdx + 3] ?? 0,
      window[maxIdx + 4] ?? 0
    ];
    
    const leftMax = Math.max(...leftNeighbors);
    const rightMax = Math.max(...rightNeighbors);
    
    // Debe ser mayor que ambos lados
    if (maxVal <= leftMax || maxVal <= rightMax) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Calcular prominencia
    const prominence = maxVal - Math.max(leftMax, rightMax);
    
    // Prominencia mínima relativa a la señal
    const minProminence = Math.max(0.02, windowStd * 0.25);
    if (prominence < minProminence || prominence > 25) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Validar rango de ventana
    const windowMin = Math.min(...window);
    const windowMax = Math.max(...window);
    const windowRange = windowMax - windowMin;
    
    if (windowRange < 0.05 || windowRange > 40) {
      return { isPeak: false, confidence: 0 };
    }
    
    // === VALIDACIÓN TEMPORAL ===
    if (this.rrIntervals.length >= 3 && this.lastPeakTime) {
      const expectedInterval = this.expectedPeakInterval;
      const currentInterval = now - this.lastPeakTime;
      const deviation = Math.abs(currentInterval - expectedInterval) / expectedInterval;
      
      if (deviation > 0.5 && prominence < minProminence * 2) {
        return { isPeak: false, confidence: 0 };
      }
    }
    
    // === PICO VÁLIDO ===
    this.validPeakCount++;
    
    this.previousPeakTime = this.lastPeakTime;
    this.lastPeakTime = now;
    
    if (this.previousPeakTime) {
      const rr = now - this.previousPeakTime;
      if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
        this.rrIntervals.push(rr);
        if (this.rrIntervals.length > 30) {
          this.rrIntervals.shift();
        }
        this.expectedPeakInterval = this.expectedPeakInterval * 0.7 + rr * 0.3;
      }
    }
    
    // Confianza basada en prominencia y consistencia
    const prominenceScore = Math.min(1, prominence / (windowStd * 2));
    const consistencyScore = this.validPeakCount > 5 ? 0.2 : 0;
    const confidence = Math.min(1, 0.4 + prominenceScore * 0.4 + consistencyScore);
    
    return { isPeak: true, confidence };
  }

  private updateBPM(): void {
    if (!this.lastPeakTime || !this.previousPeakTime) return;
    
    const interval = this.lastPeakTime - this.previousPeakTime;
    if (interval < this.MIN_PEAK_INTERVAL_MS || interval > this.MAX_PEAK_INTERVAL_MS) return;
    
    const instantBPM = 60000 / interval;
    
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      const diff = Math.abs(instantBPM - this.smoothBPM);
      if (diff > 25) {
        this.smoothBPM = this.smoothBPM * 0.95 + instantBPM * 0.05;
      } else if (diff > 15) {
        this.smoothBPM = this.smoothBPM * 0.9 + instantBPM * 0.1;
      } else {
        this.smoothBPM = this.smoothBPM * (1 - this.BPM_SMOOTHING) + instantBPM * this.BPM_SMOOTHING;
      }
    }
    
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
    
    this.bpmHistory.push(instantBPM);
    if (this.bpmHistory.length > 30) {
      this.bpmHistory.shift();
    }
  }

  // ELIMINADO: calculateSignalQuality ahora viene de SignalQualityAnalyzer
  // La calidad de señal es responsabilidad única de PPGSignalProcessor

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
  
  // Mantener por compatibilidad pero no hace nada
  setFingerDetected(_detected: boolean): void {
    // No-op: Ya no usamos detección de dedo
  }

  reset(): void {
    this.signalBuffer = [];
    this.normalizedBuffer = [];
    this.baselineBuffer = [];
    this.bpmHistory = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = null;
    this.previousPeakTime = null;
    this.validPeakCount = 0;
    this.consecutiveStableFrames = 0;
    this.lastMotionTime = 0;
    this.baseline = 0;
    this.lastNormalizedValue = 0;
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
