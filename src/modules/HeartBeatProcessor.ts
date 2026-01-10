/**
 * PROCESADOR DE LATIDOS CARDÍACOS - OPTIMIZADO
 * * Incluye:
 * 1. Filtro Pasa-Altos (DC Removal) para eliminar tendencias de luz.
 * 2. Detección de picos adaptativa sobre señal limpia.
 * 3. Gestión de buffer robusta.
 */
export class HeartBeatProcessor {
  private readonly MIN_BPM = 40;
  private readonly MAX_BPM = 200;
  private readonly MIN_PEAK_INTERVAL_MS = 300;  
  private readonly MAX_PEAK_INTERVAL_MS = 1500; 
  
  // Buffer de señal
  private signalBuffer: number[] = [];
  // Aumentamos buffer para tener mejor contexto histórico (3 seg @ 60fps = 180 frames)
  private readonly BUFFER_SIZE = 180; 
  
  // Variables para Filtro Pasa-Altos (High Pass Filter)
  private outputFilter: number = 0;
  private lastInput: number = 0;
  private readonly ALPHA = 0.95; // Factor de suavizado del filtro

  // Detección de picos
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  
  // BPM
  private bpmBuffer: number[] = [];
  private smoothBPM: number = 0;
  
  // RR intervals
  private rrIntervals: number[] = [];
  
  // Audio
  private audioContext: AudioContext | null = null;
  private audioUnlocked: boolean = false;
  private lastBeepTime: number = 0;
  
  private frameCount: number = 0;
  private isArrhythmiaDetected: boolean = false;

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
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  /**
   * Procesa un nuevo valor de brillo (raw data)
   * @param rawValue Valor crudo (invertido) que viene de la cámara
   * @param timestamp Tiempo actual
   */
  processSignal(rawValue: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
  } {
    this.frameCount++;
    const now = timestamp || Date.now();
    
    // 1. FILTRO DE SEÑAL (DC REMOVAL)
    // Eliminamos la línea base constante (brillo de piel) para dejar solo el pulso AC.
    // Fórmula: y[n] = x[n] - x[n-1] + alpha * y[n-1]
    const currentInput = rawValue;
    this.outputFilter = currentInput - this.lastInput + this.ALPHA * this.outputFilter;
    this.lastInput = currentInput;

    // Usamos el valor filtrado para todo el análisis
    const filteredValue = this.outputFilter;

    // 2. Guardar en buffer
    this.signalBuffer.push(filteredValue);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos llenar un poco el buffer antes de analizar
    if (this.signalBuffer.length < 45) {
      return { bpm: 0, confidence: 0, isPeak: false, filteredValue, arrhythmiaCount: 0 };
    }
    
    // 3. Detectar pico sobre la señal filtrada
    const peakResult = this.detectPeak(now);
    
    // Si hay pico, actualizar BPM y feedback
    if (peakResult.isPeak) {
      this.updateBPM(now);
      this.playBeep();
      this.vibrate();
    }
    
    return {
      bpm: Math.round(this.smoothBPM),
      confidence: peakResult.confidence,
      isPeak: peakResult.isPeak,
      filteredValue: filteredValue, // Enviamos señal limpia para dibujar
      arrhythmiaCount: 0
    };
  }

  /**
   * DETECCIÓN DE PICOS ADAPTATIVA
   */
  private detectPeak(now: number): { isPeak: boolean; confidence: number } {
    const n = this.signalBuffer.length;
    // Intervalo mínimo físico (refractario)
    const timeSinceLastPeak = this.lastPeakTime ? now - this.lastPeakTime : 10000;
    if (timeSinceLastPeak < this.MIN_PEAK_INTERVAL_MS) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Analizamos una ventana reciente (ej. últimos 15 frames)
    const windowSize = 15;
    const window = this.signalBuffer.slice(-windowSize);
    
    // Estadísticas locales
    const max = Math.max(...window);
    
    // Buscamos el índice del máximo dentro de la ventana
    // Queremos que el pico esté "centrado" en la ventana para confirmar que baja después de subir
    // Índice relativo al inicio de la ventana (0 a 14)
    let localMaxIdx = -1;
    for(let i=0; i<window.length; i++) {
        if(window[i] === max) {
            localMaxIdx = i;
            break;
        }
    }

    // El pico candidato debe estar en el medio (ej. entre índice 5 y 10)
    // para asegurar que tenemos datos a izquierda (subida) y derecha (bajada)
    if (localMaxIdx < 5 || localMaxIdx > window.length - 5) {
        return { isPeak: false, confidence: 0 };
    }

    // Calcular media y desviación estándar de la ventana para el umbral
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const std = Math.sqrt(window.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / window.length);
    
    // Umbral dinámico: debe sobresalir de la media local
    const threshold = mean + (std * 1.1); // Factor ajustable según sensibilidad deseada

    // Validación de amplitud mínima (para no detectar ruido en silencio)
    // Con la señal filtrada, los picos suelen ser > 0.5 dependiendo de la ganancia
    if (max < threshold || std < 0.1) {
        return { isPeak: false, confidence: 0 };
    }

    // Verificamos que sea un máximo local estricto
    // (el valor central es mayor que sus vecinos inmediatos)
    const centerVal = window[localMaxIdx];
    if (centerVal > window[localMaxIdx-1] && centerVal > window[localMaxIdx+1]) {
        
        // ¡PICO CONFIRMADO!
        // console.log(`✅ PICO DETECTADO: BPM calc=${60000/timeSinceLastPeak}`);
        
        this.previousPeakTime = this.lastPeakTime;
        this.lastPeakTime = now;
        
        // Guardar intervalo RR
        if (this.previousPeakTime) {
          const rr = now - this.previousPeakTime;
          if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
            this.rrIntervals.push(rr);
            if (this.rrIntervals.length > 30) {
              this.rrIntervals.shift();
            }
          }
        }
        
        // Calcular confianza basada en qué tanto supera el umbral
        const confidence = Math.min(1, (max - threshold) / (std || 1));
        return { isPeak: true, confidence };
    }
    
    return { isPeak: false, confidence: 0 };
  }

  private updateBPM(now: number): void {
    if (!this.previousPeakTime) return;
    
    const interval = now - this.previousPeakTime;
    // Filtro básico de intervalos imposibles
    if (interval < this.MIN_PEAK_INTERVAL_MS || interval > this.MAX_PEAK_INTERVAL_MS) return;
    
    const instantBPM = 60000 / interval;
    
    // Suavizado del BPM (Media móvil exponencial)
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      // 70% historia, 30% nuevo valor
      this.smoothBPM = this.smoothBPM * 0.7 + instantBPM * 0.3;
    }
    
    this.smoothBPM = Math.max(this.MIN_BPM, Math.min(this.MAX_BPM, this.smoothBPM));
    
    this.bpmBuffer.push(instantBPM);
    if (this.bpmBuffer.length > 20) { // Buffer un poco más grande
      this.bpmBuffer.shift();
    }
  }

  private vibrate(): void {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(30); // Vibración corta y seca
      }
    } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    
    const now = Date.now();
    // Evitar solapamiento de sonidos
    if (now - this.lastBeepTime < 300) return;
    
    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      // Tono "médico" (más agudo y corto)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t); // La5
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.1);
      
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      
      osc.start(t);
      osc.stop(t + 0.15);
      
      this.lastBeepTime = now;
    } catch {}
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
  
  setFingerDetected(_detected: boolean): void {}

  reset(): void {
    this.signalBuffer = [];
    this.bpmBuffer = [];
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.lastPeakTime = null;
    this.previousPeakTime = null;
    this.frameCount = 0;
    // Resetear filtros
    this.outputFilter = 0;
    this.lastInput = 0;
  }
  
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}
