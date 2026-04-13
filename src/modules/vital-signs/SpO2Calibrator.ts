/**
 * Curva cuadrática R → SpO2 + sesgo óptico por dispositivo/sesión.
 * SpO2Processor delega el mapeo final aquí para que la calibración sea trazable.
 */

export interface SpO2CalibrationCurve {
  A: number;
  B: number;
  C: number;
  deviceId: string;
  timestamp: number;
}

export class SpO2Calibrator {
  private curve: SpO2CalibrationCurve;
  /** Sesgo aditivo sobre R antes de la curva (óptica/torch/browser) */
  private opticalBiasR = 0;
  private sessionOffsetA = 0;

  constructor(initial?: Partial<SpO2CalibrationCurve>) {
    this.curve = {
      A: initial?.A ?? 104.0,
      B: initial?.B ?? 4.2,
      C: initial?.C ?? -28.5,
      deviceId: initial?.deviceId ?? 'default',
      timestamp: initial?.timestamp ?? Date.now(),
    };
  }

  getCurve(): SpO2CalibrationCurve {
    return { ...this.curve };
  }

  setDeviceCurve(A: number, B: number, C: number, deviceId: string): void {
    this.curve = { A, B, C, deviceId, timestamp: Date.now() };
    this.sessionOffsetA = 0;
  }

  setOpticalBiasR(bias: number): void {
    this.opticalBiasR = bias;
  }

  getOpticalBiasR(): number {
    return this.opticalBiasR;
  }

  /** Ajuste de sesión con referencia conocida (desplaza intercepto) */
  applySessionOffsetFromReference(knownSpO2: number, medianR: number): void {
    const R = medianR + this.opticalBiasR;
    const current = this.evaluateRaw(R);
    this.sessionOffsetA += knownSpO2 - current;
  }

  clearSessionOffset(): void {
    this.sessionOffsetA = 0;
  }

  /** R ya median-filtrado por frame */
  estimateSpO2(medianR: number): number {
    const R = medianR + this.opticalBiasR;
    return this.evaluateRaw(R) + this.sessionOffsetA;
  }

  private evaluateRaw(R: number): number {
    const c = this.curve;
    return c.A + c.B * R + c.C * R * R;
  }
}
