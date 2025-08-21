
<<<<<<< HEAD
/**
 * Implementación de filtro Savitzky-Golay para suavizado 
 * preservando características de picos en la señal
 */
// SG simplificado (estimador de suavizado). Mantenemos ventana impar.
export function savitzkyGolay(values: number[], windowSize = 9): number[] {
=======
// Filtro Savitzky-Golay simple: ventana impar y coeficientes uniformes para estabilidad.
// Implementación estable y ligera enfocada a suavizado en tiempo real.
export function savitzkyGolay(values: number[], windowSize = 9, polyOrder = 3): number[] {
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
  const n = values.length;
  if (n === 0) return [];
  if (windowSize % 2 === 0) windowSize += 1;
  if (windowSize < 3) windowSize = 3;
  const half = Math.floor(windowSize / 2);
<<<<<<< HEAD
  const coeffs = new Array(windowSize).fill(1 / windowSize);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0, w = 0;
=======

  // Para estabilidad usamos un promedio ponderado simple (no calculamos polinomios completos)
  // Esto reduce riesgo numérico en JS en móviles.
  const coeffs = new Array(windowSize).fill(1 / windowSize);

  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0, wsum = 0;
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
    for (let k = -half; k <= half; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= n) continue;
      const c = coeffs[k + half];
      acc += values[idx] * c;
<<<<<<< HEAD
      w += c;
    }
    out[i] = w ? acc / w : values[i];
=======
      wsum += c;
    }
    out[i] = wsum ? acc / wsum : values[i];
  }
  return out;
}

// Mantener clase existente para compatibilidad
export class SavitzkyGolayFilter {
  private readonly coefficients: number[];
  private readonly normFactor: number;
  private buffer: number[] = [];
  private readonly windowSize: number;

  constructor(windowSize: number = 9) {
    this.windowSize = windowSize;
    this.coefficients = [0.035, 0.105, 0.175, 0.245, 0.285, 0.245, 0.175, 0.105, 0.035];
    this.normFactor = 1.405;
    this.buffer = new Array(windowSize).fill(0);
  }

  filter(value: number): number {
    this.buffer.push(value);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    
    if (this.buffer.length < this.windowSize) {
      return value;
    }
    
    let filtered = 0;
    for (let i = 0; i < this.windowSize; i++) {
      filtered += this.buffer[i] * this.coefficients[i];
    }
    
    return filtered / this.normFactor;
  }

  reset(): void {
    this.buffer = new Array(this.windowSize).fill(0);
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
  }
  return out;
}
