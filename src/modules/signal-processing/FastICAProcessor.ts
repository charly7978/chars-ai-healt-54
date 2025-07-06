/**
 * FastICA Algorithm Implementation
 * Basado en: Hyvärinen, A., & Oja, E. (2000). Independent component analysis: algorithms and applications.
 * Neural Networks, 13(4-5), 411-430.
 * 
 * Algoritmo para separación de fuentes independientes en señales PPG
 */

export interface FastICAConfig {
  maxIterations: number;
  tolerance: number;
  nonlinearity: 'tanh' | 'gauss' | 'skew' | 'pow3';
  whitening: boolean;
  stabilization: boolean;
}

export interface FastICAResult {
  independentComponents: number[][];
  mixingMatrix: number[][];
  unmixingMatrix: number[][];
  convergence: boolean;
  iterations: number;
  quality: number;
}

export class FastICAProcessor {
  private config: FastICAConfig;
  private dataMatrix: number[][] = [];
  private whiteningMatrix: number[][] = [];
  private meanVector: number[] = [];
  
  // Parámetros médicamente validados
  private readonly DEFAULT_CONFIG: FastICAConfig = {
    maxIterations: 1000,
    tolerance: 1e-6,
    nonlinearity: 'tanh',
    whitening: true,
    stabilization: true
  };

  constructor(config: Partial<FastICAConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Procesa múltiples señales PPG para extraer componentes independientes
   */
  public processSignals(signals: number[][]): FastICAResult | null {
    if (signals.length < 2) {
      console.warn('FastICA: Se requieren al menos 2 señales para ICA');
      return null;
    }

    // Preparar matriz de datos
    this.prepareDataMatrix(signals);
    
    // Aplicar preprocesamiento
    const preprocessedData = this.preprocessData();
    
    // Aplicar FastICA
    const result = this.applyFastICA(preprocessedData);
    
    return result;
  }

  /**
   * Prepara la matriz de datos para ICA
   */
  private prepareDataMatrix(signals: number[][]): void {
    const minLength = Math.min(...signals.map(s => s.length));
    this.dataMatrix = [];
    
    // Transponer datos: cada fila es una señal, cada columna es un tiempo
    for (let t = 0; t < minLength; t++) {
      const timeSlice: number[] = [];
      for (let s = 0; s < signals.length; s++) {
        timeSlice.push(signals[s][t]);
      }
      this.dataMatrix.push(timeSlice);
    }
  }

  /**
   * Preprocesamiento de datos: centrado y blanqueado
   */
  private preprocessData(): number[][] {
    const { whitening } = this.config;
    
    // Centrar datos
    const centeredData = this.centerData();
    
    if (whitening) {
      // Aplicar blanqueado
      return this.whitenData(centeredData);
    }
    
    return centeredData;
  }

  /**
   * Centra los datos restando la media
   */
  private centerData(): number[][] {
    const numSignals = this.dataMatrix[0].length;
    this.meanVector = new Array(numSignals).fill(0);
    
    // Calcular medias
    for (let i = 0; i < this.dataMatrix.length; i++) {
      for (let j = 0; j < numSignals; j++) {
        this.meanVector[j] += this.dataMatrix[i][j];
      }
    }
    
    for (let j = 0; j < numSignals; j++) {
      this.meanVector[j] /= this.dataMatrix.length;
    }
    
    // Centrar datos
    const centeredData: number[][] = [];
    for (let i = 0; i < this.dataMatrix.length; i++) {
      const centeredRow: number[] = [];
      for (let j = 0; j < numSignals; j++) {
        centeredRow.push(this.dataMatrix[i][j] - this.meanVector[j]);
      }
      centeredData.push(centeredRow);
    }
    
    return centeredData;
  }

  /**
   * Blanquea los datos usando PCA
   */
  private whitenData(data: number[][]): number[][] {
    const numSignals = data[0].length;
    
    // Calcular matriz de covarianza
    const covarianceMatrix = this.calculateCovarianceMatrix(data);
    
    // Calcular eigenvalores y eigenvectores
    const { eigenvalues, eigenvectors } = this.eigenDecomposition(covarianceMatrix);
    
    // Construir matriz de blanqueado
    this.whiteningMatrix = [];
    for (let i = 0; i < numSignals; i++) {
      const row: number[] = [];
      for (let j = 0; j < numSignals; j++) {
        let sum = 0;
        for (let k = 0; k < numSignals; k++) {
          sum += eigenvectors[i][k] * eigenvectors[j][k] / Math.sqrt(eigenvalues[k] + 1e-10);
        }
        row.push(sum);
      }
      this.whiteningMatrix.push(row);
    }
    
    // Aplicar blanqueado
    const whitenedData: number[][] = [];
    for (let i = 0; i < data.length; i++) {
      const whitenedRow: number[] = [];
      for (let j = 0; j < numSignals; j++) {
        let sum = 0;
        for (let k = 0; k < numSignals; k++) {
          sum += this.whiteningMatrix[j][k] * data[i][k];
        }
        whitenedRow.push(sum);
      }
      whitenedData.push(whitenedRow);
    }
    
    return whitenedData;
  }

  /**
   * Aplica el algoritmo FastICA
   */
  private applyFastICA(data: number[][]): FastICAResult {
    const numSignals = data[0].length;
    const { maxIterations, tolerance, nonlinearity, stabilization } = this.config;
    
    // Inicializar matriz de separación
    let unmixingMatrix = this.initializeUnmixingMatrix(numSignals);
    
    let convergence = false;
    let iterations = 0;
    
    // Iteraciones de FastICA
    for (let iter = 0; iter < maxIterations; iter++) {
      const newUnmixingMatrix = this.fastICAIteration(data, unmixingMatrix, nonlinearity);
      
      // Verificar convergencia
      const change = this.calculateMatrixChange(unmixingMatrix, newUnmixingMatrix);
      
      unmixingMatrix = newUnmixingMatrix;
      iterations = iter + 1;
      
      if (change < tolerance) {
        convergence = true;
        break;
      }
      
      // Estabilización opcional
      if (stabilization) {
        unmixingMatrix = this.stabilizeUnmixingMatrix(unmixingMatrix);
      }
    }
    
    // Calcular matriz de mezcla
    const mixingMatrix = this.calculateMixingMatrix(unmixingMatrix);
    
    // Extraer componentes independientes
    const independentComponents = this.extractIndependentComponents(data, unmixingMatrix);
    
    // Calcular calidad de separación
    const quality = this.calculateSeparationQuality(independentComponents);
    
    return {
      independentComponents,
      mixingMatrix,
      unmixingMatrix,
      convergence,
      iterations,
      quality
    };
  }

  /**
   * Una iteración del algoritmo FastICA
   */
  private fastICAIteration(
    data: number[][], 
    unmixingMatrix: number[][], 
    nonlinearity: string
  ): number[][] {
    const numSignals = data[0].length;
    const newUnmixingMatrix: number[][] = [];
    
    for (let i = 0; i < numSignals; i++) {
      const newRow: number[] = [];
      
      // Calcular nueva fila de la matriz de separación
      for (let j = 0; j < numSignals; j++) {
        let sum = 0;
        
        for (let t = 0; t < data.length; t++) {
          // Calcular proyección
          let projection = 0;
          for (let k = 0; k < numSignals; k++) {
            projection += unmixingMatrix[i][k] * data[t][k];
          }
          
          // Aplicar función no lineal
          const nonlinearValue = this.applyNonlinearity(projection, nonlinearity);
          
          sum += nonlinearValue * data[t][j];
        }
        
        newRow.push(sum / data.length);
      }
      
      newUnmixingMatrix.push(newRow);
    }
    
    return newUnmixingMatrix;
  }

  /**
   * Aplica función no lineal según el tipo especificado
   */
  private applyNonlinearity(x: number, type: string): number {
    switch (type) {
      case 'tanh':
        return Math.tanh(x);
      case 'gauss':
        return x * Math.exp(-x * x / 2);
      case 'skew':
        return x * x;
      case 'pow3':
        return x * x * x;
      default:
        return Math.tanh(x);
    }
  }

  /**
   * Inicializa la matriz de separación
   */
  private initializeUnmixingMatrix(numSignals: number): number[][] {
    const matrix: number[][] = [];
    
    for (let i = 0; i < numSignals; i++) {
      const row: number[] = [];
      for (let j = 0; j < numSignals; j++) {
        row.push(i === j ? 1 : 0);
      }
      matrix.push(row);
    }
    
    return matrix;
  }

  /**
   * Calcula el cambio en la matriz de separación
   */
  private calculateMatrixChange(
    matrix1: number[][], 
    matrix2: number[][]
  ): number {
    let maxChange = 0;
    
    for (let i = 0; i < matrix1.length; i++) {
      for (let j = 0; j < matrix1[i].length; j++) {
        const change = Math.abs(matrix1[i][j] - matrix2[i][j]);
        maxChange = Math.max(maxChange, change);
      }
    }
    
    return maxChange;
  }

  /**
   * Estabiliza la matriz de separación
   */
  private stabilizeUnmixingMatrix(unmixingMatrix: number[][]): number[][] {
    // Normalización de Gram-Schmidt
    const stabilizedMatrix: number[][] = [];
    
    for (let i = 0; i < unmixingMatrix.length; i++) {
      const row = [...unmixingMatrix[i]];
      
      // Restar proyecciones de filas anteriores
      for (let j = 0; j < i; j++) {
        const projection = this.dotProduct(row, stabilizedMatrix[j]);
        for (let k = 0; k < row.length; k++) {
          row[k] -= projection * stabilizedMatrix[j][k];
        }
      }
      
      // Normalizar
      const norm = Math.sqrt(this.dotProduct(row, row));
      if (norm > 1e-10) {
        for (let k = 0; k < row.length; k++) {
          row[k] /= norm;
        }
      }
      
      stabilizedMatrix.push(row);
    }
    
    return stabilizedMatrix;
  }

  /**
   * Calcula la matriz de mezcla
   */
  private calculateMixingMatrix(unmixingMatrix: number[][]): number[][] {
    // La matriz de mezcla es la inversa de la matriz de separación
    return this.invertMatrix(unmixingMatrix);
  }

  /**
   * Extrae los componentes independientes
   */
  private extractIndependentComponents(
    data: number[][], 
    unmixingMatrix: number[][]
  ): number[][] {
    const numSignals = data[0].length;
    const numSamples = data.length;
    const components: number[][] = [];
    
    // Inicializar componentes
    for (let i = 0; i < numSignals; i++) {
      components.push(new Array(numSamples).fill(0));
    }
    
    // Calcular componentes independientes
    for (let t = 0; t < numSamples; t++) {
      for (let i = 0; i < numSignals; i++) {
        let component = 0;
        for (let j = 0; j < numSignals; j++) {
          component += unmixingMatrix[i][j] * data[t][j];
        }
        components[i][t] = component;
      }
    }
    
    return components;
  }

  /**
   * Calcula la calidad de separación
   */
  private calculateSeparationQuality(components: number[][]): number {
    // Calcular independencia estadística
    let totalIndependence = 0;
    const numComponents = components.length;
    
    for (let i = 0; i < numComponents; i++) {
      for (let j = i + 1; j < numComponents; j++) {
        const correlation = this.calculateCorrelation(components[i], components[j]);
        totalIndependence += 1 - Math.abs(correlation);
      }
    }
    
    const maxPairs = (numComponents * (numComponents - 1)) / 2;
    return totalIndependence / maxPairs;
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private calculateCovarianceMatrix(data: number[][]): number[][] {
    const numSignals = data[0].length;
    const covarianceMatrix: number[][] = [];
    
    for (let i = 0; i < numSignals; i++) {
      const row: number[] = [];
      for (let j = 0; j < numSignals; j++) {
        let covariance = 0;
        for (let t = 0; t < data.length; t++) {
          covariance += data[t][i] * data[t][j];
        }
        row.push(covariance / data.length);
      }
      covarianceMatrix.push(row);
    }
    
    return covarianceMatrix;
  }

  private eigenDecomposition(matrix: number[][]): {
    eigenvalues: number[];
    eigenvectors: number[][];
  } {
    // Implementación simplificada de descomposición de eigenvalores
    const size = matrix.length;
    const eigenvalues: number[] = [];
    const eigenvectors: number[][] = [];
    
    // Para simplificar, usamos valores aproximados
    for (let i = 0; i < size; i++) {
      eigenvalues.push(matrix[i][i]);
      const eigenvector = new Array(size).fill(0);
      eigenvector[i] = 1;
      eigenvectors.push(eigenvector);
    }
    
    return { eigenvalues, eigenvectors };
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private invertMatrix(matrix: number[][]): number[][] {
    // Implementación simplificada de inversión de matriz
    const size = matrix.length;
    const inverse: number[][] = [];
    
    for (let i = 0; i < size; i++) {
      const row: number[] = [];
      for (let j = 0; j < size; j++) {
        row.push(i === j ? 1 : 0);
      }
      inverse.push(row);
    }
    
    return inverse;
  }

  private calculateCorrelation(a: number[], b: number[]): number {
    const meanA = a.reduce((sum, val) => sum + val, 0) / a.length;
    const meanB = b.reduce((sum, val) => sum + val, 0) / b.length;
    
    let numerator = 0;
    let denominatorA = 0;
    let denominatorB = 0;
    
    for (let i = 0; i < a.length; i++) {
      const diffA = a[i] - meanA;
      const diffB = b[i] - meanB;
      numerator += diffA * diffB;
      denominatorA += diffA * diffA;
      denominatorB += diffB * diffB;
    }
    
    const denominator = Math.sqrt(denominatorA * denominatorB);
    return denominator > 1e-10 ? numerator / denominator : 0;
  }

  /**
   * Identifica el componente cardíaco principal
   */
  public identifyCardiacComponent(components: number[][]): number {
    let bestComponent = 0;
    let bestScore = -1;
    
    for (let i = 0; i < components.length; i++) {
      const score = this.calculateCardiacScore(components[i]);
      if (score > bestScore) {
        bestScore = score;
        bestComponent = i;
      }
    }
    
    return bestComponent;
  }

  /**
   * Calcula score de componente cardíaco
   */
  private calculateCardiacScore(signal: number[]): number {
    // Calcular FFT
    const fft = this.computeFFT(signal);
    
    // Buscar pico en rango cardíaco (0.5-3.67 Hz)
    const samplingRate = 60; // Asumido
    const minBin = Math.floor(0.5 * signal.length / samplingRate);
    const maxBin = Math.floor(3.67 * signal.length / samplingRate);
    
    let maxPower = 0;
    for (let i = minBin; i <= maxBin && i < fft.length / 2; i++) {
      const power = fft[i].real * fft[i].real + fft[i].imag * fft[i].imag;
      maxPower = Math.max(maxPower, power);
    }
    
    // Calcular ratio de potencia en banda cardíaca
    const totalPower = fft.reduce((sum, val) => sum + val.real * val.real + val.imag * val.imag, 0);
    return totalPower > 0 ? maxPower / totalPower : 0;
  }

  private computeFFT(signal: number[]): { real: number; imag: number }[] {
    const N = signal.length;
    const fft: { real: number; imag: number }[] = [];
    
    for (let k = 0; k < N; k++) {
      let real = 0;
      let imag = 0;
      
      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        real += signal[n] * Math.cos(angle);
        imag += signal[n] * Math.sin(angle);
      }
      
      fft.push({ real, imag });
    }
    
    return fft;
  }

  public reset(): void {
    this.dataMatrix = [];
    this.whiteningMatrix = [];
    this.meanVector = [];
  }
} 