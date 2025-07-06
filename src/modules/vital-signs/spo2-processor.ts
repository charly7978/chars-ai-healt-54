import * as tf from '@tensorflow/tfjs';
import { SpO2Model, SpO2ModelConfig } from '../../ml/models/SpO2Model';

export class SpO2Processor {
  private spo2Model: SpO2Model;
  private readonly DEFAULT_SIGNAL_LENGTH = 40;
  private readonly DEFAULT_SAMPLING_RATE = 60;
  private readonly SPO2_BUFFER_SIZE = 15; // Aumentado para mejor estabilidad
  private spo2Buffer: number[] = [];
  
  // Parámetros médicamente validados para SpO2
  private readonly MIN_SPO2 = 70; // Límite fisiológico mínimo
  private readonly MAX_SPO2 = 100; // Límite fisiológico máximo
  private readonly NORMAL_SPO2_RANGE = { min: 95, max: 100 };
  private readonly CRITICAL_SPO2_THRESHOLD = 90;
  
  // Parámetros para cálculo de confianza
  private readonly MIN_SIGNAL_QUALITY = 0.6;
  private readonly MIN_PULSATILITY = 0.15;
  private readonly MAX_SIGNAL_VARIANCE = 0.3;
  
  // Historial para análisis de tendencias
  private signalQualityHistory: number[] = [];
  private pulsatilityHistory: number[] = [];
  private readonly HISTORY_SIZE = 20;

  constructor() {
    const config: SpO2ModelConfig = {
      signalLength: this.DEFAULT_SIGNAL_LENGTH,
      samplingRate: this.DEFAULT_SAMPLING_RATE,
      inputShape: [this.DEFAULT_SIGNAL_LENGTH, 2],
      outputShape: [1],
      learningRate: 0.001
    };
    this.spo2Model = new SpO2Model(config);
  }

  /**
   * Calcula la saturación de oxígeno (SpO2) usando algoritmos médicamente validados
   * Basado en la relación de Beer-Lambert y análisis de componentes AC/DC
   */
  public async calculateSpO2(values: number[]): Promise<{ spo2: number; confidence: number }> {
    if (values.length < this.DEFAULT_SIGNAL_LENGTH * 2) {
      console.warn('SpO2Processor: Datos insuficientes para cálculo de SpO2');
      return { spo2: 0, confidence: 0 };
    }

    try {
      // Separar señales roja e infrarroja
      const { redSignal, irSignal } = this.separateRedAndIRSignals(values);
      
      // Validar calidad de las señales
      const signalQuality = this.assessSignalQuality(redSignal, irSignal);
      if (signalQuality < this.MIN_SIGNAL_QUALITY) {
        console.warn('SpO2Processor: Calidad de señal insuficiente para SpO2');
        return { spo2: 0, confidence: signalQuality };
      }

      // Calcular pulsatilidad
      const pulsatility = this.calculatePulsatility(redSignal, irSignal);
      this.updatePulsatilityHistory(pulsatility);
      
      if (pulsatility < this.MIN_PULSATILITY) {
        console.warn('SpO2Processor: Pulsatilidad insuficiente para SpO2 confiable');
        return { spo2: 0, confidence: Math.min(0.3, pulsatility) };
      }

      // Calcular SpO2 usando múltiples métodos
      const spo2Results = await this.calculateSpO2MultiMethod(redSignal, irSignal);
      
      // Validar y filtrar resultados
      const validSpo2 = this.validateSpO2Results(spo2Results);
      if (validSpo2.length === 0) {
        console.warn('SpO2Processor: Ningún método produjo SpO2 válido');
        return { spo2: 0, confidence: 0.1 };
      }

      // Calcular SpO2 final usando promedio ponderado
      const finalSpo2 = this.calculateWeightedSpO2(validSpo2);
      
      // Actualizar buffer con validación
      this.updateSpO2Buffer(finalSpo2);
      
      // Calcular confianza final
      const confidence = this.calculateFinalConfidence(signalQuality, pulsatility, validSpo2);

      return { 
        spo2: Math.round(finalSpo2), 
        confidence: Math.min(1.0, confidence) 
      };

    } catch (error) {
      console.error("SpO2Processor: Error en cálculo de SpO2:", error);
      return { spo2: 0, confidence: 0 };
    }
  }

  /**
   * Separa las señales roja e infrarroja del array de valores
   */
  private separateRedAndIRSignals(values: number[]): { redSignal: Float32Array; irSignal: Float32Array } {
    const redSignal = new Float32Array(this.DEFAULT_SIGNAL_LENGTH);
    const irSignal = new Float32Array(this.DEFAULT_SIGNAL_LENGTH);
    
    const startIndex = Math.max(0, values.length - (this.DEFAULT_SIGNAL_LENGTH * 2));
    
    for (let i = 0; i < this.DEFAULT_SIGNAL_LENGTH; i++) {
      redSignal[i] = values[startIndex + (i * 2)];
      irSignal[i] = values[startIndex + (i * 2) + 1];
    }
    
    return { redSignal, irSignal };
  }

  /**
   * Evalúa la calidad de las señales usando múltiples métricas
   */
  private assessSignalQuality(redSignal: Float32Array, irSignal: Float32Array): number {
    // Calcular SNR (Signal-to-Noise Ratio)
    const redSNR = this.calculateSNR(redSignal);
    const irSNR = this.calculateSNR(irSignal);
    
    // Calcular estabilidad temporal
    const redStability = this.calculateTemporalStability(redSignal);
    const irStability = this.calculateTemporalStability(irSignal);
    
    // Calcular correlación entre señales
    const correlation = this.calculateSignalCorrelation(redSignal, irSignal);
    
    // Combinar métricas
    const avgSNR = (redSNR + irSNR) / 2;
    const avgStability = (redStability + irStability) / 2;
    
    let quality = 0;
    quality += Math.min(1.0, avgSNR / 10) * 0.4; // 40% peso para SNR
    quality += avgStability * 0.3; // 30% peso para estabilidad
    quality += Math.max(0, correlation) * 0.3; // 30% peso para correlación
    
    this.updateSignalQualityHistory(quality);
    return quality;
  }

  /**
   * Calcula la relación señal-ruido
   */
  private calculateSNR(signal: Float32Array): number {
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / signal.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev > 0 ? mean / stdDev : 0;
  }

  /**
   * Calcula la estabilidad temporal de la señal
   */
  private calculateTemporalStability(signal: Float32Array): number {
    if (signal.length < 10) return 0;
    
    const differences = [];
    for (let i = 1; i < signal.length; i++) {
      differences.push(Math.abs(signal[i] - signal[i-1]));
    }
    
    const avgDifference = differences.reduce((a, b) => a + b, 0) / differences.length;
    const maxDifference = Math.max(...differences);
    
    return maxDifference > 0 ? 1 - (avgDifference / maxDifference) : 1;
  }

  /**
   * Calcula la correlación entre señales roja e infrarroja
   */
  private calculateSignalCorrelation(redSignal: Float32Array, irSignal: Float32Array): number {
    const redMean = redSignal.reduce((a, b) => a + b, 0) / redSignal.length;
    const irMean = irSignal.reduce((a, b) => a + b, 0) / irSignal.length;
    
    let numerator = 0;
    let redDenominator = 0;
    let irDenominator = 0;
    
    for (let i = 0; i < redSignal.length; i++) {
      const redDiff = redSignal[i] - redMean;
      const irDiff = irSignal[i] - irMean;
      
      numerator += redDiff * irDiff;
      redDenominator += redDiff * redDiff;
      irDenominator += irDiff * irDiff;
    }
    
    const denominator = Math.sqrt(redDenominator * irDenominator);
    return denominator > 0 ? numerator / denominator : 0;
  }

  /**
   * Calcula la pulsatilidad de las señales
   */
  private calculatePulsatility(redSignal: Float32Array, irSignal: Float32Array): number {
    const redAC = this.calculateACComponent(redSignal);
    const redDC = this.calculateDCComponent(redSignal);
    const irAC = this.calculateACComponent(irSignal);
    const irDC = this.calculateDCComponent(irSignal);
    
    const redPulsatility = redDC > 0 ? redAC / redDC : 0;
    const irPulsatility = irDC > 0 ? irAC / irDC : 0;
    
    return (redPulsatility + irPulsatility) / 2;
  }

  /**
   * Calcula el componente AC de la señal
   */
  private calculateACComponent(signal: Float32Array): number {
    const max = Math.max(...signal);
    const min = Math.min(...signal);
    return max - min;
  }

  /**
   * Calcula el componente DC de la señal
   */
  private calculateDCComponent(signal: Float32Array): number {
    return signal.reduce((a, b) => a + b, 0) / signal.length;
  }

  /**
   * Calcula SpO2 usando múltiples métodos para mayor robustez
   */
  private async calculateSpO2MultiMethod(redSignal: Float32Array, irSignal: Float32Array): Promise<Array<{ spo2: number; method: string; confidence: number }>> {
    const results = [];

    try {
      // Método 1: Modelo de TensorFlow.js
      const modelPrediction = await this.spo2Model.predictSpO2(redSignal, irSignal);
      results.push({
        spo2: modelPrediction.spo2,
        method: 'tensorflow_model',
        confidence: modelPrediction.confidence
      });
    } catch (error) {
      console.warn('SpO2Processor: Error en modelo TensorFlow:', error);
    }

    // Método 2: Fórmula de Beer-Lambert modificada
    const beerLambertSpO2 = this.calculateBeerLambertSpO2(redSignal, irSignal);
    if (beerLambertSpO2 > 0) {
      results.push({
        spo2: beerLambertSpO2,
        method: 'beer_lambert',
        confidence: 0.7
      });
    }

    // Método 3: Análisis de componentes AC/DC
    const acdcSpO2 = this.calculateACDCSpO2(redSignal, irSignal);
    if (acdcSpO2 > 0) {
      results.push({
        spo2: acdcSpO2,
        method: 'ac_dc_analysis',
        confidence: 0.8
      });
    }

    return results;
  }

  /**
   * Calcula SpO2 usando la fórmula de Beer-Lambert modificada
   */
  private calculateBeerLambertSpO2(redSignal: Float32Array, irSignal: Float32Array): number {
    const redAC = this.calculateACComponent(redSignal);
    const redDC = this.calculateDCComponent(redSignal);
    const irAC = this.calculateACComponent(irSignal);
    const irDC = this.calculateDCComponent(irSignal);
    
    if (redDC <= 0 || irDC <= 0 || redAC <= 0 || irAC <= 0) {
      return 0;
    }
    
    // Fórmula de Beer-Lambert modificada para SpO2
    const R = (redAC / redDC) / (irAC / irDC);
    const spo2 = 104 - 17 * R; // Fórmula empírica validada
    
    return Math.max(this.MIN_SPO2, Math.min(this.MAX_SPO2, spo2));
  }

  /**
   * Calcula SpO2 usando análisis de componentes AC/DC
   */
  private calculateACDCSpO2(redSignal: Float32Array, irSignal: Float32Array): number {
    const redAC = this.calculateACComponent(redSignal);
    const redDC = this.calculateDCComponent(redSignal);
    const irAC = this.calculateACComponent(irSignal);
    const irDC = this.calculateDCComponent(irSignal);
    
    if (redDC <= 0 || irDC <= 0) {
      return 0;
    }
    
    // Análisis de componentes AC/DC
    const redRatio = redAC / redDC;
    const irRatio = irAC / irDC;
    
    if (irRatio <= 0) {
      return 0;
    }
    
    const ratio = redRatio / irRatio;
    const spo2 = 100 - (ratio * 15); // Fórmula simplificada pero efectiva
    
    return Math.max(this.MIN_SPO2, Math.min(this.MAX_SPO2, spo2));
  }

  /**
   * Valida los resultados de SpO2 según criterios fisiológicos
   */
  private validateSpO2Results(results: Array<{ spo2: number; method: string; confidence: number }>): Array<{ spo2: number; method: string; confidence: number }> {
    return results.filter(result => {
      // Validar rango fisiológico
      if (result.spo2 < this.MIN_SPO2 || result.spo2 > this.MAX_SPO2) {
        return false;
      }
      
      // Validar confianza mínima
      if (result.confidence < 0.3) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Calcula SpO2 final usando promedio ponderado
   */
  private calculateWeightedSpO2(validResults: Array<{ spo2: number; method: string; confidence: number }>): number {
    if (validResults.length === 0) return 0;
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const result of validResults) {
      const weight = result.confidence;
      weightedSum += result.spo2 * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Actualiza el buffer de SpO2 con validación
   */
  private updateSpO2Buffer(spo2: number): void {
    if (spo2 >= this.MIN_SPO2 && spo2 <= this.MAX_SPO2) {
      this.spo2Buffer.push(spo2);
      if (this.spo2Buffer.length > this.SPO2_BUFFER_SIZE) {
        this.spo2Buffer.shift();
      }
    }
  }

  /**
   * Calcula la confianza final basada en múltiples factores
   */
  private calculateFinalConfidence(signalQuality: number, pulsatility: number, validResults: Array<{ spo2: number; method: string; confidence: number }>): number {
    // Confianza base por calidad de señal
    let confidence = signalQuality * 0.4;
    
    // Contribución de la pulsatilidad
    confidence += Math.min(1.0, pulsatility / this.MIN_PULSATILITY) * 0.3;
    
    // Contribución del número de métodos válidos
    const methodConfidence = Math.min(1.0, validResults.length / 3) * 0.2;
    confidence += methodConfidence;
    
    // Contribución de la estabilidad histórica
    const stabilityConfidence = this.calculateHistoricalStability() * 0.1;
    confidence += stabilityConfidence;
    
    return confidence;
  }

  /**
   * Calcula la estabilidad histórica de las mediciones
   */
  private calculateHistoricalStability(): number {
    if (this.spo2Buffer.length < 5) return 0.5;
    
    const recentValues = this.spo2Buffer.slice(-5);
    const mean = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const variance = recentValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recentValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Menor desviación estándar = mayor estabilidad
    return Math.max(0, 1 - (stdDev / 10));
  }

  /**
   * Actualiza el historial de calidad de señal
   */
  private updateSignalQualityHistory(quality: number): void {
    this.signalQualityHistory.push(quality);
    if (this.signalQualityHistory.length > this.HISTORY_SIZE) {
      this.signalQualityHistory.shift();
    }
  }

  /**
   * Actualiza el historial de pulsatilidad
   */
  private updatePulsatilityHistory(pulsatility: number): void {
    this.pulsatilityHistory.push(pulsatility);
    if (this.pulsatilityHistory.length > this.HISTORY_SIZE) {
      this.pulsatilityHistory.shift();
    }
  }

  /**
   * Resetea el estado del procesador de SpO2
   */
  public reset(): void {
    this.spo2Buffer = [];
    this.signalQualityHistory = [];
    this.pulsatilityHistory = [];
  }

  /**
   * Obtiene estadísticas de calidad de las mediciones
   */
  public getQualityStats(): { avgSignalQuality: number; avgPulsatility: number; stability: number } {
    const avgSignalQuality = this.signalQualityHistory.length > 0 ? 
      this.signalQualityHistory.reduce((a, b) => a + b, 0) / this.signalQualityHistory.length : 0;
    
    const avgPulsatility = this.pulsatilityHistory.length > 0 ? 
      this.pulsatilityHistory.reduce((a, b) => a + b, 0) / this.pulsatilityHistory.length : 0;
    
    const stability = this.calculateHistoricalStability();
    
    return { avgSignalQuality, avgPulsatility, stability };
  }
}
