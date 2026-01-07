/**
 * PROCESADOR DE LATIDOS CARDÍACOS - VERSIÓN CON ANTI-ARTEFACTOS
 * 
 * PROBLEMA RESUELTO: Antes detectaba MOVIMIENTO del dedo como latidos.
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * 1. Detección de artefactos de movimiento (cambios bruscos = ignorar)
 * 2. Normalización de señal con baseline móvil
 * 3. Validación de intervalos fisiológicos estricta
 * 4. Requiere estabilidad antes de detectar picos
 * 
 * Un latido REAL tiene:
 * - Amplitud pequeña y consistente (no saltos gigantes)
 * - Intervalo regular entre 333ms-1500ms (40-180 BPM)
 * - Forma característica (subida gradual, bajada gradual)
 */
export class HeartBeatProcessor {
  // Configuración fisiológica
  private readonly MIN_BPM = 45;
  private readonly MAX_BPM = 170;
  private readonly MIN_PEAK_INTERVAL_MS = 353;  // 170 BPM máximo
  private readonly MAX_PEAK_INTERVAL_MS = 1333; // 45 BPM mínimo
  private readonly WARMUP_TIME_MS = 3000;       // 3s de calentamiento
  
  // Buffers
  private signalBuffer: number[] = [];
  private normalizedBuffer: number[] = [];
  private readonly BUFFER_SIZE = 180; // 6 segundos a 30fps
  
  // Baseline adaptativo para normalización
  private baselineBuffer: number[] = [];
  private readonly BASELINE_SIZE = 90; // 3 segundos
  private baseline: number = 0;
  
  // Estado de detección de picos
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  private validPeakCount: number = 0;
  private expectedPeakInterval: number = 800; // ~75 BPM inicial
  
  // BPM con historial para estabilidad
  private bpmHistory: number[] = [];
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.12;
  
  // Intervalos RR para análisis
  private rrIntervals: number[] = [];
  
  // ====== DETECCIÓN DE MOVIMIENTO / ARTEFACTOS ======
  private readonly MOTION_THRESHOLD = 8;       // Cambio máximo permitido (normalizado 0-100)
  private readonly MOTION_COOLDOWN_MS = 600;   // Tiempo de espera después de movimiento
  private lastMotionTime: number = 0;
  private consecutiveStableFrames: number = 0;
  private readonly MIN_STABLE_FRAMES = 15;     // Mínimo de frames estables antes de detectar
  private lastNormalizedValue: number = 0;
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioInitialized: boolean = false;
  private lastBeepTime: number = 0;
  private readonly BEEP_VOLUME = 0.8;
  private readonly MIN_BEEP_INTERVAL_MS = 400;
  
  // Estado
  private startTime: number = 0;
  private isArrhythmiaDetected: boolean = false;
  private wasFingerDetected: boolean = false;
  private frameCount: number = 0;

  constructor() {
    this.startTime = Date.now();
    this.initAudio();
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
    if (!this.audioContext || this.isInWarmup()) return;
    
    const now = Date.now();
    if (now - this.lastBeepTime < this.MIN_BEEP_INTERVAL_MS) return;
    
    try {
      if (navigator.vibrate) {
        navigator.vibrate([50, 30, 80]);
      }
      
      const currentTime = this.audioContext.currentTime;
      
      // LUB
      const osc1 = this.audioContext.createOscillator();
      const gain1 = this.audioContext.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = 150;
      gain1.gain.setValueAtTime(0, currentTime);
      gain1.gain.linearRampToValueAtTime(this.BEEP_VOLUME, currentTime + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.12);
      osc1.connect(gain1);
      gain1.connect(this.audioContext.destination);
      osc1.start(currentTime);
      osc1.stop(currentTime + 0.15);
      
      // DUB
      const osc2 = this.audioContext.createOscillator();
      const gain2 = this.audioContext.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 120;
      const dubStart = currentTime + 0.1;
      gain2.gain.setValueAtTime(0, dubStart);
      gain2.gain.linearRampToValueAtTime(this.BEEP_VOLUME * 0.8, dubStart + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, dubStart + 0.12);
      osc2.connect(gain2);
      gain2.connect(this.audioContext.destination);
      osc2.start(dubStart);
      osc2.stop(dubStart + 0.15);
      
      if (this.isArrhythmiaDetected) {
        const osc3 = this.audioContext.createOscillator();
        const gain3 = this.audioContext.createGain();
        osc3.type = 'sine';
        osc3.frequency.value = 440;
        const arrStart = dubStart + 0.15;
        gain3.gain.setValueAtTime(0, arrStart);
        gain3.gain.linearRampToValueAtTime(0.4, arrStart + 0.02);
        gain3.gain.exponentialRampToValueAtTime(0.001, arrStart + 0.1);
        osc3.connect(gain3);
        gain3.connect(this.audioContext.destination);
        osc3.start(arrStart);
        osc3.stop(arrStart + 0.15);
        this.isArrhythmiaDetected = false;
      }
      
      this.lastBeepTime = now;
    } catch (error) {
      // Silenciar
    }
  }

  private isInWarmup(): boolean {
    return Date.now() - this.startTime < this.WARMUP_TIME_MS;
  }

  /**
   * PROCESA UNA MUESTRA DE SEÑAL
   */
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
    
    // 1. Actualizar baseline (promedio móvil de la señal)
    this.baselineBuffer.push(value);
    if (this.baselineBuffer.length > this.BASELINE_SIZE) {
      this.baselineBuffer.shift();
    }
    this.baseline = this.baselineBuffer.reduce((a, b) => a + b, 0) / this.baselineBuffer.length;
    
    // 2. NORMALIZAR señal restando baseline (centra en 0)
    const normalized = value - this.baseline;
    
    // 3. DETECCIÓN DE MOVIMIENTO - cambio brusco = artefacto
    const jump = Math.abs(normalized - this.lastNormalizedValue);
    const isMotionArtifact = jump > this.MOTION_THRESHOLD;
    
    if (isMotionArtifact) {
      this.lastMotionTime = now;
      this.consecutiveStableFrames = 0;
      
      if (this.frameCount % 30 === 0) {
        console.log(`⚠️ MOVIMIENTO detectado: salto=${jump.toFixed(1)} (máx=${this.MOTION_THRESHOLD})`);
      }
    } else {
      this.consecutiveStableFrames++;
    }
    
    this.lastNormalizedValue = normalized;
    
    // 4. Guardar en buffers
    this.signalBuffer.push(value);
    this.normalizedBuffer.push(normalized);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
      this.normalizedBuffer.shift();
    }
    
    // 5. ¿Hay suficiente estabilidad para detectar picos?
    const isStable = this.consecutiveStableFrames >= this.MIN_STABLE_FRAMES;
    const timeSinceMotion = now - this.lastMotionTime;
    const cooledDown = timeSinceMotion > this.MOTION_COOLDOWN_MS;
    
    // 6. Solo detectar picos si hay estabilidad
    let peakResult = { isPeak: false, confidence: 0 };
    if (isStable && cooledDown && this.normalizedBuffer.length >= 45) {
      peakResult = this.detectPeak(now);
    }
    
    // 7. Si hay pico válido, actualizar BPM y sonar
    if (peakResult.isPeak && !this.isInWarmup()) {
      this.updateBPM();
      this.playHeartSound();
    }
    
    // 8. Log de debug
    if (this.frameCount % 90 === 0) {
      console.log(`💓 Estado: BPM=${this.smoothBPM.toFixed(0)}, estable=${isStable}, picos=${this.validPeakCount}, frames_estables=${this.consecutiveStableFrames}`);
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
   * DETECCIÓN DE PICOS - Busca máximos locales en señal ESTABLE
   * 
   * Criterios estrictos:
   * 1. Debe ser máximo local (mayor que vecinos)
   * 2. Amplitud debe estar en rango fisiológico (no gigante)
   * 3. Intervalo desde último pico debe ser fisiológico
   */
  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.normalizedBuffer.length;
    if (n < 45) return { isPeak: false, confidence: 0 };
    
    // Verificar intervalo mínimo desde último pico
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Obtener ventana de análisis (últimos ~1 segundo)
    const window = this.normalizedBuffer.slice(-30);
    
    // Buscar el punto máximo en la mitad posterior de la ventana
    // (el pico debería estar hace unos pocos frames, no en el frame actual)
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
    
    // Verificar que es un máximo LOCAL (mayor que vecinos cercanos)
    const leftNeighbor = Math.max(window[maxIdx - 3] || 0, window[maxIdx - 2] || 0);
    const rightNeighbor = Math.max(window[maxIdx + 2] || 0, window[maxIdx + 3] || 0);
    
    if (maxVal <= leftNeighbor || maxVal <= rightNeighbor) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Verificar amplitud del pico (diferencia entre max y vecinos)
    const prominence = maxVal - Math.max(leftNeighbor, rightNeighbor);
    
    // La prominencia debe ser significativa pero NO gigante
    // Latidos reales tienen prominencia de ~0.5-5, no 50+
    if (prominence < 0.3 || prominence > 20) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Verificar que la ventana completa tiene variación razonable
    const windowMin = Math.min(...window);
    const windowMax = Math.max(...window);
    const windowRange = windowMax - windowMin;
    
    // El rango debe ser razonable (no plano ni explosivo)
    if (windowRange < 0.5 || windowRange > 30) {
      return { isPeak: false, confidence: 0 };
    }
    
    // ¡PICO VÁLIDO DETECTADO!
    this.validPeakCount++;
    console.log(`✓ PICO #${this.validPeakCount} detectado: prominencia=${prominence.toFixed(2)}, rango=${windowRange.toFixed(2)}`);
    
    this.previousPeakTime = this.lastPeakTime;
    this.lastPeakTime = now;
    
    // Guardar intervalo RR si hay pico anterior
    if (this.previousPeakTime) {
      const rr = now - this.previousPeakTime;
      if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
        this.rrIntervals.push(rr);
        if (this.rrIntervals.length > 30) {
          this.rrIntervals.shift();
        }
        // Actualizar intervalo esperado
        this.expectedPeakInterval = this.expectedPeakInterval * 0.8 + rr * 0.2;
      }
    }
    
    const confidence = Math.min(1, 0.5 + (prominence / 5) * 0.3 + (this.validPeakCount > 5 ? 0.2 : 0));
    return { isPeak: true, confidence };
  }

  private updateBPM(): void {
    if (!this.lastPeakTime || !this.previousPeakTime) return;
    
    const interval = this.lastPeakTime - this.previousPeakTime;
    
    // Validar rango fisiológico estricto
    if (interval < this.MIN_PEAK_INTERVAL_MS || interval > this.MAX_PEAK_INTERVAL_MS) return;
    
    const instantBPM = 60000 / interval;
    
    // Suavizado exponencial con rechazo de outliers
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      const diff = Math.abs(instantBPM - this.smoothBPM);
      
      if (diff > 25) {
        // Cambio muy grande - casi ignorar
        this.smoothBPM = this.smoothBPM * 0.95 + instantBPM * 0.05;
      } else if (diff > 15) {
        // Cambio grande - aplicar poco peso
        this.smoothBPM = this.smoothBPM * 0.9 + instantBPM * 0.1;
      } else {
        // Cambio normal - suavizado estándar
        this.smoothBPM = this.smoothBPM * (1 - this.BPM_SMOOTHING) + instantBPM * this.BPM_SMOOTHING;
      }
    }
    
    // Mantener en rango
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
    
    // Historial
    this.bpmHistory.push(instantBPM);
    if (this.bpmHistory.length > 30) {
      this.bpmHistory.shift();
    }
  }

  private calculateSignalQuality(): number {
    if (this.normalizedBuffer.length < 30) return 0;
    
    let quality = 0;
    
    // Basado en estabilidad (frames sin movimiento)
    if (this.consecutiveStableFrames > 60) quality = 40;
    else if (this.consecutiveStableFrames > 30) quality = 25;
    else if (this.consecutiveStableFrames > 15) quality = 15;
    else quality = 5;
    
    // Bonus por tener BPM estable
    if (this.smoothBPM >= 50 && this.smoothBPM <= 120 && this.validPeakCount >= 3) {
      quality += 30;
    }
    
    // Bonus por picos detectados
    if (this.validPeakCount > 10) quality += 30;
    else if (this.validPeakCount > 5) quality += 20;
    else if (this.validPeakCount > 2) quality += 10;
    
    return Math.min(100, quality);
  }

  // === MÉTODOS PÚBLICOS ===
  
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
      // Dedo perdido - resetear
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