/**
 * ANALIZADOR DE CALIDAD DE SEÑAL PPG - VERSIÓN CORREGIDA
 * 
 * CORRECCIONES CRÍTICAS:
 * 1. Eliminados todos los NaN potenciales con guards
 * 2. Detección de dedo más realista
 * 3. Calidad refleja capacidad real de detectar latidos
 * 
 * Referencias:
 * - Elgendi M. (2012) "On the Analysis of Fingertip PPG Signals"
 * - prouast/heartbeat (GitHub 606 stars)
 */

export interface SignalQualityResult {
  quality: number;
  perfusionIndex: number;
  isSignalValid: boolean;
  invalidReason?: 'NO_SIGNAL' | 'LOW_PULSATILITY' | 'TOO_NOISY' | 'MOTION_ARTIFACT' | 'NO_FINGER';
  metrics: {
    acAmplitude: number;
    dcLevel: number;
    snr: number;
    periodicity: number;
    stability: number;
    fingerConfidence: number;
  };
}

export class SignalQualityAnalyzer {
  private readonly THRESHOLDS = {
    MIN_PERFUSION_INDEX: 0.03,
    GOOD_PERFUSION_INDEX: 0.2,
    MIN_PULSATILITY: 0.0003,
    MAX_PULSATILITY: 0.20,
    OPTIMAL_PULSATILITY: 0.01,
    MIN_SNR_DB: 2,
    GOOD_SNR_DB: 8,
    MAX_BASELINE_DRIFT: 3.0,
    MIN_PERIODICITY: 0.08,
    GOOD_PERIODICITY: 0.25,
  };
  
  private readonly BUFFER_SIZE = 90;
  private rawBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private dcBuffer: number[] = [];
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  
  private lastQuality: SignalQualityResult | null = null;
  private frameCount = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * ANÁLISIS PRINCIPAL - Con protección contra NaN
   */
  analyze(
    rawValue: number, 
    filteredValue: number, 
    timestamp: number = Date.now(),
    rgbData?: { red: number; green: number; blue: number }
  ): SignalQualityResult {
    this.frameCount++;
    
    // Protección contra valores inválidos
    if (!isFinite(rawValue)) rawValue = 0;
    if (!isFinite(filteredValue)) filteredValue = 0;
    
    // === DETECCIÓN RÁPIDA DE NO-DEDO ===
    if (rgbData) {
      const { red, green, blue } = rgbData;
      const rgRatio = green > 1 ? red / green : 1;
      
      const noFinger = 
        (green > 120 && rgRatio < 2.5) ||
        (red < 40 && green < 40) ||
        (red > 252 && green > 220 && blue > 220);
      
      if (noFinger) {
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
    
    // Agregar a buffers
    this.rawBuffer.push(rawValue);
    this.filteredBuffer.push(filteredValue);
    
    while (this.rawBuffer.length > this.BUFFER_SIZE) {
      this.rawBuffer.shift();
      this.filteredBuffer.shift();
    }
    
    if (rgbData) {
      this.redBuffer.push(rgbData.red);
      this.greenBuffer.push(rgbData.green);
      while (this.redBuffer.length > 30) this.redBuffer.shift();
      while (this.greenBuffer.length > 30) this.greenBuffer.shift();
    }
    
    const dcLevel = this.calculateDC();
    this.dcBuffer.push(dcLevel);
    if (this.dcBuffer.length > 30) this.dcBuffer.shift();
    
    // Esperar datos mínimos
    if (this.rawBuffer.length < 20) {
      return this.createResult(5, 0, false, undefined, {
        acAmplitude: 0, dcLevel, snr: 0, periodicity: 0, stability: 1, fingerConfidence: 0.15
      });
    }
    
    // === MÉTRICAS DE CALIDAD ===
    const acAmplitude = this.calculateAC();
    const perfusionIndex = dcLevel > 0.1 ? (acAmplitude / dcLevel) * 100 : 0;
    const snr = this.calculateSNR();
    const periodicity = this.calculatePeriodicity();
    const stability = this.calculateStability();
    const fingerConfidence = this.calculateFingerConfidence(rgbData, periodicity, acAmplitude, dcLevel);
    
    // === VALIDACIÓN ===
    let isValid = true;
    let invalidReason: SignalQualityResult['invalidReason'];
    
    const pulsatility = dcLevel > 0.1 ? acAmplitude / dcLevel : 0;
    
    if (fingerConfidence < 0.25 && this.rawBuffer.length > 40) {
      isValid = false;
      invalidReason = 'NO_FINGER';
    } else if (pulsatility < this.THRESHOLDS.MIN_PULSATILITY && perfusionIndex < 0.015) {
      isValid = false;
      invalidReason = 'LOW_PULSATILITY';
    } else if (pulsatility > this.THRESHOLDS.MAX_PULSATILITY && stability < 0.25) {
      isValid = false;
      invalidReason = 'MOTION_ARTIFACT';
    }
    
    // === CALIDAD GLOBAL ===
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
    
    if (this.frameCount % 150 === 0) {
      console.log(`📊 SQI: q=${quality}%, finger=${(fingerConfidence*100).toFixed(0)}%, valid=${isValid}`);
    }
    
    return result;
  }
  
  private calculateDC(): number {
    if (this.rawBuffer.length === 0) return 0;
    const sum = this.rawBuffer.reduce((a, b) => a + b, 0);
    return sum / this.rawBuffer.length;
  }
  
  private calculateAC(): number {
    if (this.filteredBuffer.length < 25) return 0;
    
    const recent = this.filteredBuffer.slice(-30);
    let max = -Infinity;
    let min = Infinity;
    
    for (const val of recent) {
      if (val > max) max = val;
      if (val < min) min = val;
    }
    
    if (!isFinite(max) || !isFinite(min)) return 0;
    return Math.max(0, (max - min) / 2);
  }
  
  private calculateSNR(): number {
    if (this.filteredBuffer.length < 45) return 0;
    
    const recent = this.filteredBuffer.slice(-45);
    const n = recent.length;
    
    let sum = 0;
    for (const v of recent) sum += v;
    const mean = sum / n;
    
    let signalPower = 0;
    for (const v of recent) {
      signalPower += (v - mean) * (v - mean);
    }
    signalPower /= n;
    
    let noisePower = 0;
    for (let i = 1; i < n; i++) {
      const diff = recent[i] - recent[i-1];
      noisePower += diff * diff;
    }
    noisePower /= (n - 1);
    
    if (noisePower < 0.0001) return 15;
    if (signalPower < 0.0001) return 0;
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    
    if (!isFinite(snr)) return 0;
    return Math.max(0, Math.min(25, snr));
  }
  
  private calculatePeriodicity(): number {
    if (this.filteredBuffer.length < 40) return 0;
    
    const signal = this.filteredBuffer.slice(-40);
    const n = signal.length;
    
    let sum = 0;
    for (const v of signal) sum += v;
    const mean = sum / n;
    
    let variance = 0;
    for (const v of signal) variance += (v - mean) * (v - mean);
    const std = Math.sqrt(variance / n);
    
    if (std < 0.001) return 0;
    
    const normalized = signal.map(v => (v - mean) / std);
    
    // Autocorrelación en rango de latido (8-45 muestras ≈ 40-225 BPM a 30fps)
    let maxCorr = 0;
    
    for (let lag = 8; lag <= 45 && lag < n - 5; lag++) {
      let corr = 0;
      let count = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += normalized[i] * normalized[i + lag];
        count++;
      }
      if (count > 0) {
        corr /= count;
        if (corr > maxCorr) maxCorr = corr;
      }
    }
    
    if (!isFinite(maxCorr)) return 0;
    return Math.max(0, Math.min(1, maxCorr));
  }
  
  private calculateStability(): number {
    if (this.dcBuffer.length < 8) return 1;
    
    const recent = this.dcBuffer.slice(-8);
    let sum = 0;
    for (const v of recent) sum += v;
    const mean = sum / recent.length;
    
    if (Math.abs(mean) < 0.1) return 1;
    
    let variance = 0;
    for (const v of recent) {
      variance += (v - mean) * (v - mean);
    }
    variance /= recent.length;
    
    const cv = Math.sqrt(variance) / Math.abs(mean);
    const stability = Math.max(0, 1 - cv / this.THRESHOLDS.MAX_BASELINE_DRIFT);
    
    return isFinite(stability) ? stability : 0;
  }
  
  /**
   * DETECCIÓN DE DEDO - SIMPLIFICADA Y ROBUSTA
   */
  private calculateFingerConfidence(
    rgbData: { red: number; green: number; blue: number } | undefined,
    periodicity: number,
    acAmplitude: number,
    dcLevel: number
  ): number {
    if (!rgbData || this.redBuffer.length < 5) {
      return 0.15;
    }
    
    let confidence = 0;
    const { red, green, blue } = rgbData;
    
    // 1. RATIO R/G (35% del peso)
    // Dedo con flash: R/G típicamente > 8-15
    const rgRatio = green > 0.5 ? red / green : (red > 200 ? 20 : 1);
    
    if (rgRatio >= 12) {
      confidence += 0.35;
    } else if (rgRatio >= 6) {
      confidence += 0.25;
    } else if (rgRatio >= 3) {
      confidence += 0.10;
    }
    
    // 2. ROJO ALTO Y VERDE BAJO (30% del peso)
    // Dedo: rojo > 200, verde < 50 típicamente
    if (red > 220 && green < 40) {
      confidence += 0.30;
    } else if (red > 180 && green < 80) {
      confidence += 0.20;
    } else if (red > 150 && green < 100) {
      confidence += 0.10;
    }
    
    // 3. PULSATILIDAD (35% del peso)
    // Si hay variación periódica real, es sangre
    const pulsatility = dcLevel > 0.1 ? acAmplitude / dcLevel : 0;
    
    if (pulsatility >= 0.003 && periodicity >= 0.12) {
      confidence += 0.35; // Pulso real
    } else if (pulsatility >= 0.001 && periodicity >= 0.06) {
      confidence += 0.18;
    }
    
    // Penalización si parece superficie (verde alto + ratio bajo)
    if (green > 100 && rgRatio < 2.5) {
      confidence *= 0.25;
    }
    
    // Penalización si colores uniformes (pared blanca)
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (spread < 40 && red < 180) {
      confidence *= 0.2;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  /**
   * CALIDAD GLOBAL - PROTEGIDA CONTRA NaN
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
    
    // Guard contra valores inválidos
    if (!isFinite(pulsatility) || !isFinite(fingerConfidence)) {
      return 0;
    }
    
    // Requisitos mínimos
    if (pulsatility < 0.0005) {
      return 0;
    }
    
    if (fingerConfidence < 0.15 && this.rawBuffer.length > 50) {
      return Math.round(Math.max(0, fingerConfidence * 25));
    }
    
    let quality = 0;
    
    // 1. PULSATILIDAD (35%)
    const pulsNorm = Math.min(1, pulsatility / 0.012);
    quality += (isFinite(pulsNorm) ? pulsNorm : 0) * 35;
    
    // 2. PERIODICIDAD (25%)
    const periodNorm = Math.min(1, periodicity / 0.30);
    quality += (isFinite(periodNorm) ? periodNorm : 0) * 25;
    
    // 3. PERFUSION INDEX (15%)
    const piNorm = Math.min(1, perfusionIndex / 0.35);
    quality += (isFinite(piNorm) ? piNorm : 0) * 15;
    
    // 4. SNR (15%)
    const snrNorm = Math.min(1, Math.max(0, snr) / 10);
    quality += (isFinite(snrNorm) ? snrNorm : 0) * 15;
    
    // 5. FINGER CONFIDENCE (10%)
    quality += (isFinite(fingerConfidence) ? fingerConfidence : 0) * 10;
    
    // Penalizaciones
    if (periodicity < 0.06 && this.rawBuffer.length > 60) {
      quality *= 0.5;
    }
    
    if (stability < 0.35) {
      quality *= (0.6 + stability);
    }
    
    const finalQuality = Math.round(Math.max(0, Math.min(100, quality)));
    return isFinite(finalQuality) ? finalQuality : 0;
  }
  
  private createResult(
    quality: number,
    perfusionIndex: number,
    isSignalValid: boolean,
    invalidReason: SignalQualityResult['invalidReason'],
    metrics: SignalQualityResult['metrics']
  ): SignalQualityResult {
    return {
      quality: isFinite(quality) ? quality : 0,
      perfusionIndex: isFinite(perfusionIndex) ? perfusionIndex : 0,
      isSignalValid,
      invalidReason,
      metrics
    };
  }
  
  getLastQuality(): SignalQualityResult | null {
    return this.lastQuality;
  }
  
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
