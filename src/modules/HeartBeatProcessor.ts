/**
 * PROCESADOR DE LATIDOS - VERSIÓN OPTIMIZADA
 * 
 * Optimizaciones:
 * - TypedArray para buffer de señal
 * - Normalización incremental
 * - Menos cálculos por frame
 * - Log muy reducido
 */
export class HeartBeatProcessor {
  // Constantes fisiológicas
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 180;
  private readonly MIN_PEAK_INTERVAL_MS = 333;
  private readonly MAX_PEAK_INTERVAL_MS = 1500;
  
  // Buffer optimizado con TypedArray
  private readonly BUFFER_SIZE = 120; // 4 segundos @ 30fps (antes 180)
  private signalBuffer: Float32Array;
  private bufferIndex: number = 0;
  private bufferCount: number = 0;
  
  // Estadísticas incrementales
  private signalMin: number = Infinity;
  private signalMax: number = -Infinity;
  private signalSum: number = 0;
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;
  
  // RR Intervals y BPM
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 8; // Reducido de 12
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.75;
  
  // Audio feedback
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  // Control
  private frameCount: number = 0;
  private consecutivePeaks: number = 0;
  private lastPeakValue: number = 0;

  constructor() {
    this.signalBuffer = new Float32Array(this.BUFFER_SIZE);
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
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  processSignal(filteredValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // 1. ACTUALIZAR BUFFER CIRCULAR
    const idx = this.bufferIndex;
    
    // Actualizar estadísticas incrementales
    if (this.bufferCount === this.BUFFER_SIZE) {
      const oldValue = this.signalBuffer[idx];
      this.signalSum -= oldValue;
    }
    
    this.signalBuffer[idx] = filteredValue;
    this.signalSum += filteredValue;
    
    this.bufferIndex = (idx + 1) % this.BUFFER_SIZE;
    if (this.bufferCount < this.BUFFER_SIZE) {
      this.bufferCount++;
    }
    
    // Recalcular min/max cada 15 frames (no cada frame)
    if (this.frameCount % 15 === 0) {
      this.updateMinMax();
    }
    
    if (this.bufferCount < 30) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0 };
    }
    
    // 2. NORMALIZACIÓN
    const range = this.signalMax - this.signalMin;
    if (range < 0.5) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue: 0, arrhythmiaCount: 0 };
    }
    
    const normalizedValue = ((filteredValue - this.signalMin) / range - 0.5) * 100;
    
    // 3. UMBRAL DINÁMICO (actualizar cada 10 frames)
    if (this.frameCount % 10 === 0) {
      const newThreshold = Math.max(6, Math.min(25, range * 0.25));
      this.peakThreshold = this.peakThreshold * 0.9 + newThreshold * 0.1;
    }
    
    // 4. DETECCIÓN DE PICO
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeak(normalizedValue, timeSinceLastPeak);
      
      if (isPeak) {
        if (this.lastPeakTime > 0 && timeSinceLastPeak <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }
          
          const instantBPM = 60000 / timeSinceLastPeak;
          
          if (this.smoothBPM === 0) {
            this.smoothBPM = instantBPM;
          } else {
            this.smoothBPM = this.smoothBPM * this.BPM_SMOOTHING + instantBPM * (1 - this.BPM_SMOOTHING);
          }
          
          this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
          this.consecutivePeaks++;
        }
        
        this.lastPeakTime = now;
        this.vibrate();
        this.playBeep();
        
        // Log MUY reducido
        if (this.consecutivePeaks <= 3 || this.consecutivePeaks % 10 === 0) {
          console.log(`💓 PICO #${this.consecutivePeaks} BPM=${Math.round(this.smoothBPM)}`);
        }
      }
    }
    
    // 5. CONFIANZA
    const confidence = this.calculateConfidence();
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0
    };
  }
  
  private updateMinMax(): void {
    this.signalMin = Infinity;
    this.signalMax = -Infinity;
    
    const count = Math.min(90, this.bufferCount); // Solo últimos 3 segundos
    for (let i = 0; i < count; i++) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const v = this.signalBuffer[idx];
      if (v < this.signalMin) this.signalMin = v;
      if (v > this.signalMax) this.signalMax = v;
    }
  }
  
  private detectPeak(normalizedValue: number, timeSinceLastPeak: number): boolean {
    if (this.bufferCount < 7) return false;
    
    // Obtener últimos 7 valores
    const values: number[] = [];
    const range = this.signalMax - this.signalMin;
    
    for (let i = 6; i >= 0; i--) {
      const idx = (this.bufferIndex - 1 - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const v = this.signalBuffer[idx];
      const norm = range > 0.5 ? ((v - this.signalMin) / range - 0.5) * 100 : 0;
      values.push(norm);
    }
    
    const [v0, v1, v2, v3, v4, v5, v6] = values;
    
    const isLocalMax = v3 > v2 && v3 > v4 && v3 >= v1 && v3 >= v5;
    const aboveThreshold = v3 > this.peakThreshold;
    const risingSlope = (v3 - v0) > 3;
    const fallingSlope = (v3 - v6) > 3;
    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;
    
    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = v3 / this.lastPeakValue;
      amplitudeValid = ratio > 0.3 && ratio < 3.0;
    }
    
    const isPeak = isLocalMax && aboveThreshold && risingSlope && fallingSlope && notTooSoon && amplitudeValid;
    
    if (isPeak) {
      this.lastPeakValue = v3;
    }
    
    return isPeak;
  }
  
  private calculateConfidence(): number {
    if (this.rrIntervals.length < 3) return 0;
    
    let sum = 0;
    for (const rr of this.rrIntervals) sum += rr;
    const mean = sum / this.rrIntervals.length;
    
    let variance = 0;
    for (const rr of this.rrIntervals) {
      variance += (rr - mean) * (rr - mean);
    }
    variance /= this.rrIntervals.length;
    
    const cv = Math.sqrt(variance) / mean;
    return Math.max(0, Math.min(1, 1 - cv * 2));
  }

  private vibrate(): void {
    try { 
      if (navigator.vibrate) {
        navigator.vibrate(60); // Reducido de 80ms
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
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.1);
      
      this.lastBeepTime = now;
    } catch {}
  }

  getRRIntervals(): number[] { 
    return [...this.rrIntervals]; 
  }
  
  getLastPeakTime(): number { 
    return this.lastPeakTime; 
  }
  
  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}
  
  reset(): void {
    this.bufferIndex = 0;
    this.bufferCount = 0;
    this.signalSum = 0;
    this.signalMin = Infinity;
    this.signalMax = -Infinity;
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 10;
    this.frameCount = 0;
    this.consecutivePeaks = 0;
    this.lastPeakValue = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
