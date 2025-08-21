export function computeSNR(psdPeak: number, psdNoiseMedian: number) {
  if (!psdNoiseMedian || !isFinite(psdNoiseMedian)) return 0;
  const snr = psdPeak / psdNoiseMedian;
  const db = 10 * Math.log10(Math.max(1e-9, snr));
  const scaled = (db + 30) * 2; // ajustar escala: -30dB->0, ~+20dB->100
  return Math.max(0, Math.min(100, Math.round(scaled)));
}
