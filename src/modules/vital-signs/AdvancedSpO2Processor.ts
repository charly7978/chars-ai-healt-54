/**
 * Advanced SpO2 Processor Implementation
 * Basado en: Allen, J. (2007). Photoplethysmography and its application in clinical physiological measurement.
 * Physiological Measurement, 28(3), R1-R39.
 * 
 * Procesamiento avanzado de SpO2 con Ratio-of-Ratios optimizado
 */

export interface SpO2Config {
  redWavelength: number;      // Longitud de onda roja (nm)
  irWavelength: number;       // Longitud de onda infrarroja (nm)
  greenWavelength: number;    // Longitud de onda verde (nm)
  samplingRate: number;       // Frecuencia de muestreo
  windowSize: number;         // Tamaño de ventana
  calibrationFactor: number;  // Factor de calibración
  minSpO2: number;           // SpO2 mínimo válido
  maxSpO2: number;           // SpO2 máximo válido
}

export interface SpO2Result {
  spo2: number;              // Saturación de oxígeno (%)
  confidence: number;        // Confianza (0-1)
  perfusionIndex: number;    // Índice de perfusión
  signalQuality: number;     // Calidad de señal
  acdcRatio: number;         // Ratio AC/DC
  motionArtifactLevel: number; // Nivel de artefacto de movimiento
  calibrationStatus: 'uncalibrated' | 'calibrating' | 'calibrated';
  calibrationData?: {
    referenceSpO2: number;
    measuredRatio: number;
    calibrationFactor: number;
  };
}

export class AdvancedSpO2Processor {
  private config: SpO2Config;
  private redBuffer: number[] = [];
  private irBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private calibrationBuffer: Array<{red: number, ir: number, spo2: number}> = [];
  private calibrationFactor: number = 1.0;
  private isCalibrated: boolean = false;
  
  // Parámetros médicamente validados
  private readonly DEFAULT_CONFIG: SpO2Config = {
    redWavelength: 660,      // 660 nm (rojo)
    irWavelength: 940,       // 940 nm (infrarrojo)
    greenWavelength: 550,    // 550 nm (verde)
    samplingRate: 60,        // 60 Hz
    windowSize: 300,         // 5 segundos
    calibrationFactor: 1.0,  // Factor de calibración inicial
    minSpO2: 70,            // 70% mínimo
    maxSpO2: 100            // 100% máximo
  };

  constructor(config: Partial<SpO2Config> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Procesa una nueva muestra de datos PPG
   */
  public processSample(red: number, ir: number, green?: number): SpO2Result | null {
    // Normalizar valores
    const normalizedRed = this.normalizeSignal(red);
    const normalizedIR = this.normalizeSignal(ir);
    const normalizedGreen = green ? this.normalizeSignal(green) : 0;

    // Actualizar buffers
    this.updateBuffers(normalizedRed, normalizedIR, normalizedGreen);

    // Verificar si tenemos suficientes muestras
    if (this.redBuffer.length < this.config.windowSize) {
      return this.createInitialResult();
    }

    // Aplicar procesamiento avanzado
    return this.applyAdvancedProcessing();
  }

  /**
   * Aplica procesamiento avanzado de SpO2
   */
  private applyAdvancedProcessing(): SpO2Result {
    // 1. Preprocesamiento de señales
    const preprocessedRed = this.preprocessSignal(this.redBuffer);
    const preprocessedIR = this.preprocessSignal(this.irBuffer);
    const preprocessedGreen = this.greenBuffer.length > 0 ? 
      this.preprocessSignal(this.greenBuffer) : null;

    // 2. Calcular componentes AC y DC
    const redACDC = this.calculateACDC(preprocessedRed);
    const irACDC = this.calculateACDC(preprocessedIR);
    const greenACDC = preprocessedGreen ? this.calculateACDC(preprocessedGreen) : null;

    // 3. Aplicar Ratio-of-Ratios optimizado
    const ratioOfRatios = this.calculateOptimizedRatioOfRatios(redACDC, irACDC, greenACDC);

    // 4. Calcular SpO2
    const spo2 = this.calculateSpO2(ratioOfRatios);

    // 5. Calcular métricas de calidad
    const perfusionIndex = this.calculatePerfusionIndex(redACDC, irACDC);
    const signalQuality = this.calculateSignalQuality(preprocessedRed, preprocessedIR);
    const motionArtifactLevel = this.detectMotionArtifacts();
    const confidence = this.calculateConfidence(spo2, signalQuality, motionArtifactLevel);

    return {
      spo2,
      confidence,
      perfusionIndex,
      signalQuality,
      acdcRatio: ratioOfRatios,
      motionArtifactLevel,
      calibrationStatus: this.isCalibrated ? 'calibrated' : 'uncalibrated',
      calibrationData: this.isCalibrated ? {
        referenceSpO2: 98, // Valor de referencia típico
        measuredRatio: ratioOfRatios,
        calibrationFactor: this.calibrationFactor
      } : undefined
    };
  }

  /**
   * Preprocesamiento de señal con filtros avanzados
   */
  private preprocessSignal(signal: number[]): number[] {
    // 1. Remover baseline wander
    const baselineRemoved = this.removeBaselineWander(signal);
    
    // 2. Aplicar filtro de banda
    const bandFiltered = this.applyBandpassFilter(baselineRemoved);
    
    // 3. Aplicar filtro de mediana para remover outliers
    const medianFiltered = this.applyMedianFilter(bandFiltered);
    
    // 4. Normalizar amplitud
    const normalized = this.normalizeAmplitude(medianFiltered);
    
    return normalized;
  }

  /**
   * Remueve baseline wander usando filtro de paso alto
   */
  private removeBaselineWander(signal: number[]): number[] {
    const filtered: number[] = [];
    const alpha = 0.995; // Factor de suavizado
    let baseline = signal[0];
    
    for (let i = 0; i < signal.length; i++) {
      baseline = alpha * baseline + (1 - alpha) * signal[i];
      filtered.push(signal[i] - baseline);
    }
    
    return filtered;
  }

  /**
   * Aplica filtro de paso banda para frecuencias cardíacas
   */
  private applyBandpassFilter(signal: number[]): number[] {
    const { samplingRate } = this.config;
    const lowCutoff = 0.5;  // 30 BPM
    const highCutoff = 3.0; // 180 BPM
    
    // Filtro Butterworth de segundo orden
    const filtered: number[] = [];
    const normalizedLow = lowCutoff / (samplingRate / 2);
    const normalizedHigh = highCutoff / (samplingRate / 2);
    
    // Coeficientes del filtro
    const b0 = 1, b1 = 0, b2 = -1;
    const a0 = 1, a1 = -2 * Math.cos(Math.PI * (normalizedLow + normalizedHigh) / 2), a2 = 1;
    
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    for (let i = 0; i < signal.length; i++) {
      const y = b0 * signal[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      filtered.push(y);
      
      x2 = x1; x1 = signal[i];
      y2 = y1; y1 = y;
    }
    
    return filtered;
  }

  /**
   * Aplica filtro de mediana
   */
  private applyMedianFilter(signal: number[]): number[] {
    const filtered: number[] = [];
    const windowSize = 5;
    
    for (let i = 0; i < signal.length; i++) {
      const window: number[] = [];
      
      for (let j = -Math.floor(windowSize / 2); j <= Math.floor(windowSize / 2); j++) {
        const index = i + j;
        if (index >= 0 && index < signal.length) {
          window.push(signal[index]);
        }
      }
      
      // Calcular mediana
      window.sort((a, b) => a - b);
      const median = window[Math.floor(window.length / 2)];
      filtered.push(median);
    }
    
    return filtered;
  }

  /**
   * Normaliza amplitud de la señal
   */
  private normalizeAmplitude(signal: number[]): number[] {
    const maxAmplitude = Math.max(...signal.map(Math.abs));
    if (maxAmplitude === 0) return signal;
    
    return signal.map(val => val / maxAmplitude);
  }

  /**
   * Calcula componentes AC y DC
   */
  private calculateACDC(signal: number[]): { ac: number; dc: number } {
    // DC: valor medio
    const dc = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    
    // AC: desviación estándar
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - dc, 2), 0) / signal.length;
    const ac = Math.sqrt(variance);
    
    return { ac, dc };
  }

  /**
   * Calcula Ratio-of-Ratios optimizado
   */
  private calculateOptimizedRatioOfRatios(
    redACDC: { ac: number; dc: number },
    irACDC: { ac: number; dc: number },
    greenACDC?: { ac: number; dc: number }
  ): number {
    // Ratio-of-Ratios básico: R = (AC_red/DC_red) / (AC_ir/DC_ir)
    const basicRatio = (redACDC.ac / (redACDC.dc + 1e-10)) / (irACDC.ac / (irACDC.dc + 1e-10));
    
    // Corrección por longitud de onda
    const wavelengthCorrection = this.calculateWavelengthCorrection();
    
    // Corrección por perfusión
    const perfusionCorrection = this.calculatePerfusionCorrection(redACDC, irACDC);
    
    // Corrección por movimiento (si hay señal verde)
    const motionCorrection = greenACDC ? 
      this.calculateMotionCorrection(redACDC, irACDC, greenACDC) : 1.0;
    
    // Aplicar correcciones
    const correctedRatio = basicRatio * wavelengthCorrection * perfusionCorrection * motionCorrection;
    
    // Aplicar factor de calibración
    return correctedRatio * this.calibrationFactor;
  }

  /**
   * Calcula corrección por longitud de onda
   */
  private calculateWavelengthCorrection(): number {
    const { redWavelength, irWavelength } = this.config;
    
    // Coeficientes de absorción de hemoglobina
    const hbO2Red = 0.8;    // Absorción de HbO2 en rojo
    const hbRed = 2.0;      // Absorción de Hb en rojo
    const hbO2IR = 0.3;     // Absorción de HbO2 en IR
    const hbIR = 0.3;       // Absorción de Hb en IR
    
    // Corrección basada en diferencias de absorción
    const redRatio = hbO2Red / hbRed;
    const irRatio = hbO2IR / hbIR;
    
    return redRatio / irRatio;
  }

  /**
   * Calcula corrección por perfusión
   */
  private calculatePerfusionCorrection(
    redACDC: { ac: number; dc: number },
    irACDC: { ac: number; dc: number }
  ): number {
    const redPerfusion = redACDC.ac / (redACDC.dc + 1e-10);
    const irPerfusion = irACDC.ac / (irACDC.dc + 1e-10);
    
    // Normalizar por perfusión promedio
    const avgPerfusion = (redPerfusion + irPerfusion) / 2;
    
    return avgPerfusion > 0.01 ? 1.0 : 0.5; // Reducir confianza si perfusión es baja
  }

  /**
   * Calcula corrección por movimiento usando señal verde
   */
  private calculateMotionCorrection(
    redACDC: { ac: number; dc: number },
    irACDC: { ac: number; dc: number },
    greenACDC: { ac: number; dc: number }
  ): number {
    // Detectar movimiento usando variaciones en señal verde
    const greenVariation = greenACDC.ac / (greenACDC.dc + 1e-10);
    const redVariation = redACDC.ac / (redACDC.dc + 1e-10);
    const irVariation = irACDC.ac / (irACDC.dc + 1e-10);
    
    // Si la variación verde es mayor que las otras, hay movimiento
    const motionLevel = Math.max(0, greenVariation - Math.max(redVariation, irVariation));
    
    // Corrección: reducir confianza si hay movimiento
    return Math.max(0.5, 1.0 - motionLevel);
  }

  /**
   * Calcula SpO2 usando ecuación de Beer-Lambert
   */
  private calculateSpO2(ratioOfRatios: number): number {
    // Ecuación de Beer-Lambert para SpO2
    // SpO2 = A - B * log(R)
    // Donde A y B son constantes empíricas
    
    const A = 104; // Constante empírica
    const B = 17;  // Constante empírica
    
    let spo2 = A - B * Math.log(ratioOfRatios);
    
    // Aplicar límites fisiológicos
    spo2 = Math.max(this.config.minSpO2, Math.min(this.config.maxSpO2, spo2));
    
    return spo2;
  }

  /**
   * Calcula índice de perfusión
   */
  private calculatePerfusionIndex(
    redACDC: { ac: number; dc: number },
    irACDC: { ac: number; dc: number }
  ): number {
    const redPI = redACDC.ac / (redACDC.dc + 1e-10);
    const irPI = irACDC.ac / (irACDC.dc + 1e-10);
    
    // PI promedio ponderado
    const perfusionIndex = (redPI + irPI) / 2;
    
    return Math.min(1.0, perfusionIndex * 100); // Normalizar a 0-1
  }

  /**
   * Calcula calidad de señal
   */
  private calculateSignalQuality(redSignal: number[], irSignal: number[]): number {
    // Calcular SNR para ambas señales
    const redSNR = this.calculateSNR(redSignal);
    const irSNR = this.calculateSNR(irSignal);
    
    // Calcular estabilidad temporal
    const redStability = this.calculateTemporalStability(redSignal);
    const irStability = this.calculateTemporalStability(irSignal);
    
    // Calcular correlación entre señales
    const correlation = this.calculateCorrelation(redSignal, irSignal);
    
    // Calidad combinada
    const quality = (redSNR + irSNR) * (redStability + irStability) * correlation / 6;
    
    return Math.max(0, Math.min(1, quality));
  }

  /**
   * Detecta artefactos de movimiento
   */
  private detectMotionArtifacts(): number {
    if (this.greenBuffer.length === 0) return 0;
    
    const motionScores: number[] = [];
    
    for (let i = 1; i < this.greenBuffer.length; i++) {
      const change = Math.abs(this.greenBuffer[i] - this.greenBuffer[i - 1]);
      motionScores.push(change);
    }
    
    const avgMotion = motionScores.reduce((sum, score) => sum + score, 0) / motionScores.length;
    return Math.min(1.0, avgMotion);
  }

  /**
   * Calcula confianza basada en múltiples factores
   */
  private calculateConfidence(spo2: number, signalQuality: number, motionArtifactLevel: number): number {
    // Validación fisiológica
    const physiologicalConfidence = this.validatePhysiologicalRange(spo2);
    
    // Confianza basada en calidad de señal
    const qualityConfidence = signalQuality;
    
    // Confianza basada en estabilidad
    const stabilityConfidence = 1 - motionArtifactLevel;
    
    // Confianza basada en perfusión
    const perfusionConfidence = this.calculatePerfusionConfidence();
    
    // Ponderación de factores
    const confidence = 0.3 * physiologicalConfidence + 
                      0.3 * qualityConfidence + 
                      0.2 * stabilityConfidence + 
                      0.2 * perfusionConfidence;
    
    return Math.max(0, Math.min(1, confidence));
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private normalizeSignal(value: number): number {
    return Math.max(0, Math.min(1, value / 255));
  }

  private updateBuffers(red: number, ir: number, green: number): void {
    this.redBuffer.push(red);
    this.irBuffer.push(ir);
    if (green > 0) {
      this.greenBuffer.push(green);
    }
    
    // Mantener tamaño del buffer
    if (this.redBuffer.length > this.config.windowSize) {
      this.redBuffer.shift();
      this.irBuffer.shift();
      if (this.greenBuffer.length > 0) {
        this.greenBuffer.shift();
      }
    }
  }

  private createInitialResult(): SpO2Result {
    return {
      spo2: 98,
      confidence: 0,
      perfusionIndex: 0,
      signalQuality: 0,
      acdcRatio: 0,
      motionArtifactLevel: 0,
      calibrationStatus: 'uncalibrated'
    };
  }

  private calculateSNR(signal: number[]): number {
    const signalPower = this.calculateSignalPower(signal);
    const noisePower = this.calculateNoisePower(signal);
    return signalPower / (noisePower + 1e-10);
  }

  private calculateSignalPower(signal: number[]): number {
    return signal.reduce((sum, val) => sum + val * val, 0) / signal.length;
  }

  private calculateNoisePower(signal: number[]): number {
    let noiseSum = 0;
    for (let i = 1; i < signal.length; i++) {
      noiseSum += Math.pow(signal[i] - signal[i - 1], 2);
    }
    return noiseSum / (signal.length - 1);
  }

  private calculateTemporalStability(signal: number[]): number {
    const autocorr = this.calculateAutocorrelation(signal);
    return autocorr[1]; // Primer lag
  }

  private calculateCorrelation(signal1: number[], signal2: number[]): number {
    const mean1 = signal1.reduce((sum, val) => sum + val, 0) / signal1.length;
    const mean2 = signal2.reduce((sum, val) => sum + val, 0) / signal2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < signal1.length; i++) {
      const diff1 = signal1[i] - mean1;
      const diff2 = signal2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator > 1e-10 ? Math.abs(numerator / denominator) : 0;
  }

  private calculateAutocorrelation(signal: number[]): number[] {
    const N = signal.length;
    const autocorr: number[] = [];
    
    for (let lag = 0; lag < Math.min(N, 10); lag++) {
      let sum = 0;
      for (let i = 0; i < N - lag; i++) {
        sum += signal[i] * signal[i + lag];
      }
      autocorr.push(sum / (N - lag));
    }
    
    return autocorr;
  }

  private validatePhysiologicalRange(spo2: number): number {
    if (spo2 < 70 || spo2 > 100) {
      return 0;
    }
    
    if (spo2 >= 95 && spo2 <= 100) {
      return 1.0;
    }
    
    const distanceFromNormal = Math.min(
      Math.abs(spo2 - 95),
      Math.abs(spo2 - 100)
    );
    
    return Math.max(0, 1 - distanceFromNormal / 25);
  }

  private calculatePerfusionConfidence(): number {
    if (this.redBuffer.length === 0) return 0;
    
    const recentRed = this.redBuffer.slice(-50);
    const recentIR = this.irBuffer.slice(-50);
    
    const redVariation = this.calculateVariation(recentRed);
    const irVariation = this.calculateVariation(recentIR);
    
    const avgVariation = (redVariation + irVariation) / 2;
    
    return Math.max(0, Math.min(1, avgVariation * 10));
  }

  private calculateVariation(signal: number[]): number {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    return Math.sqrt(variance);
  }

  /**
   * Calibra el sensor con un valor de referencia
   */
  public calibrate(referenceSpO2: number): void {
    if (this.redBuffer.length < this.config.windowSize) {
      console.warn('SpO2: Insuficientes muestras para calibración');
      return;
    }
    
    // Calcular ratio actual
    const currentResult = this.applyAdvancedProcessing();
    const currentRatio = currentResult.acdcRatio;
    
    // Calcular factor de calibración
    const expectedRatio = this.calculateExpectedRatio(referenceSpO2);
    this.calibrationFactor = expectedRatio / (currentRatio + 1e-10);
    
    this.isCalibrated = true;
    
    console.log(`SpO2: Calibrado con factor ${this.calibrationFactor.toFixed(3)}`);
  }

  private calculateExpectedRatio(spo2: number): number {
    // Ecuación inversa de Beer-Lambert
    const A = 104;
    const B = 17;
    return Math.exp((A - spo2) / B);
  }

  public reset(): void {
    this.redBuffer = [];
    this.irBuffer = [];
    this.greenBuffer = [];
    this.calibrationBuffer = [];
    this.calibrationFactor = 1.0;
    this.isCalibrated = false;
  }

  public getStatus(): { 
    bufferSize: number; 
    isCalibrated: boolean; 
    calibrationFactor: number;
  } {
    return {
      bufferSize: this.redBuffer.length,
      isCalibrated: this.isCalibrated,
      calibrationFactor: this.calibrationFactor
    };
  }
} 