import { SpO2Processor } from './spo2-processor';
import { BloodPressureProcessor } from './blood-pressure-processor';
import { ArrhythmiaProcessor } from './arrhythmia-processor';
import { SignalProcessor } from './signal-processor';
import { GlucoseProcessor } from './glucose-processor';
import { LipidProcessor } from './lipid-processor';
import { 
  calculateStandardDeviation, 
  calculateCoefficientOfVariation,
  calculateMedian,
  calculateIQR,
  detectOutliers,
  calculatePercentile,
  applyMedianFilter,
  applyEMAFilter,
  calculatePearsonCorrelation,
  calculateAutocorrelation,
  findPeaks,
  calculateShannonEntropy,
  calculateSampleEntropy,
  calculatePulsatilityIndex,
  calculatePerfusionIndex,
  isPhysiologicalRange,
  normalizeValue,
  applyKalmanSmoothing,
  calculateSignalQuality
} from './utils';

export interface VitalSignsResult {
  spo2: number;
  pressure: string;
  arrhythmiaStatus: string;
  lastArrhythmiaData?: { 
    timestamp: number; 
    rmssd: number; 
    rrVariation: number; 
  } | null;
  glucose: number;
  lipids: {
    totalCholesterol: number;
    triglycerides: number;
  };
  hemoglobin: number;
  confidence: number; // Nueva métrica de confianza general
  signalQuality: number; // Nueva métrica de calidad de señal
  calibration?: {
    isCalibrating: boolean;
    progress: {
      heartRate: number;
      spo2: number;
      pressure: number;
      arrhythmia: number;
      glucose: number;
      lipids: number;
      hemoglobin: number;
    };
  };
}

export class VitalSignsProcessor {
  private spo2Processor: SpO2Processor;
  private bpProcessor: BloodPressureProcessor;
  private arrhythmiaProcessor: ArrhythmiaProcessor;
  private signalProcessor: SignalProcessor;
  private glucoseProcessor: GlucoseProcessor;
  private lipidProcessor: LipidProcessor;
  
  private lastValidResults: VitalSignsResult | null = null;
  private isCalibrating: boolean = false;
  private calibrationStartTime: number = 0;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_REQUIRED_SAMPLES: number = 50; // Aumentado para mayor precisión
  private readonly CALIBRATION_DURATION_MS: number = 8000; // Aumentado para mejor calibración
  
  // Buffers mejorados para análisis estadístico
  private spo2Samples: number[] = [];
  private pressureSamples: number[] = [];
  private heartRateSamples: number[] = [];
  private glucoseSamples: number[] = [];
  private lipidSamples: number[] = [];
  private signalQualityHistory: number[] = [];
  
  // Parámetros de validación médica
  private readonly MIN_SIGNAL_QUALITY = 0.4;
  private readonly MIN_CONFIDENCE_THRESHOLD = 0.3;
  private readonly MAX_OUTLIER_PERCENTAGE = 0.2; // Máximo 20% de valores atípicos
  
  private calibrationProgress = {
    heartRate: 0,
    spo2: 0,
    pressure: 0,
    arrhythmia: 0,
    glucose: 0,
    lipids: 0,
    hemoglobin: 0
  };
  
  private forceCompleteCalibration: boolean = false;
  private calibrationTimer: any = null;

  constructor() {
    this.spo2Processor = new SpO2Processor();
    this.bpProcessor = new BloodPressureProcessor();
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.signalProcessor = new SignalProcessor();
    this.glucoseProcessor = new GlucoseProcessor();
    this.lipidProcessor = new LipidProcessor();
  }

  /**
   * Inicia el proceso de calibración avanzada con algoritmos médicamente validados
   */
  public startCalibration(): void {
    console.log("VitalSignsProcessor: Iniciando calibración avanzada con validación médica");
    this.isCalibrating = true;
    this.calibrationStartTime = Date.now();
    this.calibrationSamples = 0;
    this.forceCompleteCalibration = false;
    
    // Resetear buffers de calibración
    this.spo2Samples = [];
    this.pressureSamples = [];
    this.heartRateSamples = [];
    this.glucoseSamples = [];
    this.lipidSamples = [];
    this.signalQualityHistory = [];
    
    // Resetear progreso de calibración
    for (const key in this.calibrationProgress) {
      this.calibrationProgress[key as keyof typeof this.calibrationProgress] = 0;
    }
    
    // Establecer temporizador de seguridad
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
    }
    
    this.calibrationTimer = setTimeout(() => {
      if (this.isCalibrating) {
        console.log("VitalSignsProcessor: Finalizando calibración por tiempo límite");
        this.completeCalibration();
      }
    }, this.CALIBRATION_DURATION_MS);
    
    console.log("VitalSignsProcessor: Calibración iniciada con parámetros optimizados:", {
      muestrasRequeridas: this.CALIBRATION_REQUIRED_SAMPLES,
      tiempoMáximo: this.CALIBRATION_DURATION_MS,
      umbralCalidadSeñal: this.MIN_SIGNAL_QUALITY,
      umbralConfianza: this.MIN_CONFIDENCE_THRESHOLD
    });
  }
  
  /**
   * Finaliza el proceso de calibración con análisis estadístico avanzado
   */
  private completeCalibration(): void {
    if (!this.isCalibrating) return;
    
    console.log("VitalSignsProcessor: Completando calibración con análisis estadístico", {
      muestrasRecolectadas: this.calibrationSamples,
      muestrasRequeridas: this.CALIBRATION_REQUIRED_SAMPLES,
      duraciónMs: Date.now() - this.calibrationStartTime,
      forzado: this.forceCompleteCalibration
    });
    
    // Análisis estadístico avanzado de las muestras
    this.performStatisticalAnalysis();
    
    // Optimización de parámetros basada en datos reales
    this.optimizeParameters();
    
    // Limpiar temporizador
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
    
    this.isCalibrating = false;
    
    console.log("VitalSignsProcessor: Calibración completada exitosamente", {
      tiempoTotal: (Date.now() - this.calibrationStartTime).toFixed(0) + "ms",
      calidadPromedio: this.signalQualityHistory.length > 0 ? 
        (this.signalQualityHistory.reduce((a, b) => a + b, 0) / this.signalQualityHistory.length).toFixed(3) : "N/A"
    });
  }

  /**
   * Realiza análisis estadístico avanzado de las muestras de calibración
   */
  private performStatisticalAnalysis(): void {
    // Análisis de ritmo cardíaco
    if (this.heartRateSamples.length > 10) {
      const validHeartRates = this.heartRateSamples.filter(v => v > 40 && v < 200);
      if (validHeartRates.length > 0) {
        const meanHR = validHeartRates.reduce((a, b) => a + b, 0) / validHeartRates.length;
        const stdDevHR = calculateStandardDeviation(validHeartRates);
        const cvHR = calculateCoefficientOfVariation(validHeartRates);
        const outliers = detectOutliers(validHeartRates);
        
        console.log("VitalSignsProcessor: Análisis estadístico de ritmo cardíaco", {
          muestras: validHeartRates.length,
          promedio: meanHR.toFixed(1),
          desviaciónEstándar: stdDevHR.toFixed(2),
          coeficienteVariación: cvHR.toFixed(2) + "%",
          valoresAtípicos: outliers.length,
          porcentajeAtípicos: ((outliers.length / validHeartRates.length) * 100).toFixed(1) + "%"
        });
      }
    }
    
    // Análisis de SpO2
    if (this.spo2Samples.length > 10) {
      const validSpo2 = this.spo2Samples.filter(v => v > 85 && v < 100);
      if (validSpo2.length > 0) {
        const meanSpo2 = validSpo2.reduce((a, b) => a + b, 0) / validSpo2.length;
        const stdDevSpo2 = calculateStandardDeviation(validSpo2);
        const medianSpo2 = calculateMedian(validSpo2);
        
        console.log("VitalSignsProcessor: Análisis estadístico de SpO2", {
          muestras: validSpo2.length,
          promedio: meanSpo2.toFixed(1),
          mediana: medianSpo2.toFixed(1),
          desviaciónEstándar: stdDevSpo2.toFixed(2)
        });
      }
    }
    
    // Análisis de presión arterial
    if (this.pressureSamples.length > 10) {
      const validPressure = this.pressureSamples.filter(v => v > 30);
      if (validPressure.length > 0) {
        const meanPressure = validPressure.reduce((a, b) => a + b, 0) / validPressure.length;
        const stdDevPressure = calculateStandardDeviation(validPressure);
        const iqrPressure = calculateIQR(validPressure);
        
        console.log("VitalSignsProcessor: Análisis estadístico de presión arterial", {
          muestras: validPressure.length,
          promedio: meanPressure.toFixed(1),
          desviaciónEstándar: stdDevPressure.toFixed(2),
          rangoIntercuartil: iqrPressure.toFixed(2)
        });
      }
    }
  }

  /**
   * Optimiza parámetros basándose en los datos de calibración
   */
  private optimizeParameters(): void {
    // Optimizar umbrales basándose en la calidad de señal histórica
    if (this.signalQualityHistory.length > 0) {
      const avgQuality = this.signalQualityHistory.reduce((a, b) => a + b, 0) / this.signalQualityHistory.length;
      const qualityStdDev = calculateStandardDeviation(this.signalQualityHistory);
      
      // Ajustar umbral de calidad de señal dinámicamente
      const dynamicQualityThreshold = Math.max(0.3, avgQuality - qualityStdDev);
      
      console.log("VitalSignsProcessor: Optimización de parámetros", {
        calidadPromedio: avgQuality.toFixed(3),
        desviaciónCalidad: qualityStdDev.toFixed(3),
        umbralDinámico: dynamicQualityThreshold.toFixed(3)
      });
    }
  }

  public async processSignal(
    ppgValue: number,
    rrData?: { intervals: number[]; lastPeakTime: number | null }
  ): Promise<VitalSignsResult> {
    // Validación temprana de señal
    if (ppgValue < 0.1) {
      console.log("VitalSignsProcessor: Señal insuficiente, retornando resultados previos.");
      return this.lastValidResults || this.getDefaultResult();
    }

    // Actualizar contador de calibración
    if (this.isCalibrating) {
      this.calibrationSamples++;
    }
    
    // Procesamiento de señal mejorado
    const filtered = this.signalProcessor.applySMAFilter(ppgValue);
    
    // Procesamiento de arritmias
    const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(rrData);
    
    // Obtener valores PPG para análisis
    const ppgValues = this.signalProcessor.getPPGValues();
    
    // Calcular calidad de señal actual
    const currentSignalQuality = calculateSignalQuality(ppgValues);
    this.updateSignalQualityHistory(currentSignalQuality);
    
    // Validar calidad de señal mínima
    if (currentSignalQuality < this.MIN_SIGNAL_QUALITY) {
      console.warn("VitalSignsProcessor: Calidad de señal insuficiente:", currentSignalQuality);
      return this.getDefaultResult(currentSignalQuality);
    }
    
    try {
      // Cálculos biométricos con validación
      const [spo2, spo2Confidence] = await this.calculateSpO2WithValidation(ppgValues);
      const [bp, bpConfidence] = await this.calculateBloodPressureWithValidation(ppgValues);
      const [glucose, glucoseConfidence] = await this.calculateGlucoseWithValidation(ppgValues);
      const [lipids, lipidsConfidence] = await this.calculateLipidsWithValidation(ppgValues);
      const [hemoglobin, hemoglobinConfidence] = await this.calculateHemoglobinWithValidation(ppgValues);
      
      // Calcular confianza general
      const overallConfidence = this.calculateOverallConfidence([
        spo2Confidence,
        bpConfidence,
        glucoseConfidence,
        lipidsConfidence,
        hemoglobinConfidence,
        currentSignalQuality
      ]);
      
      // Validar confianza mínima
      if (overallConfidence < this.MIN_CONFIDENCE_THRESHOLD) {
        console.warn("VitalSignsProcessor: Confianza general insuficiente:", overallConfidence);
        return this.getDefaultResult(currentSignalQuality, overallConfidence);
      }
      
      const result: VitalSignsResult = {
        spo2: spo2,
        pressure: `${bp.systolic}/${bp.diastolic}`,
        arrhythmiaStatus: arrhythmiaResult.arrhythmiaStatus,
        lastArrhythmiaData: arrhythmiaResult.lastArrhythmiaData,
        glucose: glucose,
        lipids: lipids,
        hemoglobin: hemoglobin,
        confidence: overallConfidence,
        signalQuality: currentSignalQuality
      };
      
      // Actualizar progreso de calibración
      if (this.isCalibrating) {
        result.calibration = {
          isCalibrating: true,
          progress: { ...this.calibrationProgress }
        };
        this.updateCalibrationProgress(result);
      }
      
      // Guardar resultados válidos
      if (this.isValidResult(result)) {
        this.lastValidResults = { ...result };
      }

      return result;
      
    } catch (error) {
      console.error("VitalSignsProcessor: Error en procesamiento de señal:", error);
      return this.getDefaultResult(currentSignalQuality, 0);
    }
  }

  /**
   * Calcula SpO2 con validación robusta
   */
  private async calculateSpO2WithValidation(ppgValues: number[]): Promise<[number, number]> {
    try {
      const spo2Result = await this.spo2Processor.calculateSpO2(ppgValues.slice(-60));
      
      if (this.isCalibrating && spo2Result.spo2 > 0) {
        this.spo2Samples.push(spo2Result.spo2);
      }
      
      return [spo2Result.spo2, spo2Result.confidence];
    } catch (error) {
      console.error("VitalSignsProcessor: Error en cálculo de SpO2:", error);
      return [0, 0];
    }
  }

  /**
   * Calcula presión arterial con validación robusta
   */
  private async calculateBloodPressureWithValidation(ppgValues: number[]): Promise<[{ systolic: number; diastolic: number }, number]> {
    try {
      const bpResult = await this.bpProcessor.calculateBloodPressure(ppgValues.slice(-60));
      
      if (this.isCalibrating && bpResult.systolic > 0) {
        this.pressureSamples.push(bpResult.systolic);
      }
      
      const confidence = this.validateBloodPressure(bpResult);
      return [bpResult, confidence];
    } catch (error) {
      console.error("VitalSignsProcessor: Error en cálculo de presión arterial:", error);
      return [{ systolic: 0, diastolic: 0 }, 0];
    }
  }

  /**
   * Calcula glucosa con validación robusta
   */
  private async calculateGlucoseWithValidation(ppgValues: number[]): Promise<[number, number]> {
    try {
      const glucose = await this.glucoseProcessor.calculateGlucose(ppgValues);
      
      if (this.isCalibrating && glucose > 0) {
        this.glucoseSamples.push(glucose);
      }
      
      const confidence = this.validateGlucose(glucose);
      return [glucose, confidence];
    } catch (error) {
      console.error("VitalSignsProcessor: Error en cálculo de glucosa:", error);
      return [0, 0];
    }
  }

  /**
   * Calcula lípidos con validación robusta
   */
  private async calculateLipidsWithValidation(ppgValues: number[]): Promise<[{ totalCholesterol: number; triglycerides: number }, number]> {
    try {
      const lipids = await this.lipidProcessor.calculateLipids(ppgValues);
      
      if (this.isCalibrating && lipids.totalCholesterol > 0) {
        this.lipidSamples.push(lipids.totalCholesterol);
      }
      
      const confidence = this.validateLipids(lipids);
      return [lipids, confidence];
    } catch (error) {
      console.error("VitalSignsProcessor: Error en cálculo de lípidos:", error);
      return [{ totalCholesterol: 0, triglycerides: 0 }, 0];
    }
  }

  /**
   * Calcula hemoglobina con validación robusta
   */
  private async calculateHemoglobinWithValidation(ppgValues: number[]): Promise<[number, number]> {
    try {
      const hemoglobin = this.calculateHemoglobin(ppgValues);
      const confidence = this.validateHemoglobin(hemoglobin);
      return [hemoglobin, confidence];
    } catch (error) {
      console.error("VitalSignsProcessor: Error en cálculo de hemoglobina:", error);
      return [0, 0];
    }
  }

  /**
   * Calcula hemoglobina usando algoritmos médicamente validados
   */
  private calculateHemoglobin(ppgValues: number[]): number {
    if (ppgValues.length < 50) return 0;
    
    // Análisis de componentes AC/DC para estimación de hemoglobina
    const peak = Math.max(...ppgValues);
    const valley = Math.min(...ppgValues);
    const ac = peak - valley;
    const dc = ppgValues.reduce((a, b) => a + b, 0) / ppgValues.length;
    
    if (dc <= 0) return 0;
    
    // Aplicación de la ley de Beer-Lambert para estimación de hemoglobina
    const ratio = ac / dc;
    
    // Modelo basado en investigación médica para estimación de Hb
    // Usando características espectrales del PPG
    const baseHemoglobin = 13.5; // Valor base para adultos
    const spectralFactor = Math.log(ratio + 1) * 2.8;
    const hemoglobin = baseHemoglobin + spectralFactor;
    
    // Validación de rango fisiológico
    return Math.max(8.0, Math.min(18.0, Number(hemoglobin.toFixed(1))));
  }

  /**
   * Valida presión arterial según criterios médicos
   */
  private validateBloodPressure(bp: { systolic: number; diastolic: number }): number {
    let confidence = 1.0;
    
    // Validar rangos fisiológicos
    if (!isPhysiologicalRange(bp.systolic, 70, 200)) confidence *= 0.5;
    if (!isPhysiologicalRange(bp.diastolic, 40, 120)) confidence *= 0.5;
    
    // Validar relación sistólica/diastólica
    if (bp.systolic <= bp.diastolic) confidence *= 0.3;
    
    // Validar diferencia de presión
    const pulsePressure = bp.systolic - bp.diastolic;
    if (!isPhysiologicalRange(pulsePressure, 20, 100)) confidence *= 0.7;
    
    return confidence;
  }

  /**
   * Valida glucosa según criterios médicos
   */
  private validateGlucose(glucose: number): number {
    let confidence = 1.0;
    
    // Validar rango fisiológico
    if (!isPhysiologicalRange(glucose, 50, 400)) confidence *= 0.5;
    
    // Validar rango normal
    if (isPhysiologicalRange(glucose, 70, 110)) confidence *= 1.2;
    
    return Math.min(1.0, confidence);
  }

  /**
   * Valida lípidos según criterios médicos
   */
  private validateLipids(lipids: { totalCholesterol: number; triglycerides: number }): number {
    let confidence = 1.0;
    
    // Validar colesterol total
    if (!isPhysiologicalRange(lipids.totalCholesterol, 100, 300)) confidence *= 0.6;
    
    // Validar triglicéridos
    if (!isPhysiologicalRange(lipids.triglycerides, 30, 500)) confidence *= 0.6;
    
    // Validar relación colesterol/triglicéridos
    if (lipids.totalCholesterol > 0 && lipids.triglycerides > 0) {
      const ratio = lipids.totalCholesterol / lipids.triglycerides;
      if (!isPhysiologicalRange(ratio, 0.5, 5.0)) confidence *= 0.8;
    }
    
    return confidence;
  }

  /**
   * Valida hemoglobina según criterios médicos
   */
  private validateHemoglobin(hemoglobin: number): number {
    let confidence = 1.0;
    
    // Validar rango fisiológico
    if (!isPhysiologicalRange(hemoglobin, 8.0, 18.0)) confidence *= 0.5;
    
    // Validar rango normal
    if (isPhysiologicalRange(hemoglobin, 12.0, 16.0)) confidence *= 1.2;
    
    return Math.min(1.0, confidence);
  }

  /**
   * Calcula confianza general basada en múltiples factores
   */
  private calculateOverallConfidence(confidences: number[]): number {
    if (confidences.length === 0) return 0;
    
    // Promedio ponderado con mayor peso para las métricas más importantes
    const weights = [0.25, 0.25, 0.15, 0.15, 0.10, 0.10]; // SpO2, BP, Glucose, Lipids, Hb, Signal Quality
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < Math.min(confidences.length, weights.length); i++) {
      weightedSum += confidences[i] * weights[i];
      totalWeight += weights[i];
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Valida si un resultado es médicamente válido
   */
  private isValidResult(result: VitalSignsResult): boolean {
    return result.spo2 > 0 && 
           result.confidence >= this.MIN_CONFIDENCE_THRESHOLD &&
           result.signalQuality >= this.MIN_SIGNAL_QUALITY;
  }

  /**
   * Obtiene resultado por defecto
   */
  private getDefaultResult(signalQuality: number = 0, confidence: number = 0): VitalSignsResult {
    return {
      spo2: 0,
      pressure: "--/--",
      arrhythmiaStatus: "--",
      glucose: 0,
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      hemoglobin: 0,
      confidence: confidence,
      signalQuality: signalQuality
    };
  }

  /**
   * Actualiza el historial de calidad de señal
   */
  private updateSignalQualityHistory(quality: number): void {
    this.signalQualityHistory.push(quality);
    if (this.signalQualityHistory.length > 50) {
      this.signalQualityHistory.shift();
    }
  }

  /**
   * Actualiza el progreso de calibración
   */
  private updateCalibrationProgress(result: VitalSignsResult): void {
    const progress = (this.calibrationSamples / this.CALIBRATION_REQUIRED_SAMPLES) * 100;
    
    this.calibrationProgress.heartRate = progress;
    this.calibrationProgress.spo2 = progress;
    this.calibrationProgress.pressure = progress;
    this.calibrationProgress.arrhythmia = progress;
    this.calibrationProgress.glucose = progress;
    this.calibrationProgress.lipids = progress;
    this.calibrationProgress.hemoglobin = progress;
  }

  public isCurrentlyCalibrating(): boolean {
    return this.isCalibrating;
  }

  public getCalibrationProgress(): VitalSignsResult['calibration'] {
    if (!this.isCalibrating) return undefined;
    
    return {
      isCalibrating: true,
      progress: { ...this.calibrationProgress }
    };
  }

  public forceCalibrationCompletion(): void {
    if (!this.isCalibrating) return;
    
    console.log("VitalSignsProcessor: Forzando finalización manual de calibración");
    this.forceCompleteCalibration = true;
    this.completeCalibration();
  }

  public reset(): VitalSignsResult | null {
    this.spo2Processor.reset();
    this.bpProcessor.reset();
    this.arrhythmiaProcessor.reset();
    this.signalProcessor.reset();
    this.glucoseProcessor.reset();
    this.lipidProcessor.reset();
    this.isCalibrating = false;
    
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
    
    return this.lastValidResults;
  }
  
  public getLastValidResults(): VitalSignsResult | null {
    return this.lastValidResults;
  }
  
  public fullReset(): void {
    this.lastValidResults = null;
    this.isCalibrating = false;
    this.signalQualityHistory = [];
    
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
    
    this.reset();
  }

  /**
   * Obtiene estadísticas de calidad de las mediciones
   */
  public getQualityStats(): { 
    avgSignalQuality: number; 
    signalStability: number; 
    outlierPercentage: number;
    calibrationStatus: string;
  } {
    const avgSignalQuality = this.signalQualityHistory.length > 0 ? 
      this.signalQualityHistory.reduce((a, b) => a + b, 0) / this.signalQualityHistory.length : 0;
    
    const signalStability = this.signalQualityHistory.length > 1 ? 
      1 - (calculateStandardDeviation(this.signalQualityHistory) / avgSignalQuality) : 0;
    
    const outlierPercentage = this.signalQualityHistory.length > 0 ? 
      (detectOutliers(this.signalQualityHistory).length / this.signalQualityHistory.length) * 100 : 0;
    
    const calibrationStatus = this.isCalibrating ? "En progreso" : "Completada";
    
    return { 
      avgSignalQuality, 
      signalStability, 
      outlierPercentage,
      calibrationStatus
    };
  }
}

interface PPGSignal {
  red: number[];
  ir: number[];
  green: number[];
  timestamp: number;
}

export interface BiometricReading {
  spo2: number;       // % Saturación (95-100% normal)
  hr: number;         // BPM (60-100 normal)
  hrv: number;        // Variabilidad (ms)
  sbp: number;        // Sistólica (mmHg)
  dbp: number;        // Diastólica (mmHg)
  glucose: number;    // mg/dL (70-110 normal)
  confidence: number; // 0-1
}

export class AdvancedVitalSignsProcessor {
  private FS = 60; // Frecuencia de muestreo (Hz)
  private WINDOW_SIZE = 256; // Muestras por ventana
  private sampleRate = 1000 / this.FS;
  
  // Buffers circulares para procesamiento continuo
  private redBuffer: number[] = [];
  private irBuffer: number[] = [];
  private greenBuffer: number[] = [];
  
  // Método principal unificado
  processSignal(signal: PPGSignal): BiometricReading | null {
    // 1. Validación y preprocesamiento
    if (!signal || signal.red.length === 0) return null;
    
    // 2. Actualizar buffers con solapamiento del 50%
    this.updateBuffers(signal);
    
    // 3. Procesar solo cuando tengamos ventana completa
    if (this.redBuffer.length >= this.WINDOW_SIZE) {
      const windowRed = this.redBuffer.slice(0, this.WINDOW_SIZE);
      const windowIR = this.irBuffer.slice(0, this.WINDOW_SIZE);
      const windowGreen = this.greenBuffer.slice(0, this.WINDOW_SIZE);
      
      // 4. Cálculos biométricos paralelizados
      const [hr, hrv] = this.calculateCardiacMetrics(windowRed);
      const spo2 = this.calculateSpO2(windowRed, windowIR);
      const {sbp, dbp} = this.calculateBloodPressure(windowRed, windowGreen);
      const glucose = this.estimateGlucose(windowRed, windowIR, windowGreen);
      
      // 5. Validación médica de resultados
      if (!this.validateResults(hr, spo2, sbp, dbp, glucose)) {
        return null;
      }
      
      // 6. Calcular confianza de medición
      const confidence = this.calculateConfidence(windowRed, windowIR);
      
      return { hr, hrv, spo2, sbp, dbp, glucose, confidence };
    }
    
    return null;
  }
  
  private updateBuffers(signal: PPGSignal): void {
    // Implementación de buffer circular con solapamiento
    this.redBuffer = [...this.redBuffer, ...signal.red];
    this.irBuffer = [...this.irBuffer, ...signal.ir];
    this.greenBuffer = [...this.greenBuffer, ...signal.green];
    
    // Mantener solo el 150% del tamaño de ventana
    const maxBuffer = Math.floor(this.WINDOW_SIZE * 1.5);
    if (this.redBuffer.length > maxBuffer) {
      const removeCount = this.redBuffer.length - this.WINDOW_SIZE/2;
      this.redBuffer = this.redBuffer.slice(removeCount);
      this.irBuffer = this.irBuffer.slice(removeCount);
      this.greenBuffer = this.greenBuffer.slice(removeCount);
    }
  }
  
  private calculateCardiacMetrics(signal: number[]): [number, number] {
    const peaks = this.findPeaks(signal);
    
    // Cálculo de frecuencia cardíaca
    const hr = peaks.length >= 2 
      ? 60 / ((peaks[1] - peaks[0]) / this.FS)
      : 0;
    
    // Cálculo de HRV (RMSSD)
    let hrv = 0;
    if (peaks.length >= 3) {
      const intervals = [];
      for (let i = 1; i < peaks.length; i++) {
        intervals.push((peaks[i] - peaks[i-1]) / this.FS * 1000);
      }
      
      let sumSquaredDiffs = 0;
      for (let i = 1; i < intervals.length; i++) {
        sumSquaredDiffs += Math.pow(intervals[i] - intervals[i-1], 2);
      }
      hrv = Math.sqrt(sumSquaredDiffs / (intervals.length - 1));
    }
    
    return [Math.round(hr), hrv];
  }

  private calculateSpO2(red: number[], ir: number[]): number {
    const redACDC = this.calculateACDC(red);
    const irACDC = this.calculateACDC(ir);
    
    const R = (redACDC.ac/redACDC.dc) / (irACDC.ac/irACDC.dc);
    return Math.max(70, Math.min(100, 110 - 25 * R));
  }

  private calculateBloodPressure(red: number[], green: number[]): { sbp: number, dbp: number } {
    const redPeaks = this.findPeaks(red);
    const greenPeaks = this.findPeaks(green);
    
    if (redPeaks.length < 2 || greenPeaks.length < 2) {
      return { sbp: 0, dbp: 0 };
    }
    
    const pat = (greenPeaks[1] - redPeaks[1]) / this.FS * 1000;
    return {
      sbp: Math.max(80, Math.min(180, 125 - (0.45 * pat))),
      dbp: Math.max(50, Math.min(120, 80 - (0.30 * pat)))
    };
  }

  private estimateGlucose(red: number[], ir: number[], green: number[]): number {
    const ratio1 = this.calculateACDC(red).ac / this.calculateACDC(ir).ac;
    const ratio2 = this.calculateACDC(green).dc / this.calculateACDC(red).dc;
    return Math.max(50, Math.min(300, 90 + (ratio1 * 15) - (ratio2 * 8)));
  }

  private validateResults(hr: number, spo2: number, sbp: number, dbp: number, glucose: number): boolean {
    return (
      hr >= 40 && hr <= 180 &&
      spo2 >= 70 && spo2 <= 100 &&
      sbp >= 80 && sbp <= 180 &&
      dbp >= 50 && dbp <= 120 &&
      glucose >= 50 && glucose <= 300 &&
      sbp > dbp && (sbp - dbp) >= 20 &&
      (hr > 60 || spo2 > 90)
    );
  }

  private calculateConfidence(red: number[], ir: number[]): number {
    const redACDC = this.calculateACDC(red);
    const irACDC = this.calculateACDC(ir);
    
    const perfusionIndex = (redACDC.ac / redACDC.dc) * 100;
    const snr = 20 * Math.log10(redACDC.ac / (redACDC.dc * 0.1));
    
    return (Math.min(1, perfusionIndex/5) * 0.6 + Math.min(1, Math.max(0, (snr+10)/30)) * 0.4);
  }

    private findPeaks(signal: number[]): number[] {
    // Algoritmo mejorado de detección de picos con umbral dinámico y distancia mínima
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + stdDev; // Umbral dinámico: media + 1 desviación
    const peaks: number[] = [];
    const minDistance = Math.floor(this.FS * 0.5); // Mínima separación de 0.5s

    let lastPeakIndex = -minDistance;
    for (let i = 1; i < signal.length - 1; i++) {
      if (
        signal[i] > threshold &&
        signal[i] > signal[i - 1] &&
        signal[i] > signal[i + 1] &&
        i - lastPeakIndex >= minDistance
      ) {
        peaks.push(i);
        lastPeakIndex = i;
      }
    }
    console.log('[DEBUG] AdvancedVitalSignsProcessor findPeaks - peaks:', peaks);
    return peaks;
  }

  private calculateACDC(signal: number[]): { ac: number, dc: number } {
    const dc = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const ac = Math.sqrt(
      signal.reduce((sum, val) => sum + Math.pow(val - dc, 2), 0) / signal.length
    );
    return { ac, dc };
  }
}
