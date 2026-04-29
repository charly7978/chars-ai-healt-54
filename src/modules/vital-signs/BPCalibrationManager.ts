/**
 * Calibración sujeto-específica para PA morfológica (offsets mmHg).
 * Persistencia opcional vía caller (VitalSignsProcessor + localStorage).
 */

export interface BPCalibrationRecord {
  systolicOffset: number;
  diastolicOffset: number;
  timestamp: number;
  quality: number;
}

export class BPCalibrationManager {
  private record: BPCalibrationRecord | null = null;

  /**
   * API de calibración BP por sujeto (mmHg offsets). Reservada para Fase 2
   * (UI de calibración + persistencia). Sin record, getOffsets devuelve
   * (0,0) y `getRecord()===null` actúa como gate fail-closed: BP no se
   * publica hasta que haya una calibración real del sujeto.
   */
  setCalibration(systolicOffset: number, diastolicOffset: number, quality: number): void {
    this.record = {
      systolicOffset,
      diastolicOffset,
      timestamp: Date.now(),
      quality: Math.max(0, Math.min(100, quality)),
    };
  }

  getOffsets(): { systolic: number; diastolic: number } {
    if (!this.record || this.record.quality < 15) return { systolic: 0, diastolic: 0 };
    return { systolic: this.record.systolicOffset, diastolic: this.record.diastolicOffset };
  }

  getRecord(): BPCalibrationRecord | null {
    return this.record ? { ...this.record } : null;
  }

  reset(): void {
    this.record = null;
  }
}
