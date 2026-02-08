/**
 * =========================================================================
 * PROCESADOR DE LATIDOS - CALIBRADO Y OPTIMIZADO
 * =========================================================================
 * 
 * CALIBRACIONES:
 * 1. Mínimo 5 intervalos RR antes de mostrar BPM estable
 * 2. Suavizado mejorado hasta tener 10 intervalos
 * 3. Detección de outliers en RR
 * 4. Período refractario más inteligente
 * =========================================================================
 */
export class HeartBeatProcessor {
  // Intervalos mínimos técnicos
  private readonly MIN_PEAK_INTERVAL_MS = 250;  // 240 BPM máximo técnico
  private readonly MAX_PEAK_INTERVAL_MS = 3000; // 20 BPM mínimo técnico
  
  // CALIBRACIÓN: Mínimo de RR para BPM estable
  private readonly MIN_RR_FOR_BPM = 5;          // NUEVO: Mínimo 5 intervalos
  private readonly STABLE_RR_COUNT = 10;        // NUEVO: Estable con 10 intervalos
  
  // Buffers para análisis
  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 180;
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;
  private adaptiveBaseline: number = 0;
  private refractoryPeriod: number = 280; // Ligeramente más largo
  
  // RR Intervals y BPM
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 20; // Más intervalos para mejor mediana
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
   * PROCESAR SEÑAL FILTRADA - CALIBRADO
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
    
    // 6. DETECCIÓN DE PICO
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    if (timeSinceLastPeak >= this.refractoryPeriod) {
      isPeak = this.detectPeakWithZeroCrossing(normalizedValue, timeSinceLastPeak);
      
      if (isPeak) {
        // REFINAMIENTO SUB-FRAME
        const refinedTime = this.refineSubFrame(now);
        const actualInterval = refinedTime - this.lastPeakTime;
        
        // Registrar intervalo RR con validación
        if (this.lastPeakTime > 0 && this.isValidRRInterval(actualInterval)) {
          // Filtrar outliers
          if (this.isRROutlier(actualInterval)) {
            // No agregar outliers, pero seguir contando picos
            this.consecutivePeaks++;
          } else {
            this.rrIntervals.push(actualInterval);
            if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
              this.rrIntervals.shift();
            }
            
            // CALCULAR BPM SOLO SI HAY SUFICIENTES INTERVALOS
            if (this.rrIntervals.length >= this.MIN_RR_FOR_BPM) {
              const medianRR = this.calculateMedian(this.rrIntervals);
              const instantBPM = 60000 / medianRR;
              
              // SUAVIZADO ADAPTATIVO MEJORADO
              this.smoothBPM = this.adaptiveSmoothBPM(instantBPM);
              
              // ACTUALIZAR PERÍODO REFRACTARIO
              this.refractoryPeriod = Math.max(220, Math.min(500, medianRR * 0.4));
            }
            
            this.consecutivePeaks++;
          }
        }
        
        this.lastPeakTime = refinedTime;
        
        // Feedback
        this.vibrate();
        this.playBeep();
        
        if (this.consecutivePeaks <= 5 || this.frameCount % 60 === 0) {
          console.log(`💓 PICO #${this.consecutivePeaks} BPM=${this.smoothBPM.toFixed(1)} RR=${timeSinceLastPeak.toFixed(0)}ms (${this.rrIntervals.length} RR)`);
        }
      }
    }
    
    // 7. CALCULAR CONFIANZA
    const confidence = this.calculateConfidence();
    
    return {
      bpm: this.rrIntervals.length >= this.MIN_RR_FOR_BPM ? this.smoothBPM : 0,
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
   * VALIDAR INTERVALO RR
   */
  private isValidRRInterval(interval: number): boolean {
    return interval >= this.MIN_PEAK_INTERVAL_MS && interval <= this.MAX_PEAK_INTERVAL_MS;
  }
  
  /**
   * DETECTAR OUTLIERS EN RR
   * Un RR es outlier si difiere más del 40% de la mediana actual
   */
  private isRROutlier(newInterval: number): boolean {
    if (this.rrIntervals.length < 3) return false;
    
    const medianRR = this.calculateMedian(this.rrIntervals);
    const deviation = Math.abs(newInterval - medianRR) / medianRR;
    
    // Si difiere más del 40% de la mediana, es outlier
    return deviation > 0.40;
  }
  
  /**
   * CALCULAR PRIMERA DERIVADA (VPG)
   */
  private calculateDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    return (this.signalBuffer[n - 1] - this.signalBuffer[n - 3]) / 2;
  }
  
  /**
   * CALCULAR MEDIANA
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
   * SUAVIZADO ADAPTATIVO MEJORADO
   */
  private adaptiveSmoothBPM(instantBPM: number): number {
    if (this.smoothBPM === 0) {
      return instantBPM;
    }
    
    const relativeDiff = Math.abs(instantBPM - this.smoothBPM) / this.smoothBPM;
    
    let alpha: number;
    
    if (relativeDiff < 0.08) {
      // Cambio muy pequeño - responder rápido
      alpha = 0.5;
    } else if (relativeDiff < 0.15) {
      // Cambio pequeño
      alpha = 0.35;
    } else if (relativeDiff < 0.25) {
      // Cambio moderado
      alpha = 0.2;
    } else if (relativeDiff < 0.4) {
      // Cambio grande
      alpha = 0.1;
    } else {
      // Cambio muy grande - probablemente ruido
      alpha = 0.05;
    }
    
    // Si tenemos pocos intervalos, ser más agresivo en actualizar
    if (this.rrIntervals.length < this.STABLE_RR_COUNT) {
      alpha = Math.min(0.6, alpha * 1.8);
    }
    
    return alpha * instantBPM + (1 - alpha) * this.smoothBPM;
  }
  
  /**
   * REFINAMIENTO SUB-FRAME
   */
  private refineSubFrame(baseTimestamp: number): number {
    const n = this.signalBuffer.length;
    if (n < 3) return baseTimestamp;
    
    const yPrev = this.signalBuffer[n - 3];
    const yPeak = this.signalBuffer[n - 2];
    const yNext = this.signalBuffer[n - 1];
    
    const denominator = yPrev - 2 * yPeak + yNext;
    
    if (Math.abs(denominator) < 0.001) {
      return baseTimestamp;
    }
    
    const offset = (yPrev - yNext) / (2 * denominator);
    const frameInterval = 1000 / 30;
    
    return baseTimestamp + offset * frameInterval;
  }
  
  /**
   * ACTUALIZAR PARÁMETROS ADAPTATIVOS
   */
  private updateAdaptiveParameters(range: number): void {
    const newThreshold = Math.max(5, range * 0.20);
    this.peakThreshold = this.peakThreshold * 0.92 + newThreshold * 0.08;
    
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
    const rangeFactor = Math.min(1, range / 15) * 30;
    
    // Factor 2: Consistencia de RR
    let rrFactor = 0;
    if (this.rrIntervals.length >= this.MIN_RR_FOR_BPM) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean;
      rrFactor = Math.max(0, (1 - cv * 2.5)) * 40;
    }
    
    // Factor 3: Número de picos
    const peakFactor = Math.min(1, this.consecutivePeaks / 6) * 30;
    
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
   * DETECCIÓN DE PICO
   */
  private detectPeakWithZeroCrossing(normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 7 || dn < 5) return false;
    
    // Zero-crossing de VPG
    const deriv = this.derivativeBuffer.slice(-5);
    const zeroCrossing = deriv[2] >= 0 && deriv[3] < 0 && deriv[4] < 0;
    
    // Máximo local
    const recent = this.signalBuffer.slice(-7);
    const recentNorm = this.normalizeWindow(recent);
    
    const [v0, v1, v2, v3, v4, v5, v6] = recentNorm;
    const isLocalMax = v3 > v2 && v3 > v4 && v3 >= v1 && v3 >= v5;
    
    // Umbral de amplitud
    const aboveThreshold = v3 > this.peakThreshold;
    
    // Pendientes
    const risingSlope = (v3 - v0) > 1.5;
    const fallingSlope = (v3 - v6) > 1.5;
    
    // Intervalo mínimo
    const notTooSoon = timeSinceLastPeak >= this.refractoryPeriod;
    
    // Amplitud relativa
    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = v3 / this.lastPeakValue;
      amplitudeValid = ratio > 0.25 && ratio < 4.0;
    }
    
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
    if (this.rrIntervals.length < this.MIN_RR_FOR_BPM) return 0;
    
    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / mean;
    
    // Ajustar confianza por cantidad de intervalos
    const countFactor = Math.min(1, this.rrIntervals.length / this.STABLE_RR_COUNT);
    
    return Math.max(0, Math.min(1, (1 - cv * 1.5) * countFactor));
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
    this.refractoryPeriod = 280;
    this.lastPeakValue = 0;
    this.adaptiveBaseline = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
