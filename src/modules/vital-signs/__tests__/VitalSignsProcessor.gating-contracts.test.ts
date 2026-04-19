import { describe, expect, it } from 'vitest';
import { VitalSignsProcessor } from '../VitalSignsProcessor';

describe('VitalSignsProcessor contracts', () => {
  it('keeps research biomarkers flagged as RESEARCH_ONLY when unavailable', () => {
    const proc = new VitalSignsProcessor();
    const result = proc.processSignal(0);

    expect(result.outputStates?.glucose).toBe('RESEARCH_ONLY');
    expect(result.outputStates?.lipids).toBe('RESEARCH_ONLY');
  });

  it('withholds SpO2 when no calibrated value exists', () => {
    const proc = new VitalSignsProcessor();
    const result = proc.processSignal(0);

    expect(result.outputStates?.spo2).toBe('WITHHELD_LOW_QUALITY');
  });
});
