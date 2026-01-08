/**
 * PROCESADOR DE LATIDOS CARDÍACOS - VERSIÓN ROBUSTA
 * 
 * Algoritmo basado en:
 * - prouast/heartbeat (GitHub 606 stars)
 * - Elgendi M. (2012) "On the Analysis of Fingertip PPG Signals"
 * 
 * ENFOQUE:
 * 1. Calibración rápida (3 segundos)
 * 2. Detección de picos con umbral adaptativo
 * 3. Validación fisiológica estricta
 * 4. Anti-ruido y anti-falsos positivos
 */
export class HeartBeatProcessor {
  // Límites fisiológicos
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333;  // 180 BPM
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM
  
  // === CALIBRACIÓN ===
  private readonly CALIBRATION_TIME_MS = 3000;  // 3 segundos
  private calibrationStartTime: number = 0;
  private isCalibrated: boolean = false;
  private calibrationBuffer: number[] = [];
  
  // Parámetros calibrados
  private baselineAmplitude: number = 0;
  private noiseFloor: number = 0;
  private dynamicThreshold: number = 0;
  
  // Buffer de señal para análisis
  private signalBuffer: number[] = [];
  private readonly SIGNAL_BUFFER_SIZE = 60; // 2 segundos @ 30fps
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private lastPeakValue: number = 0;
  private peakCount: number = 0;
  private consecutiveNoPeak: number = 0;
  
  // BPM
  private rrIntervals: number[] = [];
  private smoothBPM: number = 0;
  private bpmConfidence: number = 0;
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  private readonly MIN_BEEP_INTERVAL_MS = 300;
  
  // Estado
  private frameCount: number = 0;
  private unlockHandler: (() => Promise<void>) | null = null;

  constructor() {
    this.calibrationStartTime = Date.now();
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

  /**
   * Sonido de latido cardíaco realista
   */
  private async playHeartSound() {
    if (!this.audioContext || !this.audioUnlocked || !this.isCalibrated) return;
    
    const now = Date.now();
    if (now - this.lastBeepTime < this.MIN_BEEP_INTERVAL_MS) return;
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Vibración
      if (navigator.vibrate) {
        navigator.vibrate([40, 25, 60]);
      }
      
      const t = this.audioContext.currentTime;
      
      // LUB (S1) - primer sonido
      const lub = this.audioContext.createOscillator();
      const lubGain = this.audioContext.createGain();
      const lubFilter = this.audioContext.createBiquadFilter();
      
      lub.type = 'sine';
      lub.frequency.setValueAtTime(65, t);
      lub.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      
      lubFilter.type = 'lowpass';
      lubFilter.frequency.value = 150;
      
      lubGain.gain.setValueAtTime(0, t);
      lubGain.gain.linearRampToValueAtTime(1.8, t + 0.02);
      lubGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      
      lub.connect(lubFilter);
      lubFilter.connect(lubGain);
      lubGain.connect(this.audioContext.destination);
      
      lub.start(t);
      lub.stop(t + 0.18);
      
      // DUB (S2) - segundo sonido
      const dub = this.audioContext.createOscillator();
      const dubGain = this.audioContext.createGain();
      const dubFilter = this.audioContext.createBiquadFilter();
      
      const dubStart = t + 0.10;
      
      dub.type = 'sine';
      dub.frequency.setValueAtTime(85, dubStart);
      dub.frequency.exponentialRampToValueAtTime(55, dubStart + 0.08);
      
      dubFilter.type = 'lowpass';
      dubFilter.frequency.value = 180;
      
      dubGain.gain.setValueAtTime(0, dubStart);
      dubGain.gain.linearRampToValueAtTime(1.4, dubStart + 0.015);
      dubGain.gain.exponentialRampToValueAtTime(0.01, dubStart + 0.12);
      
      dub.connect(dubFilter);
      dubFilter.connect(dubGain);
      dubGain.connect(this.audioContext.destination);
      
      dub.start(dubStart);
      dub.stop(dubStart + 0.15);
      
      this.lastBeepTime = now;
    } catch (error) {}
  }

  /**
   * CALIBRACIÓN - Analiza características de la señal
   */
  private performCalibration(): void {
    if (this.calibrationBuffer.length < 45) {
      console.log('⚠️ Calibración: datos insuficientes, usando defaults');
      this.baselineAmplitude = 1;
      this.noiseFloor = 0.1;
      this.dynamicThreshold = 0.3;
      this.isCalibrated = true;
      return;
    }
    
    const values = this.calibrationBuffer;
    const n = values.length;
    
    // Estadísticas básicas
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[n - 1];
    const range = max - min;
    
    // Percentiles
    const p25 = sorted[Math.floor(n * 0.25)];
    const p50 = sorted[Math.floor(n * 0.50)];
    const p75 = sorted[Math.floor(n * 0.75)];
    
    // IQR para estimar ruido
    const iqr = p75 - p25;
    
    // Calcular baseline y ruido
    this.baselineAmplitude = Math.max(range, 0.5);
    this.noiseFloor = Math.max(iqr * 0.4, 0.05);
    
    // Umbral inicial: 40% del rango, por encima del ruido
    this.dynamicThreshold = Math.max(
      range * 0.35,
      this.noiseFloor * 2.5,
      p50 + iqr * 0.5
    );
    
    this.isCalibrated = true;
    
    console.log(`✅ CALIBRACIÓN:
      - Rango: ${range.toFixed(3)}
      - IQR (ruido): ${iqr.toFixed(3)}
      - Umbral inicial: ${this.dynamicThreshold.toFixed(3)}`);
  }

  /**
   * PROCESAMIENTO PRINCIPAL
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
    
    // Protección contra valores inválidos
    if (!isFinite(value)) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0 };
    }
    
    // === FASE DE CALIBRACIÓN ===
    if (!this.isCalibrated) {
      this.calibrationBuffer.push(value);
      
      const elapsed = now - this.calibrationStartTime;
      if (elapsed >= this.CALIBRATION_TIME_MS) {
        this.performCalibration();
      }
      
      return { 
        bpm: 0, 
        confidence: 0, 
        isPeak: false, 
        filteredValue: value, 
        arrhythmiaCount: 0 
      };
    }
    
    // === FASE DE DETECCIÓN ===
    
    // 1. Agregar al buffer
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.SIGNAL_BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos suficientes datos
    if (this.signalBuffer.length < 15) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: value, arrhythmiaCount: 0 };
    }
    
    // 2. Calcular estadísticas locales
    const recentSignal = this.signalBuffer.slice(-20);
    const localMin = Math.min(...recentSignal);
    const localMax = Math.max(...recentSignal);
    const localRange = localMax - localMin;
    
    // 3. Actualizar umbral dinámico
    this.updateDynamicThreshold(localRange);
    
    // 4. Detectar pico
    const isPeak = this.detectPeak(now);
    
    // 5. Calcular confianza
    const confidence = this.calculateConfidence();
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`💓 BPM=${this.smoothBPM.toFixed(0)}, picos=${this.peakCount}, conf=${(confidence*100).toFixed(0)}%, thr=${this.dynamicThreshold.toFixed(2)}`);
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
   * Actualiza el umbral dinámico basado en la amplitud reciente
   */
  private updateDynamicThreshold(localRange: number): void {
    // El umbral se adapta lentamente al rango de la señal
    const targetThreshold = Math.max(
      localRange * 0.40,  // 40% del rango local
      this.noiseFloor * 2,
      0.1
    );
    
    // Suavizado exponencial
    this.dynamicThreshold = this.dynamicThreshold * 0.9 + targetThreshold * 0.1;
  }

  /**
   * DETECCIÓN DE PICOS - Algoritmo robusto
   */
  private detectPeak(now: number): boolean {
    const n = this.signalBuffer.length;
    if (n < 10) return false;
    
    // Verificamos el punto en el centro de una ventana de 7 muestras
    const centerIdx = n - 4;
    if (centerIdx < 3) return false;
    
    const centerValue = this.signalBuffer[centerIdx];
    
    // 1. Verificar que es máximo local en ventana de 7
    let isLocalMax = true;
    for (let i = centerIdx - 3; i <= centerIdx + 3; i++) {
      if (i !== centerIdx && i >= 0 && i < n) {
        if (this.signalBuffer[i] >= centerValue) {
          isLocalMax = false;
          break;
        }
      }
    }
    
    if (!isLocalMax) return false;
    
    // 2. Verificar intervalo mínimo desde último pico
    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : this.MAX_PEAK_INTERVAL_MS;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return false;
    }
    
    // 3. Calcular posición relativa en el rango local
    const recentSignal = this.signalBuffer.slice(-15);
    const localMin = Math.min(...recentSignal);
    const localMax = Math.max(...recentSignal);
    const localRange = localMax - localMin;
    
    // El valor debe estar en el 60% superior del rango
    const valuePosition = localRange > 0.01 ? (centerValue - localMin) / localRange : 0;
    if (valuePosition < 0.55) {
      return false;
    }
    
    // 4. El rango local debe ser suficiente (anti-ruido)
    if (localRange < this.noiseFloor * 1.5) {
      return false;
    }
    
    // 5. Verificar prominencia del pico
    const leftMin = Math.min(...this.signalBuffer.slice(Math.max(0, centerIdx - 5), centerIdx));
    const rightMin = Math.min(...this.signalBuffer.slice(centerIdx + 1, Math.min(n, centerIdx + 5)));
    const prominence = centerValue - Math.max(leftMin, rightMin);
    
    if (prominence < this.dynamicThreshold * 0.4) {
      return false;
    }
    
    // === PICO VÁLIDO ===
    this.peakCount++;
    this.consecutiveNoPeak = 0;
    
    // Calcular RR interval
    if (this.lastPeakTime > 0) {
      const rr = timeSinceLastPeak;
      
      if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
        this.rrIntervals.push(rr);
        if (this.rrIntervals.length > 15) {
          this.rrIntervals.shift();
        }
        
        this.updateBPM(rr);
      }
    }
    
    this.lastPeakTime = now;
    this.lastPeakValue = centerValue;
    
    // Reproducir sonido
    this.playHeartSound();
    
    return true;
  }

  /**
   * Actualiza BPM con mediana y suavizado
   */
  private updateBPM(rr: number): void {
    if (this.rrIntervals.length < 2) {
      const instantBPM = 60000 / rr;
      if (instantBPM >= this.MIN_BPM && instantBPM <= this.MAX_BPM) {
        this.smoothBPM = instantBPM;
      }
      return;
    }
    
    // Usar mediana de RR para robustez
    const sortedRR = [...this.rrIntervals].sort((a, b) => a - b);
    const medianRR = sortedRR[Math.floor(sortedRR.length / 2)];
    const medianBPM = 60000 / medianRR;
    
    // Suavizado exponencial
    const alpha = 0.25;
    this.smoothBPM = this.smoothBPM * (1 - alpha) + medianBPM * alpha;
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
  }

  /**
   * Calcula confianza basada en consistencia de RR
   */
  private calculateConfidence(): number {
    if (this.rrIntervals.length < 3) {
      return 0.1 * Math.min(this.peakCount, 5);
    }
    
    // Coeficiente de variación de RR
    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / mean;
    
    // Menor CV = mayor confianza
    let confidence = Math.max(0, 1 - cv * 3);
    
    // Bonus por más picos detectados
    if (this.peakCount > 5) confidence = Math.min(1, confidence + 0.1);
    if (this.peakCount > 10) confidence = Math.min(1, confidence + 0.1);
    
    return confidence;
  }

  // === GETTERS ===
  
  getSmoothBPM(): number {
    return this.smoothBPM;
  }
  
  getRRIntervals(): number[] {
    return [...this.rrIntervals];
  }
  
  getLastPeakTime(): number | null {
    return this.lastPeakTime > 0 ? this.lastPeakTime : null;
  }
  
  isCalibrationComplete(): boolean {
    return this.isCalibrated;
  }
  
  getCalibrationProgress(): number {
    if (this.isCalibrated) return 100;
    const elapsed = Date.now() - this.calibrationStartTime;
    return Math.min(100, Math.round((elapsed / this.CALIBRATION_TIME_MS) * 100));
  }
  
  getCalibrationParams(): {threshold: number, minAmplitude: number, peakRatio: number} {
    return {
      threshold: this.dynamicThreshold,
      minAmplitude: this.noiseFloor * 2,
      peakRatio: 0.55
    };
  }
  
  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}

  /**
   * Forzar recalibración
   */
  recalibrate(): void {
    this.isCalibrated = false;
    this.calibrationBuffer = [];
    this.calibrationStartTime = Date.now();
    this.signalBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.peakCount = 0;
    console.log('🔄 Recalibrando...');
  }

  reset(): void {
    this.signalBuffer = [];
    this.calibrationBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.lastPeakValue = 0;
    this.peakCount = 0;
    this.isCalibrated = false;
    this.calibrationStartTime = Date.now();
    this.frameCount = 0;
    this.consecutiveNoPeak = 0;
    this.baselineAmplitude = 0;
    this.noiseFloor = 0.1;
    this.dynamicThreshold = 0.3;
    this.bpmConfidence = 0;
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
