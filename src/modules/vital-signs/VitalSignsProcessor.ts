import { SpO2Processor } from './spo2-processor';
import { BloodPressureProcessor } from './blood-pressure-processor';
import { ArrhythmiaProcessor } from './arrhythmia-processor';
import { GlucoseProcessor } from './glucose-processor';
import { LipidProcessor } from './lipid-processor';

export interface VitalSignsResult {
  spo2: number; // Tenga en cuenta: La precisión de SpO2 puede ser limitada sin un sensor IR dedicado.
  pressure: string; // Estimación basada en PPG. Requiere calibración externa para mayor precisión.
  arrhythmiaStatus: string;
  lastArrhythmiaData?: {
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  } | null;
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
      lipids: number;
      hemoglobin: number;
    };
  };
}

interface PPGSignal {
  red: number[];
  ir: number[];
  green: number[];
  timestamp: number;
}

export interface BiometricReading {
  spo2: number;       // % Saturación (95-100% normal)
  hr: number;         // BPM (60-100 normal)
  hrv: number;        // Variabilidad (ms)
  sbp: number;        // Sistólica (mmHg)
  dbp: number;        // Diastólica (mmHg)
  confidence: number; // 0-1
}

export class AdvancedVitalSignsProcessor {
  private FS = 60; // Frecuencia de muestreo (Hz)
  private WINDOW_SIZE = 256; // Muestras por ventana
  private sampleRate = 1000 / this.FS;
  
  // Buffers circulares para procesamiento continuo
  private redBuffer: number[] = [];
  private irBuffer: number[] = [];
  private greenBuffer: number[] = [];
  
  // Instancia del procesador de presión arterial
  private bloodPressureProcessor: BloodPressureProcessor;
  
  constructor() {
    this.bloodPressureProcessor = new BloodPressureProcessor();
  }
  
  // Método principal unificado
  processSignal(signal: PPGSignal): BiometricReading | null {
    // 1. Validación y preprocesamiento
    if (!signal || signal.red.length === 0) return null;
    
    // 2. Actualizar buffers con solapamiento del 50%
    this.updateBuffers(signal);
    
    // 3. Procesar solo cuando tengamos ventana completa
    if (this.redBuffer.length >= this.WINDOW_SIZE) {
      const windowRed = this.redBuffer.slice(0, this.WINDOW_SIZE);
      const windowIR = this.irBuffer.slice(0, this.WINDOW_SIZE);
      const windowGreen = this.greenBuffer.slice(0, this.WINDOW_SIZE);
      
      // 4. Cálculos biométricos paralelizados
      const [hr, hrv] = this.calculateCardiacMetrics(windowRed);
      const spo2 = this.calculateSpO2(windowRed, windowIR);
      const {sbp, dbp} = this.calculateBloodPressure(windowRed, windowGreen);
      
      // 5. Validación médica de resultados
      if (!this.validateResults(hr, spo2, sbp, dbp)) {
        return null;
      }
      
      // 6. Calcular confianza de medición
      const confidence = this.calculateConfidence(windowRed, windowIR);
      
      return { hr, hrv, spo2, sbp, dbp, confidence };
    }
    
    return null;
  }
  
  private updateBuffers(signal: PPGSignal): void {
    // Implementación de buffer circular con solapamiento
    this.redBuffer = [...this.redBuffer, ...signal.red];
    this.irBuffer = [...this.irBuffer, ...signal.ir];
    this.greenBuffer = [...this.greenBuffer, ...signal.green];
    
    // Mantener solo el 150% del tamaño de ventana
    const maxBuffer = Math.floor(this.WINDOW_SIZE * 1.5);
    if (this.redBuffer.length > maxBuffer) {
      const removeCount = this.redBuffer.length - this.WINDOW_SIZE/2;
      this.redBuffer = this.redBuffer.slice(removeCount);
      this.irBuffer = this.irBuffer.slice(removeCount);
      this.greenBuffer = this.greenBuffer.slice(removeCount);
    }
  }
  
  private calculateCardiacMetrics(signal: number[]): [number, number] {
    const peaks = this.findPeaks(signal);
    
    // Cálculo de frecuencia cardíaca
    const hr = peaks.length >= 2 
      ? 60 / ((peaks[1] - peaks[0]) / this.FS)
      : 0;
    
    // Cálculo de HRV (RMSSD)
    let hrv = 0;
    if (peaks.length >= 3) {
      const intervals = [];
      for (let i = 1; i < peaks.length; i++) {
        intervals.push((peaks[i] - peaks[i-1]) / this.FS * 1000);
      }
      
      let sumSquaredDiffs = 0;
      for (let i = 1; i < intervals.length; i++) {
        sumSquaredDiffs += Math.pow(intervals[i] - intervals[i-1], 2);
      }
      hrv = Math.sqrt(sumSquaredDiffs / (intervals.length - 1));
    }
    
    return [Math.round(hr), hrv];
  }

  private calculateSpO2(red: number[], ir: number[]): number {
    const redACDC = this.calculateACDC(red);
    const irACDC = this.calculateACDC(ir);
    
    const R = (redACDC.ac/redACDC.dc) / (irACDC.ac/irACDC.dc);
    return Math.max(70, Math.min(100, 110 - 25 * R));
  }

  private calculateBloodPressure(red: number[], green: number[]): { sbp: number, dbp: number } {
    // Delegar el cálculo al BloodPressureProcessor, usando el canal rojo como entrada
    const { systolic, diastolic } = this.bloodPressureProcessor.calculateBloodPressure(red);
    return { sbp: systolic, dbp: diastolic };
  }

  private validateResults(hr: number, spo2: number, sbp: number, dbp: number): boolean {
    return (
      hr >= 40 && hr <= 180 &&
      spo2 >= 70 && spo2 <= 100 &&
      sbp >= 80 && sbp <= 180 &&
      dbp >= 50 && dbp <= 120 &&
      sbp > dbp && (sbp - dbp) >= 20 &&
      (hr > 60 || spo2 > 90)
    );
  }

  private calculateConfidence(red: number[], ir: number[]): number {
    const redACDC = this.calculateACDC(red);
    const irACDC = this.calculateACDC(ir);
    
    const perfusionIndex = (redACDC.ac / redACDC.dc) * 100;
    const snr = 20 * Math.log10(redACDC.ac / (redACDC.dc * 0.1));
    
    return (Math.min(1, perfusionIndex/5) * 0.6 + Math.min(1, Math.max(0, (snr+10)/30)) * 0.4);
  }

  private findPeaks(signal: number[]): number[] {
    const threshold = 0.5 * Math.max(...signal);
    const peaks: number[] = [];
    
    for (let i = 2; i < signal.length - 2; i++) {
      if (signal[i] > threshold &&
          signal[i] > signal[i-1] &&
          signal[i] > signal[i+1] &&
          signal[i] > signal[i-2] &&
          signal[i] > signal[i+2]) {
        peaks.push(i);
      }
    }
    
    return peaks;
  }

  private calculateACDC(signal: number[]): { ac: number, dc: number } {
    const dc = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const ac = Math.max(...signal) - Math.min(...signal);
    return { ac, dc };
  }

  /**
   * Restablece el estado del procesador de signos vitales y sus sub-procesadores.
   */
  public reset(): void {
    this.redBuffer = [];
    this.irBuffer = [];
    this.greenBuffer = [];
    this.bloodPressureProcessor.reset();
    // Si se instancian otros procesadores, sus métodos de reset también deberían llamarse aquí.
  }

  /**
   * Establece los valores de calibración para la presión arterial.
   * Requiere valores de referencia de un dispositivo externo y datos PPG de muestra.
   * @param referenceSystolic Valor sistólico del dispositivo de referencia.
   * @param referenceDiastolic Valor diastólico del dispositivo de referencia.
   */
  public setBloodPressureCalibration(referenceSystolic: number, referenceDiastolic: number): void {
    if (this.redBuffer.length < this.WINDOW_SIZE) {
      console.warn("AdvancedVitalSignsProcessor: No hay suficientes datos PPG en el buffer para la calibración de presión arterial.");
      return;
    }
    this.bloodPressureProcessor.setCalibration(referenceSystolic, referenceDiastolic, this.redBuffer.slice());
  }
}
