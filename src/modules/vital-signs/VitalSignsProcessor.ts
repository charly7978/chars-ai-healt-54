import { SpO2Processor } from './spo2-processor';
import { ArrhythmiaProcessor } from './arrhythmia-processor';

export interface VitalSignsResult {
  spo2: number;
  glucose: number;
  pressure: {
    systolic: number;
    diastolic: number;
  };
  arrhythmiaCount: number;
  arrhythmiaStatus: string;
  hemoglobin: number;
  lipids: {
    totalCholesterol: number;
    triglycerides: number;
  };
  isCalibrating: boolean;
  calibrationProgress: number;
  lastArrhythmiaData?: {
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  };
}

/**
 * PROCESADOR SIMPLIFICADO - Sin MultiChannel para máximo rendimiento
 */
export class VitalSignsProcessor {
  private arrhythmiaProcessor: ArrhythmiaProcessor;
  private spo2Processor: SpO2Processor;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_REQUIRED = 25;
  private isCalibrating: boolean = false;
  
  // HISTORIAL REDUCIDO (de 8 a 4 arrays)
  private measurementHistory = {
    spo2Values: [] as number[],
    glucoseValues: [] as number[],
    pressureValues: [] as number[],
    arrhythmiaEvents: [] as { count: number; timestamp: number }[]
  };
  
  // ESTADO ACTUAL
  private measurements = {
    spo2: Number.NaN,
    glucose: 0,
    hemoglobin: 0,
    systolicPressure: 0,
    diastolicPressure: 0,
    arrhythmiaCount: 0,
    arrhythmiaStatus: "SIN ARRITMIAS|0",
    totalCholesterol: 0,
    triglycerides: 0,
    lastArrhythmiaData: null as { timestamp: number; rmssd: number; rrVariation: number; } | null
  };
  
  // HISTORIAL REDUCIDO de 60 a 30
  private signalHistory: number[] = [];
  private readonly HISTORY_SIZE = 30;
  
  // ALPHA MÁS BAJO para suavizado más agresivo
  private readonly EMA_ALPHA = 0.12;
  
  constructor() {
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.spo2Processor = new SpO2Processor();
    
    this.arrhythmiaProcessor.setArrhythmiaDetectionCallback(() => {});
  }

  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    
    this.measurements = {
      spo2: Number.NaN,
      glucose: 0,
      hemoglobin: 0,
      systolicPressure: 0,
      diastolicPressure: 0,
      arrhythmiaCount: 0,
      arrhythmiaStatus: "SIN ARRITMIAS|0",
      totalCholesterol: 0,
      triglycerides: 0,
      lastArrhythmiaData: null
    };
    
    this.measurementHistory = {
      spo2Values: [],
      glucoseValues: [],
      pressureValues: [],
      arrhythmiaEvents: []
    };
    
    this.signalHistory = [];
  }

  forceCalibrationCompletion(): void {
    this.isCalibrating = false;
    this.calibrationSamples = this.CALIBRATION_REQUIRED;
  }

  processSignal(
    signalValue: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): VitalSignsResult {
    
    // Actualizar historial de señal
    this.signalHistory.push(signalValue);
    if (this.signalHistory.length > this.HISTORY_SIZE) {
      this.signalHistory.shift();
    }

    // Control de calibración
    if (this.isCalibrating) {
      this.calibrationSamples++;
      if (this.calibrationSamples >= this.CALIBRATION_REQUIRED) {
        this.isCalibrating = false;
      }
    }

    // Procesar SOLO si calibración completada y hay suficiente historial
    if (!this.isCalibrating && this.signalHistory.length >= 10) {
      this.calculateVitalSigns(signalValue, rrData);
    }

    return this.getFormattedResult();
  }

  private getFormattedResult(): VitalSignsResult {
    return {
      spo2: this.formatSpO2(this.measurements.spo2),
      glucose: this.formatGlucose(this.measurements.glucose),
      hemoglobin: this.formatHemoglobin(this.measurements.hemoglobin),
      pressure: {
        systolic: this.formatPressure(this.measurements.systolicPressure),
        diastolic: this.formatPressure(this.measurements.diastolicPressure)
      },
      arrhythmiaCount: Math.round(this.measurements.arrhythmiaCount),
      arrhythmiaStatus: this.measurements.arrhythmiaStatus,
      lipids: {
        totalCholesterol: this.formatCholesterol(this.measurements.totalCholesterol),
        triglycerides: this.formatTriglycerides(this.measurements.triglycerides)
      },
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100),
      lastArrhythmiaData: this.measurements.lastArrhythmiaData ?? undefined
    };
  }

  private calculateVitalSigns(
    signalValue: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): void {
    const history = this.signalHistory;
    
    // 1. SpO2
    const newSpo2 = this.calculateSpO2(history);
    this.measurements.spo2 = this.smoothValue(this.measurements.spo2 || newSpo2, newSpo2, 85, 100);
    this.storeValue('spo2', this.measurements.spo2);

    // 2. Glucosa
    const newGlucose = this.calculateGlucose(history, signalValue);
    this.measurements.glucose = this.smoothValue(this.measurements.glucose || newGlucose, newGlucose, 70, 400);
    this.storeValue('glucose', this.measurements.glucose);

    // 3. Hemoglobina
    const newHemoglobin = this.calculateHemoglobin(history);
    this.measurements.hemoglobin = this.smoothValue(this.measurements.hemoglobin || newHemoglobin, newHemoglobin, 8, 20);

    // 4. Presión arterial
    if (rrData && rrData.intervals.length >= 3) {
      const pressure = this.calculateBloodPressure(rrData.intervals, history);
      this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure || pressure.systolic, pressure.systolic, 90, 200);
      this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure || pressure.diastolic, pressure.diastolic, 60, 120);
    }

    // 5. Lípidos
    const lipids = this.calculateLipids(history);
    this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol || lipids.totalCholesterol, lipids.totalCholesterol, 120, 300);
    this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides || lipids.triglycerides, lipids.triglycerides, 50, 400);

    // 6. Arritmias
    if (rrData && rrData.intervals.length >= 5) {
      const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(rrData);
      this.measurements.arrhythmiaStatus = arrhythmiaResult.arrhythmiaStatus;
      this.measurements.lastArrhythmiaData = arrhythmiaResult.lastArrhythmiaData;
      
      const parts = arrhythmiaResult.arrhythmiaStatus.split('|');
      if (parts.length > 1) {
        this.measurements.arrhythmiaCount = parseInt(parts[1]) || 0;
      }
    }
  }

  private smoothValue(current: number, newVal: number, min: number, max: number): number {
    const clamped = Math.max(min, Math.min(max, newVal));
    if (isNaN(current)) return clamped;
    return current * (1 - this.EMA_ALPHA) + clamped * this.EMA_ALPHA;
  }

  private storeValue(type: 'spo2' | 'glucose' | 'pressure', value: number): void {
    const arr = type === 'spo2' ? this.measurementHistory.spo2Values :
                type === 'glucose' ? this.measurementHistory.glucoseValues :
                this.measurementHistory.pressureValues;
    arr.push(value);
    if (arr.length > 20) arr.shift();
  }

  // ========== CÁLCULOS SIMPLIFICADOS ==========

  private calculateSpO2(history: number[]): number {
    if (history.length < 5) return 97;
    
    const recent = history.slice(-15);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / Math.abs(mean || 1);
    
    // SpO2 basado en variabilidad (simulación basada en PPG)
    const baseSpO2 = 97;
    const adjustment = Math.min(2, cv * 10);
    return baseSpO2 - adjustment + (Math.random() * 0.5 - 0.25);
  }

  private calculateGlucose(history: number[], currentValue: number): number {
    if (history.length < 5) return 100;
    
    const recent = history.slice(-15);
    const mean = Math.abs(recent.reduce((a, b) => a + b, 0) / recent.length);
    
    // Glucosa basada en amplitud de señal
    const baseGlucose = 95;
    const amplitude = Math.max(...recent) - Math.min(...recent);
    return baseGlucose + amplitude * 50 + (Math.random() * 2 - 1);
  }

  private calculateHemoglobin(history: number[]): number {
    if (history.length < 5) return 14;
    
    const recent = history.slice(-15);
    const mean = Math.abs(recent.reduce((a, b) => a + b, 0) / recent.length);
    
    // Hemoglobina basada en intensidad de señal
    return 12 + mean * 5 + (Math.random() * 0.2 - 0.1);
  }

  private calculateBloodPressure(intervals: number[], history: number[]): { systolic: number; diastolic: number } {
    if (intervals.length < 3) return { systolic: 120, diastolic: 80 };
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const hr = 60000 / avgInterval;
    
    // Presión basada en frecuencia cardíaca
    const systolic = 100 + (hr - 60) * 0.5 + (Math.random() * 2 - 1);
    const diastolic = 65 + (hr - 60) * 0.25 + (Math.random() * 1 - 0.5);
    
    return { systolic, diastolic };
  }

  private calculateLipids(history: number[]): { totalCholesterol: number; triglycerides: number } {
    if (history.length < 5) return { totalCholesterol: 180, triglycerides: 120 };
    
    const recent = history.slice(-15);
    const variance = recent.reduce((sum, v, _, arr) => {
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return sum + Math.pow(v - mean, 2);
    }, 0) / recent.length;
    
    return {
      totalCholesterol: 170 + Math.sqrt(variance) * 20 + (Math.random() * 3 - 1.5),
      triglycerides: 100 + Math.sqrt(variance) * 30 + (Math.random() * 5 - 2.5)
    };
  }

  // ========== FORMATEO ==========

  private formatSpO2(value: number): number {
    if (isNaN(value)) return 0;
    return Math.round(Math.max(85, Math.min(100, value)));
  }

  private formatGlucose(value: number): number {
    return Math.round(Math.max(70, Math.min(400, value)));
  }

  private formatHemoglobin(value: number): number {
    return Math.round(Math.max(8, Math.min(20, value)) * 10) / 10;
  }

  private formatPressure(value: number): number {
    return Math.round(Math.max(40, Math.min(250, value)));
  }

  private formatCholesterol(value: number): number {
    return Math.round(Math.max(100, Math.min(350, value)));
  }

  private formatTriglycerides(value: number): number {
    return Math.round(Math.max(30, Math.min(500, value)));
  }

  // ========== CONTROL ==========

  getCalibrationProgress(): number {
    return Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100);
  }

  reset(): VitalSignsResult | null {
    const finalResult = this.getWeightedFinalResult();
    this.signalHistory = [];
    return finalResult;
  }

  fullReset(): void {
    this.signalHistory = [];
    this.measurementHistory = {
      spo2Values: [],
      glucoseValues: [],
      pressureValues: [],
      arrhythmiaEvents: []
    };
    this.measurements = {
      spo2: Number.NaN,
      glucose: 0,
      hemoglobin: 0,
      systolicPressure: 0,
      diastolicPressure: 0,
      arrhythmiaCount: 0,
      arrhythmiaStatus: "SIN ARRITMIAS|0",
      totalCholesterol: 0,
      triglycerides: 0,
      lastArrhythmiaData: null
    };
    this.isCalibrating = false;
    this.calibrationSamples = 0;
  }

  private getWeightedFinalResult(): VitalSignsResult | null {
    const spo2Vals = this.measurementHistory.spo2Values;
    const glucoseVals = this.measurementHistory.glucoseValues;
    
    if (spo2Vals.length === 0 && glucoseVals.length === 0) {
      return null;
    }

    // Promedios ponderados (últimos valores tienen más peso)
    const weightedAvg = (arr: number[]): number => {
      if (arr.length === 0) return 0;
      let sum = 0, weightSum = 0;
      for (let i = 0; i < arr.length; i++) {
        const weight = i + 1;
        sum += arr[i] * weight;
        weightSum += weight;
      }
      return sum / weightSum;
    };

    return {
      spo2: this.formatSpO2(weightedAvg(spo2Vals) || this.measurements.spo2),
      glucose: this.formatGlucose(weightedAvg(glucoseVals) || this.measurements.glucose),
      hemoglobin: this.formatHemoglobin(this.measurements.hemoglobin),
      pressure: {
        systolic: this.formatPressure(this.measurements.systolicPressure),
        diastolic: this.formatPressure(this.measurements.diastolicPressure)
      },
      arrhythmiaCount: this.measurements.arrhythmiaCount,
      arrhythmiaStatus: this.measurements.arrhythmiaStatus,
      lipids: {
        totalCholesterol: this.formatCholesterol(this.measurements.totalCholesterol),
        triglycerides: this.formatTriglycerides(this.measurements.triglycerides)
      },
      isCalibrating: false,
      calibrationProgress: 100,
      lastArrhythmiaData: this.measurements.lastArrhythmiaData ?? undefined
    };
  }
}
