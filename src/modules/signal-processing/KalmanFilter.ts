/**
 * Filtro de Kalman para suavizado de señales PPG y BPM
 * Optimizado para señales biomédicas con ruido
 */

export class KalmanFilter {
  private x: number = 0; // Estado estimado
  private P: number = 1; // Covarianza del error de estimación
  private Q: number = 0.01; // Ruido del proceso
  private R: number = 0.1; // Ruido de medición
  private K: number = 0; // Ganancia de Kalman

  constructor(processNoise: number = 0.01, measurementNoise: number = 0.1) {
    this.Q = processNoise;
    this.R = measurementNoise;
  }

  /**
   * Filtra un valor usando el algoritmo de Kalman
   */
  filter(measurement: number): number {
    // Predicción
    // x = x (sin cambio en el modelo de estado)
    this.P = this.P + this.Q;

    // Actualización
    this.K = this.P / (this.P + this.R);
    this.x = this.x + this.K * (measurement - this.x);
    this.P = (1 - this.K) * this.P;

    return this.x;
  }

  /**
   * Reinicia el filtro
   */
  reset(): void {
    this.x = 0;
    this.P = 1;
    this.K = 0;
  }

  /**
   * Ajusta los parámetros de ruido
   */
  setNoiseParameters(processNoise: number, measurementNoise: number): void {
    this.Q = processNoise;
    this.R = measurementNoise;
  }
}