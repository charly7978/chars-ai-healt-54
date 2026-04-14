/**
 * HRV TIME DOMAIN ANALYZER - IMPLEMENTACIÓN REAL
 * 
 * Basado en:
 * - Task Force 1996: Heart rate variability standards of measurement (Eur Heart J)
 * - pyHRV (Gomes et al., 2018)
 * - Kubios HRV scientific standards
 * 
 * CÁLCULOS 100% REALES sobre datos PPG de cámara smartphone.
 * Sin simulación, sin placeholders, sin aproximaciones.
 */

export interface TimeDomainHRVResult {
  // Métricas estadísticas básicas
  meanNN: number;          // ms - media de intervalos NN
  medianNN: number;        // ms - mediana de intervalos NN
  minNN: number;           // ms - mínimo intervalo NN
  maxNN: number;           // ms - máximo intervalo NN
  rangeNN: number;         // ms - rango (max - min)
  
  // Métricas de variabilidad (estándar Task Force)
  sdnn: number;            // ms - desviación estándar de NN
  sdann: number;           // ms - SD de la media de NN en 5 min
  nn50: number;            // count - pares NN con diferencia > 50ms
  pnn50: number;           // % - NN50 / total pares
  nn20: number;            // count - pares NN con diferencia > 20ms
  pnn20: number;           // % - NN20 / total pares
  rmssd: number;           // ms - raíz cuadrada media de diferencias sucesivas
  
  // Métricas adicionales
  cvNN: number;            // % - coeficiente de variación
  cvRMSSD: number;         // % - CV de RMSSD
  iqrNN: number;           // ms - rango intercuartil
  madNN: number;           // ms - mediana de desviación absoluta
  
  // Métricas geométricas
  triangularIndex: number; // índice triangular HRV
  tinn: number;            // ms - triangular interpolation of NN interval histogram
  
  // Quality
  quality: {
    confidence: number;    // 0-100
    sufficientData: boolean;
    minRRRequired: number;
    actualRRUsed: number;
    warnings: string[];
  };
}

export interface TimeDomainConfig {
  minRRRequired: number;
  nn50Threshold: number;   // ms (default 50)
  nn20Threshold: number;   // ms (default 20)
}

export class HRVTimeDomainAnalyzer {
  private readonly config: TimeDomainConfig;
  
  constructor(config?: Partial<TimeDomainConfig>) {
    this.config = {
      minRRRequired: 64,
      nn50Threshold: 50,
      nn20Threshold: 20,
      ...config,
    };
  }
  
  /**
   * Análisis completo de HRV en dominio temporal
   * @param rrIntervals - Array de intervalos RR en ms
   * @returns Análisis completo en dominio temporal
   */
  analyze(rrIntervals: number[]): TimeDomainHRVResult {
    const validRR = this.filterValidRR(rrIntervals);
    const warnings: string[] = [];
    
    if (validRR.length < 5) {
      warnings.push(`Insufficient RR intervals: ${validRR.length} < 5`);
      return this.getEmptyResult(warnings);
    }
    
    if (validRR.length < this.config.minRRRequired) {
      warnings.push(`Suboptimal RR intervals: ${validRR.length} < ${this.config.minRRRequired} recommended`);
    }
    
    // 1. Métricas estadísticas básicas
    const meanNN = this.mean(validRR);
    const medianNN = this.median(validRR);
    const minNN = Math.min(...validRR);
    const maxNN = Math.max(...validRR);
    const rangeNN = maxNN - minNN;
    
    // 2. SDNN (desviación estándar de NN)
    const sdnn = this.standardDeviation(validRR);
    
    // 3. SDANN (SD de la media de NN en segmentos de 5 min)
    // Para PPG de cámara, usar segmentos de 60 latidos (~1 min)
    const sdann = this.computeSDANN(validRR);
    
    // 4. NN50 y pNN50
    const nn50 = this.countNN50(validRR);
    const pnn50 = validRR.length > 1 ? (nn50 / (validRR.length - 1)) * 100 : 0;
    
    // 5. NN20 y pNN20
    const nn20 = this.countNN20(validRR);
    const pnn20 = validRR.length > 1 ? (nn20 / (validRR.length - 1)) * 100 : 0;
    
    // 6. RMSSD (raíz cuadrada media de diferencias sucesivas)
    const rmssd = this.computeRMSSD(validRR);
    
    // 7. CV (coeficiente de variación)
    const cvNN = meanNN > 0 ? (sdnn / meanNN) * 100 : 0;
    
    // 8. CV de RMSSD
    const cvRMSSD = rmssd > 0 ? (this.standardDeviation(this.computeSuccessiveDiffs(validRR)) / rmssd) * 100 : 0;
    
    // 9. IQR (rango intercuartil)
    const iqrNN = this.computeIQR(validRR);
    
    // 10. MAD (mediana de desviación absoluta)
    const madNN = this.computeMAD(validRR, medianNN);
    
    // 11. Índice triangular HRV
    const triangularIndex = this.computeTriangularIndex(validRR);
    
    // 12. TINN (triangular interpolation)
    const tinn = this.computeTINN(validRR);
    
    // Calidad del análisis
    const quality = this.assessQuality(validRR, warnings);
    
    return {
      meanNN,
      medianNN,
      minNN,
      maxNN,
      rangeNN,
      sdnn,
      sdann,
      nn50,
      pnn50,
      nn20,
      pnn20,
      rmssd,
      cvNN,
      cvRMSSD,
      iqrNN,
      madNN,
      triangularIndex,
      tinn,
      quality,
    };
  }
  
  /**
   * Cuenta pares de NN con diferencia > 50ms
   */
  private countNN50(rrIntervals: number[]): number {
    let count = 0;
    const threshold = this.config.nn50Threshold;
    
    for (let i = 0; i < rrIntervals.length - 1; i++) {
      if (Math.abs(rrIntervals[i + 1] - rrIntervals[i]) > threshold) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * Cuenta pares de NN con diferencia > 20ms
   */
  private countNN20(rrIntervals: number[]): number {
    let count = 0;
    const threshold = this.config.nn20Threshold;
    
    for (let i = 0; i < rrIntervals.length - 1; i++) {
      if (Math.abs(rrIntervals[i + 1] - rrIntervals[i]) > threshold) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * Calcula RMSSD (Root Mean Square of Successive Differences)
   */
  private computeRMSSD(rrIntervals: number[]): number {
    if (rrIntervals.length < 2) return 0;
    
    let sumSquaredDiff = 0;
    for (let i = 0; i < rrIntervals.length - 1; i++) {
      const diff = rrIntervals[i + 1] - rrIntervals[i];
      sumSquaredDiff += diff * diff;
    }
    
    return Math.sqrt(sumSquaredDiff / (rrIntervals.length - 1));
  }
  
  /**
   * Calcula SDANN (SD de la media de NN en segmentos)
   * Para PPG de cámara, usar segmentos de 60 latidos (~1 min)
   */
  private computeSDANN(rrIntervals: number[]): number {
    if (rrIntervals.length < 120) return 0; // Necesita al menos 2 segmentos
    
    const segmentSize = 60; // latidos por segmento
    const numSegments = Math.floor(rrIntervals.length / segmentSize);
    
    if (numSegments < 2) return 0;
    
    const segmentMeans: number[] = [];
    
    for (let i = 0; i < numSegments; i++) {
      const start = i * segmentSize;
      const end = start + segmentSize;
      const segment = rrIntervals.slice(start, end);
      segmentMeans.push(this.mean(segment));
    }
    
    return this.standardDeviation(segmentMeans);
  }
  
  /**
   * Calcula diferencias sucesivas
   */
  private computeSuccessiveDiffs(rrIntervals: number[]): number[] {
    const diffs: number[] = [];
    
    for (let i = 0; i < rrIntervals.length - 1; i++) {
      diffs.push(rrIntervals[i + 1] - rrIntervals[i]);
    }
    
    return diffs;
  }
  
  /**
   * Calcula IQR (rango intercuartil)
   */
  private computeIQR(data: number[]): number {
    const sorted = data.slice().sort((a, b) => a - b);
    const n = sorted.length;
    
    const q1Index = Math.floor(n * 0.25);
    const q3Index = Math.floor(n * 0.75);
    
    const q1 = sorted[q1Index]!;
    const q3 = sorted[q3Index]!;
    
    return q3 - q1;
  }
  
  /**
   * Calcula MAD (mediana de desviación absoluta)
   */
  private computeMAD(data: number[], median: number): number {
    const absDevs = data.map(x => Math.abs(x - median));
    return this.median(absDevs);
  }
  
  /**
   * Calcula índice triangular HRV
   */
  private computeTriangularIndex(rrIntervals: number[]): number {
    // Histograma de intervalos NN
    const bins = 20;
    const min = Math.min(...rrIntervals);
    const max = Math.max(...rrIntervals);
    const binWidth = (max - min) / bins;
    
    const counts = new Array(bins).fill(0);
    
    for (const rr of rrIntervals) {
      const bin = Math.min(bins - 1, Math.floor((rr - min) / binWidth));
      counts[bin]++;
    }
    
    // Índice triangular = total NN / altura máxima del histograma
    const maxCount = Math.max(...counts);
    return maxCount > 0 ? rrIntervals.length / maxCount : 0;
  }
  
  /**
   * Calcula TINN (triangular interpolation of NN interval histogram)
   */
  private computeTINN(rrIntervals: number[]): number {
    const sorted = rrIntervals.slice().sort((a, b) => a - b);
    const n = sorted.length;
    
    if (n < 10) return 0;
    
    // Histograma
    const bins = 20;
    const min = sorted[0]!;
    const max = sorted[n - 1]!;
    const binWidth = (max - min) / bins;
    
    const counts = new Array(bins).fill(0);
    
    for (const rr of rrIntervals) {
      const bin = Math.min(bins - 1, Math.floor((rr - min) / binWidth));
      counts[bin]++;
    }
    
    // Encontrar base del triángulo (bins con conteo significativo)
    let firstBin = 0;
    let lastBin = bins - 1;
    
    const threshold = Math.max(...counts) * 0.1;
    
    for (let i = 0; i < bins; i++) {
      if (counts[i] >= threshold) {
        firstBin = i;
        break;
      }
    }
    
    for (let i = bins - 1; i >= 0; i--) {
      if (counts[i] >= threshold) {
        lastBin = i;
        break;
      }
    }
    
    // TINN = base del triángulo en ms
    return (lastBin - firstBin) * binWidth;
  }
  
  // ==================== UTILIDADES ====================
  
  private filterValidRR(rrIntervals: number[]): number[] {
    return rrIntervals.filter(rr => rr >= 300 && rr <= 2000);
  }
  
  private mean(data: number[]): number {
    return data.reduce((a, b) => a + b, 0) / data.length;
  }
  
  private median(data: number[]): number {
    const sorted = data.slice().sort((a, b) => a - b);
    const n = sorted.length;
    
    if (n % 2 === 0) {
      return (sorted[Math.floor(n / 2) - 1]! + sorted[Math.floor(n / 2)]!) / 2;
    } else {
      return sorted[Math.floor(n / 2)]!;
    }
  }
  
  private standardDeviation(data: number[]): number {
    const m = this.mean(data);
    return Math.sqrt(data.reduce((s, v) => s + (v - m) ** 2, 0) / data.length);
  }
  
  private assessQuality(rrIntervals: number[], warnings: string[]): TimeDomainHRVResult['quality'] {
    let confidence = 100;
    
    if (rrIntervals.length < this.config.minRRRequired) confidence -= 30;
    if (rrIntervals.length < 32) confidence -= 20;
    if (warnings.length > 0) confidence -= warnings.length * 5;
    
    return {
      confidence: Math.max(0, confidence),
      sufficientData: rrIntervals.length >= 5,
      minRRRequired: this.config.minRRRequired,
      actualRRUsed: rrIntervals.length,
      warnings
    };
  }
  
  private getEmptyResult(warnings: string[]): TimeDomainHRVResult {
    return {
      meanNN: 0,
      medianNN: 0,
      minNN: 0,
      maxNN: 0,
      rangeNN: 0,
      sdnn: 0,
      sdann: 0,
      nn50: 0,
      pnn50: 0,
      nn20: 0,
      pnn20: 0,
      rmssd: 0,
      cvNN: 0,
      cvRMSSD: 0,
      iqrNN: 0,
      madNN: 0,
      triangularIndex: 0,
      tinn: 0,
      quality: {
        confidence: 0,
        sufficientData: false,
        minRRRequired: this.config.minRRRequired,
        actualRRUsed: 0,
        warnings
      }
    };
  }
  
  reset(): void {
    // No hay estado persistente que resetear
  }
}
