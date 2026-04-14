/**
 * Tipos legacy para compatibilidad.
 * Estos tipos se mantienen para referencia y compatibilidad con código existente.
 * El runtime principal usa los procesadores *Elite.
 */

export interface SpO2Result {
  value: number;
  confidence: number;
  quality: number;
  calibrationState: 'UNCALIBRATED' | 'SESSION_CALIBRATED' | 'DEVICE_CALIBRATED';
  enabledState: 'ENABLED_HIGH_CONFIDENCE' | 'ENABLED_MEDIUM_CONFIDENCE' | 'ENABLED_LOW_CONFIDENCE' | 'WITHHELD_LOW_QUALITY';
  rawR: number;
  medianR: number;
  piRed: number;
  piGreen: number;
  validBeatRatios: number;
}

export interface BPEstimate {
  systolic: number;
  diastolic: number;
  map: number;
  pulsePressure: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  cyclesUsed: number;
  featureQuality: number;
  trendFirst?: boolean;
  trendLabel?: 'UP' | 'DOWN' | 'STABLE';
  modelAgreement?: number;
}
