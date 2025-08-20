// Versión mejorada y unificada de getQualityColor
export const getQualityColor = (quality: number, isFingerDetected = true): string => {
  if (!isFingerDetected) return '#666666';
  if (quality >= 90) return '#00ff00';
  if (quality >= 75) return '#80ff00';
  if (quality >= 60) return '#ccff00';
  if (quality >= 45) return '#ffff00';
  if (quality >= 30) return '#ffcc00';
  if (quality >= 15) return '#ff6600';
  return '#ff0000';
};

export const getQualityText = (quality: number, isFingerDetected = true, context = 'default'): string => {
  if (!isFingerDetected) return context === 'meter' ? 'Sin detección' : 'Sin señal';
  if (quality > 75) return context === 'meter' ? 'Señal óptima' : 'Excelente';
  if (quality > 50) return context === 'meter' ? 'Señal aceptable' : 'Buena';
  return context === 'meter' ? 'Señal débil' : 'Regular';
};
