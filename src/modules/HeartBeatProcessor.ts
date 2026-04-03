/**
 * PROCESADOR DE LATIDOS - FUSIÓN TIEMPO-FRECUENCIA
 * 
 * CAMBIOS PRINCIPALES:
 * 1. SIN límites MIN_BPM / MAX_BPM - BPM calculado directo
 * 2. Detección de picos con análisis de primera derivada (VPG)
 * 3. Zero-crossing detection para picos sistólicos
 * 4. FFT para estimación BPM en dominio frecuencia
 * 5. Fusión automática picos+FFT según SQI
 * 6. Rechazo de ventanas con artefactos de movimiento
 * 
 * Referencia: De Haan & Jeanne 2013, MIT/ETH 2024
 */
export class HeartBeatProcessor {
  private readonly MIN_PEAK_INTERVAL_MS = 250;
  private readonly MAX_PEAK_INTERVAL_MS = 3000;
  
  // Buffers para análisis
  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  
  // FFT buffer (potencia de 2)
  private readonly FFT_SIZE = 256;
  private fftBuffer: number[] = [];
  private fftBPM: number = 0;
  private fftConfidence: number = 0;
  private readonly FFT_SAMPLE_RATE = 30; // fps asumido
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;
  private adaptiveBaseline: number = 0;
  
  // RR Intervals y BPM
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 20;
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.75;
  private peakBasedBPM: number = 0;
  
  // Audio feedback
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  // Estadísticas
  private frameCount: number = 0;
  private consecutivePeaks: number = 0;
  private lastPeakValue: number = 0;
  private signalQualityIndex: number = 0;
  
  // Movimiento
  private motionRejected: boolean = false;

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
   * Establecer estado de movimiento desde IMU externo
   */
  setMotionRejected(rejected: boolean): void {
    this.motionRejected = rejected;
  }

  /**
   * PROCESAR SEÑAL - FUSIÓN TIEMPO-FRECUENCIA
   */
  processSignal(filteredValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    sqi: number;
    fftBPM: number;
    peakBPM: number;
    fusionMethod: 'PEAK' | 'FFT' | 'FUSED' | 'NONE';
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // 1. BUFFER DE SEÑAL
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // 1b. FFT BUFFER
    this.fftBuffer.push(filteredValue);
    if (this.fftBuffer.length > this.FFT_SIZE) {
      this.fftBuffer.shift();
    }
    
    // 2. PRIMERA DERIVADA (VPG)
    const derivative = this.calculateDerivative();
    this.derivativeBuffer.push(derivative);
    if (this.derivativeBuffer.length > this.BUFFER_SIZE) {
      this.derivativeBuffer.shift();
    }
    
    if (this.signalBuffer.length < 30) {
      return {
        bpm: 0, confidence: 0, isPeak: false, filteredValue: 0,
        arrhythmiaCount: 0, sqi: 0, fftBPM: 0, peakBPM: 0, fusionMethod: 'NONE'
      };
    }
    
    // 3. NORMALIZACIÓN
    const { normalizedValue, range } = this.normalizeSignal(filteredValue);
    
    // 4. UMBRAL DINÁMICO
    this.updateThreshold(range);
    
    // 5. SQI
    this.signalQualityIndex = this.calculateSQI();
    
    // 6. FFT cada ~1 segundo (30 frames)
    if (this.frameCount % 30 === 0 && this.fftBuffer.length >= 128) {
      this.computeFFTBPM();
    }
    
    // 7. DETECCIÓN DE PICO
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    // Si hay artefacto de movimiento, NO detectar picos
    if (this.motionRejected) {
      // No detectar picos durante movimiento - mantener último BPM conocido
    } else if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeakWithDerivative(normalizedValue, timeSinceLastPeak);
      
      if (isPeak) {
        if (this.lastPeakTime > 0 && timeSinceLastPeak <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }
          
          const instantBPM = 60000 / timeSinceLastPeak;
          this.peakBasedBPM = instantBPM;
          
          // Suavizado adaptativo
          if (this.smoothBPM === 0) {
            this.smoothBPM = instantBPM;
          } else {
            const bpmDiff = Math.abs(instantBPM - this.smoothBPM);
            const relativeDiff = bpmDiff / this.smoothBPM;
            
            let sf: number;
            if (relativeDiff > 0.4) sf = 0.92;
            else if (relativeDiff > 0.25) sf = 0.85;
            else if (relativeDiff > 0.15) sf = 0.75;
            else sf = 0.6;
            
            if (this.consecutivePeaks < 5) {
              sf = Math.min(0.9, sf + 0.1);
            }
            
            this.smoothBPM = this.smoothBPM * sf + instantBPM * (1 - sf);
          }
          
          this.consecutivePeaks++;
        }
        
        this.lastPeakTime = now;
        this.vibrate();
        this.playBeep();
        
        if (this.frameCount % 30 === 0 || this.consecutivePeaks <= 5) {
          console.log(`💓 PICO #${this.consecutivePeaks} BPM=${this.smoothBPM.toFixed(1)} RR=${timeSinceLastPeak}ms SQI=${this.signalQualityIndex.toFixed(0)}%`);
        }
      }
    }
    
    // 8. FUSIÓN TIEMPO-FRECUENCIA
    const { fusedBPM, method } = this.fuseBPM();
    
    // 9. CONFIANZA
    const confidence = this.calculateConfidence();
    
    if (this.frameCount % 60 === 0) {
      console.log(`📊 Fusión: ${method} BPM=${fusedBPM.toFixed(1)} Peak=${this.peakBasedBPM.toFixed(1)} FFT=${this.fftBPM.toFixed(1)} SQI=${this.signalQualityIndex.toFixed(0)}% Motion=${this.motionRejected ? 'REJECT' : 'OK'}`);
    }
    
    return {
      bpm: fusedBPM,
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: this.signalQualityIndex,
      fftBPM: this.fftBPM,
      peakBPM: this.peakBasedBPM,
      fusionMethod: method
    };
  }

  /**
   * FUSIÓN TIEMPO-FRECUENCIA
   * Selección automática según calidad de señal
   */
  private fuseBPM(): { fusedBPM: number; method: 'PEAK' | 'FFT' | 'FUSED' | 'NONE' } {
    const hasPeak = this.smoothBPM > 0 && this.consecutivePeaks >= 3;
    const hasFFT = this.fftBPM > 0 && this.fftConfidence > 0.3;
    
    if (!hasPeak && !hasFFT) {
      return { fusedBPM: this.smoothBPM, method: 'NONE' };
    }
    
    // Si hay artefacto de movimiento, preferir FFT (más robusto al ruido)
    if (this.motionRejected) {
      if (hasFFT) return { fusedBPM: this.fftBPM, method: 'FFT' };
      return { fusedBPM: this.smoothBPM, method: 'PEAK' };
    }
    
    // Señal de alta calidad → preferir picos (más preciso latido a latido)
    if (this.signalQualityIndex > 65 && hasPeak) {
      if (hasFFT) {
        // Verificar concordancia: si FFT y picos coinciden, usar picos
        const diff = Math.abs(this.smoothBPM - this.fftBPM);
        if (diff < 10) {
          return { fusedBPM: this.smoothBPM, method: 'PEAK' };
        }
        // Discrepancia → fusionar con peso según SQI
        const peakWeight = this.signalQualityIndex / 100;
        const fused = this.smoothBPM * peakWeight + this.fftBPM * (1 - peakWeight);
        return { fusedBPM: fused, method: 'FUSED' };
      }
      return { fusedBPM: this.smoothBPM, method: 'PEAK' };
    }
    
    // Señal de baja calidad → preferir FFT
    if (this.signalQualityIndex <= 65 && hasFFT) {
      if (hasPeak) {
        const fftWeight = Math.max(0.5, 1 - this.signalQualityIndex / 100);
        const fused = this.smoothBPM * (1 - fftWeight) + this.fftBPM * fftWeight;
        return { fusedBPM: fused, method: 'FUSED' };
      }
      return { fusedBPM: this.fftBPM, method: 'FFT' };
    }
    
    return { fusedBPM: this.smoothBPM, method: hasPeak ? 'PEAK' : 'NONE' };
  }

  /**
   * FFT BPM - Estimación por dominio frecuencia
   * Usa una FFT simplificada (DFT en banda cardíaca)
   */
  private computeFFTBPM(): void {
    const N = this.fftBuffer.length;
    if (N < 128) return;

    // Usar últimos datos, aplicar ventana Hanning
    const data = this.fftBuffer.slice(-N);
    const mean = data.reduce((a, b) => a + b, 0) / N;
    const windowed = data.map((v, i) => {
      const hann = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
      return (v - mean) * hann;
    });

    // DFT solo en banda cardíaca (0.7-3.5 Hz = 42-210 BPM)
    const minFreq = 0.7;
    const maxFreq = 3.5;
    const freqResolution = this.FFT_SAMPLE_RATE / N;
    const minBin = Math.floor(minFreq / freqResolution);
    const maxBin = Math.ceil(maxFreq / freqResolution);

    let maxPower = 0;
    let peakBin = 0;
    let totalPower = 0;
    const powers: number[] = [];

    for (let k = minBin; k <= maxBin && k < N / 2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        re += windowed[n] * Math.cos(angle);
        im += windowed[n] * Math.sin(angle);
      }
      const power = re * re + im * im;
      powers.push(power);
      totalPower += power;

      if (power > maxPower) {
        maxPower = power;
        peakBin = k;
      }
    }

    if (peakBin === 0 || totalPower === 0) return;

    // Interpolación parabólica para precisión sub-bin
    const peakIdx = peakBin - minBin;
    let refinedBin = peakBin;
    if (peakIdx > 0 && peakIdx < powers.length - 1) {
      const alpha = powers[peakIdx - 1];
      const beta = powers[peakIdx];
      const gamma = powers[peakIdx + 1];
      const denom = alpha - 2 * beta + gamma;
      if (Math.abs(denom) > 1e-10) {
        const p = 0.5 * (alpha - gamma) / denom;
        refinedBin = peakBin + p;
      }
    }

    const peakFreq = refinedBin * freqResolution;
    this.fftBPM = peakFreq * 60;

    // Confianza FFT: ratio pico/total (spectral purity)
    this.fftConfidence = maxPower / totalPower;
  }
  
  private calculateDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    return (this.signalBuffer[n - 1] - this.signalBuffer[n - 3]) / 2;
  }
  
  private calculateSQI(): number {
    if (this.signalBuffer.length < 60) return 0;
    
    const recent = this.signalBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    const rangeFactor = Math.min(1, range / 20) * 40;
    
    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean;
      rrFactor = Math.max(0, (1 - cv * 2)) * 30;
    }
    
    const peakFactor = Math.min(1, this.consecutivePeaks / 5) * 30;
    
    // Penalizar si hay movimiento
    const motionPenalty = this.motionRejected ? 20 : 0;
    
    return Math.min(100, Math.max(0, rangeFactor + rrFactor + peakFactor - motionPenalty));
  }
  
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
  
  private updateThreshold(range: number): void {
    const newThreshold = Math.max(5, range * 0.2);
    this.peakThreshold = this.peakThreshold * 0.9 + newThreshold * 0.1;
  }
  
  private detectPeakWithDerivative(normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 7 || dn < 5) return false;
    
    const deriv = this.derivativeBuffer.slice(-5);
    const zeroCrossing = deriv[3] >= 0 && deriv[4] < 0;
    
    const recent = this.signalBuffer.slice(-7);
    const recentNormalized = recent.map(v => {
      const slice = this.signalBuffer.slice(-120);
      const min = Math.min(...slice);
      const max = Math.max(...slice);
      const range = max - min;
      if (range < 0.5) return 0;
      return ((v - min) / range - 0.5) * 100;
    });
    
    const [v0, v1, v2, v3, v4, v5, v6] = recentNormalized;
    
    const isLocalMax = v3 > v2 && v3 > v4 && v3 >= v1 && v3 >= v5;
    const aboveThreshold = v3 > this.peakThreshold;
    const risingSlope = (v3 - v0) > 2;
    const fallingSlope = (v3 - v6) > 2;
    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;
    
    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = v3 / this.lastPeakValue;
      amplitudeValid = ratio > 0.2 && ratio < 5.0;
    }
    
    const isPeak = (zeroCrossing || isLocalMax) && 
                   aboveThreshold && risingSlope && fallingSlope && 
                   notTooSoon && amplitudeValid;
    
    if (isPeak) {
      this.lastPeakValue = v3;
    }
    
    return isPeak;
  }
  
  private calculateConfidence(): number {
    if (this.rrIntervals.length < 3) return 0;
    
    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / mean;
    
    return Math.max(0, Math.min(1, 1 - cv * 1.5));
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
  
  getFFTBPM(): number {
    return this.fftBPM;
  }

  getFFTConfidence(): number {
    return this.fftConfidence;
  }
  
  getDerivativeBuffer(): number[] {
    return [...this.derivativeBuffer];
  }
  
  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}
  
  reset(): void {
    this.signalBuffer = [];
    this.derivativeBuffer = [];
    this.fftBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.peakBasedBPM = 0;
    this.fftBPM = 0;
    this.fftConfidence = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 10;
    this.frameCount = 0;
    this.consecutivePeaks = 0;
    this.signalQualityIndex = 0;
    this.motionRejected = false;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}

