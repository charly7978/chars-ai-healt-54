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
  
  // Suavizado adaptativo para estabilidad SIN perder respuesta
  // Alpha más bajo = más suavizado = lecturas más estables
  private readonly EMA_ALPHA_STABLE = 0.15;  // Para valores que cambian lento (SpO2, PA)
  private readonly EMA_ALPHA_DYNAMIC = 0.25; // Para valores más variables (Glucosa, HRV)
  
  // Historial para validación de tendencias
  private measurementHistory: { [key: string]: number[] } = {
    spo2: [],
    systolic: [],
    diastolic: [],
    glucose: [],
    hemoglobin: []
  };
  private readonly HISTORY_SIZE_VALIDATION = 10; // Últimas 10 mediciones
  
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
    
    // Validar calidad de señal mínima antes de calcular
    const minQualityForCalculation = 15;
    if (this.measurements.signalQuality < minQualityForCalculation) {
      // Señal muy débil - no actualizar valores para evitar ruido
      return;
    }
    
    // 1. SpO2 - Fórmula estándar TI - suavizado estable
    const spo2 = this.calculateSpO2Raw();
    if (spo2 !== 0 && spo2 > 50 && spo2 < 105) {
      // Solo aceptar valores en rango razonable (aunque no forzamos, filtramos ruido extremo)
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2, 'stable');
      this.updateHistory('spo2', spo2);
    }

    // 2. Presión arterial - Desde morfología PPG - suavizado estable
    const pressure = this.calculateBloodPressureFromMorphology(rrData.intervals, features);
    if (pressure.systolic !== 0 && pressure.systolic > 50 && pressure.systolic < 250) {
      this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, pressure.systolic, 'stable');
      this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, pressure.diastolic, 'stable');
      this.updateHistory('systolic', pressure.systolic);
      this.updateHistory('diastolic', pressure.diastolic);
    }

    // 3. Glucosa - Desde características PPG - suavizado dinámico
    const glucose = this.calculateGlucoseRaw(features, rrData.intervals);
    if (glucose !== 0 && glucose > 40 && glucose < 400) {
      this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucose, 'dynamic');
      this.updateHistory('glucose', glucose);
    }

    // 4. Hemoglobina - Desde absorción RGB - suavizado estable
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
   * SpO2 - FÓRMULA RATIO-OF-RATIOS (Estándar Texas Instruments SLAA655)
   * 
   * R = (AC_red/DC_red) / (AC_ir/DC_ir)
   * SpO2 = 110 - 25 * R
   * 
   * Para cámaras usamos verde como proxy de IR (mejor SNR que azul)
   * 
   * VALIDACIÓN: Solo retorna valor si los datos son físicamente plausibles
   */
  private calculateSpO2Raw(): number {
    const { redAC, redDC, greenAC, greenDC } = this.rgbData;
    
    // Validar señal mínima (DC debe ser suficiente para medición)
    if (redDC < 10 || greenDC < 10) {
      return 0;
    }
    
    // Validar que hay componente AC (pulsátil)
    if (redAC < 0.1 || greenAC < 0.1) {
      return 0;
    }
    
    // Calcular Perfusion Index para cada canal
    const piRed = (redAC / redDC) * 100;  // Porcentaje
    const piGreen = (greenAC / greenDC) * 100;
    
    // PI típico: 0.1% - 20%. Si está fuera, señal sospechosa
    if (piRed < 0.05 || piGreen < 0.05) {
      return 0;
    }
    
    // Calcular ratios individuales
    const ratioRed = redAC / redDC;
    const ratioGreen = greenAC / greenDC;
    
    // R = (AC_red/DC_red) / (AC_green/DC_green)
    const R = ratioRed / ratioGreen;
    
    // Validar R en rango físicamente posible
    // R típico para SpO2 70-100%: aproximadamente 0.4 - 1.6
    // Pero NO aplicamos clamp, solo validamos
    if (R < 0.1 || R > 3.0) {
      // Valor extremo, probablemente ruido - pero lo calculamos igual
      if (this.signalHistory.length % 60 === 0) {
        console.warn(`⚠️ SpO2 R extremo: ${R.toFixed(3)} - posible ruido`);
      }
    }
    
    // Fórmula empírica estándar (TI SLAA655)
    // SpO2 = A - B * R
    // A = 110, B = 25 (calibración estándar pulsioxímetros)
    const spo2 = 110 - 25 * R;
    
    // Log periódico para debug
    if (this.signalHistory.length % 45 === 0) {
      console.log(`📊 SpO2: R=${R.toFixed(3)} → ${spo2.toFixed(1)}% | PI_R=${piRed.toFixed(2)}% PI_G=${piGreen.toFixed(2)}%`);
    }
    
    // RETORNAR VALOR CRUDO - el historial y EMA manejarán estabilidad
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
  private calculateBloodPressureFromMorphology(
    intervals: number[], 
    features: ReturnType<typeof PPGFeatureExtractor.extractAllFeatures>
  ): { systolic: number; diastolic: number } {
    // Solo filtro técnico mínimo (evitar ruido extremo)
    const validIntervals = intervals.filter(i => i >= 200 && i <= 3000);
    if (validIntervals.length < 3) {
      return { systolic: 0, diastolic: 0 };
    }
    
    const { systolicTime, dicroticDepth, acDcRatio, pulseWidth, sdnn, 
            augmentationIndex, stiffnessIndex, pwvProxy, apg } = features;
    
    // Verificar que hay características morfológicas válidas
    if (systolicTime <= 0 && stiffnessIndex <= 0 && acDcRatio <= 0) {
      return { systolic: 0, diastolic: 0 };
    }
    
    const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    const hr = 60000 / avgInterval;
    
    // === MODELO DE ESTIMACIÓN SISTÓLICA ===
    // Basado en características PPG sin valores base fijos
    
    // Componente 1: Tiempo sistólico (inversamente proporcional)
    // Tiempo corto = arterias rígidas = PA alta
    let systolicEstimate = 0;
    
    if (systolicTime > 0) {
      // Convertir samples a ms (asumiendo 30fps)
      const systolicTimeMs = systolicTime * (1000 / 30);
      // Tiempo sistólico típico: 100-200ms → PA 90-140
      systolicEstimate += 180 - systolicTimeMs * 0.4;
    }
    
    // Componente 2: Stiffness Index
    // SI alto = arterias rígidas = PA alta
    if (stiffnessIndex > 0) {
      systolicEstimate += stiffnessIndex * 12;
    }
    
    // Componente 3: Augmentation Index
    // AIx alto = reflexión de onda temprana = PA central alta
    if (augmentationIndex !== 0) {
      systolicEstimate += augmentationIndex * 0.5;
    }
    
    // Componente 4: HR (correlación moderada positiva con SBP)
    systolicEstimate += hr * 0.35;
    
    // Componente 5: PWV proxy
    if (pwvProxy > 0) {
      systolicEstimate += pwvProxy * 4;
    }
    
    // Componente 6: Muesca dicrotica
    // Muesca profunda = arterias elásticas = PA más baja
    if (dicroticDepth > 0) {
      systolicEstimate -= dicroticDepth * 25;
    }
    
    // Componente 7: AGI (Aging Index) desde APG
    if (apg.agi !== 0) {
      systolicEstimate += apg.agi * 8;
    }
    
    // Componente 8: Perfusión (vasoconstricción)
    if (acDcRatio > 0 && acDcRatio < 0.015) {
      // Baja perfusión = posible vasoconstricción = PA elevada
      systolicEstimate += (0.015 - acDcRatio) * 800;
    }
    
    // === MODELO DE ESTIMACIÓN DIASTÓLICA ===
    // DBP correlaciona con resistencia periférica
    
    // Ratio típico SBP/DBP: 1.4-1.6 en adultos sanos
    let diastolicRatio = 1.5;
    
    // Ajustar ratio basado en rigidez arterial
    if (stiffnessIndex > 0) {
      diastolicRatio += stiffnessIndex * 0.03;
    }
    
    // HRV baja = tono simpático alto = DBP relativamente más alta
    if (sdnn > 0 && sdnn < 30) {
      diastolicRatio -= (30 - sdnn) * 0.005;
    }
    
    diastolicRatio = Math.max(1.3, Math.min(2.0, diastolicRatio));
    
    let diastolicEstimate = systolicEstimate / diastolicRatio;
    
    // Ajuste por pulseWidth
    if (pulseWidth > 0) {
      diastolicEstimate += pulseWidth * 0.8;
    }
    
    // Log periódico
    if (this.signalHistory.length % 60 === 0) {
      console.log(`💉 PA: Ts=${systolicTime.toFixed(1)} SI=${stiffnessIndex.toFixed(2)} AIx=${augmentationIndex.toFixed(1)} → ${systolicEstimate.toFixed(0)}/${diastolicEstimate.toFixed(0)}`);
    }
    
    // Retornar valores calculados (el filtrado de outliers se hace en calculateVitalSigns)
    return { systolic: systolicEstimate, diastolic: diastolicEstimate };
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
   * Suavizado EMA adaptativo con detección de outliers
   * type: 'stable' para valores que cambian lentamente (SpO2, PA)
   *       'dynamic' para valores más variables (Glucosa)
   * 
   * MEJORA: Detecta cambios bruscos y ajusta alpha dinámicamente
   */
  private smoothValue(current: number, newVal: number, type: 'stable' | 'dynamic' = 'stable'): number {
    if (current === 0 || isNaN(current) || !isFinite(current)) return newVal;
    if (isNaN(newVal) || !isFinite(newVal)) return current;
    
    const baseAlpha = type === 'stable' ? this.EMA_ALPHA_STABLE : this.EMA_ALPHA_DYNAMIC;
    
    // Calcular cambio relativo
    const relativeChange = Math.abs(newVal - current) / (Math.abs(current) + 0.01);
    
    // Si el cambio es muy grande (>50%), podría ser ruido - suavizar más
    // Si el cambio es moderado (<20%), responder más rápido
    let adaptiveAlpha = baseAlpha;
    
    if (relativeChange > 0.5) {
      // Cambio muy grande - probablemente ruido, suavizar mucho más
      adaptiveAlpha = baseAlpha * 0.3;
    } else if (relativeChange > 0.3) {
      // Cambio grande - suavizar un poco más
      adaptiveAlpha = baseAlpha * 0.5;
    } else if (relativeChange < 0.1) {
      // Cambio pequeño - responder más rápido para seguir tendencia
      adaptiveAlpha = baseAlpha * 1.5;
    }
    
    // Limitar alpha entre 0.05 y 0.4
    adaptiveAlpha = Math.max(0.05, Math.min(0.4, adaptiveAlpha));
    
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
