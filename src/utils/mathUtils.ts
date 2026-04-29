/**
 * UTILIDADES MATEMÁTICAS CENTRALIZADAS
 * 
 * Funciones estadísticas y matemáticas usadas en múltiples módulos.
 * Centralizar aquí elimina duplicación y garantiza consistencia.
 */

/**
 * Calcula la mediana de un array numérico.
 * No muta el array original.
 */
export function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 
    ? sorted[mid] 
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calcula la media (promedio) de un array numérico.
 */
export function mean(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calcula la varianza de un array numérico.
 * Usa la fórmula de población (divide por N).
 */
export function variance(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
}

/**
 * Calcula la desviación estándar.
 */
export function stdDev(arr: readonly number[]): number {
  return Math.sqrt(variance(arr));
}

/**
 * Calcula el coeficiente de variación (CV = stdDev / mean).
 * Retorna 0 si la media es 0.
 */
export function coefficientOfVariation(arr: readonly number[]): number {
  const m = mean(arr);
  if (m === 0) return 0;
  return stdDev(arr) / m;
}

/**
 * Calcula el percentil p (0-1) de un array numérico.
 * Usa interpolación lineal.
 */
export function percentile(arr: readonly number[], p: number): number {
  if (arr.length === 0) return 0;
  if (p <= 0) return Math.min(...arr);
  if (p >= 1) return Math.max(...arr);
  
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  
  if (lower === upper) return sorted[lower];
  
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calcula la media truncada (trimmed mean).
 * Elimina proporción `trim` de cada extremo antes de promediar.
 */
export function trimmedMean(arr: readonly number[], trim: number): number {
  if (arr.length === 0) return 0;
  if (trim <= 0) return mean(arr);
  if (trim >= 0.5) return median(arr);
  
  const sorted = [...arr].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trim);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return mean(trimmed);
}

/**
 * Calcula la suma de cuadrados de diferencias (SSD) para RMSSD.
 * Usado en análisis de variabilidad de ritmo cardíaco (HRV).
 */
export function sumOfSquaredDifferences(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  let ssd = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    ssd += d * d;
  }
  return ssd;
}

/**
 * Calcula RMSSD (Root Mean Square of Successive Differences).
 * Métrica estándar de HRV.
 */
export function rmssd(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  return Math.sqrt(sumOfSquaredDifferences(arr) / (arr.length - 1));
}

/**
 * Calcula pNN50: proporción de intervalos sucesivos que difieren > 50ms.
 * Otra métrica estándar de HRV.
 */
export function pnn50(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < arr.length; i++) {
    if (Math.abs(arr[i] - arr[i - 1]) > 50) count++;
  }
  return count / (arr.length - 1);
}

/**
 * Calcula entropía de Shannon de un histograma de frecuencias.
 * Usado en análisis de complejidad de señal.
 */
export function shannonEntropy(frequencies: readonly number[]): number {
  const total = frequencies.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  
  let entropy = 0;
  for (const f of frequencies) {
    if (f > 0) {
      const p = f / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Clamps un valor al rango [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Interpolación lineal entre a y b con factor t (0-1).
 */
export function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/**
 * Suavizado EMA (Exponential Moving Average).
 * alpha: factor de suavizado (0-1), valores más altos = más reactivo.
 */
export function ema(current: number, next: number, alpha: number): number {
  if (!isFinite(current) || current === 0) return next;
  if (!isFinite(next)) return current;
  return current * (1 - alpha) + next * alpha;
}

/**
 * Detecta y remueve outliers usando el método IQR (Interquartile Range).
 * Retorna array filtrado.
 */
export function removeOutliersIQR(arr: readonly number[]): number[] {
  if (arr.length < 4) return [...arr];
  
  const sorted = [...arr].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  
  return arr.filter(v => v >= lowerBound && v <= upperBound);
}

/**
 * Calcula la moda (valor más frecuente) de un array.
 * En empate, retorna el primero encontrado.
 */
export function mode(arr: readonly number[]): number | null {
  if (arr.length === 0) return null;
  
  const freq = new Map<number, number>();
  let maxCount = 0;
  let modeValue = arr[0];
  
  for (const v of arr) {
    const count = (freq.get(v) || 0) + 1;
    freq.set(v, count);
    if (count > maxCount) {
      maxCount = count;
      modeValue = v;
    }
  }
  
  return maxCount > 1 ? modeValue : null;
}

/**
 * Calcula correlación de Pearson entre dos arrays.
 * Retorna valor entre -1 y 1.
 */
export function correlation(x: readonly number[], y: readonly number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  
  const mx = mean(x);
  const my = mean(y);
  
  let num = 0;
  let denX = 0;
  let denY = 0;
  
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  
  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}

/**
 * Versión segura de parseFloat que retorna defaultValue si no es número válido.
 */
export function safeParseFloat(str: string, defaultValue = 0): number {
  const val = parseFloat(str);
  return isFinite(val) ? val : defaultValue;
}

/**
 * Formatea un número a precisión fija sin trailing zeros.
 * Ej: 3.1400 -> "3.14", 3.0000 -> "3"
 */
export function formatNumber(num: number, maxDecimals = 2): string {
  if (!isFinite(num)) return "--";
  const fixed = num.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, '');
}
