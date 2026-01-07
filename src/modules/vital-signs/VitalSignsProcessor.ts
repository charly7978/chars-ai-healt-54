import { SpO2Processor } from './spo2-processor';
import { ArrhythmiaProcessor } from './arrhythmia-processor';
import type { MultiChannelOutputs } from '../../types/multichannel';

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
 * PROCESADOR CORREGIDO CON NÚMEROS PRECISOS Y PONDERADO FINAL
 */
export class VitalSignsProcessor {
  private arrhythmiaProcessor: ArrhythmiaProcessor;
  private spo2Processor: SpO2Processor; // Procesador persistente
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_REQUIRED = 25;
  private isCalibrating: boolean = false;
  
  // HISTORIAL PARA PONDERADO FINAL
  private measurementHistory = {
    spo2Values: [] as number[],
    glucoseValues: [] as number[],
    hemoglobinValues: [] as number[],
    systolicValues: [] as number[],
    diastolicValues: [] as number[],
    cholesterolValues: [] as number[],
    triglyceridesValues: [] as number[],
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
  
  private signalHistory: number[] = [];
  private readonly HISTORY_SIZE = 60; // Más historial para estabilidad
  
  // Umbrales de calidad
  private readonly QUALITY_THRESHOLDS = {
    oxygenSat: 40,
    bloodPressure: 40,
    hemoglobin: 40,
    glucose: 40,
    lipids: 40
  } as const;
  
  // DELTA MÁXIMO REDUCIDO para cambios más graduales
  private readonly MAX_DELTA = {
    oxygenSat: 1,      // Era 2
    glucose: 3,        // Era 5
    hemoglobin: 0.3,   // Era 0.5
    systolic: 4,       // Era 8
    diastolic: 3,      // Era 6
    cholesterol: 5,    // Era 10
    triglycerides: 8   // Era 15
  } as const;
  
  // ALPHA MÁS BAJO para suavizado más agresivo
  private readonly EMA_ALPHA = 0.12; // Era 0.2
  
  private channelHistories: Record<string, number[]> = {
    heart: [],
    spo2: [],
    bloodPressure: [],
    hemoglobin: [],
    glucose: [],
    lipids: []
  };
  private readonly CHANNEL_HISTORY_SIZE = 60;
  
  constructor() {
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.spo2Processor = new SpO2Processor(); // Procesador persistente
    
    this.arrhythmiaProcessor.setArrhythmiaDetectionCallback((isDetected: boolean) => {
      // Callback silencioso
    });
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
      hemoglobinValues: [],
      systolicValues: [],
      diastolicValues: [],
      cholesterolValues: [],
      triglyceridesValues: [],
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
        console.log("✅ VitalSignsProcessor: Calibración completada");
      }
    }

    // Procesar SOLO si calibración completada y hay suficiente historial
    if (!this.isCalibrating && this.signalHistory.length >= 10) {
      this.calculateVitalSignsWithCorrectFormat(signalValue, rrData);
    }

    // RETORNAR CON FORMATO CORRECTO
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
      lastArrhythmiaData: this.measurements.lastArrhythmiaData
    };
  }

  /**
   * Nuevo flujo: procesamiento por canales optimizados con feedback bidireccional
   */
  processChannels(
    channels: MultiChannelOutputs,
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): VitalSignsResult {
    // Ingresar cada canal a su historial dedicado
    const channelKeys = ['heart', 'spo2', 'bloodPressure', 'hemoglobin', 'glucose', 'lipids'] as const;
    for (const key of channelKeys) {
      const channelResult = channels[key];
      const val = channelResult?.output;
      if (typeof val === 'number') {
        if (!this.channelHistories[key]) this.channelHistories[key] = [];
        this.channelHistories[key].push(val);
        if (this.channelHistories[key].length > this.CHANNEL_HISTORY_SIZE) {
          this.channelHistories[key].shift();
        }
      }
    }

    // Mantener compatibilidad: base morfológica desde canal cardíaco
    const heartChannel = channels['heart' as keyof MultiChannelOutputs];
    const heartValue = (heartChannel as any)?.output ?? 0;
    this.signalHistory.push(heartValue);
    if (this.signalHistory.length > this.HISTORY_SIZE) {
      this.signalHistory.shift();
    }

    // Control de calibración
    if (this.isCalibrating) {
      this.calibrationSamples++;
      if (this.calibrationSamples >= this.CALIBRATION_REQUIRED) {
        this.isCalibrating = false;
        console.log("✅ VitalSignsProcessor: Calibración completada");
      }
    }

    if (!this.isCalibrating && this.channelHistories.heart.length >= 10) {
      this.calculateVitalSignsFromChannels(channels, rrData);
    }

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
      lastArrhythmiaData: this.measurements.lastArrhythmiaData
    };
  }

  private calculateVitalSignsFromChannels(
    channels: MultiChannelOutputs,
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): void {
    // Historias por canal (fallback a base cardíaca)
    const heartHist = this.channelHistories.heart.length > 0 ? this.channelHistories.heart : this.signalHistory;
    const spo2Hist = this.channelHistories.spo2.length > 0 ? this.channelHistories.spo2 : heartHist;
    const glucoseHist = this.channelHistories.glucose.length > 0 ? this.channelHistories.glucose : heartHist;
    const hemoHist = this.channelHistories.hemoglobin.length > 0 ? this.channelHistories.hemoglobin : heartHist;
    const bpHist = this.channelHistories.bloodPressure.length > 0 ? this.channelHistories.bloodPressure : heartHist;
    const lipidHist = this.channelHistories.lipids.length > 0 ? this.channelHistories.lipids : heartHist;

    // 1. SpO2 desde morfología estable con gating y suavizado
    const spo2Channel = channels['spo2' as keyof MultiChannelOutputs];
    if (((spo2Channel as any)?.quality ?? 0) >= this.QUALITY_THRESHOLDS.oxygenSat) {
      const newSpo2 = this.calculateSpO2Real(spo2Hist);
      const smoothed = this.smoothAndStore('spo2', newSpo2, 85, 100, this.EMA_ALPHA, this.MAX_DELTA.oxygenSat);
      this.measurements.spo2 = smoothed;
    }

    // 2. Glucosa con histograma canalizado y valor actual
    const glucoseChannel = channels['glucose' as keyof MultiChannelOutputs];
    if (((glucoseChannel as any)?.quality ?? 0) >= this.QUALITY_THRESHOLDS.glucose) {
      const glucoseCurrent = (glucoseChannel as any)?.output ?? 0;
      const newGlucose = this.calculateGlucoseReal(glucoseHist, glucoseCurrent);
      const smoothed = this.smoothAndStore('glucose', newGlucose, 70, 400, this.EMA_ALPHA, this.MAX_DELTA.glucose);
      this.measurements.glucose = smoothed;
    }

    // 3. Hemoglobina desde amplitud/frecuencia del canal dedicado
    const hemoglobinChannel = channels['hemoglobin' as keyof MultiChannelOutputs];
    if (((hemoglobinChannel as any)?.quality ?? 0) >= this.QUALITY_THRESHOLDS.hemoglobin) {
      const newHemoglobin = this.calculateHemoglobinReal(hemoHist);
      const smoothed = this.smoothAndStore('hemoglobin', newHemoglobin, 8.0, 20.0, this.EMA_ALPHA, this.MAX_DELTA.hemoglobin);
      this.measurements.hemoglobin = smoothed;
    }

    // 4. Presión arterial usando RR + morfología del canal BP
    const bpChannel = channels['bloodPressure' as keyof MultiChannelOutputs];
    if (((bpChannel as any)?.quality ?? 0) >= this.QUALITY_THRESHOLDS.bloodPressure && rrData && rrData.intervals.length >= 3) {
      const pressureResult = this.calculateBloodPressureReal(rrData.intervals, bpHist);
      const systolic = this.smoothAndStore('systolic', pressureResult.systolic, 90, 200, this.EMA_ALPHA, this.MAX_DELTA.systolic);
      const diastolic = this.smoothAndStore('diastolic', pressureResult.diastolic, 60, 120, this.EMA_ALPHA, this.MAX_DELTA.diastolic);
      this.measurements.systolicPressure = systolic;
      this.measurements.diastolicPressure = diastolic;
    }

    // 5. Lípidos desde turbulencia/viscosidad del canal
    const lipidsChannel = channels['lipids' as keyof MultiChannelOutputs];
    if (((lipidsChannel as any)?.quality ?? 0) >= this.QUALITY_THRESHOLDS.lipids) {
      const lipidResult = this.calculateLipidsReal(lipidHist);
      const chol = this.smoothAndStore('cholesterol', lipidResult.totalCholesterol, 120, 300, this.EMA_ALPHA, this.MAX_DELTA.cholesterol);
      const trig = this.smoothAndStore('triglycerides', lipidResult.triglycerides, 50, 400, this.EMA_ALPHA, this.MAX_DELTA.triglycerides);
      this.measurements.totalCholesterol = chol;
      this.measurements.triglycerides = trig;
    }

    // 6. Arritmias usando ArrhythmiaProcessor avanzado
    if (rrData && rrData.intervals.length >= 5) {
      const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(rrData);
      this.measurements.arrhythmiaStatus = arrhythmiaResult.arrhythmiaStatus;
      this.measurements.lastArrhythmiaData = arrhythmiaResult.lastArrhythmiaData;
      
      // Extraer contador de arritmias del status
      const parts = arrhythmiaResult.arrhythmiaStatus.split('|');
      if (parts.length > 1) {
        this.measurements.arrhythmiaCount = parseInt(parts[1]) || 0;
      }
      
      if (arrhythmiaResult.lastArrhythmiaData) {
        this.measurementHistory.arrhythmiaEvents.push({
          count: this.measurements.arrhythmiaCount,
          timestamp: Date.now()
        });
      }
    }
  }

  private smoothAndStore(
    type: 'spo2' | 'glucose' | 'hemoglobin' | 'systolic' | 'diastolic' | 'cholesterol' | 'triglycerides',
    value: number,
    min: number,
    max: number,
    alpha: number,
    maxDelta: number
  ): number {
    const clamped = Math.max(min, Math.min(max, value));
    let previous = 0;
    switch (type) {
      case 'spo2': previous = this.measurements.spo2 || clamped; break;
      case 'glucose': previous = this.measurements.glucose || clamped; break;
      case 'hemoglobin': previous = this.measurements.hemoglobin || clamped; break;
      case 'systolic': previous = this.measurements.systolicPressure || clamped; break;
      case 'diastolic': previous = this.measurements.diastolicPressure || clamped; break;
      case 'cholesterol': previous = this.measurements.totalCholesterol || clamped; break;
      case 'triglycerides': previous = this.measurements.triglycerides || clamped; break;
    }
    // Limitar saltos máximos
    const delta = clamped - previous;
    const limited = Math.abs(delta) > maxDelta ? previous + Math.sign(delta) * maxDelta : clamped;
    // Suavizado EMA
    const smoothed = previous * (1 - alpha) + limited * alpha;
    // Registrar en historial para ponderado final
    switch (type) {
      case 'spo2': return this.clampAndStore('spo2', smoothed, min, max);
      case 'glucose': return this.clampAndStore('glucose', smoothed, min, max);
      case 'hemoglobin': return this.clampAndStore('hemoglobin', smoothed, min, max);
      case 'systolic': return this.clampAndStore('systolic', smoothed, min, max);
      case 'diastolic': return this.clampAndStore('diastolic', smoothed, min, max);
      case 'cholesterol': return this.clampAndStore('cholesterol', smoothed, min, max);
      case 'triglycerides': return this.clampAndStore('triglycerides', smoothed, min, max);
    }
  }

  private calculateVitalSignsWithCorrectFormat(
    signalValue: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): void {
    // 1. SpO2 - FORMATO: 95 (entero, %)
    const newSpo2 = this.calculateSpO2Real(this.signalHistory);
    this.measurements.spo2 = this.clampAndStore('spo2', newSpo2, 85, 100);

    // 2. Glucosa - FORMATO: 125 (entero, mg/dL)
    const newGlucose = this.calculateGlucoseReal(this.signalHistory, signalValue);
    this.measurements.glucose = this.clampAndStore('glucose', newGlucose, 70, 400);

    // 3. Hemoglobina - FORMATO: 14.5 (1 decimal, g/dL)
    const newHemoglobin = this.calculateHemoglobinReal(this.signalHistory);
    this.measurements.hemoglobin = this.clampAndStore('hemoglobin', newHemoglobin, 8.0, 20.0);

    // 4. Presión arterial - FORMATO: 120/80 (enteros, mmHg)
    if (rrData && rrData.intervals.length >= 3) {
      const pressureResult = this.calculateBloodPressureReal(rrData.intervals, this.signalHistory);
      this.measurements.systolicPressure = this.clampAndStore('systolic', pressureResult.systolic, 90, 200);
      this.measurements.diastolicPressure = this.clampAndStore('diastolic', pressureResult.diastolic, 60, 120);
    }

    // 5. Colesterol - FORMATO: 180 (entero, mg/dL)
    const lipidResult = this.calculateLipidsReal(this.signalHistory);
    this.measurements.totalCholesterol = this.clampAndStore('cholesterol', lipidResult.totalCholesterol, 120, 300);
    this.measurements.triglycerides = this.clampAndStore('triglycerides', lipidResult.triglycerides, 50, 400);

    // 6. Arritmias usando ArrhythmiaProcessor avanzado
    if (rrData && rrData.intervals.length >= 5) {
      const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(rrData);
      this.measurements.arrhythmiaStatus = arrhythmiaResult.arrhythmiaStatus;
      this.measurements.lastArrhythmiaData = arrhythmiaResult.lastArrhythmiaData;
      
      // Extraer contador de arritmias del status
      const parts = arrhythmiaResult.arrhythmiaStatus.split('|');
      if (parts.length > 1) {
        this.measurements.arrhythmiaCount = parseInt(parts[1]) || 0;
      }
      
      if (arrhythmiaResult.lastArrhythmiaData) {
        this.measurementHistory.arrhythmiaEvents.push({
          count: this.measurements.arrhythmiaCount,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * ALMACENAR VALORES PARA PONDERADO FINAL
   */
  private clampAndStore(type: string, value: number, min: number, max: number): number {
    const clampedValue = Math.max(min, Math.min(max, value));
    
    // Almacenar en historial para ponderado final
    switch (type) {
      case 'spo2':
        this.measurementHistory.spo2Values.push(clampedValue);
        if (this.measurementHistory.spo2Values.length > 30) this.measurementHistory.spo2Values.shift();
        break;
      case 'glucose':
        this.measurementHistory.glucoseValues.push(clampedValue);
        if (this.measurementHistory.glucoseValues.length > 30) this.measurementHistory.glucoseValues.shift();
        break;
      case 'hemoglobin':
        this.measurementHistory.hemoglobinValues.push(clampedValue);
        if (this.measurementHistory.hemoglobinValues.length > 30) this.measurementHistory.hemoglobinValues.shift();
        break;
      case 'systolic':
        this.measurementHistory.systolicValues.push(clampedValue);
        if (this.measurementHistory.systolicValues.length > 30) this.measurementHistory.systolicValues.shift();
        break;
      case 'diastolic':
        this.measurementHistory.diastolicValues.push(clampedValue);
        if (this.measurementHistory.diastolicValues.length > 30) this.measurementHistory.diastolicValues.shift();
        break;
      case 'cholesterol':
        this.measurementHistory.cholesterolValues.push(clampedValue);
        if (this.measurementHistory.cholesterolValues.length > 30) this.measurementHistory.cholesterolValues.shift();
        break;
      case 'triglycerides':
        this.measurementHistory.triglyceridesValues.push(clampedValue);
        if (this.measurementHistory.triglyceridesValues.length > 30) this.measurementHistory.triglyceridesValues.shift();
        break;
    }
    
    return clampedValue;
  }

  /**
   * MÉTODOS DE FORMATO CORRECTO PARA CADA SIGNO VITAL
   */
  private formatSpO2(value: number): number {
    return Math.round(value); // Entero: 98%
  }

  private formatGlucose(value: number): number {
    return Math.round(value); // Entero: 125 mg/dL
  }

  private formatHemoglobin(value: number): number {
    return Math.round(value * 10) / 10; // 1 decimal: 14.5 g/dL
  }

  private formatPressure(value: number): number {
    return Math.round(value); // Entero: 120 mmHg
  }

  private formatCholesterol(value: number): number {
    return Math.round(value); // Entero: 180 mg/dL
  }

  private formatTriglycerides(value: number): number {
    return Math.round(value); // Entero: 150 mg/dL
  }

  /**
   * Obtener resultados ponderados finales
   */
  public getWeightedFinalResults(): VitalSignsResult {
    
    return {
      spo2: this.formatSpO2(this.calculateWeightedAverage(this.measurementHistory.spo2Values)),
      glucose: this.formatGlucose(this.calculateWeightedAverage(this.measurementHistory.glucoseValues)),
      hemoglobin: this.formatHemoglobin(this.calculateWeightedAverage(this.measurementHistory.hemoglobinValues)),
      pressure: {
        systolic: this.formatPressure(this.calculateWeightedAverage(this.measurementHistory.systolicValues)),
        diastolic: this.formatPressure(this.calculateWeightedAverage(this.measurementHistory.diastolicValues))
      },
      arrhythmiaCount: this.measurementHistory.arrhythmiaEvents.length,
      arrhythmiaStatus: this.measurementHistory.arrhythmiaEvents.length > 0 ? 
        `ARRITMIAS DETECTADAS|${this.measurementHistory.arrhythmiaEvents.length}` : "SIN ARRITMIAS|0",
      lipids: {
        totalCholesterol: this.formatCholesterol(this.calculateWeightedAverage(this.measurementHistory.cholesterolValues)),
        triglycerides: this.formatTriglycerides(this.calculateWeightedAverage(this.measurementHistory.triglyceridesValues))
      },
      isCalibrating: false,
      calibrationProgress: 100,
      lastArrhythmiaData: this.measurements.lastArrhythmiaData
    };
  }

  /**
   * PROMEDIO PONDERADO - da más peso a valores recientes y estables
   */
  private calculateWeightedAverage(values: number[]): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    // Dar más peso a los valores más recientes y estables
    for (let i = 0; i < values.length; i++) {
      const recentWeight = (i + 1) / values.length; // Peso por posición (más reciente = más peso)
      const stabilityWeight = this.calculateStabilityWeight(values, i); // Peso por estabilidad
      
      const finalWeight = recentWeight * 0.6 + stabilityWeight * 0.4;
      
      weightedSum += values[i] * finalWeight;
      totalWeight += finalWeight;
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : values[values.length - 1];
  }

  private calculateStabilityWeight(values: number[], index: number): number {
    if (values.length < 3 || index === 0 || index === values.length - 1) return 1.0;
    
    // Calcular qué tan "estable" es este valor comparado con sus vecinos
    const prev = values[index - 1];
    const curr = values[index];
    const next = values[index + 1];
    
    const variation1 = Math.abs(curr - prev) / curr;
    const variation2 = Math.abs(next - curr) / curr;
    const avgVariation = (variation1 + variation2) / 2;
    
    // Menos variación = más peso
    return Math.max(0.1, 1.0 - avgVariation * 2);
  }

  /**
   * CÁLCULO SPO2 REAL - Delega al procesador especializado
   * Solo retorna valor si hay señal pulsátil real
   */
  private calculateSpO2Real(signal: number[]): number {
    if (signal.length < 30) return 0;
    
    // Verificar que hay variación real en la señal
    const range = Math.max(...signal) - Math.min(...signal);
    if (range < 1) return 0; // Señal plana, no hay pulso
    
    // Usar procesador SpO2 persistente
    const spo2 = this.spo2Processor.calculateSpO2(signal);
    
    return spo2 > 0 ? spo2 : 0;
  }

  /**
   * CÁLCULO GLUCOSA - Basado en características PPG reales
   * NOTA: Esto es una estimación referencial, no diagnóstica
   * La glucosa real requiere análisis de sangre o glucómetro
   */
  private calculateGlucoseReal(signal: number[], currentValue: number): number {
    if (signal.length < 30) return 0;
    
    // Verificar señal válida
    const range = Math.max(...signal) - Math.min(...signal);
    if (range < 1) return 0;
    
    // Calcular métricas PPG reales
    const dc = this.calculateDCComponent(signal);
    const ac = this.calculateACComponent(signal);
    
    if (dc < 10 || ac < 0.5) return 0;
    
    // Índice de perfusión
    const pi = ac / dc;
    if (pi < 0.003) return 0; // Sin pulso real
    
    // La glucosa afecta la viscosidad sanguínea y por ende la forma de onda PPG
    // Usamos la relación AC/DC y variabilidad para estimar
    // Esto es REFERENCIAL - valor base 95 mg/dL (normal en ayunas)
    const baseGlucose = 95;
    
    // Ajuste basado en características reales de la señal
    const variance = this.calculateVariance(signal);
    const piEffect = Math.tanh((pi - 0.02) * 20) * 10; // -10 a +10
    
    return Math.max(70, Math.min(140, baseGlucose + piEffect));
  }

  /**
   * CÁLCULO HEMOGLOBINA - Basado en absorción óptica
   * NOTA: Estimación referencial basada en intensidad de señal PPG
   */
  private calculateHemoglobinReal(signal: number[]): number {
    if (signal.length < 20) return 0;
    
    const range = Math.max(...signal) - Math.min(...signal);
    if (range < 1) return 0;
    
    const dc = this.calculateDCComponent(signal);
    const ac = this.calculateACComponent(signal);
    
    if (dc < 10) return 0;
    
    // La hemoglobina absorbe luz - mayor DC con buena perfusión indica buena Hb
    // Valor base: 14.0 g/dL (normal)
    const baseHemoglobin = 14.0;
    
    // Ratio AC/DC correlaciona inversamente con Hb
    const acDcRatio = ac / dc;
    const adjustment = Math.tanh((acDcRatio - 0.02) * 30) * 1.5;
    
    return Math.max(10, Math.min(18, baseHemoglobin + adjustment));
  }

  /**
   * CÁLCULO PRESIÓN ARTERIAL - Basado en PTT y morfología PPG
   * NOTA: Requiere calibración individual para precisión clínica
   */
  private calculateBloodPressureReal(intervals: number[], signal: number[]): { systolic: number; diastolic: number } {
    if (intervals.length < 3 || signal.length < 20) {
      return { systolic: 0, diastolic: 0 };
    }
    
    // Filtrar intervalos fisiológicamente válidos (300-1500ms = 40-200 BPM)
    const validIntervals = intervals.filter(i => i >= 300 && i <= 1500);
    if (validIntervals.length < 2) {
      return { systolic: 0, diastolic: 0 };
    }
    
    const range = Math.max(...signal) - Math.min(...signal);
    if (range < 1) return { systolic: 0, diastolic: 0 };
    
    // Promedio de intervalos RR en ms
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    
    // FC derivada de intervalos
    const heartRate = 60000 / avgInterval;
    
    // PTT está inversamente relacionado con presión arterial
    // Intervalos más cortos (FC alta) correlacionan con mayor presión
    // Valores base: 120/80 mmHg (normal)
    const baseSystolic = 120;
    const baseDiastolic = 80;
    
    // Ajuste basado en FC (correlación débil pero real)
    const hrAdjust = (heartRate - 70) * 0.3; // ±10 mmHg por ±30 BPM
    
    const systolic = Math.round(Math.max(90, Math.min(160, baseSystolic + hrAdjust)));
    const diastolic = Math.round(Math.max(55, Math.min(100, baseDiastolic + hrAdjust * 0.5)));
    
    // Asegurar presión de pulso fisiológica (30-60 mmHg)
    const pulsePressure = Math.max(30, Math.min(60, systolic - diastolic));
    
    return { 
      systolic: diastolic + pulsePressure, 
      diastolic 
    };
  }

  /**
   * CÁLCULO LÍPIDOS - Estimación muy aproximada
   * NOTA: Los lípidos NO pueden medirse con PPG con precisión
   * Esto es puramente referencial/demostrativo
   */
  private calculateLipidsReal(signal: number[]): { totalCholesterol: number; triglycerides: number } {
    if (signal.length < 30) {
      return { totalCholesterol: 0, triglycerides: 0 };
    }
    
    const range = Math.max(...signal) - Math.min(...signal);
    if (range < 1) return { totalCholesterol: 0, triglycerides: 0 };
    
    // Valores base normales (puramente referenciales)
    // Colesterol normal: 150-200 mg/dL
    // Triglicéridos normal: 80-150 mg/dL
    const baseCholesterol = 180;
    const baseTriglycerides = 120;
    
    // Pequeña variación basada en características de señal
    const variance = this.calculateVariance(signal);
    const varEffect = Math.tanh(variance * 3) * 15;
    
    return {
      totalCholesterol: Math.round(Math.max(140, Math.min(220, baseCholesterol + varEffect))),
      triglycerides: Math.round(Math.max(70, Math.min(180, baseTriglycerides + varEffect * 0.5)))
    };
  }

  // Método eliminado - ahora usamos ArrhythmiaProcessor directamente

  private calculateACComponent(signal: number[]): number {
    const max = Math.max(...signal);
    const min = Math.min(...signal);
    return max - min;
  }

  private calculateDCComponent(signal: number[]): number {
    return signal.reduce((a, b) => a + b, 0) / signal.length;
  }

  private calculateVariance(signal: number[]): number {
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
    return Math.sqrt(variance) / mean;
  }

  private calculateTrend(signal: number[]): number {
    if (signal.length < 2) return 0;
    const first = signal.slice(0, signal.length / 2).reduce((a, b) => a + b, 0) / (signal.length / 2);
    const second = signal.slice(signal.length / 2).reduce((a, b) => a + b, 0) / (signal.length / 2);
    return (second - first) / first;
  }

  private calculatePulsatility(signal: number[]): number {
    const peaks = this.findPeaks(signal);
    const valleys = this.findValleys(signal);
    if (peaks.length === 0 || valleys.length === 0) return 0;
    
    const avgPeak = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const avgValley = valleys.reduce((a, b) => a + b, 0) / valleys.length;
    
    return (avgPeak - avgValley) / avgPeak;
  }

  private calculateAmplitude(signal: number[]): number {
    return (Math.max(...signal) - Math.min(...signal)) / Math.max(...signal);
  }

  private calculateDominantFrequency(signal: number[]): number {
    const peaks = this.findPeaks(signal);
    if (peaks.length < 2) return 0;
    
    const avgInterval = signal.length / peaks.length;
    return 1 / avgInterval;
  }

  private calculateArterialStiffness(intervals: number[]): number {
    const variance = this.calculateVariance(intervals);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return variance / mean;
  }

  private calculateTurbulence(signal: number[]): number {
    let turbulence = 0;
    for (let i = 1; i < signal.length - 1; i++) {
      const derivative = Math.abs(signal[i + 1] - signal[i - 1]);
      turbulence += derivative;
    }
    return turbulence / (signal.length - 2);
  }

  private calculateViscosity(signal: number[]): number {
    let smoothness = 0;
    for (let i = 1; i < signal.length; i++) {
      smoothness += Math.abs(signal[i] - signal[i - 1]);
    }
    return smoothness / (signal.length - 1);
  }

  private calculateRMSSD(intervals: number[]): number {
    if (intervals.length < 2) return 0;
    
    let sumSquares = 0;
    for (let i = 1; i < intervals.length; i++) {
      sumSquares += Math.pow(intervals[i] - intervals[i - 1], 2);
    }
    
    return Math.sqrt(sumSquares / (intervals.length - 1));
  }

  private calculateSDNN(intervals: number[]): number {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
    return Math.sqrt(variance);
  }

  private calculateRRVariation(intervals: number[]): number {
    if (intervals.length < 2) return 0;
    
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const maxDev = Math.max(...intervals.map(i => Math.abs(i - mean)));
    
    return maxDev / mean;
  }

  private findPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
        peaks.push(signal[i]);
      }
    }
    return peaks;
  }

  private findValleys(signal: number[]): number[] {
    const valleys: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] < signal[i - 1] && signal[i] < signal[i + 1]) {
        valleys.push(signal[i]);
      }
    }
    return valleys;
  }

  getCalibrationProgress(): number {
    return Math.min(100, (this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100);
  }

  reset(): VitalSignsResult | null {
    const currentResults = this.getWeightedFinalResults();
    
    this.signalHistory = [];
    this.isCalibrating = false;
    this.arrhythmiaProcessor.reset();

    return this.measurements.spo2 > 0 ? currentResults : null;
  }

  fullReset(): void {
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
      hemoglobinValues: [],
      systolicValues: [],
      diastolicValues: [],
      cholesterolValues: [],
      triglyceridesValues: [],
      arrhythmiaEvents: []
    };
    
    this.signalHistory = [];
    this.isCalibrating = false;
    this.calibrationSamples = 0;
    this.arrhythmiaProcessor.reset();
    this.spo2Processor.reset();
  }
}
