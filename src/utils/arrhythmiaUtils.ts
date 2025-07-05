// Tipos compartidos
type ArrhythmiaStatus = {
  status: 'DETECTED' | 'NONE' | 'CALIBRATING';
  count: number;
};

// Parsear string de estado (formato: "STATUS|COUNT")
export const parseArrhythmiaStatus = (statusString: string): ArrhythmiaStatus => {
  const [status, countStr] = statusString.split('|');
  const count = parseInt(countStr) || 0;
  
  if (status.includes('DETECTED')) return { status: 'DETECTED', count };
  if (status.includes('CALIBRATING')) return { status: 'CALIBRATING', count };
  return { status: 'NONE', count };
};

// Generar texto descriptivo
export const getArrhythmiaText = (status: ArrhythmiaStatus): string => {
  switch(status.status) {
    case 'DETECTED': 
      return status.count > 1 ? `Arritmias: ${status.count}` : '¡Arritmia detectada!';
    case 'CALIBRATING': 
      return 'Calibrando...';
    default: 
      return 'Normal';
  }
};

// Generar color según estado
export const getArrhythmiaColor = (status: ArrhythmiaStatus): string => {
  switch(status.status) {
    case 'DETECTED': return '#ef4444';
    case 'CALIBRATING': return '#3b82f6';
    default: return '#10b981';
  }
};
