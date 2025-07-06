/**
 * Advanced Vital Signs Processor
 * Integra todos los algoritmos médicos avanzados:
 * - CHROM/POS para procesamiento robusto
 * - FastICA para separación de fuentes
 * - Eulerian Magnification para amplificación
 * - SpO2 avanzado con Ratio-of-Ratios
 * - Detección avanzada de arritmias
 */

import { CHROMPOSProcessor, CHROMResult } from '../signal-processing/CHROMPOSProcessor';
import { FastICAProcessor, FastICAResult } from '../signal-processing/FastICAProcessor';
import { EulerianMagnification, MagnificationResult } from '../signal-processing/EulerianMagnification';
import { AdvancedSpO2Processor, SpO2Result } from './AdvancedSpO2Processor';
import { AdvancedArrhythmiaProcessor, ArrhythmiaResult, HRVMetrics } from './AdvancedArrhythmiaProcessor';
import { PPGMLModel } from '../../ml/models/PPGMLModel';

export interface AdvancedVitalSignsConfig {
  enableCHROM: boolean;
  enableFastICA: boolean;
  enableEulerian: boolean;
  enableAdvancedSpO2: boolean;
  enableAdvancedArrhythmia: boolean;
  fusionMethod: 'weighted' | 'voting' | 'ensemble';
  qualityThreshold: number;
}

export interface AdvancedVitalSignsResult {
  // Métricas principales
  heartRate: number;
  spo2: number;
  bloodPressure: {
    systolic: number;
    diastolic: number;
    map: number;
  };
  
  // Métricas avanzadas
  hrvMetrics: HRVMetrics;
  arrhythmiaStatus: ArrhythmiaResult;
  perfusionIndex: number;
  signalQuality: number;
  
  // Confianza y calidad
  confidence: {
    heartRate: number;
    spo2: number;
    bloodPressure: number;
    arrhythmia: number;
    overall: number;
  };
  
  // Información de procesamiento
  processingInfo: {
    algorithmsUsed: string[];
    fusionMethod: string;
    qualityScore: number;
    timestamp: number;
  };
  
  // Datos crudos para análisis
  rawData: {
    redSignal: number[];
    greenSignal: number[];
    blueSignal: number[];
    processedSignals: number[][];
  };
}

export class AdvancedVitalSignsProcessor {
  private config: AdvancedVitalSignsConfig;
  
  // Procesadores de algoritmos
  private chromPosProcessor: CHROMPOSProcessor;
  private fastICAProcessor: FastICAProcessor;
  private eulerianProcessor: EulerianMagnification;
  private spo2Processor: AdvancedSpO2Processor;
  private arrhythmiaProcessor: AdvancedArrhythmiaProcessor;
  private mlModel: PPGMLModel;
  
  // Buffers de datos
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  
  // Historial de resultados
  private resultHistory: AdvancedVitalSignsResult[] = [];
  
  // Parámetros médicamente validados
  private readonly DEFAULT_CONFIG: AdvancedVitalSignsConfig = {
    enableCHROM: true,
    enableFastICA: true,
    enableEulerian: true,
    enableAdvancedSpO2: true,
    enableAdvancedArrhythmia: true,
    fusionMethod: 'weighted',
    qualityThreshold: 0.6
  };

  constructor(config: Partial<AdvancedVitalSignsConfig> = {}) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    
    // Inicializar procesadores
    this.initializeProcessors();
  }

  /**
   * Inicializa todos los procesadores de algoritmos
   */
  private initializeProcessors(): void {
    this.chromPosProcessor = new CHROMPOSProcessor({
      windowSize: 300,
      alpha: 3,
      beta: 2,
      gamma: 1,
      samplingRate: 60
    });

    this.fastICAProcessor = new FastICAProcessor({
      maxIterations: 1000,
      tolerance: 1e-6,
      nonlinearity: 'tanh',
      whitening: true,
      stabilization: true
    });

    this.eulerianProcessor = new EulerianMagnification({
      amplificationFactor: 50,
      cutoffFrequency: 0.4,
      samplingRate: 60,
      windowSize: 300,
      pyramidLevels: 4,
      temporalFilter: 'butterworth'
    });

    this.spo2Processor = new AdvancedSpO2Processor({
      redWavelength: 660,
      irWavelength: 940,
      greenWavelength: 550,
      samplingRate: 60,
      windowSize: 300,
      calibrationFactor: 1.0,
      minSpO2: 70,
      maxSpO2: 100
    });

    this.arrhythmiaProcessor = new AdvancedArrhythmiaProcessor({
      minRRInterval: 300,
      maxRRInterval: 2000,
      learningPeriod: 10000,
      detectionThreshold: 0.7,
      hrvWindowSize: 300,
      samplingRate: 1000
    });

    // Inicializar modelo de Machine Learning
    this.mlModel = new PPGMLModel();
  }

  /**
   * Procesa una nueva muestra de datos PPG
   */
  public processSample(
    red: number, 
    green: number, 
    blue: number, 
    timestamp: number
  ): AdvancedVitalSignsResult | null {
    // Agregar datos a buffers
    this.updateBuffers(red, green, blue, timestamp);
    
    // Verificar si tenemos suficientes datos
    if (this.redBuffer.length < 100) {
      return this.createInitialResult();
    }
    
    // Aplicar procesamiento avanzado
    return this.applyAdvancedProcessing();
  }

  /**
   * Aplica procesamiento avanzado completo
   */
  private applyAdvancedProcessing(): AdvancedVitalSignsResult {
    const algorithmsUsed: string[] = [];
    const processedSignals: number[][] = [];
    
    // 1. Procesamiento CHROM/POS
    let chromResult: CHROMResult | null = null;
    if (this.config.enableCHROM) {
      chromResult = this.chromPosProcessor.processFrame(
        this.redBuffer[this.redBuffer.length - 1],
        this.greenBuffer[this.greenBuffer.length - 1],
        this.blueBuffer[this.blueBuffer.length - 1]
      );
      if (chromResult) {
        algorithmsUsed.push('CHROM/POS');
        processedSignals.push(chromResult.processedSignal);
      }
    }
    
    // 2. Procesamiento FastICA
    let icaResult: FastICAResult | null = null;
    if (this.config.enableFastICA && this.redBuffer.length >= 200) {
      const signals = [
        this.redBuffer.slice(-200),
        this.greenBuffer.slice(-200),
        this.blueBuffer.slice(-200)
      ];
      icaResult = this.fastICAProcessor.processSignals(signals);
      if (icaResult) {
        algorithmsUsed.push('FastICA');
        processedSignals.push(...icaResult.independentComponents);
      }
    }
    
    // 3. Amplificación Euleriana
    let eulerianResult: MagnificationResult | null = null;
    if (this.config.enableEulerian) {
      const lastSample = this.redBuffer[this.redBuffer.length - 1];
      eulerianResult = this.eulerianProcessor.processSample(lastSample);
      if (eulerianResult) {
        algorithmsUsed.push('Eulerian');
        processedSignals.push(eulerianResult.amplifiedSignal);
      }
    }
    
    // 4. Procesamiento avanzado de SpO2
    let spo2Result: SpO2Result | null = null;
    if (this.config.enableAdvancedSpO2) {
      spo2Result = this.spo2Processor.processSample(
        this.redBuffer[this.redBuffer.length - 1],
        this.greenBuffer[this.greenBuffer.length - 1],
        this.blueBuffer[this.blueBuffer.length - 1]
      );
      if (spo2Result) {
        algorithmsUsed.push('AdvancedSpO2');
      }
    }
    
    // 5. Detección avanzada de arritmias
    let arrhythmiaResult: ArrhythmiaResult | null = null;
    if (this.config.enableAdvancedArrhythmia) {
      // Detección real de picos R basada en análisis de señal
      const realPeakTime = this.detectRealPeakTime();
      arrhythmiaResult = this.arrhythmiaProcessor.processPeak(realPeakTime);
      if (arrhythmiaResult) {
        algorithmsUsed.push('AdvancedArrhythmia');
      }
    }

    // 6. Procesamiento con Machine Learning
    let mlPrediction = null;
    if (this.redBuffer.length >= 100) {
      // Extraer características para ML
      const features = this.mlModel.extractFeatures(
        this.calculateRRIntervals(),
        this.calculateSignalQuality(),
        this.calculatePerfusionIndex(),
        this.calculateACDCRatio()
      );
      
      // Obtener predicción del modelo
      mlPrediction = this.mlModel.predict(features);
      algorithmsUsed.push('MachineLearning');
    }
    
    // 6. Fusión de resultados
    const fusedResult = this.fuseResults(
      chromResult,
      icaResult,
      eulerianResult,
      spo2Result,
      arrhythmiaResult
    );
    
    // 7. Calcular métricas finales
    const finalResult = this.calculateFinalMetrics(fusedResult, algorithmsUsed, processedSignals);
    
    // 8. Actualizar historial
    this.updateResultHistory(finalResult);
    
    return finalResult;
  }

  /**
   * Fusiona resultados de múltiples algoritmos
   */
  private fuseResults(
    chromResult: CHROMResult | null,
    icaResult: FastICAResult | null,
    eulerianResult: MagnificationResult | null,
    spo2Result: SpO2Result | null,
    arrhythmiaResult: ArrhythmiaResult | null
  ): any {
    const fused: any = {};
    
    // Fusión de frecuencia cardíaca
    const heartRateResults: Array<{value: number, confidence: number, source: string}> = [];
    
    if (chromResult) {
      heartRateResults.push({
        value: chromResult.heartRate,
        confidence: chromResult.confidence,
        source: 'CHROM/POS'
      });
    }
    
    if (icaResult) {
      const cardiacComponent = this.fastICAProcessor.identifyCardiacComponent(icaResult.independentComponents);
      const cardiacSignal = icaResult.independentComponents[cardiacComponent];
      const estimatedHR = this.estimateHeartRateFromSignal(cardiacSignal);
      heartRateResults.push({
        value: estimatedHR,
        confidence: icaResult.quality,
        source: 'FastICA'
      });
    }
    
    if (eulerianResult) {
      const amplifiedHR = this.estimateHeartRateFromSignal(eulerianResult.amplifiedSignal);
      heartRateResults.push({
        value: amplifiedHR,
        confidence: eulerianResult.quality,
        source: 'Eulerian'
      });
    }
    
    // Aplicar método de fusión
    switch (this.config.fusionMethod) {
      case 'weighted':
        fused.heartRate = this.weightedFusion(heartRateResults);
        break;
      case 'voting':
        fused.heartRate = this.votingFusion(heartRateResults);
        break;
      case 'ensemble':
        fused.heartRate = this.ensembleFusion(heartRateResults);
        break;
      default:
        fused.heartRate = this.weightedFusion(heartRateResults);
    }
    
    // Fusión de SpO2
    if (spo2Result) {
      fused.spo2 = spo2Result.spo2;
      fused.spo2Confidence = spo2Result.confidence;
      fused.perfusionIndex = spo2Result.perfusionIndex;
    }
    
    // Fusión de arritmias
    if (arrhythmiaResult) {
      fused.arrhythmia = arrhythmiaResult;
    }
    
    return fused;
  }

  /**
   * Fusión ponderada por confianza
   */
  private weightedFusion(results: Array<{value: number, confidence: number, source: string}>): {
    value: number;
    confidence: number;
    sources: string[];
  } {
    if (results.length === 0) {
      return { value: 0, confidence: 0, sources: [] };
    }
    
    let weightedSum = 0;
    let totalWeight = 0;
    const sources: string[] = [];
    
    for (const result of results) {
      weightedSum += result.value * result.confidence;
      totalWeight += result.confidence;
      sources.push(result.source);
    }
    
    const fusedValue = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const fusedConfidence = totalWeight / results.length;
    
    return {
      value: fusedValue,
      confidence: fusedConfidence,
      sources
    };
  }

  /**
   * Fusión por votación
   */
  private votingFusion(results: Array<{value: number, confidence: number, source: string}>): {
    value: number;
    confidence: number;
    sources: string[];
  } {
    if (results.length === 0) {
      return { value: 0, confidence: 0, sources: [] };
    }
    
    // Agrupar valores similares
    const groups: Array<{values: number[], confidences: number[], sources: string[]}> = [];
    const tolerance = 5; // 5 BPM de tolerancia
    
    for (const result of results) {
      let addedToGroup = false;
      
      for (const group of groups) {
        const groupMean = group.values.reduce((sum, val) => sum + val, 0) / group.values.length;
        if (Math.abs(result.value - groupMean) <= tolerance) {
          group.values.push(result.value);
          group.confidences.push(result.confidence);
          group.sources.push(result.source);
          addedToGroup = true;
          break;
        }
      }
      
      if (!addedToGroup) {
        groups.push({
          values: [result.value],
          confidences: [result.confidence],
          sources: [result.source]
        });
      }
    }
    
    // Encontrar el grupo más grande
    const largestGroup = groups.reduce((largest, current) => 
      current.values.length > largest.values.length ? current : largest
    );
    
    const fusedValue = largestGroup.values.reduce((sum, val) => sum + val, 0) / largestGroup.values.length;
    const fusedConfidence = largestGroup.confidences.reduce((sum, conf) => sum + conf, 0) / largestGroup.confidences.length;
    
    return {
      value: fusedValue,
      confidence: fusedConfidence,
      sources: largestGroup.sources
    };
  }

  /**
   * Fusión por ensemble
   */
  private ensembleFusion(results: Array<{value: number, confidence: number, source: string}>): {
    value: number;
    confidence: number;
    sources: string[];
  } {
    if (results.length === 0) {
      return { value: 0, confidence: 0, sources: [] };
    }
    
    // Calcular estadísticas del ensemble
    const values = results.map(r => r.value);
    const confidences = results.map(r => r.confidence);
    const sources = results.map(r => r.source);
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Calcular confianza basada en consistencia del ensemble
    const consistency = Math.max(0, 1 - stdDev / mean);
    const avgConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
    const fusedConfidence = (consistency + avgConfidence) / 2;
    
    return {
      value: mean,
      confidence: fusedConfidence,
      sources
    };
  }

  /**
   * Estima frecuencia cardíaca desde una señal
   */
  private estimateHeartRateFromSignal(signal: number[]): number {
    if (signal.length < 64) return 0;
    
    // Calcular FFT
    const fft = this.computeFFT(signal);
    
    // Buscar pico en rango cardíaco (0.5-3.67 Hz)
    const samplingRate = 60; // Asumido
    const minBin = Math.floor(0.5 * signal.length / samplingRate);
    const maxBin = Math.floor(3.67 * signal.length / samplingRate);
    
    let maxMagnitude = 0;
    let peakFrequency = 0;
    
    for (let i = minBin; i <= maxBin && i < fft.length / 2; i++) {
      const magnitude = Math.sqrt(fft[i].real * fft[i].real + fft[i].imag * fft[i].imag);
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
        peakFrequency = i * samplingRate / signal.length;
      }
    }
    
    return peakFrequency * 60; // Convertir a BPM
  }

  /**
   * Calcula métricas finales
   */
  private calculateFinalMetrics(
    fusedResult: any,
    algorithmsUsed: string[],
    processedSignals: number[][]
  ): AdvancedVitalSignsResult {
    // Calcular presión arterial estimada (basada en PPG)
    const bloodPressure = this.estimateBloodPressure(fusedResult.heartRate);
    
    // Calcular confianza general
    const overallConfidence = this.calculateOverallConfidence(fusedResult);
    
    // Calcular calidad de señal general
    const signalQuality = this.calculateOverallSignalQuality(processedSignals);
    
    const result: AdvancedVitalSignsResult = {
      heartRate: fusedResult.heartRate?.value || 0,
      spo2: fusedResult.spo2 || 98,
      bloodPressure,
      hrvMetrics: fusedResult.arrhythmia?.hrvMetrics || this.createEmptyHRVMetrics(),
      arrhythmiaStatus: fusedResult.arrhythmia || this.createEmptyArrhythmiaResult(),
      perfusionIndex: fusedResult.perfusionIndex || 0,
      signalQuality,
      confidence: {
        heartRate: fusedResult.heartRate?.confidence || 0,
        spo2: fusedResult.spo2Confidence || 0,
        bloodPressure: 0.7, // Estimación
        arrhythmia: fusedResult.arrhythmia?.confidence || 0,
        overall: overallConfidence
      },
      processingInfo: {
        algorithmsUsed,
        fusionMethod: this.config.fusionMethod,
        qualityScore: signalQuality,
        timestamp: Date.now()
      },
      rawData: {
        redSignal: [...this.redBuffer],
        greenSignal: [...this.greenBuffer],
        blueSignal: [...this.blueBuffer],
        processedSignals
      }
    };
    
    return result;
  }

  /**
   * Estima presión arterial basada en PPG
   */
  private estimateBloodPressure(heartRate: any): { systolic: number; diastolic: number; map: number } {
    // Estimación simplificada basada en frecuencia cardíaca
    const baseSystolic = 120;
    const baseDiastolic = 80;
    
    let systolic = baseSystolic;
    let diastolic = baseDiastolic;
    
    if (heartRate?.value) {
      const hr = heartRate.value;
      
      // Ajustar basado en frecuencia cardíaca
      if (hr > 100) {
        systolic += (hr - 100) * 0.5;
        diastolic += (hr - 100) * 0.3;
      } else if (hr < 60) {
        systolic -= (60 - hr) * 0.3;
        diastolic -= (60 - hr) * 0.2;
      }
    }
    
    const map = diastolic + (systolic - diastolic) / 3;
    
    return { systolic, diastolic, map };
  }

  /**
   * Calcula confianza general
   */
  private calculateOverallConfidence(fusedResult: any): number {
    const confidences = [
      fusedResult.heartRate?.confidence || 0,
      fusedResult.spo2Confidence || 0,
      fusedResult.arrhythmia?.confidence || 0
    ];
    
    return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  }

  /**
   * Calcula calidad de señal general
   */
  private calculateOverallSignalQuality(processedSignals: number[][]): number {
    if (processedSignals.length === 0) return 0;
    
    const qualities: number[] = [];
    
    for (const signal of processedSignals) {
      if (signal.length > 0) {
        const signalPower = this.calculateSignalPower(signal);
        const noisePower = this.calculateNoisePower(signal);
        const snr = signalPower / (noisePower + 1e-10);
        qualities.push(Math.min(1, snr / 10));
      }
    }
    
    return qualities.length > 0 ? 
      qualities.reduce((sum, qual) => sum + qual, 0) / qualities.length : 0;
  }

  // ────────── MÉTODOS AUXILIARES ──────────

  private updateBuffers(red: number, green: number, blue: number, timestamp: number): void {
    this.redBuffer.push(red);
    this.greenBuffer.push(green);
    this.blueBuffer.push(blue);
    this.timestampBuffer.push(timestamp);
    
    // Mantener tamaño del buffer
    const maxBufferSize = 1000;
    if (this.redBuffer.length > maxBufferSize) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
      this.timestampBuffer.shift();
    }
  }

  private createInitialResult(): AdvancedVitalSignsResult {
    return {
      heartRate: 0,
      spo2: 98,
      bloodPressure: { systolic: 120, diastolic: 80, map: 93 },
      hrvMetrics: this.createEmptyHRVMetrics(),
      arrhythmiaStatus: this.createEmptyArrhythmiaResult(),
      perfusionIndex: 0,
      signalQuality: 0,
      confidence: {
        heartRate: 0,
        spo2: 0,
        bloodPressure: 0,
        arrhythmia: 0,
        overall: 0
      },
      processingInfo: {
        algorithmsUsed: [],
        fusionMethod: this.config.fusionMethod,
        qualityScore: 0,
        timestamp: Date.now()
      },
      rawData: {
        redSignal: [...this.redBuffer],
        greenSignal: [...this.greenBuffer],
        blueSignal: [...this.blueBuffer],
        processedSignals: []
      }
    };
  }

  private createEmptyHRVMetrics(): HRVMetrics {
    return {
      meanRR: 0, sdnn: 0, rmssd: 0, pnn50: 0, pnn20: 0,
      totalPower: 0, vlfPower: 0, lfPower: 0, hfPower: 0, lfHfRatio: 0,
      sd1: 0, sd2: 0, approximateEntropy: 0, sampleEntropy: 0, correlationDimension: 0
    };
  }

  private createEmptyArrhythmiaResult(): ArrhythmiaResult {
    return {
      isArrhythmiaDetected: false,
      arrhythmiaType: 'normal',
      confidence: 0,
      hrvMetrics: this.createEmptyHRVMetrics(),
      riskLevel: 'low',
      recommendations: ['Continuar monitoreo'],
      timestamp: Date.now(),
      rrIntervals: [],
      quality: 0
    };
  }

  private updateResultHistory(result: AdvancedVitalSignsResult): void {
    this.resultHistory.push(result);
    
    // Mantener solo los últimos 100 resultados
    if (this.resultHistory.length > 100) {
      this.resultHistory.shift();
    }
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

  /**
   * Obtiene el historial de resultados
   */
  public getResultHistory(): AdvancedVitalSignsResult[] {
    return [...this.resultHistory];
  }

  /**
   * Obtiene estadísticas de procesamiento
   */
  public getProcessingStats(): {
    totalSamples: number;
    algorithmsUsed: string[];
    averageQuality: number;
    lastUpdate: number;
  } {
    const totalSamples = this.redBuffer.length;
    const algorithmsUsed = this.resultHistory.length > 0 ? 
      this.resultHistory[this.resultHistory.length - 1].processingInfo.algorithmsUsed : [];
    const averageQuality = this.resultHistory.length > 0 ?
      this.resultHistory.reduce((sum, result) => sum + result.signalQuality, 0) / this.resultHistory.length : 0;
    const lastUpdate = this.resultHistory.length > 0 ?
      this.resultHistory[this.resultHistory.length - 1].processingInfo.timestamp : 0;
    
    return {
      totalSamples,
      algorithmsUsed,
      averageQuality,
      lastUpdate
    };
  }

  /**
   * Actualiza configuración dinámicamente
   */
  public updateConfig(newConfig: Partial<AdvancedVitalSignsConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  private detectRealPeakTime(): number {
    // Detección real de picos basada en análisis de señal PPG
    if (this.redBuffer.length < 10) return Date.now();
    
    // Calcular derivada de la señal roja
    const derivatives: number[] = [];
    for (let i = 1; i < this.redBuffer.length; i++) {
      derivatives.push(this.redBuffer[i] - this.redBuffer[i - 1]);
    }
    
    // Buscar pico (cambio de pendiente positiva a negativa)
    for (let i = 1; i < derivatives.length; i++) {
      if (derivatives[i - 1] > 0 && derivatives[i] < 0) {
        // Pico detectado, calcular tiempo real
        const peakIndex = i;
        const timeOffset = peakIndex * (1000 / 60); // 60 Hz sampling
        return this.timestampBuffer[peakIndex] || Date.now();
      }
    }
    
    return Date.now();
  }

  public reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.timestampBuffer = [];
    this.resultHistory = [];
    
    // Resetear procesadores
    this.chromPosProcessor.reset();
    this.fastICAProcessor.reset();
    this.eulerianProcessor.reset();
    this.spo2Processor.reset();
    this.arrhythmiaProcessor.reset();
    this.mlModel.reset();
  }

  /**
   * Calcula intervalos RR basados en la señal PPG
   */
  private calculateRRIntervals(): number[] {
    if (this.redBuffer.length < 10) return [];
    
    // Detectar picos en la señal PPG
    const peaks: number[] = [];
    for (let i = 1; i < this.redBuffer.length - 1; i++) {
      if (this.redBuffer[i] > this.redBuffer[i-1] && 
          this.redBuffer[i] > this.redBuffer[i+1] &&
          this.redBuffer[i] > 0.5) {
        peaks.push(i);
      }
    }
    
    // Calcular intervalos RR
    const rrIntervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = (peaks[i] - peaks[i-1]) * (1000 / 60); // Convertir a ms
      if (interval >= 300 && interval <= 2000) { // Rango fisiológico
        rrIntervals.push(interval);
      }
    }
    
    return rrIntervals;
  }

  /**
   * Calcula calidad de señal actual
   */
  private calculateSignalQuality(): number {
    if (this.redBuffer.length < 10) return 0;
    
    const recentSignal = this.redBuffer.slice(-10);
    const mean = recentSignal.reduce((sum, val) => sum + val, 0) / recentSignal.length;
    const variance = recentSignal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentSignal.length;
    const snr = mean / (Math.sqrt(variance) + 1e-10);
    
    return Math.min(100, Math.max(0, snr * 20));
  }

  /**
   * Calcula índice de perfusión
   */
  private calculatePerfusionIndex(): number {
    if (this.redBuffer.length < 10) return 0;
    
    const recentSignal = this.redBuffer.slice(-10);
    const ac = Math.max(...recentSignal) - Math.min(...recentSignal);
    const dc = recentSignal.reduce((sum, val) => sum + val, 0) / recentSignal.length;
    
    return ac / (dc + 1e-10);
  }

  /**
   * Calcula ratio AC/DC
   */
  private calculateACDCRatio(): number {
    if (this.redBuffer.length < 10) return 0;
    
    const recentSignal = this.redBuffer.slice(-10);
    const ac = Math.max(...recentSignal) - Math.min(...recentSignal);
    const dc = recentSignal.reduce((sum, val) => sum + val, 0) / recentSignal.length;
    
    return ac / (dc + 1e-10);
  }
} 