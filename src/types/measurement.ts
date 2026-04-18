/**
 * MEASUREMENT TYPES — UNIFIED MEASUREMENT FRAME STATE & OUTPUT CONTRACTS
 * 
 * This is the single source of truth for:
 * 1. MeasurementFrameState — Per-frame unified state
 * 2. OutputContract — Standard output for all metrics (value, confidence, status, evidence)
 * 3. Enumerations for states, flags, and status codes
 * 
 * CRITICAL RULES:
 * - All vital sign outputs must use OutputContract
 * - No value shall be published without confidence + status + evidence
 * - No metric permitted to simulate/fake a value when signal is insufficient
 * - All quality flags must be explicit and traceable
 */

// ═══════════════════════════════════════════════════════════════════
// ENUMERATIONS
// ═══════════════════════════════════════════════════════════════════

export enum OutputStatus {
  /** Signal is sufficient, measurement is validated and ready for display */
  OK = 'ok',
  
  /** Signal quality is low, measurement may be inaccurate */
  LOW_QUALITY = 'low_quality',
  
  /** Measurement requires user calibration before publication (BP, glucose, etc.) */
  NEEDS_CALIBRATION = 'needs_calibration',
  
  /** Measurement is research-only, not validated for clinical use */
  RESEARCH_ONLY = 'research_only',
  
  /** Measurement is not published — withheld due to insufficient evidence */
  BLOCKED = 'blocked',
}

export enum ContactState {
  NO_CONTACT = 'no_contact',
  ACQUIRING = 'acquiring',
  STABLE = 'stable',
  UNSTABLE = 'unstable',
  SATURATED = 'saturated',
  EXCESSIVE_PRESSURE = 'excessive_pressure',
}

export enum TorchState {
  OFF = 'off',
  ON = 'on',
  UNAVAILABLE = 'unavailable',
  FAILED = 'failed',
}

export enum ExposureState {
  AUTO = 'auto',
  LOCKED = 'locked',
  DRIFTING = 'drifting',
}

export enum RhythmClassification {
  SINUS_REGULAR = 'sinus_regular',
  SINUS_VARIABLE = 'sinus_variable',
  IRREGULAR_UNDETERMINED = 'irregular_undetermined',
  AF_SUSPECTED = 'af_suspected',
  ECTOPY_FREQUENT = 'ectopy_frequent',
  TACHY_IRREGULAR = 'tachy_irregular',
  BRADY_IRREGULAR = 'brady_irregular',
  NOISE_UNRELIABLE = 'noise_unreliable',
  INSUFFICIENT_DATA = 'insufficient_data',
}

// ═══════════════════════════════════════════════════════════════════
// OUTPUT CONTRACT — STANDARD FOR ALL METRICS
// ═══════════════════════════════════════════════════════════════════

export interface OutputContract<T = number> {
  /** The measured value, or 0/null if unavailable */
  value: T;
  
  /** Unit of measurement (bpm, %, mmHg, mg/dL, etc.) */
  unit: string;
  
  /** Confidence level 0-1 that the value is correct */
  confidence: number;
  
  /** Publication status */
  status: OutputStatus;
  
  /** Explicit quality flags for traceability */
  qualityFlags: QualityFlag[];
  
  /** Machine-readable evidence breakdown */
  evidence: EvidenceBreakdown;
  
  /** Debug context (not for production UI) */
  debug?: Record<string, any>;
}

export interface QualityFlag {
  flag: string;
  description: string;
  severity: 'info' | 'warning' | 'error';
}

export interface EvidenceBreakdown {
  /** SQI at measurement window (0-100) */
  sqi: number;
  
  /** Number of accepted windows/beats used */
  acceptedWindows?: number;
  acceptedBeats?: number;
  
  /** Source of measurement (channel, algorithm version) */
  source?: string;
  
  /** Calibration status if applicable */
  deviceCalibration?: string;
  userCalibration?: string;
  modelVersion?: string;
  
  /** Signal adequacy markers */
  perfusionIndex?: number;
  contactStability?: number;
  signalDuration?: number;
}

// ═══════════════════════════════════════════════════════════════════
// MEASUREMENT FRAME STATE — UNIFIED PER-FRAME STATE
// ═══════════════════════════════════════════════════════════════════

export interface HardwareTelemetry {
  timestamp: number;
  fpsMeasured: number;
  torchState: TorchState;
  exposureState: ExposureState;
  exposureLocked: boolean;
  whiteBalanceState: ExposureState;
  wbLocked: boolean;
  focusLocked: boolean;
  isoValue: number;
  realFrameRate: number;
  exposureDriftScore: number; // 0-1, 0 = stable, 1 = drifting
}

export interface ColorStats {
  meanR: number;
  meanG: number;
  meanB: number;
  stdR: number;
  stdG: number;
  stdB: number;
  medianR: number;
  medianG: number;
  medianB: number;
}

export interface SaturationStats {
  highSaturationPercent: number; // % pixels > 250
  lowSaturationPercent: number; // % pixels < 5
  dynamicRange: number;
  percentValidRange: number;
  percentHighSaturation: number;
  percentLowSaturation: number;
}

export interface RawChannels {
  red: number;
  green: number;
  blue: number;
  luma: number; // luminance from weighted RGB
  odRed: number; // -log(red/ref)
  odGreen: number; // -log(green/ref)
  odBlue: number; // -log(blue/ref)
}

export interface ProcessedSignalState {
  fusedSignal: number; // Primary PPG signal
  fusedChannel: string; // 'green', 'red/green', 'pca', etc.
  derivative1: number; // First derivative (velocity)
  derivative2: number; // Second derivative (acceleration)
  dcLevel: number;
  acAmplitude: number;
}

export interface FingerContactState {
  score: number; // 0-1
  state: ContactState;
  isStable: boolean;
  temporalStability: number; // 0-1
  pressureProxyDC: number;
  pressureExcessive: boolean;
}

export interface MotionState {
  score: number; // 0-1, 0 = no motion, 1 = severe
  isMotionArtifact: boolean;
  accelerometerMagnitude?: number;
  motionPenalty: number;
}

export interface PerfusionState {
  index: number; // PI_green typically
  indexRed: number;
  indexGreen: number;
  indexBlue: number;
  isAdequate: boolean; // PI > 0.003
}

export interface ROIState {
  coverage: number; // Fraction of ROI with valid signal
  validTileCount: number;
  totalTileCount: number;
  spatialUniformity: number; // How uniform across tiles
  dominantTileIndices: number[]; // Top 3 tiles
  tileQualityScores: number[];
}

export interface BeatState {
  candidates: BeatCandidate[];
  acceptedBeats: AcceptedBeat[];
  rejectedBeats: BeatCandidate[];
  ruleAcceptanceRate: number; // Fraction of candidates accepted
}

export interface BeatCandidate {
  timestampMs: number;
  amplitude: number;
  morphologyScore: number;
  contextQuality: number;
  accepted: boolean;
  rejectionReason?: string;
}

export interface AcceptedBeat {
  timestampMs: number;
  ibiMs: number;
  morphologyScore: number;
  templateCorrelation: number;
  beatSQI: number;
}

export interface SignalQualityState {
  sqi: number; // Global 0-100
  frameSQI: number;
  windowSQI: number;
  beatSQI?: number;
  guidance: string;
}

/**
 * MeasurementFrameState — The single unified state object passed through app
 * 
 * Every frame of video produces one of these containing all relevant metrics.
 * Modules consume this and emit OutputContract for each metric.
 */
export interface MeasurementFrameState {
  // TIMING & IDENTIFICATION
  timestamp: number; // ms since session start
  frameIndex: number;
  realtimeMs: number; // System time
  
  // HARDWARE TELEMETRY
  hardware: HardwareTelemetry;
  
  // RADIOMETRY & COLOR
  colorStats: ColorStats;
  saturationStats: SaturationStats;
  rawChannels: RawChannels;
  processed: ProcessedSignalState;
  
  // BIOLOGY / DETECTION
  fingerContact: FingerContactState;
  motion: MotionState;
  perfusion: PerfusionState;
  roi: ROIState;
  beats: BeatState;
  
  // QUALITY
  signalQuality: SignalQualityState;
  
  // UPSTREAM CONTEXT (from PPGSignalProcessor)
  context: {
    contactStable: boolean;
    pressureOptimal: boolean;
    clipHighRatio: number;
    sourceStability: number;
    avgBeatSQI: number;
    beatCount: number;
    sampleRate: number;
    detectorAgreement: number;
    rrStability: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// VITAL SIGNS OUTPUT CONTRACTS
// ═══════════════════════════════════════════════════════════════════

export interface BPMOutput extends OutputContract<number> {
  unit: 'bpm';
  rrIntervals?: number[];
  instantBpm?: number;
  medianBpm?: number;
}

export interface SpO2Output extends OutputContract<number> {
  unit: '%';
  calibrationState?: 'uncalibrated' | 'session' | 'device';
}

export interface BloodPressureOutput extends OutputContract<{
  systolic: number;
  diastolic: number;
  map: number;
}> {
  unit: 'mmHg';
  calibrationStatus?: 'no_calibration' | 'needs_user_calibration' | 'calibrated';
}

export interface ArrhythmiaOutput extends OutputContract<RhythmClassification> {
  unit: 'classification';
  confidence: number;
  burden?: number; // Fraction of window showing abnormality
  evidenceBreakdown?: {
    rrVariability?: number;
    morphologyInstability?: number;
    entropy?: number;
  };
}

export interface GlucoseOutput extends OutputContract<number> {
  unit: 'mg/dL';
  researchMode: boolean;
  trend?: 'rising' | 'falling' | 'stable';
}

export interface LipidsOutput extends OutputContract<{
  totalCholesterol: number;
  triglycerides: number;
  hdl?: number;
  ldl?: number;
}> {
  unit: 'mg/dL';
  researchMode: boolean;
}
