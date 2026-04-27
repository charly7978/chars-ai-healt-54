/**
 * Estimación espectral de HR por banco de DFT estrecho en banda cardiaca (sin FFT completa).
 * Pensado para buffers cortos y fs variable (timestamps reales → sr estimado).
 */

export interface SpectralHrResult {
  bpm: number;
  confidence: number;
  /** Potencia pico / mediana del banco (prominencia relativa) */
  peakRatio: number;
}

const BPM_MIN = 38;
const BPM_MAX = 195;
const STEPS = 52;

export function estimateHrNarrowbank(
  samples: Float64Array,
  sampleRateHz: number
): SpectralHrResult {
  const n = samples.length;
  if (n < 36 || sampleRateHz < 10) return { bpm: 0, confidence: 0, peakRatio: 0 };

  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;

  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = samples[i] - mean;

  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  }
  for (let i = 0; i < n; i++) x[i] *= w[i];

  const powers = new Float64Array(STEPS);
  let maxP = 0;
  let maxIdx = 0;
  for (let s = 0; s < STEPS; s++) {
    const bpm = BPM_MIN + ((BPM_MAX - BPM_MIN) * s) / (STEPS - 1);
    const f = bpm / 60;
    const omega = (2 * Math.PI * f) / sampleRateHz;
    let cr = 0,
      ci = 0;
    for (let i = 0; i < n; i++) {
      const angle = omega * i;
      cr += x[i] * Math.cos(angle);
      ci += x[i] * Math.sin(angle);
    }
    const p = cr * cr + ci * ci;
    powers[s] = p;
    if (p > maxP) {
      maxP = p;
      maxIdx = s;
    }
  }

  // Q-factor real del pico: prominencia relativa al espectro completo,
  // no solo a la mediana. La diferencia es crítica con ruido cuasi-blanco.
  let totalP = 0;
  for (let i = 0; i < STEPS; i++) totalP += powers[i];
  const meanP = totalP / STEPS;
  const sorted = Float64Array.from(powers);
  sorted.sort();
  const med = sorted[Math.floor(STEPS / 2)] || 1e-9;
  // Cardiac Band Spectrum Energy Ratio (MobileAF 2025): energía del pico
  // ± 1 bin sobre energía total de la banda cardíaca.
  const peakBandEnergy =
    (powers[Math.max(0, maxIdx - 1)] || 0) +
    (powers[maxIdx] || 0) +
    (powers[Math.min(STEPS - 1, maxIdx + 1)] || 0);
  const cbser = totalP > 1e-9 ? peakBandEnergy / totalP : 0;
  // Q-factor estricto: pico vs mediana (descarta espectros planos).
  const qFactor = maxP / (med + 1e-9);
  // Pico vs media (descarta picos en ruido espectralmente plano).
  const peakOverMean = maxP / (meanP + 1e-9);
  const peakBpm = BPM_MIN + ((BPM_MAX - BPM_MIN) * maxIdx) / (STEPS - 1);

  let harm = 0;
  const f0 = peakBpm / 60;
  if (f0 > 0.4) {
    const f2 = f0 * 2;
    const omega = (2 * Math.PI * f2) / sampleRateHz;
    let cr = 0,
      ci = 0;
    for (let i = 0; i < n; i++) {
      const angle = omega * i;
      cr += x[i] * Math.cos(angle);
      ci += x[i] * Math.sin(angle);
    }
    harm = (cr * cr + ci * ci) / (maxP + 1e-9);
  }

  // Aceptación estricta: el pico debe destacar fuertemente sobre el resto
  // del espectro. Un espectro plano (ruido de cámara, pared, papel) NO
  // pasa qFactor>4 ni cbser>0.18 ni peakOverMean>3.5 simultáneamente.
  const validPeak =
    qFactor > 4.0 &&
    cbser > 0.18 &&
    peakOverMean > 3.5;

  const conf = !validPeak
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          // Pondera Q, energía relativa y armónica fisiológica
          0.45 * Math.min(1, (qFactor - 4) / 8) +
            0.35 * Math.min(1, (cbser - 0.18) / 0.25) +
            0.20 * (harm > 0.10 && harm < 0.90 ? 1 : 0)
        )
      );

  return {
    bpm: validPeak ? peakBpm : 0,
    confidence: conf,
    peakRatio: Math.min(20, qFactor),
  };
}
