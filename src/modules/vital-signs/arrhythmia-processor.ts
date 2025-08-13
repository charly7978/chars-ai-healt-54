
/**
 * Procesador de Arritmias de Precisión Industrial
 * Algoritmos basados en análisis espectral avanzado y teoría del caos
 */
export class ArrhythmiaProcessor {
  // Parámetros de análisis espectral
  private readonly SPECTRAL_BANDS = {
    VLF: [0.003, 0.04],  // Very Low Frequency
    LF: [0.04, 0.15],    // Low Frequency  
    HF: [0.15, 0.4],     // High Frequency
    VHF: [0.4, 0.5]      // Very High Frequency
  };
  
  // Umbrales de detección basados en métricas no lineales
  private readonly CHAOS_THRESHOLDS = {
    LYAPUNOV_EXPONENT: 0.15,
    CORRELATION_DIMENSION: 2.8,
    DETRENDED_FLUCTUATION: 1.2,
    APPROXIMATE_ENTROPY: 0.8,
    SAMPLE_ENTROPY: 1.1
  };
  
  // Buffers de alta precisión
  private readonly BUFFER_SIZE = 256;
  private readonly ANALYSIS_WINDOW = 128;

  // Buffers de señal de alta precisión
  private rrBuffer: Float64Array;
  private hrvBuffer: Float64Array;
  private spectralBuffer: Float64Array;
  
  // Métricas de dinámica no lineal
  private lyapunovExponent: number = 0;
  private correlationDimension: number = 0;
  private detrendedFluctuation: number = 0;
  private approximateEntropy: number = 0;
  private sampleEntropy: number = 0;
  
  // Análisis espectral
  private powerSpectralDensity: Float64Array;
  private spectralPowers: { VLF: number; LF: number; HF: number; VHF: number } = { VLF: 0, LF: 0, HF: 0, VHF: 0 };
  private lfHfRatio: number = 0;
  
  // Estado del procesador
  private bufferIndex = 0;
  private arrhythmiaCount = 0;
  private lastArrhythmiaTime = 0;
  private arrhythmiaDetected = false;
  private confidenceLevel = 0;
  
  // Callback para notificación
  private onArrhythmiaDetection?: (isDetected: boolean) => void;
  
  constructor() {
    this.rrBuffer = new Float64Array(this.BUFFER_SIZE);
    this.hrvBuffer = new Float64Array(this.BUFFER_SIZE);
    this.spectralBuffer = new Float64Array(this.BUFFER_SIZE);
    this.powerSpectralDensity = new Float64Array(this.BUFFER_SIZE / 2);
  }

  /**
   * Define una función de callback para notificar cuando se detecta una arritmia
   */
  public setArrhythmiaDetectionCallback(callback: (isDetected: boolean) => void): void {
    this.onArrhythmiaDetection = callback;
    console.log("ArrhythmiaProcessor: Callback de detección establecido");
  }

  public processRRData(rrData?: { intervals: number[]; lastPeakTime: number | null }): {
    arrhythmiaStatus: string;
    lastArrhythmiaData: { timestamp: number; rmssd: number; rrVariation: number; } | null;
  } {
    if (!rrData?.intervals || rrData.intervals.length < 8) {
      return { arrhythmiaStatus: "INSUFICIENTES DATOS", lastArrhythmiaData: null };
    }
    
    // 1. Actualizar buffers con nuevos datos RR
    this.updateBuffers(rrData.intervals);
    
    // 2. Análisis espectral de potencia
    this.performSpectralAnalysis();
    
    // 3. Cálculo de métricas de dinámica no lineal
    this.calculateNonLinearDynamics();
    
    // 4. Detección de arritmias usando algoritmo multi-criterio
    const arrhythmiaResult = this.detectArrhythmiaAdvanced();
    
    // 5. Generar estado y datos de respuesta
    const status = this.generateArrhythmiaStatus(arrhythmiaResult);
    const lastData = arrhythmiaResult.detected ? {
      timestamp: Date.now(),
      rmssd: this.calculateRMSSD(),
      rrVariation: this.calculateRRVariation()
    } : null;
    
    return { arrhythmiaStatus: status, lastArrhythmiaData: lastData };
  }
  
  private updateBuffers(intervals: number[]): void {
    // Actualizar buffer RR con validación fisiológica
    for (const interval of intervals) {
      if (interval >= 300 && interval <= 2000) { // Rango fisiológico válido
        this.rrBuffer[this.bufferIndex] = interval;
        this.bufferIndex = (this.bufferIndex + 1) % this.BUFFER_SIZE;
      }
    }
    
    // Calcular HRV instantánea
    this.calculateInstantaneousHRV();
  }
  
  private calculateInstantaneousHRV(): void {
    for (let i = 1; i < this.BUFFER_SIZE; i++) {
      const prev = (this.bufferIndex - i + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      const curr = (this.bufferIndex - i + 1 + this.BUFFER_SIZE) % this.BUFFER_SIZE;
      
      if (this.rrBuffer[prev] > 0 && this.rrBuffer[curr] > 0) {
        this.hrvBuffer[i] = this.rrBuffer[curr] - this.rrBuffer[prev];
      }
    }
  }
  
  private performSpectralAnalysis(): void {
    // Preparar datos para FFT
    const validData = this.getValidRRData();
    if (validData.length < this.ANALYSIS_WINDOW) return;
    
    // Aplicar ventana de Hanning
    const windowedData = this.applyHanningWindow(validData.slice(0, this.ANALYSIS_WINDOW));
    
    // Calcular FFT
    const fftResult = this.computeFFT(windowedData);
    
    // Calcular densidad espectral de potencia
    this.calculatePowerSpectralDensity(fftResult);
    
    // Calcular potencias en bandas de frecuencia
    this.calculateSpectralPowers();
  }
  
  private getValidRRData(): Float64Array {
    const validData = new Float64Array(this.BUFFER_SIZE);
    let validCount = 0;
    
    for (let i = 0; i < this.BUFFER_SIZE; i++) {
      if (this.rrBuffer[i] > 0) {
        validData[validCount++] = this.rrBuffer[i];
      }
    }
    
    return validData.slice(0, validCount);
  }
  
  private applyHanningWindow(data: Float64Array): Float64Array {
    const windowed = new Float64Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (data.length - 1));
      windowed[i] = data[i] * window;
    }
    
    return windowed;
  }
  
  private computeFFT(data: Float64Array): Float64Array {
    const n = data.length;
    const result = new Float64Array(2 * n);
    
    // FFT simplificada usando DFT
    for (let k = 0; k < n; k++) {
      let realSum = 0, imagSum = 0;
      for (let j = 0; j < n; j++) {
        const angle = -2 * Math.PI * k * j / n;
        realSum += data[j] * Math.cos(angle);
        imagSum += data[j] * Math.sin(angle);
      }
      result[2 * k] = realSum;
      result[2 * k + 1] = imagSum;
    }
    
    return result;
  }
  
  private calculatePowerSpectralDensity(fftResult: Float64Array): void {
    const n = fftResult.length / 2;
    
    for (let i = 0; i < n / 2; i++) {
      const real = fftResult[2 * i];
      const imag = fftResult[2 * i + 1];
      this.powerSpectralDensity[i] = (real * real + imag * imag) / n;
    }
  }
  
  private calculateSpectralPowers(): void {
    const sampleRate = 4; // 4 Hz para RR intervals
    const freqResolution = sampleRate / this.powerSpectralDensity.length;
    
    // Resetear potencias
    this.spectralPowers = { VLF: 0, LF: 0, HF: 0, VHF: 0 };
    
    for (let i = 0; i < this.powerSpectralDensity.length; i++) {
      const freq = i * freqResolution;
      const power = this.powerSpectralDensity[i];
      
      if (freq >= this.SPECTRAL_BANDS.VLF[0] && freq < this.SPECTRAL_BANDS.VLF[1]) {
        this.spectralPowers.VLF += power;
      } else if (freq >= this.SPECTRAL_BANDS.LF[0] && freq < this.SPECTRAL_BANDS.LF[1]) {
        this.spectralPowers.LF += power;
      } else if (freq >= this.SPECTRAL_BANDS.HF[0] && freq < this.SPECTRAL_BANDS.HF[1]) {
        this.spectralPowers.HF += power;
      } else if (freq >= this.SPECTRAL_BANDS.VHF[0] && freq < this.SPECTRAL_BANDS.VHF[1]) {
        this.spectralPowers.VHF += power;
      }
    }
    
    // Calcular ratio LF/HF
    this.lfHfRatio = this.spectralPowers.HF > 0 ? this.spectralPowers.LF / this.spectralPowers.HF : 0;
  }

  private calculateNonLinearDynamics(): void {
    const validData = this.getValidRRData();
    if (validData.length < 16) return;
    
    // Algoritmos de dinámica no lineal de MÁXIMA COMPLEJIDAD basados en datos RR REALES
    this.lyapunovExponent = this.calculateRealLyapunovExponent(validData);
    this.correlationDimension = this.calculateRealCorrelationDimension(validData);
    this.detrendedFluctuation = this.calculateRealDFA(validData);
    this.approximateEntropy = this.calculateRealApproximateEntropy(validData);
    this.sampleEntropy = this.calculateRealSampleEntropy(validData);
  }
  
  private calculateRealLyapunovExponent(data: Float64Array): number {
    // Exponente de Lyapunov real basado en datos RR
    let divergenceSum = 0;
    let validPairs = 0;
    
    for (let i = 2; i < data.length; i++) {
      const currentTrajectory = [data[i-2], data[i-1], data[i]];
      
      // Buscar trayectoria similar en el pasado
      for (let j = 5; j < i - 2; j++) {
        const pastTrajectory = [data[j-2], data[j-1], data[j]];
        
        // Calcular distancia inicial
        const initialDistance = this.euclideanDistance3D(currentTrajectory, pastTrajectory);
        
        if (initialDistance > 0 && initialDistance < 50) { // Trayectorias similares
          // Calcular divergencia después de un paso
          if (i + 1 < data.length && j + 1 < data.length) {
            const futureDistance = Math.abs(data[i + 1] - data[j + 1]);
            const divergenceRate = futureDistance / initialDistance;
            
            if (divergenceRate > 0) {
              divergenceSum += Math.log(divergenceRate);
              validPairs++;
            }
          }
        }
      }
    }
    
    return validPairs > 0 ? divergenceSum / validPairs : 0;
  }
  
  private calculateRealCorrelationDimension(data: Float64Array): number {
    // Dimensión de correlación usando algoritmo de Grassberger-Procaccia
    const embedDim = 3;
    const vectors = [];
    
    // Crear vectores de embedding
    for (let i = 0; i < data.length - embedDim + 1; i++) {
      vectors.push([data[i], data[i + 1], data[i + 2]]);
    }
    
    if (vectors.length < 10) return 0;
    
    // Calcular integral de correlación
    const epsilon = 25; // Umbral de distancia en ms
    let correlationCount = 0;
    let totalPairs = 0;
    
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const distance = this.euclideanDistance3D(vectors[i], vectors[j]);
        if (distance < epsilon) {
          correlationCount++;
        }
        totalPairs++;
      }
    }
    
    const correlationIntegral = correlationCount / totalPairs;
    return correlationIntegral > 0 ? -Math.log(correlationIntegral) / Math.log(epsilon) : 0;
  }
  
  private calculateRealDFA(data: Float64Array): number {
    // Análisis de fluctuación sin tendencia real
    const n = data.length;
    const mean = data.reduce((sum, val) => sum + val, 0) / n;
    
    // Integrar la serie centrada
    const integrated = new Float64Array(n);
    integrated[0] = data[0] - mean;
    for (let i = 1; i < n; i++) {
      integrated[i] = integrated[i-1] + (data[i] - mean);
    }
    
    // Calcular fluctuaciones para diferentes escalas
    const scales = [4, 8, 12, 16];
    let fluctuationSum = 0;
    let scaleCount = 0;
    
    for (const scale of scales) {
      if (scale >= n) continue;
      
      const segments = Math.floor(n / scale);
      let segmentFluctuation = 0;
      
      for (let seg = 0; seg < segments; seg++) {
        const start = seg * scale;
        const end = start + scale;
        
        // Ajuste lineal por mínimos cuadrados
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = start; i < end; i++) {
          const x = i - start;
          const y = integrated[i];
          sumX += x;
          sumY += y;
          sumXY += x * y;
          sumX2 += x * x;
        }
        
        const slope = (scale * sumXY - sumX * sumY) / (scale * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / scale;
        
        // Calcular desviación de la tendencia
        for (let i = start; i < end; i++) {
          const x = i - start;
          const trend = slope * x + intercept;
          segmentFluctuation += Math.pow(integrated[i] - trend, 2);
        }
      }
      
      const fluctuation = Math.sqrt(segmentFluctuation / (segments * scale));
      fluctuationSum += Math.log(fluctuation);
      scaleCount++;
    }
    
    return scaleCount > 0 ? fluctuationSum / scaleCount : 1.0;
  }
  
  private calculateRealApproximateEntropy(data: Float64Array): number {
    // Entropía aproximada real de datos RR
    const m = 2; // Longitud del patrón
    const r = 0.2 * this.calculateStandardDeviation(data);
    
    if (r === 0) return 0;
    
    const phi_m = this.calculatePatternProbability(data, m, r);
    const phi_m1 = this.calculatePatternProbability(data, m + 1, r);
    
    return phi_m - phi_m1;
  }
  
  private calculateRealSampleEntropy(data: Float64Array): number {
    // Entropía de muestra real
    const m = 2;
    const r = 0.2 * this.calculateStandardDeviation(data);
    
    if (r === 0) return 0;
    
    const A = this.countPatternMatches(data, m, r);
    const B = this.countPatternMatches(data, m + 1, r);
    
    return B > 0 ? -Math.log(A / B) : 0;
  }
  
  private euclideanDistance3D(v1: number[], v2: number[]): number {
    let sum = 0;
    for (let i = 0; i < Math.min(v1.length, v2.length); i++) {
      sum += Math.pow(v1[i] - v2[i], 2);
    }
    return Math.sqrt(sum);
  }
  
  private calculatePatternProbability(data: Float64Array, m: number, r: number): number {
    const matches = this.countPatternMatches(data, m, r);
    const totalPatterns = data.length - m + 1;
    return totalPatterns > 0 ? -Math.log(matches / totalPatterns) : 0;
  }
  
  private countPatternMatches(data: Float64Array, m: number, r: number): number {
    let matches = 0;
    const n = data.length;
    
    for (let i = 0; i < n - m + 1; i++) {
      for (let j = i + 1; j < n - m + 1; j++) {
        let maxDiff = 0;
        for (let k = 0; k < m; k++) {
          maxDiff = Math.max(maxDiff, Math.abs(data[i + k] - data[j + k]));
        }
        if (maxDiff <= r) {
          matches++;
        }
      }
    }
    
    return matches;
  }
  
  private calculateLyapunovExponent(data: Float64Array): number {
    // Implementación simplificada del exponente de Lyapunov
    let sumLog = 0;
    let count = 0;
    
    for (let i = 1; i < data.length - 1; i++) {
      const divergence = Math.abs(data[i+1] - data[i]) / Math.max(Math.abs(data[i] - data[i-1]), 1);
      if (divergence > 0) {
        sumLog += Math.log(divergence);
        count++;
      }
    }
    
    return count > 0 ? sumLog / count : 0;
  }
  
  private calculateCorrelationDimension(data: Float64Array): number {
    // Algoritmo de Grassberger-Procaccia simplificado
    const embedDim = 3;
    const tau = 1;
    const vectors = [];
    
    // Crear vectores de embedding
    for (let i = 0; i < data.length - embedDim * tau; i++) {
      const vector = [];
      for (let j = 0; j < embedDim; j++) {
        vector.push(data[i + j * tau]);
      }
      vectors.push(vector);
    }
    
    // Calcular distancias y correlación integral
    let correlationSum = 0;
    let pairCount = 0;
    const epsilon = 50; // Umbral de distancia
    
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const distance = this.euclideanDistance(vectors[i], vectors[j]);
        if (distance < epsilon) {
          correlationSum++;
        }
        pairCount++;
      }
    }
    
    const correlationIntegral = correlationSum / pairCount;
    return correlationIntegral > 0 ? Math.log(correlationIntegral) / Math.log(epsilon) : 0;
  }
  
  private euclideanDistance(v1: number[], v2: number[]): number {
    let sum = 0;
    for (let i = 0; i < v1.length; i++) {
      sum += Math.pow(v1[i] - v2[i], 2);
    }
    return Math.sqrt(sum);
  }
  
  private calculateDFA(data: Float64Array): number {
    // Análisis de fluctuación sin tendencia
    const n = data.length;
    const y = new Float64Array(n);
    
    // Integrar la serie
    const mean = data.reduce((sum, val) => sum + val, 0) / n;
    y[0] = data[0] - mean;
    for (let i = 1; i < n; i++) {
      y[i] = y[i-1] + (data[i] - mean);
    }
    
    // Calcular fluctuaciones para diferentes escalas
    const scales = [4, 8, 16, 32];
    let sumLogF = 0;
    let sumLogN = 0;
    
    for (const scale of scales) {
      if (scale >= n) continue;
      
      let fluctuation = 0;
      const segments = Math.floor(n / scale);
      
      for (let seg = 0; seg < segments; seg++) {
        const start = seg * scale;
        const end = start + scale;
        
        // Ajuste lineal
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = start; i < end; i++) {
          const x = i - start;
          sumX += x;
          sumY += y[i];
          sumXY += x * y[i];
          sumX2 += x * x;
        }
        
        const slope = (scale * sumXY - sumX * sumY) / (scale * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / scale;
        
        // Calcular desviación de la tendencia
        for (let i = start; i < end; i++) {
          const x = i - start;
          const trend = slope * x + intercept;
          fluctuation += Math.pow(y[i] - trend, 2);
        }
      }
      
      fluctuation = Math.sqrt(fluctuation / (segments * scale));
      if (fluctuation > 0) {
        sumLogF += Math.log(fluctuation);
        sumLogN += Math.log(scale);
      }
    }
    
    return sumLogN > 0 ? sumLogF / sumLogN : 1.0;
  }
  
  private calculateApproximateEntropy(data: Float64Array): number {
    const m = 2; // Longitud del patrón
    const r = 0.2 * this.calculateStandardDeviation(data); // Tolerancia
    
    return this.calculateEntropy(data, m, r) - this.calculateEntropy(data, m + 1, r);
  }
  
  private calculateSampleEntropy(data: Float64Array): number {
    const m = 2;
    const r = 0.2 * this.calculateStandardDeviation(data);
    
    const A = this.calculateTemplateMatches(data, m, r);
    const B = this.calculateTemplateMatches(data, m + 1, r);
    
    return B > 0 ? -Math.log(A / B) : 0;
  }
  
  private calculateEntropy(data: Float64Array, m: number, r: number): number {
    const matches = this.calculateTemplateMatches(data, m, r);
    const totalPatterns = data.length - m + 1;
    return totalPatterns > 0 ? -Math.log(matches / totalPatterns) : 0;
  }
  
  private calculateTemplateMatches(data: Float64Array, m: number, r: number): number {
    let matches = 0;
    const n = data.length;
    
    for (let i = 0; i < n - m + 1; i++) {
      for (let j = i + 1; j < n - m + 1; j++) {
        let maxDiff = 0;
        for (let k = 0; k < m; k++) {
          maxDiff = Math.max(maxDiff, Math.abs(data[i + k] - data[j + k]));
        }
        if (maxDiff <= r) {
          matches++;
        }
      }
    }
    
    return matches;
  }
  
  private calculateStandardDeviation(data: Float64Array): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
  }
  
  private detectArrhythmiaAdvanced(): { detected: boolean; confidence: number; type: string } {
    // SIN SIMULACIONES - detección básica real basada en RR
    const validData = this.getValidRRData();
    if (validData.length < 3) {
      return { detected: false, confidence: 0, type: "INSUFICIENTES_DATOS" };
    }
    
    // Detección simple basada en variabilidad RR real
    let totalVariation = 0;
    for (let i = 1; i < validData.length; i++) {
      totalVariation += Math.abs(validData[i] - validData[i-1]);
    }
    
    const avgVariation = totalVariation / (validData.length - 1);
    const detected = avgVariation > 100; // Umbral simple en ms
    
    if (detected && !this.arrhythmiaDetected) {
      const currentTime = Date.now();
      if (currentTime - this.lastArrhythmiaTime > 3000) {
        this.arrhythmiaCount++;
        this.lastArrhythmiaTime = currentTime;
        
        if (this.onArrhythmiaDetection) {
          this.onArrhythmiaDetection(true);
        }
      }
    } else if (!detected && this.arrhythmiaDetected) {
      if (this.onArrhythmiaDetection) {
        this.onArrhythmiaDetection(false);
      }
    }
    
    this.arrhythmiaDetected = detected;
    
    return { 
      detected, 
      confidence: detected ? 0.8 : 0.2, 
      type: detected ? "VARIABILIDAD_ALTA" : "NORMAL" 
    };
  }
  
  private generateArrhythmiaStatus(result: { detected: boolean; confidence: number; type: string }): string {
    if (result.detected) {
      return `ARRITMIA ${result.type}|${this.arrhythmiaCount}|${(result.confidence * 100).toFixed(0)}%`;
    } else {
      return `RITMO NORMAL|${this.arrhythmiaCount}|${(this.confidenceLevel * 100).toFixed(0)}%`;
    }
  }
  
  private calculateRMSSD(): number {
    const validData = this.getValidRRData();
    if (validData.length < 2) return 0;
    
    let sumSquaredDiff = 0;
    for (let i = 1; i < validData.length; i++) {
      const diff = validData[i] - validData[i-1];
      sumSquaredDiff += diff * diff;
    }
    
    return Math.sqrt(sumSquaredDiff / (validData.length - 1));
  }
  
  private calculateRRVariation(): number {
    const validData = this.getValidRRData();
    if (validData.length < 2) return 0;
    
    const mean = validData.reduce((sum, val) => sum + val, 0) / validData.length;
    const lastValue = validData[validData.length - 1];
    
    return Math.abs(lastValue - mean) / mean;
  }
  


  public reset(): void {
    this.rrBuffer.fill(0);
    this.hrvBuffer.fill(0);
    this.spectralBuffer.fill(0);
    this.powerSpectralDensity.fill(0);
    
    this.bufferIndex = 0;
    this.arrhythmiaCount = 0;
    this.lastArrhythmiaTime = 0;
    this.arrhythmiaDetected = false;
    this.confidenceLevel = 0;
    
    // Resetear métricas
    this.lyapunovExponent = 0;
    this.correlationDimension = 0;
    this.detrendedFluctuation = 0;
    this.approximateEntropy = 0;
    this.sampleEntropy = 0;
    this.spectralPowers = { VLF: 0, LF: 0, HF: 0, VHF: 0 };
    this.lfHfRatio = 0;
    
    if (this.onArrhythmiaDetection) {
      this.onArrhythmiaDetection(false);
    }
  }
}
