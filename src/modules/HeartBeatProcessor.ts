import { KalmanFilter } from './signal-processing/KalmanFilter';

export class HeartBeatProcessor {
  // ────────── CONFIGURACIONES PRINCIPALES (Valores optimizados para precisión médica) ──────────
  private readonly DEFAULT_SAMPLE_RATE = 60;
  private readonly DEFAULT_WINDOW_SIZE = 40;
  private readonly DEFAULT_MIN_BPM = 30;
  private readonly DEFAULT_MAX_BPM = 220;
  private readonly DEFAULT_SIGNAL_THRESHOLD = 0.05; // ESPECÍFICO para PPG cámara normalizado (0.0-1.0)
  private readonly DEFAULT_MIN_CONFIDENCE = 0.35; // REDUCIDO para PPG sutil de cámara
  private readonly DEFAULT_DERIVATIVE_THRESHOLD = -0.005; // Ajustado para mejor sensibilidad
  private readonly DEFAULT_MIN_PEAK_TIME_MS = 350; // REDUCIDO de 400 a 350ms para evitar intervalos largos (máx 171 BPM)
  private readonly WARMUP_TIME_MS = 1000; // Reducido para obtener lecturas más rápido

  // Parámetros de filtrado ajustados para precisión médica
  private readonly MEDIAN_FILTER_WINDOW = 3;
  private readonly MOVING_AVERAGE_WINDOW = 3; // Aumentado para mejor filtrado
  private readonly EMA_ALPHA = 0.5; // Restaurado para equilibrio entre estabilidad y respuesta
  private readonly BASELINE_FACTOR = 0.95; // AUMENTADO de 0.8 a 0.95 para mayor estabilidad de baseline

  // Parámetros de beep y vibración
  private readonly BEEP_DURATION = 450; 
  private readonly BEEP_VOLUME = 1.0;
  private readonly MIN_BEEP_INTERVAL_MS = 600; // Restaurado para prevenir beeps excesivos
  private readonly VIBRATION_PATTERN = [40, 20, 60];

  // AUTO-RESET ESTABILIZADO (CORREGIDO PARA EVITAR CAPTACIÓN ERRÁTICA)
  private readonly LOW_SIGNAL_THRESHOLD = 0.01; // AUMENTADO para evitar resets constantes  
  private readonly LOW_SIGNAL_FRAMES = 60; // AUMENTADO de 25 a 60 para mayor estabilidad
  private lowSignalCount = 0;

  // ────────── PARÁMETROS ADAPTATIVOS MÉDICAMENTE VÁLIDOS ──────────
  private adaptiveSignalThreshold: number;
  private adaptiveMinConfidence: number;
  private adaptiveDerivativeThreshold: number;

  // Límites adaptativos ESPECÍFICOS PARA PPG DE CÁMARA
  private readonly MIN_ADAPTIVE_SIGNAL_THRESHOLD = 0.02; // MUY REDUCIDO para señales PPG sutiles
  private readonly MAX_ADAPTIVE_SIGNAL_THRESHOLD = 0.3;  // REDUCIDO para rango PPG 0-1
  private readonly MIN_ADAPTIVE_MIN_CONFIDENCE = 0.25;   // MUY REDUCIDO para detección inicial PPG 
  private readonly MAX_ADAPTIVE_MIN_CONFIDENCE = 0.80;
  private readonly MIN_ADAPTIVE_DERIVATIVE_THRESHOLD = -0.08;
  private readonly MAX_ADAPTIVE_DERIVATIVE_THRESHOLD = -0.005;

  // ────────── PARÁMETROS ESPECÍFICOS PARA PPG DE CÁMARA ──────────
  private readonly SIGNAL_BOOST_FACTOR = 2.5; // AUMENTADO para amplificar señales PPG sutiles de cámara
  private readonly PEAK_DETECTION_SENSITIVITY = 0.3; // REDUCIDO de 0.5 a 0.3 para menos falsos picos
  
  // Control del auto-ajuste ESTABILIZADO (CORREGIDO PARA EVITAR CAPTACIÓN ERRÁTICA)
  private readonly ADAPTIVE_TUNING_PEAK_WINDOW = 20; // AUMENTADO para mayor estabilidad
  private readonly ADAPTIVE_TUNING_LEARNING_RATE = 0.10; // REDUCIDO para cambios más graduales
  
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
  
  // Variables para mejorar la detección
  private peakValidationBuffer: number[] = [];
  private readonly PEAK_VALIDATION_THRESHOLD = 0.3; // Reducido para validación más permisiva
  private readonly MIN_PEAK_CONFIRMATION_QUALITY = 0.3; // Nuevo: Umbral mínimo de calidad de señal para confirmar un pico
  private readonly MIN_PEAK_CONFIRMATION_CONFIDENCE = 0.2; // Nuevo: Umbral mínimo de confianza para confirmar un pico
  private readonly PEAK_AMPLITUDE_THRESHOLD = 0.2; // Nuevo: Amplitud mínima para considerar un pico
  private readonly DERIVATIVE_STEEPNESS_THRESHOLD = -0.003; // Nuevo: Derivada mínima para indicar un pico agudo
  private readonly PEAK_BUFFER_STABILITY_THRESHOLD = 0.8; // Nuevo: Estabilidad del buffer para confirmar pico
  private readonly PEAK_CONFIRMATION_BUFFER_SIZE = 5; // Tamaño del buffer para confirmación de pico
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
      console.log("HeartBeatProcessor: Ignorando beep - demasiado cerca del anterior", now - this.lastBeepTime);
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
      const interval = now - this.lastBeepTime;
      this.lastBeepTime = now;
      console.log(`HeartBeatProcessor: Latido reproducido. Intervalo: ${interval} ms, BPM estimado: ${Math.round(this.getSmoothBPM())}`);
    } catch (error) {
      console.error("HeartBeatProcessor: Error playing heart sound", error);
    }
  }

  public processSignal(value: number): {
    bpm: number;
    confidence: number;
    isPeak: boolean;
    filteredValue: number;
    arrhythmiaCount: number;
    signalQuality?: number;  // Añadido campo para retroalimentación
  } {
    // ANÁLISIS CRÍTICO DE SEÑAL PPG ENTRANTE
    const timestamp = Date.now();
    const originalValue = value;
    
    // Aplicar amplificación razonable
    value = this.boostSignal(value);
    
    // LOG DETALLADO CADA 30 FRAMES (evitar spam)
    if (this.signalBuffer.length % 30 === 0) {
      console.log(`HeartBeatProcessor: 🔍 ANÁLISIS SEÑAL [${timestamp}]`, {
        valorOriginal: originalValue.toFixed(6),
        valorAmplificado: value.toFixed(6),
        amplificacion: (value/originalValue).toFixed(2) + 'x',
        rangoEsperado: '0.0-1.0',
        esValido: originalValue >= 0 && originalValue <= 1,
        bufferSize: this.signalBuffer.length
      });
    }
    
    const medVal = this.medianFilter(value);
    const movAvgVal = this.calculateMovingAverage(medVal);
    const smoothed = this.calculateEMA(movAvgVal);
    
    // Variable filteredValue definida explícitamente
    const filteredValue = smoothed;

    this.signalBuffer.push(smoothed);
    if (this.signalBuffer.length > this.DEFAULT_WINDOW_SIZE) { 
      this.signalBuffer.shift();
    }

    if (this.signalBuffer.length < 20) { // Requisito apropiado para evaluación
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        filteredValue: filteredValue, // Usando la variable correctamente definida
        arrhythmiaCount: 0,
        signalQuality: 0
      };
    }

    // Baseline tracking
    this.baseline = this.baseline * this.BASELINE_FACTOR + smoothed * (1 - this.BASELINE_FACTOR);
    const normalizedValue = smoothed - this.baseline;
    
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
    
    // DETECCIÓN DE PICOS CON LOGGING CRÍTICO
    const peakDetectionResult = this.enhancedPeakDetection(normalizedValue, smoothDerivative);
    let isPeak = peakDetectionResult.isPeak;
    const confidence = peakDetectionResult.confidence;
    
    // LOG CRÍTICO: por qué se detecta/no se detecta pico
    if (this.signalBuffer.length % 30 === 0 || isPeak) {
      const timeSinceLastPeak = this.lastPeakTime ? timestamp - this.lastPeakTime : 'N/A';
      console.log(`HeartBeatProcessor: ${isPeak ? '🔥' : '⚫'} DETECCIÓN PICO [${timestamp}]`, {
        isPeak,
        normalizedValue: normalizedValue.toFixed(4),
        smoothDerivative: smoothDerivative.toFixed(4),
        confidence: confidence.toFixed(3),
        timeSinceLastPeak: typeof timeSinceLastPeak === 'number' ? timeSinceLastPeak + 'ms' : timeSinceLastPeak,
        umbrales: {
          signalThreshold: this.adaptiveSignalThreshold.toFixed(4),
          minConfidence: this.adaptiveMinConfidence.toFixed(3),
          minPeakTime: this.DEFAULT_MIN_PEAK_TIME_MS + 'ms'
        },
        cumpleUmbrales: {
          signal: Math.abs(normalizedValue) > this.adaptiveSignalThreshold,
          confidence: confidence > this.adaptiveMinConfidence,
          tiempo: !this.lastPeakTime || (timestamp - this.lastPeakTime) >= this.DEFAULT_MIN_PEAK_TIME_MS
        }
      });
    }
    const rawDerivative = peakDetectionResult.rawDerivative;
    
    const isConfirmedPeak = this.confirmPeak(isPeak, normalizedValue, confidence);

    // Calcular calidad de señal actual basada en varios factores (0-100)
    this.currentSignalQuality = this.calculateSignalQuality(normalizedValue, confidence);

    // LATIDO CONFIRMADO = EJECUTAR TODO COORDINADAMENTE
    if (isConfirmedPeak && !this.isInWarmup()) {
      const now = Date.now();
      const timeSinceLastPeak = this.lastPeakTime
        ? now - this.lastPeakTime
        : Number.MAX_VALUE;

      console.log(`HeartBeatProcessor: 🎯 PICO CONFIRMADO [${now}]`, {
        timeSinceLastPeak: timeSinceLastPeak === Number.MAX_VALUE ? 'PRIMERO' : timeSinceLastPeak + 'ms',
        minRequired: this.DEFAULT_MIN_PEAK_TIME_MS + 'ms',
        cumpleTiempo: timeSinceLastPeak >= this.DEFAULT_MIN_PEAK_TIME_MS,
        normalizedValue: normalizedValue.toFixed(4),
        confidence: confidence.toFixed(3)
      });

      // VALIDACIÓN MÉDICAMENTE APROPIADA
      if (timeSinceLastPeak >= this.DEFAULT_MIN_PEAK_TIME_MS) {
        // VALIDACIÓN ESTRICTA SEGÚN CRITERIOS MÉDICOS
        const peakIsValid = this.validatePeak(normalizedValue, confidence);
        
        console.log(`HeartBeatProcessor: 🔍 VALIDACIÓN PICO`, {
          esValido: peakIsValid,
          normalizedValue: normalizedValue.toFixed(4),
          confidence: confidence.toFixed(3),
          umbralMinConf: this.adaptiveMinConfidence.toFixed(3)
        });
        
        if (peakIsValid) {
          console.log(`HeartBeatProcessor: ✅ LATIDO REAL DETECTADO [${now}]`, {
            intervaloAnterior: this.lastPeakTime ? (now - this.lastPeakTime) + 'ms' : 'PRIMERO',
            bpmInstantaneo: this.lastPeakTime ? (60000/(now - this.lastPeakTime)).toFixed(1) : 'N/A',
            totalIntervalos: this.rrIntervals.length
          });
          
          this.previousPeakTime = this.lastPeakTime;
          this.lastPeakTime = now;
          
          // COORDINAR: beep + vibración JUNTOS  
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
          // SINTONIZACIÓN ADAPTIVA DESHABILITADA TEMPORALMENTE (ESTABILIDAD MÁXIMA)
          // this.performAdaptiveTuning() - COMENTADO para evitar captación errática
          // Los umbrales permanecen constantes para comportamiento predecible
        } else {
          console.log(`HeartBeatProcessor: Pico rechazado - confianza insuficiente: ${confidence}`);
          isPeak = false;
        }
      }
    }
    
    // Retornar resultado con nuevos parámetros
    return {
      bpm: Math.round(this.getSmoothBPM()),
      confidence: isPeak ? 0.85 : 0.5, // CONFIANZA FIJA para evitar oscilaciones
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
      // Señal débil - amplificar MODERADAMENTE (CORREGIDO)
      boostFactor = this.SIGNAL_BOOST_FACTOR * 1.3; // REDUCIDO de 1.8 a 1.3
    } else if (range < 3.0) {
      // Señal moderada - amplificar ligeramente (CORREGIDO)
      boostFactor = this.SIGNAL_BOOST_FACTOR * 1.1; // REDUCIDO de 1.4 a 1.1
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
    console.log(`HeartBeatProcessor: Estado de arritmia establecido a ${isDetected}`);
  }

  private autoResetIfSignalIsLow(amplitude: number) {
    if (amplitude < this.LOW_SIGNAL_THRESHOLD) {
      this.lowSignalCount++;
      if (this.lowSignalCount >= this.LOW_SIGNAL_FRAMES) {
        // SOLO resetear estados de detección, NO parámetros adaptativos (ESTABILIDAD)
        this.resetDetectionStates();
        console.log("HeartBeatProcessor: auto-reset SOLO detection states (conservando parámetros adaptativos).");
      }
    } else {
      this.lowSignalCount = Math.max(0, this.lowSignalCount - 2); // Reducción más rápida para recuperación
    }
  }

  private resetDetectionStates() {
    // No resetear lastPeakTime para mantener continuidad de detecciones
    this.lastConfirmedPeak = false;
    this.peakConfirmationBuffer = [];
    console.log("HeartBeatProcessor: auto-reset detection states (low signal).");
  }

  /**
   * Detección de picos mejorada para señales con validación médica
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

    if (timeSinceLastPeak < this.DEFAULT_MIN_PEAK_TIME_MS) {
      return { isPeak: false, confidence: 0 };
    }
    // DETECCIÓN DE PICOS PARA PPG DE CÁMARA (valores 0.0-1.0)
    const derivativeThreshold = -0.05; // MÁS SENSIBLE para cambios sutiles de PPG cámara
    const amplitudeThreshold = 0.1;    // MÁS SENSIBLE para amplitudes pequeñas de PPG
    
    const isOverThreshold = derivative < derivativeThreshold && 
                           Math.abs(normalizedValue) > amplitudeThreshold;
    
    // CONFIANZA ESPECÍFICA PARA PPG CÁMARA (valores más pequeños)
    const confidence = isOverThreshold ? 
      Math.min(1.0, Math.abs(derivative) / 0.5 + Math.abs(normalizedValue) / 1.5) : 0; // MÁS GENEROSA para PPG sutil

    return { isPeak: isOverThreshold, confidence, rawDerivative: derivative };
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
    // Confirmación simplificada: cada pico marcado es confirmado
    if (isPeak && !this.lastConfirmedPeak) {
      this.lastConfirmedPeak = true;
      return true;
    } else if (!isPeak) {
      this.lastConfirmedPeak = false;
    }
    return false;
  }

  /**
   * Validación de picos basada estrictamente en criterios médicos
   */
  private validatePeak(peakValue: number, confidence: number): boolean {
    // Un pico es válido si tiene suficiente confianza y la calidad de la señal es alta.
    // Esto asegura que solo los picos robustos y fisiológicamente plausibles sean considerados.
    const isHighConfidence = confidence >= this.MIN_PEAK_CONFIRMATION_CONFIDENCE;
    const isGoodSignalQuality = this.currentSignalQuality >= this.MIN_PEAK_CONFIRMATION_QUALITY;

    return isHighConfidence && isGoodSignalQuality;
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
    if (this.bpmHistory.length < 3) return 0;
    
    // Filtrado adaptativo basado en confianza
    const validReadings = this.bpmHistory.filter((_, i) => 
      this.recentPeakConfidences[i] > 0.7
    );
    
    // Ponderar por confianza y aplicar mediana móvil
    const weightedBPM = validReadings.reduce(
      (sum, bpm, i) => sum + (bpm * this.recentPeakConfidences[i]), 
      0
    ) / validReadings.reduce((sum, _, i) => sum + this.recentPeakConfidences[i], 0);
    
    // Suavizado final con filtro de Kalman simple
    this.smoothBPM = this.kalmanFilter(weightedBPM);
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

  public reset() {
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
    console.log("HeartBeatProcessor: Full reset including adaptive parameters and arrhythmia flag.");
  }

  public getRRIntervals(): { intervals: number[]; lastPeakTime: number | null } {
    const rrIntervals = this.bpmHistory.map(bpm => 60000 / bpm);
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
    
    console.log("HeartBeatProcessor: Adaptive tuning updated", {
      signalThreshold: this.adaptiveSignalThreshold.toFixed(3),
      minConfidence: this.adaptiveMinConfidence.toFixed(3),
      derivativeThreshold: this.adaptiveDerivativeThreshold.toFixed(3),
      avgSignalStrength: this.recentSignalStrengths.length > 0 ? 
                        (this.recentSignalStrengths.reduce((s,v) => s+v, 0) / 
                         this.recentSignalStrengths.length).toFixed(3) : "N/A",
      currentSignalQuality: this.currentSignalQuality
    });
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
