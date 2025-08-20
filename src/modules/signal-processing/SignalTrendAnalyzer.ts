export type TrendResult = "stable" | "unstable" | "non_physiological";

/**
 * SignalTrendAnalyzer evaluates the short-term and long-term trends of a PPG signal
 * to determine its stability, detect non-physiological patterns, and assess periodicity.
 * This is critical for filtering out noise from motion artifacts or poor sensor contact.
 */
export class SignalTrendAnalyzer {
  private valueHistory: number[] = [];
  private derivativeHistory: number[] = [];
  private readonly HISTORY_SIZE = 60; // Aumentado para mayor estabilidad
  private readonly STABILITY_WINDOW = 20; // Aumentado para mayor estabilidad
  private readonly PERIODICITY_WINDOW = 40; // Aumentado para mayor estabilidad

  // Umbrales optimizados para estabilidad
  private readonly MAX_VALUE_JUMP = 30; // Aumentado para mayor estabilidad
  private readonly MAX_STD_DEV = 18;    // Aumentado para mayor estabilidad

  reset(): void {
    this.valueHistory = [];
    this.derivativeHistory = [];
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

      // Check for sudden, non-physiological jumps - más permisivo para estabilidad
      if (jump > this.MAX_VALUE_JUMP * 1.5) { // Factor de tolerancia aumentado
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

    // Análisis más permisivo para estabilidad
    if (stdDev > this.MAX_STD_DEV * 1.2) { // Factor de tolerancia aumentado
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

    const recentDerivatives = this.derivativeHistory.slice(-this.PERIODICITY_WINDOW);
    const autocorrelation = this.autocorrelate(recentDerivatives);

    let maxPeak = 0;
    // Start from a lag that corresponds to a reasonable HR (e.g., > 40 bpm)
    const minLag = Math.floor((60 / 200) * (this.HISTORY_SIZE / 1.6)); // 200 bpm max
    for (let i = minLag; i < autocorrelation.length; i++) { 
      if (autocorrelation[i] > maxPeak) {
        maxPeak = autocorrelation[i];
      }
    }

    return Math.max(0, Math.min(1.0, maxPeak));
  }

  private updateHistory(value: number): void {
    if (this.valueHistory.length > 0) {
      const lastValue = this.valueHistory[this.valueHistory.length - 1];
      this.derivativeHistory.push(value - lastValue);
      if (this.derivativeHistory.length > this.HISTORY_SIZE) {
        this.derivativeHistory.shift();
      }
    }

    this.valueHistory.push(value);
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
