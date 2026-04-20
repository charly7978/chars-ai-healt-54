/**
 * Math utilities for signal processing
 */

/**
 * Compute mean of an array of numbers
 */
export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

/**
 * Compute standard deviation of an array of numbers
 */
export function std(values: number[], m?: number): number {
  if (values.length < 2) return 0;
  const mu = m !== undefined ? m : mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / values.length);
}

/**
 * Compute median of an array of numbers
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute root mean square (RMS) of an array of numbers
 */
export function rms(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}
