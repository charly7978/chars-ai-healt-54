import { calculateAC, calculateDC } from './utils';

/**
 * SpO2Processor
 * 
 * Este módulo calcula la saturación de oxígeno (SpO2) a partir de los valores PPG.
 * Es IMPORTANTE tener en cuenta que la precisión de esta medición es inherentemente limitada
 * cuando se utiliza únicamente la cámara RGB de un teléfono móvil (donde el "canal IR"
 * es en realidad el canal azul). Para una medición de SpO2 clínicamente precisa y "real",
 * se requiere un hardware con longitudes de onda roja e infrarroja específicas y dedicadas.
 * Los resultados de este procesador deben considerarse ESTIMACIONES Y NO MEDICIONES CLÍNICAS.
 */
export class SpO2Processor {
  private readonly SPO2_CALIBRATION_FACTOR = 1.02;
  // Ajuste: elevar el umbral de perfusión para descartar mediciones débiles
  private readonly PERFUSION_INDEX_THRESHOLD = 0.06; // antes: 0.05
  private readonly SPO2_BUFFER_SIZE = 10;
  private spo2Buffer: number[] = [];

  /**
   * Calculates the oxygen saturation (SpO2) from PPG values
   */
  public calculateSpO2(values: number[]): number {
    if (values.length < 30) {
      if (this.spo2Buffer.length > 0) {
        const lastValid = this.spo2Buffer[this.spo2Buffer.length - 1];
        return Math.max(0, lastValid - 1);
      }
      return 0;
    }

    const dc = calculateDC(values);
    if (dc === 0) {
      if (this.spo2Buffer.length > 0) {
        const lastValid = this.spo2Buffer[this.spo2Buffer.length - 1];
        return Math.max(0, lastValid - 1);
      }
      return 0;
    }

    const ac = calculateAC(values);
    
    const perfusionIndex = ac / dc;
    
    if (perfusionIndex < this.PERFUSION_INDEX_THRESHOLD) {
      if (this.spo2Buffer.length > 0) {
        const lastValid = this.spo2Buffer[this.spo2Buffer.length - 1];
        return Math.max(0, lastValid - 2);
      }
      return 0;
    }

    const R = (ac / dc) / this.SPO2_CALIBRATION_FACTOR;
    
    let spO2 = Math.round(98 - (15 * R));
    
    if (perfusionIndex > 0.15) {
      spO2 = Math.min(98, spO2 + 1);
    } else if (perfusionIndex < 0.08) {
      spO2 = Math.max(0, spO2 - 1);
    }

    spO2 = Math.min(98, spO2);

    this.spo2Buffer.push(spO2);
    if (this.spo2Buffer.length > this.SPO2_BUFFER_SIZE) {
      this.spo2Buffer.shift();
    }

    if (this.spo2Buffer.length > 0) {
      const sum = this.spo2Buffer.reduce((a, b) => a + b, 0);
      spO2 = Math.round(sum / this.spo2Buffer.length);
    }

    return spO2;
  }

  /**
   * Reset the SpO2 processor state
   */
  public reset(): void {
    this.spo2Buffer = [];
  }
}
