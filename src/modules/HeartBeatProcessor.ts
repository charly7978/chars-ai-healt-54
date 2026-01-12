/**
 * PROCESADOR DE LATIDOS OPTIMIZADO
 * 
 * ALGORITMO DE DETECCIÓN ROBUSTO:
 * 1. Normalización adaptativa de señal
 * 2. Detección de picos por máximo local + umbral dinámico
 * 3. Validación de intervalos RR fisiológicos
 * 4. Suavizado exponencial de BPM
 * 5. Feedback táctil y auditivo
 * 
 * Referencia: webcam-pulse-detector (thearn), De Haan & Jeanne 2013
 */
export class HeartBeatProcessor {
  // Constantes fisiológicas
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 200;
  private readonly MIN_PEAK_INTERVAL_MS = 300;  // 200 BPM
  private readonly MAX_PEAK_INTERVAL_MS = 1500; // 40 BPM
  
  // Buffers para análisis
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 150; // 5 segundos @ 30fps
  
  // Detección de picos
  private lastPeakTime: number = 0;
  private peakThreshold: number = 10; // Umbral adaptativo inicial
  
  // RR Intervals y BPM
  private rrIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 10;
  private smoothBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.7; // Factor de suavizado (más alto = más estable)
  
  // Audio feedback
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  // Estadísticas
  private frameCount: number = 0;
  private consecutivePeaks: number = 0;

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
   * Recibe señal ya pasada por filtro pasabanda
   */
  processSignal(filteredValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // 1. GUARDAR EN BUFFER
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos suficientes muestras
    if (this.signalBuffer.length < 30) {
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        filteredValue: 0,
        arrhythmiaCount: 0
      };
    }
    
    // 2. NORMALIZACIÓN ADAPTATIVA
    const { normalizedValue, range } = this.normalizeSignal(filteredValue);
    
    // 3. ACTUALIZAR UMBRAL DINÁMICO
    this.updateThreshold(range);
    
    // 4. DETECCIÓN DE PICO
    const timeSinceLastPeak = now - this.lastPeakTime;
    let isPeak = false;
    
    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      isPeak = this.detectPeak(normalizedValue, timeSinceLastPeak);
      
      if (isPeak) {
        // Registrar intervalo RR
        if (this.lastPeakTime > 0 && timeSinceLastPeak <= this.MAX_PEAK_INTERVAL_MS) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR_INTERVALS) {
            this.rrIntervals.shift();
          }
          
          // Calcular BPM instantáneo
          const instantBPM = 60000 / timeSinceLastPeak;
          
          // Suavizado exponencial
          if (this.smoothBPM === 0) {
            this.smoothBPM = instantBPM;
          } else {
            this.smoothBPM = this.smoothBPM * this.BPM_SMOOTHING + instantBPM * (1 - this.BPM_SMOOTHING);
          }
          
          // Clamp a rango fisiológico
          this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
          
          this.consecutivePeaks++;
        }
        
        this.lastPeakTime = now;
        
        // Feedback
        this.vibrate();
        this.playBeep();
        
        if (this.frameCount % 30 === 0 || this.consecutivePeaks <= 5) {
          console.log(`💓 PICO #${this.consecutivePeaks} BPM=${Math.round(this.smoothBPM)} RR=${timeSinceLastPeak}ms`);
        }
      }
    }
    
    // 5. CALCULAR CONFIANZA
    const confidence = this.calculateConfidence();
    
    // Log periódico
    if (this.frameCount % 60 === 0) {
      console.log(`📊 BPM=${Math.round(this.smoothBPM)} Conf=${(confidence * 100).toFixed(0)}% Picos=${this.consecutivePeaks} Thresh=${this.peakThreshold.toFixed(1)}`);
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0
    };
  }
  
  /**
   * NORMALIZACIÓN ADAPTATIVA
   * Escala la señal a rango -50 a +50 basado en min/max recientes
   */
  private normalizeSignal(value: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-90); // 3 segundos
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    if (range < 0.1) {
      return { normalizedValue: 0, range: 0 };
    }
    
    // Normalizar a -50 a +50
    const normalizedValue = ((value - min) / range - 0.5) * 100;
    
    return { normalizedValue, range };
  }
  
  /**
   * UMBRAL DINÁMICO
   * Ajusta el umbral basado en la amplitud de la señal
   */
  private updateThreshold(range: number): void {
    // El umbral debe ser proporcional a la amplitud de la señal
    // Pero no demasiado bajo para evitar falsos positivos
    const newThreshold = Math.max(5, range * 0.3);
    
    // Suavizar cambios en el umbral
    this.peakThreshold = this.peakThreshold * 0.95 + newThreshold * 0.05;
  }
  
  /**
   * DETECCIÓN DE PICO ROBUSTA
   * Combina:
   * 1. Máximo local (comparación con vecinos)
   * 2. Umbral dinámico
   * 3. Validación de pendiente
   */
  private detectPeak(normalizedValue: number, timeSinceLastPeak: number): boolean {
    const n = this.signalBuffer.length;
    if (n < 5) return false;
    
    // Obtener últimos 5 valores normalizados
    const recent5 = this.signalBuffer.slice(-5).map((v, i, arr) => {
      const recent = this.signalBuffer.slice(-90);
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      const range = max - min;
      if (range < 0.1) return 0;
      return ((v - min) / range - 0.5) * 100;
    });
    
    const [v0, v1, v2, v3, v4] = recent5;
    
    // Condición 1: v2 (el valor del medio) debe ser un máximo local
    const isLocalMax = v2 > v1 && v2 > v3;
    
    // Condición 2: Debe estar por encima del umbral
    const aboveThreshold = v2 > this.peakThreshold;
    
    // Condición 3: Pendiente ascendente antes del pico
    const hasRisingEdge = v1 > v0 || v2 > v1;
    
    // Condición 4: Pendiente descendente después del pico
    const hasFallingEdge = v3 < v2 || v4 < v3;
    
    // Condición 5: No demasiado cerca del pico anterior (anti-rebote)
    const notTooSoon = timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS;
    
    return isLocalMax && aboveThreshold && hasRisingEdge && hasFallingEdge && notTooSoon;
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
    // CV típico para ritmo normal: 0.02-0.08
    // CV > 0.3 indica mucha irregularidad
    const confidence = Math.max(0, Math.min(1, 1 - cv * 2));
    
    return confidence;
  }

  private vibrate(): void {
    try { 
      if (navigator.vibrate) {
        navigator.vibrate(80); // 80ms de vibración
      }
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 200) return; // Evitar beeps muy seguidos
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      // Tono descendente agradable
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
  
  setArrhythmiaDetected(_isDetected: boolean): void {}
  setFingerDetected(_detected: boolean): void {}
  
  reset(): void {
    this.signalBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = 0;
    this.peakThreshold = 10;
    this.frameCount = 0;
    this.consecutivePeaks = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
