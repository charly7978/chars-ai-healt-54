type ArrhythmiaStatus = {
  status: 'DETECTED' | 'NONE' | 'CALIBRATING' | 'RHYTHM';
  count: number;
  label?: string;
  severity: 'normal' | 'warning' | 'danger';
};

const normalizeLabel = (label: string): string => label.trim().toLowerCase();

const NORMAL_LABELS = new Set([
  'sin arrtimias',
  'sin arritmias',
  'sinus_stable',
  'sinus_variable',
  'sinus_regular',
  'sinus_variable',
  'sinus_regular'.toLowerCase(),
  'sin arritmias'.toLowerCase(),
]);
const CALIBRATION_LABELS = new Set(['calibrando...', 'calibrating']);
const DANGER_LABELS = new Set([
  'arritmia detectada',
  'possible_af',
  'possible_ectopy',
  'bigeminy_trigeminy_pattern',
  'irregular_rhythm',
  'bradycardia_pattern',
  'tachycardia_pattern',
  'af_suspected',
  'frequent_ectopy_suspected',
  'bigeminy_suspected',
  'trigeminy_suspected',
  'brady_irregular',
  'tachy_irregular',
]);

export const parseArrhythmiaStatus = (statusString: string): ArrhythmiaStatus => {
  const [rawStatus = 'SIN ARRITMIAS', countStr = '0'] = (statusString || 'SIN ARRITMIAS|0').split('|');
  const status = normalizeLabel(rawStatus);
  const count = parseInt(countStr, 10) || 0;

  if (CALIBRATION_LABELS.has(status)) {
    return { status: 'CALIBRATING', count, label: rawStatus.trim(), severity: 'warning' };
  }

  if (NORMAL_LABELS.has(status)) {
    return { status: 'NONE', count, label: rawStatus.trim(), severity: 'normal' };
  }

  if (status.includes('detected') || status === 'arritmia detectada') {
    return { status: 'DETECTED', count, label: rawStatus.trim(), severity: 'danger' };
  }

  const severity: ArrhythmiaStatus['severity'] = DANGER_LABELS.has(status)
    ? 'danger'
    : status === 'undetermined_low_quality' || status === 'noise_or_unreliable'
      ? 'warning'
      : 'warning';

  return { status: 'RHYTHM', count, label: rawStatus.trim(), severity };
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
