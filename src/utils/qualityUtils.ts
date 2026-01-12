
// Versión CORREGIDA con colores dorados para resultados
export const getQualityColor = (quality: number, isFingerDetected = true): string => {
  if (!isFingerDetected) return '#64748b'; // slate-500
  if (quality >= 90) return '#fbbf24'; // amber-400 (dorado brilloso)
  if (quality >= 75) return '#f59e0b'; // amber-500
  if (quality >= 60) return '#d97706'; // amber-600
  if (quality >= 45) return '#b45309'; // amber-700
  if (quality >= 30) return '#92400e'; // amber-800
  if (quality >= 15) return '#78350f'; // amber-900
  return '#ef4444'; // red-500
};

export const getQualityText = (quality: number, isFingerDetected = true, context = 'default'): string => {
  if (!isFingerDetected) return context === 'meter' ? 'Sin detección' : 'Sin señal';
  if (quality > 75) return context === 'meter' ? 'Señal óptima' : 'Excelente';
  if (quality > 50) return context === 'meter' ? 'Señal aceptable' : 'Buena';
  return context === 'meter' ? 'Señal débil' : 'Regular';
};

// COLORES PARA FONDO DE MONITOR CARDÍACO - AZUL OSCURO
export const getCardiacMonitorBackground = (): string => {
  return 'bg-blue-950/90'; // Azul muy oscuro pero que no estropee visualización
};

export const getCardiacMonitorGridColor = (): string => {
  return '#1e40af'; // blue-700 para líneas de grid
};

export const getCardiacWaveColor = (quality: number): string => {
  if (quality >= 75) return '#10b981'; // emerald-500 (verde brillante)
  if (quality >= 50) return '#f59e0b'; // amber-500 (amarillo)
  if (quality >= 25) return '#f97316'; // orange-500 (naranja)
  return '#ef4444'; // red-500 (rojo)
};

// COLORES DORADOS PARA RESULTADOS FINALES
export const getResultTextColor = (isFinal = false): string => {
  return isFinal ? '#fbbf24' : '#e5e7eb'; // amber-400 para finales, gray-200 para normales
};
()
export const getResultBorderColor = (isFinal = false): string => {
  return isFinal ? '#fbbf24' : '#374151'; // amber-400 para finales, gray-700 para normales
};
