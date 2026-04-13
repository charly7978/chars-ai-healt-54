/**
 * BEAT TYPES — Formal structures for beat-level processing
 */

export interface BeatCandidate {
  timestamp: number;
  sampleIndex: number;
  amplitude: number;
  prominence: number;
  widthMs: number;
  upSlope: number;
  downSlope: number;
  localBaseline: number;
  // Detector support
  detectorHits: number;        // how many detectors flagged this
  detectorAgreement: number;   // 0-1
  zeroCrossingSupport: boolean;
  periodicitySupport: boolean;
  templateCorrelation: number; // -1 to 1
  localBandPowerRatio: number;
  localPerfusion: number;
  // Penalties
  localMotionPenalty: number;
  localPressurePenalty: number;
  localClipPenalty: number;
  // Decision
  status: 'accepted' | 'rejected' | 'pending';
  rejectionReason: string;
  // Scoring
  morphologyScore: number;
  rhythmScore: number;
  totalScore: number;
}

export interface AcceptedBeat {
  timestamp: number;
  ibiMs: number;
  instantBpm: number;
  beatSQI: number;
  morphologyScore: number;
  rhythmScore: number;
  detectorAgreementScore: number;
  templateScore: number;
  sourceConsistencyScore: number;
  flags: BeatFlags;
}

export interface BeatFlags {
  isWeak: boolean;
  isDoublePeak: boolean;
  isMissedBeatInserted: boolean;
  isPremature: boolean;
  isSuspicious: boolean;
}

export interface BPMHypothesis {
  fromLastIBI: number;
  fromMedianIBI: number;
  fromTrimmedIBI: number;
  fromAutocorrelation: number;
  fromSpectral: number;
  finalBpm: number;
  confidence: number;
  dominantSource: 'peak' | 'spectral' | 'autocorr' | 'median';
}

export interface HeartBeatResult {
  bpm: number;
  bpmConfidence: number;
  isPeak: boolean;
  filteredValue: number;
  arrhythmiaCount: number;
  sqi: number;
  beatSQI: number;
  rrData: {
    intervals: number[];
    lastPeakTime: number | null;
  };
  hypothesis: BPMHypothesis | null;
  detectorAgreement: number;
  rejectionReason: string;
  beatFlags: BeatFlags | null;
  debug: HeartBeatDebug;
}

export interface HeartBeatDebug {
  instantBpm: number;
  medianRRBpm: number;
  autocorrBpm: number;
  spectralBpm: number;
  lastBeatSQI: number;
  detectorAgreement: number;
  expectedRR: number;
  refractoryState: 'hard' | 'soft' | 'open';
  beatsAccepted: number;
  beatsRejected: number;
  lastRejectionReason: string;
  doublePeakCount: number;
  missedBeatCount: number;
  suspiciousCount: number;
  templateCorrelation: number;
  morphologyScore: number;
  consecutivePeaks: number;
}
