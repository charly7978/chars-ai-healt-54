/**
 * MEASUREMENT GATE — Per-output uncertainty and gating
 * 
 * Every vital sign output passes through its own gate that determines
 * whether the value should be shown and at what confidence level.
 * 
 * States:
 * - ENABLED_HIGH_CONFIDENCE: Reliable for health tracking
 * - ENABLED_MEDIUM_CONFIDENCE: Indicative, with known limitations
 * - ENABLED_LOW_CONFIDENCE: Weak signal, treat as estimate
 * - RESEARCH_ONLY: Experimental, not validated
 * - WITHHELD_LOW_QUALITY: Output suppressed due to quality
 */

export type OutputState =
  | 'ENABLED_HIGH_CONFIDENCE'
  | 'ENABLED_MEDIUM_CONFIDENCE'
  | 'ENABLED_LOW_CONFIDENCE'
  | 'RESEARCH_ONLY'
  | 'WITHHELD_LOW_QUALITY';

export interface GatedOutput<T> {
  value: T;
  state: OutputState;
  confidence: number;
  quality: number;
  reason: string;
}

export interface ModalityQuality {
  signalQuality: number;
  beatQuality: number;
  rhythmQuality: number;
  spo2Quality: number;
  bpQuality: number;
  glucoseQuality: number;
  lipidsQuality: number;
}

export interface ModalityConfidence {
  bpmConfidence: number;
  rhythmConfidence: number;
  spo2Confidence: number;
  bpConfidence: number;
  glucoseConfidence: number;
  lipidsConfidence: number;
}

export class MeasurementGate {
  /**
   * Gate a BPM value
   */
  static gateBPM(bpm: number, confidence: number, beatCount: number, signalQuality: number): GatedOutput<number> {
    if (bpm <= 0 || confidence < 0.1) {
      return { value: 0, state: 'WITHHELD_LOW_QUALITY', confidence: 0, quality: 0, reason: 'no_valid_bpm' };
    }

    const quality = Math.min(100,
      signalQuality * 0.4 +
      Math.min(30, beatCount * 3) +
      confidence * 30
    );

    let state: OutputState;
    if (confidence >= 0.6 && quality >= 60 && beatCount >= 5) state = 'ENABLED_HIGH_CONFIDENCE';
    else if (confidence >= 0.35 && quality >= 35) state = 'ENABLED_MEDIUM_CONFIDENCE';
    else if (confidence >= 0.15) state = 'ENABLED_LOW_CONFIDENCE';
    else state = 'WITHHELD_LOW_QUALITY';

    return { value: Math.round(bpm), state, confidence, quality, reason: '' };
  }

  /**
   * Gate BP values
   */
  static gateBP(
    systolic: number, diastolic: number,
    bpConfidence: string, featureQuality: number,
    cycleCount: number
  ): GatedOutput<{ systolic: number; diastolic: number }> {
    if (systolic <= 0 || diastolic <= 0 || bpConfidence === 'INSUFFICIENT') {
      return {
        value: { systolic: 0, diastolic: 0 },
        state: 'WITHHELD_LOW_QUALITY',
        confidence: 0, quality: 0, reason: 'insufficient_bp_data',
      };
    }

    const confMap: Record<string, number> = { 'HIGH': 0.8, 'MEDIUM': 0.5, 'LOW': 0.3, 'INSUFFICIENT': 0 };
    const confidence = confMap[bpConfidence] ?? 0;

    let state: OutputState;
    if (confidence >= 0.7 && featureQuality >= 70 && cycleCount >= 8) state = 'ENABLED_MEDIUM_CONFIDENCE';
    else if (confidence >= 0.3 && featureQuality >= 30) state = 'ENABLED_LOW_CONFIDENCE';
    else state = 'RESEARCH_ONLY';

    return {
      value: { systolic: Math.round(systolic), diastolic: Math.round(diastolic) },
      state, confidence, quality: featureQuality,
      reason: '',
    };
  }

  /**
   * Build the full quality/confidence report
   */
  static buildQualityReport(params: {
    signalQuality: number;
    avgBeatSQI: number;
    rhythmQuality: number;
    spo2Quality: number;
    bpFeatureQuality: number;
    glucoseFeatureCount: number;
    lipidsFeatureCount: number;
    bpmConfidence: number;
    rhythmConfidence: number;
    spo2Confidence: number;
    bpConfidence: number;
    glucoseConfidence: number;
    lipidsConfidence: number;
  }): { quality: ModalityQuality; confidence: ModalityConfidence } {
    return {
      quality: {
        signalQuality: params.signalQuality,
        beatQuality: params.avgBeatSQI,
        rhythmQuality: params.rhythmQuality,
        spo2Quality: params.spo2Quality,
        bpQuality: params.bpFeatureQuality,
        glucoseQuality: Math.min(100, params.glucoseFeatureCount * 10),
        lipidsQuality: Math.min(100, params.lipidsFeatureCount * 12),
      },
      confidence: {
        bpmConfidence: params.bpmConfidence,
        rhythmConfidence: params.rhythmConfidence,
        spo2Confidence: params.spo2Confidence,
        bpConfidence: params.bpConfidence,
        glucoseConfidence: params.glucoseConfidence,
        lipidsConfidence: params.lipidsConfidence,
      },
    };
  }
}
