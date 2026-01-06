/**
 * HEART BEAT PROCESSOR - ALTA SENSIBILIDAD
 * Procesa la señal PPG para detectar latidos y exportar intervalos R-R reales.
 */
export class HeartBeatProcessor {
  private bpmHistory: number[] = [];
  private lastPeakTime: number = 0;
  private peakBuffer: number[] = [];
  private rrIntervals: number[] = []; // Almacén para análisis de variabilidad
  
  private readonly CONFIG = {
    PEAK_THRESHOLD: 0.05,        // Umbral de detección de pico
    MIN_RR_INTERVAL_MS: 300,    // Límite para 200 BPM
    MAX_RR_INTERVAL_MS: 1500,   // Límite para 40 BPM
    HISTORY_SIZE: 8,            // Ventana de suavizado de BPM
    RR_BUFFER_MAX: 30           // Cantidad de intervalos para detectar arritmias
  };

  /**
   * Procesa la señal filtrada y retorna el BPM actual
   */
  public processSignal(value: number, timestamp: number): number {
    if (this.isPeak(value)) {
      const currentTime = timestamp || Date.now();
      
      if (this.lastPeakTime !== 0) {
        const timeSinceLastPeak = currentTime - this.lastPeakTime;

        // Validación de intervalo fisiológico real
        if (
          timeSinceLastPeak >= this.CONFIG.MIN_RR_INTERVAL_MS &&
          timeSinceLastPeak <= this.CONFIG.MAX_RR_INTERVAL_MS
        ) {
          // Guardar intervalo para getRRIntervals()
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.CONFIG.RR_BUFFER_MAX) {
            this.rrIntervals.shift();
          }

          const instantBpm = 60000 / timeSinceLastPeak;
          this.calculateRollingBpm(instantBpm);
        }
      }
      this.lastPeakTime = currentTime;
    }

    return this.bpmHistory.length > 0 ? this.bpmHistory[this.bpmHistory.length - 1] : 0;
  }

  /**
   * MÉTODO REQUERIDO POR LA UI: Devuelve los intervalos R-R para el ArrhythmiaProcessor
   */
  public getRRIntervals(): number[] {
    return [...this.rrIntervals];
  }

  private isPeak(value: number): boolean {
    this.peakBuffer.push(value);
    if (this.peakBuffer.length > 3) this.peakBuffer.shift();

    if (this.peakBuffer.length < 3) return false;

    // Algoritmo de máximo local: el punto central es mayor que sus vecinos
    return (
      this.peakBuffer[1] > this.peakBuffer[0] &&
      this.peakBuffer[1] > this.peakBuffer[2] &&
      this.peakBuffer[1] > this.CONFIG.PEAK_THRESHOLD
    );
  }

  private calculateRollingBpm(instantBpm: number): void {
    // Filtro de Outliers para evitar saltos erráticos
    if (this.bpmHistory.length > 0) {
      const lastBpm = this.bpmHistory[this.bpmHistory.length - 1];
      if (Math.abs(instantBpm - lastBpm) > lastBpm * 0.4) {
        return; // Ignorar latido si el cambio es > 40% (posible error de lectura)
      }
    }

    this.bpmHistory.push(instantBpm);
    if (this.bpmHistory.length > this.CONFIG.HISTORY_SIZE) {
      this.bpmHistory.shift();
    }
  }

  /**
   * Reinicia el estado del procesador
   */
  public reset(): void {
    this.bpmHistory = [];
    this.lastPeakTime = 0;
    this.peakBuffer = [];
    this.rrIntervals = [];
  }
}
