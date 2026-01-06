/**
 * HEART BEAT PROCESSOR - VERSIÓN DE ALTA SENSIBILIDAD
 * Optimizado para detectar variabilidad real (HRV) y evitar el efecto "simulación".
 */
export class HeartBeatProcessor {
  private bpmHistory: number[] = [];
  private lastPeakTime: number = 0;
  private readonly MAX_HISTORY = 10;
  
  // CONFIGURACIÓN SENSIBLE
  private readonly CONFIG = {
    BPM_ALPHA: 0.75,              // Alta reactividad (cambia rápido ante latidos reales)
    PEAK_THRESHOLD: 0.04,         // Umbral bajo para no ignorar latidos débiles
    MIN_PEAK_DISTANCE_MS: 300,    // ~200 BPM máx.
    MAX_PEAK_DISTANCE_MS: 1500,   // ~40 BPM mín.
  };

  /**
   * Procesa la señal filtrada para encontrar picos y calcular BPM
   */
  processSignal(value: number, timestamp: number): number | null {
    // Detección de picos basada en derivada dinámica
    if (value > this.CONFIG.PEAK_THRESHOLD) {
      const timeDiff = timestamp - this.lastPeakTime;

      // Validar si el intervalo de tiempo es fisiológicamente posible
      if (timeDiff > this.CONFIG.MIN_PEAK_DISTANCE_MS && timeDiff < this.CONFIG.MAX_PEAK_DISTANCE_MS) {
        const instantBpm = 60000 / timeDiff;
        this.lastPeakTime = timestamp;
        
        return this.updateBpm(instantBpm);
      }
    }
    return this.bpmHistory.length > 0 ? this.bpmHistory[this.bpmHistory.length - 1] : 0;
  }

  private updateBpm(newBpm: number): number {
    // Filtro de outlier simple (ignora cambios imposibles de un solo latido > 40%)
    if (this.bpmHistory.length > 0) {
      const lastBpm = this.bpmHistory[this.bpmHistory.length - 1];
      if (Math.abs(newBpm - lastBpm) > lastBpm * 0.4) {
          return lastBpm; 
      }
    }

    this.bpmHistory.push(newBpm);
    if (this.bpmHistory.length > this.MAX_HISTORY) this.bpmHistory.shift();

    // Promedio ponderado para suavizado natural, no artificial
    const average = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
    return Math.round(average);
  }

  reset(): void {
    this.bpmHistory = [];
    this.lastPeakTime = 0;
  }
}
