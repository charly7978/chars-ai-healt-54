/**
 * CALIBRATION MANAGER
 * Sistema de calibración automática de 5 segundos
 * Adapta umbrales según características del dispositivo y tono de piel
 */

export interface CalibrationSample {
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  filteredValue: number;
  timestamp: number;
}

export interface CalibrationProfile {
  // Características del usuario/dispositivo
  redBaseline: number;
  greenBaseline: number;
  blueBaseline: number;
  redStdDev: number;
  greenStdDev: number;
  rgRatioMean: number;
  rgRatioStdDev: number;
  signalAmplitude: number;
  noiseLevel: number;
  
  // Umbrales adaptativos calculados
  fingerDetectionThreshold: number;
  rgRatioMin: number;
  rgRatioMax: number;
  peakDetectionThreshold: number;
  minSignalRange: number;
  
  // Metadatos
  timestamp: number;
  samplesCollected: number;
  peaksDetected: number;
  confidence: number;
}

export type CalibrationState = 'IDLE' | 'COLLECTING' | 'ANALYZING' | 'COMPLETE' | 'FAILED';

const CALIBRATION_DURATION_MS = 5000;
const TARGET_FPS = 30;
const EXPECTED_SAMPLES = Math.floor(CALIBRATION_DURATION_MS / 1000 * TARGET_FPS);
const MIN_SAMPLES_REQUIRED = 90; // 3 segundos mínimo

export class CalibrationManager {
  private samples: CalibrationSample[] = [];
  private state: CalibrationState = 'IDLE';
  private startTime: number = 0;
  private profile: CalibrationProfile | null = null;
  private onProgressCallback: ((progress: number, state: CalibrationState) => void) | null = null;
  private onCompleteCallback: ((profile: CalibrationProfile) => void) | null = null;
  private onFailCallback: ((reason: string) => void) | null = null;

  constructor() {
    this.reset();
  }

  /**
   * Configurar callbacks
   */
  setCallbacks(
    onProgress: (progress: number, state: CalibrationState) => void,
    onComplete: (profile: CalibrationProfile) => void,
    onFail: (reason: string) => void
  ): void {
    this.onProgressCallback = onProgress;
    this.onCompleteCallback = onComplete;
    this.onFailCallback = onFail;
  }

  /**
   * Iniciar calibración
   */
  start(): void {
    this.reset();
    this.state = 'COLLECTING';
    this.startTime = Date.now();
    console.log('[CalibrationManager] Calibración iniciada');
  }

  /**
   * Agregar muestra durante calibración
   */
  addSample(sample: CalibrationSample): void {
    if (this.state !== 'COLLECTING') return;

    // Validar que la muestra tenga datos válidos
    if (sample.rawRed > 20 && sample.rawGreen > 10) {
      this.samples.push({
        ...sample,
        timestamp: Date.now()
      });
    }

    // Calcular progreso
    const elapsed = Date.now() - this.startTime;
    const progress = Math.min(100, (elapsed / CALIBRATION_DURATION_MS) * 100);
    
    this.onProgressCallback?.(progress, this.state);

    // Verificar si terminó el tiempo
    if (elapsed >= CALIBRATION_DURATION_MS) {
      this.analyze();
    }
  }

  /**
   * Analizar muestras y generar perfil
   */
  private analyze(): void {
    this.state = 'ANALYZING';
    this.onProgressCallback?.(100, this.state);

    if (this.samples.length < MIN_SAMPLES_REQUIRED) {
      this.state = 'FAILED';
      this.onFailCallback?.(`Muestras insuficientes: ${this.samples.length}/${MIN_SAMPLES_REQUIRED}`);
      return;
    }

    try {
      this.profile = this.calculateProfile();
      this.state = 'COMPLETE';
      console.log('[CalibrationManager] Perfil calculado:', this.profile);
      this.onCompleteCallback?.(this.profile);
    } catch (error) {
      this.state = 'FAILED';
      this.onFailCallback?.('Error al calcular perfil de calibración');
    }
  }

  /**
   * Calcular perfil de calibración basado en muestras
   */
  private calculateProfile(): CalibrationProfile {
    const n = this.samples.length;
    
    // === PASO 1: Calcular estadísticas RGB ===
    let sumR = 0, sumG = 0, sumB = 0;
    let sumRG = 0;
    const rgRatios: number[] = [];
    
    for (const sample of this.samples) {
      sumR += sample.rawRed;
      sumG += sample.rawGreen;
      sumB += sample.rawBlue;
      
      const rgRatio = sample.rawGreen > 0 ? sample.rawRed / sample.rawGreen : 0;
      rgRatios.push(rgRatio);
      sumRG += rgRatio;
    }
    
    const redBaseline = sumR / n;
    const greenBaseline = sumG / n;
    const blueBaseline = sumB / n;
    const rgRatioMean = sumRG / n;
    
    // Calcular desviaciones estándar
    let sumRDiff2 = 0, sumGDiff2 = 0, sumRGDiff2 = 0;
    for (let i = 0; i < n; i++) {
      sumRDiff2 += Math.pow(this.samples[i].rawRed - redBaseline, 2);
      sumGDiff2 += Math.pow(this.samples[i].rawGreen - greenBaseline, 2);
      sumRGDiff2 += Math.pow(rgRatios[i] - rgRatioMean, 2);
    }
    
    const redStdDev = Math.sqrt(sumRDiff2 / n);
    const greenStdDev = Math.sqrt(sumGDiff2 / n);
    const rgRatioStdDev = Math.sqrt(sumRGDiff2 / n);
    
    // === PASO 2: Analizar señal filtrada ===
    const filteredValues = this.samples.map(s => s.filteredValue);
    const signalMin = Math.min(...filteredValues);
    const signalMax = Math.max(...filteredValues);
    const signalAmplitude = signalMax - signalMin;
    
    // Calcular ruido como desviación de alta frecuencia
    let noiseSum = 0;
    for (let i = 1; i < filteredValues.length; i++) {
      noiseSum += Math.abs(filteredValues[i] - filteredValues[i - 1]);
    }
    const noiseLevel = noiseSum / (filteredValues.length - 1);
    
    // === PASO 3: Detectar picos durante calibración ===
    const peaksDetected = this.countPeaks(filteredValues);
    
    // === PASO 4: Calcular umbrales adaptativos ===
    
    // Umbral de detección de dedo: 30% del baseline rojo
    const fingerDetectionThreshold = Math.max(25, redBaseline * 0.3);
    
    // Rango R/G: ±2.5 desviaciones estándar del ratio medio
    const rgRatioMin = Math.max(0.5, rgRatioMean - 2.5 * Math.max(rgRatioStdDev, 0.2));
    const rgRatioMax = Math.min(5.0, rgRatioMean + 2.5 * Math.max(rgRatioStdDev, 0.2));
    
    // Umbral de pico: 25% de la amplitud típica
    const peakDetectionThreshold = signalAmplitude * 0.25;
    
    // Rango mínimo de señal: 3x el ruido
    const minSignalRange = noiseLevel * 3;
    
    // === PASO 5: Calcular confianza ===
    // Basada en: cantidad de muestras, picos detectados, y estabilidad
    const sampleScore = Math.min(100, (n / EXPECTED_SAMPLES) * 100);
    const peakScore = Math.min(100, (peaksDetected / 5) * 100); // Esperamos ~5 picos en 5 seg
    const stabilityScore = Math.max(0, 100 - (redStdDev / redBaseline) * 200);
    const confidence = Math.round((sampleScore * 0.3 + peakScore * 0.4 + stabilityScore * 0.3));
    
    return {
      redBaseline,
      greenBaseline,
      blueBaseline,
      redStdDev,
      greenStdDev,
      rgRatioMean,
      rgRatioStdDev,
      signalAmplitude,
      noiseLevel,
      fingerDetectionThreshold,
      rgRatioMin,
      rgRatioMax,
      peakDetectionThreshold,
      minSignalRange,
      timestamp: Date.now(),
      samplesCollected: n,
      peaksDetected,
      confidence
    };
  }

  /**
   * Contar picos en señal (para validación)
   */
  private countPeaks(values: number[]): number {
    if (values.length < 3) return 0;
    
    let peaks = 0;
    const smoothed = this.smooth(values, 3);
    
    for (let i = 2; i < smoothed.length - 2; i++) {
      if (smoothed[i] > smoothed[i - 1] && 
          smoothed[i] > smoothed[i - 2] &&
          smoothed[i] > smoothed[i + 1] && 
          smoothed[i] > smoothed[i + 2]) {
        peaks++;
      }
    }
    
    return peaks;
  }

  /**
   * Suavizado simple
   */
  private smooth(values: number[], window: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - window); j <= Math.min(values.length - 1, i + window); j++) {
        sum += values[j];
        count++;
      }
      result.push(sum / count);
    }
    return result;
  }

  /**
   * Obtener progreso actual
   */
  getProgress(): number {
    if (this.state !== 'COLLECTING') return this.state === 'COMPLETE' ? 100 : 0;
    const elapsed = Date.now() - this.startTime;
    return Math.min(100, (elapsed / CALIBRATION_DURATION_MS) * 100);
  }

  /**
   * Obtener estado
   */
  getState(): CalibrationState {
    return this.state;
  }

  /**
   * Obtener perfil calculado
   */
  getProfile(): CalibrationProfile | null {
    return this.profile;
  }

  /**
   * Verificar si está completo
   */
  isComplete(): boolean {
    return this.state === 'COMPLETE';
  }

  /**
   * Obtener estadísticas en tiempo real durante calibración
   */
  getRealtimeStats(): { avgRed: number; avgGreen: number; rgRatio: number; samples: number } {
    if (this.samples.length === 0) {
      return { avgRed: 0, avgGreen: 0, rgRatio: 0, samples: 0 };
    }
    
    const recent = this.samples.slice(-30);
    const avgRed = recent.reduce((s, x) => s + x.rawRed, 0) / recent.length;
    const avgGreen = recent.reduce((s, x) => s + x.rawGreen, 0) / recent.length;
    const rgRatio = avgGreen > 0 ? avgRed / avgGreen : 0;
    
    return { avgRed, avgGreen, rgRatio, samples: this.samples.length };
  }

  /**
   * Reiniciar
   */
  reset(): void {
    this.samples = [];
    this.state = 'IDLE';
    this.startTime = 0;
    this.profile = null;
  }
}
