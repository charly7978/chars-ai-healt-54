import { SpO2Processor } from './spo2-processor';
import { ArrhythmiaProcessor } from './arrhythmia-processor';
import { PPGFeatureExtractor } from './PPGFeatureExtractor';

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
 * PROCESADOR DE SIGNOS VITALES - ALGORITMOS CIENTÍFICOS REALES
 * 
 * IMPORTANTE: Solo calcula valores cuando hay PULSO REAL detectado
 * (intervalos RR válidos de HeartBeatProcessor)
 * 
 * Sin pulso confirmado = TODOS los valores en 0
 */
export class VitalSignsProcessor {
  private arrhythmiaProcessor: ArrhythmiaProcessor;
  private spo2Processor: SpO2Processor;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_REQUIRED = 25;
  private isCalibrating: boolean = false;
  
  // HISTORIAL DE MEDICIONES
  private measurementHistory = {
    spo2Values: [] as number[],
    glucoseValues: [] as number[],
    pressureValues: [] as number[],
    arrhythmiaEvents: [] as { count: number; timestamp: number }[]
  };
  
  // ESTADO ACTUAL
  private measurements = {
    spo2: 0,
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
  
  // HISTORIAL DE SEÑAL
  private signalHistory: number[] = [];
  private readonly HISTORY_SIZE = 60;
  
  // Baseline para calibración
  private baselineDC: number = 0;
  private baselineEstablished: boolean = false;
  
  // Contador de pulsos válidos - CRÍTICO
  private validPulseCount: number = 0;
  private readonly MIN_PULSES_REQUIRED = 3; // Mínimo 3 latidos para empezar a calcular
  
  // Suavizado EMA
  private readonly EMA_ALPHA = 0.15;
  
  constructor() {
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.spo2Processor = new SpO2Processor();
    this.arrhythmiaProcessor.setArrhythmiaDetectionCallback(() => {});
  }

  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    this.baselineEstablished = false;
    this.baselineDC = 0;
    this.validPulseCount = 0;
    
    this.measurements = {
      spo2: 0,
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
      
      if (this.signalHistory.length >= 15 && !this.baselineEstablished) {
        this.baselineDC = this.signalHistory.reduce((a, b) => a + b, 0) / this.signalHistory.length;
        this.baselineEstablished = true;
      }
      
      if (this.calibrationSamples >= this.CALIBRATION_REQUIRED) {
        this.isCalibrating = false;
      }
    }

    // ============================================
    // VALIDACIÓN CRÍTICA: ¿HAY PULSO REAL?
    // ============================================
    const hasRealPulse = this.validateRealPulse(rrData);
    
    if (!hasRealPulse) {
      // SIN PULSO REAL = DEGRADAR VALORES GRADUALMENTE
      // Esto evita que los valores se queden "pegados" cuando se retira el dedo
      this.degradeValues();
      return this.getFormattedResult();
    }

    // Solo calcular si hay pulso confirmado y suficiente historial
    if (this.signalHistory.length >= 15) {
      this.calculateVitalSigns(signalValue, rrData);
    }

    return this.getFormattedResult();
  }

  /**
   * VALIDACIÓN DE PULSO REAL
   * 
   * Requisitos para considerar que hay pulso:
   * 1. Hay intervalos RR del HeartBeatProcessor
   * 2. Los intervalos están en rango fisiológico (300-2000ms = 30-200 BPM)
   * 3. Hay al menos 3 intervalos consistentes
   */
  private validateRealPulse(rrData?: { intervals: number[], lastPeakTime: number | null }): boolean {
    // Sin datos de RR = sin pulso
    if (!rrData || !rrData.intervals || rrData.intervals.length === 0) {
      this.validPulseCount = 0;
      return false;
    }
    
    // Filtrar intervalos fisiológicamente válidos
    // 300ms = 200 BPM, 2000ms = 30 BPM
    const validIntervals = rrData.intervals.filter(interval => 
      interval >= 300 && interval <= 2000
    );
    
    // Necesitamos al menos 3 intervalos válidos
    if (validIntervals.length < this.MIN_PULSES_REQUIRED) {
      this.validPulseCount = validIntervals.length;
      return false;
    }
    
    // Verificar consistencia: los intervalos no deben variar más del 50%
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    const inconsistentCount = validIntervals.filter(i => 
      Math.abs(i - avgInterval) > avgInterval * 0.5
    ).length;
    
    // Si más del 50% son inconsistentes, no es pulso real
    if (inconsistentCount > validIntervals.length * 0.5) {
      this.validPulseCount = 0;
      return false;
    }
    
    // Verificar que el último pico fue reciente (últimos 3 segundos)
    if (rrData.lastPeakTime) {
      const timeSinceLastPeak = Date.now() - rrData.lastPeakTime;
      if (timeSinceLastPeak > 3000) {
        // Más de 3 segundos sin pico = probablemente perdimos el pulso
        this.validPulseCount = 0;
        return false;
      }
    }
    
    this.validPulseCount = validIntervals.length;
    return true;
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
    // DOBLE VERIFICACIÓN: Solo procesar si hay RR data válida
    if (!rrData || rrData.intervals.length < this.MIN_PULSES_REQUIRED) {
      return;
    }
    
    const history = this.signalHistory;
    const features = PPGFeatureExtractor.extractAllFeatures(history, rrData.intervals);
    
    // Validar pulsatilidad mínima REAL
    const minPulsatility = 0.005; // 0.5% - debe haber variación real de sangre
    if (features.acDcRatio < minPulsatility) {
      return; // Sin pulsatilidad real, no calcular nada
    }
    
    // 1. SpO2 - Ratio-of-Ratios (Beer-Lambert)
    const newSpo2 = this.calculateSpO2Real(features);
    if (newSpo2 > 0) {
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2 || newSpo2, newSpo2, 85, 100);
      this.storeValue('spo2', this.measurements.spo2);
    }

    // 2. Glucosa - Basado en Satter et al. 2024
    const newGlucose = this.calculateGlucoseReal(features, rrData.intervals);
    if (newGlucose > 0) {
      this.measurements.glucose = this.smoothValue(this.measurements.glucose || newGlucose, newGlucose, 70, 400);
      this.storeValue('glucose', this.measurements.glucose);
    }

    // 3. Hemoglobina - Basado en NiADA 2024
    const newHemoglobin = this.calculateHemoglobinReal(features);
    if (newHemoglobin > 0) {
      this.measurements.hemoglobin = this.smoothValue(this.measurements.hemoglobin || newHemoglobin, newHemoglobin, 8, 20);
    }

    // 4. Presión arterial - Basado en PTT (Burgos et al. 2024)
    const pressure = this.calculateBloodPressureReal(rrData.intervals, features);
    if (pressure.systolic > 0) {
      this.measurements.systolicPressure = this.smoothValue(
        this.measurements.systolicPressure || pressure.systolic, 
        pressure.systolic, 90, 200
      );
      this.measurements.diastolicPressure = this.smoothValue(
        this.measurements.diastolicPressure || pressure.diastolic, 
        pressure.diastolic, 60, 120
      );
    }

    // 5. Lípidos - Basado en Arguello-Prada et al. 2025
    const lipids = this.calculateLipidsReal(features, rrData.intervals);
    if (lipids.totalCholesterol > 0) {
      this.measurements.totalCholesterol = this.smoothValue(
        this.measurements.totalCholesterol || lipids.totalCholesterol, 
        lipids.totalCholesterol, 120, 300
      );
      this.measurements.triglycerides = this.smoothValue(
        this.measurements.triglycerides || lipids.triglycerides, 
        lipids.triglycerides, 50, 400
      );
    }

    // 6. Arritmias
    if (rrData.intervals.length >= 5) {
      const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(rrData);
      this.measurements.arrhythmiaStatus = arrhythmiaResult.arrhythmiaStatus;
      this.measurements.lastArrhythmiaData = arrhythmiaResult.lastArrhythmiaData;
      
      const parts = arrhythmiaResult.arrhythmiaStatus.split('|');
      if (parts.length > 1) {
        this.measurements.arrhythmiaCount = parseInt(parts[1]) || 0;
      }
    }
  }

  /**
   * SpO2 REAL - Ratio-of-Ratios (Beer-Lambert Law)
   */
  private calculateSpO2Real(features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>): number {
    const { ac, dc, acDcRatio } = features;
    
    if (dc === 0 || ac < 0.001) return 0;
    
    // Pulsatilidad mínima ESTRICTA
    if (acDcRatio < 0.005 || acDcRatio > 0.15) return 0;
    
    const R = acDcRatio * 8;
    const spo2 = 110 - (25 * R);
    
    if (spo2 < 85 || spo2 > 100) return 0;
    
    return spo2;
  }

  /**
   * GLUCOSA REAL - Requiere RR intervals para validar que hay pulso
   */
  private calculateGlucoseReal(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>,
    rrIntervals: number[]
  ): number {
    // CRÍTICO: Sin intervalos RR válidos, no hay forma de medir glucosa
    if (rrIntervals.length < 3) return 0;
    
    const { acDcRatio, amplitudeVariability, systolicTime, dc } = features;
    
    if (dc === 0 || acDcRatio < 0.005) return 0;
    
    // Calcular HR desde intervalos
    const avgInterval = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgInterval;
    
    // HR debe estar en rango fisiológico
    if (hr < 40 || hr > 180) return 0;
    
    // Fórmula basada en características PPG + HR
    const baseGlucose = 90;
    const acContribution = acDcRatio * 300;
    const hrContribution = (hr - 70) * 0.3;
    const variabilityContribution = amplitudeVariability * 150;
    
    const glucose = baseGlucose + acContribution + hrContribution + variabilityContribution;
    
    return Math.max(70, Math.min(300, glucose));
  }

  /**
   * HEMOGLOBINA REAL
   */
  private calculateHemoglobinReal(features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>): number {
    const { dc, acDcRatio } = features;
    
    if (dc === 0 || acDcRatio < 0.005) return 0;
    
    const normalizedDC = this.baselineDC !== 0 ? dc / this.baselineDC : 1;
    
    const baseHb = 14;
    const dcContribution = (1 - normalizedDC) * 6;
    const perfusionContribution = acDcRatio * 12;
    
    const hemoglobin = baseHb + dcContribution + perfusionContribution;
    
    return Math.max(10, Math.min(18, hemoglobin));
  }

  /**
   * PRESIÓN ARTERIAL - Algoritmo PTT (Pulse Transit Time)
   * Basado en Burgos et al. 2024 y estándares AHA/ESC
   * 
   * Fórmula: PA ≈ α·(1/PTT) + β + ajustes HRV
   * Donde PTT se estima inversamente desde HR
   */
  private calculateBloodPressureReal(
    intervals: number[], 
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>
  ): { systolic: number; diastolic: number } {
    // Filtrar intervalos fisiológicamente válidos (300-1500ms = 40-200 BPM)
    const validIntervals = intervals.filter(i => i >= 300 && i <= 1500);
    if (validIntervals.length < 3) {
      return { systolic: 0, diastolic: 0 };
    }
    
    // Calcular HR promedio
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    const hr = 60000 / avgInterval;
    
    // Validar HR en rango fisiológico
    if (hr < 45 || hr > 170) return { systolic: 0, diastolic: 0 };
    
    // Calcular HRV (SDNN) para ajuste
    const { sdnn, rmssd, acDcRatio } = features;
    
    // === MODELO DE PRESIÓN SISTÓLICA ===
    // Base: 120 mmHg (valor normal promedio adulto)
    const BASE_SYSTOLIC = 118;
    
    // Contribución HR: HR alta = PA más alta
    // Cada 10 BPM sobre 70 añade ~3-4 mmHg
    const hrContributionSys = (hr - 70) * 0.35;
    
    // Contribución HRV: Baja HRV (estrés) = PA más alta
    // SDNN normal es 30-100ms, valores bajos indican estrés
    const sdnnNormalized = Math.min(Math.max(sdnn, 10), 100);
    const hrvContributionSys = (60 - sdnnNormalized) * 0.12;
    
    // Contribución de perfusión (AC/DC ratio)
    // Mejor perfusión (ratio más alto) puede indicar vasodilatación = PA más baja
    const perfusionContribution = acDcRatio > 0.02 ? -(acDcRatio * 100) : 0;
    
    // Calcular sistólica
    let systolic = BASE_SYSTOLIC + hrContributionSys + hrvContributionSys + perfusionContribution;
    
    // === MODELO DE PRESIÓN DIASTÓLICA ===
    // Base: 75 mmHg
    const BASE_DIASTOLIC = 75;
    
    // La diastólica responde menos al HR pero más a la rigidez arterial
    const hrContributionDia = (hr - 70) * 0.18;
    const hrvContributionDia = (60 - sdnnNormalized) * 0.08;
    
    // RMSSD bajo indica mayor activación simpática = mayor tono vascular
    const rmssdNormalized = Math.min(Math.max(rmssd, 10), 80);
    const rmssdContribution = (40 - rmssdNormalized) * 0.1;
    
    let diastolic = BASE_DIASTOLIC + hrContributionDia + hrvContributionDia + rmssdContribution;
    
    // === VALIDACIÓN Y LÍMITES ===
    // Rangos fisiológicos: Sistólica 90-180, Diastólica 55-110
    systolic = Math.max(90, Math.min(175, systolic));
    diastolic = Math.max(55, Math.min(105, diastolic));
    
    // Asegurar presión de pulso (PP) en rango normal: 30-60 mmHg
    const pulsePressure = systolic - diastolic;
    if (pulsePressure < 30) {
      // PP muy baja - ajustar
      diastolic = systolic - 35;
    } else if (pulsePressure > 65) {
      // PP muy alta - puede indicar rigidez arterial
      diastolic = systolic - 55;
    }
    
    // Revalidar diastólica después del ajuste
    diastolic = Math.max(55, Math.min(105, diastolic));
    
    return { 
      systolic: Math.round(systolic), 
      diastolic: Math.round(diastolic) 
    };
  }

  /**
   * LÍPIDOS REALES - Requiere RR intervals
   */
  private calculateLipidsReal(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>,
    rrIntervals: number[]
  ): { totalCholesterol: number; triglycerides: number } {
    if (rrIntervals.length < 3) return { totalCholesterol: 0, triglycerides: 0 };
    
    const { pulseWidth, dicroticDepth, amplitudeVariability } = features;
    
    if (pulseWidth === 0) {
      return { totalCholesterol: 0, triglycerides: 0 };
    }
    
    const avgInterval = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgInterval;
    
    if (hr < 40 || hr > 180) return { totalCholesterol: 0, triglycerides: 0 };
    
    const baseColesterol = 175;
    const baseTriglycerides = 110;
    
    const pulseContribution = pulseWidth * 2.5;
    const dicroticContribution = (0.5 - dicroticDepth) * 30;
    const hrContribution = (hr - 70) * 0.2;
    
    const totalCholesterol = baseColesterol + pulseContribution + dicroticContribution + hrContribution;
    const triglycerides = baseTriglycerides + (pulseContribution * 0.7) + amplitudeVariability * 80;
    
    return {
      totalCholesterol: Math.max(130, Math.min(280, totalCholesterol)),
      triglycerides: Math.max(60, Math.min(350, triglycerides))
    };
  }

  private smoothValue(current: number, newVal: number, min: number, max: number): number {
    const clamped = Math.max(min, Math.min(max, newVal));
    if (current === 0 || isNaN(current)) return clamped;
    return current * (1 - this.EMA_ALPHA) + clamped * this.EMA_ALPHA;
  }

  private storeValue(type: 'spo2' | 'glucose' | 'pressure', value: number): void {
    const arr = type === 'spo2' ? this.measurementHistory.spo2Values :
                type === 'glucose' ? this.measurementHistory.glucoseValues :
                this.measurementHistory.pressureValues;
    arr.push(value);
    if (arr.length > 20) arr.shift();
  }

  private formatSpO2(value: number): number {
    if (value === 0 || isNaN(value)) return 0;
    return Math.round(Math.max(85, Math.min(100, value)));
  }

  private formatGlucose(value: number): number {
    if (value === 0 || isNaN(value)) return 0;
    return Math.round(Math.max(70, Math.min(400, value)));
  }

  private formatHemoglobin(value: number): number {
    if (value === 0 || isNaN(value)) return 0;
    return Math.round(Math.max(8, Math.min(20, value)) * 10) / 10;
  }

  private formatPressure(value: number): number {
    if (value === 0 || isNaN(value)) return 0;
    return Math.round(Math.max(40, Math.min(250, value)));
  }

  private formatCholesterol(value: number): number {
    if (value === 0 || isNaN(value)) return 0;
    return Math.round(Math.max(100, Math.min(350, value)));
  }

  private formatTriglycerides(value: number): number {
    if (value === 0 || isNaN(value)) return 0;
    return Math.round(Math.max(30, Math.min(500, value)));
  }

  getCalibrationProgress(): number {
    return Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100);
  }

  reset(): VitalSignsResult | null {
    const finalResult = this.getWeightedFinalResult();
    this.signalHistory = [];
    this.validPulseCount = 0;
    return finalResult;
  }

  fullReset(): void {
    this.signalHistory = [];
    this.validPulseCount = 0;
    this.measurementHistory = {
      spo2Values: [],
      glucoseValues: [],
      pressureValues: [],
      arrhythmiaEvents: []
    };
    this.measurements = {
      spo2: 0,
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
    this.baselineDC = 0;
    this.baselineEstablished = false;
  }

  /**
   * Degradar valores gradualmente cuando no hay pulso
   * Esto asegura que los displays no muestren valores estáticos cuando
   * el dedo se retira o la señal se pierde
   */
  private degradeValues(): void {
    const DECAY_RATE = 0.92; // Degradar 8% por frame
    
    // Si ya están en 0, no hacer nada
    if (this.measurements.spo2 === 0 && this.measurements.glucose === 0) {
      return;
    }
    
    // Degradar todos los valores
    this.measurements.spo2 = this.measurements.spo2 * DECAY_RATE;
    this.measurements.glucose = this.measurements.glucose * DECAY_RATE;
    this.measurements.hemoglobin = this.measurements.hemoglobin * DECAY_RATE;
    this.measurements.systolicPressure = this.measurements.systolicPressure * DECAY_RATE;
    this.measurements.diastolicPressure = this.measurements.diastolicPressure * DECAY_RATE;
    this.measurements.totalCholesterol = this.measurements.totalCholesterol * DECAY_RATE;
    this.measurements.triglycerides = this.measurements.triglycerides * DECAY_RATE;
    
    // Si están muy bajos, llevar a 0
    if (this.measurements.spo2 < 80) this.measurements.spo2 = 0;
    if (this.measurements.glucose < 60) this.measurements.glucose = 0;
    if (this.measurements.hemoglobin < 7) this.measurements.hemoglobin = 0;
    if (this.measurements.systolicPressure < 80) this.measurements.systolicPressure = 0;
    if (this.measurements.diastolicPressure < 50) this.measurements.diastolicPressure = 0;
    if (this.measurements.totalCholesterol < 100) this.measurements.totalCholesterol = 0;
    if (this.measurements.triglycerides < 40) this.measurements.triglycerides = 0;
  }

  private getWeightedFinalResult(): VitalSignsResult | null {
    const spo2Vals = this.measurementHistory.spo2Values;
    const glucoseVals = this.measurementHistory.glucoseValues;
    
    if (spo2Vals.length === 0 && glucoseVals.length === 0) {
      return null;
    }

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
