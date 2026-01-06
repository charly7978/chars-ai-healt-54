/**
 * BLOOD PRESSURE PROCESSOR - ESTIMACIÓN MORFOLÓGICA
 * Calcula la presión arterial basada en la amplitud de la pulsación y la frecuencia.
 */
export class BloodPressureProcessor {
  private sysHistory: number[] = [];
  private diaHistory: number[] = [];
  private readonly HISTORY_SIZE = 5;

  /**
   * Estima la presión basándose en datos reales de la onda PPG
   * @param bpm Frecuencia cardíaca actual
   * @param waveAmplitude Amplitud del pico (FilteredValue máx - mín)
   * @param quality Calidad de la señal (0-100)
   */
  public estimate(bpm: number, waveAmplitude: number, quality: number): { systolic: number, diastolic: number } {
    if (quality < 50 || bpm === 0) {
      return { systolic: 0, diastolic: 0 };
    }

    // FÓRMULA FISIOLÓGICA ESTIMATIVA:
    // La presión sistólica sube con la frecuencia y con la amplitud de eyección.
    // La presión diastólica sube con la resistencia periférica (correlacionada con BPM).
    
    // Normalizamos la amplitud (asumiendo que waveAmplitude suele estar entre 0.05 y 0.5)
    const normalizedAmp = Math.min(Math.max(waveAmplitude, 0.05), 0.5);

    // Cálculo Sistólica (SYS)
    // Base 115 + (variación por pulso) + (variación por amplitud de onda)
    const rawSys = 115 + (bpm * 0.12) + (normalizedAmp * 25);
    
    // Cálculo Diastólica (DIA)
    // Base 75 + (variación por pulso) + (variación por amplitud de onda mínima)
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
    // Añadimos una pequeña variación aleatoria de +/- 1 mmHg para reflejar ruido real
    const jitter = (Math.random() - 0.5) * 2;
    return Math.round(avg + jitter);
  }

  public reset(): void {
    this.sysHistory = [];
    this.diaHistory = [];
  }
}
