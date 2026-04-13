type ArrhythmiaStatus = {
  status: 'DETECTED' | 'NONE' | 'CALIBRATING' | 'RHYTHM';
  count: number;
  label?: string;
  severity: 'normal' | 'warning' | 'danger';
};

const NORMAL_LABELS = new Set(['SIN ARRITMIAS', 'SINUS_STABLE', 'SINUS_VARIABLE']);
const CALIBRATION_LABELS = new Set(['CALIBRANDO...', 'CALIBRATING']);
const DANGER_LABELS = new Set([
  'ARRITMIA DETECTADA',
  'POSSIBLE_AF',
  'POSSIBLE_ECTOPY',
  'BIGEMINY_TRIGEMINY_PATTERN',
  'IRREGULAR_RHYTHM',
  'BRADYCARDIA_PATTERN',
  'TACHYCARDIA_PATTERN'
]);

export const parseArrhythmiaStatus = (statusString: string): ArrhythmiaStatus => {
  const [rawStatus = 'SIN ARRITMIAS', countStr = '0'] = (statusString || 'SIN ARRITMIAS|0').split('|');
  const status = rawStatus.trim();
  const count = parseInt(countStr, 10) || 0;

  if (CALIBRATION_LABELS.has(status)) {
    return { status: 'CALIBRATING', count, label: status, severity: 'warning' };
  }

  if (NORMAL_LABELS.has(status)) {
    return { status: 'NONE', count, label: status, severity: 'normal' };
  }

  if (status.includes('DETECTED') || status === 'ARRITMIA DETECTADA') {
    return { status: 'DETECTED', count, label: status, severity: 'danger' };
  }

  const severity: ArrhythmiaStatus['severity'] = DANGER_LABELS.has(status)
    ? 'danger'
    : status === 'UNDETERMINED_LOW_QUALITY'
      ? 'warning'
      : 'warning';

  return { status: 'RHYTHM', count, label: status, severity };
};

export const getArrhythmiaText = (status: ArrhythmiaStatus): string => {
  switch (status.status) {
    case 'DETECTED':
      return status.count > 1 ? `Arritmias: ${status.count}` : '¡Arritmia detectada!';
    case 'CALIBRATING':
      return 'Calibrando...';
    case 'RHYTHM': {
      const label = (status.label || 'RITMO').split('_').join(' ');
      return status.count > 0 ? `${label} · ${status.count}` : label;
    }
    default:
      return 'Normal';
  }
};

export const getArrhythmiaColor = (status: ArrhythmiaStatus): string => {
  switch (status.severity) {
    case 'danger':
      return '#ef4444';
    case 'warning':
      return '#f59e0b';
    default:
      return '#10b981';
  }
};
