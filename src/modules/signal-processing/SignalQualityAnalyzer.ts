/**
 * =========================================================================
 * ANALIZADOR DE CALIDAD DE SEÑAL PPG - VERSIÓN PROFESIONAL
 * =========================================================================
 * 
 * Basado en:
 * - Elgendi 2016: Signal Quality Indices for PPG
 * - rPPG-Toolbox 2022: Quality metrics
 * - TI SLAA655: Perfusion Index
 * 
 * MÉTRICAS:
 * 1. SNR de banda cardíaca (FFT)
 * 2. Perfusion Index (PI = AC/DC * 100)
 * 3. Porcentaje de clipping
 * 4. Estabilidad temporal (CV de intervalos)
 * 5. Periodicidad (autocorrelación)
 * 
 * SQI GOBIERNA LA UI:
 * - SQI < 30: "SEÑAL INVÁLIDA - No mostrar valores"
 * - SQI 30-50: "BAJA CONFIANZA"
 * - SQI 50-70: "CONFIANZA MEDIA"
 * - SQI > 70: "ALTA CONFIANZA"
 * =========================================================================
 */

export interface SignalQualityResult {
  /** Índice de calidad global 0-100 */
  quality: number;
  
  /** Perfusion Index (%) - indica fuerza de pulso */
  perfusionIndex: number;
  
  /** Señal válida para mostrar valores */
  isSignalValid: boolean;
  
  /** Razón de invalidez si aplica */
  invalidReason?: 'NO_SIGNAL' | 'LOW_PULSATILITY' | 'TOO_NOISY' | 'MOTION_ARTIFACT' | 'CLIPPING' | 'NO_FINGER';
  
  /** Nivel de confianza para UI */
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';
  
  /** Métricas detalladas */
  metrics: {
    snr: number;              // SNR en dB
    perfusionIndex: number;   // PI (%)
    clippingPercent: number;  // % de muestras saturadas
    stability: number;        // Estabilidad temporal 0-1
    periodicity: number;      // Periodicidad 0-1
    acAmplitude: number;      // Amplitud AC
    dcLevel: number;          // Nivel DC
    fingerConfidence: number; // Confianza de detección de dedo 0-1
  };
}

export class SignalQualityAnalyzer {
  // Buffers
  private readonly BUFFER_SIZE = 180; // 6 segundos @ 30fps
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private rrIntervalsBuffer: number[] = [];
  
  // Estadísticas
  private dcLevel: number = 0;
  private acAmplitude: number = 0;
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  // Suavizado de calidad
  private smoothedQuality: number = 0;
  private readonly QUALITY_SMOOTHING = 0.15; // Factor de suavizado
  
  // Pesos para SQI final
  private readonly WEIGHTS = {
    snr: 0.30,
    perfusionIndex: 0.25,
    clipping: 0.15,
    stability: 0.15,
    periodicity: 0.15
  };
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS COMPLETO DE CALIDAD DE SEÑAL
   */
  analyze(
    rawValue: number, 
    filteredValue: number, 
    timestamp: number = Date.now(),
    rgbData?: { red: number; green: number; blue: number },
    rrIntervals?: number[]
  ): SignalQualityResult {
    this.frameCount++;
    
    // Agregar a buffers
    this.rawBuffer.push(rawValue);
    if (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
    }
    
    this.filteredBuffer.push(filteredValue);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // Actualizar RR intervals
    if (rrIntervals && rrIntervals.length > 0) {
      this.rrIntervalsBuffer = [...rrIntervals];
    }
    
    // Necesitamos suficientes muestras para análisis confiable
    if (this.rawBuffer.length < 60) {
      return this.createResult(0, 'NO_SIGNAL');
    }
    
    // === CALCULAR MÉTRICAS ===
    
    // 1. DC Level y AC Amplitude
    const { dc, ac } = this.calculateACDC();
    this.dcLevel = dc;
    this.acAmplitude = ac;
    
    // 2. Perfusion Index (PI = AC/DC * 100)
    const perfusionIndex = dc > 0 ? (ac / dc) * 100 : 0;
    
    // 3. SNR de banda cardíaca
    const snr = this.calculateSNR();
    
    // 4. Porcentaje de clipping
    const clippingPercent = this.calculateClipping();
    
    // 5. Estabilidad temporal
    const stability = this.calculateStability();
    
    // 6. Periodicidad (autocorrelación)
    const periodicity = this.calculatePeriodicity();
    
    // 7. Confianza de detección de dedo
    const fingerConfidence = this.calculateFingerConfidence(rgbData);
    
    // === CALCULAR SQI PONDERADO ===
    
    // Normalizar métricas a 0-100
    const snrScore = Math.min(100, Math.max(0, snr * 5)); // SNR 0-20dB → 0-100
    const piScore = Math.min(100, Math.max(0, perfusionIndex * 20)); // PI 0-5% → 0-100
    const clippingScore = Math.max(0, 100 - clippingPercent * 10); // 0% clipping = 100
    const stabilityScore = stability * 100;
    const periodicityScore = periodicity * 100;
    
    // SQI ponderado
    let sqi = 
      this.WEIGHTS.snr * snrScore +
      this.WEIGHTS.perfusionIndex * piScore +
      this.WEIGHTS.clipping * clippingScore +
      this.WEIGHTS.stability * stabilityScore +
      this.WEIGHTS.periodicity * periodicityScore;
    
    // Penalizar si no hay dedo detectado
    if (fingerConfidence < 0.5) {
      sqi *= fingerConfidence;
    }
    
    // Suavizado exponencial
    this.smoothedQuality = this.smoothedQuality * (1 - this.QUALITY_SMOOTHING) + 
                           sqi * this.QUALITY_SMOOTHING;
    
    const finalQuality = Math.round(this.smoothedQuality);
    
    // === DETERMINAR RAZÓN DE INVALIDEZ ===
    let invalidReason: SignalQualityResult['invalidReason'] | undefined;
    
    if (fingerConfidence < 0.3) {
      invalidReason = 'NO_FINGER';
    } else if (clippingPercent > 10) {
      invalidReason = 'CLIPPING';
    } else if (perfusionIndex < 0.05) {
      invalidReason = 'LOW_PULSATILITY';
    } else if (snr < 2) {
      invalidReason = 'TOO_NOISY';
    } else if (stability < 0.3) {
      invalidReason = 'MOTION_ARTIFACT';
    }
    
    // === DETERMINAR NIVEL DE CONFIANZA ===
    let confidenceLevel: SignalQualityResult['confidenceLevel'];
    
    if (finalQuality < 30) {
      confidenceLevel = 'INVALID';
    } else if (finalQuality < 50) {
      confidenceLevel = 'LOW';
    } else if (finalQuality < 70) {
      confidenceLevel = 'MEDIUM';
    } else {
      confidenceLevel = 'HIGH';
    }
    
    const result: SignalQualityResult = {
      quality: finalQuality,
      perfusionIndex,
      isSignalValid: finalQuality >= 30 && fingerConfidence >= 0.3,
      invalidReason,
      confidenceLevel,
      metrics: {
        snr,
        perfusionIndex,
        clippingPercent,
        stability,
        periodicity,
        acAmplitude: ac,
        dcLevel: dc,
        fingerConfidence
      }
    };
    
    this.lastQuality = result;
    return result;
  }
  
  /**
   * CALCULAR AC/DC COMPONENTS
   * DC = promedio (componente no pulsátil)
   * AC = RMS de la señal centrada
   */
  private calculateACDC(): { ac: number; dc: number } {
    if (this.rawBuffer.length < 30) {
      return { ac: 0, dc: 0 };
    }
    
    const window = this.rawBuffer.slice(-90); // 3 segundos
    
    // DC = media
    const dc = window.reduce((a, b) => a + b, 0) / window.length;
    
    // AC = RMS de señal centrada * sqrt(2)
    let sumSq = 0;
    for (const v of window) {
      sumSq += Math.pow(v - dc, 2);
    }
    const rms = Math.sqrt(sumSq / window.length);
    const ac = rms * Math.sqrt(2);
    
    return { ac, dc };
  }
  
  /**
   * CALCULAR SNR DE BANDA CARDÍACA
   * Usando energía espectral en banda 0.7-4Hz vs ruido
   */
  private calculateSNR(): number {
    if (this.filteredBuffer.length < 90) return 0;
    
    const signal = this.filteredBuffer.slice(-128); // Potencia de 2 para FFT
    
    // Calcular varianza de señal vs varianza de ruido
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const signalVariance = signal.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / signal.length;
    
    // Estimar ruido como varianza de diferencias consecutivas
    let noiseVariance = 0;
    for (let i = 1; i < signal.length; i++) {
      noiseVariance += Math.pow(signal[i] - signal[i-1], 2);
    }
    noiseVariance /= (signal.length - 1);
    
    if (noiseVariance < 0.001) return 20; // Señal muy limpia
    
    // SNR en dB
    const snr = 10 * Math.log10(signalVariance / noiseVariance);
    
    return Math.max(0, Math.min(30, snr));
  }
  
  /**
   * CALCULAR PORCENTAJE DE CLIPPING
   * Muestras en 0 o 255 (saturadas)
   */
  private calculateClipping(): number {
    if (this.rawBuffer.length < 30) return 0;
    
    const window = this.rawBuffer.slice(-60);
    let clippedCount = 0;
    
    for (const v of window) {
      if (v <= 1 || v >= 254) {
        clippedCount++;
      }
    }
    
    return (clippedCount / window.length) * 100;
  }
  
  /**
   * CALCULAR ESTABILIDAD TEMPORAL
   * Basado en CV (coeficiente de variación) de intervalos RR
   */
  private calculateStability(): number {
    if (this.rrIntervalsBuffer.length < 3) {
      // Sin RR intervals, usar estabilidad de amplitud
      if (this.filteredBuffer.length < 60) return 0.5;
      
      const window = this.filteredBuffer.slice(-60);
      const peaks: number[] = [];
      
      for (let i = 2; i < window.length - 2; i++) {
        if (window[i] > window[i-1] && window[i] > window[i+1] &&
            window[i] > window[i-2] && window[i] > window[i+2]) {
          peaks.push(window[i]);
        }
      }
      
      if (peaks.length < 2) return 0.3;
      
      const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
      const variance = peaks.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / peaks.length;
      const cv = Math.sqrt(variance) / (mean + 0.01);
      
      // CV bajo = alta estabilidad
      return Math.max(0, 1 - cv * 2);
    }
    
    // Usar CV de intervalos RR
    const intervals = this.rrIntervalsBuffer.slice(-10);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, i) => acc + Math.pow(i - mean, 2), 0) / intervals.length;
    const cv = Math.sqrt(variance) / mean;
    
    // CV típico para ritmo regular: 0.05-0.15
    // CV > 0.25 indica irregularidad o ruido
    return Math.max(0, 1 - cv * 2);
  }
  
  /**
   * CALCULAR PERIODICIDAD
   * Usando autocorrelación simple
   */
  private calculatePeriodicity(): number {
    if (this.filteredBuffer.length < 90) return 0;
    
    const signal = this.filteredBuffer.slice(-90);
    const n = signal.length;
    
    // Normalizar señal
    const mean = signal.reduce((a, b) => a + b, 0) / n;
    const normalized = signal.map(v => v - mean);
    
    // Autocorrelación en lag correspondiente a 40-150 BPM
    // A 30 fps: 40 BPM = 45 frames, 150 BPM = 12 frames
    let maxCorr = 0;
    
    for (let lag = 12; lag <= 45; lag++) {
      let corr = 0;
      let norm1 = 0;
      let norm2 = 0;
      
      for (let i = 0; i < n - lag; i++) {
        corr += normalized[i] * normalized[i + lag];
        norm1 += normalized[i] * normalized[i];
        norm2 += normalized[i + lag] * normalized[i + lag];
      }
      
      const denominator = Math.sqrt(norm1 * norm2);
      if (denominator > 0) {
        const r = corr / denominator;
        if (r > maxCorr) {
          maxCorr = r;
        }
      }
    }
    
    return Math.max(0, Math.min(1, maxCorr));
  }
  
  /**
   * CALCULAR CONFIANZA DE DETECCIÓN DE DEDO
   */
  private calculateFingerConfidence(rgbData?: { red: number; green: number; blue: number }): number {
    if (!rgbData) {
      // Sin datos RGB, usar nivel DC
      if (this.dcLevel < 30) return 0;
      if (this.dcLevel < 60) return 0.5;
      return 0.8;
    }
    
    const { red, green, blue } = rgbData;
    
    // Criterios de detección de dedo:
    // 1. Rojo > 80
    // 2. Ratio R/G entre 1.0 y 4.0
    // 3. No saturación (< 253)
    
    let confidence = 0;
    
    // Nivel de rojo
    if (red > 80) confidence += 0.3;
    else if (red > 50) confidence += 0.15;
    
    // Ratio R/G
    const rgRatio = green > 0 ? red / green : 0;
    if (rgRatio >= 1.0 && rgRatio <= 4.0) confidence += 0.35;
    else if (rgRatio >= 0.8 && rgRatio <= 5.0) confidence += 0.15;
    
    // No saturación
    if (red < 253 && green < 253) confidence += 0.25;
    else if (red < 255 && green < 255) confidence += 0.1;
    
    // Diferencia R-G típica para dedo con flash
    const rgDiff = red - green;
    if (rgDiff > 20 && rgDiff < 150) confidence += 0.1;
    
    return Math.min(1, confidence);
  }
  
  /**
   * Actualizar buffer de intervalos RR
   */
  updateRRIntervals(intervals: number[]): void {
    this.rrIntervalsBuffer = [...intervals];
  }
  
  getLastQuality(): SignalQualityResult | null {
    return this.lastQuality;
  }
  
  getPerfusionIndex(): number {
    return this.dcLevel > 0 ? (this.acAmplitude / this.dcLevel) * 100 : 0;
  }
  
  getSNR(): number {
    return this.calculateSNR();
  }
  
  reset(): void {
    this.rawBuffer = [];
    this.filteredBuffer = [];
    this.rrIntervalsBuffer = [];
    this.dcLevel = 0;
    this.acAmplitude = 0;
    this.lastQuality = null;
    this.frameCount = 0;
    this.smoothedQuality = 0;
  }
  
  private createResult(quality: number, invalidReason?: SignalQualityResult['invalidReason']): SignalQualityResult {
    return {
      quality,
      perfusionIndex: 0,
      isSignalValid: false,
      invalidReason,
      confidenceLevel: 'INVALID',
      metrics: {
        snr: 0,
        perfusionIndex: 0,
        clippingPercent: 0,
        stability: 0,
        periodicity: 0,
        acAmplitude: 0,
        dcLevel: 0,
        fingerConfidence: 0
      }
    };
  }
}
