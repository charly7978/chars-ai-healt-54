
// SISTEMA DE COLORES OPTIMIZADO - 100% REAL, SIN SIMULACIONES

export const getQualityColor = (quality: number, isFingerDetected = true): string => {
  if (!isFingerDetected) return '#64748b'; // slate-500
  if (quality >= 90) return '#10b981'; // emerald-500 (verde excelente)
  if (quality >= 75) return '#f59e0b'; // amber-500 (amarillo bueno)
  if (quality >= 60) return '#f97316'; // orange-500 (naranja aceptable)
  if (quality >= 45) return '#ef4444'; // red-500 (rojo malo)
  if (quality >= 30) return '#dc2626'; // red-600 (rojo muy malo)
  return '#991b1b'; // red-800 (rojo crítico)
};

export const getQualityText = (quality: number, isFingerDetected = true, context = 'default'): string => {
  if (!isFingerDetected) return context === 'meter' ? 'Sin detección' : 'Sin señal';
  if (quality >= 90) return context === 'meter' ? 'Señal excelente' : 'Excelente';
  if (quality >= 75) return context === 'meter' ? 'Señal buena' : 'Buena';
  if (quality >= 60) return context === 'meter' ? 'Señal aceptable' : 'Aceptable';
  if (quality >= 45) return context === 'meter' ? 'Señal regular' : 'Regular';
  if (quality >= 30) return context === 'meter' ? 'Señal débil' : 'Débil';
  return context === 'meter' ? 'Señal muy débil' : 'Crítica';
};

// COLORES PARA MONITOR CARDÍACO
export const getCardiacMonitorBackground = (): string => {
  return 'bg-gray-900/95';
};

export const getCardiacMonitorGridColor = (): string => {
  return '#374151'; // gray-700
};

export const getCardiacWaveColor = (quality: number): string => {
  if (quality >= 75) return '#10b981'; // emerald-500
  if (quality >= 50) return '#f59e0b'; // amber-500
  if (quality >= 25) return '#f97316'; // orange-500
  return '#ef4444'; // red-500
};

// COLORES PARA RESULTADOS FINALES
export const getResultTextColor = (isFinal = false): string => {
  return isFinal ? '#fbbf24' : '#e5e7eb'; // amber-400 para finales, gray-200 para normales
};

export const getResultBorderColor = (isFinal = false): string => {
  return isFinal ? '#fbbf24' : '#374151'; // amber-400 para finales, gray-700 para normales
};
