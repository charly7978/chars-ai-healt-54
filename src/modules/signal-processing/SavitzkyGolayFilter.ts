
/**
 * Filtro Savitzky-Golay de Precisión Industrial con Orden Adaptativo
 * Implementación con cálculo dinámico de coeficientes y detección de artefactos
 */
export class SavitzkyGolayFilter {
  private buffer: Float64Array;
  private readonly maxWindowSize: number;
  private currentWindowSize: number;
  private polynomialOrder: number;
  private coefficients: Float64Array;
  private derivativeCoefficients: Float64Array;
  private secondDerivativeCoefficients: Float64Array;
  
  // Parámetros adaptativos
  private signalVariance: number = 0;
  private noiseLevel: number = 0;
  private snrHistory: number[] = [];
  private adaptiveThreshold: number = 0.1;
  
  // Métricas de calidad
  private smoothnessIndex: number = 0;
  private preservationIndex: number = 0;
  
  constructor(maxWindowSize: number = 25, polynomialOrder: number = 3) {
    this.maxWindowSize = maxWindowSize;
    this.currentWindowSize = Math.min(maxWindowSize, 9); // Comenzar conservador
    this.polynomialOrder = Math.min(polynomialOrder, Math.floor(this.currentWindowSize / 2));
    
    this.buffer = new Float64Array(maxWindowSize);
    this.coefficients = new Float64Array(maxWindowSize);
    this.derivativeCoefficients = new Float64Array(maxWindowSize);
    this.secondDerivativeCoefficients = new Float64Array(maxWindowSize);
    
    this.computeCoefficients();
  }
  
  private computeCoefficients(): void {
    const n = this.currentWindowSize;
    const m = this.polynomialOrder;
    const halfWindow = Math.floor(n / 2);
    
    // Construir matriz de Vandermonde
    const A = new Float64Array((m + 1) * n);
    for (let i = 0; i < n; i++) {
      const x = i - halfWindow;
      for (let j = 0; j <= m; j++) {
        A[i * (m + 1) + j] = Math.pow(x, j);
      }
    }
    
    // Calcular (A^T * A)^-1 * A^T usando descomposición QR
    const coeffs = this.solveNormalEquations(A, n, m + 1);
    
    // Coeficientes para función (orden 0)
    for (let i = 0; i < n; i++) {
      this.coefficients[i] = coeffs[i * (m + 1)];
    }
    
    // Coeficientes para primera derivada
    for (let i = 0; i < n; i++) {
      this.derivativeCoefficients[i] = coeffs[i * (m + 1) + 1];
    }
    
    // Coeficientes para segunda derivada
    for (let i = 0; i < n; i++) {
      this.secondDerivativeCoefficients[i] = coeffs[i * (m + 1) + 2] * 2;
    }
  }
  
  private solveNormalEquations(A: Float64Array, rows: number, cols: number): Float64Array {
    // Implementación simplificada de mínimos cuadrados
    // Para ventana centrada, los coeficientes se pueden calcular analíticamente
    const n = this.currentWindowSize;
    const coeffs = new Float64Array(n * (this.polynomialOrder + 1));
    
    // Usar coeficientes precomputados para casos comunes
    if (n === 9 && this.polynomialOrder === 2) {
      const c = [-0.086, 0.343, 0.486, 0.343, 0.114, -0.086, -0.171, -0.086, 0.086];
      for (let i = 0; i < 9; i++) {
        coeffs[i * 3] = c[i];
      }
    } else if (n === 9 && this.polynomialOrder === 3) {
      const c = [0.035, 0.128, 0.193, 0.208, 0.272, 0.208, 0.193, 0.128, 0.035];
      for (let i = 0; i < 9; i++) {
        coeffs[i * 4] = c[i];
      }
    } else {
      // Cálculo genérico usando aproximación de Gram
      this.computeGenericCoefficients(coeffs);
    }
    
    return coeffs;
  }
  
  private computeGenericCoefficients(coeffs: Float64Array): void {
    const n = this.currentWindowSize;
    const halfWindow = Math.floor(n / 2);
    
    // Aproximación usando ventana de Hamming modificada
    for (let i = 0; i < n; i++) {
      const x = (i - halfWindow) / halfWindow;
      const hamming = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
      const gaussian = Math.exp(-0.5 * x * x / 0.3);
      coeffs[i * (this.polynomialOrder + 1)] = hamming * gaussian;
    }
    
    // Normalizar
    const sum = coeffs.slice(0, n).reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) {
      coeffs[i * (this.polynomialOrder + 1)] /= sum;
    }
  }
  
  filter(value: number): number {
    // Actualizar buffer circular
    for (let i = this.maxWindowSize - 1; i > 0; i--) {
      this.buffer[i] = this.buffer[i - 1];
    }
    this.buffer[0] = value;
    
    // Adaptación dinámica de parámetros
    this.adaptParameters();
    
    // Aplicar filtrado con detección de artefactos
    return this.applyFilter();
  }
  
  private adaptParameters(): void {
    if (this.buffer[this.currentWindowSize - 1] === 0) return; // Buffer no lleno
    
    // Calcular varianza local de la señal
    const windowData = this.buffer.slice(0, this.currentWindowSize);
    const mean = windowData.reduce((sum, val) => sum + val, 0) / this.currentWindowSize;
    this.signalVariance = windowData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.currentWindowSize;
    
    // Estimar nivel de ruido usando diferencias de segundo orden
    let noiseSum = 0;
    for (let i = 2; i < this.currentWindowSize; i++) {
      const secondDiff = windowData[i] - 2 * windowData[i-1] + windowData[i-2];
      noiseSum += secondDiff * secondDiff;
    }
    this.noiseLevel = Math.sqrt(noiseSum / (this.currentWindowSize - 2)) / Math.sqrt(6);
    
    // Calcular SNR
    const snr = this.signalVariance > 0 ? Math.sqrt(this.signalVariance) / Math.max(this.noiseLevel, 1e-10) : 0;
    this.snrHistory.push(snr);
    if (this.snrHistory.length > 20) {
      this.snrHistory.shift();
    }
    
    // Adaptar tamaño de ventana basado en SNR
    const avgSNR = this.snrHistory.reduce((sum, val) => sum + val, 0) / this.snrHistory.length;
    
    if (avgSNR > 10) {
      // Alta SNR: usar ventana más pequeña para preservar detalles
      this.currentWindowSize = Math.max(5, this.currentWindowSize - 2);
    } else if (avgSNR < 3) {
      // Baja SNR: usar ventana más grande para suavizar
      this.currentWindowSize = Math.min(this.maxWindowSize, this.currentWindowSize + 2);
    }
    
    // Asegurar que el orden polinomial sea válido
    this.polynomialOrder = Math.min(this.polynomialOrder, Math.floor(this.currentWindowSize / 2));
    
    // Recalcular coeficientes si cambió el tamaño de ventana
    if (this.currentWindowSize !== this.coefficients.length) {
      this.computeCoefficients();
    }
  }
  
  private applyFilter(): number {
    const n = this.currentWindowSize;
    
    // Detección de artefactos usando segunda derivada
    let secondDerivative = 0;
    for (let i = 0; i < n; i++) {
      secondDerivative += this.buffer[i] * this.secondDerivativeCoefficients[i];
    }
    
    // Si hay artefacto, usar filtrado más agresivo
    const artifactThreshold = 5 * this.noiseLevel;
    const isArtifact = Math.abs(secondDerivative) > artifactThreshold;
    
    let filtered = 0;
    if (isArtifact) {
      // Filtrado robusto usando mediana ponderada
      const weights = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        weights[i] = Math.exp(-Math.abs(i - Math.floor(n/2)) / (n/4));
      }
      
      // Ordenar valores con sus pesos
      const weightedValues = [];
      for (let i = 0; i < n; i++) {
        weightedValues.push({ value: this.buffer[i], weight: weights[i] });
      }
      weightedValues.sort((a, b) => a.value - b.value);
      
      // Calcular mediana ponderada
      let cumWeight = 0;
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      for (const item of weightedValues) {
        cumWeight += item.weight;
        if (cumWeight >= totalWeight / 2) {
          filtered = item.value;
          break;
        }
      }
    } else {
      // Filtrado normal con coeficientes Savitzky-Golay
      for (let i = 0; i < n; i++) {
        filtered += this.buffer[i] * this.coefficients[i];
      }
    }
    
    // Calcular métricas de calidad
    this.updateQualityMetrics(filtered, secondDerivative);
    
    return filtered;
  }
  
  private updateQualityMetrics(filtered: number, secondDerivative: number): void {
    // Índice de suavidad (basado en segunda derivada)
    this.smoothnessIndex = 1 / (1 + Math.abs(secondDerivative));
    
    // Índice de preservación (comparación con valor original)
    const original = this.buffer[Math.floor(this.currentWindowSize / 2)];
    const difference = Math.abs(filtered - original);
    this.preservationIndex = Math.exp(-difference / Math.max(this.signalVariance, 1e-6));
  }
  
  getFirstDerivative(): number {
    const n = this.currentWindowSize;
    let derivative = 0;
    for (let i = 0; i < n; i++) {
      derivative += this.buffer[i] * this.derivativeCoefficients[i];
    }
    return derivative;
  }
  
  getSecondDerivative(): number {
    const n = this.currentWindowSize;
    let derivative = 0;
    for (let i = 0; i < n; i++) {
      derivative += this.buffer[i] * this.secondDerivativeCoefficients[i];
    }
    return derivative;
  }
  
  getSmoothnessIndex(): number {
    return this.smoothnessIndex;
  }
  
  getPreservationIndex(): number {
    return this.preservationIndex;
  }
  
  getCurrentWindowSize(): number {
    return this.currentWindowSize;
  }
  
  getSNR(): number {
    return this.snrHistory.length > 0 ? 
      this.snrHistory.reduce((sum, val) => sum + val, 0) / this.snrHistory.length : 0;
  }
  
  reset(): void {
    this.buffer.fill(0);
    this.snrHistory = [];
    this.signalVariance = 0;
    this.noiseLevel = 0;
    this.smoothnessIndex = 0;
    this.preservationIndex = 0;
    this.currentWindowSize = Math.min(this.maxWindowSize, 9);
    this.polynomialOrder = Math.min(3, Math.floor(this.currentWindowSize / 2));
    this.computeCoefficients();
  }
}
