/**
 * GOLDEN SIGNAL GENERATORS — DETERMINISTIC TEST FIXTURES
 *
 * Pure-math synthesizers used across the test suite. Zero randomness
 * (no Math.random) — every fixture is reproducible bit-for-bit.
 *
 * Provides:
 *  - Synthetic PPG (cardiac waveform with dicrotic notch + optional resp/AM/FM modulation)
 *  - Synthetic RR series (regular, variable, bigeminy, ectopic)
 *  - Synthetic ImageData (uniform red-dominant frame, optionally with pulsatility)
 *  - Synthetic LED-flicker noise overlay
 */

export interface SyntheticPPGOptions {
  durationSec: number;
  sampleRate: number;        // Hz, e.g. 30
  bpm: number;               // mean heart rate
  amplitude?: number;        // peak amplitude of the cardiac component (default 5)
  baseline?: number;         // DC offset (default 100)
  dicroticDepth?: number;    // 0..1 (default 0.35)
  respirationBpm?: number;   // adds AM modulation if > 0 (default 0)
  respirationDepth?: number; // 0..1 (default 0.15)
  hrvRmssdMs?: number;       // adds FM jitter on RR (default 0)
  ledFlickerHz?: number;     // adds aliased noise (default 0)
  ledFlickerAmp?: number;    // amplitude of flicker (default 0)
  motionBurstAt?: number[];  // sample indices to inject motion artifacts
  motionBurstAmp?: number;   // motion artifact amplitude (default amplitude * 4)
}

/**
 * Build a single canonical cardiac pulse over `lengthSamples` samples.
 * Shape: fast systolic upstroke, sharp peak, descent with dicrotic notch + diastolic peak.
 * Returns a normalized waveform in [0, 1].
 */
function cardiacPulse(lengthSamples: number, dicroticDepth: number): Float64Array {
  const out = new Float64Array(lengthSamples);
  if (lengthSamples < 4) return out;

  // Phase boundaries (fractions of cycle):
  //   onset 0 → systolic peak ≈ 0.30 → dicrotic notch ≈ 0.55 → diastolic peak ≈ 0.70 → next onset 1.0
  const peakIdx = Math.round(lengthSamples * 0.30);
  const notchIdx = Math.round(lengthSamples * 0.55);
  const dpIdx = Math.round(lengthSamples * 0.70);

  // Rising edge: smooth-step accelerated
  for (let i = 0; i <= peakIdx; i++) {
    const t = i / Math.max(1, peakIdx);
    out[i] = t * t * (3 - 2 * t);
  }

  // Decay to notch (gentle)
  for (let i = peakIdx + 1; i <= notchIdx; i++) {
    const t = (i - peakIdx) / Math.max(1, notchIdx - peakIdx);
    out[i] = 1 - t * (1 - dicroticDepth);
  }

  // Notch -> diastolic peak (small bump)
  const peakValAtNotch = dicroticDepth;
  for (let i = notchIdx + 1; i <= dpIdx; i++) {
    const t = (i - notchIdx) / Math.max(1, dpIdx - notchIdx);
    const bump = Math.sin(t * Math.PI) * 0.18;
    out[i] = peakValAtNotch + bump;
  }

  // Diastolic peak -> 0
  for (let i = dpIdx + 1; i < lengthSamples; i++) {
    const t = (i - dpIdx) / Math.max(1, lengthSamples - dpIdx);
    out[i] = (peakValAtNotch + 0.18) * (1 - t);
  }

  return out;
}

/**
 * Generate a deterministic PPG waveform over `durationSec` seconds.
 * Returns the raw signal (continuous, baseline+AC+optional modulations).
 */
export function generateSyntheticPPG(opts: SyntheticPPGOptions): Float64Array {
  const sr = opts.sampleRate;
  const total = Math.round(opts.durationSec * sr);
  const out = new Float64Array(total);

  const baseline = opts.baseline ?? 100;
  const amplitude = opts.amplitude ?? 5;
  const dicroticDepth = opts.dicroticDepth ?? 0.35;
  const meanRRsec = 60 / opts.bpm;
  const respBpm = opts.respirationBpm ?? 0;
  const respDepth = opts.respirationDepth ?? 0.15;
  const hrvRmssdMs = opts.hrvRmssdMs ?? 0;
  const flickerHz = opts.ledFlickerHz ?? 0;
  const flickerAmp = opts.ledFlickerAmp ?? 0;
  const motionBurstAt = opts.motionBurstAt ?? [];
  const motionBurstAmp = opts.motionBurstAmp ?? amplitude * 4;

  // Build beat onsets with deterministic FM jitter (sinusoidal, so RR varies)
  const onsets: number[] = [];
  let cursor = 0;
  let beatIdx = 0;
  while (cursor < total) {
    onsets.push(cursor);
    // Deterministic RR jitter: sinusoidal modulation + slow drift; no Math.random
    const jitterSec = hrvRmssdMs > 0
      ? (hrvRmssdMs / 1000) * Math.sin(beatIdx * 0.7) * 0.5
      : 0;
    const respFM = respBpm > 0
      ? (respDepth * 0.05) * Math.sin(2 * Math.PI * (respBpm / 60) * (cursor / sr))
      : 0;
    const rrSec = meanRRsec + jitterSec + respFM;
    cursor += Math.round(Math.max(0.25, rrSec) * sr);
    beatIdx++;
  }

  // Render beats using cardiac pulse template (including the trailing one)
  const pad = Math.round(meanRRsec * sr);
  const augmentedOnsets = [...onsets, onsets[onsets.length - 1] + pad];
  for (let i = 0; i < augmentedOnsets.length - 1; i++) {
    const a = augmentedOnsets[i];
    const b = augmentedOnsets[i + 1];
    const len = b - a;
    if (len < 4) continue;
    const pulse = cardiacPulse(len, dicroticDepth);
    for (let k = 0; k < len && a + k < total; k++) {
      out[a + k] += pulse[k] * amplitude;
    }
  }

  // Add baseline + AM respiration + LED flicker + motion bursts
  for (let i = 0; i < total; i++) {
    let v = baseline + out[i];

    if (respBpm > 0) {
      const am = 1 + respDepth * Math.sin(2 * Math.PI * (respBpm / 60) * (i / sr));
      v = baseline + (v - baseline) * am;
      // Add baseline wandering BW too
      v += respDepth * 0.5 * Math.sin(2 * Math.PI * (respBpm / 60) * (i / sr));
    }

    if (flickerHz > 0 && flickerAmp > 0) {
      v += flickerAmp * Math.sin(2 * Math.PI * flickerHz * (i / sr));
    }

    out[i] = v;
  }

  for (const idx of motionBurstAt) {
    const start = Math.max(0, idx);
    const end = Math.min(total, idx + Math.round(sr * 0.2));
    for (let i = start; i < end; i++) {
      const t = (i - start) / Math.max(1, end - start);
      out[i] += motionBurstAmp * Math.sin(t * Math.PI * 6);
    }
  }

  return out;
}

/**
 * Build a deterministic RR series (in milliseconds).
 *  - kind 'regular': constant RR
 *  - kind 'variable': sinusoidal jitter (controlled by jitterMs)
 *  - kind 'bigeminy': alternating short-long (short = baseRR*0.7, long = baseRR*1.3)
 *  - kind 'ectopic': inserts premature beats every `every` beats
 */
export function generateSyntheticRR(
  count: number,
  baseBpm: number,
  kind: 'regular' | 'variable' | 'bigeminy' | 'ectopic' = 'regular',
  options: { jitterMs?: number; every?: number; prematureRatio?: number } = {}
): number[] {
  const baseRR = 60000 / baseBpm;
  const jitter = options.jitterMs ?? 30;
  const every = options.every ?? 4;
  const prematureRatio = options.prematureRatio ?? 0.55;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let rr: number;
    switch (kind) {
      case 'regular':
        rr = baseRR;
        break;
      case 'variable':
        rr = baseRR + jitter * Math.sin(i * 0.6);
        break;
      case 'bigeminy':
        rr = i % 2 === 0 ? baseRR * 0.7 : baseRR * 1.3;
        break;
      case 'ectopic':
        rr = (i % every === every - 1)
          ? baseRR * prematureRatio
          : baseRR + (i % 2 === 0 ? 8 : -8);
        break;
    }
    out.push(rr);
  }
  return out;
}

/**
 * Build a synthetic ImageData of (w x h) with red-dominant content
 * (simulates fingertip on flash). Optionally adds pulsatility by
 * modulating the red channel intensity over a single frame index.
 *
 * NOTE: returns a Uint8ClampedArray-backed object compatible with
 * the standard ImageData shape; safe to feed into AdaptiveROIMask.
 */
export function generateSyntheticImageData(
  width: number,
  height: number,
  opts: { redMean?: number; greenMean?: number; blueMean?: number; pulseDelta?: number; frameIdx?: number; pulseHz?: number; sampleRate?: number; jitter?: number } = {}
): ImageData {
  const redMean = opts.redMean ?? 180;
  const greenMean = opts.greenMean ?? 80;
  const blueMean = opts.blueMean ?? 60;
  const pulseDelta = opts.pulseDelta ?? 0;
  const frameIdx = opts.frameIdx ?? 0;
  const pulseHz = opts.pulseHz ?? 1.2;
  const sr = opts.sampleRate ?? 30;
  const jitter = opts.jitter ?? 0;

  const data = new Uint8ClampedArray(width * height * 4);
  const phaseOffset = pulseDelta * Math.sin(2 * Math.PI * pulseHz * (frameIdx / sr));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Spatial uniformity with mild center bias for a more realistic fingertip
      const cx = (x - width / 2) / (width / 2);
      const cy = (y - height / 2) / (height / 2);
      const r2 = cx * cx + cy * cy;
      const centerBoost = Math.max(0, 1 - r2) * 8;
      const det = jitter !== 0 ? jitter * Math.sin((x + y) * 0.13) : 0;

      data[i] = Math.max(0, Math.min(255, redMean + centerBoost + phaseOffset + det));
      data[i + 1] = Math.max(0, Math.min(255, greenMean + det * 0.3));
      data[i + 2] = Math.max(0, Math.min(255, blueMean + det * 0.2));
      data[i + 3] = 255;
    }
  }

  // Construct via plain object to avoid happy-dom ImageData ctor edge cases.
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

/**
 * Quick helper: derive expected BPM from peak indices in a signal.
 */
export function bpmFromPeaks(peakIndices: number[], sampleRate: number): number {
  if (peakIndices.length < 2) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < peakIndices.length; i++) {
    intervals.push((peakIndices[i] - peakIndices[i - 1]) / sampleRate);
  }
  const meanSec = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return 60 / meanSec;
}
