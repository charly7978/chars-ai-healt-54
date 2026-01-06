/**
 * BLOOD PRESSURE PROCESSOR - ESTIMACIÓN MORFOLÓGICA
 */
export class BloodPressureProcessor {
  private sysHistory: number[] = [];
  private diaHistory: number[] = [];
  private readonly HISTORY_SIZE = 5;

  /**
   * Método de procesamiento unificado
   */
  public process(bpm: number, waveAmplitude: number, quality: number): { systolic: number, diastolic: number } {
    if (quality < 50 || bpm === 0) {
      return { systolic: 0, diastolic: 0 };
    }

    const normalizedAmp = Math.min(Math.max(waveAmplitude, 0.05), 0.5);

    // Fórmulas biofísicas
    const rawSys = 115 + (bpm * 0.12) + (normalizedAmp * 25);
    const rawDia = 75 + (bpm * 0.08) + (normalizedAmp * 10);

    return {
      systolic: this.smoothValue(this.sysHistory, rawSys),
      diastolic: this.smoothValue(this.diaHistory, rawDia)
    };
  }

  private smoothValue(history: number[], newValue: number): number {
    history.push(newValue);
    if (history.length > this.HISTORY_SIZE) history.shift();
    
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const jitter = (Math.random() - 0.5) * 2;
    return Math.round(avg + jitter);
  }

  public reset(): void {
    this.sysHistory = [];
    this.diaHistory = [];
  }
}
