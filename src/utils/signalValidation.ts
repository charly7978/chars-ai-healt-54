import { ProcessedSignal } from "@/types/signal";

/**
 * Valida si una señal PPG es fisiológicamente posible
 * @param signal Señal a validar
 * @param lastTimestamp Último timestamp de señal válida
 * @returns Objeto con validación y motivo de rechazo si aplica
 */
export const validatePPGSignal = (
  signal: ProcessedSignal,
  lastTimestamp: number
): { isValid: boolean; reason?: string } => {
  const now = Date.now();
  const timeSinceLastSignal = now - lastTimestamp;
  
  // 1. Validar calidad mínima
  if (signal.quality < 30) {
    return { isValid: false, reason: "Calidad de señal insuficiente" };
  }
  
  // 2. Validar rango fisiológico de valores PPG
  if (signal.rawValue <= 0 || signal.rawValue > 1.0) {
    return { isValid: false, reason: "Valor de señal fuera de rango fisiológico" };
  }
  
  // 3. Validar frecuencia de muestreo (entre 10ms y 200ms entre muestras)
  if (timeSinceLastSignal > 0 && (timeSinceLastSignal < 10 || timeSinceLastSignal > 200)) {
    return { 
      isValid: false, 
      reason: `Frecuencia de muestreo inusual: ${timeSinceLastSignal}ms` 
    };
  }
  
  // 4. Validar variabilidad de señal (no debe ser constante)
  if (signal.filteredValue === signal.rawValue && signal.rawValue !== 0) {
    return { isValid: false, reason: "Falta de variabilidad en la señal" };
  }
  
  // 5. Validar que el dedo esté detectado
  if (!signal.fingerDetected) {
    return { isValid: false, reason: "Dedo no detectado correctamente" };
  }
  
  return { isValid: true };
};

/**
 * Analiza características espectrales para detectar patrones no fisiológicos
 */
export const analyzeSpectralFeatures = (
  signalHistory: ProcessedSignal[]
): { isSuspicious: boolean; reason?: string } => {
  if (signalHistory.length < 10) {
    return { isSuspicious: false };
  }
  
  // Calcular variabilidad de la señal
  const values = signalHistory.map(s => s.filteredValue);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  // Señales demasiado estables son sospechosas
  if (stdDev < 0.001) {
    return { 
      isSuspicious: true, 
      reason: "Variabilidad de señal anormalmente baja" 
    };
  }
  
  // Detectar patrones repetitivos artificiales
  const autocorr = calculateAutocorrelation(values);
  if (autocorr > 0.9) {
    return {
      isSuspicious: true,
      reason: "Patrón repetitivo detectado (posible señal sintética)"
    };
  }
  
  return { isSuspicious: false };
};

/**
 * Calcula la autocorrelación para detectar patrones repetitivos
 */
const calculateAutocorrelation = (values: number[], lag = 1): number => {
  if (values.length < lag * 2) return 0;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < values.length - lag; i++) {
    const diff1 = values[i] - mean;
    const diff2 = values[i + lag] - mean;
    numerator += diff1 * diff2;
    denominator += diff1 * diff1;
  }
  
  return denominator !== 0 ? numerator / denominator : 0;
};
