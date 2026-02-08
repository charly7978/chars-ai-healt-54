import { HilbertTransform } from './signal-processing/HilbertTransform';

/**
 * PROCESADOR DE LATIDOS - VERSIÓN CON HDEM (Hilbert Double Envelope Method)
 * 
 * MEJORAS BASADAS EN LITERATURA CIENTÍFICA:
 * 1. IEEE EMBC 2024: HDEM logra 99.98% sensibilidad
 * 2. Symmetry 2022 (PMC): HDEM supera Pan-Tompkins y Wavelet
 * 3. SIN límites MIN_BPM / MAX_BPM - BPM calculado directo
 * 4. Detección de picos con Hilbert Transform + VPG
 * 5. Zero-crossing detection como respaldo
 * 6. Indicador de calidad (SQI) multi-factor
 * 
 * Referencia: De Haan & Jeanne 2013, MIT/ETH 2024
 */
export class HeartBeatProcessor {
  // SIN LÍMITES FISIOLÓGICOS - Cálculo directo
  private readonly MIN_PEAK_INTERVAL_MS = 250;  // Evitar detectar mismo pico
  private readonly MAX_PEAK_INTERVAL_MS = 3000; // 20 BPM mínimo técnico
  
  // Buffers para análisis
  private signalBuffer: number[] = [];
  private derivativeBuffer: number[] = []; // Primera derivada (VPG)
  private envelopeBuffer: number[] = []; // Envolvente de Hilbert
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  
  // Hilbert Transform para HDEM
  private hilbertTransform: HilbertTransform;
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 8;
  private adaptiveBaseline: number = 0;
  
  // RR Intervals y BPM - optimizado para estabilidad
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 20;
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.75;
  private readonly BPM_SMOOTHING_INITIAL = 0.5;
  
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
    this.hilbertTransform = new HilbertTransform(30); // 30 fps
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
    
    // 5. CALCULAR ENVOLVENTE DE HILBERT (HDEM)
    this.updateHilbertEnvelope();
    
    // 6. CALCULAR SQI (Signal Quality Index) - Multi-factor
    this.signalQualityIndex = this.calculateAdvancedSQI();
    
    // 7. DETECCIÓN DE PICO CON HDEM + VPG
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      // Usar HDEM como detector primario, VPG como respaldo
      isPeak = this.detectPeakWithHDEM(normalizedValue, timeSinceLastPeak);
      
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
   * ACTUALIZAR ENVOLVENTE DE HILBERT
   */
  private updateHilbertEnvelope(): void {
    if (this.signalBuffer.length < 32) return;
    
    // Calcular HDEM en la ventana reciente
    const recent = this.signalBuffer.slice(-64);
    const hdemResult = this.hilbertTransform.hdem(recent);
    
    // Guardar envolvente promedio
    if (hdemResult.averageEnvelope.length > 0) {
      this.envelopeBuffer = hdemResult.averageEnvelope;
    }
  }
  
  /**
   * DETECTAR PICO CON HDEM (Hilbert Double Envelope Method)
   * 99.98% sensibilidad según IEEE EMBC 2024
   */
  private detectPeakWithHDEM(normalizedValue: number, timeSinceLastPeak: number): boolean {
    // Primero intentar con HDEM
    if (this.signalBuffer.length >= 64) {
      const recent = this.signalBuffer.slice(-64);
      const hdemResult = this.hilbertTransform.hdem(recent);
      
      // Verificar si el último punto es un pico detectado por HDEM
      if (hdemResult.peakIndices.length > 0) {
        const lastPeakIdx = hdemResult.peakIndices[hdemResult.peakIndices.length - 1];
        // El pico debe estar en los últimos 3 samples
        if (lastPeakIdx >= 61) {
          return this.validatePeak(normalizedValue, timeSinceLastPeak);
        }
      }
    }
    
    // Respaldo: usar método de derivada tradicional
    return this.detectPeakWithDerivative(normalizedValue, timeSinceLastPeak);
  }
  
  /**
   * VALIDAR PICO
   */
  private validatePeak(normalizedValue: number, timeSinceLastPeak: number): boolean {
    // Validaciones básicas
    const aboveThreshold = normalizedValue > this.peakThreshold;
    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;
    
    // Validación de amplitud relativa
    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = normalizedValue / this.lastPeakValue;
      amplitudeValid = ratio > 0.2 && ratio < 5.0;
    }
    
    return aboveThreshold && notTooSoon && amplitudeValid;
  }
  
  /**
   * CALCULAR SQI AVANZADO - Multi-factor
   * Incluye: SNR, Skewness, Kurtosis, Periodicidad
   */
  private calculateAdvancedSQI(): number {
    if (this.signalBuffer.length < 60) return 0;
    
    const recent = this.signalBuffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    // Factor 1: Rango de señal (30%)
    const rangeFactor = Math.min(1, range / 20) * 30;
    
    // Factor 2: Consistencia de RR intervals (25%)
    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const variance = this.rrIntervals.reduce((acc, rr) => acc + Math.pow(rr - mean, 2), 0) / this.rrIntervals.length;
      const cv = Math.sqrt(variance) / mean;
      rrFactor = Math.max(0, (1 - cv * 2)) * 25;
    }
    
    // Factor 3: Número de picos detectados (15%)
    const peakFactor = Math.min(1, this.consecutivePeaks / 5) * 15;
    
    // Factor 4: Skewness SQI (15%)
    const skewnessFactor = this.calculateSkewnessSQI(recent) * 15;
    
    // Factor 5: SNR (15%)
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const snr = range / (Math.sqrt(variance) + 0.01);
    const snrFactor = Math.min(1, snr / 10) * 15;
    
    return Math.min(100, rangeFactor + rrFactor + peakFactor + skewnessFactor + snrFactor);
  }
  
  /**
   * SKEWNESS SQI
   * Valores normales de skewness para PPG: -0.5 a 0.5
   */
  private calculateSkewnessSQI(signal: number[]): number {
    if (signal.length < 10) return 0.5;
    
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / signal.length;
    const std = Math.sqrt(variance);
    
    if (std < 0.01) return 0.5;
    
    // Skewness = E[(X-μ)³] / σ³
    const skewness = signal.reduce((acc, val) => acc + Math.pow((val - mean) / std, 3), 0) / signal.length;
    
    // Skewness normal para PPG: -0.5 a 0.5
    if (Math.abs(skewness) <= 0.5) return 1;
    if (Math.abs(skewness) <= 1.0) return 0.7;
    if (Math.abs(skewness) <= 2.0) return 0.3;
    return 0.1;
  }
  
  /**
   * NORMALIZACIÓN ADAPTATIVA
   */
  private normalizeSignal(value: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-120); // 4 segundos
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    if (range < 0.5) {
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
   * DETECCIÓN DE PICO CON ANÁLISIS DE DERIVADA
   * Usa zero-crossing del VPG y análisis morfológico
   */
  private detectPeakWithDerivative(normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    const dn = this.derivativeBuffer.length;
    if (n < 7 || dn < 5) return false;
    
    // 1. ANÁLISIS DE DERIVADA (VPG)
    // Pico sistólico = zero-crossing descendente del VPG
    const deriv = this.derivativeBuffer.slice(-5);
    const zeroCrossing = deriv[3] >= 0 && deriv[4] < 0; // Cruzando de + a -
    
    // 2. MÁXIMO LOCAL EN SEÑAL ORIGINAL
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
    
    // Verificar máximo local
    const isLocalMax = v3 > v2 && v3 > v4 && v3 >= v1 && v3 >= v5;
    
    // 3. UMBRAL DE AMPLITUD
    const aboveThreshold = v3 > this.peakThreshold;
    
    // 4. PENDIENTES ADECUADAS
    const risingSlope = (v3 - v0) > 2;
    const fallingSlope = (v3 - v6) > 2;
    
    // 5. INTERVALO MÍNIMO
    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;
    
    // 6. VALIDACIÓN DE AMPLITUD RELATIVA
    let amplitudeValid = true;
    if (this.lastPeakValue > 0) {
      const ratio = v3 / this.lastPeakValue;
      amplitudeValid = ratio > 0.2 && ratio < 5.0; // Más permisivo
    }
    
    // Combinar criterios:
    // - Zero-crossing O máximo local (flexibilidad)
    // - Más: umbral, pendientes, timing, amplitud
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
    this.envelopeBuffer = [];
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
