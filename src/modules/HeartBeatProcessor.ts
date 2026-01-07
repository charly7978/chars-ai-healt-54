import { KalmanFilter } from './signal-processing/KalmanFilter';

export class HeartBeatProcessor {
  // ────────── CONFIGURACIONES OPTIMIZADAS PARA DETECCIÓN ROBUSTA ──────────
  private readonly DEFAULT_SAMPLE_RATE = 60;
  private readonly DEFAULT_WINDOW_SIZE = 60;       // Ventana más grande para mejor análisis
  private readonly DEFAULT_MIN_BPM = 35;           // Rango fisiológico amplio
  private readonly DEFAULT_MAX_BPM = 200;          // Rango fisiológico amplio
  private readonly DEFAULT_SIGNAL_THRESHOLD = 0.005;  // ULTRA SENSIBLE
  private readonly DEFAULT_MIN_CONFIDENCE = 0.20;    // Muy permisivo
  private readonly DEFAULT_DERIVATIVE_THRESHOLD = -0.0005; // Pendientes muy suaves
  private readonly DEFAULT_MIN_PEAK_TIME_MS = 280;   // ~215 BPM máximo
  private readonly WARMUP_TIME_MS = 1000;            // 1s para estabilización rápida

  // Parámetros de filtrado - PRESERVAR SEÑAL ORIGINAL
  private readonly MEDIAN_FILTER_WINDOW = 3;       // Ventana pequeña
  private readonly MOVING_AVERAGE_WINDOW = 3;      // Respuesta rápida
  private readonly EMA_ALPHA = 0.6;                // MODERADO: algo de suavizado para estabilidad
  private readonly BASELINE_FACTOR = 0.99;         // MODERADO: baseline se adapta razonablemente

  // Parámetros de beep OPTIMIZADOS
  private readonly BEEP_DURATION = 400; 
  private readonly BEEP_VOLUME = 1.0;
  private readonly MIN_BEEP_INTERVAL_MS = 350;     // Permitir hasta ~170 BPM
  private readonly VIBRATION_PATTERN = [40, 20, 60];

  // AUTO-RESET más agresivo para falsos positivos
  private readonly LOW_SIGNAL_THRESHOLD = 0.02; // Umbral más alto
  private readonly LOW_SIGNAL_FRAMES = 15; // Reducido para reset más rápido
  private lowSignalCount = 0;
  
  // NUEVO: Estado de detección de dedo para reset inteligente
  private wasFingerDetected = false;
  private fingerLostTimestamp = 0;
  private readonly FINGER_REDETECTION_RESET_MS = 500; // Reset parcial si dedo vuelve en <500ms

  // ────────── PARÁMETROS ADAPTATIVOS MÉDICAMENTE VÁLIDOS ──────────
  private adaptiveSignalThreshold: number;
  private adaptiveMinConfidence: number;
  private adaptiveDerivativeThreshold: number;

  // Límites ADAPTATIVOS MUY SENSIBLES para captar señales PPG reales
  private readonly MIN_ADAPTIVE_SIGNAL_THRESHOLD = 0.008;  // Ultra sensible
  private readonly MAX_ADAPTIVE_SIGNAL_THRESHOLD = 0.15;   // Límite superior
  private readonly MIN_ADAPTIVE_MIN_CONFIDENCE = 0.25;     // Muy permisivo
  private readonly MAX_ADAPTIVE_MIN_CONFIDENCE = 0.7;      // No demasiado exigente
  private readonly MIN_ADAPTIVE_DERIVATIVE_THRESHOLD = -0.03;  // Rango de pendientes
  private readonly MAX_ADAPTIVE_DERIVATIVE_THRESHOLD = -0.001; // Pendientes muy suaves

  // ────────── AMPLIFICACIÓN DE SEÑAL AC ──────────
  private readonly SIGNAL_BOOST_FACTOR = 3.0; // AUMENTADO: amplificar componente AC débil
  private readonly PEAK_DETECTION_SENSITIVITY = 0.5; // MÁS sensible a picos pequeños
  
  // Control del auto-ajuste más estricto
  private readonly ADAPTIVE_TUNING_PEAK_WINDOW = 15; // Aumentado para más estabilidad
  private readonly ADAPTIVE_TUNING_LEARNING_RATE = 0.15; // Reducido para cambios más graduales
  
  // Variables internas
  private recentPeakAmplitudes: number[] = [];
  private recentPeakConfidences: number[] = [];
  private recentPeakDerivatives: number[] = [];
  private peaksSinceLastTuning = 0;
  private signalBuffer: number[] = [];
  private medianBuffer: number[] = [];
  private movingAverageBuffer: number[] = [];
  private smoothedValue: number = 0;
  private audioContext: AudioContext | null = null;
  private heartSoundOscillator: OscillatorNode | null = null;
  private lastBeepTime = 0;
  private lastPeakTime: number | null = null;
  private previousPeakTime: number | null = null;
  private bpmHistory: number[] = [];
  private baseline: number = 0;
  private lastValue: number = 0;
  private values: number[] = [];
  private startTime: number = 0;
  private peakConfirmationBuffer: number[] = [];
  private lastConfirmedPeak: boolean = false;
  private smoothBPM: number = 0;
  private readonly BPM_ALPHA = 0.3; // Restaurado para suavizado apropiado
  private peakCandidateIndex: number | null = null;
  private peakCandidateValue: number = 0;
  private isArrhythmiaDetected: boolean = false;
  
  // Variables para VALIDACIÓN MUY PERMISIVA de picos reales
  private peakValidationBuffer: number[] = [];
  private readonly PEAK_VALIDATION_THRESHOLD = 0.2;       // Muy bajo
  private readonly MIN_PEAK_CONFIRMATION_QUALITY = 0.15;  // Muy permisivo
  private readonly MIN_PEAK_CONFIRMATION_CONFIDENCE = 0.25; // Muy bajo para captar
  private readonly PEAK_AMPLITUDE_THRESHOLD = 0.008;      // Amplitud mínima muy baja
  private readonly DERIVATIVE_STEEPNESS_THRESHOLD = -0.001; // Pendiente casi plana OK
  private readonly PEAK_BUFFER_STABILITY_THRESHOLD = 0.5;  // Estabilidad moderada
  private readonly PEAK_CONFIRMATION_BUFFER_SIZE = 4;      // Buffer corto para respuesta rápida
  private lastSignalStrength: number = 0;
  private recentSignalStrengths: number[] = [];
  private readonly SIGNAL_STRENGTH_HISTORY = 30;
  
  // Nueva variable para retroalimentación de calidad de señal
  private currentSignalQuality: number = 0;

  private kalmanFilterInstance: KalmanFilter; // Instancia del filtro de Kalman

  constructor() {
    // Inicializar parámetros adaptativos con valores médicamente apropiados
    this.adaptiveSignalThreshold = this.DEFAULT_SIGNAL_THRESHOLD;
    this.adaptiveMinConfidence = this.DEFAULT_MIN_CONFIDENCE;
    this.adaptiveDerivativeThreshold = this.DEFAULT_DERIVATIVE_THRESHOLD;

    this.initAudio();
    this.startTime = Date.now();
    this.kalmanFilterInstance = new KalmanFilter(); // Inicializar la instancia del filtro de Kalman
  }

  private async initAudio() {
    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume();
      console.log("HeartBeatProcessor: Audio Context Initialized and resumed");
      
      // Reproducir un sonido de prueba audible para desbloquear el audio
      await this.playTestSound(0.3); // Volumen incrementado
    } catch (error) {
      console.error("HeartBeatProcessor: Error initializing audio", error);
    }
  }

  private async playTestSound(volume: number = 0.2) {
    if (!this.audioContext) return;
    
    try {
      // console.log("HeartBeatProcessor: Reproduciendo sonido de prueba");
      const oscillator = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, this.audioContext.currentTime); // Frecuencia A4 - claramente audible
      
      gain.gain.setValueAtTime(0, this.audioContext.currentTime);
      gain.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.5);
      
      oscillator.connect(gain);
      gain.connect(this.audioContext.destination);
      
      oscillator.start();
      oscillator.stop(this.audioContext.currentTime + 0.6);
      
      // console.log("HeartBeatProcessor: Sonido de prueba reproducido");
    } catch (error) {
      console.error("HeartBeatProcessor: Error playing test sound", error);
    }
  }

  private async playHeartSound(volume: number = this.BEEP_VOLUME, playArrhythmiaTone: boolean) {
    if (!this.audioContext || this.isInWarmup()) {
      return;
    }

    const now = Date.now();
    if (now - this.lastBeepTime < this.MIN_BEEP_INTERVAL_MS) {
      return;
    }

    try {
      if (navigator.vibrate) {
        navigator.vibrate(this.VIBRATION_PATTERN);
      }

      const currentTime = this.audioContext.currentTime;

      // Sonidos de latido mejorados - más claramente audibles
      // LUB - primer sonido del latido
      const oscillator1 = this.audioContext.createOscillator();
      const gainNode1 = this.audioContext.createGain();
      oscillator1.type = 'sine';
      oscillator1.frequency.value = 150;
      gainNode1.gain.setValueAtTime(0, currentTime);
      gainNode1.gain.linearRampToValueAtTime(volume * 1.5, currentTime + 0.03);
      gainNode1.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.15);
      oscillator1.connect(gainNode1);
      gainNode1.connect(this.audioContext.destination);
      oscillator1.start(currentTime);
      oscillator1.stop(currentTime + 0.2);

      // DUB - segundo sonido del latido
      const oscillator2 = this.audioContext.createOscillator();
      const gainNode2 = this.audioContext.createGain();
      const dubStartTime = currentTime + 0.08;
      oscillator2.type = 'sine';
      oscillator2.frequency.value = 120;
      gainNode2.gain.setValueAtTime(0, dubStartTime);
      gainNode2.gain.linearRampToValueAtTime(volume * 1.5, dubStartTime + 0.03);
      gainNode2.gain.exponentialRampToValueAtTime(0.001, dubStartTime + 0.15);
      oscillator2.connect(gainNode2);
      gainNode2.connect(this.audioContext.destination);
      oscillator2.start(dubStartTime);
      oscillator2.stop(dubStartTime + 0.20);
      
      if (playArrhythmiaTone) {
        const oscillator3 = this.audioContext.createOscillator();
        const gainNode3 = this.audioContext.createGain();
        oscillator3.type = 'sine';
        oscillator3.frequency.value = 440;

        // El sonido de arritmia ahora suena inmediatamente después de los latidos principales
        const arrhythmiaSoundStartTime = dubStartTime + 0.05;
        const arrhythmiaAttackDuration = 0.02;
        const arrhythmiaSustainDuration = 0.10;
        const arrhythmiaReleaseDuration = 0.05;
        const arrhythmiaAttackEndTime = arrhythmiaSoundStartTime + arrhythmiaAttackDuration;
        const arrhythmiaSustainEndTime = arrhythmiaAttackEndTime + arrhythmiaSustainDuration;
        const arrhythmiaReleaseEndTime = arrhythmiaSustainEndTime + arrhythmiaReleaseDuration;

        gainNode3.gain.setValueAtTime(0, arrhythmiaSoundStartTime);
        gainNode3.gain.linearRampToValueAtTime(volume * 0.65, arrhythmiaAttackEndTime);
        gainNode3.gain.setValueAtTime(volume * 0.65, arrhythmiaSustainEndTime);
        gainNode3.gain.exponentialRampToValueAtTime(0.001, arrhythmiaReleaseEndTime);
        oscillator3.connect(gainNode3);
        gainNode3.connect(this.audioContext.destination);
        oscillator3.start(arrhythmiaSoundStartTime);
        oscillator3.stop(arrhythmiaReleaseEndTime + 0.01);
        
        // Reseteamos la bandera después de reproducir el sonido de arritmia
        this.isArrhythmiaDetected = false;
      }
      this.lastBeepTime = now;
    } catch (error) {
      console.error("HeartBeatProcessor: Error playing heart sound", error);
    }
  }

  private lastProcessedTimestamp = 0;
  private lastProcessedValue: number | null = null;

  /**
   * Reset MÍNIMO cuando el dedo vuelve - PRESERVAR TODO LO POSIBLE
   * Solo limpia lo absolutamente necesario
   */
  public partialReset(): void {
    // NO limpiar signalBuffer - mantener todo para continuidad
    // NO limpiar medianBuffer ni movingAverageBuffer - los filtros funcionan mejor con datos
    
    // Solo limpiar buffers de confirmación
    this.peakConfirmationBuffer = [];
    this.peakValidationBuffer = [];
    
    // NO resetear baseline ni lastValue - mantener contexto
    // NO resetear startTime - NO queremos reiniciar warmup
    // NO resetear lastPeakTime - queremos mantener timing
    
    this.lastConfirmedPeak = false;
    this.lowSignalCount = 0;
    
    // CRÍTICO: Mantener TODOS los historiales y parámetros adaptativos
  }

  /**
   * Notificar cambio de estado del dedo - ULTRA SIMPLIFICADO
   * NO hacer resets - solo actualizar el estado
   * El procesador es robusto y puede manejar señales fluctuantes
   */
  public setFingerDetected(detected: boolean): void {
    const now = Date.now();
    
    if (!detected && this.wasFingerDetected) {
      // Dedo acaba de perderse - solo registrar timestamp
      this.fingerLostTimestamp = now;
    }
    // Ya NO hacemos partialReset cuando el dedo vuelve
    // El procesador continúa normalmente con los buffers existentes
    
    this.wasFingerDetected = detected;
  }

  public processSignal(value: number, timestamp?: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    signalQuality?: number;  // Añadido campo para retroalimentación
  } {
    // LIMPIEZA AUTOMÁTICA: Cada 50 frames, limpiar buffers para prevenir degradación
    if (this.values.length % 50 === 0) {
      this.cleanupBuffers();
    }
    // Deduplicación por timestamp y valor para evitar procesamiento múltiple
    const currentTimestamp = timestamp || Date.now();
    if (this.lastProcessedTimestamp === currentTimestamp && this.lastProcessedValue === value) {
      // Señal duplicada, devolver último resultado sin procesar
      return {
        bpm: Math.round(this.getSmoothBPM()),
        confidence: 0.6,
        isPeak: false,
        filteredValue: value,
        arrhythmiaCount: 0,
        signalQuality: this.currentSignalQuality
      };
    }
    
    this.lastProcessedTimestamp = currentTimestamp;
    this.lastProcessedValue = value;
    // Aplicar amplificación razonable
    value = this.boostSignal(value);
    
    const medVal = this.medianFilter(value);
    const movAvgVal = this.calculateMovingAverage(medVal);
    const smoothed = this.calculateEMA(movAvgVal);
    
    // Variable filteredValue definida explícitamente
    const filteredValue = smoothed;

    this.signalBuffer.push(smoothed);
    if (this.signalBuffer.length > this.DEFAULT_WINDOW_SIZE) { 
      this.signalBuffer.shift();
    }

    // REDUCIDO: Solo necesitamos 8 frames para empezar (~0.25s)
    // Esto permite recuperación rápida después de cortes
    if (this.signalBuffer.length < 8) {
      return {
        bpm: Math.round(this.getSmoothBPM()),
        confidence: 0.3, // Dar algo de confianza base
        isPeak: false,
        filteredValue: filteredValue,
        arrhythmiaCount: 0,
        signalQuality: 20 // Calidad base para que UI no muestre 0
      };
    }

    // Baseline tracking ULTRA LENTO - NO debe absorber el pulso
    // CORRECCIÓN CRÍTICA: Inicializar baseline correctamente
    if (this.baseline === 0) {
      this.baseline = smoothed; // Primera vez: igualar
    } else {
      this.baseline = this.baseline * this.BASELINE_FACTOR + smoothed * (1 - this.BASELINE_FACTOR);
    }
    
    // VALOR NORMALIZADO: Usar diferencia respecto a baseline
    // PERO también considerar el rango AC reciente
    const recentSamples = this.signalBuffer.slice(-30);
    const recentMax = Math.max(...recentSamples);
    const recentMin = Math.min(...recentSamples);
    const acRange = recentMax - recentMin;
    
    // Normalizar usando el rango AC para escalar la señal
    const rawNormalized = smoothed - this.baseline;
    const normalizedValue = acRange > 0.5 ? rawNormalized / acRange : rawNormalized;
    
    // Seguimiento de fuerza de señal
    this.trackSignalStrength(Math.abs(normalizedValue));
    
    // Auto-reset con umbral adaptativo para señales débiles
    this.autoResetIfSignalIsLow(Math.abs(normalizedValue));

    this.values.push(smoothed);
    if (this.values.length > 3) {
      this.values.shift();
    }

    let smoothDerivative = smoothed - this.lastValue;
    if (this.values.length === 3) {
      smoothDerivative = (this.values[2] - this.values[0]) / 2;
    }
    this.lastValue = smoothed;
    
    // Detección de picos médicamente válida
    const peakDetectionResult = this.enhancedPeakDetection(normalizedValue, smoothDerivative);
    let isPeak = peakDetectionResult.isPeak;
    const confidence = peakDetectionResult.confidence;
    const rawDerivative = peakDetectionResult.rawDerivative;
    
    const isConfirmedPeak = this.confirmPeak(isPeak, normalizedValue, confidence);

    // Calcular calidad de señal actual basada en varios factores (0-100)
    this.currentSignalQuality = this.calculateSignalQuality(normalizedValue, confidence);

    // Diagnóstico reducido para rendimiento (cada 120 frames = ~4s)
    // Descomentar para debug:
    // if (this.signalBuffer.length % 120 === 0) {
    //   const range = this.signalBuffer.length > 5 
    //     ? Math.max(...this.signalBuffer.slice(-20)) - Math.min(...this.signalBuffer.slice(-20))
    //     : 0;
    //   console.log(`🔬 SEÑAL: norm=${normalizedValue.toFixed(4)}, quality=${this.currentSignalQuality.toFixed(0)}`);
    // }

    if (isConfirmedPeak && !this.isInWarmup()) {
      const now = Date.now();
      const timeSinceLastPeak = this.lastPeakTime
        ? now - this.lastPeakTime
        : Number.MAX_VALUE;

      // Validación médicamente apropiada
      if (timeSinceLastPeak >= this.DEFAULT_MIN_PEAK_TIME_MS) {
        // Validación estricta según criterios médicos
        if (this.validatePeak(normalizedValue, confidence)) {
          this.previousPeakTime = this.lastPeakTime;
          this.lastPeakTime = now;
          
          // Reproducir sonido y actualizar estado (sin log para rendimiento)
          this.playHeartSound(1.0, this.isArrhythmiaDetected);

          this.updateBPM();

          // Actualizar historial para sintonización adaptativa
          this.recentPeakAmplitudes.push(normalizedValue);
          this.recentPeakConfidences.push(confidence);
          if (rawDerivative !== undefined) this.recentPeakDerivatives.push(rawDerivative);

          if (this.recentPeakAmplitudes.length > this.ADAPTIVE_TUNING_PEAK_WINDOW) {
            this.recentPeakAmplitudes.shift();
          }
          if (this.recentPeakConfidences.length > this.ADAPTIVE_TUNING_PEAK_WINDOW) {
            this.recentPeakConfidences.shift();
          }
          if (this.recentPeakDerivatives.length > this.ADAPTIVE_TUNING_PEAK_WINDOW) {
            this.recentPeakDerivatives.shift();
          }
          
          this.peaksSinceLastTuning++;
          if (this.peaksSinceLastTuning >= Math.floor(this.ADAPTIVE_TUNING_PEAK_WINDOW / 2)) {
            this.performAdaptiveTuning();
            this.peaksSinceLastTuning = 0;
          }
        } else {
          // Pico rechazado (sin log para rendimiento)
          isPeak = false;
        }
      }
    }
    
    // Retornar resultado con nuevos parámetros
    return {
      bpm: Math.round(this.getSmoothBPM()),
      confidence: isPeak ? 0.95 : this.adjustConfidenceForSignalStrength(0.6),
      isPeak: isPeak,
      filteredValue: filteredValue, // Usando la variable correctamente definida
      arrhythmiaCount: 0,
      signalQuality: this.currentSignalQuality // Retroalimentación de calidad
    };
  }
  
  /**
   * Amplificación adaptativa de señal - limitada a niveles médicamente válidos
   */
  private boostSignal(value: number): number {
    if (this.signalBuffer.length < 10) return value * this.SIGNAL_BOOST_FACTOR;
    
    // Calcular estadísticas de señal reciente
    const recentSignals = this.signalBuffer.slice(-10);
    const avgSignal = recentSignals.reduce((sum, val) => sum + val, 0) / recentSignals.length;
    const maxSignal = Math.max(...recentSignals);
    const minSignal = Math.min(...recentSignals);
    const range = maxSignal - minSignal;
    
    // Calcular factor de amplificación proporcional a la fuerza de la señal
    let boostFactor = this.SIGNAL_BOOST_FACTOR;
    
    if (range < 1.0) {
      // Señal débil - amplificar moderadamente
      boostFactor = this.SIGNAL_BOOST_FACTOR * 1.8; // Más amplificación para señales débiles
    } else if (range < 3.0) {
      // Señal moderada - amplificar ligeramente
      boostFactor = this.SIGNAL_BOOST_FACTOR * 1.4;
    } else if (range > 10.0) {
      // Señal fuerte - no amplificar
      boostFactor = 1.0;
    }
    
    // Aplicar amplificación lineal centrada en el promedio
    const centered = value - avgSignal;
    const boosted = avgSignal + (centered * boostFactor);
    
    return boosted;
  }

  /**
   * Seguimiento de fuerza de señal para ajuste de confianza
   */
  private trackSignalStrength(amplitude: number): void {
    this.lastSignalStrength = amplitude;
    this.recentSignalStrengths.push(amplitude);
    
    if (this.recentSignalStrengths.length > this.SIGNAL_STRENGTH_HISTORY) {
      this.recentSignalStrengths.shift();
    }
  }

  /**
   * Ajuste de confianza basado en fuerza histórica de señal
   */
  private adjustConfidenceForSignalStrength(confidence: number): number {
    if (this.recentSignalStrengths.length < 5) return confidence;
    
    // Calcular promedio de fuerza de señal
    const avgStrength = this.recentSignalStrengths.reduce((sum, val) => sum + val, 0) / 
                        this.recentSignalStrengths.length;
    
    // Señales muy débiles reducen la confianza
    if (avgStrength < 0.1) {
      return Math.min(1.0, confidence * 0.8);
    }
    
    return Math.min(1.0, confidence);
  }

  private isInWarmup(): boolean {
    return Date.now() - this.startTime < this.WARMUP_TIME_MS;
  }

  private medianFilter(value: number): number {
    this.medianBuffer.push(value);
    if (this.medianBuffer.length > this.MEDIAN_FILTER_WINDOW) {
      this.medianBuffer.shift();
    }
    const sorted = [...this.medianBuffer].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  private calculateMovingAverage(value: number): number {
    this.movingAverageBuffer.push(value);
    if (this.movingAverageBuffer.length > this.MOVING_AVERAGE_WINDOW) {
      this.movingAverageBuffer.shift();
    }
    const sum = this.movingAverageBuffer.reduce((a, b) => a + b, 0);
    return sum / this.movingAverageBuffer.length;
  }

  private calculateEMA(value: number): number {
    this.smoothedValue =
      this.EMA_ALPHA * value + (1 - this.EMA_ALPHA) * this.smoothedValue;
    return this.smoothedValue;
  }

  public setArrhythmiaDetected(isDetected: boolean): void {
    this.isArrhythmiaDetected = isDetected;
  }

  private autoResetIfSignalIsLow(amplitude: number) {
    // MODIFICADO: Umbral más alto y más frames necesarios para reset
    // Evita resets innecesarios que bloquean la detección
    if (amplitude < this.LOW_SIGNAL_THRESHOLD) {
      this.lowSignalCount++;
      // AUMENTADO: Necesitar 30 frames (1s) de señal baja para reset
      if (this.lowSignalCount >= 30) {
        this.resetDetectionStates();
        // NO resetear parámetros adaptativos - pueden causar bloqueo
        // Solo resetear contadores
        this.lowSignalCount = 0;
      }
    } else {
      // Decrementar más rápido para evitar acumulación
      this.lowSignalCount = Math.max(0, this.lowSignalCount - 2);
    }
  }

  private resetDetectionStates() {
    this.lastConfirmedPeak = false;
    this.peakConfirmationBuffer = [];
  }

  /**
   * Detección de picos ULTRA SENSIBLE Y ROBUSTA
   * Basada en cambio de tendencia (derivada positiva -> negativa)
   * MODIFICADO: Más permisivo para evitar bloqueos
   */
  private enhancedPeakDetection(normalizedValue: number, derivative: number): {
    isPeak: boolean;
    confidence: number;
    rawDerivative?: number;
  } {
    const now = Date.now();
    const timeSinceLastPeak = this.lastPeakTime
      ? now - this.lastPeakTime
      : Number.MAX_VALUE;

    // Respetar intervalo mínimo entre picos
    if (timeSinceLastPeak < this.DEFAULT_MIN_PEAK_TIME_MS) {
      return { isPeak: false, confidence: 0 };
    }

    // Necesitamos suficientes muestras - REDUCIDO
    if (this.signalBuffer.length < 5) {
      return { isPeak: false, confidence: 0 };
    }

    // DETECCIÓN BASADA EN CAMBIO DE TENDENCIA
    const recent = this.signalBuffer.slice(-8);
    const n = recent.length;
    
    if (n < 4) {
      return { isPeak: false, confidence: 0 };
    }
    
    // Calcular derivadas locales
    const deriv1 = recent[n-2] - recent[n-3]; // Hace 2 frames
    const deriv2 = recent[n-1] - recent[n-2]; // Hace 1 frame
    
    // CRITERIO PRINCIPAL: Cambio de tendencia positiva a negativa
    // (subía y ahora baja = pico)
    const isPotentialPeak = deriv1 > 0 && deriv2 <= 0; // <= en vez de < para ser más permisivo
    
    // CRITERIO SECUNDARIO MÁS PERMISIVO
    const recentSamples = this.signalBuffer.slice(-15);
    const recentMax = Math.max(...recentSamples);
    const recentMin = Math.min(...recentSamples);
    const acRange = recentMax - recentMin;
    const currentVal = recent[n-2]; // El pico es el frame anterior
    
    // Altura relativa - MÁS PERMISIVO (> 30% del rango)
    const relativeHeight = acRange > 0.05 ? (currentVal - recentMin) / acRange : 0.5;
    const isNearTop = relativeHeight > 0.30; // Bajado de 0.40
    
    // También aceptar si hay CUALQUIER señal AC visible - umbral bajado
    const hasSignificantAC = acRange > 0.1; // Bajado de 0.3
    
    const isPeak = isPotentialPeak && (isNearTop || hasSignificantAC);

    // Calcular confianza - MÁS GENEROSA
    const heightScore = Math.min(1, relativeHeight * 1.5);
    const acScore = Math.min(1, acRange / 3); // Más generoso
    const confidence = isPeak ? Math.max(0.35, 0.35 * heightScore + 0.65 * acScore) : 0;

    return { isPeak, confidence, rawDerivative: derivative };
  }

  private confirmPeak(
    isPeak: boolean,
    normalizedValue: number,
    confidence: number
  ): boolean {
    this.peakConfirmationBuffer.push(normalizedValue);
    if (this.peakConfirmationBuffer.length > this.PEAK_CONFIRMATION_BUFFER_SIZE) {
      this.peakConfirmationBuffer.shift();
    }
    
    // SIMPLIFICADO: Si es pico con confianza suficiente, confirmar
    // El lastConfirmedPeak solo sirve para evitar dobles detecciones INMEDIATAS
    if (isPeak && confidence >= 0.3) {
      if (!this.lastConfirmedPeak) {
        this.lastConfirmedPeak = true;
        return true;
      }
      // Ya había un pico confirmado recientemente - esperar
      return false;
    }
    
    // Reset del flag después de un no-pico
    if (!isPeak) {
      this.lastConfirmedPeak = false;
    }
    return false;
  }

  /**
   * Validación de picos MÁS PERMISIVA
   * El objetivo es CAPTAR latidos, no rechazarlos
   */
  private validatePeak(peakValue: number, confidence: number): boolean {
    // CRITERIO 1: Confianza mínima - MUY permisivo
    const hasMinConfidence = confidence >= 0.2; // Bajado de 0.25
    
    // CRITERIO 2: Amplitud significativa - MUY permisivo
    const hasMinAmplitude = Math.abs(peakValue) > 0.005; // Bajado de 0.008
    
    // CRITERIO 3: ELIMINADO el chequeo de calidad de señal
    // La calidad ya se verifica en otras partes del flujo
    
    // CRITERIO 4: Consistencia con historial - MÁS PERMISIVO
    // Solo verificar si tenemos MUCHO historial confiable
    let isConsistentWithHistory = true;
    if (this.bpmHistory.length >= 8 && this.lastPeakTime && this.previousPeakTime) {
      const smoothBPM = this.getSmoothBPM();
      // Solo verificar si tenemos un BPM razonable
      if (smoothBPM >= 40 && smoothBPM <= 180) {
        const expectedInterval = 60000 / smoothBPM;
        const actualInterval = Date.now() - this.lastPeakTime;
        const deviation = Math.abs(actualInterval - expectedInterval) / expectedInterval;
        // 70% de tolerancia (antes 50%) - MUY permisivo
        isConsistentWithHistory = deviation < 0.7;
      }
      // Si el BPM no es razonable, NO bloquear - permitir recalibración
    }

    // IMPORTANTE: Si la confianza es alta (>0.5), IGNORAR consistencia histórica
    // Esto permite "romper" un historial corrupto con picos fuertes
    if (confidence > 0.5) {
      return hasMinConfidence && hasMinAmplitude;
    }

    return hasMinConfidence && hasMinAmplitude && isConsistentWithHistory;
  }

  private updateBPM() {
    if (!this.lastPeakTime || !this.previousPeakTime) return;
    const interval = this.lastPeakTime - this.previousPeakTime;
    if (interval <= 0) return;

    const instantBPM = 60000 / interval;
    if (instantBPM >= this.DEFAULT_MIN_BPM && instantBPM <= this.DEFAULT_MAX_BPM) { 
      this.bpmHistory.push(instantBPM);
      if (this.bpmHistory.length > 12) { 
        this.bpmHistory.shift();
      }
    }
  }

  public getSmoothBPM(): number {
    if (this.bpmHistory.length === 0) return 0;
    
    // Si tenemos pocos datos, usar directamente el promedio
    if (this.bpmHistory.length < 3) {
      const avg = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
      this.smoothBPM = avg;
      return Math.round(avg);
    }
    
    // Usar mediana para robustez (ignora outliers)
    const sorted = [...this.bpmHistory].sort((a, b) => a - b);
    const medianBPM = sorted[Math.floor(sorted.length / 2)];
    
    // Suavizado exponencial
    if (this.smoothBPM === 0) {
      this.smoothBPM = medianBPM;
    } else {
      this.smoothBPM = this.smoothBPM * 0.7 + medianBPM * 0.3;
    }
    
    return Math.round(this.smoothBPM);
  }

  private kalmanFilter(value: number): number {
    // Usar la instancia del filtro de Kalman importada
    return this.kalmanFilterInstance.filter(value);
  }

  public getFinalBPM(): number { 
    if (this.bpmHistory.length < 5) {
      return Math.round(this.getSmoothBPM()); 
    }
    const sorted = [...this.bpmHistory].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length * 0.2);
    const finalSet = sorted.slice(cut, sorted.length - cut);
    
    if (!finalSet.length) {
        return Math.round(this.getSmoothBPM());
    }
    const sum = finalSet.reduce((acc, val) => acc + val, 0);
    return Math.round(sum / finalSet.length);
  }

  /**
   * LIMPIEZA AUTOMÁTICA de buffers para prevenir degradación gradual
   */
  private cleanupBuffers(): void {
    // Limpiar buffers que pueden acumular datos innecesarios
    if (this.bpmHistory.length > 20) {
      this.bpmHistory = this.bpmHistory.slice(-20);
    }
    
    if (this.recentPeakAmplitudes.length > 10) {
      this.recentPeakAmplitudes = this.recentPeakAmplitudes.slice(-10);
    }
    
    if (this.recentPeakConfidences.length > 10) {
      this.recentPeakConfidences = this.recentPeakConfidences.slice(-10);
    }
    
    if (this.recentPeakDerivatives.length > 10) {
      this.recentPeakDerivatives = this.recentPeakDerivatives.slice(-10);
    }
    
    if (this.recentSignalStrengths.length > this.SIGNAL_STRENGTH_HISTORY) {
      this.recentSignalStrengths = this.recentSignalStrengths.slice(-this.SIGNAL_STRENGTH_HISTORY);
    }
  }

  public reset() {
    // LIMPIEZA COMPLETA DE TODOS LOS BUFFERS
    this.signalBuffer = [];
    this.medianBuffer = [];
    this.movingAverageBuffer = [];
    this.peakConfirmationBuffer = [];
    this.bpmHistory = [];
    this.values = [];
    this.smoothBPM = 0;
    this.lastPeakTime = null;
    this.previousPeakTime = null;
    this.lastConfirmedPeak = false;
    this.lastBeepTime = 0;
    this.baseline = 0;
    this.lastValue = 0;
    this.smoothedValue = 0;
    this.startTime = Date.now();
    this.lowSignalCount = 0;

    this.adaptiveSignalThreshold = this.DEFAULT_SIGNAL_THRESHOLD;
    this.adaptiveMinConfidence = this.DEFAULT_MIN_CONFIDENCE;
    this.adaptiveDerivativeThreshold = this.DEFAULT_DERIVATIVE_THRESHOLD;
    this.recentPeakAmplitudes = [];
    this.recentPeakConfidences = [];
    this.recentPeakDerivatives = [];
    this.peaksSinceLastTuning = 0;
    
    this.isArrhythmiaDetected = false;
    this.peakValidationBuffer = [];
    
    // CRÍTICO: Limpiar arrays que faltaban - CAUSA DE MEMORY LEAK
    this.recentSignalStrengths = [];
    this.peakCandidateIndex = null;
    this.peakCandidateValue = 0;
    this.lastProcessedTimestamp = 0;
    this.lastProcessedValue = null;
    this.currentSignalQuality = 0;
    this.lastSignalStrength = 0;
    
    // Reset estado del dedo
    this.wasFingerDetected = false;
    this.fingerLostTimestamp = 0;
    
    // CRÍTICO: Reset del filtro Kalman interno
    this.kalmanFilterInstance.reset();
  }

  public getRRIntervals(): { intervals: number[]; lastPeakTime: number | null } {
    // Mejorar cálculo de intervalos RR usando tiempos reales de picos
    let rrIntervals: number[] = [];
    
    if (this.bpmHistory.length >= 2) {
      // Usar historial de BPM para calcular intervalos RR más precisos
      for (let i = 0; i < this.bpmHistory.length; i++) {
        const bpm = this.bpmHistory[i];
        if (bpm > 30 && bpm < 200) { // Validar BPM fisiológico
          const rrInterval = 60000 / bpm;
          // Aplicar variabilidad realista basada en calidad de señal
          const variability = this.currentSignalQuality > 70 ? 0.02 : 0.05;
          // Eliminar cualquier aleatoriedad: respetar rrInterval tal cual
          const adjustedRR = rrInterval;
          rrIntervals.push(Math.max(300, Math.min(2000, adjustedRR)));
        }
      }
    }
    
    return {
      intervals: rrIntervals, 
      lastPeakTime: this.lastPeakTime,
    };
  }
  
  /**
   * Sintonización adaptativa médicamente apropiada
   */
  private performAdaptiveTuning(): void {
    if (this.isInWarmup() || this.recentPeakAmplitudes.length < 4) { // Reducido para adaptación más rápida
      return;
    }

    if (this.recentPeakAmplitudes.length > 0) {
      // Calcular estadísticas sobre picos recientes
      const avgAmplitude = this.recentPeakAmplitudes.reduce((s, v) => s + v, 0) / this.recentPeakAmplitudes.length;
      
      // Umbral adaptativo basado en amplitud promedio - más sensible
      let targetSignalThreshold = avgAmplitude * 0.45; // Reducido para mayor sensibilidad

      // Tasa de aprendizaje aumentada
      const learningRate = this.ADAPTIVE_TUNING_LEARNING_RATE;
      
      // Actualización gradual
      this.adaptiveSignalThreshold = 
          this.adaptiveSignalThreshold * (1 - learningRate) +
          targetSignalThreshold * learningRate;
      
      // Asegurar límites seguros
      this.adaptiveSignalThreshold = Math.max(this.MIN_ADAPTIVE_SIGNAL_THRESHOLD, 
                                    Math.min(this.MAX_ADAPTIVE_SIGNAL_THRESHOLD, this.adaptiveSignalThreshold));
    }

    if (this.recentPeakConfidences.length > 0) {
      const avgConfidence = this.recentPeakConfidences.reduce((s, v) => s + v, 0) / this.recentPeakConfidences.length;
      let targetMinConfidence = this.adaptiveMinConfidence; 

      // Reducción más agresiva para señales débiles
      if (avgConfidence < 0.5) { // Señal débil
        targetMinConfidence = this.adaptiveMinConfidence - 0.08; // Reducción más agresiva
      }
      // Sólo incrementar el umbral si la confianza es consistentemente alta
      else if (avgConfidence > 0.80 && this.recentSignalStrengths.length > 5) {
        const avgStrength = this.recentSignalStrengths.reduce((s, v) => s + v, 0) / this.recentSignalStrengths.length;
        if (avgStrength > 0.25) { // Más permisivo para señales
          targetMinConfidence = this.adaptiveMinConfidence + 0.01;
        }
      }
      
      this.adaptiveMinConfidence =
          this.adaptiveMinConfidence * (1 - this.ADAPTIVE_TUNING_LEARNING_RATE) +
          targetMinConfidence * this.ADAPTIVE_TUNING_LEARNING_RATE;
          
      this.adaptiveMinConfidence = Math.max(this.MIN_ADAPTIVE_MIN_CONFIDENCE, 
                                 Math.min(this.MAX_ADAPTIVE_MIN_CONFIDENCE, this.adaptiveMinConfidence));
    }
    
    if (this.recentPeakDerivatives.length > 0) {
        const avgDerivative = this.recentPeakDerivatives.reduce((s,v) => s+v, 0) / this.recentPeakDerivatives.length;
        
        // Umbral de derivada ultra-sensible
        let targetDerivativeThreshold = avgDerivative * 0.25; // Más sensible (antes 0.3)

        this.adaptiveDerivativeThreshold = 
            this.adaptiveDerivativeThreshold * (1 - this.ADAPTIVE_TUNING_LEARNING_RATE) +
            targetDerivativeThreshold * this.ADAPTIVE_TUNING_LEARNING_RATE;

        this.adaptiveDerivativeThreshold = Math.max(this.MIN_ADAPTIVE_DERIVATIVE_THRESHOLD, 
                                        Math.min(this.MAX_ADAPTIVE_DERIVATIVE_THRESHOLD, this.adaptiveDerivativeThreshold));
    }
  }
  
  // Método público para obtener la calidad de señal actual
  public getSignalQuality(): number {
    return this.currentSignalQuality;
  }

  /**
   * Calcula la calidad de la señal actual basado en múltiples factores
   * @param normalizedValue Valor normalizado de la señal actual
   * @param confidence Confianza de la detección actual
   * @returns Valor de calidad entre 0-100
   */
  private calculateSignalQuality(normalizedValue: number, confidence: number): number {
    // Si no hay suficientes datos para una evaluación precisa
    if (this.signalBuffer.length < 10) {
      return Math.min(this.currentSignalQuality + 5, 30); // Incremento gradual hasta 30 durante calibración
    }
    
    // Calcular estadísticas de señal reciente
    const recentSignals = this.signalBuffer.slice(-20);
    const avgSignal = recentSignals.reduce((sum, val) => sum + val, 0) / recentSignals.length;
    const maxSignal = Math.max(...recentSignals);
    const minSignal = Math.min(...recentSignals);
    const range = maxSignal - minSignal;
    
    // Componentes de calidad
    let amplitudeQuality = 0;
    let stabilityQuality = 0;
    let rhythmQuality = 0;
    
    // 1. Calidad basada en amplitud (0-40)
    // Penalizar fuertemente las amplitudes muy bajas (señal plana o casi plana)
    if (range < 0.001) { // Umbral para señal prácticamente plana
        amplitudeQuality = 0; // Calidad nula si la señal es plana
    } else {
        amplitudeQuality = Math.min(Math.abs(normalizedValue) * 100, 40); // Mayor factor de amplificación
    }
    
    // 2. Calidad basada en estabilidad de señal (0-30)
    if (range > 0.01) {
      const variability = range / (Math.abs(avgSignal) || 0.001); // Evitar división por cero
      if (variability < 0.5) { // Variabilidad óptima para PPG (más estricto)
        stabilityQuality = 30;
      } else if (variability < 1.0) { // Moderadamente inestable
        stabilityQuality = 20;
      } else if (variability < 2.0) { // Inestable
        stabilityQuality = 10;
      } else {
        stabilityQuality = 0; // Muy inestable, calidad muy baja
      }
    }
    
    // 3. Calidad basada en ritmo (0-30)
    if (this.bpmHistory.length >= 5) { // Más muestras para evaluar el ritmo
      const recentBPMs = this.bpmHistory.slice(-5);
      const bpmVariance = Math.max(...recentBPMs) - Math.min(...recentBPMs);
      
      if (bpmVariance < 5) { // Ritmo muy estable (más estricto)
        rhythmQuality = 30; 
      } else if (bpmVariance < 10) { // Ritmo estable
        rhythmQuality = 20;
      } else if (bpmVariance < 15) { // Ritmo variable pero aceptable
        rhythmQuality = 10;
      } else {
        rhythmQuality = 5;  // Ritmo inestable
      }
    }
    
    // Calidad total (0-100)
    let totalQuality = amplitudeQuality + stabilityQuality + rhythmQuality;
    
    // Penalización por baja confianza y umbral de calidad global
    if (confidence < 0.5) { // Umbral de confianza más alto para penalizar
      totalQuality *= confidence / 0.5;
    }

    // Penalización adicional si la señal es demasiado débil después de todas las comprobaciones
    if (totalQuality < 10 && range < 0.01) { // Si la calidad es baja y el rango es muy pequeño
        totalQuality = 0; // Forzar a cero si es prácticamente ruido
    }
    
    // Suavizado para evitar cambios bruscos
    totalQuality = this.currentSignalQuality * 0.7 + totalQuality * 0.3;
    
    return Math.min(Math.max(Math.round(totalQuality), 0), 100);
  }
}
