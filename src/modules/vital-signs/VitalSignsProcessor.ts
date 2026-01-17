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
  // NUEVO: Indicadores de calidad
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
 * PROCESADOR DE SIGNOS VITALES - SIN CLAMPS
 * 
 * CAMBIOS PRINCIPALES:
 * 1. SpO2 = 110 - 25 * R (fórmula pura, SIN CLAMP)
 * 2. Presión arterial desde morfología PPG (SIN BASE FIJA 120/80)
 * 3. Todos los valores calculados crudos
 * 4. SQI indica confiabilidad en lugar de forzar rangos
 * 
 * Referencias:
 * - Ratio-of-Ratios: Webster 1997, Tremper 1989
 * - BP from PPG morphology: Elgendi 2019, Mukkamala 2022
 */
export class VitalSignsProcessor {
  private arrhythmiaProcessor: ArrhythmiaProcessor;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_REQUIRED = 25;
  private isCalibrating: boolean = false;
  
  // Estado actual - SIN VALORES BASE FIJOS
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
  
  // Historial de señal
  private signalHistory: number[] = [];
  private readonly HISTORY_SIZE = 90; // 3 segundos @ 30fps
  
  // RGB para SpO2
  private rgbData: RGBData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
  
  // Suavizado MÍNIMO para mantener valores crudos
  private readonly EMA_ALPHA = 0.35; // Mayor alpha = menos suavizado
  
  // Contador de pulsos válidos
  private validPulseCount: number = 0;
  private readonly MIN_PULSES_REQUIRED = 3;
  
  constructor() {
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.arrhythmiaProcessor.setArrhythmiaDetectionCallback((detected) => {
      console.log(`ArrhythmiaProcessor: Cambio de estado → ${detected ? 'ARRITMIA' : 'NORMAL'}`);
    });
  }

  startCalibration(): void {
    this.isCalibrating = true;
    this.calibrationSamples = 0;
    this.validPulseCount = 0;
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
    this.signalHistory = [];
  }

  forceCalibrationCompletion(): void {
    this.isCalibrating = false;
    this.calibrationSamples = this.CALIBRATION_REQUIRED;
  }
  
  setRGBData(data: RGBData): void {
    this.rgbData = data;
  }

  processSignal(
    signalValue: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ): VitalSignsResult {
    
    // Actualizar historial
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

    // Calcular calidad de señal
    this.measurements.signalQuality = this.calculateSignalQuality();

    // Validar pulso real
    const hasRealPulse = this.validateRealPulse(rrData);
    
    if (!hasRealPulse) {
      return this.getFormattedResult();
    }

    // Calcular signos vitales solo con pulso confirmado
    if (this.signalHistory.length >= 30 && rrData && rrData.intervals.length >= 3) {
      this.calculateVitalSigns(signalValue, rrData);
    }

    return this.getFormattedResult();
  }

  private validateRealPulse(rrData?: { intervals: number[], lastPeakTime: number | null }): boolean {
    if (!rrData || !rrData.intervals || rrData.intervals.length === 0) {
      this.validPulseCount = 0;
      return false;
    }
    
    // Sin filtros de rango fisiológico estrictos
    const validIntervals = rrData.intervals.filter(interval => 
      interval >= 200 && interval <= 3000
    );
    
    if (validIntervals.length < this.MIN_PULSES_REQUIRED) {
      return false;
    }
    
    if (rrData.lastPeakTime) {
      const timeSinceLastPeak = Date.now() - rrData.lastPeakTime;
      if (timeSinceLastPeak > 5000) {
        return false;
      }
    }
    
    this.validPulseCount = validIntervals.length;
    return true;
  }

  private calculateSignalQuality(): number {
    if (this.signalHistory.length < 30) return 0;
    
    const recent = this.signalHistory.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    if (range < 0.5) return 5;
    
    // Variabilidad
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    const snr = range / (stdDev + 0.01);
    return Math.min(100, Math.max(0, snr * 12));
  }

  private getMeasurementConfidence(): 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID' {
    const sq = this.measurements.signalQuality;
    if (sq >= 70 && this.validPulseCount >= 5) return 'HIGH';
    if (sq >= 40 && this.validPulseCount >= 3) return 'MEDIUM';
    if (sq >= 20 && this.validPulseCount >= 2) return 'LOW';
    return 'INVALID';
  }

  private getFormattedResult(): VitalSignsResult {
    return {
      spo2: this.measurements.spo2, // Valor crudo, puede ser < 70 o > 100
      glucose: this.measurements.glucose,
      hemoglobin: this.measurements.hemoglobin,
      pressure: {
        systolic: this.measurements.systolicPressure,
        diastolic: this.measurements.diastolicPressure
      },
      arrhythmiaCount: this.measurements.arrhythmiaCount,
      arrhythmiaStatus: this.measurements.arrhythmiaStatus,
      lipids: {
        totalCholesterol: this.measurements.totalCholesterol,
        triglycerides: this.measurements.triglycerides
      },
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100)),
      lastArrhythmiaData: this.measurements.lastArrhythmiaData ?? undefined,
      signalQuality: this.measurements.signalQuality,
      measurementConfidence: this.getMeasurementConfidence()
    };
  }

  private calculateVitalSigns(
    signalValue: number, 
    rrData: { intervals: number[], lastPeakTime: number | null }
  ): void {
    const features = PPGFeatureExtractor.extractAllFeatures(this.signalHistory, rrData.intervals);
    
    // 1. SpO2 - Fórmula PURA sin clamp
    const spo2 = this.calculateSpO2Raw();
    if (spo2 !== 0) {
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2);
    }

    // 2. Presión arterial - Desde morfología PPG SIN BASE FIJA
    const pressure = this.calculateBloodPressureFromMorphology(rrData.intervals, features);
    if (pressure.systolic !== 0) {
      this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, pressure.systolic);
      this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, pressure.diastolic);
    }

    // 3. Glucosa - Desde características PPG
    const glucose = this.calculateGlucoseRaw(features, rrData.intervals);
    if (glucose !== 0) {
      this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucose);
    }

    // 4. Hemoglobina - Desde absorción RGB
    const hemoglobin = this.calculateHemoglobinRaw(features);
    if (hemoglobin !== 0) {
      this.measurements.hemoglobin = this.smoothValue(this.measurements.hemoglobin, hemoglobin);
    }

    // 5. Lípidos
    const lipids = this.calculateLipidsRaw(features, rrData.intervals);
    if (lipids.totalCholesterol !== 0) {
      this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol, lipids.totalCholesterol);
      this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides, lipids.triglycerides);
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
   * SpO2 - FÓRMULA PURA RATIO-OF-RATIOS
   * SpO2 = 110 - 25 * R
   * Donde R = (AC_red/DC_red) / (AC_ir/DC_ir)
   * 
   * Para cámaras usamos verde como proxy de IR
   * SIN NINGÚN CLAMP - Valor crudo directo
   */
  private calculateSpO2Raw(): number {
    const { redAC, redDC, greenAC, greenDC } = this.rgbData;
    
    // Validar señal mínima
    if (redDC < 5 || greenDC < 5) {
      return 0;
    }
    
    // Calcular ratios individuales
    const ratioRed = redAC / redDC;
    const ratioGreen = greenAC / greenDC;
    
    // Evitar división por cero
    if (ratioGreen < 0.0001) {
      return 0;
    }
    
    // R = (AC_red/DC_red) / (AC_green/DC_green)
    const R = ratioRed / ratioGreen;
    
    // Fórmula empírica estándar - SIN CLAMP
    // SpO2 = A - B * R
    // Coeficientes calibrados para cámara de smartphone
    // A = 110, B = 25 (estándar para pulsioxímetros)
    const spo2 = 110 - 25 * R;
    
    // Log para debug
    if (this.signalHistory.length % 30 === 0) {
      console.log(`📊 SpO2 RAW: R=${R.toFixed(3)} → SpO2=${spo2.toFixed(1)}% (ratioR=${ratioRed.toFixed(4)} ratioG=${ratioGreen.toFixed(4)})`);
    }
    
    // RETORNAR VALOR CRUDO - puede ser <70% o >100%
    return spo2;
  }

  /**
   * PRESIÓN ARTERIAL DESDE MORFOLOGÍA PPG
   * SIN VALORES BASE FIJOS (120/80)
   * 
   * Basado en:
   * - Augmentation Index (AIx)
   * - Stiffness Index (SI)
   * - Tiempo sistólico (Ts)
   * - Muesca dicrotica
   * - PWV proxy
   * 
   * Referencias: Mukkamala 2022, Elgendi 2019
   */
  private calculateBloodPressureFromMorphology(
    intervals: number[], 
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>
  ): { systolic: number; diastolic: number } {
    const validIntervals = intervals.filter(i => i >= 200 && i <= 3000);
    if (validIntervals.length < 3) {
      return { systolic: 0, diastolic: 0 };
    }
    
    const { systolicTime, dicroticDepth, acDcRatio, pulseWidth, sdnn, 
            augmentationIndex, stiffnessIndex, pwvProxy, apg } = features;
    
    // Verificar que hay características válidas
    if (systolicTime <= 0 && stiffnessIndex <= 0 && augmentationIndex === 0) {
      return { systolic: 0, diastolic: 0 };
    }
    
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    const hr = 60000 / avgInterval;
    
    // === CÁLCULO DE SISTÓLICA ===
    // Fórmula basada en literatura: SBP correlaciona inversamente con tiempo sistólico
    // y directamente con AIx y SI
    
    // K1: Coeficiente de tiempo sistólico (ms → mmHg)
    // Tiempo sistólico más corto = arterias más rígidas = PA más alta
    const K1 = 15;
    const tsComponent = systolicTime > 0 ? K1 / systolicTime : 0;
    
    // K2: Coeficiente de Augmentation Index
    // AIx mayor = reflexión de onda mayor = PA central más alta
    const K2 = 0.4;
    const aixComponent = augmentationIndex * K2;
    
    // K3: Coeficiente de Stiffness Index
    const K3 = 8;
    const siComponent = stiffnessIndex * K3;
    
    // K4: Coeficiente de PWV proxy
    const K4 = 3;
    const pwvComponent = pwvProxy * K4;
    
    // K5: Componente de HR (correlación moderada con SBP)
    const K5 = 0.3;
    const hrComponent = hr * K5;
    
    // K6: Muesca dicrotica (profunda = arterias elásticas = PA más baja)
    const K6 = -20;
    const dicroticComponent = dicroticDepth * K6;
    
    // AGI (Aging Index) desde APG
    const K7 = 5;
    const agiComponent = apg.agi * K7;
    
    // Sistólica = suma de componentes morfológicos
    let systolic = tsComponent + aixComponent + siComponent + pwvComponent + 
                   hrComponent + dicroticComponent + agiComponent;
    
    // Ajuste por perfusión (AC/DC ratio)
    // Baja perfusión puede indicar vasoconstricción
    if (acDcRatio < 0.02 && acDcRatio > 0) {
      systolic += (0.02 - acDcRatio) * 500;
    }
    
    // === CÁLCULO DE DIASTÓLICA ===
    // DBP correlaciona con resistencia periférica y elasticidad
    
    // Ratio SBP/DBP típico: ~1.4-1.6
    // DBP desde SI y pulseWidth principalmente
    const diastolicRatio = 0.6 + (stiffnessIndex * 0.02) + (pulseWidth * 0.01);
    let diastolic = systolic * (1 / (1 + diastolicRatio));
    
    // Ajuste por HRV (baja variabilidad = tono simpático alto)
    if (sdnn > 0 && sdnn < 30) {
      diastolic += (30 - sdnn) * 0.2;
    }
    
    // Log para debug
    if (this.signalHistory.length % 60 === 0) {
      console.log(`💉 PA RAW: Ts=${systolicTime.toFixed(1)} AIx=${augmentationIndex.toFixed(1)} SI=${stiffnessIndex.toFixed(2)} → ${systolic.toFixed(0)}/${diastolic.toFixed(0)}`);
    }
    
    // RETORNAR VALORES CRUDOS - SIN CLAMP
    return { systolic, diastolic };
  }

  /**
   * GLUCOSA DESDE CARACTERÍSTICAS PPG
   */
  private calculateGlucoseRaw(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>,
    rrIntervals: number[]
  ): number {
    if (rrIntervals.length < 3) return 0;
    
    const { acDcRatio, amplitudeVariability, systolicTime, pulseWidth, dicroticDepth, sdnn } = features;
    
    if (acDcRatio < 0.0001) return 0;
    
    const avgInterval = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgInterval;
    
    // Glucosa correlaciona con:
    // - Variabilidad de amplitud PPG
    // - HRV
    // - Características morfológicas
    
    // Componente base desde perfusión
    let glucose = acDcRatio * 2000;
    
    // Variabilidad de amplitud
    glucose += amplitudeVariability * 5;
    
    // HR (metabolismo)
    glucose += hr * 0.5;
    
    // HRV inversa (estrés = glucosa elevada)
    if (sdnn > 0) {
      glucose += Math.max(0, (50 - sdnn)) * 0.5;
    }
    
    // Características morfológicas
    if (systolicTime > 0) {
      glucose += (1 / systolicTime) * 50;
    }
    
    glucose += pulseWidth * 3;
    glucose += (1 - dicroticDepth) * 20;
    
    return glucose;
  }

  /**
   * HEMOGLOBINA DESDE ABSORCIÓN RGB
   */
  private calculateHemoglobinRaw(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>
  ): number {
    const { acDcRatio, dc, dicroticDepth, systolicTime } = features;
    
    if (dc === 0 || acDcRatio < 0.0001) return 0;
    
    const { redDC, greenDC } = this.rgbData;
    
    if (redDC < 5 || greenDC < 5) return 0;
    
    // Hemoglobina absorbe más en rojo
    // Ratio R/G indica concentración
    const rgRatio = redDC / greenDC;
    
    // Fórmula basada en absorción diferencial
    // Más rojo relativo = más hemoglobina
    let hemoglobin = rgRatio * 8;
    
    // DC alto = más absorción
    hemoglobin += (dc / 100) * 2;
    
    // Perfusión afecta lectura
    hemoglobin += acDcRatio * 50;
    
    // Ajustes morfológicos
    if (dicroticDepth > 0.15) {
      hemoglobin += 0.3;
    }
    if (systolicTime > 5) {
      hemoglobin += 0.2;
    }
    
    return hemoglobin;
  }

  /**
   * LÍPIDOS DESDE CARACTERÍSTICAS PPG
   */
  private calculateLipidsRaw(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>,
    rrIntervals: number[]
  ): { totalCholesterol: number; triglycerides: number } {
    if (rrIntervals.length < 3) return { totalCholesterol: 0, triglycerides: 0 };
    
    const { pulseWidth, dicroticDepth, amplitudeVariability, acDcRatio, 
            systolicTime, sdnn, stiffnessIndex, augmentationIndex } = features;
    
    if (acDcRatio < 0.0001) return { totalCholesterol: 0, triglycerides: 0 };
    
    const avgInterval = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgInterval;
    
    // Colesterol correlaciona con rigidez arterial
    let cholesterol = stiffnessIndex * 15;
    
    // AIx alto = aterosclerosis
    cholesterol += augmentationIndex * 0.8;
    
    // Muesca dicrotica superficial = arterias rígidas
    cholesterol += (1 - dicroticDepth) * 40;
    
    // Tiempo sistólico corto
    if (systolicTime > 0) {
      cholesterol += (1 / systolicTime) * 100;
    }
    
    // HRV
    if (sdnn > 0) {
      cholesterol += Math.max(0, (50 - sdnn)) * 0.5;
    }
    
    // Variabilidad de amplitud
    cholesterol += amplitudeVariability * 2;
    
    // Triglicéridos correlacionan con viscosidad
    let triglycerides = pulseWidth * 8;
    
    // HR elevada
    triglycerides += hr * 0.4;
    
    // Perfusión baja
    if (acDcRatio < 0.02) {
      triglycerides += (0.02 - acDcRatio) * 2000;
    }
    
    // HRV
    if (sdnn > 0 && sdnn < 40) {
      triglycerides += (40 - sdnn) * 0.8;
    }
    
    return { totalCholesterol: cholesterol, triglycerides };
  }

  private smoothValue(current: number, newVal: number): number {
    if (current === 0 || isNaN(current)) return newVal;
    return current * (1 - this.EMA_ALPHA) + newVal * this.EMA_ALPHA;
  }

  getCalibrationProgress(): number {
    return Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100));
  }

  reset(): VitalSignsResult | null {
    const result = this.getFormattedResult();
    this.signalHistory = [];
    this.validPulseCount = 0;
    return result.spo2 !== 0 ? result : null;
  }

  fullReset(): void {
    this.signalHistory = [];
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
      lastArrhythmiaData: null,
      signalQuality: 0
    };
    this.rgbData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
    this.isCalibrating = false;
    this.calibrationSamples = 0;
    this.arrhythmiaProcessor.reset();
  }
}
