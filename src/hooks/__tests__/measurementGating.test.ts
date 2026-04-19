import { describe, expect, it } from 'vitest';
import { isOperationalOutputState, isOperationalOutputStatus, isResearchOnlyOutputStatus } from '@/utils/outputStateGuards';

describe('outputStateGuards', () => {
  it('accepts only operational output states by threshold', () => {
    expect(isOperationalOutputState('ENABLED_HIGH_CONFIDENCE')).toBe(true);
    expect(isOperationalOutputState('ENABLED_MEDIUM_CONFIDENCE')).toBe(true);
    expect(isOperationalOutputState('ENABLED_LOW_CONFIDENCE')).toBe(false);
    expect(isOperationalOutputState('ENABLED_LOW_CONFIDENCE', 'low')).toBe(true);
    expect(isOperationalOutputState('RESEARCH_ONLY')).toBe(false);
  });

  it('classifies output statuses correctly', () => {
    expect(isOperationalOutputStatus('ok')).toBe(true);
    expect(isOperationalOutputStatus('low_quality')).toBe(true);
    expect(isOperationalOutputStatus('blocked')).toBe(false);
    expect(isResearchOnlyOutputStatus('research_only')).toBe(true);
    expect(isResearchOnlyOutputStatus('ok')).toBe(false);
  });

  it('rejects needs-calibration and withheld states as operational', () => {
    expect(isOperationalOutputState('NEEDS_CALIBRATION' as any)).toBe(false);
    expect(isOperationalOutputState('WITHHELD_LOW_QUALITY')).toBe(false);
  });
});
