/**
 * HEART BEAT PROCESSOR - ALTA SENSIBILIDAD
 * Detecta picos en tiempo real y calcula BPM basándose en intervalos R-R.
 */
export class HeartBeatProcessor {
  private bpmHistory: number[] = [];
  private lastPeakTime: number = 0;
  private peakBuffer: number[] = [];
  
  private readonly CONFIG = {
    PEAK_THRESHOLD: 0.05,        
    MIN_RR_INTERVAL_MS: 300,    
    MAX_RR_INTERVAL_MS: 1500,   
    HISTORY_SIZE: 8,            
    SMOOTHING_FACTOR: 0.7       
  };

  /**
   * Método principal de procesamiento (Nombre restaurado para evitar errores de Runtime)
   */
  public processSignal(value: number, timestamp: number): number {
    if (this.isPeak(value)) {
      const timeSinceLastPeak = timestamp - this.lastPeakTime;

      if (
        timeSinceLastPeak >= this.CONFIG.MIN_RR_INTERVAL_MS &&
        timeSinceLastPeak <= this.CONFIG.MAX_RR_INTERVAL_MS
      ) {
        const instantBpm = 60000 / timeSinceLastPeak;
        this.lastPeakTime = timestamp;
        return this.calculateRollingBpm(instantBpm);
      }
    }

    return this.bpmHistory.length > 0 ? this.bpmHistory[this.bpmHistory.length - 1] : 0;
  }

  private isPeak(value: number): boolean {
    this.peakBuffer.push(value);
    if (this.peakBuffer.length > 3) this.peakBuffer.shift();

    if (this.peakBuffer.length < 3) return false;

    return (
      this.peakBuffer[1] > this.peakBuffer[0] &&
      this.peakBuffer[1] > this.peakBuffer[2] &&
      this.peakBuffer[1] > this.CONFIG.PEAK_THRESHOLD
    );
  }

  private calculateRollingBpm(instantBpm: number): number {
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

    const average = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
    return Math.round(average);
  }

  public reset(): void {
    this.bpmHistory = [];
    this.lastPeakTime = 0;
    this.peakBuffer = [];
  }
}
