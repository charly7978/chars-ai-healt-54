import { OutputStatus } from '@/types/measurement';
import type { OutputState } from '@/modules/core/MeasurementGate';

export function isOperationalOutputState(
  state: OutputState | undefined,
  minimum: 'medium' | 'low' = 'medium',
): boolean {
  if (!state) return false;
  if (state === 'ENABLED_HIGH_CONFIDENCE' || state === 'ENABLED_MEDIUM_CONFIDENCE') return true;
  if (minimum === 'low' && state === 'ENABLED_LOW_CONFIDENCE') return true;
  return false;
}

export function isOperationalOutputStatus(status: OutputStatus | string | undefined): boolean {
  return status === OutputStatus.OK || status === OutputStatus.LOW_QUALITY;
}

export function isResearchOnlyOutputStatus(status: OutputStatus | string | undefined): boolean {
  return status === OutputStatus.RESEARCH_ONLY;
}
