/**
 * ANALIZADOR DE CALIDAD DE SEÑAL PPG - VERSIÓN UNIFICADA
 * 
 * Basado en:
 * - Perfusion Index (PI) = AC/DC * 100
 * - Pulsatility Assessment 
 * - Spectral Quality (periodicidad)
 * - Motion Artifact Detection
 * 
 * Referencias:
 * - Elgendi M. (2012) "On the Analysis of Fingertip PPG Signals"
 * - vital-sqi library (GitHub bahp/vital-sqi)
 */

export interface SignalQualityResult {
  /** Índice de calidad global 0-100 */
  quality: number;
  
  /** Perfusion Index (%) - indica fuerza de pulso */
  perfusionIndex: number;
  
  /** Si hay suficiente señal para medir */
  isSignalValid: boolean;
  
  /** Razón de invalidez si aplica */
  invalidReason?: 'NO_SIGNAL' | 'LOW_PULSATILITY' | 'TOO_NOISY' | 'MOTION_ARTIFACT' | 'NO_FINGER';
  
  /** Métricas detalladas */
  metrics: {
    acAmplitude: number;
    dcLevel: number;
    snr: number;
    periodicity: number;
    stability: number;
    fingerConfidence: number;  // NUEVO: confianza de que es un dedo (0-1)
  };
}

export class SignalQualityAnalyzer {
  // Umbrales RELAJADOS para mejor tolerancia
  private readonly THRESHOLDS = {
    // Perfusion Index típico: 0.02% - 20%
    MIN_PERFUSION_INDEX: 0.05,   // Reducido: 0.05% mínimo (era 0.1%)
    GOOD_PERFUSION_INDEX: 0.3,   // Reducido: 0.3% buena señal (era 0.5%)
    
    // Pulsatilidad AC/DC - MÁS TOLERANTE
    MIN_PULSATILITY: 0.0005,    // Reducido: 0.05% (era 0.1%)
    MAX_PULSATILITY: 0.25,      // Aumentado: 25% (era 15%) - más tolerancia a movimiento
    OPTIMAL_PULSATILITY: 0.015, // Reducido (era 2%)
    
    // SNR (Signal-to-Noise Ratio) - MÁS PERMISIVO
    MIN_SNR_DB: 1,              // Reducido de 3 a 1 dB
    GOOD_SNR_DB: 6,             // Reducido de 10 a 6 dB
    
    // Estabilidad (varianza normalizada)
    MAX_BASELINE_DRIFT: 4.0,    // Aumentado: más tolerancia a drift (era 2.0)
    
    // Periodicidad (autocorrelación) - MENOS EXIGENTE
    MIN_PERIODICITY: 0.1,       // Reducido de 0.2 a 0.1
    GOOD_PERIODICITY: 0.3,      // Reducido de 0.5 a 0.3
  };
  
  // Buffers para análisis - OPTIMIZADOS para menos memoria
  private readonly BUFFER_SIZE = 30; // ~1 segundo a 30fps (suficiente para análisis)
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private dcBuffer: number[] = [];
  // ELIMINADO: timestampBuffer - no se usaba realmente
  
  // Buffers para detección de dedo - REDUCIDOS
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  // ELIMINADO: periodicityHistory - el valor actual es suficiente
  
  // Estado
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS PRINCIPAL - Procesa cada frame
   * MODIFICADO: Respuesta INSTANTÁNEA cuando cambian condiciones RGB
   */
  analyze(
    rawValue: number, 
    filteredValue: number, 
    timestamp: number = Date.now(),
    rgbData?: { red: number; green: number; blue: number }
  ): SignalQualityResult {
    this.frameCount++;
    
    // *** DETECCIÓN INSTANTÁNEA DE PÉRDIDA DE DEDO ***
    // Si los valores RGB indican claramente que NO hay dedo, resetear buffers
    if (rgbData) {
      const { red, green, blue } = rgbData;
      const rgRatio = green > 1 ? red / green : 1;
      
      // Condiciones de NO-DEDO (luz ambiente, sin dedo, etc.)
      const noFinger = 
        (green > 100 && rgRatio < 3) ||  // Verde alto + ratio bajo = no hay dedo
        (red < 50 && green < 50) ||       // Muy oscuro = sin cámara/luz
        (red > 250 && green > 200 && blue > 200); // Saturación = luz directa
      
      if (noFinger) {
        // RESET INMEDIATO - no esperar a que el buffer se llene
        this.rawBuffer = [];
        this.filteredBuffer = [];
        this.dcBuffer = [];
        this.redBuffer = [];
        this.greenBuffer = [];
        
        return this.createResult(0, 0, false, 'NO_FINGER', {
          acAmplitude: 0, dcLevel: 0, snr: 0, periodicity: 0, stability: 0, fingerConfidence: 0
        });
      }
    }
    
    // Agregar a buffers con límite de tamaño eficiente
    this.rawBuffer.push(rawValue);
    this.filteredBuffer.push(filteredValue);
    
    // Mantener tamaño de buffer
    while (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
      this.filteredBuffer.shift();
    }
    
    // Guardar datos RGB para detección de dedo (buffer pequeño)
    if (rgbData) {
      this.redBuffer.push(rgbData.red);
      this.greenBuffer.push(rgbData.green);
      while (this.redBuffer.length > 20) this.redBuffer.shift();
      while (this.greenBuffer.length > 20) this.greenBuffer.shift();
    }
    
    // Calcular DC (línea base) con media móvil
    const dcLevel = this.calculateDC();
    this.dcBuffer.push(dcLevel);
    if (this.dcBuffer.length > 30) this.dcBuffer.shift();
    
    // Verificar si hay suficientes datos - pero con valor bajo inicial
    if (this.rawBuffer.length < 15) {
      return this.createResult(10, 0, false, undefined, {
        acAmplitude: 0, dcLevel, snr: 0, periodicity: 0, stability: 1, fingerConfidence: 0.2
      });
    }
    
    // === MÉTRICAS DE CALIDAD ===
    const acAmplitude = this.calculateAC();
    const perfusionIndex = dcLevel > 0 ? (acAmplitude / dcLevel) * 100 : 0;
    const snr = this.calculateSNR();
    const periodicity = this.calculatePeriodicity();
    const stability = this.calculateStability();
    
    // *** NUEVA DETECCIÓN DE DEDO - FÍSICA REAL ***
    const fingerConfidence = this.calculateFingerConfidenceReal(rgbData, periodicity, acAmplitude, dcLevel);
    
    // === VALIDACIÓN DE SEÑAL - ESTRICTA PARA DEDO ===
    let isValid = true;
    let invalidReason: SignalQualityResult['invalidReason'];
    
    const pulsatility = acAmplitude / Math.max(dcLevel, 1);
    
    // CRÍTICO: Sin características físicas de dedo = INVÁLIDO
    if (fingerConfidence < 0.30 && this.rawBuffer.length > 30) {
      isValid = false;
      invalidReason = 'NO_FINGER';
    } else if (pulsatility < this.THRESHOLDS.MIN_PULSATILITY && perfusionIndex < 0.02) {
      isValid = false;
      invalidReason = 'LOW_PULSATILITY';
    } else if (pulsatility > this.THRESHOLDS.MAX_PULSATILITY && stability < 0.2) {
      isValid = false;
      invalidReason = 'MOTION_ARTIFACT';
    }
    
    // === CÁLCULO DE CALIDAD GLOBAL ===
    const quality = this.calculateGlobalQuality({
      perfusionIndex,
      pulsatility,
      snr,
      periodicity,
      stability,
      fingerConfidence
    });
    
    const result = this.createResult(quality, perfusionIndex, isValid, invalidReason, {
      acAmplitude,
      dcLevel,
      snr,
      periodicity,
      stability,
      fingerConfidence
    });
    
    this.lastQuality = result;
    
    // Log solo cada 5 segundos para reducir overhead (era 3s)
    if (this.frameCount % 150 === 0) {
      console.log(`📊 SQI: q=${quality}%, finger=${(fingerConfidence*100).toFixed(0)}%, valid=${isValid}`);
    }
    
    return result;
  }
  
  /**
   * Calcula componente DC (línea base)
   */
  private calculateDC(): number {
    if (this.rawBuffer.length === 0) return 0;
    return this.rawBuffer.reduce((a, b) => a + b, 0) / this.rawBuffer.length;
  }
  
  /**
   * Calcula componente AC (amplitud pulsátil)
   * Usa la señal filtrada para mejor precisión
   */
  private calculateAC(): number {
    if (this.filteredBuffer.length < 30) return 0;
    
    const recent = this.filteredBuffer.slice(-30);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    
    // AC = pico-a-pico / 2
    return (max - min) / 2;
  }
  
  /**
   * Calcula SNR (Signal-to-Noise Ratio) en dB
   * SNR = 10 * log10(Potencia_señal / Potencia_ruido)
   */
  private calculateSNR(): number {
    if (this.filteredBuffer.length < 60) return 0;
    
    const recent = this.filteredBuffer.slice(-60);
    
    // Señal: varianza de la señal suavizada
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const signalPower = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    
    // Ruido: diferencias entre muestras consecutivas (alta frecuencia)
    let noisePower = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i] - recent[i-1];
      noisePower += diff * diff;
    }
    noisePower /= (recent.length - 1);
    
    // Evitar división por cero
    if (noisePower < 0.0001) return 20; // Excelente SNR
    if (signalPower < 0.0001) return 0;
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    return Math.max(0, Math.min(30, snr)); // Clamp 0-30 dB
  }
  
  /**
   * Calcula periodicidad usando autocorrelación
   * Busca patrón repetitivo en rango de pulso cardíaco (40-180 BPM)
   */
  private calculatePeriodicity(): number {
    if (this.filteredBuffer.length < 45) return 0; // Reducido de 90
    
    const signal = this.filteredBuffer.slice(-45); // Suficiente para 2 latidos
    const n = signal.length;
    
    // Normalizar señal
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(signal.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n);
    if (std < 0.001) return 0;
    
    const normalized = signal.map(v => (v - mean) / std);
    
    // Autocorrelación en rango de latido (10-50 muestras ≈ 40-180 BPM a 30fps)
    let maxCorr = 0;
    
    for (let lag = 10; lag <= 50; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += normalized[i] * normalized[i + lag];
      }
      corr /= (n - lag);
      maxCorr = Math.max(maxCorr, corr);
    }
    
    return Math.max(0, Math.min(1, maxCorr));
  }
  
  /**
   * Calcula estabilidad de línea base
   * Detecta drift y movimiento brusco
   */
  private calculateStability(): number {
    if (this.dcBuffer.length < 10) return 1;
    
    const recent = this.dcBuffer.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Varianza normalizada
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / Math.max(Math.abs(mean), 1);
    
    // Convertir a estabilidad (0-1, mayor es mejor)
    const stability = Math.max(0, 1 - cv / this.THRESHOLDS.MAX_BASELINE_DRIFT);
    
    return stability;
  }
  
  /**
   * DETECCIÓN DE DEDO REAL - BASADA EN FÍSICA
   * 
   * Características de un DEDO REAL sobre la cámara con flash:
   * 1. Canal ROJO muy alto (>200) - sangre absorbe verde/azul
   * 2. Ratio R/G muy alto (>5) - característica física del dedo con flash
   * 3. Saturación del rojo - el dedo con flash satura el sensor rojo
   * 4. Variación PERIÓDICA del rojo (pulso) - no constante como pared
   * 
   * Una PARED o superficie NO tiene:
   * - Ratio R/G tan alto (generalmente <3)
   * - Saturación específica del rojo
   * - Variación periódica real del color
   */
  private calculateFingerConfidenceReal(
    rgbData: { red: number; green: number; blue: number } | undefined,
    periodicity: number,
    acAmplitude: number,
    dcLevel: number
  ): number {
    // Sin RGB no podemos detectar dedo físicamente
    if (!rgbData || this.redBuffer.length < 10) {
      return 0.2; // Valor bajo por defecto - NO asumir que hay dedo
    }
    
    let confidence = 0;
    const { red, green, blue } = rgbData;
    
    // === 1. RATIO R/G (40% del peso) - AJUSTADO PARA HARDWARE REAL ===
    // Tu cámara produce R/G de 3-5 con dedo (no 15+)
    const rgRatio = green > 0.1 ? red / green : (green === 0 && red > 200 ? 50 : 1);
    
    if (rgRatio >= 4) {
      confidence += 0.40; // Ratio alto = probablemente dedo
    } else if (rgRatio >= 2.5) {
      confidence += 0.35; // Tu cámara produce 3-5
    } else if (rgRatio >= 1.5) {
      confidence += 0.25; // Zona aceptable
    } else if (rgRatio >= 1.2) {
      confidence += 0.15; // Zona marginal
    }
    // rgRatio < 1.2 = 0 puntos (probablemente NO es dedo)
    
    // === 2. VERDE BAJO EN VALOR ABSOLUTO (25% del peso) - MÁS TOLERANTE ===
    // Tu cámara puede dar verde hasta 50 con dedo
    if (green <= 50) {
      confidence += 0.25; // Verde bajo = dedo absorbiéndolo
    } else if (green <= 80) {
      confidence += 0.18;
    } else if (green <= 120) {
      confidence += 0.08;
    }
    // green > 120 = 0 puntos (superficie reflectante, no dedo)
    
    // === 3. PULSATILIDAD REAL Y PERIÓDICA (35% del peso) - MÁS PERMISIVO ===
    // Señales débiles también cuentan
    const pulsatility = dcLevel > 0 ? acAmplitude / dcLevel : 0;
    
    // Combinación de pulsatilidad Y periodicidad - UMBRALES MUY REDUCIDOS
    const hasPulse = pulsatility >= 0.0003 && periodicity >= 0.02;
    const hasWeakPulse = pulsatility >= 0.0001 && periodicity >= 0.01;
    
    if (hasPulse) {
      confidence += 0.35; // Pulso real con ritmo = sangre fluyendo
    } else if (hasWeakPulse) {
      confidence += 0.18; // Pulso débil pero presente
    }
    // Sin pulso periódico = 0 puntos (no hay sangre)
    
    // === PENALIZACIÓN: Señales que NO son de dedo ===
    
    // Si verde es alto Y ratio R/G es bajo → definitivamente NO es dedo
    if (green > 100 && rgRatio < 3) {
      confidence *= 0.3; // Penalización severa
    }
    
    // Si todos los canales son similares (pared blanca) → NO es dedo
    const rgbSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (rgbSpread < 50 && red < 200) {
      confidence *= 0.2; // Superficie uniforme, no es dedo
    }
    
    // Si hay saturación en TODOS los canales → NO es dedo (luz directa)
    if (red > 250 && green > 250 && blue > 250) {
      confidence = 0.1; // Luz directa saturando sensor
    }
    
    // Log eliminado para reducir overhead
    // Solo el log principal en analyze() cada 5 segundos
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  /**
   * Calcula índice de calidad global (0-100)
   * MEJORADO: Valores graduales, sin saltos bruscos
   */
  private calculateGlobalQuality(metrics: {
    perfusionIndex: number;
    pulsatility: number;
    snr: number;
    periodicity: number;
    stability: number;
    fingerConfidence: number;
  }): number {
    const { perfusionIndex, pulsatility, snr, periodicity, stability, fingerConfidence } = metrics;
    
    // Base quality calculada de métricas reales (sin dependencia binaria de dedo)
    let quality = 0;
    
    // 1. Perfusion Index (25% del peso) - señal pulsátil real
    const piNorm = Math.min(1, perfusionIndex / this.THRESHOLDS.GOOD_PERFUSION_INDEX);
    quality += piNorm * 25;
    
    // 2. SNR (20% del peso) - claridad de señal
    const snrNorm = Math.min(1, Math.max(0, snr) / this.THRESHOLDS.GOOD_SNR_DB);
    quality += snrNorm * 20;
    
    // 3. Periodicidad (20% del peso) - ritmo cardíaco detectado
    const periodNorm = Math.min(1, periodicity / this.THRESHOLDS.GOOD_PERIODICITY);
    quality += periodNorm * 20;
    
    // 4. Estabilidad (15% del peso) - baja variabilidad de baseline
    quality += Math.min(1, stability) * 15;
    
    // 5. Confianza de dedo (20% del peso) - características físicas
    quality += fingerConfidence * 20;
    
    // Penalización suave por movimiento (no binaria)
    if (pulsatility > this.THRESHOLDS.OPTIMAL_PULSATILITY * 2) {
      const movementPenalty = Math.min(0.3, (pulsatility / this.THRESHOLDS.MAX_PULSATILITY) * 0.3);
      quality *= (1 - movementPenalty);
    }
    
    // Asegurar rango 0-100 con redondeo
    return Math.round(Math.max(0, Math.min(100, quality)));
  }
  
  private createResult(
    quality: number,
    perfusionIndex: number,
    isSignalValid: boolean,
    invalidReason: SignalQualityResult['invalidReason'],
    metrics: SignalQualityResult['metrics']
  ): SignalQualityResult {
    return {
      quality,
      perfusionIndex,
      isSignalValid,
      invalidReason,
      metrics
    };
  }
  
  /**
   * Obtiene el último resultado de calidad
   */
  getLastQuality(): SignalQualityResult | null {
    return this.lastQuality;
  }
  
  /**
   * Reinicia el analizador
   */
  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.dcBuffer = [];
    this.redBuffer = [];
    this.greenBuffer = [];
    this.lastQuality = null;
    this.frameCount = 0;
  }
}
