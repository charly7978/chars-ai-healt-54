
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
    if (validData.length < 64) return;
    
    // 1. Exponente de Lyapunov (medida de sensibilidad a condiciones iniciales)
    this.lyapunovExponent = this.calculateLyapunovExponent(validData);
    
    // 2. Dimensión de correlación (complejidad del atractor)
    this.correlationDimension = this.calculateCorrelationDimension(validData);
    
    // 3. Análisis de fluctuación sin tendencia (DFA)
    this.detrendedFluctuation = this.calculateDFA(validData);
    
    // 4. Entropía aproximada
    this.approximateEntropy = this.calculateApproximateEntropy(validData);
    
    // 5. Entropía de muestra
    this.sampleEntropy = this.calculateSampleEntropy(validData);
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
    // Algoritmo de detección multi-criterio
    let arrhythmiaScore = 0;
    let detectionType = "NORMAL";
    
    // Criterio 1: Análisis espectral
    if (this.lfHfRatio > 4.0 || this.lfHfRatio < 0.5) {
      arrhythmiaScore += 0.3;
      detectionType = "DESEQUILIBRIO_AUTONOMICO";
    }
    
    // Criterio 2: Dinámica no lineal
    if (this.lyapunovExponent > this.CHAOS_THRESHOLDS.LYAPUNOV_EXPONENT) {
      arrhythmiaScore += 0.25;
      detectionType = "CAOTICA";
    }
    
    if (this.correlationDimension > this.CHAOS_THRESHOLDS.CORRELATION_DIMENSION) {
      arrhythmiaScore += 0.2;
    }
    
    if (this.approximateEntropy > this.CHAOS_THRESHOLDS.APPROXIMATE_ENTROPY) {
      arrhythmiaScore += 0.15;
      detectionType = "IRREGULAR";
    }
    
    if (this.sampleEntropy > this.CHAOS_THRESHOLDS.SAMPLE_ENTROPY) {
      arrhythmiaScore += 0.1;
    }
    
    // Umbral de detección adaptativo
    const detectionThreshold = 0.6;
    const detected = arrhythmiaScore >= detectionThreshold;
    
    // Actualizar estado si se detecta arritmia
    if (detected && !this.arrhythmiaDetected) {
      const currentTime = Date.now();
      if (currentTime - this.lastArrhythmiaTime > 2000) { // Mínimo 2s entre detecciones
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
    this.confidenceLevel = arrhythmiaScore;
    
    return { detected, confidence: arrhythmiaScore, type: detectionType };
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
