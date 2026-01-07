/**
 * Filtro Kalman OPTIMIZADO para señal PPG
 * 
 * CRÍTICO: Para PPG necesitamos preservar el componente AC (pulsátil)
 * Los valores R y Q están calibrados para:
 * - Seguir rápidamente los cambios de la señal pulsátil
 * - Filtrar el ruido de alta frecuencia
 * - NO aplanar los picos de los latidos
 */
export class KalmanFilter {
  // R alto = confiar más en la medición (preservar AC)
  // R bajo = confiar más en la predicción (suavizar demasiado)
  private R: number = 0.5;  // AUMENTADO: Más confianza en medición real
  private Q: number = 0.3;  // Varianza del proceso - permite cambios rápidos
  private P: number = 1;    // Covarianza del error estimado
  private X: number = 0;    // Estado estimado
  private K: number = 0;    // Ganancia de Kalman
  private initialized: boolean = false;

  filter(measurement: number): number {
    // Primera medición: inicializar con el valor real
    if (!this.initialized) {
      this.X = measurement;
      this.initialized = true;
      return measurement;
    }
    
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
    this.initialized = false;
  }
}
