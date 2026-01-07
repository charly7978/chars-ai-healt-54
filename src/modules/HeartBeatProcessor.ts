/**
 * PROCESADOR DE LATIDOS CARDÍACOS - CON AUDIO MEJORADO
 */
export class HeartBeatProcessor {
  // Configuración fisiológica
  private readonly MIN_BPM = 45;
  private readonly MAX_BPM = 170;
  private readonly MIN_PEAK_INTERVAL_MS = 353;
  private readonly MAX_PEAK_INTERVAL_MS = 1333;
  private readonly WARMUP_TIME_MS = 2000;
  
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
  private readonly BPM_SMOOTHING = 0.12;
  
  // RR intervals
  private rrIntervals: number[] = [];
  
  // Detección de movimiento
  private readonly MOTION_THRESHOLD = 15;
  private readonly MOTION_COOLDOWN_MS = 400;
  private lastMotionTime: number = 0;
  private consecutiveStableFrames: number = 0;
  private readonly MIN_STABLE_FRAMES = 8;
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
  private wasFingerDetected: boolean = false;
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
      
      const currentTime = this.audioContext.currentTime;
      
      // BEEP claro
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, currentTime);
      gain.gain.linearRampToValueAtTime(this.BEEP_VOLUME, currentTime + 0.01);
      gain.gain.setValueAtTime(this.BEEP_VOLUME, currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.15);
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(currentTime);
      osc.stop(currentTime + 0.2);
      
      // Segundo tono
      const osc2 = this.audioContext.createOscillator();
      const gain2 = this.audioContext.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 660;
      const dubTime = currentTime + 0.12;
      gain2.gain.setValueAtTime(0, dubTime);
      gain2.gain.linearRampToValueAtTime(this.BEEP_VOLUME * 0.7, dubTime + 0.01);
      gain2.gain.exponentialRampToValueAtTime(0.001, dubTime + 0.12);
      osc2.connect(gain2);
      gain2.connect(this.audioContext.destination);
      osc2.start(dubTime);
      osc2.stop(dubTime + 0.15);
      
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
    signalQuality?: number;
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
    if (this.frameCount % 45 === 0) {
      console.log(`💓 BPM=${this.smoothBPM.toFixed(0)}, picos=${this.validPeakCount}, estable=${isStable}`);
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: peakResult.confidence,
      isPeak: peakResult.isPeak,
      filteredValue: normalized,
      arrhythmiaCount: 0,
      signalQuality: this.calculateSignalQuality()
    };
  }

  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.normalizedBuffer.length;
    if (n < 30) return { isPeak: false, confidence: 0 };
    
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    const window = this.normalizedBuffer.slice(-30);
    const searchStart = 10;
    const searchEnd = 25;
    
    let maxIdx = searchStart;
    let maxVal = window[searchStart];
    for (let i = searchStart + 1; i < searchEnd; i++) {
      if (window[i] > maxVal) {
        maxVal = window[i];
        maxIdx = i;
      }
    }
    
    const leftNeighbor = Math.max(window[maxIdx - 3] || 0, window[maxIdx - 2] || 0);
    const rightNeighbor = Math.max(window[maxIdx + 2] || 0, window[maxIdx + 3] || 0);
    
    if (maxVal <= leftNeighbor || maxVal <= rightNeighbor) {
      return { isPeak: false, confidence: 0 };
    }
    
    const prominence = maxVal - Math.max(leftNeighbor, rightNeighbor);
    
    if (prominence < 0.05 || prominence > 15) {
      return { isPeak: false, confidence: 0 };
    }
    
    const windowMin = Math.min(...window);
    const windowMax = Math.max(...window);
    const windowRange = windowMax - windowMin;
    
    if (windowRange < 0.15 || windowRange > 25) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Pico válido
    this.validPeakCount++;
    console.log(`✓ PICO #${this.validPeakCount}`);
    
    this.previousPeakTime = this.lastPeakTime;
    this.lastPeakTime = now;
    
    if (this.previousPeakTime) {
      const rr = now - this.previousPeakTime;
      if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
        this.rrIntervals.push(rr);
        if (this.rrIntervals.length > 30) {
          this.rrIntervals.shift();
        }
        this.expectedPeakInterval = this.expectedPeakInterval * 0.8 + rr * 0.2;
      }
    }
    
    const confidence = Math.min(1, 0.5 + (prominence / 5) * 0.3 + (this.validPeakCount > 5 ? 0.2 : 0));
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

  private calculateSignalQuality(): number {
    if (this.normalizedBuffer.length < 30) return 0;
    
    let quality = 0;
    
    if (this.consecutiveStableFrames > 60) quality = 40;
    else if (this.consecutiveStableFrames > 30) quality = 25;
    else if (this.consecutiveStableFrames > 15) quality = 15;
    else quality = 5;
    
    if (this.smoothBPM >= 50 && this.smoothBPM <= 120 && this.validPeakCount >= 3) {
      quality += 30;
    }
    
    if (this.validPeakCount > 10) quality += 30;
    else if (this.validPeakCount > 5) quality += 20;
    else if (this.validPeakCount > 2) quality += 10;
    
    return Math.min(100, quality);
  }

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
      this.reset();
    }
    this.wasFingerDetected = detected;
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
