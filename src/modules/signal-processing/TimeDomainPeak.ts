// Detector de picos simple en dominio temporal (se usa en señal filtrada y normalizada).
// Devuelve índices de picos y tiempos entre picos (ms) según fs.
export function detectPeaks(signal: number[], fs: number, minPeakDistanceMs = 300, minPeakHeight = 0.3) {
  const peaks: number[] = [];
  const N = signal.length;
  const minDist = Math.round((minPeakDistanceMs/1000) * fs);
  let lastPeak = -minDist*2;
  for (let i = 1; i < N-1; i++) {
    if (signal[i] > signal[i-1] && signal[i] >= signal[i+1] && signal[i] > minPeakHeight) {
      if (i - lastPeak >= minDist) { peaks.push(i); lastPeak = i; }
    }
  }
  // convertir a tiempos (ms)
  const times = peaks.map(idx => Math.round(idx / fs * 1000));
  // rr intervals (ms) entre picos
  const rr: number[] = [];
  for (let i = 1; i < times.length; i++) rr.push(times[i] - times[i-1]);
  return { peaks, peakTimesMs: times, rr };
}
