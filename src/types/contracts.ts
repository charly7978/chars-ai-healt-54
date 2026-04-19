import { OutputStatus } from './measurement';

export type RuntimeContactState = 'NO_CONTACT' | 'UNSTABLE_CONTACT' | 'STABLE_CONTACT';

export type MetricOperationalMode =
  | 'production_grade'
  | 'calibration_dependent'
  | 'research_calibrated';

export interface MetricPublication {
  status: OutputStatus;
  mode: MetricOperationalMode;
  confidence: number;
  published: boolean;
  reason: string;
}

export const LEGACY_OUTPUT_STATES = {
  HIGH: 'ENABLED_HIGH_CONFIDENCE',
  MEDIUM: 'ENABLED_MEDIUM_CONFIDENCE',
  LOW: 'ENABLED_LOW_CONFIDENCE',
  RESEARCH: 'RESEARCH_ONLY',
  WITHHELD: 'WITHHELD_LOW_QUALITY',
} as const;

export type LegacyOutputState =
  (typeof LEGACY_OUTPUT_STATES)[keyof typeof LEGACY_OUTPUT_STATES];

export function toRuntimeContactState(state: string | null | undefined): RuntimeContactState {
  switch ((state ?? '').toLowerCase()) {
    case 'stable':
    case 'stable_contact':
      return 'STABLE_CONTACT';
    case 'unstable':
    case 'unstable_contact':
    case 'acquiring':
    case 'saturated':
    case 'excessive_pressure':
      return 'UNSTABLE_CONTACT';
    default:
      return 'NO_CONTACT';
  }
}

export function toLegacyOutputState(
  status: OutputStatus,
  confidence: number,
  mode: MetricOperationalMode,
): LegacyOutputState {
  if (status === OutputStatus.RESEARCH_ONLY || mode === 'research_calibrated') {
    return LEGACY_OUTPUT_STATES.RESEARCH;
  }
  if (status === OutputStatus.NEEDS_CALIBRATION || status === OutputStatus.BLOCKED) {
    return LEGACY_OUTPUT_STATES.WITHHELD;
  }
  if (confidence >= 0.75) return LEGACY_OUTPUT_STATES.HIGH;
  if (confidence >= 0.45) return LEGACY_OUTPUT_STATES.MEDIUM;
  return LEGACY_OUTPUT_STATES.LOW;
}

export function buildMetricPublication(params: {
  status: OutputStatus;
  mode: MetricOperationalMode;
  confidence?: number;
  reason?: string;
}): MetricPublication {
  const confidence = Math.max(0, Math.min(1, params.confidence ?? 0));
  return {
    status: params.status,
    mode: params.mode,
    confidence,
    published: params.status === OutputStatus.OK || params.status === OutputStatus.LOW_QUALITY,
    reason: params.reason ?? '',
  };
}
