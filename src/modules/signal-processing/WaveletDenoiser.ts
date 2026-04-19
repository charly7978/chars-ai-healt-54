/**
 * WAVELET DENOISER — HAAR + DONOHO SOFT-THRESHOLD
 *
 * Lifting-based Haar wavelet (orthogonal, perfectly invertible) with
 * Donoho's universal soft-threshold per detail level. Used by Phase-3
 * morphology windows; NOT in the fast HR loop.
 *
 * Why Haar over db4 in this codebase:
 *   - The lifting scheme is bit-exact reversible — easy to unit-test.
 *   - Detail coefficients localize the systolic upstroke better
 *     (no smearing across bands).
 *   - O(N) per level with a single loop, perfect for short windows.
 *
 * Reference:
 *   Donoho (1995) "De-noising by soft-thresholding", IEEE TIT.
 *   Sweldens (1996) "The lifting scheme: a custom-design construction
 *   of biorthogonal wavelets", ACHA.
 */

/** Soft-threshold operator. */
function softThreshold(arr: number[], lambda: number): number[] {
  return arr.map(v => {
    const s = Math.sign(v);
    const a = Math.abs(v);
    return a > lambda ? s * (a - lambda) : 0;
  });
}

/** Median absolute deviation (MAD) — robust noise std estimator. */
function mad(arr: number[]): number {
  if (arr.length === 0) return 0;
  const med = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const m = med(arr);
  const dev = arr.map(v => Math.abs(v - m));
  return med(dev) / 0.6745;
}

/**
 * Single-level Haar lifting:
 *   d[i] = (x[2i+1] − x[2i]) / sqrt(2)        (high-pass / detail)
 *   a[i] = (x[2i] + x[2i+1]) / sqrt(2)        (low-pass / approx)
 * Returns { approx, detail } each of length N/2 (input length must be even).
 */
function haarStep(x: number[]): { approx: number[]; detail: number[] } {
  const half = x.length >> 1;
  const a: number[] = new Array(half);
  const d: number[] = new Array(half);
  const sq2 = Math.SQRT2;
  for (let i = 0; i < half; i++) {
    const x0 = x[2 * i];
    const x1 = x[2 * i + 1];
    a[i] = (x0 + x1) / sq2;
    d[i] = (x1 - x0) / sq2;
  }
  return { approx: a, detail: d };
}

/** Inverse single-level Haar. */
function inverseHaarStep(a: number[], d: number[]): number[] {
  const N = a.length * 2;
  const out: number[] = new Array(N);
  const sq2 = Math.SQRT2;
  for (let i = 0; i < a.length; i++) {
    const aval = a[i] / sq2;
    const dval = d[i] / sq2;
    out[2 * i] = aval - dval;
    out[2 * i + 1] = aval + dval;
  }
  return out;
}

/**
 * Single-shot denoiser. `levels` = how many DWT decomposition levels
 * (default 4). Input length is internally padded with zeros to the next
 * multiple of 2^levels; padded tail is dropped before returning.
 */
export function waveletDenoise(input: number[] | Float64Array, levels = 4): number[] {
  const inArr = Array.from(input);
  if (inArr.length === 0) return [];
  const padTo = 1 << levels;
  const N = Math.ceil(inArr.length / padTo) * padTo;
  const x: number[] = new Array(N).fill(0);
  for (let i = 0; i < inArr.length; i++) x[i] = inArr[i];

  // Forward DWT
  let approx: number[] = x;
  const details: number[][] = [];
  for (let l = 0; l < levels; l++) {
    if (approx.length < 2) break;
    const r = haarStep(approx);
    details.push(r.detail);
    approx = r.approx;
  }

  // Donoho universal threshold from finest detail. We add a 1.4× safety
  // factor empirically tuned for the smartphone-PPG noise profile (mostly
  // photon shot + AGC drift, which is more energetic than IID Gaussian).
  const finest = details[0] ?? [];
  const sigma = mad(finest);
  const lambdaBase = 1.4 * sigma * Math.sqrt(2 * Math.log(Math.max(2, N)));

  // Threshold per level — softer at deeper levels (cardiac fundamental
  // lives at deep levels; we don't want to attenuate it).
  for (let l = 0; l < details.length; l++) {
    const factor = 1 / Math.SQRT2 ** l;
    details[l] = softThreshold(details[l], lambdaBase * factor);
  }

  // Inverse DWT
  for (let l = details.length - 1; l >= 0; l--) {
    approx = inverseHaarStep(approx, details[l]);
  }

  return approx.slice(0, inArr.length);
}
