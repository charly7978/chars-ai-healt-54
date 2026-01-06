/**
 * IMPLEMENTACIÓN OPTIMIZADA DEL FILTRO SAVITZKY-GOLAY
 * * Este filtro es superior a un promedio móvil simple porque suaviza el ruido
 * de la cámara sin aplanar los picos de los latidos (preserva el valor real).
 * * Configuración: Ventana de 15 puntos, Polinomio Grado 2.
 */
export class SavitzkyGolayFilter {
  private readonly coefficients: number[];
  private buffer: number[] = [];
  private readonly windowSize: number = 15;
  // Factor de normalización (suma de los pesos positivos del filtro)
  private readonly normFactor: number = 1105;

  constructor() {
    /**
     * Coeficientes para ventana de 15 puntos (Grado 2).
     * Estos valores actúan como una "plantilla" matemática que se desliza
     * sobre los datos de la cámara.
     */
    this.coefficients = [
      -78, -13, 42, 87, 122, 147, 162, 167, 162, 147, 122, 87, 42, -13, -78
    ];
    
    this.buffer = [];
  }

  /**
   * Procesa un nuevo valor de luz roja y devuelve el valor suavizado.
   */
  filter(value: number): number {
    // Inicialización: Llenamos el buffer con el primer valor para evitar saltos desde cero
    if (this.buffer.length === 0) {
      this.buffer = new Array(this.windowSize).fill(value);
    }

    // Desplazamiento del buffer circular
    this.buffer.push(value);
    this.buffer.shift();
    
    // Aplicar Convolución (Multiplicar cada dato por su peso correspondiente)
    let filtered = 0;
    for (let i = 0; i < this.windowSize; i++) {
      filtered += this.buffer[i] * this.coefficients[i];
    }
    
    // Normalizar para mantener la señal en la misma escala que la original
    return filtered / this.normFactor;
  }

  /**
   * Limpia el filtro para una nueva medición.
   */
  reset(): void {
    this.buffer = [];
  }
}
