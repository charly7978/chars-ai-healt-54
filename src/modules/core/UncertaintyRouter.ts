import { MeasurementGate, type OutputState } from './MeasurementGate';
import type { SpO2Result } from '../vital-signs/SpO2Processor';
import type { GlucoseResult } from '../biomarkers/GlucoseResearchProcessor';
import type { LipidResult } from '../biomarkers/LipidResearchProcessor';
import type { RhythmResult } from '../vital-signs/RhythmClassifier';

export interface RoutedModalities {
  spo2: OutputState;
  bp: OutputState;
  glucose: OutputState;
  lipids: OutputState;
  rhythm: OutputState;
  bpm: OutputState;
}

function rhythmToState(r: RhythmResult | null): OutputState {
  if (!r) return 'WITHHELD_LOW_QUALITY';
  if (r.rhythmLabel === 'UNDETERMINED_LOW_QUALITY' || r.rhythmLabel === 'INSUFFICIENT_DATA') {
    return 'WITHHELD_LOW_QUALITY';
  }
  if (r.rhythmConfidence >= 0.5 && r.rhythmQuality >= 42) return 'ENABLED_MEDIUM_CONFIDENCE';
  if (r.rhythmConfidence >= 0.25 && r.rhythmQuality >= 22) return 'ENABLED_LOW_CONFIDENCE';
  return 'ENABLED_LOW_CONFIDENCE';
}

function glucoseToState(g: GlucoseResult | null): OutputState {
  if (!g) return 'WITHHELD_LOW_QUALITY';
  if (g.enabledState === 'WITHHELD_LOW_QUALITY') return 'WITHHELD_LOW_QUALITY';
  if (g.enabledState === 'ENABLED_LOW_CONFIDENCE') return 'ENABLED_LOW_CONFIDENCE';
  return 'RESEARCH_ONLY';
}

function lipidsToState(l: LipidResult | null): OutputState {
  if (!l) return 'WITHHELD_LOW_QUALITY';
  if (l.enabledState === 'WITHHELD_LOW_QUALITY') return 'WITHHELD_LOW_QUALITY';
  if (l.enabledState === 'ENABLED_LOW_CONFIDENCE') return 'ENABLED_LOW_CONFIDENCE';
  return 'RESEARCH_ONLY';
}

/**
 * Punto único de salida para estados de habilitación (sin duplicar lógica en la UI).
 */
export class UncertaintyRouter {
  static route(params: {
    spo2Detail: SpO2Result | null;
    glucoseDetail: GlucoseResult | null;
    lipidsDetail: LipidResult | null;
    rhythm: RhythmResult | null;
    bpSystolic: number;
    bpDiastolic: number;
    bpConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    bpFeatureQuality: number;
    bpCycles: number;
    bpm: number;
    bpmConfidence: number;
    beatCount: number;
    signalQuality: number;
    bpTrendOnly?: boolean;
  }): RoutedModalities {
    const spo2: OutputState = params.spo2Detail?.enabledState
      ?? 'WITHHELD_LOW_QUALITY';

    const bpG = MeasurementGate.gateBP(
      params.bpTrendOnly ? 0 : params.bpSystolic,
      params.bpTrendOnly ? 0 : params.bpDiastolic,
      params.bpConfidence,
      params.bpFeatureQuality,
      params.bpCycles
    );

    const bpmG = MeasurementGate.gateBPM(
      params.bpm,
      params.bpmConfidence,
      params.beatCount,
      params.signalQuality
    );

    return {
      spo2,
      bp: params.bpTrendOnly ? 'ENABLED_LOW_CONFIDENCE' : bpG.state,
      glucose: glucoseToState(params.glucoseDetail),
      lipids: lipidsToState(params.lipidsDetail),
      rhythm: rhythmToState(params.rhythm),
      bpm: bpmG.state,
    };
  }
}
