
// Rangos optimizados para señales PPG humanas reales
export const getQualityColor = (quality: number, isFingerDetected = true): string => {
  if (!isFingerDetected) return '#666666';
  
  // Rangos ajustados para ser más alcanzables con señales PPG reales
  if (quality >= 80) return '#00ff00';      // Excelente (80-100%)
  if (quality >= 65) return '#80ff00';      // Muy buena (65-79%)
  if (quality >= 50) return '#ccff00';      // Buena (50-64%)
  if (quality >= 35) return '#ffff00';      // Aceptable (35-49%)
  if (quality >= 25) return '#ffcc00';      // Regular (25-34%)
  if (quality >= 15) return '#ff8800';      // Pobre (15-24%)
  return '#ff0000';                         // Muy pobre (0-14%)
};

export const getQualityText = (quality: number, isFingerDetected = true, context = 'default'): string => {
  if (!isFingerDetected) return context === 'meter' ? 'Sin detección' : 'Sin señal';
  
  // Textos optimizados para rangos PPG alcanzables
  if (quality >= 80) return context === 'meter' ? 'Señal excelente' : 'Excelente';
  if (quality >= 65) return context === 'meter' ? 'Señal muy buena' : 'Muy buena';
  if (quality >= 50) return context === 'meter' ? 'Señal buena' : 'Buena';
  if (quality >= 35) return context === 'meter' ? 'Señal aceptable' : 'Aceptable';
  if (quality >= 25) return context === 'meter' ? 'Señal regular' : 'Regular';
  if (quality >= 15) return context === 'meter' ? 'Señal pobre' : 'Pobre';
  return context === 'meter' ? 'Señal muy débil' : 'Muy débil';
};
