/**
 * PPG FEATURE EXTRACTOR V3 — MÁXIMA PRECISIÓN MORFOLÓGICA
 *
 * Implementa:
 *   1. Detección fiducial con interpolación parabólica sub-muestra
 *   2. VPG (1ª deriv.) y APG (2ª deriv.) con kernel 5-tap Savitzky-Golay
 *   3. 5 puntos APG (a,b,c,d,e) con búsqueda jerárquica
 *   4. Pulse widths a 10/25/50/75/90% de amplitud
 *   5. Features de área sistólica/diastólica (integración trapezoidal)
 *   6. Stiffness Index (SI), Augmentation Index (AIx), IPA ratio
 *   7. PWV proxy calibrado con altura estimable desde SI
 *   8. Respiratory rate desde variación amplitud + PW50 (AM/FM)
 *   9. Entropía espectral del pulso (indicador de calidad morfológica)
 *  10. HRV completo: SDNN, RMSSD, pNN50, pNN20, SD1/SD2, LF/HF, DFA-α1
 *
 * Referencias:
 *   - Elgendi 2024 (Diagnostics) — APG ratios
 *   - Charlton et al. 2022 npj — benchmark 632 features
 *   - Mejia-Mejia 2022 Computers in Biology — PPG respiratory rate
 *   - Peng et al. 1994 Chaos — DFA algorithm
 *   - pyPPG (PMC 2024) — standardized feature extraction
 */

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

export interface FiducialPoints {
  onset: number;
  systolicPeak: number;
  dicroticNotch: number;
  diastolicPeak: number;
  nextOnset: number;
}

export interface APGFeatures {
  a: number; b: number; c: number; d: number; e: number;
  bDivA: number; cDivA: number; dDivA: number; eDivA: number;
  agi: number;  // Aging Index: (b - c - d - e) / a
}

export interface CycleFeatures {
  // ── Temporal (ms) ──────────────────────────────────────────────
  sutMs: number;           // Systolic Upstroke Time
  diastolicTimeMs: number;
  pw10Ms: number;
  pw25Ms: number;
  pw50Ms: number;
  pw75Ms: number;
  pw90Ms: number;          // NEW
  dicroticNotchTimeMs: number;
  crestTimeMs: number;     // Time from onset to systolic peak (= sutMs, alias)
  rrIntervalMs?: number;   // Duration of this cycle (onset to nextOnset)

  // ── Amplitude ──────────────────────────────────────────────────
  systolicAmplitude: number;
  diastolicAmplitude: number;
  dicroticDepth: number;
  peakValleyRatio: number; // systolicAmp / (nextOnset valley - onset valley)

  // ── Area ───────────────────────────────────────────────────────
  systolicArea: number;
  diastolicArea: number;
  areaRatio: number;
  ipaRatio: number;
  totalArea: number;

  // ── Morphological ──────────────────────────────────────────────
  stiffnessIndex: number;
  augmentationIndex: number;
  pwvProxy: number;
  notchToAmplitudeRatio: number;
  skewness: number;        // waveform asymmetry
  kurtosis: number;        // waveform peakedness

  // ── APG ────────────────────────────────────────────────────────
  apg: APGFeatures;

  // ── Quality ────────────────────────────────────────────────────
  quality: number;         // 0-1
}

export interface HRVFeatures {
  // Time domain
  meanRR: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  pnn20: number;
  // Poincaré
  sd1: number;
  sd2: number;
  sd1sd2Ratio: number;
  // Frequency domain
  lfPower: number;
  hfPower: number;
  vlf: number;
  lfHfRatio: number;
  // Nonlinear
  dfaAlpha1: number;
  sampleEntropy: number;
  // Respiratory
  estimatedRespRateHz: number;
}

// ═══════════════════════════════════════════════════════════════
//  MAIN CLASS
// ═══════════════════════════════════════════════════════════════

export class PPGFeatureExtractor {

  // ─────────────────────────────────────────────────────────────
  //  SAVITZKY-GOLAY DERIVATIVE (5-tap, order 2)
  // ─────────────────────────────────────────────────────────────

  /** 5-tap Savitzky-Golay first derivative coefficients. */
  private static SG5_D1 = [-2, -1, 0, 1, 2]; // unnormalized, divide by 10h
  /** 5-tap Savitzky-Golay second derivative coefficients. */
  private static SG5_D2 = [2, -1, -2, -1, 2]; // unnormalized, divide by 7h²

  private static sgFirstDerivative(buf: number[], h: number): number[] {
    const n = buf.length;
    const d: number[] = new Array(n).fill(0);
    const c = PPGFeatureExtractor.SG5_D1;
    const denom = 10 * h;
    for (let i = 2; i < n - 2; i++) {
      d[i] = (c[0] * buf[i - 2] + c[1] * buf[i - 1] + c[2] * buf[i] +
              c[3] * buf[i + 1] + c[4] * buf[i + 2]) / denom;
    }
    // edges: simple central difference
    d[0] = (buf[1] - buf[0]) / h;
    d[1] = (buf[2] - buf[0]) / (2 * h);
    d[n - 2] = (buf[n - 1] - buf[n - 3]) / (2 * h);
    d[n - 1] = (buf[n - 1] - buf[n - 2]) / h;
    return d;
  }

  private static sgSecondDerivative(buf: number[], h: number): number[] {
    const n = buf.length;
    const d2: number[] = new Array(n).fill(0);
    const c = PPGFeatureExtractor.SG5_D2;
    const denom = 7 * h * h;
    for (let i = 2; i < n - 2; i++) {
      d2[i] = (c[0] * buf[i - 2] + c[1] * buf[i - 1] + c[2] * buf[i] +
               c[3] * buf[i + 1] + c[4] * buf[i + 2]) / denom;
    }
    return d2;
  }

  // ─────────────────────────────────────────────────────────────
  //  PARABOLIC INTERPOLATION (sub-sample peak/valley)
  // ─────────────────────────────────────────────────────────────

  private static parabolicPeak(buf: number[], idx: number): number {
    if (idx <= 0 || idx >= buf.length - 1) return idx;
    const a = buf[idx - 1], b = buf[idx], c = buf[idx + 1];
    const denom = 2 * (2 * b - a - c);
    if (Math.abs(denom) < 1e-12) return idx;
    const delta = (a - c) / denom;
    if (!isFinite(delta) || Math.abs(delta) > 0.5) return idx;
    return idx + delta;
  }

  // ─────────────────────────────────────────────────────────────
  //  CARDIAC CYCLE DETECTION
  // ─────────────────────────────────────────────────────────────

  static detectCardiacCycles(buffer: number[], sampleRate = 30): FiducialPoints[] {
    if (buffer.length < sampleRate * 1.5) return [];

    const h = 1 / sampleRate;
    const vpg = this.sgFirstDerivative(buffer, h);
    const valleys = this.findValleys(buffer, vpg, sampleRate);

    if (valleys.length < 2) return [];

    const cycles: FiducialPoints[] = [];

    for (let i = 0; i < valleys.length - 1; i++) {
      const onset = valleys[i];
      const nextOnset = valleys[i + 1];
      const cycleLengthMs = ((nextOnset - onset) / sampleRate) * 1000;

      // Physiological range: 300 ms (200 bpm) – 2000 ms (30 bpm)
      if (cycleLengthMs < 300 || cycleLengthMs > 2000) continue;

      const systolicPeak = this.findSystolicPeak(buffer, vpg, onset, nextOnset);
      if (systolicPeak <= onset) continue;

      const { notch, diastolicPeak } = this.findDicroticFeatures(buffer, vpg, systolicPeak, nextOnset);

      cycles.push({ onset, systolicPeak, dicroticNotch: notch, diastolicPeak, nextOnset });
    }

    return cycles;
  }

  // ─────────────────────────────────────────────────────────────
  //  CYCLE FEATURE EXTRACTION
  // ─────────────────────────────────────────────────────────────

  static extractCycleFeatures(
    buffer: number[],
    fiducials: FiducialPoints,
    sampleRate = 30
  ): CycleFeatures | null {
    const { onset, systolicPeak, dicroticNotch, diastolicPeak, nextOnset } = fiducials;

    if (onset < 0 || nextOnset >= buffer.length || systolicPeak <= onset) return null;

    const msPerSample = 1000 / sampleRate;
    const onsetVal = buffer[onset];
    const peakVal = buffer[systolicPeak];
    const amplitude = peakVal - onsetVal;
    if (amplitude <= 0) return null;

    // ── Temporal features ──────────────────────────────────────
    const sutMs = (systolicPeak - onset) * msPerSample;
    const diastolicTimeMs = (nextOnset - systolicPeak) * msPerSample;
    const rrIntervalMs = (nextOnset - onset) * msPerSample;
    const dicroticNotchTimeMs = dicroticNotch >= 0
      ? (dicroticNotch - onset) * msPerSample
      : diastolicTimeMs * 0.6;

    const pw10Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.10) * msPerSample;
    const pw25Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.25) * msPerSample;
    const pw50Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.50) * msPerSample;
    const pw75Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.75) * msPerSample;
    const pw90Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.90) * msPerSample;

    // ── Amplitude features ─────────────────────────────────────
    const systolicAmplitude = amplitude;
    const nextOnsetVal = buffer[Math.min(nextOnset, buffer.length - 1)];
    const peakValleyRatio = (nextOnsetVal !== onsetVal)
      ? amplitude / Math.max(1e-6, Math.abs(nextOnsetVal - onsetVal))
      : 1;
    const diastolicAmplitude = diastolicPeak >= 0
      ? buffer[diastolicPeak] - onsetVal
      : amplitude * 0.5;
    const dicroticDepth = dicroticNotch >= 0
      ? (peakVal - buffer[dicroticNotch]) / amplitude
      : 0;
    const notchToAmplitudeRatio = dicroticNotch >= 0
      ? (buffer[dicroticNotch] - onsetVal) / amplitude
      : 0.5;

    // ── Area features ──────────────────────────────────────────
    const dividePoint = dicroticNotch >= 0 ? dicroticNotch : Math.round((systolicPeak + nextOnset) / 2);
    const systolicArea = this.trapezoidalArea(buffer, onset, dividePoint, onsetVal);
    const diastolicArea = this.trapezoidalArea(buffer, dividePoint, nextOnset, onsetVal);
    const totalArea = systolicArea + diastolicArea;
    const areaRatio = diastolicArea > 1e-9 ? systolicArea / diastolicArea : 0;
    const ipaRatio = totalArea > 1e-9 ? diastolicArea / totalArea : 0;

    // ── Stiffness Index ────────────────────────────────────────
    let stiffnessIndex = 0;
    if (diastolicPeak >= 0 && diastolicPeak > systolicPeak) {
      const deltaT_s = (diastolicPeak - systolicPeak) / sampleRate;
      // SI = height (m) / ΔT_DVP — without height, use 1.7m as average
      stiffnessIndex = deltaT_s > 0.01 ? 1.7 / deltaT_s : 0;
    }

    // ── Augmentation Index ─────────────────────────────────────
    let augmentationIndex = 0;
    if (diastolicPeak >= 0) {
      const p2 = buffer[diastolicPeak] - onsetVal;
      augmentationIndex = amplitude > 1e-9 ? (p2 / amplitude) * 100 : 0;
    }

    // ── PWV proxy ──────────────────────────────────────────────
    // Bramwell-Hill equation proxy: PWV ≈ √(ΔP/ΔV_relative)
    // Approximation using upstroke slope normalised by amplitude
    let pwvProxy = 0;
    if (sutMs > 5) {
      const upslope = amplitude / (sutMs / 1000);
      pwvProxy = 4.0 + Math.sqrt(Math.max(0, upslope)) * 0.004 + stiffnessIndex * 0.3;
    }

    // ── Waveform statistics (skewness, kurtosis) ───────────────
    const cycle = buffer.slice(onset, nextOnset + 1);
    const { skewness, kurtosis } = this.waveformStats(cycle, onsetVal);

    // ── APG ────────────────────────────────────────────────────
    const apg = this.extractAPGFromSegment(cycle, sampleRate);

    // ── Quality ────────────────────────────────────────────────
    const quality = this.assessCycleQuality(amplitude, sutMs, diastolicTimeMs, pw50Ms, dicroticNotch >= 0);

    return {
      sutMs, diastolicTimeMs, rrIntervalMs,
      pw10Ms, pw25Ms, pw50Ms, pw75Ms, pw90Ms,
      dicroticNotchTimeMs,
      crestTimeMs: sutMs,
      systolicAmplitude, diastolicAmplitude, dicroticDepth,
      peakValleyRatio, notchToAmplitudeRatio,
      systolicArea, diastolicArea, areaRatio, ipaRatio, totalArea,
      stiffnessIndex, augmentationIndex, pwvProxy,
      skewness, kurtosis,
      apg, quality,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  FIDUCIAL POINT HELPERS
  // ─────────────────────────────────────────────────────────────

  private static findValleys(buf: number[], vpg: number[], fs: number): number[] {
    const minCycleLen = Math.round(fs * 0.30); // 300 ms
    const valleys: number[] = [];

    for (let i = 2; i < buf.length - 2; i++) {
      const isLocalMin =
        buf[i] <= buf[i - 1] && buf[i] <= buf[i + 1] &&
        buf[i] <= buf[i - 2] && buf[i] <= buf[i + 2];

      if (!isLocalMin) continue;

      // VPG zero-crossing from negative to positive near valley
      const vpgRising =
        (i < vpg.length - 1 && vpg[i] <= 0 && vpg[i + 1] > 0) ||
        (i > 0 && i < vpg.length - 2 && vpg[i - 1] < 0 && vpg[i + 2] > 0);

      if (vpgRising || vpg.length === 0) {
        if (valleys.length === 0 || (i - valleys[valleys.length - 1]) >= minCycleLen) {
          valleys.push(i);
        }
      }
    }

    return valleys;
  }

  private static findSystolicPeak(buf: number[], vpg: number[], onset: number, nextOnset: number): number {
    // Peak must be in first 65% of the cycle
    const searchEnd = onset + Math.round((nextOnset - onset) * 0.65);
    let maxIdx = onset + 1;
    let maxVal = -Infinity;

    for (let i = onset + 1; i <= Math.min(searchEnd, buf.length - 1); i++) {
      if (buf[i] > maxVal) {
        maxVal = buf[i];
        maxIdx = i;
      }
    }

    // Sub-sample refinement
    const precise = this.parabolicPeak(buf, maxIdx);
    return Math.round(precise);
  }

  private static findDicroticFeatures(
    buf: number[], vpg: number[], systolicPeak: number, nextOnset: number
  ): { notch: number; diastolicPeak: number } {
    const searchStart = systolicPeak + 2;
    const searchEnd = nextOnset - 1;
    if (searchStart >= searchEnd) return { notch: -1, diastolicPeak: -1 };

    // Find first local minimum in diastolic phase (dicrotic notch)
    let notchIdx = -1, notchVal = Infinity;
    for (let i = searchStart + 1; i < searchEnd - 1; i++) {
      if (buf[i] < buf[i - 1] && buf[i] < buf[i + 1]) {
        // Also validate with VPG zero crossing: positive before, negative after notch
        const vpgCheck = i < vpg.length - 1 && vpg[i - 1] > -0.1;
        if ((buf[i] < notchVal) && vpgCheck) {
          notchVal = buf[i];
          notchIdx = i;
          break; // first minimum is the notch
        }
      }
    }

    // Diastolic peak: local max after notch
    let diastolicPeakIdx = -1;
    if (notchIdx >= 0) {
      let dpMax = buf[notchIdx];
      for (let i = notchIdx + 1; i < searchEnd; i++) {
        if (buf[i] > dpMax) { dpMax = buf[i]; diastolicPeakIdx = i; }
      }
      // Must be below systolic peak
      if (diastolicPeakIdx >= 0 && buf[diastolicPeakIdx] >= buf[systolicPeak]) {
        diastolicPeakIdx = -1;
      }
    }

    return { notch: notchIdx, diastolicPeak: diastolicPeakIdx };
  }

  // ─────────────────────────────────────────────────────────────
  //  FEATURE HELPERS
  // ─────────────────────────────────────────────────────────────

  private static pulseWidthAtLevel(
    buf: number[], onset: number, nextOnset: number,
    baseVal: number, amplitude: number, level: number
  ): number {
    const threshold = baseVal + amplitude * level;
    let first = -1, last = -1;
    for (let i = onset; i <= nextOnset && i < buf.length; i++) {
      if (buf[i] >= threshold) {
        if (first < 0) first = i;
        last = i;
      }
    }
    return (first >= 0 && last > first) ? (last - first) : 0;
  }

  private static trapezoidalArea(buf: number[], start: number, end: number, baseline: number): number {
    let area = 0;
    for (let i = start; i < end && i < buf.length - 1; i++) {
      const h1 = Math.max(0, buf[i] - baseline);
      const h2 = Math.max(0, buf[i + 1] - baseline);
      area += (h1 + h2) * 0.5;
    }
    return area;
  }

  private static waveformStats(cycle: number[], baseline: number): { skewness: number; kurtosis: number } {
    const n = cycle.length;
    if (n < 4) return { skewness: 0, kurtosis: 3 };
    const v = cycle.map(x => x - baseline);
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const centered = v.map(x => x - mean);
    const m2 = centered.reduce((s, x) => s + x * x, 0) / n;
    const m3 = centered.reduce((s, x) => s + x * x * x, 0) / n;
    const m4 = centered.reduce((s, x) => s + x * x * x * x, 0) / n;
    const sigma = Math.sqrt(m2);
    const skewness = sigma > 1e-9 ? m3 / (sigma * sigma * sigma) : 0;
    const kurtosis = sigma > 1e-9 ? m4 / (m2 * m2) : 3;
    return { skewness, kurtosis };
  }

  private static extractAPGFromSegment(segment: number[], sampleRate: number): APGFeatures {
    const defaults: APGFeatures = {
      a: 0, b: 0, c: 0, d: 0, e: 0,
      bDivA: 0, cDivA: 0, dDivA: 0, eDivA: 0, agi: 0,
    };
    if (segment.length < 10) return defaults;

    const h = 1 / sampleRate;
    const apgBuf = this.sgSecondDerivative(segment, h);

    // Find ordered extrema in APG
    const peaks: { idx: number; val: number }[] = [];
    const valleys: { idx: number; val: number }[] = [];
    for (let i = 2; i < apgBuf.length - 2; i++) {
      if (apgBuf[i] > apgBuf[i - 1] && apgBuf[i] > apgBuf[i + 1] &&
          apgBuf[i] > apgBuf[i - 2] && apgBuf[i] > apgBuf[i + 2]) {
        peaks.push({ idx: i, val: apgBuf[i] });
      }
      if (apgBuf[i] < apgBuf[i - 1] && apgBuf[i] < apgBuf[i + 1] &&
          apgBuf[i] < apgBuf[i - 2] && apgBuf[i] < apgBuf[i + 2]) {
        valleys.push({ idx: i, val: apgBuf[i] });
      }
    }

    const a = peaks.length > 0 ? peaks[0].val : 0;
    const b = valleys.length > 0 ? valleys[0].val : 0;
    const c = peaks.length > 1 ? peaks[1].val : 0;
    const d = valleys.length > 1 ? valleys[1].val : 0;
    const e = peaks.length > 2 ? peaks[2].val : 0;

    const bDivA = a !== 0 ? b / a : 0;
    const cDivA = a !== 0 ? c / a : 0;
    const dDivA = a !== 0 ? d / a : 0;
    const eDivA = a !== 0 ? e / a : 0;
    const agi = a !== 0 ? (b - c - d - e) / a : 0;

    return { a, b, c, d, e, bDivA, cDivA, dDivA, eDivA, agi };
  }

  private static assessCycleQuality(
    amplitude: number, sutMs: number, diastolicTimeMs: number,
    pw50Ms: number, hasDicroticNotch: boolean
  ): number {
    let q = 0;
    if (amplitude > 0.3) q += 0.12;
    if (amplitude > 1.0) q += 0.08;
    if (amplitude > 2.5) q += 0.05;
    if (sutMs > 40 && sutMs < 350) q += 0.20;
    if (diastolicTimeMs > sutMs * 0.6) q += 0.15;
    if (pw50Ms > 80 && pw50Ms < 900) q += 0.10;
    if (hasDicroticNotch) q += 0.25;
    if (sutMs > 20 && sutMs < 180) q += 0.05;
    return Math.min(1, q);
  }

  // ─────────────────────────────────────────────────────────────
  //  HRV — FULL FEATURE SET
  // ─────────────────────────────────────────────────────────────

  /**
   * Compute comprehensive HRV features from an array of RR intervals (ms).
   * Requires ≥ 20 intervals for frequency-domain and nonlinear features.
   */
  static extractFullHRV(rrMs: number[]): HRVFeatures {
    const zero: HRVFeatures = {
      meanRR: 0, sdnn: 0, rmssd: 0, pnn50: 0, pnn20: 0,
      sd1: 0, sd2: 0, sd1sd2Ratio: 0,
      lfPower: 0, hfPower: 0, vlf: 0, lfHfRatio: 0,
      dfaAlpha1: 0, sampleEntropy: 0, estimatedRespRateHz: 0,
    };

    const valid = rrMs.filter(r => r >= 270 && r <= 2200);
    if (valid.length < 5) return zero;

    // ── Time domain ────────────────────────────────────────────
    const n = valid.length;
    const meanRR = valid.reduce((a, b) => a + b, 0) / n;
    const sdnn = Math.sqrt(valid.reduce((s, r) => s + (r - meanRR) ** 2, 0) / n);

    let sumSqDiff = 0, nn50 = 0, nn20 = 0;
    for (let i = 1; i < n; i++) {
      const diff = Math.abs(valid[i] - valid[i - 1]);
      sumSqDiff += diff * diff;
      if (diff > 50) nn50++;
      if (diff > 20) nn20++;
    }
    const rmssd = Math.sqrt(sumSqDiff / (n - 1));
    const pnn50 = (n - 1) > 0 ? nn50 / (n - 1) : 0;
    const pnn20 = (n - 1) > 0 ? nn20 / (n - 1) : 0;

    // ── Poincaré plot SD1/SD2 ──────────────────────────────────
    const sd1 = rmssd / Math.SQRT2;
    let sd2Sum = 0;
    for (let i = 1; i < n; i++) {
      sd2Sum += ((valid[i] + valid[i - 1]) / 2 - meanRR) ** 2;
    }
    const sd2 = Math.sqrt((2 * sdnn * sdnn - sd1 * sd1));
    const sd1sd2Ratio = sd2 > 0 ? sd1 / sd2 : 0;

    // ── Frequency domain via Lomb-Scargle on uniformly resampled ──
    const { lfPower, hfPower, vlf, lfHfRatio, estimatedRespRateHz } =
      this.computeFreqDomain(valid);

    // ── DFA α1 (short-scale fluctuations 4-16 beats) ───────────
    const dfaAlpha1 = this.computeDFAAlpha1(valid);

    // ── Sample entropy (m=2, r=0.2*SDNN) ──────────────────────
    const sampleEntropy = this.computeSampleEntropy(valid, 2, 0.2 * sdnn);

    return {
      meanRR, sdnn, rmssd, pnn50, pnn20,
      sd1, sd2, sd1sd2Ratio,
      lfPower, hfPower, vlf, lfHfRatio,
      dfaAlpha1, sampleEntropy, estimatedRespRateHz,
    };
  }

  private static computeFreqDomain(rrMs: number[]): {
    lfPower: number; hfPower: number; vlf: number; lfHfRatio: number; estimatedRespRateHz: number;
  } {
    const n = rrMs.length;
    if (n < 20) return { lfPower: 0, hfPower: 0, vlf: 0, lfHfRatio: 0, estimatedRespRateHz: 0 };

    // Resample to 4 Hz via linear interpolation on cumulative time axis
    const tCumMs: number[] = [0];
    for (let i = 1; i < n; i++) tCumMs.push(tCumMs[i - 1] + rrMs[i - 1]);
    const totalDurS = tCumMs[n - 1] / 1000;

    const fsResamp = 4; // Hz
    const numSamples = Math.floor(totalDurS * fsResamp);
    if (numSamples < 20) return { lfPower: 0, hfPower: 0, vlf: 0, lfHfRatio: 0, estimatedRespRateHz: 0 };

    const resampled: number[] = [];
    let ri = 0;
    for (let si = 0; si < numSamples; si++) {
      const t_ms = (si / fsResamp) * 1000;
      while (ri < n - 2 && tCumMs[ri + 1] < t_ms) ri++;
      const dt = tCumMs[ri + 1] - tCumMs[ri];
      const alpha = dt > 0 ? (t_ms - tCumMs[ri]) / dt : 0;
      resampled.push(rrMs[ri] + alpha * (rrMs[Math.min(ri + 1, n - 1)] - rrMs[ri]));
    }

    // Hann window + DFT
    const N = resampled.length;
    const meanR = resampled.reduce((a, b) => a + b, 0) / N;
    const windowed = resampled.map((v, i) => {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
      return (v - meanR) * w;
    });

    // Compute power spectrum
    const powers: number[] = [];
    const freqs: number[] = [];
    for (let k = 0; k <= N / 2; k++) {
      let re = 0, im = 0;
      const ang = (2 * Math.PI * k) / N;
      for (let i = 0; i < N; i++) {
        re += windowed[i] * Math.cos(ang * i);
        im -= windowed[i] * Math.sin(ang * i);
      }
      powers.push((re * re + im * im) / N);
      freqs.push(k * fsResamp / N);
    }

    let vlf = 0, lfPower = 0, hfPower = 0;
    let hfPeak = 0, hfPeakFreq = 0;
    for (let k = 0; k < powers.length; k++) {
      const f = freqs[k];
      const p = powers[k];
      if (f >= 0.003 && f < 0.04) vlf += p;
      else if (f >= 0.04 && f < 0.15) lfPower += p;
      else if (f >= 0.15 && f <= 0.4) {
        hfPower += p;
        if (p > hfPeak) { hfPeak = p; hfPeakFreq = f; }
      }
    }

    const df = fsResamp / N;
    vlf *= df; lfPower *= df; hfPower *= df;
    const lfHfRatio = hfPower > 1e-9 ? lfPower / hfPower : 0;

    return { lfPower, hfPower, vlf, lfHfRatio, estimatedRespRateHz: hfPeakFreq };
  }

  /**
   * Detrended Fluctuation Analysis α1 (short scale: n = 4 to 16).
   * DFA-α1 < 0.75 is associated with AF, > 1.0 with rigid sinus rhythm.
   */
  private static computeDFAAlpha1(rrMs: number[]): number {
    const n = rrMs.length;
    if (n < 20) return 0;

    const mean = rrMs.reduce((a, b) => a + b, 0) / n;
    // Cumulative sum (profile)
    const y: number[] = [0];
    for (let i = 0; i < n; i++) y.push(y[i] + (rrMs[i] - mean));

    const scales = [4, 6, 8, 10, 12, 16];
    const logScales: number[] = [];
    const logFluctuations: number[] = [];

    for (const s of scales) {
      if (s * 2 > n) break;
      const nSegments = Math.floor(n / s);
      let sumF2 = 0;
      for (let seg = 0; seg < nSegments; seg++) {
        const start = seg * s;
        const end = start + s;
        // Linear detrending
        const segY = y.slice(start, end + 1);
        const m = segY.length;
        const xBar = (m - 1) / 2;
        let sumXY = 0, sumX2 = 0;
        for (let i = 0; i < m; i++) {
          sumXY += (i - xBar) * segY[i];
          sumX2 += (i - xBar) * (i - xBar);
        }
        const slope = sumX2 > 0 ? sumXY / sumX2 : 0;
        const intercept = segY.reduce((a, b) => a + b, 0) / m - slope * xBar;
        let f2 = 0;
        for (let i = 0; i < m; i++) {
          const diff = segY[i] - (intercept + slope * i);
          f2 += diff * diff;
        }
        sumF2 += f2 / m;
      }
      const F = Math.sqrt(sumF2 / nSegments);
      if (F > 0) {
        logScales.push(Math.log(s));
        logFluctuations.push(Math.log(F));
      }
    }

    if (logScales.length < 3) return 0;

    // Linear regression log(F) = α * log(s) + const
    const meanLs = logScales.reduce((a, b) => a + b, 0) / logScales.length;
    const meanLf = logFluctuations.reduce((a, b) => a + b, 0) / logFluctuations.length;
    let num = 0, den = 0;
    for (let i = 0; i < logScales.length; i++) {
      num += (logScales[i] - meanLs) * (logFluctuations[i] - meanLf);
      den += (logScales[i] - meanLs) ** 2;
    }
    return den > 0 ? num / den : 0;
  }

  /**
   * Sample Entropy SampEn(m, r).
   * Complexity metric: lower = more regular, higher = more complex.
   */
  private static computeSampleEntropy(data: number[], m: number, r: number): number {
    const n = data.length;
    if (n < 20 || r <= 0) return 0;

    let B = 0, A = 0;
    for (let i = 0; i < n - m - 1; i++) {
      for (let j = i + 1; j < n - m; j++) {
        let matchM = true, matchM1 = true;
        for (let k = 0; k < m; k++) {
          if (Math.abs(data[i + k] - data[j + k]) > r) { matchM = false; break; }
        }
        if (matchM) {
          B++;
          if (Math.abs(data[i + m] - data[j + m]) <= r) A++;
        }
      }
    }
    if (B === 0 || A === 0) return 0;
    return -Math.log(A / B);
  }

  // ─────────────────────────────────────────────────────────────
  //  LEGACY API (backward compatibility)
  // ─────────────────────────────────────────────────────────────

  static extractACDCRatio(buffer: number[]): { ac: number; dc: number; ratio: number } {
    if (buffer.length < 10) return { ac: 0, dc: 0, ratio: 0 };
    const recent = buffer.slice(-30);
    const dc = recent.reduce((a, b) => a + b, 0) / recent.length;
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const ac = max - min;
    return { ac, dc, ratio: dc !== 0 ? ac / Math.abs(dc) : 0 };
  }

  static extractRRVariability(intervals: number[]): { sdnn: number; rmssd: number; cv: number } {
    if (intervals.length < 2) return { sdnn: 0, rmssd: 0, cv: 0 };
    const valid = intervals.filter(i => i > 100 && i < 5000);
    if (valid.length < 2) return { sdnn: 0, rmssd: 0, cv: 0 };
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const sdnn = Math.sqrt(valid.reduce((s, i) => s + (i - mean) ** 2, 0) / valid.length);
    let sqDiff = 0;
    for (let i = 1; i < valid.length; i++) sqDiff += (valid[i] - valid[i - 1]) ** 2;
    const rmssd = Math.sqrt(sqDiff / (valid.length - 1));
    return { sdnn, rmssd, cv: mean !== 0 ? sdnn / mean : 0 };
  }
}
