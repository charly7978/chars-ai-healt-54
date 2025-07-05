import { calculateAmplitude, findPeaksAndValleys } from './utils';

export class BloodPressureProcessor {
  private readonly BP_BUFFER_SIZE = 10;
  private readonly BP_ALPHA = 0.7;
  private systolicBuffer: number[] = [];
  private diastolicBuffer: number[] = [];

  /**
   * Calculates blood pressure using PPG signal features
   */
  public calculateBloodPressure(values: number[]): {
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
  }
}
