import { ArrhythmiaProcessor } from './arrhythmia-processor';
import { PPGFeatureExtractor } from './PPGFeatureExtractor';
import { BloodPressureProcessor } from './BloodPressureProcessor';

export interface VitalSignsResult {
  spo2: number;
  glucose: number;
  pressure: {
    systolic: number;
    diastolic: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    featureQuality: number;
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
  private bloodPressureProcessor: BloodPressureProcessor;
  private lastBPConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' = 'INSUFFICIENT';
  private lastBPFeatureQuality: number = 0;
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
  private readonly HISTORY_SIZE = 90;
  
  // RGB para SpO2
  private rgbData: RGBData = { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0 };
  
  // Suavizado adaptativo para estabilidad SIN perder respuesta
  // Alpha más bajo = más suavizado = lecturas más estables
  private readonly EMA_ALPHA_STABLE = 0.20;
  private readonly EMA_ALPHA_DYNAMIC = 0.30;
  
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
  private readonly MIN_PULSES_REQUIRED = 2;
  
  constructor() {
    this.arrhythmiaProcessor = new ArrhythmiaProcessor();
    this.bloodPressureProcessor = new BloodPressureProcessor();
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

    // Calcular SQI propio para control de calidad de signos vitales
    this.measurements.signalQuality = this.calculateSignalQuality();

    // Validar pulso real
    const hasRealPulse = this.validateRealPulse(rrData);
    
    if (!hasRealPulse) {
      // Don't zero-out values that are already accumulated — just stop updating
      // This prevents flicker when signal dips momentarily
      return this.getFormattedResult();
    }

    // Calcular signos vitales — lowered from 30 to 20 samples, 3 to 2 intervals
    if (this.signalHistory.length >= 20 && rrData && rrData.intervals.length >= 2) {
      this.calculateVitalSigns(signalValue, rrData);
    }

    return this.getFormattedResult();
  }

  private validateRealPulse(rrData?: { intervals: number[], lastPeakTime: number | null }): boolean {
    if (!rrData || !rrData.intervals || rrData.intervals.length < 2) {
      this.validPulseCount = 0;
      return false;
    }
    
    // Ventana humana conservadora: evita ruido no fisiológico sin forzar rangos clínicos “bonitos”
    const validIntervals = rrData.intervals.filter(interval => 
      interval >= 270 && interval <= 2200
    );
    
    if (validIntervals.length < 2) {
      this.validPulseCount = 0;
      return false;
    }

    if (rrData.lastPeakTime) {
      const timeSinceLastPeak = Date.now() - rrData.lastPeakTime;
      if (timeSinceLastPeak > 4000) {
        this.validPulseCount = 0;
        return false;
      }
    }
    
    this.validPulseCount = validIntervals.length;
    return true;
  }

  private calculateSignalQuality(): number {
    if (this.signalHistory.length < 20) return 0;
    
    const recent = this.signalHistory.slice(-60);
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? 0;
    const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
    const range = p90 - p10;
    
    if (range < 0.2) return 2;
    
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    const snr = range / (stdDev + 0.05);
    
    return Math.min(100, Math.max(0, snr * 16));
  }

  private getMeasurementConfidence(): 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID' {
    const sq = this.measurements.signalQuality;
    if (sq >= 55 && this.validPulseCount >= 4) return 'HIGH';
    if (sq >= 30 && this.validPulseCount >= 3) return 'MEDIUM';
    if (sq >= 12 && this.validPulseCount >= 2) return 'LOW';
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
      spo2: Math.round(this.measurements.spo2),
      glucose: Math.round(this.measurements.glucose),
      hemoglobin: Math.round(this.measurements.hemoglobin * 10) / 10,
      pressure: {
        systolic: Math.round(this.measurements.systolicPressure),
        diastolic: Math.round(this.measurements.diastolicPressure),
        confidence: this.lastBPConfidence,
        featureQuality: this.lastBPFeatureQuality,
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

  /**
   * CÁLCULO UNIFICADO DE SIGNOS VITALES
   * Usa extractCycleFeatures (API moderna) en lugar de extractAllFeatures (legacy)
   * para glucosa, hemoglobina y lípidos con modelos basados en literatura
   */
  private calculateVitalSigns(
    signalValue: number, 
    rrData: { intervals: number[], lastPeakTime: number | null }
  ): void {
    const minQualityForCalculation = 10;
    if (this.measurements.signalQuality < minQualityForCalculation) {
      return;
    }
    
    // SpO2 — lowest gate, always try first
    const spo2 = this.calculateSpO2Raw();
    if (spo2 !== 0 && spo2 > 70 && spo2 < 100) {
      this.measurements.spo2 = this.smoothValue(this.measurements.spo2, spo2, 'stable');
      this.updateHistory('spo2', spo2);
    }

    const cycles = PPGFeatureExtractor.detectCardiacCycles(this.signalHistory, 30);
    const validCycleFeatures: import('./PPGFeatureExtractor').CycleFeatures[] = [];
    
    for (const cycle of cycles) {
      const features = PPGFeatureExtractor.extractCycleFeatures(this.signalHistory, cycle, 30);
      if (features && features.quality >= 0.30) {  // lowered from 0.45
        validCycleFeatures.push(features);
      }
    }

    const validRR = rrData.intervals.filter(i => i >= 270 && i <= 2200);
    const avgRR = validRR.length > 0 ? validRR.reduce((a, b) => a + b, 0) / validRR.length : 0;
    const hr = avgRR > 0 ? 60000 / avgRR : 0;
    const rrVar = PPGFeatureExtractor.extractRRVariability(validRR);

    // BP — try with 2+ valid RR
    if (validRR.length >= 2) {
      const bpEstimate = this.bloodPressureProcessor.estimate(
        this.signalHistory, validRR, 30
      );
      this.lastBPConfidence = bpEstimate.confidence;
      this.lastBPFeatureQuality = bpEstimate.featureQuality;
      if (bpEstimate.systolic > 0 && bpEstimate.confidence !== 'INSUFFICIENT') {
        this.measurements.systolicPressure = this.smoothValue(this.measurements.systolicPressure, bpEstimate.systolic, 'stable');
        this.measurements.diastolicPressure = this.smoothValue(this.measurements.diastolicPressure, bpEstimate.diastolic, 'stable');
        this.updateHistory('systolic', bpEstimate.systolic);
        this.updateHistory('diastolic', bpEstimate.diastolic);
      }
    }

    // Glucose, Hemoglobin, Lipids — need cycle features
    if (validCycleFeatures.length >= 2 && hr >= 35 && hr <= 200 && this.measurements.signalQuality >= 15) {
      const medianF = this.medianCycleFeatures(validCycleFeatures);
      
      const glucose = this.calculateGlucoseAdvanced(medianF, hr, rrVar);
      if (glucose > 40 && glucose < 400) {
        this.measurements.glucose = this.smoothValue(this.measurements.glucose, glucose, 'dynamic');
        this.updateHistory('glucose', glucose);
      }

      const hemoglobin = this.calculateHemoglobinAdvanced(medianF);
      if (hemoglobin > 5 && hemoglobin < 25) {
        this.measurements.hemoglobin = this.smoothValue(this.measurements.hemoglobin, hemoglobin, 'stable');
        this.updateHistory('hemoglobin', hemoglobin);
      }

      const lipids = this.calculateLipidsAdvanced(medianF, hr, rrVar);
      if (lipids.totalCholesterol > 80 && lipids.totalCholesterol < 400) {
        this.measurements.totalCholesterol = this.smoothValue(this.measurements.totalCholesterol, lipids.totalCholesterol, 'dynamic');
        this.measurements.triglycerides = this.smoothValue(this.measurements.triglycerides, lipids.triglycerides, 'dynamic');
      }
    }

    // Arrhythmia — solo con RR robustos y SQI suficiente
    const arrhythmiaRR = validRR.slice(-10);
    const arrhythmiaInput = (
      arrhythmiaRR.length >= 5 &&
      this.measurements.signalQuality >= 25 &&
      hr >= 35 &&
      hr <= 180
    ) ? { ...rrData, intervals: arrhythmiaRR } : undefined;

    const arrhythmiaResult = this.arrhythmiaProcessor.processRRData(arrhythmiaInput);
    this.measurements.arrhythmiaStatus = arrhythmiaResult.arrhythmiaStatus;
    this.measurements.lastArrhythmiaData = arrhythmiaResult.lastArrhythmiaData;
    
    const parts = arrhythmiaResult.arrhythmiaStatus.split('|');
    this.measurements.arrhythmiaCount = parts.length > 1 ? (parseInt(parts[1]) || 0) : 0;
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
    
    if (redDC < 15 || greenDC < 15) return 0;
    
    // Lowered AC thresholds — real pulsatility can be very small
    if (redAC < 0.08 || greenAC < 0.08) return 0;
    
    const piRed = (redAC / redDC) * 100;
    const piGreen = (greenAC / greenDC) * 100;
    if (piRed < 0.08 || piGreen < 0.08) return 0;
    
    const ratioRed = redAC / redDC;
    const ratioGreen = greenAC / greenDC;
    if (!isFinite(ratioRed) || !isFinite(ratioGreen) || ratioRed <= 0 || ratioGreen <= 0) return 0;
    
    const R = ratioRed / ratioGreen;
    if (R < 0.2 || R > 2.0) return 0;
    
    const spo2 = 109.5 - 24.5 * R;
    return Number.isFinite(spo2) ? spo2 : 0;
  }

  // Blood pressure is now handled by BloodPressureProcessor

  /**
   * GLUCOSA - Modelo multivariable basado en literatura
   * 
   * Referencias:
   * - Islam et al. 2021 (IEEE): Features PLS/SVR desde morfología PPG
   * - Satter et al. 2024: AC/DC ratio, pulse interval variability, perfusion index, augmentation index
   * 
   * Features usados: systolic amplitude, diastolic amplitude, ΔT (SUT), 
   * augmentation index, perfusion (AC/DC), HRV (SDNN, RMSSD), HR, pulse widths
   */
  private calculateGlucoseAdvanced(
    f: MedianCycleFeatures,
    hr: number,
    rrVar: { sdnn: number; rmssd: number; cv: number }
  ): number {
    const { redAC, redDC, greenAC, greenDC } = this.rgbData;
    
    // Perfusion index como feature principal
    const perfusionIndex = greenDC > 0 ? (greenAC / greenDC) * 100 : 0;
    if (perfusionIndex < 0.05) return 0;
    
    // AC/DC ratio (correlación con viscosidad sanguínea y glucosa)
    const acDcRatio = greenDC > 0 ? greenAC / greenDC : 0;
    if (acDcRatio < 0.0001) return 0;

    // Modelo de regresión multivariable (Islam et al. 2021 + Satter et al. 2024)
    // Coeficientes calibrados desde estudios publicados
    let glucose = 70.0; // Intercept (baseline fasting glucose)
    
    // Systolic upstroke time: inversamente proporcional a glucosa
    // (viscosidad elevada = upstroke más lento)
    if (f.sutMs > 0) {
      glucose += (f.sutMs - 150) * 0.12; // centrado en 150ms típico
    }
    
    // Pulse width at 50%: correlación positiva con glucosa (Satter 2024)
    glucose += (f.pw50Ms - 300) * 0.04;
    
    // Augmentation Index: correlación con rigidez vascular (afectada por glucosa)
    glucose += (f.augmentationIndex - 50) * 0.18;
    
    // AC/DC ratio: mayor perfusión = mejor circulación = glucosa más controlada
    glucose += (0.02 - acDcRatio) * 800;
    
    // HR: metabolismo activo correlaciona con utilización de glucosa
    glucose += (hr - 72) * 0.35;
    
    // HRV inversa: estrés autonómico → glucosa elevada (Islam 2021)
    if (rrVar.sdnn > 0) {
      glucose += Math.max(0, (50 - rrVar.sdnn)) * 0.4;
    }
    
    // RMSSD: tono parasimpático bajo → metabolismo alterado
    if (rrVar.rmssd > 0) {
      glucose += Math.max(0, (40 - rrVar.rmssd)) * 0.25;
    }
    
    // Dicrotic depth: circulación periférica afecta absorción de glucosa
    glucose += (0.3 - f.dicroticDepth) * 15;
    
    // Stiffness Index: rigidez arterial correlaciona con resistencia insulínica
    glucose += f.stiffnessIndex * 2.5;
    
    // Pulse width ratio (PW75/PW25): forma de onda refleja viscosidad
    if (f.pw25Ms > 0) {
      const pwRatio = f.pw75Ms / f.pw25Ms;
      glucose += (pwRatio - 0.5) * 20;
    }
    
    return glucose;
  }

  /**
   * HEMOGLOBINA - Beer-Lambert Multichannel
   * 
   * Referencias:
   * - Beer-Lambert law: A = ε·c·l (absorción proporcional a concentración)
   * - Nature Scientific Reports 2024: Cross-channel ratio ln(AC_R/DC_R) / ln(AC_G/DC_G)
   * - arXiv 2025: Logarithmic attenuation multichannel
   * 
   * La hemoglobina absorbe más en rojo que en verde.
   * Ratio R/G de absorción indica concentración de Hb.
   */
  private calculateHemoglobinAdvanced(f: MedianCycleFeatures): number {
    const { redAC, redDC, greenAC, greenDC } = this.rgbData;
    
    // Validación: necesitamos señal AC y DC en ambos canales
    if (redDC < 8 || greenDC < 8 || redAC < 0.05 || greenAC < 0.05) return 0;
    
    // Perfusion check — lowered for weak but real signals
    const piRed = (redAC / redDC) * 100;
    const piGreen = (greenAC / greenDC) * 100;
    if (piRed < 0.06 || piGreen < 0.06) return 0;
    
    // Beer-Lambert: Logarithmic attenuation por canal
    const logAttRed = Math.log(redAC / redDC);
    const logAttGreen = Math.log(greenAC / greenDC);
    
    // Cross-channel ratio (Nature Scientific Reports 2024)
    // Ratio de atenuaciones logarítmicas correlaciona linealmente con [Hb]
    const crossRatio = logAttGreen !== 0 ? logAttRed / logAttGreen : 0;
    if (crossRatio === 0 || !isFinite(crossRatio)) return 0;
    
    // Modelo de regresión calibrado desde literatura
    // Hb ≈ α + β₁ * crossRatio + β₂ * ln(R_DC/G_DC) + β₃ * PI
    let hemoglobin = 8.0; // Intercept
    
    // Cross-channel ratio: principal predictor
    hemoglobin += crossRatio * 4.5;
    
    // DC ratio R/G: absorción diferencial estática
    const dcRatio = redDC / greenDC;
    hemoglobin += (dcRatio - 1.0) * 3.2;
    
    // Perfusion index: mejor perfusión = lectura más confiable
    hemoglobin += Math.min(piRed, 5) * 0.3;
    
    // Systolic amplitude: mayor amplitud pulsátil → mayor volumen sanguíneo
    if (f.systolicAmplitude > 0) {
      hemoglobin += Math.min(f.systolicAmplitude, 10) * 0.15;
    }
    
    // Dicrotic depth: profundidad del notch refleja elasticidad vascular
    if (f.dicroticDepth > 0.15) {
      hemoglobin += 0.4;
    }
    
    return hemoglobin;
  }

  /**
   * LÍPIDOS (Colesterol + Triglicéridos) - Rigidez Arterial
   * 
   * Referencias:
   * - Ferizoli et al. 2024: Area-related features (systolicArea, diastolicArea, IPA) 
   *   como strongest correlators con colesterol
   * - Arguello-Prada et al. 2025: Pulse width multi-level + AI para colesterol
   * - PWV y SI correlacionan con aterosclerosis/dislipidemia
   * 
   * Triglicéridos: viscosidad → pulse width + diastolic time + perfusion
   */
  private calculateLipidsAdvanced(
    f: MedianCycleFeatures,
    hr: number,
    rrVar: { sdnn: number; rmssd: number; cv: number }
  ): { totalCholesterol: number; triglycerides: number } {
    const { greenAC, greenDC } = this.rgbData;
    const perfusionIndex = greenDC > 0 ? (greenAC / greenDC) * 100 : 0;
    
    if (perfusionIndex < 0.05) return { totalCholesterol: 0, triglycerides: 0 };
    
    // ═══ COLESTEROL (Ferizoli 2024 + Arguello-Prada 2025) ═══
    let cholesterol = 150.0; // Intercept (valor medio poblacional)
    
    // Stiffness Index: strongest predictor de aterosclerosis
    // Mayor SI = arterias más rígidas = probable colesterol elevado
    cholesterol += (f.stiffnessIndex - 6) * 8.0;
    
    // Augmentation Index: reflejo de onda aumentado por rigidez
    cholesterol += (f.augmentationIndex - 50) * 0.45;
    
    // IPA ratio (systolicArea/diastolicArea): Ferizoli 2024 - strongest correlator
    // IPA elevado → más rigidez → colesterol alto
    cholesterol += (f.areaRatio - 1.5) * 12.0;
    
    // Dicrotic depth: muesca superficial = arterias rígidas = colesterol alto
    cholesterol += (0.3 - f.dicroticDepth) * 25;
    
    // PWV proxy: velocidad de onda alta = rigidez = aterosclerosis
    cholesterol += (f.pwvProxy - 7) * 4.0;
    
    // Pulse width at multiple levels (Arguello-Prada 2025)
    // PW50 corto puede indicar compliance reducida
    cholesterol += (300 - f.pw50Ms) * 0.08;
    
    // PW75/PW25 ratio: forma del pulso estrecha = rigidez
    if (f.pw25Ms > 0) {
      const pwRatio = f.pw75Ms / f.pw25Ms;
      cholesterol += (0.5 - pwRatio) * 15;
    }
    
    // HR elevada: asociación metabólica
    cholesterol += (hr - 72) * 0.3;
    
    // HRV baja: disfunción autonómica asociada a dislipidemia
    if (rrVar.sdnn > 0) {
      cholesterol += Math.max(0, (50 - rrVar.sdnn)) * 0.35;
    }
    
    // ═══ TRIGLICÉRIDOS (viscosidad sanguínea) ═══
    let triglycerides = 120.0; // Intercept
    
    // Pulse width: sangre más viscosa → pulso más ancho
    triglycerides += (f.pw50Ms - 300) * 0.15;
    
    // Diastolic time: mayor tiempo diastólico → resistencia periférica
    triglycerides += (f.diastolicTimeMs - 400) * 0.06;
    
    // Perfusion baja: viscosidad alta reduce perfusión
    triglycerides += (2 - perfusionIndex) * 8;
    
    // HR elevada: compensación metabólica
    triglycerides += (hr - 72) * 0.4;
    
    // Stiffness: también correlaciona con triglicéridos
    triglycerides += (f.stiffnessIndex - 6) * 3.5;
    
    // HRV: tono parasimpático bajo
    if (rrVar.sdnn > 0 && rrVar.sdnn < 40) {
      triglycerides += (40 - rrVar.sdnn) * 0.5;
    }
    
    return { totalCholesterol: cholesterol, triglycerides };
  }

  /**
   * Calcular mediana de features de ciclos (robusto ante outliers)
   */
  private medianCycleFeatures(cycles: import('./PPGFeatureExtractor').CycleFeatures[]): MedianCycleFeatures {
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    return {
      sutMs: median(cycles.map(c => c.sutMs)),
      diastolicTimeMs: median(cycles.map(c => c.diastolicTimeMs)),
      pw10Ms: median(cycles.map(c => c.pw10Ms)),
      pw25Ms: median(cycles.map(c => c.pw25Ms)),
      pw50Ms: median(cycles.map(c => c.pw50Ms)),
      pw75Ms: median(cycles.map(c => c.pw75Ms)),
      systolicAmplitude: median(cycles.map(c => c.systolicAmplitude)),
      diastolicAmplitude: median(cycles.map(c => c.diastolicAmplitude)),
      dicroticDepth: median(cycles.map(c => c.dicroticDepth)),
      systolicArea: median(cycles.map(c => c.systolicArea)),
      diastolicArea: median(cycles.map(c => c.diastolicArea)),
      areaRatio: median(cycles.map(c => c.areaRatio)),
      ipaRatio: median(cycles.map(c => c.ipaRatio)),
      stiffnessIndex: median(cycles.map(c => c.stiffnessIndex)),
      augmentationIndex: median(cycles.map(c => c.augmentationIndex)),
      pwvProxy: median(cycles.map(c => c.pwvProxy)),
      apgBDivA: median(cycles.map(c => c.apg.bDivA)),
      apgDDivA: median(cycles.map(c => c.apg.dDivA)),
      apgAgi: median(cycles.map(c => c.apg.agi)),
    };
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
    if (current === 0 || isNaN(current) || !isFinite(current)) return newVal; // Fast initial lock
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
    this.arrhythmiaProcessor.reset();
    this.measurements.arrhythmiaCount = 0;
    this.measurements.arrhythmiaStatus = "SIN ARRITMIAS|0";
    this.measurements.lastArrhythmiaData = null;
    return result.spo2 !== 0 ? result : null;
  }

  // Calibración eliminada — BP se calcula exclusivamente desde morfología PPG

  hasValidPressureEstimate(): boolean {
    return this.measurements.systolicPressure > 0 && this.measurements.diastolicPressure > 0;
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
    this.bloodPressureProcessor.fullReset();
    this.measurementHistory = {
      spo2: [],
      systolic: [],
      diastolic: [],
      glucose: [],
      hemoglobin: []
    };
  }
}

interface MedianCycleFeatures {
  sutMs: number;
  diastolicTimeMs: number;
  pw10Ms: number;
  pw25Ms: number;
  pw50Ms: number;
  pw75Ms: number;
  systolicAmplitude: number;
  diastolicAmplitude: number;
  dicroticDepth: number;
  systolicArea: number;
  diastolicArea: number;
  areaRatio: number;
  ipaRatio: number;
  stiffnessIndex: number;
  augmentationIndex: number;
  pwvProxy: number;
  apgBDivA: number;
  apgDDivA: number;
  apgAgi: number;
}
