/**
 * Etiquetas de ritmo que NO activan alerta visual / toast (monitor + Index).
 * Fuente única para evitar desincronización PPGSignalMeter ↔ página.
 */
export const NON_ALERT_RHYTHM_LABELS = new Set([
  'SIN ARRITMIAS',
  'SINUS_STABLE',
  'SINUS_VARIABLE',
  'CALIBRANDO...',
  'CALIBRANDO',
  'UNDETERMINED_LOW_QUALITY',
  'INSUFFICIENT_DATA',
  /** Patrones de frecuencia: informativos en panel BPM; no “alarma” de trazo rojo por defecto */
  'BRADYCARDIA_PATTERN',
  'TACHYCARDIA_PATTERN',
]);

export function isRhythmAlertLabel(label: string): boolean {
  return !NON_ALERT_RHYTHM_LABELS.has(label.trim());
}
