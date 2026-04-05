/**
 * PROCESADOR DE LATIDOS - VERSIÓN SIN CLAMPS
 * 
 * CAMBIOS PRINCIPALES:
 * 1. SIN límites MIN_BPM / MAX_BPM - BPM calculado directo
 * 2. Detección de picos con análisis de primera derivada (VPG)
 * 3. Zero-crossing detection para picos sistólicos
 * 4. BPM crudo desde intervalos RR reales
 * 5. Indicador de calidad (SQI) en lugar de clamps
 * 
 * Referencia: De Haan & Jeanne 2013, MIT/ETH 2024
 */
export class HeartBeatProcessor {
  // SIN LÍMITES FISIOLÓGICOS - Cálculo directo
  // Solo intervalos mínimos para evitar ruido de alta frecuencia
  private readonly MIN_PEAK_INTERVAL_MS = 250;  // Evitar detectar mismo pico
  private readonly MAX_PEAK_INTERVAL_MS = 3000; // 20 BPM mínimo técnico
  
  // Buffers para análisis
  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = []; // Primera derivada (VPG)
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;
  private adaptiveBaseline: number = 0;
  
  // RR Intervals y BPM - optimizado para estabilidad
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 20; // Más intervalos para mejor promedio
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.75; // Mayor suavizado para estabilidad
  private readonly BPM_SMOOTHING_INITIAL = 0.5; // Menos suavizado al inicio
  
  // Audio feedback
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  // Estadísticas
  private frameCount: number = 0;
  private consecutivePeaks: number = 0;
  private lastPeakValue: number = 0;
  private signalQualityIndex: number = 0; // SQI 0-100

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
   * PROCESAR SEÑAL FILTRADA - SIN CLAMPS
   * Retorna BPM crudo directamente calculado
   */
  processSignal(filteredValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    sqi: number; // Signal Quality Index
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // 1. GUARDAR EN BUFFER
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // 2. CALCULAR PRIMERA DERIVADA (VPG - Velocidad)
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
        sqi: 0
      };
    }
    
    // 3. NORMALIZACIÓN ADAPTATIVA
    const { normalizedValue, range } = this.normalizeSignal(filteredValue);
    
    // 4. ACTUALIZAR UMBRAL DINÁMICO
    this.updateThreshold(range);
    
    // 5. CALCULAR SQI (Signal Quality Index)
    this.signalQualityIndex = this.calculateSQI();
    
    // 6. DETECCIÓN DE PICO CON ANÁLISIS DE DERIVADA
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeakWithDerivative(normalizedValue, timeSinceLastPeak);
      
      if (isPeak) {
        // Registrar intervalo RR
        if (this.lastPeakTime > 0 && timeSinceLastPeak <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }
          
          // Calcular BPM instantáneo
          const instantBPM = 60000 / timeSinceLastPeak;
          
          // === SUAVIZADO ADAPTATIVO MEJORADO ===
          // Basado en la cantidad de datos y la estabilidad
          if (this.smoothBPM === 0) {
            // Primera medición - usar directamente
            this.smoothBPM = instantBPM;
          } else {
            // Calcular diferencia relativa
            const bpmDiff = Math.abs(instantBPM - this.smoothBPM);
            const relativeDiff = bpmDiff / this.smoothBPM;
            
            // Seleccionar factor de suavizado basado en:
            // 1. Cuántos picos consecutivos tenemos (más = más confianza)
            // 2. Cuán diferente es el nuevo valor (muy diferente = más suavizado)
            let smoothingFactor: number;
            
            if (relativeDiff > 0.4) {
              // Cambio muy grande (>40%) - probablemente ruido, suavizar mucho
              smoothingFactor = 0.92;
            } else if (relativeDiff > 0.25) {
              // Cambio grande - suavizar bastante
              smoothingFactor = 0.85;
            } else if (relativeDiff > 0.15) {
              // Cambio moderado - suavizado normal
              smoothingFactor = 0.75;
            } else {
              // Cambio pequeño - responder más rápido
              smoothingFactor = 0.6;
            }
            
            // Si tenemos pocos picos, ser más conservador
            if (this.consecutivePeaks < 5) {
              smoothingFactor = Math.min(0.9, smoothingFactor + 0.1);
            }
            
            this.smoothBPM = this.smoothBPM * smoothingFactor + instantBPM * (1 - smoothingFactor);
          }
          
          this.consecutivePeaks++;
        }
        
        this.lastPeakTime = now;
        
        // Feedback
        this.vibrate();
        this.playBeep();
        
        if (this.frameCount % 30 === 0 || this.consecutivePeaks <= 5) {
          console.log(`💓 PICO #${this.consecutivePeaks} BPM=${this.smoothBPM.toFixed(1)} RR=${timeSinceLastPeak}ms SQI=${this.signalQualityIndex.toFixed(0)}%`);
        }
      }
    }
    
    // 7. CALCULAR CONFIANZA
    const confidence = this.calculateConfidence();
    
    // Log periódico
    if (this.frameCount % 60 === 0) {
      console.log(`📊 BPM=${this.smoothBPM.toFixed(1)} Conf=${(confidence * 100).toFixed(0)}% SQI=${this.signalQualityIndex.toFixed(0)}% Picos=${this.consecutivePeaks}`);
    }
    
    return {
      bpm: this.smoothBPM, // BPM crudo, puede ser decimal
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: this.signalQualityIndex
    };
  }
  
  /**
   * CALCULAR PRIMERA DERIVADA (VPG)
   * Detecta cambios de pendiente para zero-crossing
   */
  private calculateDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    
    // Derivada central: (f(x+h) - f(x-h)) / 2h
    const current = this.signalBuffer[n - 1];
    const previous = this.signalBuffer[n - 2];
    const older = this.signalBuffer[n - 3];
    
    // Derivada suavizada
    return (current - older) / 2;
  }
  
  /**
   * CALCULAR SIGNAL QUALITY INDEX (SQI)
   * Reemplaza los clamps fisiológicos
   */
  private calculateSQI(): number {
    if (this.signalBuffer.length < 60) return 0;
    
    const recent = this.signalBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    // Factor 1: Rango de señal (debe ser suficiente para detectar pulsos)
    const rangeFactor = Math.min(1, range / 8) * 40;
    
    // Factor 2: Consistencia de RR intervals
    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean;
      // CV bajo = ritmo regular = mayor calidad
      rrFactor = Math.max(0, (1 - cv * 2)) * 30;
    }
    
    // Factor 3: Número de picos detectados
    const peakFactor = Math.min(1, this.consecutivePeaks / 5) * 30;
    
    return Math.min(100, rangeFactor + rrFactor + peakFactor);
  }
  
  /**
   * NORMALIZACIÓN ADAPTATIVA
   */
  private normalizeSignal(value: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-120); // 4 segundos
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    if (range < 0.06) {
      return { normalizedValue: 0, range: 0 };
    }
    
    // Normalizar a -50 a +50
    const normalizedValue = ((value - min) / range - 0.5) * 100;
    
    return { normalizedValue, range };
  }
  
  /**
   * UMBRAL DINÁMICO
   */
  private updateThreshold(range: number): void {
    // Umbral proporcional a la amplitud pero adaptativo
    const newThreshold = Math.max(5, range * 0.2);
    
    // Suavizar cambios
    this.peakThreshold = this.peakThreshold * 0.9 + newThreshold * 0.1;
  }
  
  /**
   * DETECCIÓN DE PICO CON ANÁLISIS DE DERIVADA (VPG)
   * - Cruce VPG de + → − (descenso tras el máximo sistólico)
   * - Máximo local en ventana corta alineada al instante actual (sin desfase de 3 frames)
   */
  private detectPeakWithDerivative(_normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 6 || dn < 4) return false;

    const dPrev = this.derivativeBuffer[dn - 2];
    const dCurr = this.derivativeBuffer[dn - 1];
    const zeroCrossingDown = dPrev > 0 && dCurr <= 0;

    const slice = this.signalBuffer.slice(-120);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    const range = max - min;
    if (range < 0.06) return false;

    const norm = (v: number) => ((v - min) / range - 0.5) * 100;
    const tail = this.signalBuffer.slice(-6);
    const nv = tail.map(norm);

    // nv[5] = muestra más reciente; pico causal típico en nv[4] o nv[3] al cruzar VPG
    const vPeak = nv[4];
    const isLocalMax =
      vPeak >= nv[3] && vPeak >= nv[5] && vPeak >= nv[2];

    const aboveThreshold = vPeak > this.peakThreshold;

    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;

    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = vPeak / this.lastPeakValue;
      amplitudeValid = ratio > 0.15 && ratio < 6.0;
    }

    // Pendientes suaves: subida antes del pico y bajada después (evita ruido HF)
    const risingBefore = vPeak - nv[1] > 1;
    const fallingAfter = vPeak - nv[5] > 0.5;

    const isPeak =
      (zeroCrossingDown || isLocalMax) &&
      aboveThreshold &&
      (risingBefore || zeroCrossingDown) &&
      (fallingAfter || zeroCrossingDown) &&
      notTooSoon &&
      amplitudeValid;

    if (isPeak) {
      this.lastPeakValue = vPeak;
    }

    return isPeak;
  }
  
  /**
   * CALCULAR CONFIANZA
   * Basado en la consistencia de intervalos RR
   */
  private calculateConfidence(): number {
    if (this.rrIntervals.length < 3) return 0;
    
    // Calcular variabilidad de intervalos RR
    const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
    const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
    const cv = Math.sqrt(variance) / mean; // Coeficiente de variación
    
    // Menor variabilidad = mayor confianza
    const confidence = Math.max(0, Math.min(1, 1 - cv * 1.5));
    
    return confidence;
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
      
      // Tono descendente
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
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
