/**
 * CONFIGURACIÓN CENTRALIZADA PPG — TODOS LOS UMBRALES EN UN SOLO LUGAR
 * Nada de magic numbers dispersos.
 */
export const PPG_CONFIG = {
  // === CAMERA ===
  camera: {
    preferredFps: 30,
    minOperationalFps: 18,
    maxFps: 60,
    roiSizeFraction: 0.72,         // ROI = 72% del frame
    roiTileGrid: 5,                // 5x5 grid
    captureWidth: 640,
    captureHeight: 480,
    fpsBufferSize: 60,
    maxJitterMs: 20,               // Jitter >20ms = inestable
  },

  // === FINGER CONTACT ===
  finger: {
    minRedValue: 30,
    minRGRatio: 0.85,
    maxRGRatio: 6.0,
    minRedDominance: 8,
    minCoverage: 0.20,
    minFingerScore: 0.30,
    minBrightness: 80,
    maxBrightness: 740,
    maxSaturationPercent: 0.30,    // >30% saturated = clipping
    maxNearBlackPercent: 0.40,     // >40% near-black = no finger
    warmupStableMs: 5000,          // 5s stable before measuring
    confirmFrames: 5,              // Frames to confirm finger
    lostGraceFrames: 90,           // ~3s grace before NO_CONTACT
    stableThresholdFrames: 30,     // ~1s for STABLE_CONTACT
    overpressureRedMin: 220,       // Red channel floor for overpressure
    overpressureACThreshold: 0.0005, // AC/DC ratio below = occlusion
    lowPerfusionThreshold: 0.02,   // Perfusion index < 0.02% = low
  },

  // === SIGNAL EXTRACTION ===
  signal: {
    bufferSize: 360,               // ~12s @ 30fps
    acdcWindowSize: 180,           // ~6s window for AC/DC
    baselineAlpha: 0.02,           // EMA for baseline tracking
    baselineAlphaMotion: 0.005,    // Slower during motion
    greenPrimary: true,            // Green = primary signal
    bandpassLowHz: 0.5,           // HPF cutoff
    bandpassHighHz: 4.5,          // LPF cutoff (270 BPM)
    maxClampValue: 80,
    flatlineThresholdRange: 0.2,   // Range <0.2 over 2s = flatline
    flatlineWindowFrames: 60,
    clippingValueThreshold: 250,   // Pixel value considered clipped
    sourceHysteresisMs: 3000,      // Don't switch signal source <3s
    sourceImprovementFactor: 1.25, // Need 25% better to switch
  },

  // === SIGNAL QUALITY ===
  quality: {
    minSNR: 1.5,
    goodSNR: 4.0,
    minPerfusion: 0.03,
    goodPerfusion: 0.15,
    maxMotionScore: 0.5,
    minPeriodicityScore: 0.2,
    goodPeriodicityScore: 0.5,
    minConsecutiveBeatsForGood: 5,
    maxRRCoefficientOfVariation: 0.25,
    // Thresholds for quality categories
    goodThreshold: 70,
    moderateThreshold: 40,
    poorThreshold: 20,
  },

  // === BEAT DETECTION ===
  beats: {
    minPeakIntervalMs: 280,        // Max 214 BPM
    maxPeakIntervalMs: 2200,       // Min 27 BPM
    refractoryMs: 250,             // Absolute refractory period
    detectorAgreementToleranceMs: 80, // A & B must agree within 80ms
    minProminence: 1.5,
    minCandidateScore: 30,
    minConfirmedCandidateScore: 40,
    // Physiological RR validation
    minPhysiologicalRR: 250,       // 240 BPM
    maxPhysiologicalRR: 2500,      // 24 BPM
    maxRRChangeRatio: 0.45,        // Max 45% change between consecutive RR
  },

  // === BPM PUBLICATION ===
  publication: {
    warmupMs: 10000,               // 10s warmup before first BPM
    minBeatsForFirstBPM: 6,
    minQualityForBPM: 40,          // MODERATE or better
    maxBPMVariabilityForPublish: 0.15, // 15% max variation
    staleTimeoutMs: 4000,          // Mark stale after 4s without update
    withdrawTimeoutMs: 8000,       // Withdraw BPM after 8s invalid
    smoothingAlpha: 0.25,          // EMA for display BPM
    detectorAgreementMin: 0.5,     // Min agreement score to publish
  },

  // === MOTION ===
  motion: {
    accelWeight: 0.6,
    gyroWeight: 0.4,
    threshold: 0.35,
    highThreshold: 1.0,            // Definite motion artifact
    smoothingAlpha: 0.15,
    visualMotionFrameDiffThreshold: 5, // RGB diff between frames
    visualMotionHistogramThreshold: 15,
  },

  // === DEBUG / EXPORT ===
  debug: {
    logIntervalMs: 3000,
    maxExportRows: 36000,          // 20 min @ 30fps
    csvDelimiter: ',',
  },
} as const;

export type PPGConfig = typeof PPG_CONFIG;
