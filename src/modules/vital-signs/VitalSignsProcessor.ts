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
  signalQuality: number;
  measurementConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';
}

export interface RGBData {
  redAC: number;
  redDC: number;
  greenAC: number;
  greenDC: number;
}

/**
 * =========================================================================
 * PROCESADOR DE SIGNOS VITALES - CALIBRADO Y OPTIMIZADO
 * =========================================================================
 * 
 * CALIBRACIONES:
 * 1. SpO2: Requiere PI > 0.15% y R entre 0.4 y 2.0
 * 2. Blood Pressure: Nueva base realista (90 + ajustes)
 * 3. Requiere mínimo 5 RR para calcular
 * 4. Logging optimizado
 * =========================================================================
 */
export class VitalSignsProcessor {
  private arrhythmiaProcessor: ArrhythmiaProcessor;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_REQUIRED = 30;
  private isCalibrating: boolean = false;
  
  // CALIBRACIÓN: Mínimo de RR para signos vitales
  private readonly MIN_RR_FOR_VITALS = 5;
  
  // Estado
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
    lastArrhythmiaData: null as { timestamp: number; rmssd: number; rrVariation: number; } | null,
    signalQuality: 0
  };
  
  // Historial de señal PPG
  private signalHistory: number[] = [];
  private readonly HISTORY_SIZE = 120;
  
  // Datos RGB de la cámara
  private rgbData: RGBData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
  
  // Historial para suavizado
  private measurementHistory: { [key: string]: number[] } = {};
  private readonly SMOOTHING_WINDOW = 10; // Aumentado para más estabilidad
  
  // Contador de pulsos válidos
  private validPulseCount: number = 0;
  
  // Log throttle
  private lastLogTime: number = 0;
  private readonly LOG_INTERVAL = 3000; // Log cada 3 segundos
  
  constructor() {
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    console.log('✅ VitalSignsProcessor inicializado - Calibrado');
  }

  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    this.validPulseCount = 0;
    this.resetMeasurements();
  }

  forceCalibrationCompletion(): void {
    this.isCalibrating = false;
    this.calibrationSamples = this.CALIBRATION_REQUIRED;
  }
  
  setRGBData(data: RGBData): void {
    this.rgbData = data;
  }

  /**
   * PROCESAR SEÑAL PPG
   */
  processSignal(
    signalValue: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): VitalSignsResult {
    
    this.signalHistory.push(signalValue);
    if (this.signalHistory.length > this.HISTORY_SIZE) {
      this.signalHistory.shift();
    }

    if (this.isCalibrating) {
      this.calibrationSamples++;
      if (this.calibrationSamples >= this.CALIBRATION_REQUIRED) {
        this.isCalibrating = false;
        console.log('✅ Calibración completada');
      }
    }

    this.measurements.signalQuality = this.calculateSignalQuality();

    if (!this.hasValidPulse(rrData)) {
      return this.formatResult();
    }

    // CALIBRADO: Requiere mínimo de RR
    if (this.signalHistory.length >= 60 && 
        rrData && 
        rrData.intervals.length >= this.MIN_RR_FOR_VITALS) {
      this.calculateAllVitals(rrData);
    }

    return this.formatResult();
  }

  /**
   * VALIDAR PULSO REAL
   */
  private hasValidPulse(rrData?: { intervals: number[], lastPeakTime: number | null }): boolean {
    if (!rrData || !rrData.intervals || rrData.intervals.length < this.MIN_RR_FOR_VITALS) {
      this.validPulseCount = 0;
      return false;
    }
    
    const validIntervals = rrData.intervals.filter(i => i >= 200 && i <= 2000);
    
    if (validIntervals.length < this.MIN_RR_FOR_VITALS) {
      return false;
    }
    
    if (rrData.lastPeakTime && Date.now() - rrData.lastPeakTime > 4000) {
      return false;
    }
    
    this.validPulseCount = validIntervals.length;
    return true;
  }

  /**
   * CALIDAD DE SEÑAL PPG
   */
  private calculateSignalQuality(): number {
    if (this.signalHistory.length < 30) return 0;
    
    const recent = this.signalHistory.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    if (range < 0.5) return 5;
    
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    const snr = range / (stdDev + 0.01);
    return Math.min(100, Math.max(0, snr * 12));
  }

  /**
   * CÁLCULO DE TODOS LOS SIGNOS VITALES - CALIBRADO
   */
  private calculateAllVitals(rrData: { intervals: number[], lastPeakTime: number | null }): void {
    const features = PPGFeatureExtractor.extractAllFeatures(this.signalHistory, rrData.intervals);
    
    if (this.measurements.signalQuality < 15) {
      return;
    }

    // 1. SpO2 - CON VALIDACIÓN DE PI Y R
    const spo2 = this.calculateSpO2Calibrated();
    if (spo2 > 0) {
      this.measurements.spo2 = this.smoothValue('spo2', spo2);
    }

    // 2. PRESIÓN ARTERIAL - RECALIBRADA
    const bp = this.calculateBloodPressureCalibrated(rrData.intervals, features);
    if (bp.systolic > 0) {
      this.measurements.systolicPressure = this.smoothValue('systolic', bp.systolic);
      this.measurements.diastolicPressure = this.smoothValue('diastolic', bp.diastolic);
    }

    // 3. GLUCOSA
    const glucose = this.calculateGlucose(features, rrData.intervals);
    if (glucose > 0) {
      this.measurements.glucose = this.smoothValue('glucose', glucose);
    }

    // 4. HEMOGLOBINA
    const hb = this.calculateHemoglobin(features);
    if (hb > 0) {
      this.measurements.hemoglobin = this.smoothValue('hemoglobin', hb);
    }

    // 5. LÍPIDOS
    const lipids = this.calculateLipids(features, rrData.intervals);
    if (lipids.cholesterol > 0) {
      this.measurements.totalCholesterol = this.smoothValue('cholesterol', lipids.cholesterol);
      this.measurements.triglycerides = this.smoothValue('triglycerides', lipids.triglycerides);
    }

    // 6. ARRITMIAS
    if (rrData.intervals.length >= 5) {
      const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(rrData);
      this.measurements.arrhythmiaStatus = arrhythmiaResult.arrhythmiaStatus;
      this.measurements.lastArrhythmiaData = arrhythmiaResult.lastArrhythmiaData;
      
      const parts = arrhythmiaResult.arrhythmiaStatus.split('|');
      this.measurements.arrhythmiaCount = parts.length > 1 ? parseInt(parts[1]) || 0 : 0;
    }

    this.logVitals(rrData.intervals);
  }

  /**
   * =========================================================================
   * SpO2 - CALIBRADO CON VALIDACIÓN
   * =========================================================================
   * 
   * Requiere:
   * - PI > 0.15%
   * - R entre 0.4 y 2.0
   */
  private calculateSpO2Calibrated(): number {
    const { redAC, redDC, greenAC, greenDC } = this.rgbData;
    
    // Validar datos mínimos
    if (redDC < 10 || greenDC < 10) return 0;
    if (redAC < 0.05 || greenAC < 0.05) return 0;
    
    // Perfusion Index
    const piRed = (redAC / redDC) * 100;
    const piGreen = (greenAC / greenDC) * 100;
    
    // CALIBRADO: PI mínimo 0.15%
    if (piRed < 0.15 || piGreen < 0.15) return 0;
    
    // RATIO OF RATIOS
    const R = (redAC / redDC) / (greenAC / greenDC);
    
    // CALIBRADO: R debe estar en rango válido
    if (R < 0.4 || R > 2.0) return 0;
    
    // FÓRMULA EMPÍRICA
    const spo2 = 110 - 25 * R;
    
    return spo2;
  }

  /**
   * =========================================================================
   * PRESIÓN ARTERIAL - RECALIBRADA
   * =========================================================================
   * 
   * Nueva base realista: 90 + (HR - 60) * 0.5 + ajustes morfológicos
   */
  private calculateBloodPressureCalibrated(
    intervals: number[], 
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>
  ): { systolic: number; diastolic: number } {
    const validIntervals = intervals.filter(i => i >= 200 && i <= 2000);
    if (validIntervals.length < this.MIN_RR_FOR_VITALS) {
      return { systolic: 0, diastolic: 0 };
    }
    
    const { systolicTime, dicroticDepth, sdnn, 
            augmentationIndex, stiffnessIndex } = features;
    
    // HR desde RR
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    const hr = 60000 / avgInterval;
    
    // === BASE REALISTA ===
    // HR=60 -> base=90, HR=70 -> base=95, HR=100 -> base=110
    const baseSystolic = 90 + (hr - 60) * 0.5;
    
    // === AJUSTES MORFOLÓGICOS ===
    let morphologyAdjust = 0;
    
    // Stiffness Index (rigidez arterial)
    if (stiffnessIndex > 0) {
      morphologyAdjust += stiffnessIndex * 3;
    }
    
    // Augmentation Index
    if (augmentationIndex !== 0) {
      morphologyAdjust += augmentationIndex * 0.15;
    }
    
    // Tiempo sistólico (más rápido = más presión)
    if (systolicTime > 0) {
      const systolicTimeMs = systolicTime * (1000 / 30);
      morphologyAdjust += Math.max(0, (180 - systolicTimeMs) * 0.1);
    }
    
    // HRV bajo = más estrés = más presión
    if (sdnn > 0 && sdnn < 40) {
      morphologyAdjust += (40 - sdnn) * 0.2;
    }
    
    // Muesca dicrotica profunda = mejor compliance = menos presión
    if (dicroticDepth > 0.2) {
      morphologyAdjust -= dicroticDepth * 8;
    }
    
    // SISTÓLICA FINAL
    const systolic = baseSystolic + morphologyAdjust;
    
    // DIASTÓLICA (ratio típico 0.6-0.7 de sistólica)
    let pulsePressureFactor = 1.55 + (stiffnessIndex * 0.01);
    pulsePressureFactor = Math.max(1.4, Math.min(1.8, pulsePressureFactor));
    
    const diastolic = systolic / pulsePressureFactor;
    
    return { systolic, diastolic };
  }

  /**
   * GLUCOSA
   */
  private calculateGlucose(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>,
    rrIntervals: number[]
  ): number {
    if (rrIntervals.length < this.MIN_RR_FOR_VITALS) return 0;
    
    const { acDcRatio, amplitudeVariability, sdnn, pulseWidth, dc } = features;
    
    if (acDcRatio < 0.0001 || dc === 0) return 0;
    
    const avgInterval = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgInterval;
    
    const { redDC, greenDC } = this.rgbData;
    if (redDC < 10 || greenDC < 10) return 0;
    
    // Perfusion Index contribution
    let piContribution = acDcRatio * 1200;
    
    // R/G ratio
    const rgRatio = redDC / greenDC;
    let absorptionContribution = rgRatio * 25;
    
    // DC level
    let dcContribution = (dc / 100) * 12;
    
    // Variability
    let variabilityContribution = amplitudeVariability * 2.5;
    
    // Pulse width
    let widthContribution = pulseWidth * 1.8;
    
    // HR contribution
    let hrContribution = 0;
    if (hr < 70) {
      hrContribution = 8;
    } else if (hr < 100) {
      hrContribution = (hr - 70) * 0.35;
    } else {
      hrContribution = 10 - (hr - 100) * 0.08;
    }
    
    // Stress
    let stressContribution = sdnn > 0 && sdnn < 50 ? (50 - sdnn) * 0.4 : 0;
    
    return piContribution + absorptionContribution + dcContribution + 
           variabilityContribution + widthContribution + hrContribution + stressContribution;
  }

  /**
   * HEMOGLOBINA
   */
  private calculateHemoglobin(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>
  ): number {
    const { acDcRatio, dc, dicroticDepth, systolicTime } = features;
    
    if (dc === 0 || acDcRatio < 0.0001) return 0;
    
    const { redDC, greenDC, redAC, greenAC } = this.rgbData;
    
    if (redDC < 10 || greenDC < 10) return 0;
    
    // R/G DC ratio
    const rgRatioDC = redDC / greenDC;
    let absorptionContribution = rgRatioDC * 6;
    
    // R/G AC ratio
    let acRatioContribution = greenAC > 0 ? (redAC / greenAC) * 1.8 : 0;
    
    // DC absolute
    let dcContribution = (dc / 100) * 2.2;
    
    // Perfusion
    let perfusionContribution = acDcRatio * 70;
    
    // Morphology
    let morphologyContribution = 0;
    if (dicroticDepth > 0.15) morphologyContribution += 0.35;
    if (systolicTime > 5) morphologyContribution += 0.25;
    
    return absorptionContribution + acRatioContribution + dcContribution + 
           perfusionContribution + morphologyContribution;
  }

  /**
   * LÍPIDOS
   */
  private calculateLipids(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>,
    rrIntervals: number[]
  ): { cholesterol: number; triglycerides: number } {
    if (rrIntervals.length < this.MIN_RR_FOR_VITALS) return { cholesterol: 0, triglycerides: 0 };
    
    const { pulseWidth, dicroticDepth, acDcRatio, systolicTime, 
            sdnn, stiffnessIndex, augmentationIndex } = features;
    
    if (acDcRatio < 0.0001) return { cholesterol: 0, triglycerides: 0 };
    
    const avgInterval = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgInterval;
    
    // CHOLESTEROL
    let siContribution = stiffnessIndex * 15;
    let aixContribution = augmentationIndex * 0.8;
    let dicroticContribution = (1 - dicroticDepth) * 45;
    let systolicContribution = systolicTime > 0 ? (1 / systolicTime) * 100 : 0;
    let hrvContribution = sdnn > 0 ? Math.max(0, (60 - sdnn)) * 0.5 : 0;
    
    const cholesterol = siContribution + aixContribution + dicroticContribution + 
                        systolicContribution + hrvContribution;
    
    // TRIGLYCERIDES
    let widthContribution = pulseWidth * 8;
    let hrContribution = hr * 0.45;
    let perfusionContribution = acDcRatio < 0.02 ? (0.02 - acDcRatio) * 2500 : 0;
    let hrvTrigContribution = sdnn > 0 && sdnn < 50 ? (50 - sdnn) * 0.8 : 0;
    
    const triglycerides = widthContribution + hrContribution + 
                          perfusionContribution + hrvTrigContribution;
    
    return { cholesterol, triglycerides };
  }

  /**
   * SUAVIZADO
   */
  private smoothValue(key: string, newValue: number): number {
    if (!this.measurementHistory[key]) {
      this.measurementHistory[key] = [];
    }
    
    this.measurementHistory[key].push(newValue);
    if (this.measurementHistory[key].length > this.SMOOTHING_WINDOW) {
      this.measurementHistory[key].shift();
    }
    
    return this.measurementHistory[key].reduce((a, b) => a + b, 0) / this.measurementHistory[key].length;
  }

  /**
   * LOG PARA DEBUGGING
   */
  private logVitals(intervals: number[]): void {
    const now = Date.now();
    if (now - this.lastLogTime < this.LOG_INTERVAL) return;
    this.lastLogTime = now;
    
    const avgRR = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const hr = 60000 / avgRR;
    
    const ratioR = this.rgbData.greenDC > 0 && this.rgbData.greenAC > 0 
      ? ((this.rgbData.redAC/this.rgbData.redDC)/(this.rgbData.greenAC/this.rgbData.greenDC)).toFixed(3) 
      : 'N/A';
    
    console.log(`📊 VITALES:`);
    console.log(`   HR=${hr.toFixed(0)} SpO2=${this.measurements.spo2.toFixed(0)}% (R=${ratioR})`);
    console.log(`   PA=${this.measurements.systolicPressure.toFixed(0)}/${this.measurements.diastolicPressure.toFixed(0)} mmHg`);
    console.log(`   SQI=${this.measurements.signalQuality.toFixed(0)}%`);
  }

  private getMeasurementConfidence(): 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID' {
    const sq = this.measurements.signalQuality;
    if (sq >= 60 && this.validPulseCount >= 8) return 'HIGH';
    if (sq >= 40 && this.validPulseCount >= 5) return 'MEDIUM';
    if (sq >= 20 && this.validPulseCount >= 3) return 'LOW';
    return 'INVALID';
  }

  private formatResult(): VitalSignsResult {
    return {
      spo2: Math.round(this.measurements.spo2),
      glucose: Math.round(this.measurements.glucose),
      hemoglobin: Math.round(this.measurements.hemoglobin * 10) / 10,
      pressure: {
        systolic: Math.round(this.measurements.systolicPressure),
        diastolic: Math.round(this.measurements.diastolicPressure)
      },
      arrhythmiaCount: this.measurements.arrhythmiaCount,
      arrhythmiaStatus: this.measurements.arrhythmiaStatus,
      lipids: {
        totalCholesterol: Math.round(this.measurements.totalCholesterol),
        triglycerides: Math.round(this.measurements.triglycerides)
      },
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100)),
      lastArrhythmiaData: this.measurements.lastArrhythmiaData ?? undefined,
      signalQuality: Math.round(this.measurements.signalQuality),
      measurementConfidence: this.getMeasurementConfidence()
    };
  }

  private resetMeasurements(): void {
    this.measurements = {
      spo2: 0,
      glucose: 0,
      hemoglobin: 0,
      systolicPressure: 0,
      diastolicPressure: 0,
      arrhythmiaCount: 0,
      arrhythmiaStatus: "CALIBRANDO...",
      totalCholesterol: 0,
      triglycerides: 0,
      lastArrhythmiaData: null,
      signalQuality: 0
    };
    this.measurementHistory = {};
  }

  getCalibrationProgress(): number {
    return Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100));
  }

  reset(): VitalSignsResult | null {
    const result = this.formatResult();
    this.signalHistory = [];
    this.validPulseCount = 0;
    return result.spo2 !== 0 ? result : null;
  }

  fullReset(): void {
    this.signalHistory = [];
    this.validPulseCount = 0;
    this.resetMeasurements();
    this.rgbData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
    this.isCalibrating = false;
    this.calibrationSamples = 0;
    this.arrhythmiaProcessor.reset();
    this.measurementHistory = {};
    console.log('🔄 VitalSignsProcessor reset completo');
  }
}
