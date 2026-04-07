/**
 * TIPOS PPG ESTRICTOS — ESTADOS, SCORES Y MOTIVOS DE INVALIDEZ
 */

// === FINGER CONTACT ===
export type FingerContactState =
  | 'NO_CAMERA'
  | 'SEARCHING_FINGER'
  | 'PARTIAL_CONTACT'
  | 'OVERPRESSURE_OR_CLIPPING'
  | 'LOW_PERFUSION'
  | 'UNSTABLE_CONTACT'
  | 'CONTACT_OK_WARMING_UP'
  | 'MEASURING_VALID'
  | 'MEASURING_INVALID';

export interface ContactScore {
  total: number;               // 0-100
  coverage: number;            // 0-1
  brightness: number;          // mean brightness
  redDominance: number;        // R - (G+B)/2
  spatialUniformity: number;   // 0-1
  temporalConsistency: number; // 0-1
  saturationPercent: number;   // 0-1 (clipped pixels)
  nearBlackPercent: number;    // 0-1
  histogramSpread: number;     // 0-1
  persistenceMs: number;       // ms of stable contact
}

export interface FingerContactResult {
  state: FingerContactState;
  score: ContactScore;
  instruction: string;         // UI message for user
  fingerDetected: boolean;
  warmupProgress: number;      // 0-1
}

// === SIGNAL QUALITY ===
export type QualityLevel = 'GOOD' | 'MODERATE' | 'POOR' | 'UNUSABLE';

export type InvalidReason =
  | 'excessive_motion'
  | 'poor_contact'
  | 'low_perfusion'
  | 'clipping'
  | 'unstable_fps'
  | 'insufficient_beats'
  | 'inconsistent_peak_sets'
  | 'ambient_light_contamination'
  | 'warmup_not_completed'
  | 'flatline'
  | 'detector_disagreement'
  | 'signal_too_weak'
  | 'overpressure';

export interface SignalQualityResult {
  level: QualityLevel;
  score: number;               // 0-100
  snr: number;
  amplitudeStability: number;  // 0-1
  periodicityScore: number;    // 0-1
  pulseCorrelation: number;    // 0-1 between successive pulses
  rrRegularity: number;        // 0-1
  bandEnergy: number;          // energy in cardiac band
  signalDriftRatio: number;    // drift / useful signal
  clippingRate: number;        // 0-1
  flatlineRate: number;        // 0-1
  motionIndex: number;         // 0+
  perfusionIndex: number;      // percent
  confidence: number;          // 0-1 overall
  invalidReasons: InvalidReason[];
}

// === BEAT DETECTION ===
export interface DetectedBeat {
  timestamp: number;
  confidence: number;          // 0-1
  sourceWindowId: number;
  localQuality: number;        // 0-1
  detectorAgreementScore: number; // 0-1
  detectorASource: boolean;
  detectorBSource: boolean;
  rrInterval?: number;         // ms from previous beat
  amplitude?: number;
}

export interface BeatDetectionResult {
  isPeak: boolean;
  beat?: DetectedBeat;
  bpm: number;
  bpmConfidence: number;       // 0-1
  rrIntervals: number[];
  consecutiveValidBeats: number;
}

// === MEASUREMENT STATE ===
export type MeasurementPhase =
  | 'IDLE'
  | 'PLACING_FINGER'
  | 'STABILIZING_CONTACT'
  | 'CAPTURING_SIGNAL'
  | 'VALIDATING_BEATS'
  | 'READING_RELIABLE'
  | 'READING_INVALID';

export interface MeasurementState {
  phase: MeasurementPhase;
  contactState: FingerContactState;
  qualityLevel: QualityLevel;
  bpm: number;
  bpmConfidence: number;
  bpmIsStale: boolean;
  warmupProgress: number;      // 0-1
  stableContactMs: number;
  elapsedMs: number;
  invalidReasons: InvalidReason[];
  instruction: string;
  semaphore: 'red' | 'yellow' | 'green';
}

// === CAMERA DIAGNOSTICS ===
export interface CameraDiagnostics {
  nominalFps: number;
  effectiveFps: number;
  jitterMs: number;
  resolution: { width: number; height: number };
  torchActive: boolean;
  exposureLocked: boolean;
  focusLocked: boolean;
  wbLocked: boolean;
}

// === SIGNAL FRAME DATA (per-frame raw) ===
export interface FrameRGBData {
  timestamp: number;
  meanR: number;
  meanG: number;
  meanB: number;
  medianR: number;
  medianG: number;
  medianB: number;
  brightness: number;
  saturationCount: number;
  nearBlackCount: number;
  totalPixels: number;
  uniformity: number;          // spatial uniformity 0-1
}

// === SIGNAL EXTRACTION ===
export type SignalSourceLabel = 'GREEN' | 'RED' | 'RG_BLEND' | 'CHROM';

export interface ExtractedSignal {
  value: number;
  source: SignalSourceLabel;
  reason: string;
  rawR: number;
  rawG: number;
  rawB: number;
  rawBrightness: number;
}

// === MOTION ===
export type MotionState = 'STILL' | 'SLIGHT' | 'MODERATE' | 'HIGH';

export interface MotionResult {
  score: number;               // 0+
  state: MotionState;
  episodes: number[];          // timestamps of motion episodes
}

// === PPG DEBUG / EXPORT ===
export interface PPGDebugFrame {
  timestamp: number;
  rawR: number;
  rawG: number;
  rawB: number;
  rawBrightness: number;
  selectedSignal: number;
  signalSource: SignalSourceLabel;
  filteredSignal: number;
  contactScore: number;
  contactState: FingerContactState;
  qualityScore: number;
  qualityLevel: QualityLevel;
  motionScore: number;
  perfusionIndex: number;
  clippingScore: number;
  isPeak: boolean;
  bpm: number;
  bpmConfidence: number;
  detectorAgreement: number;
  invalidReasons: string;
  fps: number;
  torchActive: boolean;
}

export interface PPGSessionExport {
  deviceInfo: {
    userAgent: string;
    screenWidth: number;
    screenHeight: number;
    timestamp: string;
  };
  config: Record<string, unknown>;
  frames: PPGDebugFrame[];
  beats: DetectedBeat[];
  summary: {
    totalFrames: number;
    totalBeats: number;
    avgBPM: number;
    avgQuality: number;
    avgPerfusion: number;
    durationMs: number;
  };
}
