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
  private readonly MIN_PEAK_INTERVAL_MS = 300;  // 200 BPM máx (era 333)
  private readonly MAX_PEAK_INTERVAL_MS = 2000; // 30 BPM mín (era 1500) - más tolerante
  private readonly WARMUP_TIME_MS = 1000;       // 1 segundo warmup (era 2)
  
  // Buffers - OPTIMIZADOS para 30fps
  private signalBuffer: number[] = [];
  private normalizedBuffer: number[] = [];
  private readonly BUFFER_SIZE = 45; // 1.5s @ 30fps
  
  // Baseline - MÁS RÁPIDO
  private baselineBuffer: number[] = [];
  private readonly BASELINE_SIZE = 20; // ~0.7s @ 30fps
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
  
  // Detección de movimiento - MÁS TOLERANTE
  private readonly MOTION_THRESHOLD = 25;      // Era 12 - mucho más tolerante
  private readonly MOTION_COOLDOWN_MS = 200;   // Era 400 - más rápido
  private lastMotionTime: number = 0;
  private consecutiveStableFrames: number = 0;
  private readonly MIN_STABLE_FRAMES = 4;      // Era 10 - mucho menos exigente
  private lastNormalizedValue: number = 0;
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioInitialized: boolean = false;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  // Detección de dedo por canal verde
  private lastGreenValue: number = 0;
  private readonly GREEN_THRESHOLD = 50; // G > 50 = ambiente, G < 50 = dedo
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

  // Guardamos referencia para poder remover listeners
  private unlockHandler: (() => Promise<void>) | null = null;
  
  private setupAudioUnlock() {
    this.unlockHandler = async () => {
      if (this.audioUnlocked) {
        // Ya desbloqueado - remover listeners para liberar memoria
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
        this.audioInitialized = true;
        
        // CRÍTICO: Remover listeners después de desbloquear
        this.removeAudioListeners();
        console.log('🔊 Audio desbloqueado');
      } catch (e) {
        console.error('❌ Error desbloqueando audio:', e);
      }
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
    // VIBRACIÓN SIEMPRE - independiente del audio
    if (navigator.vibrate) {
      navigator.vibrate([50, 30, 80]);
    }
    
    if (!this.audioContext || !this.audioUnlocked) return;
    if (this.isInWarmup()) return;
    
    const now = Date.now();
    if (now - this.lastBeepTime < this.MIN_BEEP_INTERVAL_MS) return;
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      const t = this.audioContext.currentTime;
      
      // ===== SONIDO DE LATIDO CARDÍACO - VOLUMEN MÁXIMO =====
      // Crear compresor para maximizar volumen
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-10, t);
      compressor.knee.setValueAtTime(40, t);
      compressor.ratio.setValueAtTime(12, t);
      compressor.attack.setValueAtTime(0, t);
      compressor.release.setValueAtTime(0.25, t);
      compressor.connect(this.audioContext.destination);
      
      // Ganancia master ALTA
      const masterGain = this.audioContext.createGain();
      masterGain.gain.value = 3.0; // VOLUMEN x3
      masterGain.connect(compressor);
      
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
      lubGain.connect(masterGain); // Conectar a master
      
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
      dubGain.connect(masterGain); // Conectar a master
      
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

  // Recibir valor verde para validar dedo
  setGreenValue(green: number): void {
    this.lastGreenValue = green;
  }
  
  // Verificar si hay dedo real (G bajo = sangre absorbiendo verde)
  private hasRealFinger(): boolean {
    return this.lastGreenValue < this.GREEN_THRESHOLD;
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
    
    // CRÍTICO: Si no hay dedo real, NO procesar picos
    if (!this.hasRealFinger()) {
      return {
        bpm: Math.round(this.smoothBPM),
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0
      };
    }
    
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
    
    // Detectar picos con menos restricciones
    const isStable = this.consecutiveStableFrames >= this.MIN_STABLE_FRAMES;
    const cooledDown = (now - this.lastMotionTime) > this.MOTION_COOLDOWN_MS;
    
    let peakResult = { isPeak: false, confidence: 0 };
    // REDUCIDO: solo necesitamos 20 frames en buffer (era 30)
    if ((isStable || cooledDown) && this.normalizedBuffer.length >= 20) {
      peakResult = this.detectPeak(now);
    }
    
    // Si hay pico, actualizar BPM, vibrar y sonar
    if (peakResult.isPeak && !this.isInWarmup()) {
      this.updateBPM();
      
      // VIBRACIÓN DIRECTA - sin log para rendimiento
      try {
        if (navigator.vibrate) {
          navigator.vibrate([50, 30, 80]);
        }
      } catch (e) {
        // Silenciado
      }
      
      this.playHeartSound(); // Audio separado
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
   * DETECCIÓN DE PICOS - CALIBRADO PARA SEÑALES PPG REALES
   * Los valores normalizados típicos son 1-50 (diferencia señal - baseline)
   */
  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.normalizedBuffer.length;
    if (n < 25) return { isPeak: false, confidence: 0 };
    
    // INTERVALO MÍNIMO FISIOLÓGICO: 300ms = 200 BPM máximo
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    const window = this.normalizedBuffer.slice(-25);
    
    // === ESTADÍSTICAS DE VENTANA ===
    const windowMean = window.reduce((a, b) => a + b, 0) / window.length;
    const windowStd = Math.sqrt(
      window.reduce((sum, v) => sum + Math.pow(v - windowMean, 2), 0) / window.length
    );
    const windowMin = Math.min(...window);
    const windowMax = Math.max(...window);
    const windowRange = windowMax - windowMin;
    
    // Log diagnóstico cada 90 frames (3 segundos)
    if (this.frameCount % 90 === 0) {
      console.log(`🔍 Signal: range=${windowRange.toFixed(1)}, std=${windowStd.toFixed(1)}, mean=${windowMean.toFixed(1)}`);
    }
    
    // REQUIERE SEÑAL MÍNIMA: rango > 2 (señales normalizadas típicas: 5-30)
    if (windowRange < 2 || windowRange > 200) {
      return { isPeak: false, confidence: 0 };
    }
    
    // === BUSCAR MÁXIMO EN REGIÓN CENTRAL ===
    const searchStart = 6;
    const searchEnd = 19;
    
    let maxIdx = searchStart;
    let maxVal = window[searchStart];
    for (let i = searchStart + 1; i < searchEnd; i++) {
      if (window[i] > maxVal) {
        maxVal = window[i];
        maxIdx = i;
      }
    }
    
    // UMBRAL ADAPTATIVO: debe estar significativamente sobre la media
    const adaptiveThreshold = windowMean + windowStd * 1.5;
    if (maxVal < adaptiveThreshold) {
      return { isPeak: false, confidence: 0 };
    }
    
    // === VALIDACIÓN DE FORMA DE PICO (LATIGAZO) ===
    // Pico real: subida rápida + bajada rápida
    const leftVals = [window[maxIdx - 3], window[maxIdx - 2], window[maxIdx - 1]];
    const rightVals = [window[maxIdx + 1], window[maxIdx + 2], window[maxIdx + 3]];
    
    const leftMin = Math.min(...leftVals.filter(v => v !== undefined));
    const rightMin = Math.min(...rightVals.filter(v => v !== undefined));
    
    // Prominencia: altura del pico sobre los valles
    const prominence = maxVal - Math.min(leftMin, rightMin);
    
    // PROMINENCIA MÍNIMA ADAPTATIVA: basada en std pero con mínimo absoluto
    const minProminence = Math.max(1.5, windowStd * 0.6);
    
    if (prominence < minProminence) {
      return { isPeak: false, confidence: 0 };
    }
    
    // VERIFICAR FORMA DE LATIGAZO: debe bajar a ambos lados
    const dropsLeft = maxVal > leftMin + prominence * 0.3;
    const dropsRight = maxVal > rightMin + prominence * 0.3;
    
    if (!dropsLeft || !dropsRight) {
      return { isPeak: false, confidence: 0 };
    }
    
    // === VALIDACIÓN TEMPORAL ===
    if (this.rrIntervals.length >= 4 && this.lastPeakTime) {
      const expectedInterval = this.expectedPeakInterval;
      const currentInterval = now - this.lastPeakTime;
      const deviation = Math.abs(currentInterval - expectedInterval) / expectedInterval;
      
      // Rechazar si es MUY diferente al ritmo establecido (>70%) y prominencia baja
      if (deviation > 0.7 && prominence < minProminence * 2) {
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
    
    // Confianza basada en prominencia relativa
    const prominenceScore = Math.min(1, prominence / (windowStd * 3));
    const consistencyScore = this.validPeakCount > 5 ? 0.2 : 0;
    const confidence = Math.min(1, 0.5 + prominenceScore * 0.3 + consistencyScore);
    
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
    // CRÍTICO: Remover listeners de audio primero
    this.removeAudioListeners();
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.reset();
  }
}
