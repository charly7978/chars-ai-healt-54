/**
 * HEART BEAT PROCESSOR - ALTA SENSIBILIDAD
 * Detecta picos en tiempo real y calcula BPM basándose en intervalos R-R.
 */
export class HeartBeatProcessor {
  private bpmHistory: number[] = [];
  private lastPeakTime: number = 0;
  private peakBuffer: number[] = [];
  
  // Configuración para detección real
  private readonly CONFIG = {
    PEAK_THRESHOLD: 0.05,        // Umbral de amplitud mínima para un latido
    MIN_RR_INTERVAL_MS: 300,    // Límite superior: 200 BPM
    MAX_RR_INTERVAL_MS: 1500,   // Límite inferior: 40 BPM
    HISTORY_SIZE: 8,            // Ventana pequeña para cambios rápidos
    SMOOTHING_FACTOR: 0.7       // Prioriza el dato nuevo sobre el anterior
  };

  /**
   * Procesa cada muestra de la señal filtrada
   */
  public processSample(value: number, timestamp: number): number {
    // Detectar pico: El valor debe ser mayor al umbral y mayor a sus vecinos (derivada)
    if (this.isPeak(value)) {
      const timeSinceLastPeak = timestamp - this.lastPeakTime;

      // Validar intervalo fisiológico
      if (
        timeSinceLastPeak >= this.CONFIG.MIN_RR_INTERVAL_MS &&
        timeSinceLastPeak <= this.CONFIG.MAX_RR_INTERVAL_MS
      ) {
        const instantBpm = 60000 / timeSinceLastPeak;
        this.lastPeakTime = timestamp;
        return this.calculateRollingBpm(instantBpm);
      }
    }

    // Si no hay pico nuevo, devolver el último valor calculado
    return this.bpmHistory.length > 0 ? this.bpmHistory[this.bpmHistory.length - 1] : 0;
  }

  private isPeak(value: number): boolean {
    this.peakBuffer.push(value);
    if (this.peakBuffer.length > 3) this.peakBuffer.shift();

    if (this.peakBuffer.length < 3) return false;

    // Local Maxima: El punto central es mayor que el anterior y el posterior
    return (
      this.peakBuffer[1] > this.peakBuffer[0] &&
      this.peakBuffer[1] > this.peakBuffer[2] &&
      this.peakBuffer[1] > this.CONFIG.PEAK_THRESHOLD
    );
  }

  private calculateRollingBpm(instantBpm: number): number {
    // Filtro de Outliers: Ignorar cambios súbitos imposibles (>30% de diferencia)
    if (this.bpmHistory.length > 0) {
      const lastBpm = this.bpmHistory[this.bpmHistory.length - 1];
      if (Math.abs(instantBpm - lastBpm) > lastBpm * 0.35) {
        return lastBpm;
      }
    }

    this.bpmHistory.push(instantBpm);
    if (this.bpmHistory.length > this.CONFIG.HISTORY_SIZE) {
      this.bpmHistory.shift();
    }

    // Promedio simple de la ventana para estabilidad visual sin "congelar" el dato
    const average = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
    return Math.round(average);
  }

  public reset(): void {
    this.bpmHistory = [];
    this.lastPeakTime = 0;
    this.peakBuffer = [];
  }
}
