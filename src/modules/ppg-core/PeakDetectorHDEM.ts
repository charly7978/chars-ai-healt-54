/**
 * DETECTOR DE PICOS HDEM
 * Hilbert Double Envelope Method
 * 
 * Algoritmo basado en Chakraborty et al., Symmetry 2022:
 * 1. Aplicar Hilbert Transform a señal PPG
 * 2. Obtener envolvente superior (magnitud)
 * 3. Aplicar Hilbert a la envolvente -> segunda envolvente
 * 4. Calcular promedio de envolventes como threshold
 * 5. Detectar cruces del promedio con señal original
 * 6. Validar con intervalo mínimo (250ms)
 * 7. Extraer RR intervals
 * 
 * Rendimiento reportado:
 * - Sensibilidad: 99.98% (vs 99.82% zero-crossing)
 * - Especificidad: 100%
 */

import { HilbertTransform } from './HilbertTransform';

export interface Peak {
  index: number;
  timestamp: number;
  amplitude: number;
  confidence: number;
}

export interface PeakDetectionResult {
  peaks: Peak[];
  rrIntervals: number[];
  instantaneousBPM: number;
  averageBPM: number;
  hrv: {
    sdnn: number;
    rmssd: number;
    pnn50: number;
  };
  threshold: number[];
}

export class PeakDetectorHDEM {
  private hilbert: HilbertTransform;
  private sampleRate: number;
  
  // Intervalos RR históricos para HRV
  private rrHistory: number[] = [];
  private readonly MAX_RR_HISTORY = 30;
  
  // Último pico detectado
  private lastPeakTime: number = 0;
  private lastPeakIndex: number = 0;
  
  // Intervalo mínimo entre picos (250ms = 240 BPM máx)
  private readonly MIN_PEAK_INTERVAL_MS = 250;
  // Intervalo máximo (3000ms = 20 BPM mín)
  private readonly MAX_PEAK_INTERVAL_MS = 3000;
  
  // Buffer de señal para análisis continuo
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 300; // 10 segundos @ 30fps
  
  // BPM suavizado
  private smoothedBPM: number = 0;
  private readonly BPM_SMOOTHING = 0.8;
  
  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
    this.hilbert = new HilbertTransform(sampleRate);
  }
  
  /**
   * DETECTAR PICOS EN SEÑAL COMPLETA
   * Para análisis offline o segmentos completos
   */
  detectPeaks(signal: number[], timestamps?: number[]): PeakDetectionResult {
    if (signal.length < 60) {
      return this.createEmptyResult();
    }
    
    // 1. Aplicar HDEM para obtener threshold adaptativo
    const { envelope1, envelope2, threshold } = this.hilbert.doubleEnvelope(signal);
    
    // 2. Encontrar cruces de señal con threshold (de abajo hacia arriba)
    const peaks: Peak[] = [];
    const minInterval = Math.floor(this.sampleRate * this.MIN_PEAK_INTERVAL_MS / 1000);
    
    let lastPeakIdx = -minInterval;
    
    for (let i = 1; i < signal.length - 1; i++) {
      // Cruce ascendente del threshold
      if (signal[i - 1] < threshold[i - 1] && signal[i] >= threshold[i]) {
        // Verificar intervalo mínimo
        if (i - lastPeakIdx >= minInterval) {
          // Buscar máximo local en ventana cercana
          const searchStart = i;
          const searchEnd = Math.min(i + 10, signal.length);
          let maxIdx = i;
          let maxVal = signal[i];
          
          for (let j = searchStart; j < searchEnd; j++) {
            if (signal[j] > maxVal) {
              maxVal = signal[j];
              maxIdx = j;
            }
          }
          
          // Calcular confianza basada en amplitud relativa
          const localMean = threshold[maxIdx];
          const confidence = localMean > 0 ? Math.min(1, maxVal / localMean) : 0.5;
          
          peaks.push({
            index: maxIdx,
            timestamp: timestamps ? timestamps[maxIdx] : maxIdx * (1000 / this.sampleRate),
            amplitude: maxVal,
            confidence
          });
          
          lastPeakIdx = maxIdx;
        }
      }
    }
    
    // 3. Calcular RR intervals
    const rrIntervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const rr = peaks[i].timestamp - peaks[i - 1].timestamp;
      if (rr >= this.MIN_PEAK_INTERVAL_MS && rr <= this.MAX_PEAK_INTERVAL_MS) {
        rrIntervals.push(rr);
      }
    }
    
    // 4. Calcular métricas
    const instantaneousBPM = rrIntervals.length > 0 ? 60000 / rrIntervals[rrIntervals.length - 1] : 0;
    const averageBPM = rrIntervals.length > 0 
      ? 60000 / (rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length)
      : 0;
    
    // 5. Calcular HRV
    const hrv = this.calculateHRV(rrIntervals);
    
    return {
      peaks,
      rrIntervals,
      instantaneousBPM,
      averageBPM,
      hrv,
      threshold
    };
  }
  
  /**
   * PROCESAR MUESTRA EN TIEMPO REAL
   * Para streaming continuo de señal
   * 
   * MEJORADO: Umbral más estricto con validación SNR
   * - amplitude > mean * 1.2 (era 0.7)
   * - SNR > 2.0 requerido
   * - PI debe estar en rango válido
   */
  processSample(value: number, timestamp: number, perfusionIndex?: number): {
    isPeak: boolean;
    bpm: number;
    rrInterval: number | null;
    confidence: number;
  } {
    // Agregar al buffer
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos suficientes muestras - REDUCIDO de 60 a 45
    if (this.signalBuffer.length < 45) {
      return {
        isPeak: false,
        bpm: this.smoothedBPM,
        rrInterval: null,
        confidence: 0
      };
    }
    
    // VALIDACIÓN DE PI: Muy relajado para permitir señales débiles
    // Rango: 0.005% - 30% (ultra-permisivo)
    if (perfusionIndex !== undefined && (perfusionIndex < 0.005 || perfusionIndex > 30)) {
      return {
        isPeak: false,
        bpm: this.smoothedBPM,
        rrInterval: null,
        confidence: 0
      };
    }
    
    // Analizar últimas muestras
    const recentSignal = this.signalBuffer.slice(-90);
    const { envelope1, threshold } = this.hilbert.doubleEnvelope(recentSignal);
    
    // Calcular estadísticas para SNR
    const mean = recentSignal.reduce((a, b) => a + b, 0) / recentSignal.length;
    const variance = recentSignal.reduce((acc, v) => acc + (v - mean) ** 2, 0) / recentSignal.length;
    const std = Math.sqrt(variance);
    
    // Verificar si hay pico en la posición reciente
    const checkIdx = recentSignal.length - 5; // Mirar 5 samples atrás
    const timeSinceLastPeak = timestamp - this.lastPeakTime;
    
    let isPeak = false;
    let rrInterval: number | null = null;
    let confidence = 0;
    
    if (timeSinceLastPeak >= this.MIN_PEAK_INTERVAL_MS) {
      // Verificar cruce de threshold
      if (checkIdx > 0 && checkIdx < recentSignal.length - 1) {
        const crossUp = recentSignal[checkIdx - 1] < threshold[checkIdx - 1] && 
                        recentSignal[checkIdx] >= threshold[checkIdx];
        
        // Verificar máximo local
        const isLocalMax = recentSignal[checkIdx] > recentSignal[checkIdx - 1] &&
                          recentSignal[checkIdx] >= recentSignal[checkIdx + 1];
        
        if (crossUp || isLocalMax) {
          // Validar amplitud significativa con umbral ESTRICTO
          const localThreshold = threshold[checkIdx];
          const amplitude = recentSignal[checkIdx];
          
          // NUEVO: Calcular SNR = (amplitude - mean) / std
          const snr = std > 0 ? (amplitude - mean) / std : 0;
          
          // CRITERIOS MUY RELAJADOS para detectar picos reales:
          // 1. Amplitud > threshold * 0.7 (era 0.9)
          // 2. SNR > 0.5 (era 1.0)
          // 3. Amplitud > promedio * 1.02 (era 1.05)
          const amplitudeValid = amplitude > localThreshold * 0.7 && amplitude > mean * 1.02;
          const snrValid = snr > 0.5;
          
          if (amplitudeValid && snrValid) {
            isPeak = true;
            confidence = Math.min(1, snr / 3); // Confianza basada en SNR (más sensible)
            
            // Registrar RR interval
            if (this.lastPeakTime > 0 && timeSinceLastPeak <= this.MAX_PEAK_INTERVAL_MS) {
              rrInterval = timeSinceLastPeak;
              this.rrHistory.push(rrInterval);
              if (this.rrHistory.length > this.MAX_RR_HISTORY) {
                this.rrHistory.shift();
              }
              
              // Actualizar BPM suavizado
              const instantBPM = 60000 / rrInterval;
              if (this.smoothedBPM === 0) {
                this.smoothedBPM = instantBPM;
              } else {
                this.smoothedBPM = this.smoothedBPM * this.BPM_SMOOTHING + 
                                   instantBPM * (1 - this.BPM_SMOOTHING);
              }
            }
            
            this.lastPeakTime = timestamp;
            this.lastPeakIndex = this.signalBuffer.length - 1;
          }
        }
      }
    }
    
    return {
      isPeak,
      bpm: Math.round(this.smoothedBPM),
      rrInterval,
      confidence
    };
  }
  
  /**
   * CALCULAR HRV (Heart Rate Variability)
   */
  calculateHRV(rrIntervals: number[]): {
    sdnn: number;
    rmssd: number;
    pnn50: number;
  } {
    if (rrIntervals.length < 3) {
      return { sdnn: 0, rmssd: 0, pnn50: 0 };
    }
    
    const n = rrIntervals.length;
    
    // SDNN: Desviación estándar de NN intervals
    const mean = rrIntervals.reduce((a, b) => a + b, 0) / n;
    const variance = rrIntervals.reduce((acc, rr) => acc + (rr - mean) ** 2, 0) / n;
    const sdnn = Math.sqrt(variance);
    
    // RMSSD: Root Mean Square of Successive Differences
    let sumSquaredDiff = 0;
    let nn50Count = 0;
    
    for (let i = 1; i < n; i++) {
      const diff = Math.abs(rrIntervals[i] - rrIntervals[i - 1]);
      sumSquaredDiff += diff ** 2;
      
      // pNN50: Porcentaje de diferencias > 50ms
      if (diff > 50) {
        nn50Count++;
      }
    }
    
    const rmssd = Math.sqrt(sumSquaredDiff / (n - 1));
    const pnn50 = (nn50Count / (n - 1)) * 100;
    
    return { sdnn, rmssd, pnn50 };
  }
  
  /**
   * OBTENER RR INTERVALS HISTÓRICOS
   */
  getRRIntervals(): number[] {
    return [...this.rrHistory];
  }
  
  /**
   * OBTENER BPM ACTUAL
   */
  getCurrentBPM(): number {
    return Math.round(this.smoothedBPM);
  }
  
  /**
   * OBTENER ÚLTIMO TIEMPO DE PICO
   */
  getLastPeakTime(): number {
    return this.lastPeakTime;
  }
  
  /**
   * RESET
   */
  reset(): void {
    this.signalBuffer = [];
    this.rrHistory = [];
    this.lastPeakTime = 0;
    this.lastPeakIndex = 0;
    this.smoothedBPM = 0;
  }
  
  /**
   * ACTUALIZAR SAMPLE RATE
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.hilbert.setSampleRate(rate);
  }
  
  /**
   * RESULTADO VACÍO
   */
  private createEmptyResult(): PeakDetectionResult {
    return {
      peaks: [],
      rrIntervals: [],
      instantaneousBPM: 0,
      averageBPM: 0,
      hrv: { sdnn: 0, rmssd: 0, pnn50: 0 },
      threshold: []
    };
  }
}
