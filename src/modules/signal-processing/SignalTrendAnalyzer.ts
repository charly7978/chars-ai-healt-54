export type TrendResult = "stable" | "unstable" | "non_physiological";

/**
 * Analizador de tendencias de señal PPG optimizado para detección de dedo y latido
 * Utiliza un enfoque simplificado pero efectivo para detectar patrones fisiológicos
 */
export class SignalTrendAnalyzer {
  private valueHistory: number[] = [];
  private lastPeakTime: number = 0;
  private readonly HISTORY_SIZE = 30; // Reducido para respuesta más rápida
  private readonly STABILITY_WINDOW = 15;
  
  // Umbrales optimizados para detección de dedo
  private readonly MAX_VALUE_JUMP = 20;    // Umbral para cambios bruscos
  private readonly MAX_STD_DEV = 15;       // Máxima desviación estándar permitida
  private readonly MIN_AMPLITUDE = 2;      // Amplitud mínima para considerar señal válida
  
  reset(): void {
    this.valueHistory = [];
    this.lastPeakTime = 0;
  }
  
  /**
   * Analiza la tendencia de la señal para detectar patrones anormales
   */
  analyzeTrend(value: number): TrendResult {
    // Validación básica de la señal
    if (this.valueHistory.length > 0) {
      const lastValue = this.valueHistory[this.valueHistory.length - 1];
      const jump = Math.abs(value - lastValue);
      
      // Detectar saltos bruscos no fisiológicos
      if (jump > this.MAX_VALUE_JUMP) {
        return "non_physiological";
      }
    }
    
    // Actualizar historial
    this.valueHistory.push(value);
    if (this.valueHistory.length > this.HISTORY_SIZE) {
      this.valueHistory.shift();
    }
    
    // Verificar estabilidad
    if (this.valueHistory.length < this.STABILITY_WINDOW) {
      return "unstable";
    }
    
    const recent = this.valueHistory.slice(-this.STABILITY_WINDOW);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    
    // Señal demasiado plana
    if ((max - min) < this.MIN_AMPLITUDE) {
      return "unstable";
    }
    
    return "stable";
  }
  
  /**
   * Calcula un puntaje de estabilidad basado en la variación reciente
   */
  getStabilityScore(): number {
    if (this.valueHistory.length < this.STABILITY_WINDOW) {
      return 0;
    }
    
    const recent = this.valueHistory.slice(-this.STABILITY_WINDOW);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    // Puntaje basado en la desviación estándar
    return Math.max(0, 1 - (stdDev / this.MAX_STD_DEV));
  }

  /**
   * Evalúa la periodicidad de la señal basándose en conteo de cruces por cero
   * Un método más simple y directo que la autocorrelación
   */
  getPeriodicityScore(): number {
    if (this.valueHistory.length < this.STABILITY_WINDOW) {
      return 0;
    }
    
    const recent = this.valueHistory.slice(-this.STABILITY_WINDOW);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Contar cruces por cero
    let zeroCrossings = 0;
    for (let i = 1; i < recent.length; i++) {
      if ((recent[i-1] < mean && recent[i] >= mean) || 
          (recent[i-1] > mean && recent[i] <= mean)) {
        zeroCrossings++;
      }
    }
    
    // Normalizar el conteo de cruces (esperamos entre 1-4 cruces para una señal de pulso típica)
    const normalizedCrossings = Math.min(1, zeroCrossings / 4);
    
    return Math.max(0, Math.min(1, normalizedCrossings));
  }
  
  /**
   * Calcula el BPM basado en la frecuencia dominante de la señal
   */
  getBPM(): number {
    if (this.valueHistory.length < this.STABILITY_WINDOW) {
      return 0;
    }
    
    const recent = this.valueHistory.slice(-this.STABILITY_WINDOW);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Encontrar picos locales
    const peaks: number[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1] && recent[i] > mean) {
        peaks.push(i);
      }
    }
    
    if (peaks.length < 2) {
      return 0;
    }
    
    // Calcular BPM basado en la distancia promedio entre picos
    let totalDiff = 0;
    for (let i = 1; i < peaks.length; i++) {
      totalDiff += peaks[i] - peaks[i-1];
    }
    
    const avgDiff = totalDiff / (peaks.length - 1);
    const bpm = (60 * 30) / avgDiff; // Asumiendo 30 fps
    
    // Filtrar valores no fisiológicos
    return bpm >= 40 && bpm <= 200 ? bpm : 0;
  }
}
