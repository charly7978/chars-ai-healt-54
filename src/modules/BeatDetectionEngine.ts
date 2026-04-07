/**
 * BEAT DETECTION ENGINE — Doble detector con consenso obligatorio.
 *
 * Detector A: Picos sobre derivada con umbral adaptativo + validación morfológica
 * Detector B: Multi-scale peak detection (MSPTD-inspired)
 *
 * Un latido solo se acepta si ambos detectores concuerdan dentro de tolerancia temporal,
 * el RR es fisiológicamente plausible, y no hay artefactos.
 */
import { PPG_CONFIG } from '../config/ppgConfig';
import type { DetectedBeat, BeatDetectionResult } from '../types/ppg-types';

const B = PPG_CONFIG.beats;
const PUB = PPG_CONFIG.publication;

export class BeatDetectionEngine {
  // Buffers
  private signalBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  private derivBuffer: number[] = [];
  private readonly BUFFER_SIZE = 360;

  // State
  private lastAcceptedBeatTime = 0;
  private rrIntervals: number[] = [];
  private readonly MAX_RR = 40;
  private smoothBPM = 0;
  private consecutiveValidBeats = 0;
  private windowId = 0;

  // Detector A state
  private peakThresholdA = 5.0;
  private lastPeakValueA = 0;

  // Detector B state (multi-scale)
  private lastDetectorBTime = 0;

  // Audio
  private audioCtx: AudioContext | null = null;
  private audioUnlocked = false;
  private lastBeepTime = 0;

  // Publication
  private warmupStartTime = 0;
  private bpmPublished = false;
  private lastPublishedBPM = 0;
  private lastBPMUpdateTime = 0;
  private bpmStale = false;

  // Beat history for export
  private beatHistory: DetectedBeat[] = [];
  private readonly MAX_BEAT_HISTORY = 500;

  constructor() {
    this.setupAudio();
  }

  /**
   * Process one sample. Returns detection result.
   */
  process(
    filteredValue: number,
    timestamp: number,
    qualityScore: number,
    motionScore: number,
  ): BeatDetectionResult {
    this.signalBuffer.push(filteredValue);
    this.timestampBuffer.push(timestamp);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
      this.timestampBuffer.shift();
    }

    const deriv = this.computeDerivative();
    this.derivBuffer.push(deriv);
    if (this.derivBuffer.length > this.BUFFER_SIZE) this.derivBuffer.shift();

    if (this.warmupStartTime === 0) this.warmupStartTime = timestamp;

    if (this.signalBuffer.length < 25) {
      return this.noDetection();
    }

    const timeSinceLastBeat = this.lastAcceptedBeatTime > 0
      ? timestamp - this.lastAcceptedBeatTime
      : Number.MAX_SAFE_INTEGER;

    // Refractory period
    if (timeSinceLastBeat < B.refractoryMs) {
      return this.noDetection();
    }

    // --- DETECTOR A: derivative zero-crossing + morphology ---
    const detA = this.detectorA(timeSinceLastBeat);

    // --- DETECTOR B: multi-scale peak ---
    const detB = this.detectorB(timestamp, timeSinceLastBeat);

    // --- CONSENSUS ---
    let isPeak = false;
    let agreementScore = 0;

    if (detA.detected && detB.detected) {
      // Both agree — strong detection
      const timeDiff = Math.abs(detA.peakTime - detB.peakTime);
      if (timeDiff <= B.detectorAgreementToleranceMs) {
        agreementScore = 1.0 - (timeDiff / B.detectorAgreementToleranceMs) * 0.5;
        isPeak = true;
      } else {
        agreementScore = 0.3;
        // Disagree — only accept if quality is very high
        if (qualityScore > PPG_CONFIG.quality.goodThreshold) {
          isPeak = true;
          agreementScore = 0.5;
        }
      }
    } else if (detA.detected || detB.detected) {
      // Only one detector — accept only if strong signal + expected timing
      agreementScore = 0.3;
      const expectedRR = this.getExpectedRR();
      if (expectedRR > 0 && timeSinceLastBeat >= expectedRR * 0.6 && timeSinceLastBeat <= expectedRR * 1.5) {
        if (qualityScore >= PPG_CONFIG.quality.moderateThreshold) {
          isPeak = true;
          agreementScore = 0.4;
        }
      }
    }

    // Validate RR physiologically
    if (isPeak && this.lastAcceptedBeatTime > 0) {
      const rr = timestamp - this.lastAcceptedBeatTime;
      if (rr < B.minPhysiologicalRR || rr > B.maxPhysiologicalRR) {
        isPeak = false;
        agreementScore = 0;
      }
      // Check max change ratio
      if (isPeak && this.rrIntervals.length >= 2) {
        const lastRR = this.rrIntervals[this.rrIntervals.length - 1];
        const change = Math.abs(rr - lastRR) / Math.max(1, lastRR);
        if (change > B.maxRRChangeRatio) {
          // Suspicious — reduce agreement
          agreementScore *= 0.6;
          if (agreementScore < PUB.detectorAgreementMin) {
            isPeak = false;
          }
        }
      }
    }

    // Motion artifact check
    if (isPeak && motionScore > PPG_CONFIG.motion.highThreshold) {
      isPeak = false;
      agreementScore = 0;
    }

    // Accept beat
    let beat: DetectedBeat | undefined;
    if (isPeak) {
      const rr = this.lastAcceptedBeatTime > 0 ? timestamp - this.lastAcceptedBeatTime : undefined;

      if (rr !== undefined) {
        this.rrIntervals.push(rr);
        if (this.rrIntervals.length > this.MAX_RR) this.rrIntervals.shift();
      }

      this.lastAcceptedBeatTime = timestamp;
      this.consecutiveValidBeats++;
      this.windowId++;

      beat = {
        timestamp,
        confidence: agreementScore,
        sourceWindowId: this.windowId,
        localQuality: qualityScore / 100,
        detectorAgreementScore: agreementScore,
        detectorASource: detA.detected,
        detectorBSource: detB.detected,
        rrInterval: rr,
        amplitude: filteredValue,
      };

      this.beatHistory.push(beat);
      if (this.beatHistory.length > this.MAX_BEAT_HISTORY) this.beatHistory.shift();

      // Update BPM
      this.updateBPM(rr, timestamp);

      // Audio/haptic
      this.playBeep();
      this.vibrate();
    }

    // Handle stale BPM
    if (this.bpmPublished && timestamp - this.lastBPMUpdateTime > PUB.staleTimeoutMs) {
      this.bpmStale = true;
    }
    if (this.bpmPublished && timestamp - this.lastBPMUpdateTime > PUB.withdrawTimeoutMs) {
      this.smoothBPM = 0;
      this.bpmPublished = false;
      this.bpmStale = false;
      this.consecutiveValidBeats = 0;
    }

    // Decay consecutive beats if no beat for too long
    if (!isPeak && timeSinceLastBeat > B.maxPeakIntervalMs) {
      this.consecutiveValidBeats = Math.max(0, this.consecutiveValidBeats - 1);
    }

    return {
      isPeak,
      beat,
      bpm: this.getPublishableBPM(qualityScore, timestamp),
      bpmConfidence: this.getBPMConfidence(),
      rrIntervals: [...this.rrIntervals],
      consecutiveValidBeats: this.consecutiveValidBeats,
    };
  }

  // --- DETECTOR A ---
  private detectorA(timeSinceLastBeat: number): { detected: boolean; peakTime: number; score: number } {
    const n = this.signalBuffer.length;
    const dn = this.derivBuffer.length;
    if (n < 11 || dn < 6) return { detected: false, peakTime: 0, score: 0 };

    const deriv = this.derivBuffer.slice(-6);
    const zeroCrossing = (deriv[2] > 0 && deriv[3] <= 0) || (deriv[3] > 0 && deriv[4] <= 0);

    const windowLen = this.consecutiveValidBeats < 3 ? 90 : 150;
    const { normalizedValue: center, range } = this.normalizeValue(
      this.signalBuffer[n - 6], windowLen
    );

    const recentNorm = this.signalBuffer.slice(-11).map(v => {
      const { normalizedValue: nv } = this.normalizeValue(v, windowLen);
      return nv;
    });

    const ci = 5;
    const neighborhoodMin = Math.min(...recentNorm);
    const prominence = recentNorm[ci] - neighborhoodMin;
    const isLocalMax = recentNorm[ci] >= recentNorm[ci - 1] && recentNorm[ci] > recentNorm[ci + 1]
      && recentNorm[ci] >= recentNorm[ci - 2] && recentNorm[ci] >= recentNorm[ci + 2];
    const risingSlope = recentNorm[ci] - recentNorm[ci - 3];
    const fallingSlope = recentNorm[ci] - recentNorm[ci + 3];

    let score = 0;
    score += Math.min(30, prominence * 2);
    score += Math.min(10, risingSlope * 1.5);
    score += Math.min(10, fallingSlope * 1.2);
    if (zeroCrossing) score += 15;

    const expectedRR = this.getExpectedRR();
    const nearExpected = expectedRR > 0 &&
      timeSinceLastBeat >= expectedRR * 0.5 && timeSinceLastBeat <= expectedRR * 1.5;
    if (nearExpected) score += 20;

    const minScore = this.consecutiveValidBeats < 2 ? B.minCandidateScore : B.minConfirmedCandidateScore;
    const thresholdCheck = recentNorm[ci] > this.peakThresholdA * (nearExpected ? 0.7 : 1.0)
      || prominence > Math.max(B.minProminence, this.peakThresholdA * 0.6);

    // Update threshold
    const targetT = clamp(3.0 + range * 0.3, 2.5, 7.5);
    this.peakThresholdA = this.peakThresholdA * 0.8 + targetT * 0.2;

    const detected = isLocalMax && score >= minScore && thresholdCheck
      && timeSinceLastBeat >= B.minPeakIntervalMs;

    if (detected) this.lastPeakValueA = recentNorm[ci];

    return { detected, peakTime: this.timestampBuffer[n - 6] ?? Date.now(), score };
  }

  // --- DETECTOR B: Multi-scale ---
  private detectorB(timestamp: number, timeSinceLastBeat: number): { detected: boolean; peakTime: number } {
    if (this.signalBuffer.length < 30) return { detected: false, peakTime: 0 };

    // Check at multiple scales (windows of 15, 25, 40 samples)
    const scales = [15, 25, 40];
    let votes = 0;
    let bestPeakTime = 0;

    for (const scale of scales) {
      if (this.signalBuffer.length < scale + 5) continue;
      const window = this.signalBuffer.slice(-scale - 5);
      const ts = this.timestampBuffer.slice(-scale - 5);

      // Find local maximum in center region
      const center = Math.floor(window.length / 2);
      const searchRadius = Math.floor(scale / 4);
      let maxVal = -Infinity;
      let maxIdx = center;

      for (let i = center - searchRadius; i <= center + searchRadius; i++) {
        if (i >= 0 && i < window.length && window[i] > maxVal) {
          maxVal = window[i];
          maxIdx = i;
        }
      }

      // Verify it's a true local max (not just highest in window)
      if (maxIdx > 1 && maxIdx < window.length - 2) {
        const isMax = window[maxIdx] >= window[maxIdx - 1] && window[maxIdx] >= window[maxIdx + 1]
          && window[maxIdx] > window[maxIdx - 2] && window[maxIdx] > window[maxIdx + 2];
        if (isMax) {
          const localRange = Math.max(...window) - Math.min(...window);
          const prominence = window[maxIdx] - Math.min(...window.slice(Math.max(0, maxIdx - searchRadius), maxIdx + searchRadius + 1));
          if (prominence > localRange * 0.15) {
            votes++;
            bestPeakTime = ts[maxIdx] ?? timestamp;
          }
        }
      }
    }

    // Need majority of scales to agree
    const detected = votes >= 2 && timeSinceLastBeat >= B.minPeakIntervalMs;
    if (detected) this.lastDetectorBTime = timestamp;

    return { detected, peakTime: bestPeakTime };
  }

  private normalizeValue(value: number, windowLen: number): { normalizedValue: number; range: number } {
    const recent = this.signalBuffer.slice(-windowLen);
    if (recent.length < 10) return { normalizedValue: 0, range: 0 };
    const sorted = [...recent].sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const high = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const range = high - low;
    if (range < 0.15) return { normalizedValue: 0, range: 0 };
    const clipped = Math.min(high, Math.max(low, value));
    return { normalizedValue: ((clipped - low) / range - 0.5) * 120, range };
  }

  private computeDerivative(): number {
    const n = this.signalBuffer.length;
    if (n < 3) return 0;
    return (this.signalBuffer[n - 1] - this.signalBuffer[n - 3]) * 0.5
      + (this.signalBuffer[n - 1] - this.signalBuffer[n - 2]) * 0.5;
  }

  private getExpectedRR(): number {
    if (this.rrIntervals.length >= 3) {
      const recent = this.rrIntervals.slice(-6).sort((a, b) => a - b);
      return recent[Math.floor(recent.length / 2)] ?? 0;
    }
    if (this.smoothBPM > 0) return 60000 / this.smoothBPM;
    return 0;
  }

  private updateBPM(rr: number | undefined, timestamp: number): void {
    if (!rr || rr < B.minPhysiologicalRR || rr > B.maxPhysiologicalRR) return;
    const instantBPM = 60000 / rr;

    if (this.smoothBPM === 0) {
      this.smoothBPM = instantBPM;
    } else {
      const diff = Math.abs(instantBPM - this.smoothBPM) / Math.max(1, this.smoothBPM);
      let alpha = PUB.smoothingAlpha;
      if (diff > 0.35) alpha = 0.1;
      else if (diff > 0.2) alpha = 0.18;
      if (this.consecutiveValidBeats < 4) alpha = Math.max(0.08, alpha - 0.05);
      this.smoothBPM = this.smoothBPM * (1 - alpha) + instantBPM * alpha;
    }

    this.lastBPMUpdateTime = timestamp;
    this.bpmStale = false;
  }

  private getPublishableBPM(qualityScore: number, timestamp: number): number {
    // Warmup check
    const warmupElapsed = timestamp - this.warmupStartTime;
    if (warmupElapsed < PUB.warmupMs) return 0;

    // Minimum beats
    if (this.consecutiveValidBeats < PUB.minBeatsForFirstBPM) return 0;

    // Quality check
    if (qualityScore < PUB.minQualityForBPM) return 0;

    if (this.smoothBPM > 0) {
      this.bpmPublished = true;
      this.lastPublishedBPM = Math.round(this.smoothBPM);
      return this.lastPublishedBPM;
    }

    return 0;
  }

  private getBPMConfidence(): number {
    if (this.smoothBPM === 0) return 0;
    const beatFactor = Math.min(1, this.consecutiveValidBeats / 8);
    let rrFactor = 0;
    if (this.rrIntervals.length >= 3) {
      const mean = this.rrIntervals.reduce((a, b) => a + b, 0) / this.rrIntervals.length;
      const cv = Math.sqrt(
        this.rrIntervals.reduce((a, rr) => a + (rr - mean) ** 2, 0) / this.rrIntervals.length
      ) / Math.max(1, mean);
      rrFactor = Math.max(0, 1 - cv * 2);
    }
    return clamp(beatFactor * 0.5 + rrFactor * 0.5, 0, 1);
  }

  getBeatHistory(): DetectedBeat[] { return [...this.beatHistory]; }
  getRRIntervals(): number[] { return [...this.rrIntervals]; }
  isBPMStale(): boolean { return this.bpmStale; }

  reset(): void {
    this.signalBuffer = [];
    this.timestampBuffer = [];
    this.derivBuffer = [];
    this.lastAcceptedBeatTime = 0;
    this.rrIntervals = [];
    this.smoothBPM = 0;
    this.consecutiveValidBeats = 0;
    this.windowId = 0;
    this.peakThresholdA = 5.0;
    this.lastPeakValueA = 0;
    this.lastDetectorBTime = 0;
    this.warmupStartTime = 0;
    this.bpmPublished = false;
    this.lastPublishedBPM = 0;
    this.lastBPMUpdateTime = 0;
    this.bpmStale = false;
    this.beatHistory = [];
  }

  dispose(): void {
    if (this.audioCtx) this.audioCtx.close().catch(() => {});
  }

  // --- AUDIO ---
  private setupAudio(): void {
    const unlock = async () => {
      if (this.audioUnlocked) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AC();
        await this.audioCtx.resume();
        this.audioUnlocked = true;
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
      } catch {}
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  private vibrate(): void {
    try { if (navigator.vibrate) navigator.vibrate(55); } catch {}
  }

  private async playBeep(): Promise<void> {
    if (!this.audioCtx || !this.audioUnlocked) return;
    const now = Date.now();
    if (now - this.lastBeepTime < 220) return;
    try {
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      const t = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.frequency.setValueAtTime(820, t);
      osc.frequency.exponentialRampToValueAtTime(460, t + 0.08);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
      this.lastBeepTime = now;
    } catch {}
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
