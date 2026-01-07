/**
 * FILTRO SAVITZKY-GOLAY OPTIMIZADO PARA PPG
 * 
 * CAMBIO CRÍTICO: Ventana REDUCIDA de 7 puntos para:
 * - Preservar mejor el componente AC (pulsátil)
 * - Respuesta más rápida a los picos de latido
 * - Menos lag en la detección
 */
export class SavitzkyGolayFilter {
  private readonly coefficients: number[];
  private buffer: number[] = [];
  private readonly windowSize: number = 7;  // REDUCIDO de 15 a 7
  private readonly normFactor: number = 21; // Factor para ventana de 7

  constructor() {
    /**
     * Coeficientes para ventana de 7 puntos (Grado 2).
     * Ventana más pequeña = mejor preservación de picos
     */
    this.coefficients = [
      -2, 3, 6, 7, 6, 3, -2
    ];
    
    this.buffer = [];
  }

  /**
   * Procesa un nuevo valor y devuelve el valor suavizado
   * PRESERVANDO el componente pulsátil
   */
  filter(value: number): number {
    // Primera inicialización
    if (this.buffer.length === 0) {
      this.buffer = new Array(this.windowSize).fill(value);
      return value; // Retornar valor sin modificar al inicio
    }

    // Buffer circular
    this.buffer.push(value);
    this.buffer.shift();
    
    // Convolución
    let filtered = 0;
    for (let i = 0; i < this.windowSize; i++) {
      filtered += this.buffer[i] * this.coefficients[i];
    }
    
    return filtered / this.normFactor;
  }

  reset(): void {
    this.buffer = [];
  }
}
