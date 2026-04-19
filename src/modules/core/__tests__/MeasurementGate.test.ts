import { describe, it, expect } from 'vitest';
import { MeasurementGate } from '../MeasurementGate';

describe('MeasurementGate', () => {
  it('gateBPM withholds when bpm <= 0 or confidence too low', () => {
    expect(MeasurementGate.gateBPM(0, 0.5, 5, 60).state).toBe('WITHHELD_LOW_QUALITY');
    expect(MeasurementGate.gateBPM(72, 0.05, 5, 60).state).toBe('WITHHELD_LOW_QUALITY');
  });

  it('gateBPM enables HIGH at confidence ≥0.6 + quality + beats', () => {
    const g = MeasurementGate.gateBPM(72, 0.7, 8, 80);
    expect(g.state).toBe('ENABLED_HIGH_CONFIDENCE');
    expect(g.value).toBe(72);
    expect(g.quality).toBeGreaterThan(0);
  });

  it('gateBPM downgrades to MEDIUM/LOW based on inputs', () => {
    expect(MeasurementGate.gateBPM(75, 0.4, 6, 50).state).toBe('ENABLED_MEDIUM_CONFIDENCE');
    expect(MeasurementGate.gateBPM(75, 0.2, 3, 30).state).toBe('ENABLED_LOW_CONFIDENCE');
  });

  it('gateBP withholds without systolic/diastolic or INSUFFICIENT confidence', () => {
    expect(MeasurementGate.gateBP(0, 0, 'INSUFFICIENT', 0, 0).state).toBe('WITHHELD_LOW_QUALITY');
  });

  it('gateBP enables MEDIUM/LOW based on featureQuality and cycleCount', () => {
    expect(MeasurementGate.gateBP(120, 80, 'HIGH', 80, 10).state).toBe('ENABLED_MEDIUM_CONFIDENCE');
    expect(MeasurementGate.gateBP(120, 80, 'LOW', 40, 5).state).toBe('ENABLED_LOW_CONFIDENCE');
    expect(MeasurementGate.gateBP(120, 80, 'LOW', 10, 1).state).toBe('RESEARCH_ONLY');
  });

  it('buildQualityReport returns structured quality + confidence sets', () => {
    const r = MeasurementGate.buildQualityReport({
      signalQuality: 70, avgBeatSQI: 60, rhythmQuality: 50, spo2Quality: 65,
      bpFeatureQuality: 75, glucoseFeatureCount: 8, lipidsFeatureCount: 6,
      bpmConfidence: 0.7, rhythmConfidence: 0.5, spo2Confidence: 0.6,
      bpConfidence: 0.6, glucoseConfidence: 0.3, lipidsConfidence: 0.2,
    });
    expect(r.quality.signalQuality).toBe(70);
    expect(r.confidence.bpmConfidence).toBe(0.7);
    expect(r.quality.glucoseQuality).toBe(80);
  });
});
