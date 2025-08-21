<<<<<<< HEAD
// Goertzel para potencia en frecuencia (eficiente para pocas frecuencias)
export function goertzelPower(signal: number[], fs: number, freq: number): number {
  const N = signal.length;
  if (N === 0) return 0;
  const k = Math.round((freq / fs) * N);
=======

// Goertzel para potencia en frecuencia dada. Rápido y eficiente para rangos reducidos.
export function goertzelPower(signal: number[], fs: number, freq: number): number {
  const N = signal.length;
  if (N === 0) return 0;
  const k = (freq / fs) * N;
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
  const omega = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) {
    s0 = signal[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(omega);
  const imag = s2 * Math.sin(omega);
  return real * real + imag * imag;
}
