/**
 * PROCESADOR DE LATIDOS CARDÍACOS - CON CALIBRACIÓN AUTOMÁTICA
 * 
 * Algoritmo:
 * 1. FASE DE CALIBRACIÓN (5 segundos): Recolecta señal y calcula umbrales óptimos
 * 2. FASE DE DETECCIÓN: Usa umbrales calibrados para detección precisa
 * 
 * La calibración analiza:
 * - Rango de amplitud típico de la señal
 * - Frecuencia aproximada de picos
 * - Nivel de ruido
 */
export class HeartBeatProcessor {
  // Configuración fisiológica
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333;  // 180 BPM máx
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM mín
  
  // === CALIBRACIÓN ===
  private readonly CALIBRATION_TIME_MS = 5000;  // 5 segundos
  private calibrationStartTime: number = 0;
  private isCalibrated: boolean = false;
  private calibrationBuffer: Array<{value: number, time: number}> = [];
  
  // Parámetros calibrados
  private calibratedThreshold: number = 0;
  private calibratedMinAmplitude: number = 0.5;
  private calibratedPeakRatio: number = 0.6; // Posición mínima en el rango (60% superior)
  
  // Buffer de señal
  private signalBuffer: Array<{value: number, time: number}> = [];
  private readonly BUFFER_SIZE = 90;
  private readonly WINDOW_SIZE = 7;
  
  // Estado de detección
  private lastPeakTime: number = 0;
  private lastPeakValue: number = 0;
  private peakCount: number = 0;
  
  // Historial para umbral dinámico post-calibración
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
    if (!this.isCalibrated) return; // No sonar durante calibración
    
    const now = Date.now();
    if (now - this.lastBeepTime < this.MIN_BEEP_INTERVAL_MS) return;
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
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
      lubGain.gain.linearRampToValueAtTime(1.5, t + 0.02);
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
      dubGain.gain.linearRampToValueAtTime(1.2, dubStart + 0.015);
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
   * CALIBRACIÓN AUTOMÁTICA
   * Analiza la señal acumulada para determinar umbrales óptimos
   */
  private performCalibration(): void {
    if (this.calibrationBuffer.length < 60) {
      console.log('⚠️ Calibración: datos insuficientes');
      // Usar valores por defecto
      this.calibratedThreshold = 0.3;
      this.calibratedMinAmplitude = 0.5;
      this.calibratedPeakRatio = 0.55;
      this.isCalibrated = true;
      return;
    }
    
    const values = this.calibrationBuffer.map(s => s.value);
    
    // 1. Calcular estadísticas básicas
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    
    // Percentiles
    const p10 = sorted[Math.floor(sorted.length * 0.10)];
    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p50 = sorted[Math.floor(sorted.length * 0.50)]; // mediana
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const p90 = sorted[Math.floor(sorted.length * 0.90)];
    
    // 2. Estimar nivel de ruido (IQR)
    const iqr = p75 - p25;
    const noiseLevel = iqr * 0.5;
    
    // 3. Detectar picos preliminares para estimar frecuencia
    const preliminaryPeaks = this.detectPreliminaryPeaks(values, range * 0.3);
    
    // 4. CALIBRAR UMBRALES basándose en los datos
    
    // Umbral: debe estar por encima de la mediana + ruido
    // Los picos típicamente están en el percentil 75-90
    this.calibratedThreshold = Math.max(
      p50 + noiseLevel,        // Por encima del ruido
      (p75 + p90) / 2 * 0.8,   // 80% del promedio de picos
      range * 0.25             // Al menos 25% del rango
    );
    
    // Amplitud mínima: basada en el rango observado
    this.calibratedMinAmplitude = Math.max(range * 0.15, noiseLevel * 2, 0.3);
    
    // Ratio de posición: qué tan arriba debe estar el pico
    // Si hay mucho ruido, ser más estricto
    const snrEstimate = range / Math.max(noiseLevel, 0.01);
    if (snrEstimate > 10) {
      this.calibratedPeakRatio = 0.50; // Señal limpia, más permisivo
    } else if (snrEstimate > 5) {
      this.calibratedPeakRatio = 0.60; // Normal
    } else {
      this.calibratedPeakRatio = 0.70; // Ruidoso, más estricto
    }
    
    this.isCalibrated = true;
    
    console.log(`✅ CALIBRACIÓN COMPLETA:
      - Rango: ${range.toFixed(3)}
      - Ruido estimado: ${noiseLevel.toFixed(3)}
      - SNR: ${snrEstimate.toFixed(1)}
      - Umbral: ${this.calibratedThreshold.toFixed(3)}
      - Amplitud mín: ${this.calibratedMinAmplitude.toFixed(3)}
      - Peak ratio: ${this.calibratedPeakRatio.toFixed(2)}
      - Picos preliminares: ${preliminaryPeaks}`);
  }
  
  /**
   * Detecta picos preliminares durante calibración
   */
  private detectPreliminaryPeaks(values: number[], threshold: number): number {
    let peakCount = 0;
    const minDistance = 10; // ~333ms a 30fps
    let lastPeakIdx = -minDistance;
    
    for (let i = 3; i < values.length - 3; i++) {
      const val = values[i];
      
      // Verificar si es máximo local
      let isMax = true;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j !== i && values[j] >= val) {
          isMax = false;
          break;
        }
      }
      
      if (isMax && val > threshold && (i - lastPeakIdx) >= minDistance) {
        peakCount++;
        lastPeakIdx = i;
      }
    }
    
    return peakCount;
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
    
    // === FASE DE CALIBRACIÓN ===
    if (!this.isCalibrated) {
      this.calibrationBuffer.push({ value, time: now });
      
      const elapsed = now - this.calibrationStartTime;
      
      // Verificar si terminó el tiempo de calibración
      if (elapsed >= this.CALIBRATION_TIME_MS) {
        this.performCalibration();
      }
      
      // Durante calibración, solo acumular datos
      return { 
        bpm: 0, 
        confidence: 0, 
        isPeak: false, 
        filteredValue: value, 
        arrhythmiaCount: 0 
      };
    }
    
    // === FASE DE DETECCIÓN (post-calibración) ===
    
    // 1. Guardar en buffer
    this.signalBuffer.push({ value, time: now });
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Esperar suficientes muestras
    if (this.signalBuffer.length < this.WINDOW_SIZE * 2 + 1) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: value, arrhythmiaCount: 0 };
    }
    
    // 2. Calcular estadísticas del buffer reciente
    const recentValues = this.signalBuffer.slice(-30).map(s => s.value);
    const recentMax = Math.max(...recentValues);
    const recentMin = Math.min(...recentValues);
    const amplitude = recentMax - recentMin;
    
    // Actualizar historial de amplitudes
    this.amplitudeHistory.push(amplitude);
    if (this.amplitudeHistory.length > this.AMPLITUDE_HISTORY_SIZE) {
      this.amplitudeHistory.shift();
    }
    
    // 3. Calcular umbral dinámico (combina calibración + adaptativo)
    const sortedAmps = [...this.amplitudeHistory].sort((a, b) => a - b);
    const medianAmp = sortedAmps[Math.floor(sortedAmps.length / 2)] || this.calibratedMinAmplitude;
    
    // Umbral = máximo entre calibrado y porcentaje de amplitud actual
    const dynamicThreshold = Math.max(
      this.calibratedThreshold,
      medianAmp * 0.25
    );
    
    // 4. Verificar pico en el centro de la ventana
    const centerIdx = this.signalBuffer.length - 1 - this.WINDOW_SIZE;
    if (centerIdx < this.WINDOW_SIZE) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: value, arrhythmiaCount: 0 };
    }
    
    const centerSample = this.signalBuffer[centerIdx];
    const centerValue = centerSample.value;
    const centerTime = centerSample.time;
    
    // Verificar máximo local en ventana
    let isLocalMax = true;
    for (let i = centerIdx - this.WINDOW_SIZE; i <= centerIdx + this.WINDOW_SIZE; i++) {
      if (i !== centerIdx && this.signalBuffer[i].value >= centerValue) {
        isLocalMax = false;
        break;
      }
    }
    
    // 5. Validar pico con criterios calibrados
    let isPeak = false;
    let confidence = 0;
    
    const timeSinceLastPeak = this.lastPeakTime > 0 ? centerTime - this.lastPeakTime : 10000;
    
    // Posición relativa en el rango (0 = mínimo, 1 = máximo)
    const valuePosition = amplitude > 0 ? (centerValue - recentMin) / amplitude : 0;
    
    // Condiciones para pico válido (usando parámetros calibrados):
    const isPeakValid = 
      isLocalMax && 
      timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS &&
      amplitude >= this.calibratedMinAmplitude &&
      valuePosition >= this.calibratedPeakRatio;
    
    if (isPeakValid) {
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
          
          const instantBPM = 60000 / rr;
          this.updateBPM(instantBPM);
        }
      }
      
      this.lastPeakTime = centerTime;
      this.lastPeakValue = centerValue;
      confidence = this.calculateConfidence(amplitude);
      
      this.playHeartSound();
    }
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`💓 BPM=${this.smoothBPM.toFixed(0)}, picos=${this.peakCount}, RR=${this.rrIntervals.length}, amp=${amplitude.toFixed(2)}, thr=${dynamicThreshold.toFixed(3)}`);
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
   * Actualiza BPM con suavizado robusto
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
    
    // Usar mediana para robustez
    const sorted = [...this.bpmHistory].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    const alpha = 0.3;
    this.smoothBPM = this.smoothBPM * (1 - alpha) + median * alpha;
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
  }

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
      threshold: this.calibratedThreshold,
      minAmplitude: this.calibratedMinAmplitude,
      peakRatio: this.calibratedPeakRatio
    };
  }
  
  setArrhythmiaDetected(isDetected: boolean): void {
    this.isArrhythmiaDetected = isDetected;
  }
  
  setFingerDetected(_detected: boolean): void {}

  /**
   * Forzar recalibración
   */
  recalibrate(): void {
    this.isCalibrated = false;
    this.calibrationBuffer = [];
    this.calibrationStartTime = Date.now();
    this.signalBuffer = [];
    this.amplitudeHistory = [];
    console.log('🔄 Iniciando recalibración...');
  }

  reset(): void {
    this.signalBuffer = [];
    this.calibrationBuffer = [];
    this.amplitudeHistory = [];
    this.bpmHistory = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.lastPeakValue = 0;
    this.peakCount = 0;
    this.isCalibrated = false;
    this.calibrationStartTime = Date.now();
    this.startTime = Date.now();
    this.frameCount = 0;
    
    // Resetear parámetros calibrados a valores por defecto
    this.calibratedThreshold = 0;
    this.calibratedMinAmplitude = 0.5;
    this.calibratedPeakRatio = 0.6;
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
