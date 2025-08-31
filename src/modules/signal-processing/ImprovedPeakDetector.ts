/**
 * Detector mejorado de picos para señales PPG
 * Implementa algoritmos más robustos para detección de latidos cardíacos reales
 */

export interface Peak {
  index: number;
  value: number;
  timeMs: number;
  prominence: number;
  isValid: boolean;
}

export class ImprovedPeakDetector {
  private readonly minHeartRate = 40; // BPM mínimo
  private readonly maxHeartRate = 200; // BPM máximo
  private readonly adaptiveThreshold = 0.4; // Factor adaptativo más sensible
  private peakHistory: number[] = []; // Historia para mejorar detección
  
  /**
   * Detecta picos en una señal PPG usando algoritmo adaptativo
   */
  detectPeaks(signal: number[], fs: number): {
    peaks: Peak[];
    rrIntervals: number[];
    bpm: number | null;
    confidence: number;
  } {
    if (signal.length < fs * 2) { // Mínimo 2 segundos de señal
      return { peaks: [], rrIntervals: [], bpm: null, confidence: 0 };
    }

    // 1. Pre-procesamiento: Normalización robusta
    const normalized = this.robustNormalize(signal);
    
    // 2. Calcular derivada primera para encontrar cambios
    const derivative = this.calculateDerivative(normalized);
    
    // 3. Encontrar candidatos a picos
    const candidates = this.findPeakCandidates(normalized, derivative, fs);
    
    // 4. Filtrar picos usando criterios fisiológicos
    const validPeaks = this.filterPhysiologicalPeaks(candidates, fs);
    
    // 5. Calcular intervalos RR y BPM
    const rrIntervals = this.calculateRRIntervals(validPeaks);
    const { bpm, confidence } = this.calculateBPM(rrIntervals);
    
    return { peaks: validPeaks, rrIntervals, bpm, confidence };
  }

  private robustNormalize(signal: number[]): number[] {
    // Usar percentiles para robustez ante outliers
    const sorted = [...signal].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(signal.length * 0.1)];
    const p90 = sorted[Math.floor(signal.length * 0.9)];
    const range = p90 - p10;
    
    if (range < 0.001) return signal.map(() => 0);
    
    return signal.map(x => (x - p10) / range);
  }

  private calculateDerivative(signal: number[]): number[] {
    const derivative = new Array(signal.length).fill(0);
    
    // Derivada de 5 puntos para mayor suavidad
    for (let i = 2; i < signal.length - 2; i++) {
      derivative[i] = (-signal[i-2] - 2*signal[i-1] + 2*signal[i+1] + signal[i+2]) / 10;
    }
    
    return derivative;
  }

  private findPeakCandidates(signal: number[], derivative: number[], fs: number): Peak[] {
    const candidates: Peak[] = [];
    const minDistance = Math.floor(fs * 60 / this.maxHeartRate); // Distancia mínima entre picos
    
    // Umbral adaptativo basado en estadísticas locales
    const windowSize = Math.floor(fs * 1.5); // Ventana de 1.5 segundos
    let lastPeakIdx = -minDistance;
    
    // Primera pasada: encontrar todos los máximos locales
    const localMaxima: number[] = [];
    for (let i = 2; i < signal.length - 2; i++) {
      // Máximo local con ventana de 5 puntos
      if (signal[i] > signal[i-2] && signal[i] > signal[i-1] && 
          signal[i] > signal[i+1] && signal[i] > signal[i+2]) {
        localMaxima.push(i);
      }
    }
    
    // Segunda pasada: filtrar por umbral adaptativo
    for (const i of localMaxima) {
      if (i - lastPeakIdx < minDistance) continue;
      
      // Calcular estadísticas locales
      const start = Math.max(0, i - windowSize/2);
      const end = Math.min(signal.length, i + windowSize/2);
      const localSegment = signal.slice(start, end);
      
      // Usar percentiles para robustez
      const sorted = [...localSegment].sort((a, b) => a - b);
      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = p75 - p25;
      
      // Umbral basado en IQR (más robusto que desviación estándar)
      const threshold = p75 + this.adaptiveThreshold * iqr;
      
      // Calcular prominencia mejorada
      const prominence = this.calculateProminence(signal, i, windowSize/4);
      
      // Verificar derivada para confirmar pico
      const derivOk = derivative[i-1] > -0.1 && derivative[i+1] < 0.1;
      
      if (signal[i] > threshold && prominence > 0.05 && derivOk) {
        candidates.push({
          index: i,
          value: signal[i],
          timeMs: (i / fs) * 1000,
          prominence,
          isValid: true
        });
        lastPeakIdx = i;
      }
    }
    
    return candidates;
  }

  private calculateProminence(signal: number[], peakIdx: number, windowSize: number): number {
    const start = Math.max(0, peakIdx - windowSize);
    const end = Math.min(signal.length, peakIdx + windowSize);
    
    let leftMin = signal[peakIdx];
    let rightMin = signal[peakIdx];
    
    // Encontrar mínimos a la izquierda y derecha
    for (let i = peakIdx - 1; i >= start; i--) {
      if (signal[i] < leftMin) leftMin = signal[i];
      if (signal[i] > signal[peakIdx]) break;
    }
    
    for (let i = peakIdx + 1; i < end; i++) {
      if (signal[i] < rightMin) rightMin = signal[i];
      if (signal[i] > signal[peakIdx]) break;
    }
    
    return signal[peakIdx] - Math.max(leftMin, rightMin);
  }

  private filterPhysiologicalPeaks(candidates: Peak[], fs: number): Peak[] {
    if (candidates.length < 2) return candidates;
    
    const filtered: Peak[] = [];
    const minInterval = 60000 / this.maxHeartRate; // ms
    const maxInterval = 60000 / this.minHeartRate; // ms
    
    // Primer pico siempre se incluye si es prominente
    if (candidates[0].prominence > 0.2) {
      filtered.push(candidates[0]);
    }
    
    for (let i = 1; i < candidates.length; i++) {
      const interval = candidates[i].timeMs - filtered[filtered.length - 1]?.timeMs || 0;
      
      // Verificar que el intervalo sea fisiológicamente plausible
      if (interval >= minInterval && interval <= maxInterval) {
        // Verificar consistencia con intervalos previos
        if (filtered.length >= 2) {
          const prevInterval = filtered[filtered.length - 1].timeMs - filtered[filtered.length - 2].timeMs;
          const variability = Math.abs(interval - prevInterval) / prevInterval;
          
          // Permitir hasta 20% de variabilidad entre latidos consecutivos
          if (variability < 0.2 || candidates[i].prominence > 0.3) {
            filtered.push(candidates[i]);
          }
        } else {
          filtered.push(candidates[i]);
        }
      }
    }
    
    return filtered;
  }

  private calculateRRIntervals(peaks: Peak[]): number[] {
    const intervals: number[] = [];
    
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i].timeMs - peaks[i-1].timeMs);
    }
    
    return intervals;
  }

  private calculateBPM(rrIntervals: number[]): { bpm: number | null; confidence: number } {
    if (rrIntervals.length < 2) {
      return { bpm: null, confidence: 0 };
    }
    
    // Filtrar outliers usando MAD (Median Absolute Deviation)
    const median = this.median(rrIntervals);
    const mad = this.median(rrIntervals.map(x => Math.abs(x - median)));
    const threshold = median + 3 * mad;
    
    const filtered = rrIntervals.filter(x => Math.abs(x - median) <= threshold);
    
    if (filtered.length < 2) {
      return { bpm: null, confidence: 0 };
    }
    
    // Calcular BPM promedio ponderado
    const weights = filtered.map((_, i) => Math.exp(-i * 0.1)); // Dar más peso a intervalos recientes
    const weightedSum = filtered.reduce((sum, interval, i) => sum + interval * weights[i], 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const avgInterval = weightedSum / totalWeight;
    
    const bpm = Math.round(60000 / avgInterval);
    
    // Calcular confianza basada en consistencia
    const std = Math.sqrt(
      filtered.reduce((sum, x) => sum + (x - avgInterval) ** 2, 0) / filtered.length
    );
    const cv = std / avgInterval; // Coeficiente de variación
    const confidence = Math.max(0, Math.min(1, 1 - cv * 2));
    
    return { bpm, confidence };
  }

  private median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

// Función auxiliar para compatibilidad con el código existente
export function improvedDetectPeaks(
  signal: number[], 
  fs: number, 
  minPeakDistanceMs = 300, 
  minPeakHeight = 0.3
) {
  const detector = new ImprovedPeakDetector();
  const result = detector.detectPeaks(signal, fs);
  
  return {
    peaks: result.peaks.map(p => p.index),
    peakTimesMs: result.peaks.map(p => p.timeMs),
    rr: result.rrIntervals,
    confidence: result.confidence
  };
}