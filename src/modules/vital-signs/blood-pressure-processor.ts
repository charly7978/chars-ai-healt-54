import { calculateAmplitude, findPeaksAndValleys } from './utils';

/**
 * BloodPressureProcessor
 * 
 * Este módulo calcula la presión arterial (sistólica y diastólica) a partir de las características de la señal PPG.
 * Es fundamental entender que esta es una ESTIMACIÓN basada en correlaciones empíricas entre la morfología
 * de la onda de pulso y la presión arterial. NO es una medición directa como la obtenida con un manguito.
 * Para obtener resultados clínicamente precisos y "reales", se requiere una calibración regular con un
 * tensiómetro validado. Sin esta calibración, los valores deben considerarse indicativos y no diagnósticos.
 */
export class BloodPressureProcessor {
  private readonly BP_BUFFER_SIZE = 10;
  private readonly BP_ALPHA = 0.7;
  private systolicBuffer: number[] = [];
  private diastolicBuffer: number[] = [];
  private systolicCalibrationOffset: number = 0;
  private diastolicCalibrationOffset: number = 0;

  /**
   * Calculates blood pressure using PPG signal features
   * @param values Array of PPG signal values
   * @param applyCalibration Optional. If false, calibration offsets are not applied. Used internally for calibration process.
   */
  public calculateBloodPressure(values: number[], applyCalibration: boolean = true): {
    systolic: number;
    diastolic: number;
  } {
    if (values.length < 30) {
      return { systolic: 0, diastolic: 0 };
    }

    const { peakIndices, valleyIndices } = findPeaksAndValleys(values);
    if (peakIndices.length < 2) {
      return { systolic: 0, diastolic: 0 };
    }

    const fps = 30;
    const msPerSample = 1000 / fps;

    // Calculate real PTT values with improved accuracy
    const pttValues: number[] = [];
    for (let i = 1; i < peakIndices.length; i++) {
      const dt = (peakIndices[i] - peakIndices[i - 1]) * msPerSample;
      if (dt > 200 && dt < 1500) { // Physiologically valid range
        pttValues.push(dt);
      }
    }
    
    // Enhanced weighted PTT calculation
    let pttWeightSum = 0;
    let pttWeightedSum = 0;
    
    pttValues.forEach((val, idx) => {
      const weight = Math.pow((idx + 1) / pttValues.length, 1.5); // Exponential weighting
      pttWeightedSum += val * weight;
      pttWeightSum += weight;
    });

    const calculatedPTT = pttWeightSum > 0 ? pttWeightedSum / pttWeightSum : 600;
    const normalizedPTT = Math.max(300, Math.min(1200, calculatedPTT));
    
    // Enhanced amplitude calculation from signal
    const amplitude = calculateAmplitude(values, peakIndices, valleyIndices);
    const normalizedAmplitude = Math.min(100, Math.max(0, amplitude * 6.5));

    // Optimización adicional: ajustar los multiplicadores para mayor precisión
    const pttFactor = (600 - normalizedPTT) * 0.11; // Incrementado de 0.10 a 0.11
    const ampFactor = normalizedAmplitude * 0.38;   // Incrementado de 0.37 a 0.38
    
    let instantSystolic = 120 + pttFactor + ampFactor;
    let instantDiastolic = 80 + (pttFactor * 0.68) + (ampFactor * 0.30); // Ajustando de (0.65 y 0.28)

    // Enhanced physiological range enforcement
    instantSystolic = Math.max(90, Math.min(180, instantSystolic));
    instantDiastolic = Math.max(60, Math.min(110, instantDiastolic));
    
    // Maintain realistic pressure differential with improved bounds
    const differential = instantSystolic - instantDiastolic;
    if (differential < 25) {
      instantDiastolic = instantSystolic - 25;
    } else if (differential > 75) {
      instantDiastolic = instantSystolic - 75;
    }

    // Aplicar offsets de calibración si la bandera es verdadera
    if (applyCalibration) {
      instantSystolic += this.systolicCalibrationOffset;
      instantDiastolic += this.diastolicCalibrationOffset;
    }

    // Update pressure buffers with new values
    this.systolicBuffer.push(instantSystolic);
    this.diastolicBuffer.push(instantDiastolic);
    
    if (this.systolicBuffer.length > this.BP_BUFFER_SIZE) {
      this.systolicBuffer.shift();
      this.diastolicBuffer.shift();
    }

    // Calculate final smoothed values with enhanced exponential moving average
    let finalSystolic = 0;
    let finalDiastolic = 0;
    let smoothingWeightSum = 0;

    for (let i = 0; i < this.systolicBuffer.length; i++) {
      const weight = Math.pow(this.BP_ALPHA, this.systolicBuffer.length - 1 - i);
      finalSystolic += this.systolicBuffer[i] * weight;
      finalDiastolic += this.diastolicBuffer[i] * weight;
      smoothingWeightSum += weight;
    }

    finalSystolic = smoothingWeightSum > 0 ? finalSystolic / smoothingWeightSum : instantSystolic;
    finalDiastolic = smoothingWeightSum > 0 ? finalDiastolic / smoothingWeightSum : instantDiastolic;

    return {
      systolic: Math.round(finalSystolic),
      diastolic: Math.round(finalDiastolic)
    };
  }

  /**
   * Reset the blood pressure processor state
   */
  public reset(): void {
    this.systolicBuffer = [];
    this.diastolicBuffer = [];
    this.systolicCalibrationOffset = 0;
    this.diastolicCalibrationOffset = 0;
  }

  /**
   * Sets calibration offsets based on a reference measurement and sample PPG values.
   * This method should be called when the user provides a reliable external BP reading.
   * @param referenceSystolic The systolic blood pressure from a reference device.
   * @param referenceDiastolic The diastolic blood pressure from a reference device.
   * @param ppgSampleValues A recent array of stable PPG values to calculate an uncalibrated estimate.
   */
  public setCalibration(referenceSystolic: number, referenceDiastolic: number, ppgSampleValues: number[]): void {
    // Calculate an uncalibrated estimate using the provided sample values
    const uncalibratedEstimate = this.calculateBloodPressure(ppgSampleValues, false); // Do not apply existing calibration

    // Calculate the offsets
    this.systolicCalibrationOffset = referenceSystolic - uncalibratedEstimate.systolic;
    this.diastolicCalibrationOffset = referenceDiastolic - uncalibratedEstimate.diastolic;

    console.log(`BloodPressureProcessor: Calibración establecida. Offset sistólico: ${this.systolicCalibrationOffset.toFixed(2)}, Offset diastólico: ${this.diastolicCalibrationOffset.toFixed(2)}`);
  }
}
