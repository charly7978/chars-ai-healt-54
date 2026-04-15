/**
 * HEARTBEAT PROCESSOR V2 — LAYERED ARCHITECTURE
 */
import { RingBuffer } from './signal-processing/RingBuffer';
import type {
  BeatCandidate, AcceptedBeat, BeatFlags, BPMHypothesis,
  HeartBeatResult, HeartBeatDebug
} from '../types/beat';

export class HeartBeatProcessor {
  private signalBuf = new RingBuffer(360);
  private derivBuf = new RingBuffer(360);
  private slopeSum = new RingBuffer(360);
  private timestampBuf = new RingBuffer(360);

  private rrIntervals: number[] = [];
  private readonly MAX_RR = 40;
  private acceptedBeats: AcceptedBeat[] = [];
  private readonly MAX_ACCEPTED = 60;

  private templateBuf: Float64Array = new Float64Array(30);
  private templateLen = 0;
  private templateValid = false;
  private readonly TEMPLATE_WINDOW = 25;

  private smoothBPM = 0;
  private spectralBPM = 0;
  private autocorrBPM = 0;
  private medianRRBPM = 0;
  private lastHypothesis: BPMHypothesis | null = null;

  private lastPeakTime = 0;
  private lastPeakValue = 0;
  private consecutivePeaks = 0;
  private frameCount = 0;
  private peakThreshold = 4.0;

  private beatsAccepted = 0;
  private beatsRejected = 0;
  private doublePeakCount = 0;
  private missedBeatCount = 0;
  private suspiciousCount = 0;
  private lastRejectionReason = '';

  private audioContext: AudioContext | null = null;
  private audioUnlocked = false;
  private lastBeepTime = 0;

  private upstreamSQI = 50;
  private motionPenalty = 0;
  private clipPenalty = 0;
  private pressurePenalty = 0;
  private contactStable = true;
  private sourceSwitchRecent = false;

  constructor() {
    this.setupAudio();
  }

  processSignal(
    filteredValue: number,
    timestamp?: number,
    upstreamContext?: {
      rawValue?: number;
      quality?: number;
      contactState?: string;
      motionArtifact?: boolean;
      pressureState?: string;
      clipHigh?: number;
      clipLow?: number;
      activeSource?: string;
      perfusionIndex?: number;
      positionDrifting?: boolean;
    }
  ): HeartBeatResult {
    this.frameCount++;
    const now = timestamp ?? performance.now();

    if (upstreamContext) {
      this.upstreamSQI = upstreamContext.quality ?? 50;
      this.motionPenalty = upstreamContext.motionArtifact ? 0.3 : 0;
      this.clipPenalty = Math.min(1, (upstreamContext.clipHigh ?? 0) + (upstreamContext.clipLow ?? 0)) * 0.5;
      this.pressurePenalty = upstreamContext.pressureState === 'HIGH_PRESSURE' ? 0.4 :
        upstreamContext.pressureState === 'LOW_PRESSURE' ? 0.15 : 0;
      this.contactStable = upstreamContext.contactState === 'STABLE_CONTACT';
      this.sourceSwitchRecent = false;
    }

    this.signalBuf.push(filteredValue);
    this.timestampBuf.push(now);

    const deriv = this.computeDerivative();
    this.derivBuf.push(deriv);

    const ssf = this.computeSlopeSum();
    this.slopeSum.push(ssf);

    if (this.signalBuf.length < 25) {
      return this.makeEmptyResult(0);
    }

    const range = this.getSignalRange(60);
    if (range < 0.4) {
      return this.makeEmptyResult(0);
    }

    const { normalizedValue, normRange } = this.normalizeSignal(filteredValue);
    this.updatePeriodicityEstimates();
    this.updateThreshold(normRange);

    const timeSinceLastPeak = this.lastPeakTime > 0 ? now - this.lastPeakTime : 1e9;
    const expectedRR = this.getExpectedRR();
    const refractoryState = this.getRefractoryState(timeSinceLastPeak, expectedRR);

    let candidate: BeatCandidate | null = null;
    if (refractoryState !== 'hard') {
      candidate = this.detectCandidate(now, timeSinceLastPeak, expectedRR, normRange);
    }

    let isPeak = false;
    let currentBeatSQI = 0;
    let currentFlags: BeatFlags | null = null;
    let rejectionReason = '';

    if (candidate) {
      this.adjudicate(candidate, timeSinceLastPeak, expectedRR, refractoryState);

      if (candidate.status === 'accepted') {
        isPeak = true;

        if (this.lastPeakTime > 0 && timeSinceLastPeak >= 280 && timeSinceLastPeak <= 2200) {
          this.rrIntervals.push(timeSinceLastPeak);
          if (this.rrIntervals.length > this.MAX_RR) this.rrIntervals.shift();

          const instantBPM = 60000 / timeSinceLastPeak;
          if (expectedRR > 0 && timeSinceLastPeak > expectedRR * 1.7) {
            this.handleMissedBeat(timeSinceLastPeak, expectedRR, now);
          }
          this.updateSmoothBPM(instantBPM);
          this.consecutivePeaks++;
        }

        this.lastPeakTime = now;
        this.lastPeakValue = candidate.amplitude;

        currentBeatSQI = this.computeBeatSQI(candidate);
        currentFlags = this.computeFlags(candidate, timeSinceLastPeak, expectedRR);

        const accepted: AcceptedBeat = {
          timestamp: now,
          ibiMs: timeSinceLastPeak,
          instantBpm: timeSinceLastPeak > 0 ? 60000 / timeSinceLastPeak : 0,
          beatSQI: currentBeatSQI,
          morphologyScore: candidate.morphologyScore,
          rhythmScore: candidate.rhythmScore,
          detectorAgreementScore: candidate.detectorAgreement,
          templateScore: candidate.templateCorrelation,
          sourceConsistencyScore: this.sourceSwitchRecent ? 0.3 : 1.0,
          flags: currentFlags,
        };

        this.acceptedBeats.push(accepted);
        if (this.acceptedBeats.length > this.MAX_ACCEPTED) this.acceptedBeats.shift();
        this.beatsAccepted++;

        if (currentBeatSQI > 50) {
          this.updateTemplate();
        }

        this.vibrate();
        this.playBeep();
      } else {
        rejectionReason = candidate.rejectionReason;
        this.lastRejectionReason = rejectionReason;
        this.beatsRejected++;
      }
    }

    if (!isPeak && this.lastPeakTime > 0 && timeSinceLastPeak > 2200) {
      this.consecutivePeaks = Math.max(0, this.consecutivePeaks - 1);
    }

    const hypothesis = this.fuseBPM();
    this.lastHypothesis = hypothesis;
    const bpmConfidence = this.computeBPMConfidence(hypothesis);
    const globalSQI = this.computeGlobalSQI();

    const debug: HeartBeatDebug = {
      instantBpm: isPeak && timeSinceLastPeak > 0 ? 60000 / timeSinceLastPeak : 0,
      medianRRBpm: this.medianRRBPM,
      autocorrBpm: this.autocorrBPM,
      spectralBpm: this.spectralBPM,
      lastBeatSQI: currentBeatSQI,
      detectorAgreement: candidate?.detectorAgreement ?? 0,
      expectedRR,
      refractoryState,
      beatsAccepted: this.beatsAccepted,
      beatsRejected: this.beatsRejected,
      lastRejectionReason: this.lastRejectionReason,
      doublePeakCount: this.doublePeakCount,
      missedBeatCount: this.missedBeatCount,
      suspiciousCount: this.suspiciousCount,
      templateCorrelation: candidate?.templateCorrelation ?? 0,
      morphologyScore: candidate?.morphologyScore ?? 0,
      consecutivePeaks: this.consecutivePeaks,
      recentAcceptedBeats: this.acceptedBeats.slice(-12).map((beat) => ({
        ibiMs: beat.ibiMs,
        beatSQI: beat.beatSQI,
        morphologyScore: beat.morphologyScore,
        detectorAgreement: beat.detectorAgreementScore,
        amplitude: undefined,
        flags: beat.flags,
      })),
    };

    return {
      bpm: hypothesis.finalBpm,
      bpmConfidence,
      isPeak,
      filteredValue: normalizedValue,
      arrhythmiaCount: 0,
      sqi: globalSQI,
      beatSQI: currentBeatSQI,
      rrData: {
        intervals: this.rrIntervals.slice(-10),
        lastPeakTime: this.lastPeakTime || null,
      },
      hypothesis,
      detectorAgreement: candidate?.detectorAgreement ?? 0,
      rejectionReason,
      beatFlags: currentFlags,
      debug,
    };
  }

  private detectCandidate(now: number, timeSinceLast: number, expectedRR: number, normRange: number): BeatCandidate | null {
    const n = this.signalBuf.length;
    const dn = this.derivBuf.length;
    if (n < 15 || dn < 8) return null;

    const windowLen = this.consecutivePeaks < 4 ? 90 : 150;
    const normalized = this.normalizeWindow(11, windowLen);
    const ci = 5;
    const center = normalized[ci];

    const isLocalMax =
      center >= normalized[ci - 1] && center > normalized[ci + 1] &&
      center >= normalized[ci - 2] && center >= normalized[ci + 2];

    const neighborhoodMin = Math.min(...normalized);
    const prominence = center - neighborhoodMin;
    const risingSlope = center - normalized[ci - 3];
    const fallingSlope = center - normalized[ci + 3];

    const halfProm = neighborhoodMin + prominence / 2;
    let widthSamples = 0;
    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i] >= halfProm) widthSamples++;
    }
    const widthMs = (widthSamples / Math.max(1, this.estimateSampleRate())) * 1000;

    const det1Hit = isLocalMax && prominence > 1.8 && risingSlope > 0.6;

    const d = new Float64Array(8);
    for (let i = 0; i < 8; i++) d[i] = this.derivBuf.get(dn - 8 + i);

    const zeroCrossing =
      (d[4] > 0 && d[5] <= 0) || (d[5] > 0 && d[6] <= 0) || (d[3] > 0 && d[4] <= 0);

    const ssn = this.slopeSum.length;
    const ssfRecent = ssn > 3 ? this.slopeSum.get(ssn - 3) : 0;
    const ssfPeak = ssfRecent > 1.0;

    const det2Hit = zeroCrossing && (ssfPeak || risingSlope > 1.0);

    const detectorHits = (det1Hit ? 1 : 0) + (det2Hit ? 1 : 0);
    if (detectorHits === 0) return null;

    const detectorAgreement = detectorHits / 2;
    const templateCorrelation = this.templateValid ? this.correlateWithTemplate() : 0;
    const nearExpected = expectedRR > 0 &&
      timeSinceLast >= expectedRR * 0.55 && timeSinceLast <= expectedRR * 1.45;

    const prominenceScore = clamp(prominence / 8, 0, 1) * 30;
    const slopeScore = clamp(risingSlope / 4, 0, 1) * 15 + clamp(fallingSlope / 3, 0, 1) * 10;
    const widthScore = (widthMs > 80 && widthMs < 500) ? 10 : 0;
    const asymmetry = risingSlope > 0 ? fallingSlope / risingSlope : 0;
    const asymmetryScore = (asymmetry > 0.3 && asymmetry < 2.0) ? 8 : 0;
    const morphologyScore = clamp(prominenceScore + slopeScore + widthScore + asymmetryScore, 0, 100);

    let rhythmScore = 0;
    if (nearExpected) rhythmScore += 40;
    if (this.autocorrBPM > 0) rhythmScore += 15;
    if (this.consecutivePeaks >= 3) rhythmScore += 15;
    rhythmScore = clamp(rhythmScore, 0, 100);

    const totalScore = morphologyScore * 0.45 + rhythmScore * 0.25 +
      detectorAgreement * 30 + templateCorrelation * 15 +
      (this.contactStable ? 5 : 0);

    return {
      timestamp: now,
      sampleIndex: this.frameCount,
      amplitude: center,
      prominence,
      widthMs,
      upSlope: risingSlope,
      downSlope: fallingSlope,
      localBaseline: neighborhoodMin,
      detectorHits,
      detectorAgreement,
      zeroCrossingSupport: zeroCrossing,
      periodicitySupport: nearExpected,
      templateCorrelation,
      localBandPowerRatio: clamp(normRange / 5, 0, 1),
      localPerfusion: 0,
      localMotionPenalty: this.motionPenalty,
      localPressurePenalty: this.pressurePenalty,
      localClipPenalty: this.clipPenalty,
      status: 'pending',
      rejectionReason: '',
      morphologyScore,
      rhythmScore,
      totalScore,
    };
  }

  private adjudicate(c: BeatCandidate, timeSinceLast: number, expectedRR: number, refractoryState: 'hard' | 'soft' | 'open'): void {
    if (c.prominence < 1.5) {
      c.status = 'rejected'; c.rejectionReason = 'low_prominence'; return;
    }
    if (c.widthMs < 40 || c.widthMs > 800) {
      c.status = 'rejected'; c.rejectionReason = 'abnormal_width'; return;
    }
    if (c.localClipPenalty > 0.6) {
      c.status = 'rejected'; c.rejectionReason = 'high_clipping'; return;
    }
    if (!this.contactStable && c.detectorHits < 2) {
      c.status = 'rejected'; c.rejectionReason = 'unstable_contact_single_detector'; return;
    }
    if (c.upSlope < 0.4) {
      c.status = 'rejected'; c.rejectionReason = 'no_rising_edge'; return;
    }
    if (c.downSlope < 0.2) {
      c.status = 'rejected'; c.rejectionReason = 'no_falling_edge'; return;
    }
    if (this.consecutivePeaks === 0 && c.detectorAgreement < 0.5 && !c.periodicitySupport) {
      c.status = 'rejected'; c.rejectionReason = 'first_peak_weak_support'; return;
    }
    if (refractoryState === 'soft') {
      if (c.morphologyScore < 65 || c.detectorAgreement < 1.0) {
        c.status = 'rejected'; c.rejectionReason = 'double_peak_suspect';
        this.doublePeakCount++;
        return;
      }
    }
    if (this.lastPeakValue > 0) {
      const ampRatio = Math.abs(c.amplitude) / Math.max(1, Math.abs(this.lastPeakValue));
      if (ampRatio < 0.06 || ampRatio > 12) {
        c.status = 'rejected'; c.rejectionReason = 'amplitude_inconsistent'; return;
      }
    }

    const minScore = this.consecutivePeaks < 3 ? 28 : 35;
    const thresholdMet = c.amplitude > this.peakThreshold * (c.periodicitySupport ? 0.6 : 0.85) ||
      c.prominence > Math.max(1.8, this.peakThreshold * 0.5);

    if (c.totalScore < minScore && !thresholdMet) {
      c.status = 'rejected'; c.rejectionReason = 'low_total_score'; return;
    }
    if (c.detectorAgreement >= 1.0 && c.morphologyScore > 40 && thresholdMet) {
      c.status = 'accepted'; return;
    }
    if (c.detectorHits >= 1 && c.totalScore >= minScore && thresholdMet) {
      if (c.templateCorrelation > 0.5 || c.periodicitySupport || c.morphologyScore > 55) {
        c.status = 'accepted'; return;
      }
    }
    if (c.totalScore > 55) {
      c.status = 'accepted'; return;
    }
    c.status = 'rejected';
    c.rejectionReason = 'insufficient_overall_support';
  }

  private getRefractoryState(timeSinceLast: number, expectedRR: number): 'hard' | 'soft' | 'open' {
    const hardLimit = 280;
    if (timeSinceLast < hardLimit) return 'hard';
    if (expectedRR > 0) {
      const softLimit = expectedRR * 0.55;
      if (timeSinceLast < softLimit) return 'soft';
    } else if (timeSinceLast < 380) {
      return 'soft';
    }
    return 'open';
  }

  private getExpectedRR(): number {
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-8);
      const sorted = [...recent].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }
    if (this.autocorrBPM > 0) return 60000 / this.autocorrBPM;
    if (this.spectralBPM > 0) return 60000 / this.spectralBPM;
    return 0;
  }

  private handleMissedBeat(longRR: number, expectedRR: number, now: number): void {
    if (expectedRR <= 0) return;
    const ratio = longRR / expectedRR;
    if (ratio >= 1.7 && ratio <= 2.5) {
      const halfRR = longRR / 2;
      if (halfRR >= 300 && halfRR <= 1800) {
        if (this.rrIntervals.length > 0) {
          this.rrIntervals[this.rrIntervals.length - 1] = halfRR;
          this.rrIntervals.push(halfRR);
          if (this.rrIntervals.length > this.MAX_RR) this.rrIntervals.shift();
        }
        this.missedBeatCount++;
      }
    }
  }

  private updateTemplate(): void {
    const n = this.signalBuf.length;
    if (n < this.TEMPLATE_WINDOW * 2) return;
    const half = Math.floor(this.TEMPLATE_WINDOW / 2);
    const start = n - half - 5;
    if (start < 0) return;

    const segment = new Float64Array(this.TEMPLATE_WINDOW);
    for (let i = 0; i < this.TEMPLATE_WINDOW; i++) {
      segment[i] = this.signalBuf.get(start + i);
    }

    let min = Infinity, max = -Infinity;
    for (let i = 0; i < segment.length; i++) {
      if (segment[i] < min) min = segment[i];
      if (segment[i] > max) max = segment[i];
    }
    const range = max - min;
    if (range < 0.1) return;
    for (let i = 0; i < segment.length; i++) segment[i] = (segment[i] - min) / range;

    if (!this.templateValid) {
      this.templateBuf = segment;
      this.templateLen = this.TEMPLATE_WINDOW;
      this.templateValid = true;
    } else {
      const alpha = 0.15;
      for (let i = 0; i < Math.min(this.templateLen, segment.length); i++) {
        this.templateBuf[i] = this.templateBuf[i] * (1 - alpha) + segment[i] * alpha;
      }
    }
  }

  private correlateWithTemplate(): number {
    if (!this.templateValid || this.signalBuf.length < this.TEMPLATE_WINDOW * 2) return 0;
    const n = this.signalBuf.length;
    const half = Math.floor(this.TEMPLATE_WINDOW / 2);
    const start = n - half - 5;
    if (start < 0) return 0;

    const seg = new Float64Array(this.TEMPLATE_WINDOW);
    for (let i = 0; i < this.TEMPLATE_WINDOW; i++) seg[i] = this.signalBuf.get(start + i);

    let sMin = Infinity, sMax = -Infinity;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] < sMin) sMin = seg[i];
      if (seg[i] > sMax) sMax = seg[i];
    }
    const sRange = sMax - sMin;
    if (sRange < 0.1) return 0;
    for (let i = 0; i < seg.length; i++) seg[i] = (seg[i] - sMin) / sRange;

    let dot = 0, magA = 0, magB = 0;
    const len = Math.min(this.templateLen, seg.length);
    for (let i = 0; i < len; i++) {
      dot += this.templateBuf[i] * seg[i];
      magA += this.templateBuf[i] ** 2;
      magB += seg[i] ** 2;
    }
    const denom = Math.sqrt(magA * magB);
    return denom > 0 ? dot / denom : 0;
  }

  private fuseBPM(): BPMHypothesis {
    const fromLastIBI = this.rrIntervals.length > 0 ? 60000 / this.rrIntervals[this.rrIntervals.length - 1] : 0;
    const fromMedianIBI = this.computeMedianRRBPM();
    this.medianRRBPM = fromMedianIBI;
    const fromTrimmedIBI = this.computeTrimmedMeanBPM();
    const fromAutocorrelation = this.estimateAutocorrBPM();
    this.autocorrBPM = fromAutocorrelation;
    const fromSpectral = this.spectralBPM;

    const hasEnoughPeaks = this.consecutivePeaks >= 3;
    const peakDomainReliable = hasEnoughPeaks && this.getAvgBeatSQI() > 35;

    let finalBpm: number;
    let dominantSource: 'peak' | 'spectral' | 'autocorr' | 'median';
    let confidence: number;

    if (peakDomainReliable && fromMedianIBI > 0) {
      const peakBpm = fromTrimmedIBI > 0 ? fromTrimmedIBI : fromMedianIBI;
      finalBpm = fromAutocorrelation > 0 && Math.abs(peakBpm - fromAutocorrelation) < peakBpm * 0.2
        ? peakBpm * 0.8 + fromAutocorrelation * 0.2
        : peakBpm;
      dominantSource = 'median';
      confidence = clamp(0.5 + this.consecutivePeaks * 0.06 + this.getAvgBeatSQI() * 0.003, 0, 1);
    } else if (fromAutocorrelation > 0) {
      finalBpm = fromMedianIBI > 0 ? fromMedianIBI * 0.5 + fromAutocorrelation * 0.5 : fromAutocorrelation;
      dominantSource = 'autocorr';
      confidence = clamp(0.2 + this.consecutivePeaks * 0.04, 0, 0.7);
    } else if (fromMedianIBI > 0) {
      finalBpm = fromMedianIBI;
      dominantSource = 'median';
      confidence = clamp(0.15 + this.consecutivePeaks * 0.05, 0, 0.6);
    } else {
      finalBpm = 0;
      dominantSource = 'peak';
      confidence = 0;
    }

    if (finalBpm > 0) {
      if (this.smoothBPM === 0) this.smoothBPM = finalBpm;
      else {
        const diff = Math.abs(finalBpm - this.smoothBPM) / Math.max(1, this.smoothBPM);
        const alpha = diff > 0.25 ? 0.08 : diff > 0.12 ? 0.18 : 0.28;
        this.smoothBPM = this.smoothBPM * (1 - alpha) + finalBpm * alpha;
      }
    }

    return { fromLastIBI, fromMedianIBI, fromTrimmedIBI, fromAutocorrelation, fromSpectral, finalBpm: this.smoothBPM, confidence, dominantSource };
  }

  private computeMedianRRBPM(): number {
    if (this.rrIntervals.length < 2) return 0;
    const recent = this.rrIntervals.slice(-10);
    const sorted = [...recent].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median > 0 ? 60000 / median : 0;
  }

  private computeTrimmedMeanBPM(): number {
    if (this.rrIntervals.length < 4) return 0;
    const recent = this.rrIntervals.slice(-12);
    const sorted = [...recent].sort((a, b) => a - b);
    const trimN = Math.max(1, Math.floor(sorted.length * 0.2));
    const trimmed = sorted.slice(trimN, sorted.length - trimN);
    if (trimmed.length === 0) return 0;
    const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    return mean > 0 ? 60000 / mean : 0;
  }

  private estimateAutocorrBPM(): number {
    if (this.signalBuf.length < 80) return 0;
    const sr = this.estimateSampleRate();
    const n = Math.min(180, this.signalBuf.length);
    const minLag = Math.max(5, Math.round((sr * 60) / 200));
    const maxLag = Math.min(n - 10, Math.round((sr * 60) / 38));

    let bestLag = 0, bestScore = 0;
    const expectedRR = this.getExpectedRR();
    const expectedLag = expectedRR > 0 ? Math.round((expectedRR / 1000) * sr) : 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      const ac = this.signalBuf.autocorrelation(lag, n);
      const rhythmBias = expectedLag > 0 ? 1 - Math.min(0.15, Math.abs(lag - expectedLag) / Math.max(1, expectedLag) * 0.1) : 1;
      const weighted = ac * rhythmBias;
      if (weighted > bestScore) {
        bestScore = weighted;
        bestLag = lag;
      }
    }

    if (bestLag === 0 || bestScore < 0.2) return 0;
    return (60 * sr) / bestLag;
  }

  private updateSmoothBPM(instantBPM: number): void {
    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
      return;
    }
    const relativeDiff = Math.abs(instantBPM - this.smoothBPM) / Math.max(1, this.smoothBPM);
    let alpha = 0.25;
    if (relativeDiff > 0.30) alpha = 0.06;
    else if (relativeDiff > 0.18) alpha = 0.12;
    if (this.consecutivePeaks < 5) alpha = Math.max(0.05, alpha - 0.06);
    this.smoothBPM = this.smoothBPM * (1 - alpha) + instantBPM * alpha;
  }

  private computeBeatSQI(c: BeatCandidate): number {
    let sqi = 0;
    sqi += Math.min(30, c.morphologyScore * 0.3);
    sqi += c.detectorAgreement * 20;
    sqi += Math.max(0, c.templateCorrelation) * 15;
    sqi += Math.min(15, c.rhythmScore * 0.15);
    sqi += c.localBandPowerRatio * 8;
    sqi += Math.min(7, this.upstreamSQI * 0.07);
    sqi += this.contactStable ? 5 : 0;
    sqi -= c.localMotionPenalty * 15;
    sqi -= c.localClipPenalty * 12;
    sqi -= c.localPressurePenalty * 10;
    if (this.sourceSwitchRecent) sqi -= 5;
    return clamp(Math.round(sqi), 0, 100);
  }

  private computeFlags(c: BeatCandidate, timeSinceLast: number, expectedRR: number): BeatFlags {
    const isPremature = expectedRR > 0 && timeSinceLast < expectedRR * 0.7;
    const isWeak = c.detectorHits < 2 && c.morphologyScore < 40;
    return {
      isWeak,
      isDoublePeak: false,
      isMissedBeatInserted: false,
      isPremature,
      isSuspicious: isPremature || isWeak || c.totalScore < 35,
    };
  }

  private computeBPMConfidence(h: BPMHypothesis): number {
    if (h.finalBpm === 0) return 0;
    const peakFactor = Math.min(1, this.consecutivePeaks / 6) * 0.25;
    const avgSQI = this.getAvgBeatSQI() / 100 * 0.20;

    let rrStability = 0;
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-8);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((a, rr) => a + (rr - mean) ** 2, 0) / recent.length;
      const cv = Math.sqrt(variance) / Math.max(1, mean);
      rrStability = clamp(1 - cv * 2, 0, 1) * 0.20;
    }

    let coherence = 0;
    const hyps = [h.fromMedianIBI, h.fromTrimmedIBI, h.fromAutocorrelation].filter(v => v > 0);
    if (hyps.length >= 2 && h.finalBpm > 0) {
      const diffs = hyps.map(v => Math.abs(v - h.finalBpm) / h.finalBpm);
      const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      coherence = clamp(1 - avgDiff * 5, 0, 1) * 0.15;
    }

    const recentBeats = this.acceptedBeats.slice(-10);
    const suspiciousRatio = recentBeats.length > 0 ? recentBeats.filter(b => b.flags.isSuspicious).length / recentBeats.length : 0;
    const suspPenalty = suspiciousRatio * 0.1;
    const contactBonus = this.contactStable ? 0.08 : 0;
    const pressureBonus = this.pressurePenalty < 0.1 ? 0.05 : 0;

    return clamp(peakFactor + avgSQI + rrStability + coherence - suspPenalty + contactBonus + pressureBonus, 0, 1);
  }

  private computeGlobalSQI(): number {
    if (this.signalBuf.length < 30) return 0;
    const range = this.getSignalRange(60);
    const rangeFactor = Math.min(1, range / 5) * 22;
    const peakFactor = Math.min(1, this.consecutivePeaks / 5) * 20;

    const dLen = Math.min(60, this.derivBuf.length);
    let derivSum = 0;
    for (let i = 0; i < dLen; i++) derivSum += Math.abs(this.derivBuf.get(this.derivBuf.length - dLen + i));
    const slopeFactor = Math.min(1, (derivSum / dLen) / 1.0) * 14;

    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const m = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const v = this.rrIntervals.reduce((a, rr) => a + (rr - m) ** 2, 0) / this.rrIntervals.length;
      const cv = Math.sqrt(v) / Math.max(1, m);
      rrFactor = Math.max(0, 1 - cv * 2) * 22;
    }

    const periodicityFactor = (this.autocorrBPM > 0 ? 0.6 : 0) * 22;
    return clamp(Math.round(rangeFactor + slopeFactor + rrFactor + peakFactor + periodicityFactor), 0, 100);
  }

  private getAvgBeatSQI(): number {
    const recent = this.acceptedBeats.slice(-8);
    if (recent.length === 0) return 0;
    return recent.reduce((s, b) => s + b.beatSQI, 0) / recent.length;
  }

  private computeDerivative(): number {
    const n = this.signalBuf.length;
    if (n < 3) return 0;
    return (this.signalBuf.get(n - 1) - this.signalBuf.get(n - 3)) * 0.5 + (this.signalBuf.get(n - 1) - this.signalBuf.get(n - 2)) * 0.5;
  }

  private computeSlopeSum(): number {
    const win = 5;
    const n = this.derivBuf.length;
    if (n < win) return 0;
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const d = this.derivBuf.get(n - win + i);
      if (d > 0) sum += d;
    }
    return sum;
  }

  private getSignalRange(windowLen: number): number {
    const n = Math.min(windowLen, this.signalBuf.length);
    if (n < 10) return 0;
    const p10 = this.signalBuf.percentile(0.1, n);
    const p90 = this.signalBuf.percentile(0.9, n);
    return p90 - p10;
  }

  private normalizeSignal(value: number): { normalizedValue: number; normRange: number } {
    const windowLen = this.consecutivePeaks < 4 ? 90 : 150;
    const n = Math.min(windowLen, this.signalBuf.length);
    if (n < 10) return { normalizedValue: 0, normRange: 0 };
    const p10 = this.signalBuf.percentile(0.1, n);
    const p90 = this.signalBuf.percentile(0.9, n);
    const range = p90 - p10;
    if (range < 0.15) return { normalizedValue: 0, normRange: 0 };
    const clipped = Math.min(p90, Math.max(p10, value));
    const normalizedValue = ((clipped - p10) / range - 0.5) * 120;
    return { normalizedValue, normRange: range };
  }

  private normalizeWindow(count: number, refWindowLen: number): Float64Array {
    const n = this.signalBuf.length;
    if (n < count) return new Float64Array(count);
    const refN = Math.min(refWindowLen, n);
    const p10 = this.signalBuf.percentile(0.1, refN);
    const p90 = this.signalBuf.percentile(0.9, refN);
    const range = p90 - p10;
    const out = new Float64Array(count);
    if (range < 0.15) return out;
    for (let i = 0; i < count; i++) {
      const v = this.signalBuf.get(n - count + i);
      const c = Math.min(p90, Math.max(p10, v));
      out[i] = ((c - p10) / range - 0.5) * 120;
    }
    return out;
  }

  private estimateSampleRate(): number {
    if (this.timestampBuf.length < 10) return 30;
    const n = Math.min(50, this.timestampBuf.length);
    const intervals: number[] = [];
    for (let i = 1; i < n; i++) {
      const d = this.timestampBuf.get(this.timestampBuf.length - n + i) - this.timestampBuf.get(this.timestampBuf.length - n + i - 1);
      if (d >= 8 && d <= 120) intervals.push(d);
    }
    if (intervals.length < 6) return 30;
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    return clamp(1000 / median, 15, 60);
  }

  private updateThreshold(range: number): void {
    const periodicSupport = this.autocorrBPM > 0;
    const base = periodicSupport ? 2.8 : 3.8;
    const target = clamp(base + range * 0.25, 2.2, 7.0);
    this.peakThreshold = this.peakThreshold * 0.82 + target * 0.18;
  }

  private updatePeriodicityEstimates(): void {
    if (this.frameCount % 60 === 0 && this.signalBuf.length >= 120) {
      this.spectralBPM = this.estimateAutocorrBPM();
    }
  }

  private vibrate(): void {
    try { if (navigator.vibrate) navigator.vibrate(55); } catch {}
  }

  private setupAudio(): void {
    const unlock = async () => {
      if (this.audioUnlocked) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AC();
        await this.audioContext.resume();
        this.audioUnlocked = true;
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  private async playBeep(): Promise<void> {
    if (!this.audioContext || !this.audioUnlocked) return;
    const now = performance.now();
    if (now - this.lastBeepTime < 220) return;
    try {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.frequency.setValueAtTime(820, t);
      osc.frequency.exponentialRampToValueAtTime(460, t + 0.08);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.12);
      this.lastBeepTime = now;
    } catch {}
  }

  getRRIntervals(): number[] { return [...this.rrIntervals]; }
  getLastPeakTime(): number { return this.lastPeakTime; }
  getSQI(): number { return this.computeGlobalSQI(); }

  private makeEmptyResult(bpm: number): HeartBeatResult {
    return {
      bpm, bpmConfidence: 0, isPeak: false,
      filteredValue: 0, arrhythmiaCount: 0, sqi: 0, beatSQI: 0,
      rrData: { intervals: [], lastPeakTime: null },
      hypothesis: null, detectorAgreement: 0,
      rejectionReason: '', beatFlags: null,
      debug: {
        instantBpm: 0, medianRRBpm: 0, autocorrBpm: 0, spectralBpm: 0,
        lastBeatSQI: 0, detectorAgreement: 0, expectedRR: 0,
        refractoryState: 'open' as const, beatsAccepted: this.beatsAccepted,
        beatsRejected: this.beatsRejected, lastRejectionReason: this.lastRejectionReason,
        doublePeakCount: this.doublePeakCount, missedBeatCount: this.missedBeatCount,
        suspiciousCount: this.suspiciousCount, templateCorrelation: 0,
        morphologyScore: 0, consecutivePeaks: this.consecutivePeaks,
        recentAcceptedBeats: [],
      },
    };
  }

  reset(): void {
    this.signalBuf.clear();
    this.derivBuf.clear();
    this.slopeSum.clear();
    this.timestampBuf.clear();
    this.rrIntervals = [];
    this.acceptedBeats = [];
    this.smoothBPM = 0;
    this.spectralBPM = 0;
    this.autocorrBPM = 0;
    this.medianRRBPM = 0;
    this.lastPeakTime = 0;
    this.lastPeakValue = 0;
    this.consecutivePeaks = 0;
    this.peakThreshold = 4.0;
    this.frameCount = 0;
    this.beatsAccepted = 0;
    this.beatsRejected = 0;
    this.doublePeakCount = 0;
    this.missedBeatCount = 0;
    this.suspiciousCount = 0;
    this.lastRejectionReason = '';
    this.templateValid = false;
    this.templateLen = 0;
    this.lastHypothesis = null;
  }

  dispose(): void {
    if (this.audioContext) this.audioContext.close().catch(() => {});
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
