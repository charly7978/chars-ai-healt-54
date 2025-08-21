
import { AdvancedMathematicalProcessor } from './AdvancedMathematicalProcessor';

export interface VitalSignsResult {
  spo2: number;
  glucose: number;
  pressure: {
    systolic: number;
    diastolic: number;
  };
  arrhythmiaCount: number;
  isCalibrating: boolean;
  calibrationProgress: number;
}

/**
 * PROCESADOR ÚNICO DE SIGNOS VITALES - FUENTE ÚNICA DE VERDAD
 * Elimina duplicidades y asegura mediciones desde CERO
 */
export class VitalSignsProcessor {
  private mathProcessor: AdvancedMathematicalProcessor;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_REQUIRED = 25;
  private isCalibrating: boolean = false;
  
  // ESTADO ÚNICO - SIN DUPLICACIONES
  private measurements = {
    spo2: 0,
    glucose: 0,
    systolicPressure: 0,
    diastolicPressure: 0,
    arrhythmiaCount: 0
  };
  
  private signalHistory: number[] = [];
  private readonly HISTORY_SIZE = 50;
  
  constructor() {
    console.log("🚀 VitalSignsProcessor: Inicializando sistema ÚNICO (SIN DUPLICACIONES)");
    this.mathProcessor = new AdvancedMathematicalProcessor();
  }

  startCalibration(): void {
    console.log("🎯 VitalSignsProcessor: Iniciando calibración ÚNICA");
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    
    // RESETEAR TODAS LAS MEDICIONES A CERO
    this.measurements = {
      spo2: 0,
      glucose: 0,
      systolicPressure: 0,
      diastolicPressure: 0,
      arrhythmiaCount: 0
    };
    
    this.signalHistory = [];
  }

  forceCalibrationCompletion(): void {
    console.log("⚡ VitalSignsProcessor: Forzando finalización de calibración");
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
        console.log("✅ VitalSignsProcessor: Calibración completada automáticamente");
      }
    }

    // Procesar SOLO si calibración completada y hay suficiente historial
    if (!this.isCalibrating && this.signalHistory.length >= 10) {
      this.calculateVitalSigns(signalValue, rrData);
    }

    return {
      spo2: Math.max(0, this.measurements.spo2), // Asegurar que no sea negativo
      glucose: Math.max(0, this.measurements.glucose),
      pressure: {
        systolic: Math.max(0, this.measurements.systolicPressure),
        diastolic: Math.max(0, this.measurements.diastolicPressure)
      },
      arrhythmiaCount: Math.max(0, this.measurements.arrhythmiaCount),
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.min(100, (this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100)
    };
  }

  private calculateVitalSigns(
    signalValue: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): void {
    
    console.log("🔬 VitalSignsProcessor: Calculando signos vitales ÚNICOS", {
      señal: signalValue,
      historial: this.signalHistory.length,
      rrIntervalos: rrData?.intervals?.length || 0
    });

    // 1. SpO2 - Usando algoritmo matemático avanzado
    const newSpo2 = this.mathProcessor.calculateSpO2Advanced(this.signalHistory);
    this.measurements.spo2 = Math.max(0, Math.min(100, newSpo2));

    // 2. Glucosa - Correlación óptica avanzada
    const newGlucose = this.mathProcessor.calculateGlucoseOptical(this.signalHistory, signalValue);
    this.measurements.glucose = Math.max(0, Math.min(400, newGlucose));

    // 3. Presión arterial - Análisis de tiempo de tránsito
    if (rrData && rrData.intervals.length >= 3) {
      const pressureResult = this.mathProcessor.calculateBloodPressureAdvanced(
        rrData.intervals, 
        this.signalHistory
      );
      this.measurements.systolicPressure = Math.max(0, Math.min(250, pressureResult.systolic));
      this.measurements.diastolicPressure = Math.max(0, Math.min(150, pressureResult.diastolic));
    }

    // 4. Arritmias - Análisis de variabilidad
    if (rrData && rrData.intervals.length >= 5) {
      const arrhythmias = this.mathProcessor.detectArrhythmias(rrData.intervals);
      this.measurements.arrhythmiaCount = Math.max(0, arrhythmias);
    }

    console.log("📊 VitalSignsProcessor: Mediciones calculadas:", {
      spo2: this.measurements.spo2,
      glucosa: this.measurements.glucose,
      presión: `${this.measurements.systolicPressure}/${this.measurements.diastolicPressure}`,
      arritmias: this.measurements.arrhythmiaCount
    });
  }

  getCalibrationProgress(): number {
    return Math.min(100, (this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100);
  }

  reset(): VitalSignsResult | null {
    console.log("🔄 VitalSignsProcessor: Reset ÚNICO preservando últimas mediciones válidas");
    
    const currentResults = {
      spo2: this.measurements.spo2,
      glucose: this.measurements.glucose,
      pressure: {
        systolic: this.measurements.systolicPressure,
        diastolic: this.measurements.diastolicPressure
      },
      arrhythmiaCount: this.measurements.arrhythmiaCount,
      isCalibrating: false,
      calibrationProgress: 100
    };

    // Mantener mediciones válidas, resetear solo el historial
    this.signalHistory = [];
    this.isCalibrating = false;

    return this.measurements.spo2 > 0 ? currentResults : null;
  }

  fullReset(): void {
    console.log("🗑️ VitalSignsProcessor: Reset COMPLETO a estado inicial");
    
    this.measurements = {
      spo2: 0,
      glucose: 0,
      systolicPressure: 0,
      diastolicPressure: 0,
      arrhythmiaCount: 0
    };
    
    this.signalHistory = [];
    this.isCalibrating = false;
    this.calibrationSamples = 0;
  }
}
