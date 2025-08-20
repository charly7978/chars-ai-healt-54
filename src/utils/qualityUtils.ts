
// Versión mejorada con rangos más realistas para señales PPG humanas
export const getQualityColor = (quality: number, isFingerDetected = true): string => {
  if (!isFingerDetected) return '#666666';
  
  // Rangos más realistas basados en señales PPG reales
  if (quality >= 85) return '#00ff00';      // Excelente (85-100%)
  if (quality >= 70) return '#80ff00';      // Muy buena (70-84%)
  if (quality >= 55) return '#ccff00';      // Buena (55-69%)
  if (quality >= 40) return '#ffff00';      // Aceptable (40-54%)
  if (quality >= 25) return '#ffcc00';      // Regular (25-39%)
  if (quality >= 15) return '#ff8800';      // Pobre (15-24%)
  return '#ff0000';                         // Muy pobre (0-14%)
};

export const getQualityText = (quality: number, isFingerDetected = true, context = 'default'): string => {
  if (!isFingerDetected) return context === 'meter' ? 'Sin detección' : 'Sin señal';
  
  // Textos más precisos para rangos PPG reales
  if (quality >= 85) return context === 'meter' ? 'Señal excelente' : 'Excelente';
  if (quality >= 70) return context === 'meter' ? 'Señal muy buena' : 'Muy buena';
  if (quality >= 55) return context === 'meter' ? 'Señal buena' : 'Buena';
  if (quality >= 40) return context === 'meter' ? 'Señal aceptable' : 'Aceptable';
  if (quality >= 25) return context === 'meter' ? 'Señal regular' : 'Regular';
  if (quality >= 15) return context === 'meter' ? 'Señal pobre' : 'Pobre';
  return context === 'meter' ? 'Señal muy débil' : 'Muy débil';
};
