
/**
 * Implementación de Filtro Kalman para procesamiento de señal
 */
export class KalmanFilter {
  private R: number = 0.01; // Varianza de la medición (ruido del sensor)
  private Q: number = 0.1;  // Varianza del proceso
  private P: number = 1;    // Covarianza del error estimado
  private X: number = 0;    // Estado estimado
  private K: number = 0;    // Ganancia de Kalman

  filter(measurement: number): number {
    // Predicción
    this.P = this.P + this.Q;
    
    // Actualización
    this.K = this.P / (this.P + this.R);
    this.X = this.X + this.K * (measurement - this.X);
    this.P = (1 - this.K) * this.P;
    
    return this.X;
  }

  reset() {
    this.X = 0;
    this.P = 1;
  }
}
