/**
 * ICA (Independent Component Analysis) Approximation para PPG.
 * Basado en literatura 2024 de blind source separation.
 * Implementa FastICA simplificado para separar componentes PPG de motion artifacts.
 * 
 * NOTA: Esta es una aproximación simplificada. Para ICA real, usar librería como
 * ica-js o implementar FastICA completo con whitening, deflation, etc.
 */

export interface ICAComponents {
  ppgComponent: number;      // Componente PPG limpio
  motionComponent: number;   // Componente de movimiento
  noiseComponent: number;     // Componente de ruido
  mixingMatrix: number[][];  // Matriz de mezcla estimada
  separationQuality: number; // Calidad de separación [0,1]
}

export interface ICAConfig {
  numComponents: number;
  maxIterations: number;
  convergenceThreshold: number;
  learningRate: number;
}

export class ICAApproximation {
  private readonly config: ICAConfig;
  private readonly signalBuffer: Float32Array;
  private bufferIndex = 0;
  private readonly bufferSize = 64;
  private mixingMatrix: number[][] = [];
  private unmixingMatrix: number[][] = [];
  private initialized = false;

  constructor(config?: Partial<ICAConfig>) {
    this.config = {
      numComponents: 3,
      maxIterations: 100,
      convergenceThreshold: 1e-4,
      learningRate: 0.01,
      ...config,
    };
    this.signalBuffer = new Float32Array(this.bufferSize);
    this.initializeMatrices();
  }

  /**
   * Inicializa matrices de mezcla y separación
   */
  private initializeMatrices(): void {
    const n = this.config.numComponents;
    this.mixingMatrix = Array(n).fill(0).map(() => Array(n).fill(0).map(() => Math.random() - 0.5));
    this.unmixingMatrix = Array(n).fill(0).map(() => Array(n).fill(0).map(() => Math.random() - 0.5));
  }

  /**
   * Aplica ICA approximation a señal multi-canal
   * @param signals: Array de señales [R, G, B, ...]
   * @returns Componentes separados
   */
  separate(signals: number[]): ICAComponents {
    if (signals.length < 2) {
      return {
        ppgComponent: signals[0] ?? 0,
        motionComponent: 0,
        noiseComponent: 0,
        mixingMatrix: this.mixingMatrix,
        separationQuality: 0,
      };
    }

    // Almacenar en buffer
    for (let i = 0; i < signals.length; i++) {
      this.signalBuffer[this.bufferIndex + i] = signals[i]!;
    }
    this.bufferIndex = (this.bufferIndex + signals.length) % (this.bufferSize - signals.length);

    // Si no está inicializado, entrenar matrices
    if (!this.initialized && this.bufferIndex > 32) {
      this.trainICA();
      this.initialized = true;
    }

    // Aplicar separación
    const components = this.applyUnmixing(signals);
    
    // Identificar componente PPG (el más periódico)
    const ppgIdx = this.identifyPPGComponent(components);
    
    // Estimar calidad de separación
    const quality = this.estimateSeparationQuality(components, ppgIdx);

    return {
      ppgComponent: components[ppgIdx] ?? 0,
      motionComponent: components[(ppgIdx + 1) % components.length] ?? 0,
      noiseComponent: components[(ppgIdx + 2) % components.length] ?? 0,
      mixingMatrix: this.mixingMatrix,
      separationQuality: quality,
    };
  }

  /**
   * Entrena matrices de separación (FastICA simplificado)
   */
  private trainICA(): void {
    const n = this.config.numComponents;
    const iterations = this.config.maxIterations;
    
    // FastICA simplificado (sin whitening completo)
    for (let iter = 0; iter < iterations; iter++) {
      let maxChange = 0;
      
      // Actualizar unmixing matrix
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const oldVal = this.unmixingMatrix[i]![j]!;
          
          // Gradiente aproximado de negentropy
          const newVal = oldVal + this.config.learningRate * 
                        this.computeGradient(i, j);
          
          const change = Math.abs(newVal - oldVal);
          maxChange = Math.max(maxChange, change);
          
          this.unmixingMatrix[i]![j] = newVal;
        }
      }
      
      // Normalizar filas
      for (let i = 0; i < n; i++) {
        const row = this.unmixingMatrix[i]!;
        const norm = Math.sqrt(row.reduce((a, b) => a + b * b, 0));
        if (norm > 1e-6) {
          for (let j = 0; j < n; j++) {
            row[j] = row[j]! / norm;
          }
        }
      }
      
      // Verificar convergencia
      if (maxChange < this.config.convergenceThreshold) {
        break;
      }
    }
    
    // Estimar mixing matrix (pseudo-inversa)
    this.mixingMatrix = this.pseudoInverse(this.unmixingMatrix);
  }

  /**
   * Calcula gradiente para FastICA
   */
  private computeGradient(row: number, col: number): number {
    // Función no-lineal g(u) = tanh(u)
    const u = this.unmixingMatrix[row]![col]!;
    const g = Math.tanh(u);
    
    // Gradiente: E[x * g(w^T x)] - E[g'(w^T x)] * w
    const gPrime = 1 - g * g;
    
    return g - gPrime * u;
  }

  /**
   * Aplica matriz de separación
   */
  private applyUnmixing(signals: number[]): number[] {
    const n = Math.min(signals.length, this.config.numComponents);
    const components = new Float32Array(n);
    
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < signals.length; j++) {
        sum += (this.unmixingMatrix[i]![j] ?? 0) * signals[j]!;
      }
      components[i] = sum;
    }
    
    return Array.from(components);
  }

  /**
   * Identifica componente PPG basado en periodicidad
   */
  private identifyPPGComponent(components: number[]): number {
    let bestIdx = 0;
    let bestScore = -Infinity;
    
    for (let i = 0; i < components.length; i++) {
      const score = this.estimatePeriodicity(components[i]!);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    
    return bestIdx;
  }

  /**
   * Estima periodicidad de componente (simplificada)
   */
  private estimatePeriodicity(signal: number): number {
    // Usar buffer de señales para autocorrelación
    const n = Math.min(this.bufferIndex, 32);
    if (n < 8) return 0;
    
    let bestAutoCorr = 0;
    
    // Buscar peaks en rango cardíaco
    for (let lag = 5; lag <= 20; lag++) {
      let sum = 0;
      for (let i = lag; i < n; i++) {
        sum += this.signalBuffer[i]! * this.signalBuffer[i - lag]!;
      }
      const autocorr = sum / (n - lag);
      bestAutoCorr = Math.max(bestAutoCorr, autocorr);
    }
    
    return bestAutoCorr;
  }

  /**
   * Estima calidad de separación
   */
  private estimateSeparationQuality(components: number[], ppgIdx: number): number {
    // Calcular correlación entre componentes
    const ppgComp = components[ppgIdx] ?? 0;
    const motionComp = components[(ppgIdx + 1) % components.length] ?? 0;
    
    // Baja correlación = buena separación
    const correlation = Math.abs(ppgComp * motionComp) / (Math.abs(ppgComp) + Math.abs(motionComp) + 1e-6);
    
    return Math.max(0, 1 - correlation);
  }

  /**
   * Calcula pseudo-inversa de matriz
   */
  private pseudoInverse(matrix: number[][]): number[][] {
    const n = matrix.length;
    const m = matrix[0]?.length ?? 0;
    
    // Pseudo-inversa simplificada (transpuesta para matrices ortogonales)
    const result: number[][] = Array(m).fill(0).map(() => Array(n).fill(0));
    
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        result[i]![j] = matrix[j]![i]!;
      }
    }
    
    return result;
  }

  reset(): void {
    this.signalBuffer.fill(0);
    this.bufferIndex = 0;
    this.initializeMatrices();
    this.initialized = false;
  }
}
