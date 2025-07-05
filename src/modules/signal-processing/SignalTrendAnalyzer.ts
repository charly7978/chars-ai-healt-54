export type TrendResult = "stable" | "unstable" | "non_physiological";

/**
 * SignalTrendAnalyzer evaluates the short-term and long-term trends of a PPG signal
 * to determine its stability, detect non-physiological patterns, and assess periodicity.
 * This is critical for filtering out noise from motion artifacts or poor sensor contact.
 */
export class SignalTrendAnalyzer {
  private valueHistory: number[] = [];
  private derivativeHistory: number[] = [];
  private peakTimes: number[] = []; // Almacena los tiempos de los picos detectados
  private lastPeakTime: number = 0;
  private lastValue: number = 0;
  private readonly HISTORY_SIZE = 100; // Aumentado para capturar más datos
  private readonly STABILITY_WINDOW = 20;
  private readonly PERIODICITY_WINDOW = 40;
  private readonly MIN_PEAK_DISTANCE = 30; // Mínimo número de frames entre picos (~1s a 30fps)
  private readonly PEAK_THRESHOLD = 0.5; // Umbral para detección de picos
  
  // Umbrales más estrictos para validación fisiológica
  private readonly MAX_VALUE_JUMP = 18; // Aumentado ligeramente para mayor sensibilidad
  private readonly MAX_STD_DEV = 10;    // Aumentado ligeramente para aceptar más variación
  private readonly MIN_HR = 40;         // Límite inferior de frecuencia cardíaca (bpm)
  private readonly MAX_HR = 200;        // Límite superior de frecuencia cardíaca (bpm)

  reset(): void {
    this.valueHistory = [];
    this.derivativeHistory = [];
    this.peakTimes = [];
    this.lastPeakTime = 0;
    this.lastValue = 0;
  }

  /**
   * Analyzes the trend of the incoming signal value.
   * @param value The latest filtered signal value.
   * @returns A TrendResult indicating the signal's current state.
   */
  analyzeTrend(value: number): TrendResult {
    if (this.valueHistory.length > 0) {
      const lastValue = this.valueHistory[this.valueHistory.length - 1];
      const jump = Math.abs(value - lastValue);

      // Check for sudden, non-physiological jumps
      if (jump > this.MAX_VALUE_JUMP) {
        this.reset(); // Reset on large jump
        return "non_physiological";
      }
    }

    this.updateHistory(value);

    if (this.valueHistory.length < this.STABILITY_WINDOW) {
      return "unstable"; // Not enough data yet
    }

    const recentHistory = this.valueHistory.slice(-this.STABILITY_WINDOW);
    const mean = recentHistory.reduce((a, b) => a + b, 0) / recentHistory.length;
    const stdDev = Math.sqrt(
      recentHistory.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / recentHistory.length
    );

    if (stdDev > this.MAX_STD_DEV) {
      return "unstable";
    }

    return "stable";
  }

  /**
   * Calculates a stability score based on recent signal variance.
   * @returns A score from 0.0 (highly unstable) to 1.0 (highly stable).
   */
  getStabilityScore(): number {
    if (this.valueHistory.length < this.STABILITY_WINDOW) {
      return 0;
    }

    const recentHistory = this.valueHistory.slice(-this.STABILITY_WINDOW);
    const mean = recentHistory.reduce((a, b) => a + b, 0) / recentHistory.length;
    const stdDev = Math.sqrt(
      recentHistory.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / recentHistory.length
    );

    // Inverse relationship: lower std dev = higher score
    const score = 1.0 - Math.min(1.0, stdDev / this.MAX_STD_DEV);
    return score;
  }

  /**
   * Assesses the periodicity of the signal, which is a strong indicator of a heartbeat.
   * Uses autocorrelation on the signal's derivative to find repeating patterns.
   * @returns A score from 0.0 (not periodic) to 1.0 (highly periodic).
   */
  getPeriodicityScore(): number {
    if (this.derivativeHistory.length < this.PERIODICITY_WINDOW) {
      return 0;
    }

    // Usar los picos detectados para validar la periodicidad
    if (this.peakTimes.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < this.peakTimes.length; i++) {
        intervals.push(this.peakTimes[i] - this.peakTimes[i - 1]);
      }
      
      // Calcular la desviación estándar de los intervalos
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, interval) => {
        return sum + Math.pow(interval - avgInterval, 2);
      }, 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      // La desviación estándar normalizada (0-1) donde 0 es perfectamente periódico
      const normalizedStdDev = Math.min(1, stdDev / (avgInterval * 0.3));
      
      // Convertir a puntuación (1 - normalizedStdDev)
      return Math.max(0, 1 - normalizedStdDev);
    }
    
    // Si no hay suficientes picos, usar autocorrelación
    const recentDerivatives = this.derivativeHistory.slice(-this.PERIODICITY_WINDOW);
    const autocorrelation = this.autocorrelate(recentDerivatives);

    let maxPeak = 0;
    const minLag = Math.floor((60 / this.MAX_HR) * 30); // Mínimo para la frecuencia cardíaca máxima
    const maxLag = Math.ceil((60 / this.MIN_HR) * 30);  // Máximo para la frecuencia cardíaca mínima
    
    for (let i = minLag; i < Math.min(maxLag, autocorrelation.length); i++) { 
      if (autocorrelation[i] > maxPeak) {
        maxPeak = autocorrelation[i];
      }
    }

    return Math.max(0, Math.min(1.0, maxPeak));
  }
  
  /**
   * Calcula el BPM basado en los picos detectados
   */
  getBPM(): number {
    if (this.peakTimes.length < 2) {
      return 0; // No hay suficientes picos para calcular BPM
    }
    
    // Calcular el intervalo promedio entre picos
    let totalInterval = 0;
    for (let i = 1; i < this.peakTimes.length; i++) {
      totalInterval += this.peakTimes[i] - this.peakTimes[i - 1];
    }
    const avgIntervalMs = totalInterval / (this.peakTimes.length - 1);
    
    // Convertir a BPM (latidos por minuto)
    const bpm = 60000 / avgIntervalMs;
    
    // Asegurar que el BPM esté dentro de rangos fisiológicos
    return Math.max(this.MIN_HR, Math.min(this.MAX_HR, bpm));
  }

  private updateHistory(value: number): void {
    const timestamp = Date.now();
    
    // Detección de picos mejorada
    if (this.valueHistory.length > 2) {
      const prevValue = this.valueHistory[this.valueHistory.length - 1];
      const prevPrevValue = this.valueHistory[this.valueHistory.length - 2];
      
      // Detectar picos locales
      if (prevValue > this.PEAK_THRESHOLD && 
          prevValue > prevPrevValue && 
          prevValue > value &&
          (timestamp - this.lastPeakTime) > (this.MIN_PEAK_DISTANCE * 33)) { // ~33ms por frame
        
        // Solo registrar si el tiempo desde el último pico es razonable para un latido
        if (this.lastPeakTime > 0) {
          const timeSinceLastPeak = timestamp - this.lastPeakTime;
          const bpm = 60000 / timeSinceLastPeak; // Convertir a BPM
          
          if (bpm >= this.MIN_HR && bpm <= this.MAX_HR) {
            this.peakTimes.push(timestamp);
            this.lastPeakTime = timestamp;
            
            // Mantener solo los últimos picos relevantes
            if (this.peakTimes.length > 5) {
              this.peakTimes.shift();
            }
          }
        } else {
          this.lastPeakTime = timestamp;
          this.peakTimes.push(timestamp);
        }
      }
      
      // Actualizar derivada
      this.derivativeHistory.push(value - prevValue);
      if (this.derivativeHistory.length > this.HISTORY_SIZE) {
        this.derivativeHistory.shift();
      }
    }

    // Actualizar historial de valores
    this.valueHistory.push(value);
    this.lastValue = value;
    if (this.valueHistory.length > this.HISTORY_SIZE) {
      this.valueHistory.shift();
    }
  }

  /**
   * Calculates the autocorrelation of a signal.
   * @param data The input signal data.
   * @returns The normalized autocorrelation values.
   */
  private autocorrelate(data: number[]): number[] {
    const n = data.length;
    if (n === 0) return [];
    const mean = data.reduce((a, b) => a + b, 0) / n;
    const variance = data.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0);
    const result = new Array(n).fill(0);

    if (variance === 0) {
      return result; // No variance, no correlation
    }

    for (let lag = 0; lag < n; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) {
        sum += (data[i] - mean) * (data[i + lag] - mean);
      }
      result[lag] = sum / variance;
    }

    return result;
  }
}
