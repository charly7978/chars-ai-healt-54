/**
 * EXTRACTOR DE CARACTERÍSTICAS PPG AVANZADO
 * 
 * Refactorizado con:
 * - Detección robusta de fiducial points (onset, systolic peak, dicrotic notch, diastolic peak)
 * - Validación cruzada VPG (1ª derivada) / APG (2ª derivada)
 * - Features de área (integral sistólica/diastólica) + IPA ratio
 * - Pulse width a múltiples niveles (10%, 25%, 50%, 75%)
 * - Detección de ciclos cardíacos completos
 * 
 * Referencias:
 * - Elgendi 2024 (Diagnostics) - APG ratios para BP
 * - pyPPG (PMC 2024) - 632 features estandarizados
 * - Satter et al. 2024 - Glucose estimation from PPG
 * - Arguello-Prada et al. 2025 - Cholesterol from PPG
 */

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export interface FiducialPoints {
  onset: number;       // Start of cardiac cycle (foot/valley)
  systolicPeak: number; // Systolic peak index
  dicroticNotch: number; // Dicrotic notch index (-1 if not found)
  diastolicPeak: number; // Diastolic peak index (-1 if not found)
  nextOnset: number;    // Start of next cycle
}

export interface APGFeatures {
  a: number; b: number; c: number; d: number; e: number;
  bDivA: number;
  cDivA: number;
  dDivA: number;
  eDivA: number;
  agi: number;  // Aging Index: (b - c - d - e) / a
}

export interface CycleFeatures {
  // Temporal (in ms)
  sutMs: number;         // Systolic Upstroke Time
  diastolicTimeMs: number; // Diastolic time (peak to next onset)
  pw10Ms: number;        // Pulse width at 10% amplitude
  pw25Ms: number;        // Pulse width at 25% amplitude
  pw50Ms: number;        // Pulse width at 50% amplitude
  pw75Ms: number;        // Pulse width at 75% amplitude
  dicroticNotchTimeMs: number; // Time to dicrotic notch from onset
  
  // Amplitude
  systolicAmplitude: number;
  diastolicAmplitude: number;
  dicroticDepth: number; // Normalized depth of dicrotic notch (0-1)
  
  // Area
  systolicArea: number;
  diastolicArea: number;
  areaRatio: number;    // systolicArea / diastolicArea (IPA)
  ipaRatio: number;     // Inflection Point Area ratio
  
  // Morphological
  stiffnessIndex: number;
  augmentationIndex: number;
  pwvProxy: number;
  
  // APG (second derivative)
  apg: APGFeatures;
  
  // Quality
  quality: number; // 0-1
}

// ═══════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════

export class PPGFeatureExtractor {

  // ─────────────────────────────────────────
  // CARDIAC CYCLE DETECTION
  // ─────────────────────────────────────────

  /**
   * Detect individual cardiac cycles from PPG signal
   * Uses valley detection validated with first derivative zero-crossings
   */
  static detectCardiacCycles(buffer: number[], sampleRate: number = 30): FiducialPoints[] {
    if (buffer.length < sampleRate * 2) return [];

    // 1. Find valleys (cycle onsets) using first derivative
    const vpg = this.firstDerivative(buffer);
    const valleys = this.findValleys(buffer, vpg, sampleRate);

    if (valleys.length < 2) return [];

    const cycles: FiducialPoints[] = [];

    for (let i = 0; i < valleys.length - 1; i++) {
      const onset = valleys[i];
      const nextOnset = valleys[i + 1];
      const cycleLength = nextOnset - onset;

      // Validate cycle length (350ms - 1800ms → ~33-171 BPM) to reject non-human noise
      const cycleLengthMs = (cycleLength / sampleRate) * 1000;
      if (cycleLengthMs < 350 || cycleLengthMs > 1800) continue;

      // 2. Find systolic peak within cycle
      const systolicPeak = this.findSystolicPeak(buffer, onset, nextOnset);
      if (systolicPeak <= onset) continue;

      // 3. Find dicrotic notch and diastolic peak
      const { notch, diastolicPeak } = this.findDicroticFeatures(
        buffer, vpg, systolicPeak, nextOnset
      );

      cycles.push({
        onset,
        systolicPeak,
        dicroticNotch: notch,
        diastolicPeak,
        nextOnset
      });
    }

    return cycles;
  }

  /**
   * Extract comprehensive features for a single cardiac cycle
   */
  static extractCycleFeatures(
    buffer: number[],
    fiducials: FiducialPoints,
    sampleRate: number = 30
  ): CycleFeatures | null {
    const { onset, systolicPeak, dicroticNotch, diastolicPeak, nextOnset } = fiducials;

    // Validate indices
    if (onset < 0 || nextOnset >= buffer.length || systolicPeak <= onset) return null;

    const msPerSample = 1000 / sampleRate;
    const onsetVal = buffer[onset];
    const peakVal = buffer[systolicPeak];
    const amplitude = peakVal - onsetVal;

    if (amplitude <= 0) return null;

    // ── Temporal features ──
    const sutMs = (systolicPeak - onset) * msPerSample;
    const diastolicTimeMs = (nextOnset - systolicPeak) * msPerSample;
    const dicroticNotchTimeMs = dicroticNotch >= 0 
      ? (dicroticNotch - onset) * msPerSample 
      : diastolicTimeMs * 0.6; // estimate

    // Pulse widths at multiple amplitude levels
    const pw10Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.10) * msPerSample;
    const pw25Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.25) * msPerSample;
    const pw50Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.50) * msPerSample;
    const pw75Ms = this.pulseWidthAtLevel(buffer, onset, nextOnset, onsetVal, amplitude, 0.75) * msPerSample;

    // ── Amplitude features ──
    const systolicAmplitude = amplitude;
    const diastolicAmplitude = diastolicPeak >= 0 
      ? buffer[diastolicPeak] - onsetVal 
      : amplitude * 0.5;
    
    const dicroticDepth = dicroticNotch >= 0
      ? (peakVal - buffer[dicroticNotch]) / amplitude
      : 0;

    // ── Area features (trapezoidal integration) ──
    const dividePoint = dicroticNotch >= 0 ? dicroticNotch : Math.round((systolicPeak + nextOnset) / 2);
    const systolicArea = this.trapezoidalArea(buffer, onset, dividePoint, onsetVal);
    const diastolicArea = this.trapezoidalArea(buffer, dividePoint, nextOnset, onsetVal);
    const areaRatio = diastolicArea > 0 ? systolicArea / diastolicArea : 0;
    const ipaRatio = areaRatio; // IPA = systolic/diastolic area

    // ── Stiffness Index ──
    // SI = body_height / ΔTDVP (time between systolic and diastolic peaks)
    // Without height, use inverse of the time delay as proxy
    let stiffnessIndex = 0;
    if (diastolicPeak >= 0 && diastolicPeak > systolicPeak) {
      const deltaT = (diastolicPeak - systolicPeak) * msPerSample;
      stiffnessIndex = deltaT > 0 ? 1000 / deltaT : 0;
    }

    // ── Augmentation Index ──
    let augmentationIndex = 0;
    if (diastolicPeak >= 0) {
      const p1 = peakVal - onsetVal;
      const p2 = buffer[diastolicPeak] - onsetVal;
      augmentationIndex = p1 > 0 ? (p2 / p1) * 100 : 0;
    }

    // ── PWV proxy ──
    // From systolic upstroke slope + stiffness
    let pwvProxy = 0;
    if (sutMs > 0) {
      const slopeNorm = amplitude / (sutMs / 1000); // amplitude per second
      pwvProxy = 4.0 + slopeNorm * 0.01 + stiffnessIndex * 0.5;
    }

    // ── APG features ──
    const cycleSegment = buffer.slice(onset, nextOnset + 1);
    const apg = this.extractAPGFromSegment(cycleSegment);

    // ── Quality assessment ──
    const quality = this.assessCycleQuality(
      amplitude, sutMs, diastolicTimeMs, pw50Ms, dicroticNotch >= 0
    );

    return {
      sutMs, diastolicTimeMs,
      pw10Ms, pw25Ms, pw50Ms, pw75Ms,
      dicroticNotchTimeMs,
      systolicAmplitude, diastolicAmplitude, dicroticDepth,
      systolicArea, diastolicArea, areaRatio, ipaRatio,
      stiffnessIndex, augmentationIndex, pwvProxy,
      apg, quality
    };
  }

  // ─────────────────────────────────────────
  // FIDUCIAL POINT HELPERS
  // ─────────────────────────────────────────

  private static firstDerivative(buffer: number[]): number[] {
    const d: number[] = [0];
    for (let i = 1; i < buffer.length; i++) {
      d.push(buffer[i] - buffer[i - 1]);
    }
    return d;
  }

  private static secondDerivative(buffer: number[]): number[] {
    const d2: number[] = [0];
    for (let i = 1; i < buffer.length - 1; i++) {
      d2.push(buffer[i + 1] - 2 * buffer[i] + buffer[i - 1]);
    }
    d2.push(0);
    return d2;
  }

  /**
   * Find valleys (cycle onsets) using signal minima validated with VPG zero-crossings
   */
  private static findValleys(
    buffer: number[], vpg: number[], sampleRate: number
  ): number[] {
    const minCycleLen = Math.round(sampleRate * 0.3); // min 300ms between valleys
    const valleys: number[] = [];

    for (let i = 2; i < buffer.length - 2; i++) {
      // Local minimum in signal
      if (buffer[i] <= buffer[i - 1] && buffer[i] <= buffer[i + 1] &&
          buffer[i] <= buffer[i - 2] && buffer[i] <= buffer[i + 2]) {
        // Validate with VPG: should cross from negative to positive near valley
        const vpgCross = (i < vpg.length - 1) && (vpg[i] <= 0 && vpg[i + 1] > 0);
        const vpgNearCross = (i > 0 && i < vpg.length - 2) && 
          (vpg[i - 1] < 0 || vpg[i] < 0) && (vpg[i + 1] > 0 || vpg[i + 2] > 0);

        if (vpgCross || vpgNearCross || vpg.length === 0) {
          // Enforce minimum distance
          if (valleys.length === 0 || (i - valleys[valleys.length - 1]) >= minCycleLen) {
            valleys.push(i);
          }
        }
      }
    }

    return valleys;
  }

  private static findSystolicPeak(buffer: number[], onset: number, nextOnset: number): number {
    // Peak must be in first 60% of cycle
    const searchEnd = onset + Math.round((nextOnset - onset) * 0.6);
    let maxIdx = onset;
    let maxVal = buffer[onset];

    for (let i = onset + 1; i <= Math.min(searchEnd, buffer.length - 1); i++) {
      if (buffer[i] > maxVal) {
        maxVal = buffer[i];
        maxIdx = i;
      }
    }

    return maxIdx;
  }

  private static findDicroticFeatures(
    buffer: number[], vpg: number[], systolicPeak: number, nextOnset: number
  ): { notch: number; diastolicPeak: number } {
    // Search for dicrotic notch: local minimum after systolic peak
    const searchStart = systolicPeak + 2;
    const searchEnd = nextOnset - 1;

    if (searchStart >= searchEnd) {
      return { notch: -1, diastolicPeak: -1 };
    }

    // Find local minima in the diastolic phase
    let notchIdx = -1;
    let notchVal = Infinity;

    for (let i = searchStart + 1; i < searchEnd - 1; i++) {
      if (buffer[i] < buffer[i - 1] && buffer[i] < buffer[i + 1]) {
        if (buffer[i] < notchVal) {
          notchVal = buffer[i];
          notchIdx = i;
          break; // Take first local minimum after peak as dicrotic notch
        }
      }
    }

    // Find diastolic peak: local maximum after notch
    let diastolicPeakIdx = -1;
    if (notchIdx >= 0) {
      let dpMax = buffer[notchIdx];
      for (let i = notchIdx + 1; i < searchEnd; i++) {
        if (buffer[i] > dpMax) {
          dpMax = buffer[i];
          diastolicPeakIdx = i;
        }
      }
      // Validate: diastolic peak should be below systolic peak
      if (diastolicPeakIdx >= 0 && buffer[diastolicPeakIdx] >= buffer[systolicPeak]) {
        diastolicPeakIdx = -1;
      }
    }

    return { notch: notchIdx, diastolicPeak: diastolicPeakIdx };
  }

  // ─────────────────────────────────────────
  // FEATURE EXTRACTION HELPERS
  // ─────────────────────────────────────────

  /**
   * Pulse width at a given amplitude level (as fraction of total amplitude)
   * Returns width in samples
   */
  private static pulseWidthAtLevel(
    buffer: number[], onset: number, nextOnset: number,
    baseVal: number, amplitude: number, level: number
  ): number {
    const threshold = baseVal + amplitude * level;
    let firstCross = -1;
    let lastCross = -1;

    for (let i = onset; i <= nextOnset; i++) {
      if (buffer[i] >= threshold) {
        if (firstCross < 0) firstCross = i;
        lastCross = i;
      }
    }

    return (firstCross >= 0 && lastCross > firstCross) ? (lastCross - firstCross) : 0;
  }

  /**
   * Trapezoidal area above baseline between two indices
   */
  private static trapezoidalArea(
    buffer: number[], startIdx: number, endIdx: number, baseline: number
  ): number {
    let area = 0;
    for (let i = startIdx; i < endIdx && i < buffer.length - 1; i++) {
      const h1 = Math.max(0, buffer[i] - baseline);
      const h2 = Math.max(0, buffer[i + 1] - baseline);
      area += (h1 + h2) / 2;
    }
    return area;
  }

  /**
   * APG features from a single cycle segment
   */
  private static extractAPGFromSegment(segment: number[]): APGFeatures {
    const defaults: APGFeatures = { 
      a: 0, b: 0, c: 0, d: 0, e: 0, 
      bDivA: 0, cDivA: 0, dDivA: 0, eDivA: 0, agi: 0 
    };

    if (segment.length < 10) return defaults;

    const apg = this.secondDerivative(segment);
    if (apg.length < 8) return defaults;

    // Find peaks and valleys in APG ordered by temporal position
    const extrema: { idx: number; val: number; type: 'peak' | 'valley' }[] = [];

    for (let i = 2; i < apg.length - 2; i++) {
      if (apg[i] > apg[i - 1] && apg[i] > apg[i + 1] &&
          apg[i] > apg[i - 2] && apg[i] > apg[i + 2]) {
        extrema.push({ idx: i, val: apg[i], type: 'peak' });
      }
      if (apg[i] < apg[i - 1] && apg[i] < apg[i + 1] &&
          apg[i] < apg[i - 2] && apg[i] < apg[i + 2]) {
        extrema.push({ idx: i, val: apg[i], type: 'valley' });
      }
    }

    extrema.sort((x, y) => x.idx - y.idx);

    // APG standard: a(peak), b(valley), c(peak), d(valley), e(peak)
    const peaks = extrema.filter(e => e.type === 'peak');
    const valleys = extrema.filter(e => e.type === 'valley');

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

  /**
   * Assess quality of a single cardiac cycle
   */
  private static assessCycleQuality(
    amplitude: number,
    sutMs: number,
    diastolicTimeMs: number,
    pw50Ms: number,
    hasDicroticNotch: boolean
  ): number {
    let q = 0;

    // Amplitude — lower threshold for weak but real signals
    if (amplitude > 0.3) q += 0.15;
    if (amplitude > 1.0) q += 0.1;
    if (amplitude > 2.5) q += 0.05;

    // SUT in physiological range (wider)
    if (sutMs > 40 && sutMs < 350) q += 0.2;

    // Diastolic time
    if (diastolicTimeMs > sutMs * 0.7) q += 0.15;

    // PW50 in range (wider)
    if (pw50Ms > 80 && pw50Ms < 800) q += 0.1;

    // Dicrotic notch bonus
    if (hasDicroticNotch) q += 0.25;

    return Math.min(1, q);
  }

  // ─────────────────────────────────────────
  // LEGACY API (kept for backward compatibility)
  // ─────────────────────────────────────────

  static extractACDCRatio(buffer: number[]): { ac: number; dc: number; ratio: number } {
    if (buffer.length < 10) return { ac: 0, dc: 0, ratio: 0 };
    const recent = buffer.slice(-30);
    const dc = recent.reduce((a, b) => a + b, 0) / recent.length;
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const ac = max - min;
    const ratio = dc !== 0 ? ac / Math.abs(dc) : 0;
    return { ac, dc, ratio };
  }

  static extractRRVariability(intervals: number[]): { sdnn: number; rmssd: number; cv: number } {
    if (intervals.length < 2) return { sdnn: 0, rmssd: 0, cv: 0 };
    const valid = intervals.filter(i => i > 100 && i < 5000);
    if (valid.length < 2) return { sdnn: 0, rmssd: 0, cv: 0 };
    
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const sdnn = Math.sqrt(valid.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / valid.length);
    
    let sumSqDiff = 0;
    for (let i = 1; i < valid.length; i++) {
      sumSqDiff += Math.pow(valid[i] - valid[i - 1], 2);
    }
    const rmssd = Math.sqrt(sumSqDiff / (valid.length - 1));
    const cv = mean !== 0 ? sdnn / mean : 0;
    
    return { sdnn, rmssd, cv };
  }
}
