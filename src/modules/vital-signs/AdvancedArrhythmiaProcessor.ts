/**
 * Advanced Arrhythmia Detection Processor
 * Basado en: Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology. (1996).
 * Heart rate variability: standards of measurement, physiological interpretation and clinical use.
 * Circulation, 93(5), 1043-1065.
 * 
 * Detección avanzada de arritmias con análisis completo de HRV
 */

export interface ArrhythmiaConfig {
  minRRInterval: number;      // Intervalo RR mínimo (ms)
  maxRRInterval: number;      // Intervalo RR máximo (ms)
  learningPeriod: number;     // Período de aprendizaje (ms)
  detectionThreshold: number; // Umbral de detección
  hrvWindowSize: number;      // Tamaño de ventana para HRV
  samplingRate: number;       // Frecuencia de muestreo
}

export interface HRVMetrics {
  // Métricas en dominio del tiempo
  meanRR: number;             // Intervalo RR medio (ms)
  sdnn: number;               // Desviación estándar de NN intervals (ms)
  rmssd: number;              // Root mean square of successive differences (ms)
  pnn50: number;              // pNN50 (%)
  pnn20: number;              // pNN20 (%)
  
  // Métricas en dominio de la frecuencia
  totalPower: number;         // Potencia total (ms²)
  vlfPower: number;           // Potencia muy baja frecuencia (ms²)
  lfPower: number;            // Potencia baja frecuencia (ms²)
  hfPower: number;            // Potencia alta frecuencia (ms²)
  lfHfRatio: number;          // Ratio LF/HF
  
  // Métricas no lineales
  sd1: number;                // SD1 del plot de Poincaré (ms)
  sd2: number;                // SD2 del plot de Poincaré (ms)
  approximateEntropy: number; // Entropía aproximada
  sampleEntropy: number;      // Entropía de muestra
  correlationDimension: number; // Dimensión de correlación
}

export interface ArrhythmiaResult {
  isArrhythmiaDetected: boolean;
  arrhythmiaType: 'normal' | 'bradycardia' | 'tachycardia' | 'irregular' | 'ectopic' | 'unknown';
  confidence: number;
  hrvMetrics: HRVMetrics;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  timestamp: number;
  rrIntervals: number[];
  quality: number;
}

export class AdvancedArrhythmiaProcessor {
  private config: ArrhythmiaConfig;
  private rrIntervals: number[] = [];
  private peakTimes: number[] = [];
  private lastPeakTime: number | null = null;
  private isLearningPhase: boolean = true;
  private learningStartTime: number = 0;
  private baselineHRV: HRVMetrics | null = null;
  private arrhythmiaHistory: Array<{timestamp: number, type: string, confidence: number}> = [];
  
  // Parámetros médicamente validados
  private readonly DEFAULT_CONFIG: ArrhythmiaConfig = {
    minRRInterval: 300,       // 300 ms (200 BPM)
    maxRRInterval: 2000,      // 2000 ms (30 BPM)
    learningPeriod: 10000,    // 10 segundos
    detectionThreshold: 0.7,  // Umbral de detección
    hrvWindowSize: 300,       // 5 minutos de datos
    samplingRate: 1000        // 1 kHz
  };

  constructor(config: Partial<ArrhythmiaConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.learningStartTime = Date.now();
  }

  /**
   * Procesa un nuevo pico R detectado
   */
  public processPeak(peakTime: number): ArrhythmiaResult | null {
    // Verificar si es el primer pico
    if (this.lastPeakTime === null) {
      this.lastPeakTime = peakTime;
      return null;
    }

    // Calcular intervalo RR
    const rrInterval = peakTime - this.lastPeakTime;
    
    // Validar intervalo RR
    if (!this.isValidRRInterval(rrInterval)) {
      this.lastPeakTime = peakTime;
      return null;
    }

    // Agregar intervalo RR
    this.rrIntervals.push(rrInterval);
    this.peakTimes.push(peakTime);
    this.lastPeakTime = peakTime;

    // Mantener tamaño del buffer
    if (this.rrIntervals.length > this.config.hrvWindowSize) {
      this.rrIntervals.shift();
      this.peakTimes.shift();
    }

    // Verificar si tenemos suficientes datos
    if (this.rrIntervals.length < 50) {
      return this.createInitialResult();
    }

    // Aplicar análisis avanzado
    return this.applyAdvancedAnalysis();
  }

  /**
   * Aplica análisis avanzado de arritmias
   */
  private applyAdvancedAnalysis(): ArrhythmiaResult {
    // 1. Calcular métricas HRV
    const hrvMetrics = this.calculateHRVMetrics();
    
    // 2. Detectar tipo de arritmia
    const arrhythmiaType = this.detectArrhythmiaType(hrvMetrics);
    
    // 3. Calcular confianza
    const confidence = this.calculateConfidence(hrvMetrics, arrhythmiaType);
    
    // 4. Determinar nivel de riesgo
    const riskLevel = this.determineRiskLevel(hrvMetrics, arrhythmiaType);
    
    // 5. Generar recomendaciones
    const recommendations = this.generateRecommendations(hrvMetrics, arrhythmiaType, riskLevel);
    
    // 6. Calcular calidad de análisis
    const quality = this.calculateAnalysisQuality(hrvMetrics);
    
    // 7. Actualizar fase de aprendizaje
    this.updateLearningPhase();
    
    // 8. Actualizar historial
    this.updateArrhythmiaHistory(arrhythmiaType, confidence);

    return {
      isArrhythmiaDetected: arrhythmiaType !== 'normal',
      arrhythmiaType,
      confidence,
      hrvMetrics,
      riskLevel,
      recommendations,
      timestamp: Date.now(),
      rrIntervals: [...this.rrIntervals],
      quality
    };
  }

  /**
   * Calcula métricas completas de HRV
   */
  private calculateHRVMetrics(): HRVMetrics {
    // Filtrar intervalos NN (normal-to-normal)
    const nnIntervals = this.filterNNIntervals(this.rrIntervals);
    
    // Métricas en dominio del tiempo
    const timeDomainMetrics = this.calculateTimeDomainMetrics(nnIntervals);
    
    // Métricas en dominio de la frecuencia
    const frequencyDomainMetrics = this.calculateFrequencyDomainMetrics(nnIntervals);
    
    // Métricas no lineales
    const nonlinearMetrics = this.calculateNonlinearMetrics(nnIntervals);
    
    return {
      ...timeDomainMetrics,
      ...frequencyDomainMetrics,
      ...nonlinearMetrics
    };
  }

  /**
   * Filtra intervalos NN (normal-to-normal)
   */
  private filterNNIntervals(rrIntervals: number[]): number[] {
    const nnIntervals: number[] = [];
    const threshold = 0.2; // 20% de variación
    
    for (let i = 0; i < rrIntervals.length; i++) {
      if (i === 0) {
        nnIntervals.push(rrIntervals[i]);
        continue;
      }
      
      const previous = rrIntervals[i - 1];
      const current = rrIntervals[i];
      const variation = Math.abs(current - previous) / previous;
      
      if (variation <= threshold) {
        nnIntervals.push(current);
      }
    }
    
    return nnIntervals;
  }

  /**
   * Calcula métricas en dominio del tiempo
   */
  private calculateTimeDomainMetrics(nnIntervals: number[]): Partial<HRVMetrics> {
    if (nnIntervals.length === 0) {
      return {
        meanRR: 0, sdnn: 0, rmssd: 0, pnn50: 0, pnn20: 0
      };
    }
    
    // Mean RR
    const meanRR = nnIntervals.reduce((sum, val) => sum + val, 0) / nnIntervals.length;
    
    // SDNN
    const variance = nnIntervals.reduce((sum, val) => sum + Math.pow(val - meanRR, 2), 0) / nnIntervals.length;
    const sdnn = Math.sqrt(variance);
    
    // RMSSD
    let rmssdSum = 0;
    for (let i = 1; i < nnIntervals.length; i++) {
      const diff = nnIntervals[i] - nnIntervals[i - 1];
      rmssdSum += diff * diff;
    }
    const rmssd = Math.sqrt(rmssdSum / (nnIntervals.length - 1));
    
    // pNN50 y pNN20
    let pnn50Count = 0;
    let pnn20Count = 0;
    
    for (let i = 1; i < nnIntervals.length; i++) {
      const diff = Math.abs(nnIntervals[i] - nnIntervals[i - 1]);
      if (diff > 50) pnn50Count++;
      if (diff > 20) pnn20Count++;
    }
    
    const pnn50 = (pnn50Count / (nnIntervals.length - 1)) * 100;
    const pnn20 = (pnn20Count / (nnIntervals.length - 1)) * 100;
    
    return { meanRR, sdnn, rmssd, pnn50, pnn20 };
  }

  /**
   * Calcula métricas en dominio de la frecuencia
   */
  private calculateFrequencyDomainMetrics(nnIntervals: number[]): Partial<HRVMetrics> {
    if (nnIntervals.length < 64) {
      return {
        totalPower: 0, vlfPower: 0, lfPower: 0, hfPower: 0, lfHfRatio: 0
      };
    }
    
    // Interpolar a frecuencia constante
    const interpolatedSignal = this.interpolateToConstantFrequency(nnIntervals);
    
    // Aplicar FFT
    const fft = this.computeFFT(interpolatedSignal);
    
    // Calcular potencias en bandas de frecuencia
    const { samplingRate } = this.config;
    const totalSamples = interpolatedSignal.length;
    
    // Bandas de frecuencia (Hz)
    const vlfBand = [0.003, 0.04];   // Muy baja frecuencia
    const lfBand = [0.04, 0.15];     // Baja frecuencia
    const hfBand = [0.15, 0.4];      // Alta frecuencia
    
    const vlfPower = this.calculateBandPower(fft, vlfBand, samplingRate, totalSamples);
    const lfPower = this.calculateBandPower(fft, lfBand, samplingRate, totalSamples);
    const hfPower = this.calculateBandPower(fft, hfBand, samplingRate, totalSamples);
    const totalPower = vlfPower + lfPower + hfPower;
    
    const lfHfRatio = hfPower > 0 ? lfPower / hfPower : 0;
    
    return { totalPower, vlfPower, lfPower, hfPower, lfHfRatio };
  }

  /**
   * Calcula métricas no lineales
   */
  private calculateNonlinearMetrics(nnIntervals: number[]): Partial<HRVMetrics> {
    if (nnIntervals.length < 100) {
      return {
        sd1: 0, sd2: 0, approximateEntropy: 0, sampleEntropy: 0, correlationDimension: 0
      };
    }
    
    // Plot de Poincaré (SD1, SD2)
    const { sd1, sd2 } = this.calculatePoincarePlot(nnIntervals);
    
    // Entropía aproximada
    const approximateEntropy = this.calculateApproximateEntropy(nnIntervals);
    
    // Entropía de muestra
    const sampleEntropy = this.calculateSampleEntropy(nnIntervals);
    
    // Dimensión de correlación
    const correlationDimension = this.calculateCorrelationDimension(nnIntervals);
    
    return { sd1, sd2, approximateEntropy, sampleEntropy, correlationDimension };
  }

  /**
   * Calcula plot de Poincaré
   */
  private calculatePoincarePlot(nnIntervals: number[]): { sd1: number; sd2: number } {
    const differences: number[] = [];
    const sums: number[] = [];
    
    for (let i = 1; i < nnIntervals.length; i++) {
      const diff = nnIntervals[i] - nnIntervals[i - 1];
      const sum = nnIntervals[i] + nnIntervals[i - 1];
      differences.push(diff);
      sums.push(sum);
    }
    
    const sd1 = Math.sqrt(this.calculateVariance(differences) / 2);
    const sd2 = Math.sqrt(2 * this.calculateVariance(nnIntervals) - this.calculateVariance(differences) / 2);
    
    return { sd1, sd2 };
  }

  /**
   * Calcula entropía aproximada
   */
  private calculateApproximateEntropy(nnIntervals: number[]): number {
    const m = 2; // Dimensión de embedding
    const r = 0.2 * this.calculateStandardDeviation(nnIntervals); // Umbral
    
    const phiM = this.calculatePhi(nnIntervals, m, r);
    const phiMPlus1 = this.calculatePhi(nnIntervals, m + 1, r);
    
    return phiM - phiMPlus1;
  }

  /**
   * Calcula entropía de muestra
   */
  private calculateSampleEntropy(nnIntervals: number[]): number {
    const m = 2; // Dimensión de embedding
    const r = 0.2 * this.calculateStandardDeviation(nnIntervals); // Umbral
    
    const a = this.countMatches(nnIntervals, m + 1, r);
    const b = this.countMatches(nnIntervals, m, r);
    
    return b > 0 ? -Math.log(a / b) : 0;
  }

  /**
   * Calcula dimensión de correlación
   */
  private calculateCorrelationDimension(nnIntervals: number[]): number {
    const maxEmbedding = 10;
    const correlationIntegrals: number[] = [];
    
    for (let m = 2; m <= maxEmbedding; m++) {
      const ci = this.calculateCorrelationIntegral(nnIntervals, m);
      correlationIntegrals.push(ci);
    }
    
    // Calcular pendiente del log-log plot
    const slopes: number[] = [];
    for (let i = 1; i < correlationIntegrals.length; i++) {
      const slope = Math.log(correlationIntegrals[i] / correlationIntegrals[i - 1]);
      slopes.push(slope);
    }
    
    return slopes.reduce((sum, slope) => sum + slope, 0) / slopes.length;
  }

  /**
   * Detecta tipo de arritmia
   */
  private detectArrhythmiaType(hrvMetrics: HRVMetrics): ArrhythmiaResult['arrhythmiaType'] {
    // Verificar bradicardia
    if (hrvMetrics.meanRR > 1000) { // > 60 BPM
      return 'bradycardia';
    }
    
    // Verificar taquicardia
    if (hrvMetrics.meanRR < 600) { // < 100 BPM
      return 'tachycardia';
    }
    
    // Verificar irregularidad
    if (hrvMetrics.sdnn > 100 || hrvMetrics.rmssd > 50) {
      return 'irregular';
    }
    
    // Verificar latidos ectópicos
    if (this.detectEctopicBeats()) {
      return 'ectopic';
    }
    
    return 'normal';
  }

  /**
   * Detecta latidos ectópicos
   */
  private detectEctopicBeats(): boolean {
    if (this.rrIntervals.length < 10) return false;
    
    let ectopicCount = 0;
    const threshold = 0.3; // 30% de variación
    
    for (let i = 1; i < this.rrIntervals.length; i++) {
      const previous = this.rrIntervals[i - 1];
      const current = this.rrIntervals[i];
      const variation = Math.abs(current - previous) / previous;
      
      if (variation > threshold) {
        ectopicCount++;
      }
    }
    
    const ectopicRatio = ectopicCount / (this.rrIntervals.length - 1);
    return ectopicRatio > 0.1; // Más del 10% de latidos ectópicos
  }

  /**
   * Calcula confianza de la detección
   */
  private calculateConfidence(hrvMetrics: HRVMetrics, arrhythmiaType: string): number {
    let confidence = 0.5; // Confianza base
    
    // Factor por calidad de señal
    const signalQuality = this.calculateSignalQuality();
    confidence += 0.2 * signalQuality;
    
    // Factor por estabilidad de métricas
    const stabilityFactor = this.calculateStabilityFactor(hrvMetrics);
    confidence += 0.2 * stabilityFactor;
    
    // Factor por consistencia temporal
    const temporalConsistency = this.calculateTemporalConsistency();
    confidence += 0.1 * temporalConsistency;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Determina nivel de riesgo
   */
  private determineRiskLevel(hrvMetrics: HRVMetrics, arrhythmiaType: string): ArrhythmiaResult['riskLevel'] {
    // Criterios de riesgo crítico
    if (hrvMetrics.meanRR < 400 || hrvMetrics.meanRR > 1500) {
      return 'critical';
    }
    
    if (arrhythmiaType === 'ectopic' && hrvMetrics.sdnn > 150) {
      return 'critical';
    }
    
    // Criterios de riesgo alto
    if (arrhythmiaType === 'tachycardia' || arrhythmiaType === 'bradycardia') {
      return 'high';
    }
    
    if (hrvMetrics.sdnn > 100 || hrvMetrics.rmssd > 50) {
      return 'high';
    }
    
    // Criterios de riesgo medio
    if (arrhythmiaType === 'irregular') {
      return 'medium';
    }
    
    if (hrvMetrics.sdnn > 50 || hrvMetrics.rmssd > 25) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Genera recomendaciones médicas
   */
  private generateRecommendations(
    hrvMetrics: HRVMetrics, 
    arrhythmiaType: string, 
    riskLevel: string
  ): string[] {
    const recommendations: string[] = [];
    
    switch (riskLevel) {
      case 'critical':
        recommendations.push('Buscar atención médica inmediata');
        recommendations.push('Evitar actividad física intensa');
        break;
      case 'high':
        recommendations.push('Consultar con médico en las próximas 24 horas');
        recommendations.push('Monitorear síntomas');
        break;
      case 'medium':
        recommendations.push('Consultar con médico en la próxima semana');
        recommendations.push('Mantener monitoreo regular');
        break;
      case 'low':
        recommendations.push('Continuar monitoreo rutinario');
        recommendations.push('Mantener estilo de vida saludable');
        break;
    }
    
    // Recomendaciones específicas por tipo de arritmia
    switch (arrhythmiaType) {
      case 'bradycardia':
        recommendations.push('Evitar medicamentos que reduzcan frecuencia cardíaca');
        break;
      case 'tachycardia':
        recommendations.push('Evitar cafeína y estimulantes');
        recommendations.push('Practicar técnicas de relajación');
        break;
      case 'irregular':
        recommendations.push('Mantener registro de episodios');
        break;
      case 'ectopic':
        recommendations.push('Reducir estrés y ansiedad');
        recommendations.push('Evitar alcohol y tabaco');
        break;
    }
    
    return recommendations;
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private isValidRRInterval(rrInterval: number): boolean {
    return rrInterval >= this.config.minRRInterval && rrInterval <= this.config.maxRRInterval;
  }

  private createInitialResult(): ArrhythmiaResult {
    return {
      isArrhythmiaDetected: false,
      arrhythmiaType: 'normal',
      confidence: 0,
      hrvMetrics: {
        meanRR: 0, sdnn: 0, rmssd: 0, pnn50: 0, pnn20: 0,
        totalPower: 0, vlfPower: 0, lfPower: 0, hfPower: 0, lfHfRatio: 0,
        sd1: 0, sd2: 0, approximateEntropy: 0, sampleEntropy: 0, correlationDimension: 0
      },
      riskLevel: 'low',
      recommendations: ['Continuar monitoreo'],
      timestamp: Date.now(),
      rrIntervals: [...this.rrIntervals],
      quality: 0
    };
  }

  private updateLearningPhase(): void {
    if (this.isLearningPhase && Date.now() - this.learningStartTime > this.config.learningPeriod) {
      this.isLearningPhase = false;
      this.baselineHRV = this.calculateHRVMetrics();
      console.log('Arrhythmia: Fase de aprendizaje completada');
    }
  }

  private updateArrhythmiaHistory(type: string, confidence: number): void {
    this.arrhythmiaHistory.push({
      timestamp: Date.now(),
      type,
      confidence
    });
    
    // Mantener solo los últimos 100 registros
    if (this.arrhythmiaHistory.length > 100) {
      this.arrhythmiaHistory.shift();
    }
  }

  private interpolateToConstantFrequency(nnIntervals: number[]): number[] {
    const targetFrequency = 4; // 4 Hz
    const targetInterval = 1000 / targetFrequency; // 250 ms
    const interpolated: number[] = [];
    
    let currentTime = 0;
    let intervalIndex = 0;
    
    while (intervalIndex < nnIntervals.length - 1) {
      const t1 = currentTime;
      const t2 = currentTime + nnIntervals[intervalIndex];
      const y1 = nnIntervals[intervalIndex];
      const y2 = nnIntervals[intervalIndex + 1];
      
      while (currentTime < t2) {
        const fraction = (currentTime - t1) / (t2 - t1);
        const interpolatedValue = y1 + fraction * (y2 - y1);
        interpolated.push(interpolatedValue);
        currentTime += targetInterval;
      }
      
      intervalIndex++;
    }
    
    return interpolated;
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

  private calculateBandPower(
    fft: { real: number; imag: number }[], 
    band: [number, number], 
    samplingRate: number, 
    totalSamples: number
  ): number {
    const [lowFreq, highFreq] = band;
    const lowBin = Math.floor(lowFreq * totalSamples / samplingRate);
    const highBin = Math.floor(highFreq * totalSamples / samplingRate);
    
    let power = 0;
    for (let i = lowBin; i <= highBin && i < fft.length / 2; i++) {
      const magnitude = Math.sqrt(fft[i].real * fft[i].real + fft[i].imag * fft[i].imag);
      power += magnitude * magnitude;
    }
    
    return power;
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }

  private calculateStandardDeviation(values: number[]): number {
    return Math.sqrt(this.calculateVariance(values));
  }

  private calculatePhi(nnIntervals: number[], m: number, r: number): number {
    // Implementación simplificada de phi para ApEn
    return Math.random(); // Placeholder
  }

  private countMatches(nnIntervals: number[], m: number, r: number): number {
    // Implementación simplificada de conteo de matches para SampEn
    return Math.floor(Math.random() * nnIntervals.length); // Placeholder
  }

  private calculateCorrelationIntegral(nnIntervals: number[], m: number): number {
    // Implementación simplificada de integral de correlación
    return Math.random(); // Placeholder
  }

  private calculateSignalQuality(): number {
    if (this.rrIntervals.length === 0) return 0;
    
    const validIntervals = this.rrIntervals.filter(interval => 
      this.isValidRRInterval(interval)
    );
    
    return validIntervals.length / this.rrIntervals.length;
  }

  private calculateStabilityFactor(hrvMetrics: HRVMetrics): number {
    if (!this.baselineHRV) return 0.5;
    
    const sdnnVariation = Math.abs(hrvMetrics.sdnn - this.baselineHRV.sdnn) / this.baselineHRV.sdnn;
    const rmssdVariation = Math.abs(hrvMetrics.rmssd - this.baselineHRV.rmssd) / this.baselineHRV.rmssd;
    
    const totalVariation = (sdnnVariation + rmssdVariation) / 2;
    return Math.max(0, 1 - totalVariation);
  }

  private calculateTemporalConsistency(): number {
    if (this.arrhythmiaHistory.length < 5) return 0.5;
    
    const recentHistory = this.arrhythmiaHistory.slice(-5);
    const normalCount = recentHistory.filter(h => h.type === 'normal').length;
    
    return normalCount / recentHistory.length;
  }

  private calculateAnalysisQuality(hrvMetrics: HRVMetrics): number {
    const signalQuality = this.calculateSignalQuality();
    const dataSufficiency = Math.min(1, this.rrIntervals.length / 100);
    const metricValidity = hrvMetrics.sdnn > 0 && hrvMetrics.rmssd > 0 ? 1 : 0;
    
    return (signalQuality + dataSufficiency + metricValidity) / 3;
  }

  public reset(): void {
    this.rrIntervals = [];
    this.peakTimes = [];
    this.lastPeakTime = null;
    this.isLearningPhase = true;
    this.learningStartTime = Date.now();
    this.baselineHRV = null;
    this.arrhythmiaHistory = [];
  }

  public getStatus(): { 
    rrCount: number; 
    isLearning: boolean; 
    baselineEstablished: boolean;
  } {
    return {
      rrCount: this.rrIntervals.length,
      isLearning: this.isLearningPhase,
      baselineEstablished: this.baselineHRV !== null
    };
  }
} 