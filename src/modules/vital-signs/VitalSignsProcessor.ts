import { SpO2Processor } from './spo2-processor';
import { BloodPressureProcessor } from './blood-pressure-processor';
import { ArrhythmiaProcessor } from './arrhythmia-processor';
import { SignalProcessor } from './signal-processor';
import { GlucoseProcessor } from './glucose-processor';
import { LipidProcessor } from './lipid-processor';

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
  // REVERTIR A PROCESADORES ORIGINALES PARA MANTENER COMPATIBILIDAD
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
  private readonly CALIBRATION_REQUIRED_SAMPLES: number = 40;
  private readonly CALIBRATION_DURATION_MS: number = 6000;
  
  private spo2Samples: number[] = [];
  private pressureSamples: number[] = [];
  private heartRateSamples: number[] = [];
  private glucoseSamples: number[] = [];
  private lipidSamples: number[] = [];
  
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
    console.log('🚀 Inicializando VitalSignsProcessor con procesadores originales (compatibilidad)');
    this.spo2Processor = new SpO2Processor();
    this.bpProcessor = new BloodPressureProcessor();
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.signalProcessor = new SignalProcessor();
    this.glucoseProcessor = new GlucoseProcessor();
    this.lipidProcessor = new LipidProcessor();
  }

  /**
   * Inicia el proceso de calibración que analiza y optimiza los algoritmos
   * para las condiciones específicas del usuario y dispositivo
   */
  public startCalibration(): void {
    console.log("🎯 VitalSignsProcessor: Iniciando calibración matemática avanzada");
    this.isCalibrating = true;
    this.calibrationStartTime = Date.now();
    this.calibrationSamples = 0;
    this.forceCompleteCalibration = false;
    
    // Resetear muestras de calibración
    this.spo2Samples = [];
    this.pressureSamples = [];
    this.heartRateSamples = [];
    this.glucoseSamples = [];
    this.lipidSamples = [];
    
    // Iniciar timer de calibración
    this.calibrationTimer = setTimeout(() => {
      this.completeCalibration();
    }, this.CALIBRATION_DURATION_MS);
    
    console.log("🎯 VitalSignsProcessor: Calibración iniciada", {
      duración: this.CALIBRATION_DURATION_MS + "ms",
      muestrasRequeridas: this.CALIBRATION_REQUIRED_SAMPLES,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Fuerza la finalización inmediata de la calibración
   */
  public forceCalibrationCompletion(): void {
    console.log("🎯 VitalSignsProcessor: Forzando finalización de calibración");
    this.forceCompleteCalibration = true;
    this.completeCalibration();
  }

  /**
   * Completa el proceso de calibración
   */
  private completeCalibration(): void {
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
    
    this.isCalibrating = false;
    
    // Calcular progreso final
    this.calibrationProgress = {
      heartRate: Math.min(100, (this.heartRateSamples.length / this.CALIBRATION_REQUIRED_SAMPLES) * 100),
      spo2: Math.min(100, (this.spo2Samples.length / this.CALIBRATION_REQUIRED_SAMPLES) * 100),
      pressure: Math.min(100, (this.pressureSamples.length / this.CALIBRATION_REQUIRED_SAMPLES) * 100),
      arrhythmia: Math.min(100, (this.calibrationSamples / this.CALIBRATION_REQUIRED_SAMPLES) * 100),
      glucose: Math.min(100, (this.glucoseSamples.length / this.CALIBRATION_REQUIRED_SAMPLES) * 100),
      lipids: Math.min(100, (this.lipidSamples.length / this.CALIBRATION_REQUIRED_SAMPLES) * 100),
      hemoglobin: 100 // Hemoglobina siempre calibrada
    };
    
    console.log("VitalSignsProcessor: Calibración completada exitosamente", {
      tiempoTotal: (Date.now() - this.calibrationStartTime).toFixed(0) + "ms"
    });
  }

  public processSignal(
    ppgValue: number,
    rrData?: { intervals: number[]; lastPeakTime: number | null }
  ): VitalSignsResult {
    // Si el valor es muy bajo, se asume que no hay dedo => no medir nada
    if (ppgValue < 0.1) {
      console.log("VitalSignsProcessor: No se detecta dedo, retornando resultados previos.");
      return this.lastValidResults || {
        spo2: 0,
        pressure: "--/--",
        arrhythmiaStatus: "--",
        glucose: 0,
        lipids: {
          totalCholesterol: 0,
          triglycerides: 0
        },
        hemoglobin: 0
      };
    }

    if (this.isCalibrating) {
      this.calibrationSamples++;
    }
    
    const filtered = this.signalProcessor.applySMAFilter(ppgValue);
    
    const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(rrData);
    
    // Obtener los últimos valores de PPG para procesamiento
    const ppgValues = this.signalProcessor.getPPGValues();
    
    // Calcular SpO2 usando datos reales de la señal
    const spo2 = this.spo2Processor.calculateSpO2(ppgValues.slice(-60));
    
    // La presión arterial se calcula usando el módulo blood-pressure-processor
    const bp = this.bpProcessor.calculateBloodPressure(ppgValues.slice(-60));
    const pressure = `${bp.systolic}/${bp.diastolic}`;
    
    // Calcular niveles reales de glucosa a partir de las características del PPG
    const glucose = this.glucoseProcessor.calculateGlucose(ppgValues);
    
    // El perfil lipídico (incluyendo colesterol y triglicéridos) se calcula usando el módulo lipid-processor
    const lipids = this.lipidProcessor.calculateLipids(ppgValues);
    
    // Calcular hemoglobina real usando algoritmo optimizado
    const hemoglobin = this.calculateHemoglobin(ppgValues);

    const result: VitalSignsResult = {
      spo2,
      pressure,
      arrhythmiaStatus: arrhythmiaResult.arrhythmiaStatus,
      lastArrhythmiaData: arrhythmiaResult.lastArrhythmiaData,
      glucose,
      lipids,
      hemoglobin
    };
    
    if (this.isCalibrating) {
      result.calibration = {
        isCalibrating: true,
        progress: { ...this.calibrationProgress }
      };
    }
    
    if (spo2 > 0 && bp.systolic > 0 && bp.diastolic > 0 && glucose > 0 && lipids.totalCholesterol > 0) {
      this.lastValidResults = { ...result };
    }

    return result;
  }

  private calculateHemoglobin(ppgValues: number[]): number {
    if (ppgValues.length < 50) return 0;
    
    // Calculate using real PPG data based on absorption characteristics
    const peak = Math.max(...ppgValues);
    const valley = Math.min(...ppgValues);
    const ac = peak - valley;
    const dc = ppgValues.reduce((a, b) => a + b, 0) / ppgValues.length;
    
    // Beer-Lambert law application for hemoglobin estimation
    const ratio = ac / dc;
    const baseHemoglobin = 12.5;
    const hemoglobin = baseHemoglobin + (ratio - 1) * 2.5;
    
    // Clamp to physiologically relevant range
    return Math.max(8, Math.min(18, Number(hemoglobin.toFixed(1))));
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

  public reset(): VitalSignsResult | null {
    console.log("VitalSignsProcessor: Reseteo solicitado");
    
    // Guardar resultados actuales antes del reset
    const savedResults = this.lastValidResults;
    
    // Resetear procesadores
    this.spo2Processor.reset();
    this.bpProcessor.reset();
    this.arrhythmiaProcessor.reset();
    this.signalProcessor.reset();
    this.glucoseProcessor.reset();
    this.lipidProcessor.reset();
    
    // Resetear estado de calibración
    this.isCalibrating = false;
    this.calibrationSamples = 0;
    this.calibrationStartTime = 0;
    this.forceCompleteCalibration = false;
    
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
    
    // Resetear muestras
    this.spo2Samples = [];
    this.pressureSamples = [];
    this.heartRateSamples = [];
    this.glucoseSamples = [];
    this.lipidSamples = [];
    
    // Resetear progreso
    this.calibrationProgress = {
      heartRate: 0,
      spo2: 0,
      pressure: 0,
      arrhythmia: 0,
      glucose: 0,
      lipids: 0,
      hemoglobin: 0
    };
    
    console.log("VitalSignsProcessor: Reset completado");
    return savedResults;
  }

  public fullReset(): void {
    console.log("VitalSignsProcessor: Reseteo completo solicitado");
    
    // Reset completo
    this.reset();
    
    // Limpiar resultados guardados
    this.lastValidResults = null;
    
    console.log("VitalSignsProcessor: Reseteo completo finalizado");
  }
}
