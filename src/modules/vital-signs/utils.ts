/**
 * Calculates the AC component (peak-to-peak amplitude) of a signal
 */
export function calculateAC(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/**
 * Calculates the DC component (average value) of a signal
 */
export function calculateDC(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculates the standard deviation of a set of values
 */
export function calculateStandardDeviation(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sqDiffs = values.map((v) => Math.pow(v - mean, 2));
  const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(avgSqDiff);
}

/**
 * Finds peaks and valleys in a signal
 */
export function findPeaksAndValleys(values: number[]): { peakIndices: number[]; valleyIndices: number[] } {
  console.log('🔍 findPeaksAndValleys DEBUG:', {
    valuesLength: values.length,
    firstValues: values.slice(0, 10),
    lastValues: values.slice(-10)
  });

  const peakIndices: number[] = [];
  const valleyIndices: number[] = [];

  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      peakIndices.push(i);
    }
    if (values[i] < values[i - 1] && values[i] < values[i + 1]) {
      valleyIndices.push(i);
    }
  }

  console.log('🔍 findPeaksAndValleys: Picos y valles encontrados:', {
    peakIndices: peakIndices.slice(0, 10),
    valleyIndices: valleyIndices.slice(0, 10),
    totalPeaks: peakIndices.length,
    totalValleys: valleyIndices.length
  });

  return { peakIndices, valleyIndices };
}

/**
 * Calculates the amplitude between peaks and valleys
 */
export function calculateAmplitude(
  values: number[],
  peakIndices: number[],
  valleyIndices: number[]
): number {
  console.log('🔍 calculateAmplitude DEBUG:', {
    valuesLength: values.length,
    peakCount: peakIndices.length,
    valleyCount: valleyIndices.length,
    firstPeakIndex: peakIndices[0],
    firstValleyIndex: valleyIndices[0],
    firstPeakValue: peakIndices[0] !== undefined ? values[peakIndices[0]] : 'N/A',
    firstValleyValue: valleyIndices[0] !== undefined ? values[valleyIndices[0]] : 'N/A'
  });

  if (!peakIndices.length || !valleyIndices.length) {
    console.log('❌ calculateAmplitude: Sin picos o valles');
    return 0;
  }

  let sum = 0;
  const len = Math.min(peakIndices.length, valleyIndices.length);
  for (let i = 0; i < len; i++) {
    const peakValue = values[peakIndices[i]];
    const valleyValue = values[valleyIndices[i]];
    const difference = peakValue - valleyValue;
    sum += difference;
    console.log(`🔍 calculateAmplitude: Pico ${i}: ${peakValue}, Valle ${i}: ${valleyValue}, Diferencia: ${difference}`);
  }
  
  const result = sum / len;
  console.log('🔍 calculateAmplitude: Resultado final:', result);
  return result;
}
