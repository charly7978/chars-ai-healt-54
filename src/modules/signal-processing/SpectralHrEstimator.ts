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

  const sorted = Float64Array.from(powers);
  sorted.sort();
  const med = sorted[Math.floor(STEPS / 2)] || 1e-9;
  const ratio = maxP / (med * STEPS * 0.25 + 1e-9);
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

  const conf = Math.max(0, Math.min(1, (ratio - 1.2) / 4.5 + (harm > 0.12 && harm < 0.95 ? 0.12 : 0)));

  return {
    bpm: ratio > 1.05 ? peakBpm : 0,
    confidence: conf,
    peakRatio: Math.min(20, ratio),
  };
}
