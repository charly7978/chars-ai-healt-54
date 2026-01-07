/**
 * PROCESADOR DE LATIDOS CARDÍACOS - CON AUDIO MEJORADO
 * 
 * Calibración v2: Umbrales ajustados para BPM más precisos
 */
export class HeartBeatProcessor {
  // Configuración fisiológica - MÁS ESTRICTA
  private readonly MIN_BPM = 45;
  private readonly MAX_BPM = 150; // Reducido de 170
  private readonly MIN_PEAK_INTERVAL_MS = 400;  // Aumentado de 353 (150 BPM máx)
  private readonly MAX_PEAK_INTERVAL_MS = 1333;
  private readonly WARMUP_TIME_MS = 2500; // Aumentado de 2000
  
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
  
  // Detección de movimiento - MÁS SENSIBLE
  private readonly MOTION_THRESHOLD = 12;  // Reducido de 15
  private readonly MOTION_COOLDOWN_MS = 500; // Aumentado de 400
  private lastMotionTime: number = 0;
  private consecutiveStableFrames: number = 0;
  private readonly MIN_STABLE_FRAMES = 12; // Aumentado de 8
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
      
      const t = this.audioContext.currentTime;
      
      // ===== SONIDO DE LATIDO CARDÍACO REALISTA =====
      // LUB (S1) - Cierre de válvulas mitral y tricúspide
      // Frecuencia baja ~60-80Hz, duración ~0.15s
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
      // Frecuencia ligeramente más alta ~80-100Hz, más corto
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

  /**
   * DETECCIÓN DE PICOS MEJORADA
   * Basado en Vadrevu & Manikandan 2019 (IEEE Trans. Instrum. Meas.)
   * "A Robust Pulse Onset and Peak Detection Method"
   * 
   * Usa umbral adaptativo y validación de prominencia
   */
  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.normalizedBuffer.length;
    if (n < 30) return { isPeak: false, confidence: 0 };
    
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    const window = this.normalizedBuffer.slice(-30);
    
    // === UMBRAL ADAPTATIVO (Vadrevu 2019) ===
    // Calcular estadísticas de ventana
    const windowMean = window.reduce((a, b) => a + b, 0) / window.length;
    const windowStd = Math.sqrt(
      window.reduce((sum, v) => sum + Math.pow(v - windowMean, 2), 0) / window.length
    );
    
    // Umbral dinámico: media + k*desviación
    const adaptiveThreshold = windowMean + windowStd * 0.5;
    
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
    // Usar vecinos más cercanos para mejor precisión
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
    const minProminence = Math.max(0.03, windowStd * 0.3);
    if (prominence < minProminence || prominence > 20) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Validar rango de ventana
    const windowMin = Math.min(...window);
    const windowMax = Math.max(...window);
    const windowRange = windowMax - windowMin;
    
    if (windowRange < 0.1 || windowRange > 30) {
      return { isPeak: false, confidence: 0 };
    }
    
    // === VALIDACIÓN TEMPORAL ===
    // Si tenemos historial, verificar consistencia con intervalos previos
    if (this.rrIntervals.length >= 3 && this.lastPeakTime) {
      const expectedInterval = this.expectedPeakInterval;
      const currentInterval = now - this.lastPeakTime;
      const deviation = Math.abs(currentInterval - expectedInterval) / expectedInterval;
      
      // Si el intervalo es muy diferente al esperado, ser más estricto
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
        // Actualizar intervalo esperado con más peso al nuevo
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
  
  /**
   * MANEJO DE DETECCIÓN DE DEDO - SIN RESET AGRESIVO
   * Ya no resetea al perder el dedo momentáneamente
   * Solo degrada suavemente los valores
   */
  setFingerDetected(detected: boolean): void {
    // NO hacer reset agresivo - causa pérdida de señal
    // El procesador mantiene su estado y degrada suavemente
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
