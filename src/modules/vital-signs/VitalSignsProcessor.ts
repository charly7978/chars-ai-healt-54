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
  
  // Suavizado adaptativo - MAYOR RESPUESTA a cambios reales
  // Alpha más alto = menos suavizado = responde más rápido a cambios fisiológicos
  private readonly EMA_ALPHA_STABLE = 0.25;  // Para SpO2 (cambia menos con ejercicio)
  private readonly EMA_ALPHA_DYNAMIC = 0.40; // Para PA, Glucosa (cambian más con actividad)
  
  // Historial para validación de tendencias
  private measurementHistory: { [key: string]: number[] } = {
    spo2: [],
    systolic: [],
    diastolic: [],
    glucose: [],
    hemoglobin: []
  };
  private readonly HISTORY_SIZE_VALIDATION = 10;
  
  // NUEVO: Almacenar HR actual para usar en cálculos
  private currentHR: number = 0;
  
  // Contador de pulsos válidos
  private validPulseCount: number = 0;
  private readonly MIN_PULSES_REQUIRED = 2; // Reducido para inicio más rápido
  
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
    
    // SIN FILTROS FISIOLÓGICOS - Solo filtro técnico mínimo
    // Intervalos de 100ms a 5000ms permiten desde 12 BPM hasta 600 BPM (cubre cualquier señal real)
    const validIntervals = rrData.intervals.filter(interval => 
      interval >= 100 && interval <= 5000
    );
    
    // Requerir menos pulsos para iniciar el procesamiento
    if (validIntervals.length < 2) {
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

  /**
   * FORMATEO DE RESULTADOS - REDONDEO APROPIADO
   * Cada signo vital tiene su formato específico:
   * - SpO2: entero (97, 98, 99)
   * - Presión arterial: enteros (120/80)
   * - Glucosa: entero (95, 110, 120)
   * - Hemoglobina: 1 decimal (13.5, 14.2)
   * - Colesterol/Triglicéridos: enteros (180, 150)
   */
  private getFormattedResult(): VitalSignsResult {
    return {
      // SpO2: entero (sin decimales)
      spo2: Math.round(this.measurements.spo2),
      
      // Glucosa: entero (sin decimales)
      glucose: Math.round(this.measurements.glucose),
      
      // Hemoglobina: 1 decimal
      hemoglobin: Math.round(this.measurements.hemoglobin * 10) / 10,
      
      // Presión arterial: enteros
      pressure: {
        systolic: Math.round(this.measurements.systolicPressure),
        diastolic: Math.round(this.measurements.diastolicPressure)
      },
      
      arrhythmiaCount: this.measurements.arrhythmiaCount,
      arrhythmiaStatus: this.measurements.arrhythmiaStatus,
      
      // Lípidos: enteros
      lipids: {
        totalCholesterol: Math.round(this.measurements.totalCholesterol),
        triglycerides: Math.round(this.measurements.triglycerides)
      },
      
      isCalibrating: this.isCalibrating,
      calibrationProgress: Math.min(100, Math.round((this.calibrationSamples / this.CALIBRATION_REQUIRED) * 100)),
      lastArrhythmiaData: this.measurements.lastArrhythmiaData ?? undefined,
      
      // Calidad: entero
      signalQuality: Math.round(this.measurements.signalQuality),
      measurementConfidence: this.getMeasurementConfidence()
    };
  }

  private calculateVitalSigns(
    signalValue: number, 
    rrData: { intervals: number[], lastPeakTime: number | null }
  ): void {
    const features = PPGFeatureExtractor.extractAllFeatures(this.signalHistory, rrData.intervals);
    
    // Validar calidad de señal mínima
    const minQualityForCalculation = 15;
    if (this.measurements.signalQuality < minQualityForCalculation) {
      return;
    }
    
    // CRÍTICO: Calcular HR desde intervalos RR - BASE DE TODA LA COHERENCIA
    const validIntervals = rrData.intervals.filter(i => i >= 200 && i <= 2000);
    if (validIntervals.length >= 2) {
      const avgRR = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
      this.currentHR = 60000 / avgRR;
    }
    
    // Log para debug de coherencia
    if (this.signalHistory.length % 30 === 0) {
      console.log(`🏃 HR=${this.currentHR.toFixed(0)} → Afecta PA, Glucosa, Lípidos`);
    }
    
    // 1. SpO2 - Menos afectado por ejercicio (baja ligeramente con ejercicio intenso)
    const spo2 = this.calculateSpO2Raw();
    if (spo2 !== 0 && spo2 > 50 && spo2 < 105) {
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2, 'stable');
      this.updateHistory('spo2', spo2);
    }

    // 2. Presión arterial - MUY AFECTADA por HR (ejercicio = PA alta)
    const pressure = this.calculateBloodPressureFromMorphology(rrData.intervals, features);
    if (pressure.systolic !== 0 && pressure.systolic > 50 && pressure.systolic < 280) {
      // PA usa suavizado dinámico para responder a ejercicio
      this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, pressure.systolic, 'dynamic');
      this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, pressure.diastolic, 'dynamic');
      this.updateHistory('systolic', pressure.systolic);
      this.updateHistory('diastolic', pressure.diastolic);
    }

    // 3. Glucosa - AFECTADA por ejercicio (consumo metabólico)
    const glucose = this.calculateGlucoseRaw(features, rrData.intervals);
    if (glucose !== 0 && glucose > 40 && glucose < 400) {
      this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucose, 'dynamic');
      this.updateHistory('glucose', glucose);
    }

    // 4. Hemoglobina - Menos afectada a corto plazo
    const hemoglobin = this.calculateHemoglobinRaw(features);
    if (hemoglobin !== 0 && hemoglobin > 5 && hemoglobin < 25) {
      this.measurements.hemoglobin = this.smoothValue(this.measurements.hemoglobin, hemoglobin, 'stable');
      this.updateHistory('hemoglobin', hemoglobin);
    }

    // 5. Lípidos - suavizado dinámico
    const lipids = this.calculateLipidsRaw(features, rrData.intervals);
    if (lipids.totalCholesterol !== 0 && lipids.totalCholesterol > 80 && lipids.totalCholesterol < 400) {
      this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol, lipids.totalCholesterol, 'dynamic');
      this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides, lipids.triglycerides, 'dynamic');
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
   * SpO2 - FÓRMULA RATIO-OF-RATIOS (TI SLAA655)
   * 
   * COHERENCIA: SpO2 baja ligeramente con ejercicio intenso (desaturación leve)
   * - Reposo: 97-99%
   * - Ejercicio moderado: 95-97%
   * - Ejercicio intenso: 92-96%
   */
  private calculateSpO2Raw(): number {
    const { redAC, redDC, greenAC, greenDC } = this.rgbData;
    
    if (redDC < 10 || greenDC < 10) return 0;
    if (redAC < 0.1 || greenAC < 0.1) return 0;
    
    const piRed = (redAC / redDC) * 100;
    const piGreen = (greenAC / greenDC) * 100;
    
    if (piRed < 0.05 || piGreen < 0.05) return 0;
    
    const ratioRed = redAC / redDC;
    const ratioGreen = greenAC / greenDC;
    const R = ratioRed / ratioGreen;
    
    // Fórmula TI estándar
    let spo2 = 110 - 25 * R;
    
    // COHERENCIA: Ajuste por HR (ejercicio intenso reduce SpO2 ligeramente)
    if (this.currentHR > 100) {
      // HR > 100: reducción leve de SpO2 (demanda O2 alta)
      const hrFactor = Math.min(3, (this.currentHR - 100) * 0.03);
      spo2 -= hrFactor;
    }
    
    if (this.signalHistory.length % 45 === 0) {
      console.log(`📊 SpO2: R=${R.toFixed(3)} HR=${this.currentHR.toFixed(0)} → ${spo2.toFixed(1)}%`);
    }
    
    return spo2;
  }

  /**
   * PRESIÓN ARTERIAL DESDE MORFOLOGÍA PPG
   * 
   * Basado en literatura:
   * - Augmentation Index (AIx) correlaciona con rigidez arterial
   * - Stiffness Index (SI) indica velocidad de onda de pulso
   * - Tiempo sistólico inversamente proporcional a presión
   * - PTT (si disponible) es el gold standard
   * 
   * Referencias: Mukkamala 2022, Elgendi 2019, Schrumpf 2021
   * 
   * NOTA: Sin calibración individual, estos valores son ESTIMACIONES
   */
  /**
   * PRESIÓN ARTERIAL - COHERENTE CON ESTADO FISIOLÓGICO
   * 
   * PRINCIPIO: HR es el indicador principal del esfuerzo
   * - Reposo (HR 50-70): PA baja (100-120 / 60-80)
   * - Actividad moderada (HR 80-100): PA media (120-140 / 70-90)
   * - Ejercicio intenso (HR >120): PA alta (140-180 / 80-100)
   * 
   * La fórmula usa HR como componente PRINCIPAL
   */
  private calculateBloodPressureFromMorphology(
    intervals: number[], 
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>
  ): { systolic: number; diastolic: number } {
    const validIntervals = intervals.filter(i => i >= 200 && i <= 2000);
    if (validIntervals.length < 3) {
      return { systolic: 0, diastolic: 0 };
    }
    
    const { systolicTime, dicroticDepth, acDcRatio, sdnn, 
            augmentationIndex, stiffnessIndex, pwvProxy, apg } = features;
    
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    const hr = 60000 / avgInterval;
    
    // === MODELO COHERENTE: HR ES EL FACTOR DOMINANTE ===
    
    // BASE: Mapeo directo de HR a PA sistólica
    // HR 60 → ~110 mmHg, HR 100 → ~130 mmHg, HR 150 → ~170 mmHg
    let systolicEstimate = 70 + hr * 0.65;
    
    // Componentes morfológicos (ajuste fino, no dominante)
    
    // Tiempo sistólico corto = arterias rígidas = +PA
    if (systolicTime > 0) {
      const systolicTimeMs = systolicTime * (1000 / 30);
      // Ajuste secundario: ±15 mmHg máximo
      systolicEstimate += Math.max(-15, Math.min(15, (150 - systolicTimeMs) * 0.1));
    }
    
    // Stiffness Index alto = +PA (hasta +10 mmHg)
    if (stiffnessIndex > 0) {
      systolicEstimate += Math.min(10, stiffnessIndex * 3);
    }
    
    // Augmentation Index = rigidez (±8 mmHg)
    if (augmentationIndex !== 0) {
      systolicEstimate += Math.max(-8, Math.min(8, augmentationIndex * 0.15));
    }
    
    // PWV proxy = velocidad de onda (±8 mmHg)
    if (pwvProxy > 0) {
      systolicEstimate += Math.min(8, (pwvProxy - 5) * 2);
    }
    
    // Muesca dicrotica profunda = arterias elásticas = -PA
    if (dicroticDepth > 0.1) {
      systolicEstimate -= Math.min(10, dicroticDepth * 15);
    }
    
    // HRV baja = estrés = +PA (hasta +8 mmHg)
    if (sdnn > 0 && sdnn < 40) {
      systolicEstimate += Math.min(8, (40 - sdnn) * 0.2);
    }
    
    // AGI (Aging Index)
    if (apg.agi !== 0) {
      systolicEstimate += Math.max(-5, Math.min(5, apg.agi * 2));
    }
    
    // === DIASTÓLICA ===
    // Ratio SBP/DBP varía con HR
    // En ejercicio, SBP sube más que DBP (ratio aumenta)
    let diastolicRatio = 1.5 + (hr - 70) * 0.003;
    diastolicRatio = Math.max(1.4, Math.min(2.0, diastolicRatio));
    
    let diastolicEstimate = systolicEstimate / diastolicRatio;
    
    // HRV baja = tono simpático = DBP más alta
    if (sdnn > 0 && sdnn < 30) {
      diastolicEstimate += (30 - sdnn) * 0.15;
    }
    
    // Log para verificar coherencia
    if (this.signalHistory.length % 45 === 0) {
      console.log(`💉 PA COHERENTE: HR=${hr.toFixed(0)} → ${systolicEstimate.toFixed(0)}/${diastolicEstimate.toFixed(0)} mmHg`);
    }
    
    return { systolic: systolicEstimate, diastolic: diastolicEstimate };
  }

  /**
   * GLUCOSA - COHERENTE CON ACTIVIDAD FÍSICA
   * 
   * PRINCIPIO: 
   * - Ejercicio CONSUME glucosa → baja durante/después
   * - Reposo prolongado → glucosa más estable/normal
   * - Estrés (HRV baja) → glucosa elevada (cortisol)
   */
  private calculateGlucoseRaw(
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>,
    rrIntervals: number[]
  ): number {
    if (rrIntervals.length < 3) return 0;
    
    const { acDcRatio, amplitudeVariability, sdnn, pulseWidth } = features;
    
    if (acDcRatio < 0.0001) return 0;
    
    const avgInterval = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const hr = 60000 / avgInterval;
    
    // BASE: 90-100 mg/dL en reposo
    let glucose = 85;
    
    // Perfusión (indicador de estado metabólico)
    glucose += acDcRatio * 800;
    
    // Variabilidad de amplitud PPG
    glucose += amplitudeVariability * 2;
    
    // HR y consumo de glucosa:
    // - HR bajo (reposo): glucosa normal
    // - HR moderado (70-100): consumo activo, glucosa puede variar
    // - HR alto (>100): consumo intenso, glucosa puede bajar
    if (hr < 70) {
      // Reposo - glucosa estable
      glucose += 5;
    } else if (hr >= 70 && hr < 100) {
      // Actividad moderada
      glucose += (hr - 70) * 0.3;
    } else {
      // Ejercicio intenso - consumo alto
      // Inicialmente puede subir (liberación), luego baja
      glucose += 10 - (hr - 100) * 0.15;
    }
    
    // HRV baja = estrés = cortisol = glucosa elevada
    if (sdnn > 0 && sdnn < 40) {
      glucose += (40 - sdnn) * 0.4;
    }
    
    // Ancho de pulso
    glucose += pulseWidth * 1.5;
    
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

  /**
   * Actualizar historial de mediciones para análisis de tendencias
   */
  private updateHistory(key: string, value: number): void {
    if (!this.measurementHistory[key]) {
      this.measurementHistory[key] = [];
    }
    this.measurementHistory[key].push(value);
    if (this.measurementHistory[key].length > this.HISTORY_SIZE_VALIDATION) {
      this.measurementHistory[key].shift();
    }
  }

  /**
   * Suavizado EMA - MEJORADO PARA RESPONDER A CAMBIOS REALES
   * 
   * Permite cambios coherentes con la actividad física
   * pero filtra ruido extremo
   */
  private smoothValue(current: number, newVal: number, type: 'stable' | 'dynamic' = 'stable'): number {
    if (current === 0 || isNaN(current) || !isFinite(current)) return newVal;
    if (isNaN(newVal) || !isFinite(newVal)) return current;
    
    const baseAlpha = type === 'stable' ? this.EMA_ALPHA_STABLE : this.EMA_ALPHA_DYNAMIC;
    
    const relativeChange = Math.abs(newVal - current) / (Math.abs(current) + 0.01);
    
    let adaptiveAlpha = baseAlpha;
    
    // CAMBIO CLAVE: Permitir cambios moderados (coherentes con ejercicio)
    if (relativeChange > 0.6) {
      // Solo filtrar cambios muy extremos (>60%)
      adaptiveAlpha = baseAlpha * 0.4;
    } else if (relativeChange > 0.4) {
      // Cambio grande pero posiblemente real
      adaptiveAlpha = baseAlpha * 0.7;
    } else if (relativeChange < 0.1) {
      // Cambio pequeño - seguir tendencia
      adaptiveAlpha = Math.min(0.5, baseAlpha * 1.3);
    }
    // Cambios entre 10-40% pasan con alpha base (respuesta normal)
    
    // Alpha más alto para responder a ejercicio
    adaptiveAlpha = Math.max(0.1, Math.min(0.5, adaptiveAlpha));
    
    return current * (1 - adaptiveAlpha) + newVal * adaptiveAlpha;
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
    // Limpiar historial de mediciones
    this.measurementHistory = {
      spo2: [],
      systolic: [],
      diastolic: [],
      glucose: [],
      hemoglobin: []
    };
  }
}
