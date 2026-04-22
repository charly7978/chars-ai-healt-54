/**
 * ROBUST STATS - Estadísticas robustas sin dependencias
 * 
 * Percentiles, mediana, MAD, winsorización, etc.
 */

export class RobustStats {
  /**
   * Percentil de un array (usando quickselect aproximado)
   */
  static percentile(values: number[] | Float64Array, p: number): number {
    if (values.length === 0) return 0;
    
    const arr = Array.from(values);
    arr.sort((a, b) => a - b);
    
    const idx = Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * p)));
    return arr[idx];
  }

  /**
   * Mediana robusta
   */
  static median(values: number[] | Float64Array): number {
    return this.percentile(values, 0.5);
  }

  /**
   * Media recortada (trimmed mean) - descarta outliers extremos
   */
  static trimmedMean(values: number[] | Float64Array, trimFraction: number = 0.1): number {
    if (values.length === 0) return 0;
    
    const arr = Array.from(values);
    arr.sort((a, b) => a - b);
    
    const trimCount = Math.floor(arr.length * trimFraction);
    const start = trimCount;
    const end = arr.length - trimCount;
    
    if (end <= start) return this.mean(arr);
    
    const trimmed = arr.slice(start, end);
    return this.mean(trimmed);
  }

  /**
   * Media aritmética
   */
  static mean(values: number[] | Float64Array): number {
    if (values.length === 0) return 0;
    const sum = Array.from(values).reduce((a, b) => a + b, 0);
    return sum / values.length;
  }

  /**
   * Desviación estándar
   */
  static std(values: number[] | Float64Array): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    const variance = Array.from(values).reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * MAD (Median Absolute Deviation) - medida robusta de dispersión
   */
  static mad(values: number[] | Float64Array): number {
    if (values.length === 0) return 0;
    const med = this.median(values);
    const absDeviations = Array.from(values).map(v => Math.abs(v - med));
    return this.median(absDeviations);
  }

  /**
   * Winsorización - reemplaza outliers extremos con percentiles
   */
  static winsorize(values: number[] | Float64Array, lowerP: number = 0.05, upperP: number = 0.95): number[] {
    if (values.length === 0) return [];
    
    const arr = Array.from(values);
    const lower = this.percentile(arr, lowerP);
    const upper = this.percentile(arr, upperP);
    
    return arr.map(v => Math.max(lower, Math.min(upper, v)));
  }

  /**
   * Winsorización in-place sobre Float64Array
   */
  static winsorizeInPlace(values: Float64Array, lowerP: number = 0.05, upperP: number = 0.95): void {
    if (values.length === 0) return;
    
    const lower = this.percentile(values, lowerP);
    const upper = this.percentile(values, upperP);
    
    for (let i = 0; i < values.length; i++) {
      values[i] = Math.max(lower, Math.min(upper, values[i]));
    }
  }

  /**
   * Coeficiente de variación
   */
  static cv(values: number[] | Float64Array): number {
    const mean = this.mean(values);
    if (mean === 0) return 0;
    return this.std(values) / Math.abs(mean);
  }

  /**
   * IQR (Interquartile Range)
   */
  static iqr(values: number[] | Float64Array): number {
    return this.percentile(values, 0.75) - this.percentile(values, 0.25);
  }

  /**
   * Outliers usando IQR (método de Tukey)
   */
  static detectOutliersIQR(values: number[] | Float64Array, multiplier: number = 1.5): {
    outliers: number[];
    lowerBound: number;
    upperBound: number;
  } {
    if (values.length === 0) {
      return { outliers: [], lowerBound: 0, upperBound: 0 };
    }
    
    const q1 = this.percentile(values, 0.25);
    const q3 = this.percentile(values, 0.75);
    const iqr = q3 - q1;
    
    const lowerBound = q1 - multiplier * iqr;
    const upperBound = q3 + multiplier * iqr;
    
    const outliers = Array.from(values).filter(v => v < lowerBound || v > upperBound);
    
    return { outliers, lowerBound, upperBound };
  }

  /**
   * Z-score robusto usando MAD
   */
  static robustZScore(value: number, values: number[] | Float64Array): number {
    const med = this.median(values);
    const madVal = this.mad(values);
    if (madVal === 0) return 0;
    return (value - med) / (madVal * 1.4826); // 1.4826 para normalidad
  }

  /**
   * Suavizado exponencial móvil
   */
  static ewma(values: number[] | Float64Array, alpha: number = 0.1): number[] {
    if (values.length === 0) return [];
    
    const result: number[] = [];
    let ema = values[0];
    
    for (const v of values) {
      ema = alpha * v + (1 - alpha) * ema;
      result.push(ema);
    }
    
    return result;
  }

  /**
   * Correlación de Pearson
   */
  static correlation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;
    
    const n = x.length;
    const meanX = this.mean(x);
    const meanY = this.mean(y);
    
    let num = 0, denX = 0, denY = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  /**
   * Autocorrelación en lag específico
   */
  static autocorrelation(values: number[] | Float64Array, lag: number): number {
    const n = values.length;
    if (n <= lag || lag < 0) return 0;
    
    const mean = this.mean(values);
    const variance = this.mean(Array.from(values).map(v => (v - mean) ** 2));
    
    if (variance === 0) return 0;
    
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (values[i] - mean) * (values[i + lag] - mean);
    }
    
    return sum / ((n - lag) * variance);
  }
}
