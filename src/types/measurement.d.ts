/**
 * MEASUREMENT TYPES - FASE 0 + FASE 12
 * 
 * Contrato de salida unificado para todos los módulos.
 * Cada métrica debe incluir: value, confidence, qualityFlags, evidence, status
 * 
 * Reglas:
 * - value: number | null (null = no hay valor válido)
 * - confidence: 0-1 (0 = sin confianza, 1 = máxima confianza)
 * - status: estado del módulo de medición
 * - qualityFlags: array de strings describiendo problemas
 * - evidence: datos de soporte para auditoría
 */

// ═══════════════════════════════════════════════════════════════════
//  STATUS Y FLAGS GLOBALES
// ═══════════════════════════════════════════════════════════════════

export type MeasurementStatus = 
  | 'ok'              // Medición válida y publicable
  | 'low_quality'     // Señal degrada pero con valor
  | 'needs_calibration' // Requiere calibración de dispositivo/usuario
  | 'research_only'   // Solo para investigación, no clínico
  | 'blocked'         // Bloqueado: sin valor válido
  | 'initializing';   // Módulo iniciando, aún no listo

export type QualityFlag = 
  // Contacto/Adquisición
  | 'no_finger_detected'
  | 'insufficient_coverage'
  | 'excessive_pressure'
  | 'unstable_contact'
  | 'finger_position_drift'
  // Señal
  | 'low_perfusion'
  | 'low_snr'
  | 'high_motion_artifact'
  | 'signal_saturation'
  | 'signal_clipping'
  | 'baseline_wander_excessive'
  // Calidad de beats
  | 'insufficient_beats'
  | 'beat_rejection_high'
  | 'rr_instability'
  | 'morphology_atypical'
  // Calibración
  | 'device_uncalibrated'
  | 'user_uncalibrated'
  | 'calibration_stale'
  | 'out_of_calibrated_range'
  // Datos
  | 'insufficient_data'
  | 'initializing'
  // Valores
  | 'implausible_values'
  // Research
  | 'research_only'
  // Ambiente
  | 'torch_unstable'
  | 'exposure_drift'
  | 'low_illumination'
  | 'overexposure'
  // General
  | 'measurement_duration_insufficient'
  | 'recent_motion_detected'
  | 'sensor_overheating';

// ═══════════════════════════════════════════════════════════════════
//  CONTRATO BASE DE SALIDA (FASE 12)
// ═══════════════════════════════════════════════════════════════════

export interface MeasurementOutput<T = number> {
  value: T | null;           // null si no hay valor válido
  unit: string;              // unidad de medida
  confidence: number;        // 0-1
  status: MeasurementStatus;
  qualityFlags: QualityFlag[];
  evidence: {
    // Calidad de señal
    sqi: number;                    // Signal Quality Index 0-1
    sqiComponents?: {
      spectralSNR?: number;
      harmonicConsistency?: number;
      perfusionQuality?: number;
      morphologyQuality?: number;
    };
    // Ventanas y beats
    acceptedWindows: number;
    totalWindows: number;
    acceptedBeats: number;
    totalBeats: number;
    // Temporal
    measurementDurationMs: number;
    effectiveFps: number;
    // Contexto
    contactState?: string;
    motionScore?: number;
    perfusionIndex?: number;
    // Modelo/Calibración
    modelVersion?: string;
    deviceCalibration?: string;
    userCalibration?: string;
    calibrationCoverage?: number;  // 0-1 cuánto del espacio de calibración cubierto
  };
  debug?: Record<string, unknown>; // Datos adicionales para debug
}

// ═══════════════════════════════════════════════════════════════════
//  MEASUREMENT FRAME STATE (FASE 0)
//  Estado unificado por frame de medición
// ═══════════════════════════════════════════════════════════════════

export interface MeasurementFrameState {
  // Identificación temporal
  timestamp: number;
  frameNumber: number;
  
  // Timing
  fpsMeasured: number;
  fpsTarget: number;
  frameIntervalMs: number;
  timingJitterMs: number;
  
  // Estado de hardware
  hardware: {
    torchState: 'on' | 'off' | 'unstable';
    torchIntensity?: number;
    exposureState: 'locked' | 'adjusting' | 'unstable';
    exposureCompensation?: number;
    iso?: number;
    focusState: 'locked' | 'hunting';
    whiteBalanceState: 'locked' | 'adjusting';
    // Drift tracking
    exposureDriftScore: number;
    whiteBalanceDriftScore: number;
  };
  
  // Estadísticas de color (radiométricas)
  colorStats: {
    meanR: number; meanG: number; meanB: number;
    stdR: number; stdG: number; stdB: number;
    medianR: number; medianG: number; medianB: number;
    // Percentiles
    p5R: number; p5G: number; p5B: number;
    p95R: number; p95G: number; p95B: number;
    // Rangos
    minR: number; minG: number; minB: number;
    maxR: number; maxG: number; maxB: number;
  };
  
  // Estadísticas de saturación
  saturationStats: {
    percentHighSaturation: number;  // % pixels > 250
    percentLowSaturation: number;    // % pixels < 10
    percentValidRange: number;       // % pixels en rango útil
    dynamicRange: number;            // max-min
  };
  
  // Detección de dedo y contacto
  fingerContact: {
    score: number;           // 0-1 score de contacto
    state: 'no_contact' | 'partial' | 'good' | 'excessive_pressure';
    confidence: number;
    coverage: number;        // ratio de cobertura
    centerCoverage: number;  // cobertura en centro
    spatialUniformity: number;
    temporalStability: number;
    chromaticDominance: number; // R - (G+B)/2
  };
  
  // ROI y tiles
  roi: {
    coverage: number;
    spatialUniformity: number;
    validTileCount: number;
    totalTileCount: number;
    tileQualityScores: number[]; // score por tile
    dominantTileIndices: number[];
    roiMask?: boolean[];       // máscara binaria si aplica
  };
  
  // Movimiento
  motion: {
    score: number;           // 0-1
    state: 'stationary' | 'low' | 'moderate' | 'high' | 'extreme';
    imuAvailable: boolean;
    visualAvailable: boolean;
    confidence: number;
  };
  
  // Perfusion y señal
  perfusion: {
    index: number;           // AC/DC
    indexRed: number;
    indexGreen: number;
    indexBlue: number;
    quality: number;         // 0-1
  };
  
  // Calidad de señal
  signalQuality: {
    sqi: number;             // Global SQI 0-1
    components: {
      spectral?: number;
      temporal?: number;
      morphological?: number;
      environmental?: number;
    };
  };
  
  // Canales raw
  rawChannels: {
    red: number;
    green: number;
    blue: number;
    luma: number;
    // Optical density
    odRed: number;
    odGreen: number;
    odBlue: number;
  };
  
  // Señal procesada
  processed: {
    fusedSignal: number;     // Señal PPG fusionada
    fusedChannel: string;    // qué canal o combinación
    derivative1: number;     // primera derivada
    derivative2: number;     // segunda derivada
    filtered?: number;       // señal filtrada
  };
  
  // Beats detectados
  beats: {
    candidates: BeatCandidate[];
    accepted: BeatAccepted[];
    lastBeatTimestamp?: number;
    instantaneousBPM?: number;
  };
  
  // Flags de decisión
  flags: {
    isFrameValid: boolean;
    isMeasurementValid: boolean;
    shouldPublishMetrics: boolean;
    blockReasons: QualityFlag[];
  };
}

export interface BeatCandidate {
  timestamp: number;
  amplitude: number;
  prominence: number;
  width: number;
  quality: number;
  morphologyScore: number;
  flags: {
    isWeak: boolean;
    isPremature: boolean;
    isSuspicious: boolean;
    isDoublePeak: boolean;
  };
}

export interface BeatAccepted extends BeatCandidate {
  rrInterval: number;      // ms desde beat anterior
  rrIntervalValid: boolean;
  beatSQI: number;
  templateCorrelation: number;
}

// ═══════════════════════════════════════════════════════════════════
//  RESULTADOS ESPECÍFICOS POR MÉTRICA
// ═══════════════════════════════════════════════════════════════════

export type BPMOutput = MeasurementOutput<number>;
export type SpO2Output = MeasurementOutput<number> & {
  evidence: MeasurementOutput<number>['evidence'] & {
    rawRatioR: number;
    medianRatioR: number;
    perfusionIndexRed: number;
    perfusionIndexGreen: number;
    calibrationState: 'uncalibrated' | 'device' | 'user' | 'full';
    deviceCalibration?: string;
    modelVersion?: string;
    calibrationSampleCount?: number;
    calibrationAgeDays?: number;
  };
};

export type HRVOutput = MeasurementOutput<{
  rmssd: number;
  sdnn: number;
  pnn50: number;
  cvrr: number;
  medianRR: number;
  madRR: number;
}>;

export type BloodPressureOutput = MeasurementOutput<{
  systolic: number;
  diastolic: number;
  map: number;
  pulsePressure: number;
}> & {
  evidence: MeasurementOutput['evidence'] & {
    calibrationPoints: number;
    calibrationFreshnessDays: number;
    featureVector: Record<string, number>;
  };
};

export type ArrhythmiaOutput = MeasurementOutput<string> & {
  value: string | null; // clasificación rítmica
  evidence: MeasurementOutput['evidence'] & {
    rhythmLabel: string;
    classificationPath: string[]; // árbol de decisión
    afEvidence: number;
    ectopyEvidence: number;
    irregularityEvidence: number;
    burden: number;
  };
};

export type GlucoseOutput = MeasurementOutput<number> & {
  evidence: MeasurementOutput['evidence'] & {
    calibrationPoints: number;
    calibrationCoverage: number;
    trend: 'RISING' | 'FALLING' | 'STABLE' | 'UNKNOWN';
    featureImportance: Record<string, number>;
  };
};

export type LipidOutput = MeasurementOutput<{
  totalCholesterol: number;
  ldl: number;
  hdl: number;
  triglycerides: number;
}> & {
  evidence: MeasurementOutput['evidence'] & {
    calibrationPoints: number;
    featureVector: Record<string, number>;
  };
};

// ═══════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL DE MEDICIÓN
// ═══════════════════════════════════════════════════════════════════

export interface MeasurementSession {
  sessionId: string;
  startTime: number;
  deviceModel: string;
  userId?: string;
  
  // Frames
  frames: MeasurementFrameState[];
  frameCount: number;
  validFrameCount: number;
  
  // Resultados finales
  results: {
    bpm?: BPMOutput;
    spo2?: SpO2Output;
    hrv?: HRVOutput;
    bloodPressure?: BloodPressureOutput;
    arrhythmia?: ArrhythmiaOutput;
    glucose?: GlucoseOutput;
    lipids?: LipidOutput;
  };
  
  // Metadata
  durationMs: number;
  status: 'in_progress' | 'complete' | 'aborted';
  abortReason?: QualityFlag[];
  
  // Calibraciones usadas
  calibrations: {
    deviceProfile?: string;
    userSpO2?: string;
    userBP?: string;
    userGlucose?: string;
    userLipids?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
//  DEVICE PROFILE (FASE 7)
// ═══════════════════════════════════════════════════════════════════

export interface DeviceCalibrationProfile {
  deviceId: string;
  deviceModel: string;
  userAgent: string;
  
  // Calibración de sensor
  optical: {
    gammaEstimated: number;
    gammaConfidence: number;
    darkOffset: { r: number; g: number; b: number };
    channelGain: { r: number; g: number; b: number };
  };
  
  // SpO2 calibration
  spo2Calibration: {
    // Coeficientes ratio-of-ratios → SpO2
    // SpO2 = A + B*R + C*R²
    coefficients: { A: number; B: number; C: number };
    validRange: { min: number; max: number };
    referenceDevice?: string;
    calibrationDate: number;
    sampleCount: number;
    rmse?: number;
  } | null;
  
  // BP calibration (requires user-specific calibration)
  bpCalibrationTemplate: {
    featureMeans: Record<string, number>;
    featureStds: Record<string, number>;
    populationCoefficients: Record<string, number>;
  } | null;
  
  // Rango válido de operación
  operatingRange: {
    minIllumination: number;
    maxIllumination: number;
    minPerfusion: number;
    validFrameRate: number[];
  };
  
  // Timestamp
  createdAt: number;
  updatedAt: number;
}
