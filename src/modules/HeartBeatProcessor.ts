/**
 * =========================================================================
 * PROCESADOR DE LATIDOS - VERSIÓN PROFESIONAL
 * =========================================================================
 * 
 * MEJORAS IMPLEMENTADAS:
 * 1. Detección de picos con zero-crossing de VPG
 * 2. Refinamiento sub-frame (interpolación parabólica)
 * 3. BPM calculado con mediana de RR (más robusto que promedio)
 * 4. Suavizado adaptativo según variabilidad
 * 5. Período refractario adaptativo
 * 
 * SIN CLAMPS FISIOLÓGICOS - BPM es el cálculo directo
 * 
 * Referencia: De Haan & Jeanne 2013, Elgendi 2012, IEEE Trans BME
 * =========================================================================
 */
export class HeartBeatProcessor {
  // Intervalos mínimos técnicos (no fisiológicos)
  private readonly MIN_PEAK_INTERVAL_MS = 250;  // 240 BPM máximo técnico
  private readonly MAX_PEAK_INTERVAL_MS = 3000; // 20 BPM mínimo técnico
  
  // Buffers para análisis
  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = []; // Primera derivada (VPG)
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;
  private adaptiveBaseline: number = 0;
  private refractoryPeriod: number = 250; // Período refractario adaptativo
  
  // RR Intervals y BPM
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 15; // Suficientes para mediana robusta
  private smoothBPM: number = 0;
  
  // Audio feedback
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  // Estadísticas
  private frameCount: number = 0;
  private consecutivePeaks: number = 0;
  private lastPeakValue: number = 0;
  private signalQualityIndex: number = 0;

  constructor() {
    this.setupAudio();
  }
  
  private setupAudio() {
    const unlock = async () => {
      if (this.audioUnlocked) return;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();
        await this.audioContext.resume();
        this.audioUnlocked = true;
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
        console.log('🔊 Audio desbloqueado');
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  /**
   * PROCESAR SEÑAL FILTRADA
   * Retorna BPM calculado directamente desde intervalos RR
   */
  processSignal(filteredValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    sqi: number;
    rrData: { intervals: number[]; lastPeakTime: number | null };
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // 1. GUARDAR EN BUFFER
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // 2. CALCULAR PRIMERA DERIVADA (VPG)
    const derivative = this.calculateDerivative();
    this.derivativeBuffer.push(derivative);
    if (this.derivativeBuffer.length > this.BUFFER_SIZE) {
      this.derivativeBuffer.shift();
    }
    
    // Necesitamos suficientes muestras
    if (this.signalBuffer.length < 30) {
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0,
        sqi: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }
    
    // 3. NORMALIZACIÓN ADAPTATIVA
    const { normalizedValue, range } = this.normalizeSignal(filteredValue);
    
    // 4. ACTUALIZAR UMBRAL Y PERÍODO REFRACTARIO
    this.updateAdaptiveParameters(range);
    
    // 5. CALCULAR SQI
    this.signalQualityIndex = this.calculateSQI();
    
    // 6. DETECCIÓN DE PICO CON ZERO-CROSSING DE VPG
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    if (timeSinceLastPeak >= this.refractoryPeriod) {
      isPeak = this.detectPeakWithZeroCrossing(normalizedValue, timeSinceLastPeak);
      
      if (isPeak) {
        // REFINAMIENTO SUB-FRAME
        const refinedTime = this.refineSubFrame(now);
        const actualInterval = refinedTime - this.lastPeakTime;
        
        // Registrar intervalo RR
        if (this.lastPeakTime > 0 && actualInterval <= this.MAX_PEAK_INTERVAL_MS && actualInterval >= this.MIN_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(actualInterval);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }
          
          // CALCULAR BPM CON MEDIANA (más robusto que promedio)
          const medianRR = this.calculateMedian(this.rrIntervals);
          const instantBPM = 60000 / medianRR;
          
          // SUAVIZADO ADAPTATIVO
          this.smoothBPM = this.adaptiveSmoothBPM(instantBPM);
          
          // ACTUALIZAR PERÍODO REFRACTARIO
          this.refractoryPeriod = Math.max(200, medianRR * 0.4);
          
          this.consecutivePeaks++;
        }
        
        this.lastPeakTime = refinedTime;
        
        // Feedback
        this.vibrate();
        this.playBeep();
        
        if (this.consecutivePeaks <= 5 || this.frameCount % 30 === 0) {
          console.log(`💓 PICO #${this.consecutivePeaks} BPM=${this.smoothBPM.toFixed(1)} RR=${timeSinceLastPeak.toFixed(0)}ms SQI=${this.signalQualityIndex.toFixed(0)}%`);
        }
      }
    }
    
    // 7. CALCULAR CONFIANZA
    const confidence = this.calculateConfidence();
    
    return {
      bpm: this.smoothBPM,
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: this.signalQualityIndex,
      rrData: { 
        intervals: [...this.rrIntervals], 
        lastPeakTime: this.lastPeakTime > 0 ? this.lastPeakTime : null 
      }
    };
  }
  
  /**
   * CALCULAR PRIMERA DERIVADA (VPG)
   */
  private calculateDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    
    // Derivada central: (f(x+h) - f(x-h)) / 2h
    return (this.signalBuffer[n - 1] - this.signalBuffer[n - 3]) / 2;
  }
  
  /**
   * CALCULAR MEDIANA (más robusta que promedio)
   */
  private calculateMedian(arr: number[]): number {
    if (arr.length === 0) return 0;
    
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  /**
   * SUAVIZADO ADAPTATIVO DE BPM
   * Responde rápido a cambios pequeños, lento a cambios grandes
   */
  private adaptiveSmoothBPM(instantBPM: number): number {
    if (this.smoothBPM === 0) {
      return instantBPM;
    }
    
    const relativeDiff = Math.abs(instantBPM - this.smoothBPM) / this.smoothBPM;
    
    let alpha: number;
    
    if (relativeDiff < 0.1) {
      // Cambio pequeño (<10%) - responder rápido
      alpha = 0.4;
    } else if (relativeDiff < 0.2) {
      // Cambio moderado - suavizado normal
      alpha = 0.25;
    } else if (relativeDiff < 0.35) {
      // Cambio grande - más suavizado
      alpha = 0.15;
    } else {
      // Cambio muy grande (>35%) - probablemente ruido
      alpha = 0.08;
    }
    
    // Si tenemos pocos picos, ser más conservador
    if (this.consecutivePeaks < 4) {
      alpha = Math.min(0.5, alpha * 1.5);
    }
    
    return alpha * instantBPM + (1 - alpha) * this.smoothBPM;
  }
  
  /**
   * REFINAMIENTO SUB-FRAME (interpolación parabólica)
   * Mejora la precisión del timestamp del pico
   */
  private refineSubFrame(baseTimestamp: number): number {
    const n = this.signalBuffer.length;
    if (n < 3) return baseTimestamp;
    
    const yPrev = this.signalBuffer[n - 3];
    const yPeak = this.signalBuffer[n - 2];
    const yNext = this.signalBuffer[n - 1];
    
    // Interpolación parabólica
    const denominator = yPrev - 2 * yPeak + yNext;
    
    if (Math.abs(denominator) < 0.001) {
      return baseTimestamp;
    }
    
    const offset = (yPrev - yNext) / (2 * denominator);
    
    // offset está en frames, convertir a ms (asumiendo 30fps)
    const frameInterval = 1000 / 30;
    
    return baseTimestamp + offset * frameInterval;
  }
  
  /**
   * ACTUALIZAR PARÁMETROS ADAPTATIVOS
   */
  private updateAdaptiveParameters(range: number): void {
    // Umbral proporcional a la amplitud
    const newThreshold = Math.max(4, range * 0.18);
    this.peakThreshold = this.peakThreshold * 0.92 + newThreshold * 0.08;
    
    // Baseline adaptativo
    if (this.signalBuffer.length >= 30) {
      const recent = this.signalBuffer.slice(-30);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      this.adaptiveBaseline = this.adaptiveBaseline * 0.95 + mean * 0.05;
    }
  }
  
  /**
   * CALCULAR SQI
   */
  private calculateSQI(): number {
    if (this.signalBuffer.length < 60) return 0;
    
    const recent = this.signalBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    // Factor 1: Rango de señal
    const rangeFactor = Math.min(1, range / 15) * 35;
    
    // Factor 2: Consistencia de RR
    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean;
      rrFactor = Math.max(0, (1 - cv * 2.5)) * 35;
    }
    
    // Factor 3: Número de picos
    const peakFactor = Math.min(1, this.consecutivePeaks / 4) * 30;
    
    return Math.min(100, rangeFactor + rrFactor + peakFactor);
  }
  
  /**
   * NORMALIZACIÓN ADAPTATIVA
   */
  private normalizeSignal(value: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-120);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    if (range < 0.5) {
      return { normalizedValue: 0, range: 0 };
    }
    
    const normalizedValue = ((value - min) / range - 0.5) * 100;
    return { normalizedValue, range };
  }
  
  /**
   * DETECCIÓN DE PICO CON ZERO-CROSSING DE VPG
   */
  private detectPeakWithZeroCrossing(normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 7 || dn < 5) return false;
    
    // 1. ZERO-CROSSING DE VPG (derivada cruza de + a -)
    const deriv = this.derivativeBuffer.slice(-5);
    const zeroCrossing = deriv[2] >= 0 && deriv[3] < 0 && deriv[4] < 0;
    
    // 2. MÁXIMO LOCAL EN SEÑAL
    const recent = this.signalBuffer.slice(-7);
    const recentNorm = this.normalizeWindow(recent);
    
    const [v0, v1, v2, v3, v4, v5, v6] = recentNorm;
    const isLocalMax = v3 > v2 && v3 > v4 && v3 >= v1 && v3 >= v5;
    
    // 3. UMBRAL DE AMPLITUD
    const aboveThreshold = v3 > this.peakThreshold;
    
    // 4. PENDIENTES ADECUADAS
    const risingSlope = (v3 - v0) > 1.5;
    const fallingSlope = (v3 - v6) > 1.5;
    
    // 5. INTERVALO MÍNIMO
    const notTooSoon = timeSinceLastPeak >= this.refractoryPeriod;
    
    // 6. AMPLITUD RELATIVA
    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = v3 / this.lastPeakValue;
      amplitudeValid = ratio > 0.25 && ratio < 4.0;
    }
    
    // Combinar: (zero-crossing O máximo local) + otros criterios
    const isPeak = (zeroCrossing || isLocalMax) && 
                   aboveThreshold && 
                   risingSlope && 
                   fallingSlope && 
                   notTooSoon && 
                   amplitudeValid;
    
    if (isPeak) {
      this.lastPeakValue = v3;
    }
    
    return isPeak;
  }
  
  private normalizeWindow(window: number[]): number[] {
    const fullBuffer = this.signalBuffer.slice(-120);
    const min = Math.min(...fullBuffer);
    const max = Math.max(...fullBuffer);
    const range = max - min;
    
    if (range < 0.5) return window.map(() => 0);
    
    return window.map(v => ((v - min) / range - 0.5) * 100);
  }
  
  /**
   * CALCULAR CONFIANZA
   */
  private calculateConfidence(): number {
    if (this.rrIntervals.length < 3) return 0;
    
    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / mean;
    
    return Math.max(0, Math.min(1, 1 - cv * 1.8));
  }

  private vibrate(): void {
    try { 
      if (navigator.vibrate) {
        navigator.vibrate(80);
      }
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 200) return;
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.08);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.12);
      
      this.lastBeepTime = now;
    } catch {}
  }

  getRRIntervals(): number[] { 
    return [...this.rrIntervals]; 
  }
  
  getLastPeakTime(): number { 
    return this.lastPeakTime; 
  }
  
  getSQI(): number {
    return this.signalQualityIndex;
  }
  
  getDerivativeBuffer(): number[] {
    return [...this.derivativeBuffer];
  }
  
  getSmoothedBPM(): number {
    return this.smoothBPM;
  }
  
  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}
  
  reset(): void {
    this.signalBuffer = [];
    this.derivativeBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 10;
    this.frameCount = 0;
    this.consecutivePeaks = 0;
    this.signalQualityIndex = 0;
    this.refractoryPeriod = 250;
    this.lastPeakValue = 0;
    this.adaptiveBaseline = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
