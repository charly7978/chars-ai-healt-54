
import { CalibrationValues } from './types';

export class CalibrationHandler {
  private calibrationSamples: number[] = [];
  private readonly CONFIG: { CALIBRATION_SAMPLES: number; MIN_RED_THRESHOLD: number; MAX_RED_THRESHOLD: number; };
  private calibrationValues: CalibrationValues;
  
  constructor(config: { CALIBRATION_SAMPLES: number; MIN_RED_THRESHOLD: number; MAX_RED_THRESHOLD: number; }) {
    this.CONFIG = config;
    this.calibrationValues = {
      baselineRed: 0,
      baselineVariance: 0,
      minRedThreshold: config.MIN_RED_THRESHOLD,
      maxRedThreshold: config.MAX_RED_THRESHOLD,
      isCalibrated: false
    };
  }
  
  handleCalibration(redValue: number): boolean {
    // Si el valor es muy bajo, ignoramos
    if (redValue < 10) return false;
    
    this.calibrationSamples.push(redValue);
    
    // Si tenemos suficientes muestras, completar calibración
    if (this.calibrationSamples.length >= this.CONFIG.CALIBRATION_SAMPLES) {
      // Ordenar muestras para análisis
      const sortedSamples = [...this.calibrationSamples].sort((a, b) => a - b);
      
      // Eliminar valores extremos (10% superior e inferior)
      const trimmedSamples = sortedSamples.slice(
        Math.floor(sortedSamples.length * 0.1),
        Math.ceil(sortedSamples.length * 0.9)
      );
      
      // Calcular estadísticas
      const sum = trimmedSamples.reduce((acc, val) => acc + val, 0);
      const mean = sum / trimmedSamples.length;
      
      const variance = trimmedSamples.reduce(
        (acc, val) => acc + Math.pow(val - mean, 2), 0
      ) / trimmedSamples.length;
      
      // Establecer umbrales calibrados
      this.calibrationValues.baselineRed = mean;
      this.calibrationValues.baselineVariance = variance;
      this.calibrationValues.minRedThreshold = Math.max(
        30, 
        mean - Math.sqrt(variance) * 2
      );
      this.calibrationValues.maxRedThreshold = Math.min(
        250,
        mean + Math.sqrt(variance) * 5
      );
      this.calibrationValues.isCalibrated = true;
      
      console.log("CalibrationHandler: Calibración completada:", this.calibrationValues);
      
      // Resetear muestras
      this.resetCalibration();
      return true;
    }
    
    return false;
  }
  
  getCalibrationValues(): CalibrationValues {
    return { ...this.calibrationValues };
  }
  
  resetCalibration(): void {
    this.calibrationSamples = [];
  }
  
  isCalibrationComplete(): boolean {
    return this.calibrationValues.isCalibrated;
  }
}
