/**
 * @file IntelligentCalibrator.ts
 * @description Sistema de calibración inteligente que se adapta automáticamente
 * a las condiciones específicas del dedo del usuario
 */

export interface CalibrationState {
  isCalibrating: boolean;
  progress: number; // 0-100
  adaptiveThresholds: {
    redMin: number;
    redMax: number;
    qualityMin: number;
    amplitudeMin: number;
  };
  fingerCharacteristics: {
    skinTone: 'light' | 'medium' | 'dark' | 'unknown';
    thickness: 'thin' | 'medium' | 'thick' | 'unknown';
    bloodFlow: 'low' | 'normal' | 'high' | 'unknown';
  };
}

export class IntelligentCalibrator {
  private calibrationData: number[] = [];
  private redValues: number[] = [];
  private qualityValues: number[] = [];
  private textureValues: number[] = [];
  private calibrationStartTime: number = 0;
  private readonly CALIBRATION_DURATION = 3000; // 3 segundos
  private readonly MIN_SAMPLES = 30;
  
  private state: CalibrationState = {
    isCalibrating: false,
    progress: 0,
    adaptiveThresholds: {
      redMin: 5,
      redMax: 200,
      qualityMin: 8,
      amplitudeMin: 0.05
    },
    fingerCharacteristics: {
      skinTone: 'unknown',
      thickness: 'unknown',
      bloodFlow: 'unknown'
    }
  };

  startCalibration(): void {
    console.log("IntelligentCalibrator: Iniciando calibración inteligente");
    this.state.isCalibrating = true;
    this.state.progress = 0;
    this.calibrationStartTime = Date.now();
    this.calibrationData = [];
    this.redValues = [];
    this.qualityValues = [];
    this.textureValues = [];
  }

  addCalibrationSample(redValue: number, quality: number, textureScore: number): void {
    if (!this.state.isCalibrating) return;

    this.calibrationData.push(redValue);
    this.redValues.push(redValue);
    this.qualityValues.push(quality);
    this.textureValues.push(textureScore);

    // Actualizar progreso
    const elapsed = Date.now() - this.calibrationStartTime;
    this.state.progress = Math.min(100, (elapsed / this.CALIBRATION_DURATION) * 100);

    // Calibración automática completa
    if (elapsed >= this.CALIBRATION_DURATION || this.calibrationData.length >= 100) {
      this.completeCalibration();
    }
  }

  private completeCalibration(): void {
    if (this.calibrationData.length < this.MIN_SAMPLES) {
      console.warn("IntelligentCalibrator: Datos insuficientes, extendiendo calibración");
      return;
    }

    console.log("IntelligentCalibrator: Completando calibración con", this.calibrationData.length, "muestras");

    // Analizar características del dedo
    this.analyzeFingerCharacteristics();
    
    // Calcular umbrales adaptativos
    this.calculateAdaptiveThresholds();
    
    this.state.isCalibrating = false;
    this.state.progress = 100;

    console.log("IntelligentCalibrator: Calibración completada", {
      thresholds: this.state.adaptiveThresholds,
      characteristics: this.state.fingerCharacteristics
    });
  }

  private analyzeFingerCharacteristics(): void {
    if (this.redValues.length === 0) return;

    const avgRed = this.redValues.reduce((a, b) => a + b, 0) / this.redValues.length;
    const avgTexture = this.textureValues.reduce((a, b) => a + b, 0) / this.textureValues.length;
    const redVariance = this.calculateVariance(this.redValues);

    // Determinar tono de piel basado en valores rojos
    if (avgRed < 30) {
      this.state.fingerCharacteristics.skinTone = 'dark';
    } else if (avgRed < 80) {
      this.state.fingerCharacteristics.skinTone = 'medium';
    } else {
      this.state.fingerCharacteristics.skinTone = 'light';
    }

    // Determinar grosor basado en textura
    if (avgTexture < 0.3) {
      this.state.fingerCharacteristics.thickness = 'thick';
    } else if (avgTexture < 0.6) {
      this.state.fingerCharacteristics.thickness = 'medium';
    } else {
      this.state.fingerCharacteristics.thickness = 'thin';
    }

    // Determinar flujo sanguíneo basado en varianza
    if (redVariance < 10) {
      this.state.fingerCharacteristics.bloodFlow = 'low';
    } else if (redVariance < 50) {
      this.state.fingerCharacteristics.bloodFlow = 'normal';
    } else {
      this.state.fingerCharacteristics.bloodFlow = 'high';
    }
  }

  private calculateAdaptiveThresholds(): void {
    const avgRed = this.redValues.reduce((a, b) => a + b, 0) / this.redValues.length;
    const minRed = Math.min(...this.redValues);
    const maxRed = Math.max(...this.redValues);
    const avgQuality = this.qualityValues.reduce((a, b) => a + b, 0) / this.qualityValues.length;

    // Umbrales adaptativos basados en características del dedo
    const { skinTone, thickness, bloodFlow } = this.state.fingerCharacteristics;

    // Umbral mínimo rojo adaptativo
    let redMinMultiplier = 0.3;
    if (skinTone === 'dark') redMinMultiplier = 0.1;
    else if (skinTone === 'light') redMinMultiplier = 0.4;

    if (thickness === 'thick') redMinMultiplier *= 0.7;
    if (bloodFlow === 'low') redMinMultiplier *= 0.5;

    this.state.adaptiveThresholds.redMin = Math.max(1, minRed * redMinMultiplier);
    this.state.adaptiveThresholds.redMax = Math.min(240, maxRed * 1.2);

    // Umbral de calidad adaptativo
    let qualityMinMultiplier = 0.4;
    if (skinTone === 'dark' || thickness === 'thick') qualityMinMultiplier = 0.2;
    if (bloodFlow === 'low') qualityMinMultiplier = 0.3;

    this.state.adaptiveThresholds.qualityMin = Math.max(3, avgQuality * qualityMinMultiplier);

    // Umbral de amplitud adaptativo
    const redRange = maxRed - minRed;
    this.state.adaptiveThresholds.amplitudeMin = Math.max(0.02, (redRange / avgRed) * 0.1);

    console.log("IntelligentCalibrator: Umbrales adaptativos calculados:", this.state.adaptiveThresholds);
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  getCalibrationState(): CalibrationState {
    return { ...this.state };
  }

  getAdaptiveThresholds() {
    return { ...this.state.adaptiveThresholds };
  }

  isCalibrating(): boolean {
    return this.state.isCalibrating;
  }

  forceComplete(): void {
    if (this.state.isCalibrating && this.calibrationData.length >= this.MIN_SAMPLES) {
      this.completeCalibration();
    }
  }

  reset(): void {
    this.state.isCalibrating = false;
    this.state.progress = 0;
    this.calibrationData = [];
    this.redValues = [];
    this.qualityValues = [];
    this.textureValues = [];
  }
}